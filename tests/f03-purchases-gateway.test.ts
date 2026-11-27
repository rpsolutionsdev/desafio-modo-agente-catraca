import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';

const rawBaseDbUrl =
  process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca';
const isolatedSchema = 'f03_test';
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
const { computeGatewayOutcome } = await import('../src/modules/purchases/gateway.js');
const { formatTicketStatusLabel: formatBackendStatusLabel } = await import(
  '../src/modules/purchases/service.js'
);
const {
  formatTicketStatusLabel: formatFrontendStatusLabel,
  TICKET_STATUS_LABELS,
} = await import('../src/web/views/my-tickets.js');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await sleep(30);
  }

  assert.fail(
    `Timeout aguardando ingresso ${ticketId} atingir status "${expectedStatus}". Último: ${JSON.stringify(lastBody)}`,
  );
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

async function createAndPublishEvent(
  baseUrl: string,
  orgToken: string,
  params: { name: string; capacity: number; priceCents: number },
): Promise<{ id: string; name: string; capacity: number; priceCents: number }> {
  const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const createRes = await fetch(`${baseUrl}/api/organizer/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      name: params.name,
      startsAt,
      location: 'Espaço Cultural Catraca',
      capacity: params.capacity,
      priceCents: params.priceCents,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    id: string;
    name: string;
    capacity: number;
    priceCents: number;
  };

  const pubRes = await fetch(`${baseUrl}/api/organizer/events/${created.id}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${orgToken}` },
  });
  assert.equal(pubRes.status, 200);

  return created;
}

describe('F03 — Compra de Ingressos, Lotação Concorrente, Gateway Simulado e API de Parceiros', () => {
  let server: http.Server;
  let baseUrl: string;
  let orgAToken: string;
  let seedParticipantToken: string;

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
    seedParticipantToken = await loginUser(baseUrl, 'participante@catraca.local', 'Part@123');
  });

  after(async () => {
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

  it('valida janelas de tempo do gateway no modo padrão (multiplier=1) e mapeamento de rótulos R09', () => {
    for (let i = 0; i < 40; i++) {
      const o1 = computeGatewayOutcome('4000000000000001', 1);
      assert.equal(o1.targetStatus, 'confirmed');
      assert.ok(o1.baseDelayMs >= 2000 && o1.baseDelayMs <= 5000);
      assert.equal(o1.effectiveDelayMs, o1.baseDelayMs);

      const o2 = computeGatewayOutcome('4000000000000002', 1);
      assert.equal(o2.targetStatus, 'declined');
      assert.ok(o2.baseDelayMs >= 2000 && o2.baseDelayMs <= 5000);

      const o3 = computeGatewayOutcome('4000000000000003', 1);
      assert.equal(o3.targetStatus, 'confirmed');
      assert.ok(o3.baseDelayMs >= 30000 && o3.baseDelayMs <= 40000);
      assert.equal(o3.effectiveDelayMs, o3.baseDelayMs);

      const o4 = computeGatewayOutcome('4000000000000004', 1);
      assert.equal(o4.targetStatus, 'declined');
      assert.ok(o4.baseDelayMs >= 30000 && o4.baseDelayMs <= 40000);

      const oOther = computeGatewayOutcome('4000000000009876', 1);
      assert.equal(oOther.targetStatus, 'declined');
      assert.ok(oOther.baseDelayMs >= 2000 && oOther.baseDelayMs <= 5000);
    }

    const expectedLabels = {
      pending: 'pendente',
      confirmed: 'confirmado',
      declined: 'recusado',
      cancelled: 'cancelado',
      refunded: 'estornado',
    } as const;

    assert.deepEqual(TICKET_STATUS_LABELS, expectedLabels);
    for (const [status, label] of Object.entries(expectedLabels)) {
      assert.equal(
        formatBackendStatusLabel(
          status as 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'refunded',
        ),
        label,
      );
      assert.equal(formatFrontendStatusLabel(status), label);
    }
  });

  let e1Id = '';
  let newParticipantToken = '';
  let firstShowcaseTicketId = '';

  it('CT-F03-01 (R06, R08, R09, CF-02): novo participante compra na vitrine com 0001, nasce pendente e confirma assincronamente', async () => {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lucas Comprador',
        email: `lucas.f03.${Date.now()}@catraca.local`,
        password: 'Password123',
      }),
    });
    assert.equal(regRes.status, 201);
    const regBody = (await regRes.json()) as { token: string; user: { id: string } };
    newParticipantToken = regBody.token;

    const e1 = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Show E1 F03',
      capacity: 2,
      priceCents: 10000,
    });
    e1Id = e1.id;

    // Compra unitária na vitrine com final 0001
    const startedAt = Date.now();
    const buyRes = await fetch(`${baseUrl}/api/events/${e1.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newParticipantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(buyRes.status, 202);
    assert.ok(elapsedMs < 1000, 'A resposta da compra deve retornar sem aguardar o gateway');
    const buyBody = (await buyRes.json()) as { ticketId: string; code: string; status: string };
    assert.ok(buyBody.ticketId.startsWith('tkt_'));
    assert.match(buyBody.code, /^[A-Z0-9]{8}$/);
    assert.equal(buyBody.status, 'pending');
    firstShowcaseTicketId = buyBody.ticketId;

    // Consulta imediata em GET /api/my-tickets -> status pendente e vaga já ocupada
    const myTicketsImmediateRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${newParticipantToken}` },
    });
    assert.equal(myTicketsImmediateRes.status, 200);
    const immediateList = (await myTicketsImmediateRes.json()) as Array<{
      ticketId: string;
      code: string;
      eventId: string;
      eventName: string;
      priceCents: number;
      status: string;
      statusLabel: string;
    }>;
    assert.equal(immediateList.length, 1);
    assert.equal(immediateList[0].ticketId, buyBody.ticketId);
    assert.equal(immediateList[0].code, buyBody.code);
    assert.equal(immediateList[0].eventName, 'Show E1 F03');
    assert.equal(immediateList[0].priceCents, 10000);
    assert.equal(immediateList[0].status, 'pending');
    assert.equal(immediateList[0].statusLabel, 'pendente');

    // Vaga imediatamente reduzida de 2 para 1 na vitrine e na API de parceiros (R05)
    const showcaseRes = await fetch(`${baseUrl}/api/events`);
    const showcaseEvents = (await showcaseRes.json()) as Array<{
      id: string;
      availableSeats: number;
    }>;
    assert.equal(showcaseEvents.find((ev) => ev.id === e1.id)?.availableSeats, 1);

    // Outro participante não vê ingressos de Lucas
    const otherMyTicketsRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${seedParticipantToken}` },
    });
    assert.equal(otherMyTicketsRes.status, 200);
    assert.deepEqual(await otherMyTicketsRes.json(), []);

    // Aguarda gateway aprovar cartão 0001 -> confirmed / confirmado
    await waitForTicketStatus(baseUrl, buyBody.ticketId, 'confirmed');

    const myTicketsConfirmedRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${newParticipantToken}` },
    });
    const confirmedList = (await myTicketsConfirmedRes.json()) as Array<{
      ticketId: string;
      code: string;
      eventName: string;
      status: string;
      statusLabel: string;
    }>;
    assert.equal(confirmedList.length, 1);
    assert.equal(confirmedList[0].eventName, 'Show E1 F03');
    assert.equal(confirmedList[0].code, buyBody.code);
    assert.equal(confirmedList[0].status, 'confirmed');
    assert.equal(confirmedList[0].statusLabel, 'confirmado');
  });

  it('CT-F03-02 (R05, R06, R07, R08): cartão lento 0004 segura vaga durante pending (409 sold_out) e devolve vaga ao recusar', async () => {
    // E1 possui lotação 2 e já tem 1 ingresso confirmado; compramos a 2ª vaga com cartão lento 0004
    const partnerBuyRes = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'cliente.lento@parceiro.local',
        cardNumber: '4000000000000004',
      }),
    });
    assert.equal(partnerBuyRes.status, 202);
    const t2 = (await partnerBuyRes.json()) as { ticketId: string; code: string; status: string };
    assert.equal(t2.status, 'pending');

    // Enquanto t2 está pending (antes da resolução lenta): availableSeats === 0
    const partnerEventsDuring = await (
      await fetch(`${baseUrl}/api/partner/events`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    const e1During = (partnerEventsDuring as Array<{ id: string; availableSeats: number }>).find(
      (ev) => ev.id === e1Id,
    );
    assert.ok(e1During);
    assert.equal(e1During.availableSeats, 0);

    const showcaseDuring = await (await fetch(`${baseUrl}/api/events`)).json();
    const e1ShowcaseDuring = (showcaseDuring as Array<{ id: string; availableSeats: number }>).find(
      (ev) => ev.id === e1Id,
    );
    assert.ok(e1ShowcaseDuring);
    assert.equal(e1ShowcaseDuring.availableSeats, 0);

    // Tentativa adicional de compra pela API de parceiros e pela vitrine falha com 409 sold_out
    const extraPartnerAttempt = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'outro@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(extraPartnerAttempt.status, 409);
    assert.deepEqual(await extraPartnerAttempt.json(), { error: 'sold_out' });

    const extraShowcaseAttempt = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newParticipantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(extraShowcaseAttempt.status, 409);
    assert.deepEqual(await extraShowcaseAttempt.json(), { error: 'sold_out' });

    // Após resolução do gateway lento (0004 -> declined), a vaga retorna para 1
    const resolvedT2 = await waitForTicketStatus(baseUrl, t2.ticketId, 'declined');
    assert.deepEqual(resolvedT2, {
      ticketId: t2.ticketId,
      code: t2.code,
      eventId: e1Id,
      status: 'declined',
      checkedIn: false,
    });

    const partnerEventsAfter = await (
      await fetch(`${baseUrl}/api/partner/events`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    const e1After = (partnerEventsAfter as Array<{ id: string; availableSeats: number }>).find(
      (ev) => ev.id === e1Id,
    );
    assert.ok(e1After);
    assert.equal(e1After.availableSeats, 1);
  });

  it('testa demais sufixos do gateway (0002, 0003, outros) e proteção R11 contra sobrescrita em evento cancelado', async () => {
    const evtSuffix = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento Sufixos Gateway',
      capacity: 5,
      priceCents: 6000,
    });

    // Sufixo 0002 -> declined
    const res0002 = await fetch(`${baseUrl}/api/events/${evtSuffix.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seedParticipantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000002' }),
    });
    assert.equal(res0002.status, 202);
    const t0002 = (await res0002.json()) as { ticketId: string };

    // Sufixo genérico (9999) -> declined
    const res9999 = await fetch(`${baseUrl}/api/events/${evtSuffix.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${seedParticipantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000009999' }),
    });
    assert.equal(res9999.status, 202);
    const t9999 = (await res9999.json()) as { ticketId: string };

    // Sufixo 0003 -> confirmed (lento)
    const res0003 = await fetch(`${baseUrl}/api/partner/events/${evtSuffix.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'aprovado.lento@parceiro.local',
        cardNumber: '4000000000000003',
      }),
    });
    assert.equal(res0003.status, 202);
    const t0003 = (await res0003.json()) as { ticketId: string };

    await waitForTicketStatus(baseUrl, t0002.ticketId, 'declined');
    await waitForTicketStatus(baseUrl, t9999.ticketId, 'declined');
    await waitForTicketStatus(baseUrl, t0003.ticketId, 'confirmed');

    // Confere rótulo 'recusado' em GET /api/my-tickets para seedParticipant
    const seedTicketsRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${seedParticipantToken}` },
    });
    const seedTickets = (await seedTicketsRes.json()) as Array<{
      ticketId: string;
      status: string;
      statusLabel: string;
    }>;
    const declinedTicket = seedTickets.find((t) => t.ticketId === t0002.ticketId);
    assert.ok(declinedTicket);
    assert.equal(declinedTicket.status, 'declined');
    assert.equal(declinedTicket.statusLabel, 'recusado');

    // Proteção R11: se o evento for cancelado enquanto 0003 está em trânsito, o gateway jamais sobrescreve
    const evtCancelGuard = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento Guarda Cancelamento R11',
      capacity: 2,
      priceCents: 7000,
    });

    const slowOnCancelledRes = await fetch(
      `${baseUrl}/api/partner/events/${evtCancelGuard.id}/purchases`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': config.partnerApiKey,
        },
        body: JSON.stringify({
          buyerEmail: 'guarda.r11@parceiro.local',
          cardNumber: '4000000000000003',
        }),
      },
    );
    assert.equal(slowOnCancelledRes.status, 202);
    const slowGuardTicket = (await slowOnCancelledRes.json()) as { ticketId: string };

    // Cancela o evento e transiciona o ingresso para 'cancelled' antes do retorno do cartão 0003
    await pool.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [evtCancelGuard.id],
    );
    await pool.query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [
      slowGuardTicket.ticketId,
    ]);

    // Espera além do tempo máximo de 0003 no multiplicador de teste (40000 * 0.05 = 2000ms)
    await sleep(Math.ceil(40000 * config.gatewayDelayMultiplier) + 250);

    const afterLateGateway = await fetch(
      `${baseUrl}/api/partner/tickets/${slowGuardTicket.ticketId}`,
      {
        headers: { 'X-Api-Key': config.partnerApiKey },
      },
    );
    assert.equal(afterLateGateway.status, 200);
    const afterLateBody = (await afterLateGateway.json()) as { status: string };
    assert.equal(afterLateBody.status, 'cancelled');
  });

  it('CT-F03-03 (R03, CF-03): bloqueia redução de lotação abaixo de ocupados e preserva priceCents histórico ao mudar preço', async () => {
    // Em E1 temos 1 ingresso confirmado (a 10000); compramos a 2ª vaga também a 10000
    const secondBuyRes = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newParticipantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(secondBuyRes.status, 202);
    const secondTicket = (await secondBuyRes.json()) as { ticketId: string };

    // Com 2 vagas ocupadas (1 confirmed + 1 pending), tentar reduzir lotação para 1 falha com 409
    const shrinkRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 1 }),
    });
    assert.equal(shrinkRes.status, 409);
    assert.deepEqual(await shrinkRes.json(), { error: 'capacity_below_occupied' });

    // Aumentar lotação para 3 e alterar preço para R$ 150,00 (15000) é aceito
    const expandRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 3, priceCents: 15000 }),
    });
    assert.equal(expandRes.status, 200);
    const expanded = (await expandRes.json()) as {
      capacity: number;
      priceCents: number;
      availableSeats: number;
    };
    assert.equal(expanded.capacity, 3);
    assert.equal(expanded.priceCents, 15000);
    assert.equal(expanded.availableSeats, 1);

    // Compra o 3º ingresso já sob o novo preço (15000)
    const thirdBuyRes = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newParticipantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(thirdBuyRes.status, 202);
    const thirdTicket = (await thirdBuyRes.json()) as { ticketId: string };

    await waitForTicketStatus(baseUrl, secondTicket.ticketId, 'confirmed');
    await waitForTicketStatus(baseUrl, thirdTicket.ticketId, 'confirmed');

    // Confere histórico de preços: 2 primeiros permanecem 10000 e apenas o 3º registra 15000
    const myTicketsRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${newParticipantToken}` },
    });
    const myTickets = (await myTicketsRes.json()) as Array<{
      ticketId: string;
      priceCents: number;
      status: string;
    }>;
    const byId = new Map(myTickets.map((t) => [t.ticketId, t]));
    assert.equal(byId.get(firstShowcaseTicketId)?.priceCents, 10000);
    assert.equal(byId.get(secondTicket.ticketId)?.priceCents, 10000);
    assert.equal(byId.get(thirdTicket.ticketId)?.priceCents, 15000);
  });

  it('CT-F03-04 (R07): garante zero overselling sob 30 compras simultâneas em duas rodadas independentes (5x 202 e 25x 409)', async () => {
    for (const roundName of ['Evento Concorrência E4', 'Evento Concorrência E5']) {
      const ev = await createAndPublishEvent(baseUrl, orgAToken, {
        name: roundName,
        capacity: 5,
        priceCents: 12000,
      });

      const burst = Array.from({ length: 30 }, (_, idx) =>
        fetch(`${baseUrl}/api/partner/events/${ev.id}/purchases`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.partnerApiKey,
          },
          body: JSON.stringify({
            buyerEmail: `concorrente.${idx}@parceiro.local`,
            cardNumber: '4000000000000001',
          }),
        }).then(async (res) => ({
          status: res.status,
          body: (await res.json()) as Record<string, unknown>,
        })),
      );

      const results = await Promise.all(burst);

      const accepted = results.filter((r) => r.status === 202);
      const soldOut = results.filter((r) => r.status === 409);

      assert.equal(
        accepted.length,
        5,
        `[${roundName}] Esperava exatamente 5 respostas 202, obteve ${accepted.length}`,
      );
      assert.equal(
        soldOut.length,
        25,
        `[${roundName}] Esperava exatamente 25 respostas 409, obteve ${soldOut.length}`,
      );

      for (const s of soldOut) {
        assert.deepEqual(s.body, { error: 'sold_out' });
      }

      const uniqueCodes = new Set(accepted.map((a) => String(a.body.code)));
      assert.equal(uniqueCodes.size, 5, 'Todos os 5 ingressos emitidos devem ter códigos únicos');

      const dbCount = await pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM tickets
         WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
        [ev.id],
      );
      assert.equal(dbCount.rows[0]?.total, 5);

      // Aguarda os 5 timers rápidos concluírem para não deixar timers pendentes
      await Promise.all(
        accepted.map((a) => waitForTicketStatus(baseUrl, String(a.body.ticketId), 'confirmed')),
      );
    }
  });

  it('CT-F03-05 (CA-F03-02, CA-F03-06, CF-02, CF-03): respeita estritamente a ordem de erros e contratos da API de parceiros e vitrine', async () => {
    // 1. Sem X-Api-Key ou chave errada em compra e consulta -> 401 {"error":"unauthorized"}
    for (const headers of [{}, { 'X-Api-Key': 'chave-errada' }] as Array<Record<string, string>>) {
      const buyUnauthorized = await fetch(
        `${baseUrl}/api/partner/events/evt_nao_existe/purchases`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ cardNumber: '123', buyerEmail: 'invalido' }),
        },
      );
      assert.equal(buyUnauthorized.status, 401);
      assert.deepEqual(await buyUnauthorized.json(), { error: 'unauthorized' });

      const getUnauthorized = await fetch(`${baseUrl}/api/partner/tickets/tkt_nao_existe`, {
        headers,
      });
      assert.equal(getUnauthorized.status, 401);
      assert.deepEqual(await getUnauthorized.json(), { error: 'unauthorized' });
    }

    // 2. Com X-Api-Key válida, corpo inválido retorna 422 {"error":"invalid_request"} ANTES de checar se o evento existe (404)
    const invalidPartnerBodies = [
      {},
      { buyerEmail: 'valido@parceiro.local' },
      { cardNumber: '4000000000000001' },
      { buyerEmail: 'email-malformado', cardNumber: '4000000000000001' },
      { buyerEmail: 'valido@parceiro.local', cardNumber: '123' },
      { buyerEmail: 'valido@parceiro.local', cardNumber: '400000000000000A' },
      { buyerEmail: 'valido@parceiro.local', cardNumber: '4000 0000 0000 0001' },
      { buyerEmail: 'valido@parceiro.local', cardNumber: '40000000000000019' },
    ];

    for (const invalidBody of invalidPartnerBodies) {
      const res = await fetch(`${baseUrl}/api/partner/events/evt_inexistente_422_antes_404/purchases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': config.partnerApiKey,
        },
        body: JSON.stringify(invalidBody),
      });
      assert.equal(
        res.status,
        422,
        `Esperava 422 antes de 404 para body inválido: ${JSON.stringify(invalidBody)}`,
      );
      assert.deepEqual(await res.json(), { error: 'invalid_request' });
    }

    const malformedJsonRes = await fetch(
      `${baseUrl}/api/partner/events/evt_inexistente_json/purchases`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': config.partnerApiKey,
        },
        body: '{"buyerEmail": "a@b.com", "cardNumber":',
      },
    );
    assert.equal(malformedJsonRes.status, 422);
    assert.deepEqual(await malformedJsonRes.json(), { error: 'invalid_request' });

    // 3. Com body válido, evento inexistente, draft ou cancelled retorna 404 {"error":"event_not_available"}
    const draftCreateRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Evento Rascunho F03',
        startsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Sala Rascunho',
        capacity: 10,
        priceCents: 5000,
      }),
    });
    assert.equal(draftCreateRes.status, 201);
    const draftEvent = (await draftCreateRes.json()) as { id: string };

    const cancelledEvent = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento Cancelado F03',
      capacity: 10,
      priceCents: 5000,
    });
    await pool.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [cancelledEvent.id],
    );

    for (const unavailableEventId of ['evt_inexistente_999', draftEvent.id, cancelledEvent.id]) {
      const partnerNotAvail = await fetch(
        `${baseUrl}/api/partner/events/${unavailableEventId}/purchases`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.partnerApiKey,
          },
          body: JSON.stringify({
            buyerEmail: 'comprador@parceiro.local',
            cardNumber: '4000000000000001',
          }),
        },
      );
      assert.equal(partnerNotAvail.status, 404);
      assert.deepEqual(await partnerNotAvail.json(), { error: 'event_not_available' });

      const showcaseNotAvail = await fetch(
        `${baseUrl}/api/events/${unavailableEventId}/purchases`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newParticipantToken}`,
          },
          body: JSON.stringify({ cardNumber: '4000000000000001' }),
        },
      );
      assert.equal(showcaseNotAvail.status, 404);
      assert.deepEqual(await showcaseNotAvail.json(), { error: 'event_not_available' });
    }

    // 4. Vitrine exige participante autenticado e valida 16 dígitos antes de consultar evento
    const anonShowcaseBuy = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(anonShowcaseBuy.status, 401);
    assert.deepEqual(await anonShowcaseBuy.json(), { error: 'unauthenticated' });

    const orgShowcaseBuy = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(orgShowcaseBuy.status, 403);
    assert.deepEqual(await orgShowcaseBuy.json(), { error: 'forbidden' });

    const badCardShowcaseBuy = await fetch(
      `${baseUrl}/api/events/evt_inexistente_card_check/purchases`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newParticipantToken}`,
        },
        body: JSON.stringify({ cardNumber: '123' }),
      },
    );
    assert.equal(badCardShowcaseBuy.status, 422);
    assert.deepEqual(await badCardShowcaseBuy.json(), { error: 'invalid_request' });

    // 5. GET /api/partner/tickets/:ticketId retorna 404 ticket_not_found para inexistente e 200 para ingresso da vitrine
    const notFoundTicketRes = await fetch(`${baseUrl}/api/partner/tickets/tkt_inexistente_000`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    assert.equal(notFoundTicketRes.status, 404);
    assert.deepEqual(await notFoundTicketRes.json(), { error: 'ticket_not_found' });

    const showcaseTicketInPartnerRes = await fetch(
      `${baseUrl}/api/partner/tickets/${firstShowcaseTicketId}`,
      {
        headers: { 'X-Api-Key': config.partnerApiKey },
      },
    );
    assert.equal(showcaseTicketInPartnerRes.status, 200);
    const showcaseTicketInPartner = (await showcaseTicketInPartnerRes.json()) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(showcaseTicketInPartner).sort(), [
      'checkedIn',
      'code',
      'eventId',
      'status',
      'ticketId',
    ]);
    assert.equal(showcaseTicketInPartner.ticketId, firstShowcaseTicketId);
    assert.equal(showcaseTicketInPartner.eventId, e1Id);
    assert.equal(showcaseTicketInPartner.status, 'confirmed');
    assert.equal(showcaseTicketInPartner.checkedIn, false);

    // 6. Confere presença dos módulos e elementos obrigatórios da UI (vitrine e Meus ingressos)
    const showcaseJs = await (await fetch(`${baseUrl}/views/showcase.js`)).text();
    assert.match(showcaseJs, /Ingressos esgotados/);
    assert.match(showcaseJs, /showcase-purchase-form/);

    const myTicketsJs = await (await fetch(`${baseUrl}/views/my-tickets.js`)).text();
    assert.match(myTicketsJs, /pendente/);
    assert.match(myTicketsJs, /confirmado/);
    assert.match(myTicketsJs, /recusado/);
    assert.match(myTicketsJs, /cancelado/);
    assert.match(myTicketsJs, /estornado/);

    const appJs = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(appJs, /renderMyTicketsView/);
  });
});
