import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';

const rawBaseDbUrl =
  process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca';
const isolatedSchema = 'f05_test';
const isolatedUrl = new URL(rawBaseDbUrl);
isolatedUrl.searchParams.set('options', `-c search_path=${isolatedSchema}`);
process.env.DATABASE_URL = isolatedUrl.toString();

if (!process.env.GATEWAY_DELAY_MULTIPLIER) {
  process.env.GATEWAY_DELAY_MULTIPLIER = '0.05';
}

const { createApp } = await import('../src/server.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { runSeed } = await import('../src/db/seed.js');
const { pool } = await import('../src/db/pool.js');
const { config } = await import('../src/shared/config.js');
const { generateId, generateTicketCode } = await import('../src/shared/ids.js');
const { applyGatewayResolution } = await import('../src/modules/purchases/gateway.js');
const {
  computeCancellationSettlementDelayMs,
  reconcileCancelledEventsTickets,
  stopCancellationReconciler,
} = await import('../src/modules/cancellation/service.js');
const { mountCancelWidget } = await import('../src/web/views/cancel-widget.js');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginUser(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string };
  assert.ok(body.token);
  return body.token;
}

async function createEvent(
  baseUrl: string,
  orgToken: string,
  params: { name: string; capacity: number; priceCents: number },
): Promise<{ id: string; name: string; status: string; capacity: number; priceCents: number }> {
  const startsAt = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${baseUrl}/api/organizer/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      name: params.name,
      startsAt,
      location: 'Teatro Catraca F05',
      capacity: params.capacity,
      priceCents: params.priceCents,
    }),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as {
    id: string;
    name: string;
    status: string;
    capacity: number;
    priceCents: number;
  };
}

async function publishEvent(
  baseUrl: string,
  orgToken: string,
  eventId: string,
): Promise<{ id: string; status: string; availableSeats: number }> {
  const res = await fetch(`${baseUrl}/api/organizer/events/${eventId}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
  });
  assert.equal(res.status, 200);
  return (await res.json()) as { id: string; status: string; availableSeats: number };
}

async function waitForTicketStatus(
  baseUrl: string,
  ticketId: string,
  expectedStatus: string,
  timeoutMs = 6000,
): Promise<{
  ticketId: string;
  code: string;
  eventId: string;
  status: string;
  checkedIn: boolean;
}> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: {
    ticketId: string;
    code: string;
    eventId: string;
    status: string;
    checkedIn: boolean;
  } | null = null;

  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/partner/tickets/${ticketId}`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    assert.equal(res.status, 200);
    lastBody = (await res.json()) as {
      ticketId: string;
      code: string;
      eventId: string;
      status: string;
      checkedIn: boolean;
    };
    if (lastBody.status === expectedStatus) {
      return lastBody;
    }
    await sleep(25);
  }

  assert.fail(
    `Timeout aguardando ingresso ${ticketId} atingir status "${expectedStatus}". Último: ${JSON.stringify(lastBody)}`,
  );
}

describe('F05 — Cancelamento Irreversível e Estorno Assíncrono', () => {
  let server: http.Server;
  let baseUrl: string;
  let orgAToken: string;
  let orgBToken: string;
  let participantToken: string;

  before(async () => {
    const adminClient = new pg.Client({ connectionString: rawBaseDbUrl });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP SCHEMA IF EXISTS ${isolatedSchema} CASCADE`);
      await adminClient.query(`CREATE SCHEMA ${isolatedSchema}`);
    } finally {
      await adminClient.end();
    }

    await runMigrations();
    await runSeed();

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    orgAToken = await loginUser(baseUrl, 'org.a@catraca.local', 'OrgA@123');
    orgBToken = await loginUser(baseUrl, 'org.b@catraca.local', 'OrgB@123');
    participantToken = await loginUser(baseUrl, 'participante@catraca.local', 'Part@123');
  });

  after(async () => {
    stopCancellationReconciler();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await pool.end();

    const adminClient = new pg.Client({ connectionString: rawBaseDbUrl });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP SCHEMA IF EXISTS ${isolatedSchema} CASCADE`);
    } finally {
      await adminClient.end();
    }
  });

  it('garante atraso de liquidação assíncrona bem abaixo do SLA máximo de 10s no modo padrão (multiplier=1)', () => {
    const prodDelayMs = computeCancellationSettlementDelayMs(1);
    assert.equal(prodDelayMs, 300);
    assert.ok(prodDelayMs < 10000, 'Delay em produção deve ser muito inferior a 10 segundos');
  });

  let e3Id = '';
  let t5SlowApproveId = '';
  let t6ConfirmedId = '';
  let t7SlowDeclineShowcaseId = '';
  let t8ConfirmedShowcaseId = '';
  let t9AlreadyDeclinedId = '';
  let purchaseT5StartedAt = 0;

  it('CT-F05-01 (CA-F05-01, R11, R05, CF-08, CF-09): cancela E3 publicado de forma irreversível, retira da vitrine/parceiros, zera vagas e bloqueia compras/edição/republicação', async () => {
    // Eventos em draft não podem ser cancelados (409 cannot_cancel_event)
    const draftEvt = await createEvent(baseUrl, orgAToken, {
      name: 'Rascunho Não Cancelável',
      capacity: 10,
      priceCents: 4000,
    });
    const cancelDraftRes = await fetch(`${baseUrl}/api/organizer/events/${draftEvt.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(cancelDraftRes.status, 409);
    assert.deepEqual(await cancelDraftRes.json(), { error: 'cannot_cancel_event' });

    // Cria e publica evento E3 (lotação 5, R$ 50,00 = 5000 centavos)
    const createdE3 = await createEvent(baseUrl, orgAToken, {
      name: 'Show Cancelamento E3',
      capacity: 5,
      priceCents: 5000,
    });
    e3Id = createdE3.id;
    await publishEvent(baseUrl, orgAToken, e3Id);

    // 1) Compra prévia recusada ($T9 com cartão 0002 -> declined) para provar que declined não vira refunded/cancelled
    const buyT9Res = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'recusado.previo@parceiro.local',
        cardNumber: '4000000000000002',
      }),
    });
    assert.equal(buyT9Res.status, 202);
    t9AlreadyDeclinedId = ((await buyT9Res.json()) as { ticketId: string }).ticketId;
    await waitForTicketStatus(baseUrl, t9AlreadyDeclinedId, 'declined');

    // 2) Compra $T5 via API de parceiros com cartão lento 0003 (aprovaria em 30-40s)
    purchaseT5StartedAt = Date.now();
    const buyT5Res = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'lento.0003@parceiro.local',
        cardNumber: '4000000000000003',
      }),
    });
    assert.equal(buyT5Res.status, 202);
    t5SlowApproveId = ((await buyT5Res.json()) as { ticketId: string }).ticketId;

    // 3) Compra $T7 na vitrine pelo participante com cartão lento 0004 (recusaria em 30-40s)
    const buyT7Res = await fetch(`${baseUrl}/api/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000004' }),
    });
    assert.equal(buyT7Res.status, 202);
    t7SlowDeclineShowcaseId = ((await buyT7Res.json()) as { ticketId: string }).ticketId;

    // 4) Compra $T6 via API de parceiros com cartão rápido 0001 e $T8 na vitrine com 0001
    const buyT6Res = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'confirmado.0001@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyT6Res.status, 202);
    t6ConfirmedId = ((await buyT6Res.json()) as { ticketId: string }).ticketId;

    const buyT8Res = await fetch(`${baseUrl}/api/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyT8Res.status, 202);
    t8ConfirmedShowcaseId = ((await buyT8Res.json()) as { ticketId: string }).ticketId;

    // Aguarda $T6 e $T8 ficarem confirmed, garantindo que $T5 e $T7 continuam pending (antes da janela de 30s)
    await waitForTicketStatus(baseUrl, t6ConfirmedId, 'confirmed');
    await waitForTicketStatus(baseUrl, t8ConfirmedShowcaseId, 'confirmed');

    const t5BeforeCancel = await (
      await fetch(`${baseUrl}/api/partner/tickets/${t5SlowApproveId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    assert.equal((t5BeforeCancel as { status: string }).status, 'pending');

    const t7BeforeCancel = await (
      await fetch(`${baseUrl}/api/partner/tickets/${t7SlowDeclineShowcaseId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    assert.equal((t7BeforeCancel as { status: string }).status, 'pending');

    // Antes de cancelar: E3 está na vitrine com 1 vaga disponível (5 - 4 ocupadas)
    const showcaseBefore = (await (await fetch(`${baseUrl}/api/events`)).json()) as Array<{
      id: string;
      availableSeats: number;
    }>;
    assert.equal(showcaseBefore.find((ev) => ev.id === e3Id)?.availableSeats, 1);

    // Cancela E3 via API do organizador
    const cancelStartedAt = Date.now();
    const cancelRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    const cancelElapsedMs = Date.now() - cancelStartedAt;
    assert.equal(cancelRes.status, 200);
    assert.ok(cancelElapsedMs < 1000, 'Cancelamento deve responder imediatamente');
    assert.deepEqual(await cancelRes.json(), {
      id: e3Id,
      status: 'cancelled',
      availableSeats: 0,
    });

    // Efeito imediato 1: E3 some da vitrine pública (GET /api/events) e de GET /api/partner/events
    const showcaseAfter = (await (await fetch(`${baseUrl}/api/events`)).json()) as Array<{
      id: string;
    }>;
    assert.equal(
      showcaseAfter.some((ev) => ev.id === e3Id),
      false,
      'E3 cancelado deve sair imediatamente da vitrine pública',
    );

    const partnerAfter = (await (
      await fetch(`${baseUrl}/api/partner/events`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json()) as Array<{ id: string }>;
    assert.equal(
      partnerAfter.some((ev) => ev.id === e3Id),
      false,
      'E3 cancelado deve sair imediatamente de GET /api/partner/events',
    );

    // Efeito imediato 2: detalhe do organizador reporta status cancelled, cancelledAt preenchido e availableSeats = 0 (R05)
    const detailAfter = (await (
      await fetch(`${baseUrl}/api/organizer/events/${e3Id}`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      })
    ).json()) as { status: string; availableSeats: number; cancelledAt: string | null };
    assert.equal(detailAfter.status, 'cancelled');
    assert.equal(detailAfter.availableSeats, 0);
    assert.ok(detailAfter.cancelledAt, 'cancelledAt deve ser gravado no cancelamento');

    // Efeito imediato 3: novas tentativas de compra retornam 404 {"error":"event_not_available"} (CF-09)
    const partnerBuyAfterCancel = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'apos.cancelamento@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(partnerBuyAfterCancel.status, 404);
    assert.deepEqual(await partnerBuyAfterCancel.json(), { error: 'event_not_available' });

    const showcaseBuyAfterCancel = await fetch(`${baseUrl}/api/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(showcaseBuyAfterCancel.status, 404);
    assert.deepEqual(await showcaseBuyAfterCancel.json(), { error: 'event_not_available' });

    // Efeito imediato 4: edição, republicação e novo cancelamento retornam 409 (CF-08, R11)
    const patchCancelledRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ name: 'Tentativa Editar E3', capacity: 10 }),
    });
    assert.equal(patchCancelledRes.status, 409);
    assert.deepEqual(await patchCancelledRes.json(), { error: 'event_cancelled' });

    const republishCancelledRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(republishCancelledRes.status, 409);
    assert.deepEqual(await republishCancelledRes.json(), { error: 'event_cancelled' });

    const recancelRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(recancelRes.status, 409);
    assert.deepEqual(await recancelRes.json(), { error: 'cannot_cancel_event' });
  });

  it('CT-F05-02 (CA-F05-02, R11, CF-09): em muito menos de 10s converte confirmed -> refunded (estornado) e pending -> cancelled (cancelado)', async () => {
    const settlementStart = Date.now();

    const settledT6 = await waitForTicketStatus(baseUrl, t6ConfirmedId, 'refunded', 4000);
    const settledT8 = await waitForTicketStatus(baseUrl, t8ConfirmedShowcaseId, 'refunded', 4000);
    const settledT5 = await waitForTicketStatus(baseUrl, t5SlowApproveId, 'cancelled', 4000);
    const settledT7 = await waitForTicketStatus(
      baseUrl,
      t7SlowDeclineShowcaseId,
      'cancelled',
      4000,
    );

    const settlementElapsedMs = Date.now() - settlementStart;
    assert.ok(
      settlementElapsedMs < 2000,
      `Liquidação deve ocorrer bem abaixo de 10s (levou ${settlementElapsedMs}ms)`,
    );

    assert.equal(settledT6.status, 'refunded');
    assert.equal(settledT8.status, 'refunded');
    assert.equal(settledT5.status, 'cancelled');
    assert.equal(settledT7.status, 'cancelled');

    // Ingresso que já estava declined antes do cancelamento permanece declined
    const t9After = await (
      await fetch(`${baseUrl}/api/partner/tickets/${t9AlreadyDeclinedId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    assert.equal((t9After as { status: string }).status, 'declined');

    // Confere rótulos em português ("estornado" e "cancelado") em "Meus ingressos" (R09 + R11)
    const myTicketsRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    assert.equal(myTicketsRes.status, 200);
    const myTickets = (await myTicketsRes.json()) as Array<{
      ticketId: string;
      status: string;
      statusLabel: string;
    }>;

    const myT8 = myTickets.find((t) => t.ticketId === t8ConfirmedShowcaseId);
    assert.ok(myT8);
    assert.equal(myT8.status, 'refunded');
    assert.equal(myT8.statusLabel, 'estornado');

    const myT7 = myTickets.find((t) => t.ticketId === t7SlowDeclineShowcaseId);
    assert.ok(myT7);
    assert.equal(myT7.status, 'cancelled');
    assert.equal(myT7.statusLabel, 'cancelado');
  });

  it('CT-F05-03 (CA-F05-03, R11, CF-09): respostas tardias do gateway simulado (0003 e 0004) não alteram cancelled nem refunded', async () => {
    // Aguarda completar o equivalente a > 45s desde a compra de $T5/$T7 (45000 * multiplier + margem)
    const targetTotalWaitMs = Math.ceil(45000 * config.gatewayDelayMultiplier) + 250;
    const elapsedSincePurchase = Date.now() - purchaseT5StartedAt;
    if (elapsedSincePurchase < targetTotalWaitMs) {
      await sleep(targetTotalWaitMs - elapsedSincePurchase);
    }

    // Também testa tentativa explícita de resolução tardia do gateway contra os ingressos já liquidados
    const lateApproveOnCancelled = await applyGatewayResolution(t5SlowApproveId, 'confirmed');
    const lateDeclineOnCancelled = await applyGatewayResolution(
      t7SlowDeclineShowcaseId,
      'declined',
    );
    const lateDeclineOnRefunded = await applyGatewayResolution(t6ConfirmedId, 'declined');
    const lateApproveOnRefunded = await applyGatewayResolution(t8ConfirmedShowcaseId, 'confirmed');

    assert.equal(lateApproveOnCancelled, false);
    assert.equal(lateDeclineOnCancelled, false);
    assert.equal(lateDeclineOnRefunded, false);
    assert.equal(lateApproveOnRefunded, false);

    // Consulta novamente na API de parceiros e em "Meus ingressos"
    const t5After45s = (await (
      await fetch(`${baseUrl}/api/partner/tickets/${t5SlowApproveId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json()) as { status: string };
    assert.equal(t5After45s.status, 'cancelled');

    const t7After45s = (await (
      await fetch(`${baseUrl}/api/partner/tickets/${t7SlowDeclineShowcaseId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json()) as { status: string };
    assert.equal(t7After45s.status, 'cancelled');

    const t6After45s = (await (
      await fetch(`${baseUrl}/api/partner/tickets/${t6ConfirmedId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json()) as { status: string };
    assert.equal(t6After45s.status, 'refunded');

    const t8After45s = (await (
      await fetch(`${baseUrl}/api/partner/tickets/${t8ConfirmedShowcaseId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json()) as { status: string };
    assert.equal(t8After45s.status, 'refunded');
  });

  it('CT-F05-04 (R13, CF-07): bloqueia cancelamento por visitante (401), participante (403) e outro organizador (403), e retorna 404 se inexistente', async () => {
    const orgAEvent = await createEvent(baseUrl, orgAToken, {
      name: 'Evento Protegido Org A',
      capacity: 8,
      priceCents: 9000,
    });
    await publishEvent(baseUrl, orgAToken, orgAEvent.id);

    // 1. Visitante deslogado -> 401 unauthenticated
    const anonRes = await fetch(`${baseUrl}/api/organizer/events/${orgAEvent.id}/cancel`, {
      method: 'POST',
    });
    assert.equal(anonRes.status, 401);
    assert.deepEqual(await anonRes.json(), { error: 'unauthenticated' });

    // 2. Participante autenticado -> 403 forbidden
    const partRes = await fetch(`${baseUrl}/api/organizer/events/${orgAEvent.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    assert.equal(partRes.status, 403);
    assert.deepEqual(await partRes.json(), { error: 'forbidden' });

    // 3. Organizador B autenticado tentando cancelar evento de A -> 403 forbidden (sem vazamento)
    const orgBRes = await fetch(`${baseUrl}/api/organizer/events/${orgAEvent.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBRes.status, 403);
    const orgBBody = await orgBRes.json();
    assert.deepEqual(orgBBody, { error: 'forbidden' });
    assert.doesNotMatch(JSON.stringify(orgBBody), /Evento Protegido Org A/);

    // Mesmo em evento cancelado de A, Organizador B recebe 403 forbidden (e não 409!)
    const orgBOnCancelledA = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBOnCancelledA.status, 403);
    assert.deepEqual(await orgBOnCancelledA.json(), { error: 'forbidden' });

    // 4. Evento inexistente -> 404 not_found
    const missingRes = await fetch(
      `${baseUrl}/api/organizer/events/evt_inexistente_f05_999/cancel`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAToken}` },
      },
    );
    assert.equal(missingRes.status, 404);
    assert.deepEqual(await missingRes.json(), { error: 'not_found' });

    // Confirma que o evento do Organizador A permaneceu published e visível na vitrine
    const detailOrgA = (await (
      await fetch(`${baseUrl}/api/organizer/events/${orgAEvent.id}`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      })
    ).json()) as { status: string; availableSeats: number };
    assert.equal(detailOrgA.status, 'published');
    assert.equal(detailOrgA.availableSeats, 8);

    const showcaseList = (await (await fetch(`${baseUrl}/api/events`)).json()) as Array<{
      id: string;
    }>;
    assert.equal(
      showcaseList.some((ev) => ev.id === orgAEvent.id),
      true,
    );
  });

  it('reconciliador periódico liquida ingressos remanescentes de eventos cancelados e widget frontend reflete estados draft/published/cancelled', async () => {
    // 1. Teste direto do reconciliador seguro em banco
    const manualEvt = await createEvent(baseUrl, orgAToken, {
      name: 'Evento Reconciliação',
      capacity: 4,
      priceCents: 6000,
    });
    const tConfId = generateId('tkt');
    const tPendId = generateId('tkt');
    await pool.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [manualEvt.id],
    );
    await pool.query(
      `INSERT INTO tickets (id, code, event_id, buyer_email, channel, price_cents, status)
       VALUES ($1, $2, $3, 'a@b.com', 'partner', 6000, 'confirmed'),
              ($4, $5, $3, 'c@d.com', 'partner', 6000, 'pending')`,
      [tConfId, generateTicketCode(), manualEvt.id, tPendId, generateTicketCode()],
    );

    await reconcileCancelledEventsTickets();

    const reconciledRows = await pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM tickets WHERE event_id = $1 ORDER BY id',
      [manualEvt.id],
    );
    const statusMap = new Map(reconciledRows.rows.map((r) => [r.id, r.status]));
    assert.equal(statusMap.get(tConfId), 'refunded');
    assert.equal(statusMap.get(tPendId), 'cancelled');

    // Segunda execução é idempotente
    const secondRun = await reconcileCancelledEventsTickets();
    assert.equal(secondRun.refundedCount, 0);
    assert.equal(secondRun.cancelledCount, 0);

    // 2. Verifica servimento e integração de cancel-widget.js em organizer-event.js
    const cancelWidgetJsRes = await fetch(`${baseUrl}/views/cancel-widget.js`);
    assert.equal(cancelWidgetJsRes.status, 200);
    const cancelWidgetSource = await cancelWidgetJsRes.text();
    assert.match(cancelWidgetSource, /cancel-event-btn/);
    assert.match(cancelWidgetSource, /\/api\/organizer\/events\//);
    assert.match(cancelWidgetSource, /\/cancel/);

    const organizerEventJs = await (await fetch(`${baseUrl}/views/organizer-event.js`)).text();
    assert.match(organizerEventJs, /mountCancelWidget/);
    assert.match(organizerEventJs, /#event-cancel-slot/);

    // 3. Exercita o comportamento de mountCancelWidget nos estados draft, published (clique) e cancelled
    const targetCancelEvt = await createEvent(baseUrl, orgAToken, {
      name: 'Evento UI Widget Cancelamento',
      capacity: 3,
      priceCents: 4500,
    });
    await publishEvent(baseUrl, orgAToken, targetCancelEvt.id);

    let clickHandler: (() => Promise<void>) | null = null;
    const mockBtn = {
      disabled: false,
      textContent: 'Cancelar evento',
      addEventListener: (evName: string, fn: () => Promise<void>) => {
        if (evName === 'click') clickHandler = fn;
      },
    };
    const mockErrorBox = { hidden: true, textContent: '' };
    const mockSlot = {
      innerHTML: '',
      contains: () => true,
      querySelector: (sel: string) => {
        if (sel === '#cancel-event-btn') return mockBtn;
        if (sel === '#cancel-event-error') return mockErrorBox;
        return null;
      },
    };

    // Estado draft -> não renderiza botão de cancelamento
    mountCancelWidget(mockSlot, {
      event: { id: targetCancelEvt.id, name: targetCancelEvt.name, status: 'draft' },
    });
    assert.equal(mockSlot.innerHTML, '');

    // Estado published -> renderiza #cancel-event-btn e dispara POST .../cancel ao clicar
    const origFetch = globalThis.fetch;
    let cancelledCallbackPayload: Record<string, unknown> | null = null;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' && input.startsWith('/') ? `${baseUrl}${input}` : input;
      const mergedHeaders = {
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${orgAToken}`,
      };
      return origFetch(urlStr, { ...init, headers: mergedHeaders });
    }) as typeof fetch;

    try {
      mountCancelWidget(mockSlot, {
        event: { id: targetCancelEvt.id, name: targetCancelEvt.name, status: 'published' },
        onCancelled: async (body: Record<string, unknown>) => {
          cancelledCallbackPayload = body;
        },
      });
      assert.match(mockSlot.innerHTML, /id="cancel-event-btn"/);
      assert.ok(clickHandler, 'Deve registrar listener de clique no botão de cancelamento');

      await (clickHandler as () => Promise<void>)();
      assert.deepEqual(cancelledCallbackPayload, {
        id: targetCancelEvt.id,
        status: 'cancelled',
        availableSeats: 0,
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    // Estado cancelled -> exibe banner de cancelamento irreversível sem botão de cancelar novamente
    mountCancelWidget(mockSlot, {
      event: { id: targetCancelEvt.id, name: targetCancelEvt.name, status: 'cancelled' },
    });
    assert.match(mockSlot.innerHTML, /data-cancel-state="cancelled"/);
    assert.doesNotMatch(mockSlot.innerHTML, /id="cancel-event-btn"/);
  });
});
