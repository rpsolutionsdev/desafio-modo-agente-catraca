import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';

const rawBaseDbUrl =
  process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca';
const isolatedSchema = 'f04_test';
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
const { CHECKIN_MESSAGES } = await import('../src/modules/checkin/service.js');
const { renderCheckinWidget } = await import('../src/web/views/checkin-widget.js');

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

async function loginUser(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  const rawSetCookie = res.headers.get('set-cookie') || '';
  const cookie = rawSetCookie.split(';')[0] || '';
  const body = (await res.json()) as { token: string };
  assert.ok(body.token);
  return { token: body.token, cookie };
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
      location: 'Espaço Catraca Check-in',
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

describe('F04 — Operação de Check-in do Evento', () => {
  let server: http.Server;
  let baseUrl: string;
  let orgAToken: string;
  let orgACookie: string;
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

    const orgA = await loginUser(baseUrl, 'org.a@catraca.local', 'OrgA@123');
    orgAToken = orgA.token;
    orgACookie = orgA.cookie;

    const orgB = await loginUser(baseUrl, 'org.b@catraca.local', 'OrgB@123');
    orgBToken = orgB.token;

    const part = await loginUser(baseUrl, 'participante@catraca.local', 'Part@123');
    participantToken = part.token;
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

  it('valida catálogo literal das 5 mensagens de R10', () => {
    assert.deepEqual(CHECKIN_MESSAGES, {
      invalid_ticket: 'Ingresso inválido para este evento',
      event_cancelled: 'Evento cancelado',
      not_confirmed: 'Ingresso não confirmado',
      already_used: 'Ingresso já utilizado',
      valid: 'Entrada liberada',
    });
  });

  it('CT-F04-01 & CT-F04-02 (R10, CF-06): aprova 1ª leitura de ingresso confirmado (vitrine e parceiro), rejeita 2ª leitura, rejeita pendente/recusado e código inexistente, e reflete checkedIn=true sem alterar status', async () => {
    const e1 = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Show Check-in E1',
      capacity: 10,
      priceCents: 9000,
    });

    // 1. Compra na vitrine com cartão rápido aprovado (0001 -> confirmed)
    const buyShowcaseRes = await fetch(`${baseUrl}/api/events/${e1.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyShowcaseRes.status, 202);
    const c1Showcase = (await buyShowcaseRes.json()) as { ticketId: string; code: string };

    // 2. Compra via API de Parceiros com cartão rápido aprovado (0001 -> confirmed)
    const buyPartnerRes = await fetch(`${baseUrl}/api/partner/events/${e1.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'f04.parceiro@catraca.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyPartnerRes.status, 202);
    const c1Partner = (await buyPartnerRes.json()) as { ticketId: string; code: string };

    // 3. Compra recusada (0002 -> declined)
    const buyDeclinedRes = await fetch(`${baseUrl}/api/partner/events/${e1.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'f04.recusado@catraca.local',
        cardNumber: '4000000000000002',
      }),
    });
    assert.equal(buyDeclinedRes.status, 202);
    const c2Declined = (await buyDeclinedRes.json()) as { ticketId: string; code: string };

    // 4. Compra lenta (0004 -> permanece pending durante a checagem imediata)
    const buyPendingRes = await fetch(`${baseUrl}/api/events/${e1.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000004' }),
    });
    assert.equal(buyPendingRes.status, 202);
    const c2Pending = (await buyPendingRes.json()) as { ticketId: string; code: string };

    // Check-in de ingresso ainda pendente -> 422 "Ingresso não confirmado"
    const pendingCheckinRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c2Pending.code }),
    });
    assert.equal(pendingCheckinRes.status, 422);
    assert.deepEqual(await pendingCheckinRes.json(), {
      allowed: false,
      code: 'not_confirmed',
      message: 'Ingresso não confirmado',
    });

    await waitForTicketStatus(baseUrl, c1Showcase.ticketId, 'confirmed');
    await waitForTicketStatus(baseUrl, c1Partner.ticketId, 'confirmed');
    await waitForTicketStatus(baseUrl, c2Declined.ticketId, 'declined');

    // (a) Ingresso confirmado da vitrine na 1ª vez -> 200 "Entrada liberada"
    const firstShowcaseCheckin = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: `  ${c1Showcase.code}  ` }),
    });
    assert.equal(firstShowcaseCheckin.status, 200);
    assert.deepEqual(await firstShowcaseCheckin.json(), {
      allowed: true,
      code: 'valid',
      message: 'Entrada liberada',
      ticketId: c1Showcase.ticketId,
    });

    const firstCheckinRow = await pool.query<{
      status: string;
      checked_in: boolean;
      checked_in_at: Date | null;
    }>('SELECT status, checked_in, checked_in_at FROM tickets WHERE id = $1', [
      c1Showcase.ticketId,
    ]);
    assert.equal(firstCheckinRow.rows[0]?.status, 'confirmed');
    assert.equal(firstCheckinRow.rows[0]?.checked_in, true);
    assert.ok(firstCheckinRow.rows[0]?.checked_in_at instanceof Date);
    const originalCheckedInAt = firstCheckinRow.rows[0]!.checked_in_at!.toISOString();

    // (b) Mesmo ingresso confirmado na 2ª vez -> 422 "Ingresso já utilizado" (preservando checked_in_at)
    const secondShowcaseCheckin = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c1Showcase.code }),
    });
    assert.equal(secondShowcaseCheckin.status, 422);
    assert.deepEqual(await secondShowcaseCheckin.json(), {
      allowed: false,
      code: 'already_used',
      message: 'Ingresso já utilizado',
    });

    const afterSecondRow = await pool.query<{ checked_in_at: Date }>(
      'SELECT checked_in_at FROM tickets WHERE id = $1',
      [c1Showcase.ticketId],
    );
    assert.equal(afterSecondRow.rows[0]?.checked_in_at.toISOString(), originalCheckedInAt);

    // Check-in de ingresso comprado via API de Parceiros: 1ª vez -> 200, 2ª vez -> 422
    const firstPartnerCheckin = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c1Partner.code }),
    });
    assert.equal(firstPartnerCheckin.status, 200);
    assert.deepEqual(await firstPartnerCheckin.json(), {
      allowed: true,
      code: 'valid',
      message: 'Entrada liberada',
      ticketId: c1Partner.ticketId,
    });

    const secondPartnerCheckin = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c1Partner.code }),
    });
    assert.equal(secondPartnerCheckin.status, 422);
    assert.deepEqual(await secondPartnerCheckin.json(), {
      allowed: false,
      code: 'already_used',
      message: 'Ingresso já utilizado',
    });

    // CT-F04-02 (CF-06): GET /api/partner/tickets/:ticketId retorna status "confirmed" e checkedIn: true em ambos os canais
    for (const expected of [c1Showcase, c1Partner]) {
      const partnerTicketRes = await fetch(`${baseUrl}/api/partner/tickets/${expected.ticketId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      });
      assert.equal(partnerTicketRes.status, 200);
      assert.deepEqual(await partnerTicketRes.json(), {
        ticketId: expected.ticketId,
        code: expected.code,
        eventId: e1.id,
        status: 'confirmed',
        checkedIn: true,
      });
    }

    // Também verifica em GET /api/my-tickets que o status segue "confirmed" ("confirmado") com checkedIn: true
    const myTicketsRes = await fetch(`${baseUrl}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    assert.equal(myTicketsRes.status, 200);
    const myTickets = (await myTicketsRes.json()) as Array<{
      ticketId: string;
      status: string;
      statusLabel: string;
      checkedIn: boolean;
    }>;
    const checkedShowcaseInList = myTickets.find((t) => t.ticketId === c1Showcase.ticketId);
    assert.ok(checkedShowcaseInList);
    assert.equal(checkedShowcaseInList.status, 'confirmed');
    assert.equal(checkedShowcaseInList.statusLabel, 'confirmado');
    assert.equal(checkedShowcaseInList.checkedIn, true);

    // (c) Ingresso recusado -> 422 "Ingresso não confirmado"
    const declinedCheckinRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c2Declined.code }),
    });
    assert.equal(declinedCheckinRes.status, 422);
    assert.deepEqual(await declinedCheckinRes.json(), {
      allowed: false,
      code: 'not_confirmed',
      message: 'Ingresso não confirmado',
    });

    // (d) Código inexistente ZZZZZZZZ ou vazio -> 422 "Ingresso inválido para este evento"
    for (const invalidPayload of [{ code: 'ZZZZZZZZ' }, { code: '' }, { code: '   ' }, {}]) {
      const invalidCheckinRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAToken}`,
        },
        body: JSON.stringify(invalidPayload),
      });
      assert.equal(invalidCheckinRes.status, 422);
      assert.deepEqual(await invalidCheckinRes.json(), {
        allowed: false,
        code: 'invalid_ticket',
        message: 'Ingresso inválido para este evento',
      });
    }

    // Aguarda resolução do cartão lento 0004 para não deixar timer pendente
    await waitForTicketStatus(baseUrl, c2Pending.ticketId, 'declined');
  });

  it('CT-F04-03 (R10, CF-05): respeita rigorosamente a precedência das regras 1 -> 2 -> 3 -> 4 (outro evento, evento cancelado e status)', async () => {
    const e1OrgA = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento E1 Org A',
      capacity: 10,
      priceCents: 5000,
    });

    const e2OrgB = await createAndPublishEvent(baseUrl, orgBToken, {
      name: 'Evento E2 Org B',
      capacity: 10,
      priceCents: 5000,
    });

    const e3OrgA = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento E3 Org A (será cancelado)',
      capacity: 10,
      priceCents: 5000,
    });

    // Emite ingresso válido C3 em E2 do Organizador B
    const buyC3Res = await fetch(`${baseUrl}/api/partner/events/${e2OrgB.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'c3.orgb@catraca.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyC3Res.status, 202);
    const c3 = (await buyC3Res.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, c3.ticketId, 'confirmed');

    // CF-05: Submeter C3 (evento E2) no check-in de E1 retorna "Ingresso inválido para este evento"
    const crossEventRes = await fetch(`${baseUrl}/api/organizer/events/${e1OrgA.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c3.code }),
    });
    assert.equal(crossEventRes.status, 422);
    assert.deepEqual(await crossEventRes.json(), {
      allowed: false,
      code: 'invalid_ticket',
      message: 'Ingresso inválido para este evento',
    });

    // C3 permanece intocado (checkedIn: false) em E2
    const c3AfterCross = await (
      await fetch(`${baseUrl}/api/partner/tickets/${c3.ticketId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    assert.equal((c3AfterCross as { checkedIn: boolean }).checkedIn, false);

    // Prepara ingressos em E3 antes de cancelar E3:
    // - tConfirmed: confirmado sem check-in
    // - tUsed: confirmado já com check-in feito antes do cancelamento
    // - tRefunded: estornado (status = 'refunded', checked_in = true)
    // - tDeclined: recusado (status = 'declined')
    const buyTConf = await (
      await fetch(`${baseUrl}/api/partner/events/${e3OrgA.id}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
        body: JSON.stringify({ buyerEmail: 'tconf@catraca.local', cardNumber: '4000000000000001' }),
      })
    ).json();
    const buyTUsed = await (
      await fetch(`${baseUrl}/api/partner/events/${e3OrgA.id}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
        body: JSON.stringify({ buyerEmail: 'tused@catraca.local', cardNumber: '4000000000000001' }),
      })
    ).json();
    const buyTRef = await (
      await fetch(`${baseUrl}/api/partner/events/${e3OrgA.id}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
        body: JSON.stringify({ buyerEmail: 'tref@catraca.local', cardNumber: '4000000000000001' }),
      })
    ).json();
    const buyTDecl = await (
      await fetch(`${baseUrl}/api/partner/events/${e3OrgA.id}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
        body: JSON.stringify({ buyerEmail: 'tdecl@catraca.local', cardNumber: '4000000000000002' }),
      })
    ).json();

    await waitForTicketStatus(baseUrl, buyTConf.ticketId, 'confirmed');
    await waitForTicketStatus(baseUrl, buyTUsed.ticketId, 'confirmed');
    await waitForTicketStatus(baseUrl, buyTRef.ticketId, 'confirmed');
    await waitForTicketStatus(baseUrl, buyTDecl.ticketId, 'declined');

    // Faz check-in em buyTUsed e buyTRef enquanto E3 ainda está published
    const preCheckUsed = await fetch(`${baseUrl}/api/organizer/events/${e3OrgA.id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
      body: JSON.stringify({ code: buyTUsed.code }),
    });
    assert.equal(preCheckUsed.status, 200);

    const preCheckRef = await fetch(`${baseUrl}/api/organizer/events/${e3OrgA.id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
      body: JSON.stringify({ code: buyTRef.code }),
    });
    assert.equal(preCheckRef.status, 200);

    // Em evento publicado, um ingresso refunded (mesmo com checked_in = true) cai na regra 3 ("Ingresso não confirmado") antes da regra 4
    await pool.query("UPDATE tickets SET status = 'refunded' WHERE id = $1", [buyTRef.ticketId]);
    const rule3Before4Res = await fetch(`${baseUrl}/api/organizer/events/${e3OrgA.id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
      body: JSON.stringify({ code: buyTRef.code }),
    });
    assert.equal(rule3Before4Res.status, 422);
    assert.deepEqual(await rule3Before4Res.json(), {
      allowed: false,
      code: 'not_confirmed',
      message: 'Ingresso não confirmado',
    });

    // Agora cancela E3
    await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [
      e3OrgA.id,
    ]);

    // Regra 1 ANTES da Regra 2 em evento cancelado: ZZZZZZZZ e C3 (outro evento) devem retornar "Ingresso inválido para este evento"
    for (const outsiderCode of ['ZZZZZZZZ', c3.code]) {
      const res = await fetch(`${baseUrl}/api/organizer/events/${e3OrgA.id}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
        body: JSON.stringify({ code: outsiderCode }),
      });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), {
        allowed: false,
        code: 'invalid_ticket',
        message: 'Ingresso inválido para este evento',
      });
    }

    // Regra 2 ANTES das Regras 3 e 4 em evento cancelado: qualquer ingresso pertencente a E3 retorna "Evento cancelado"
    for (const ownTicket of [buyTConf, buyTUsed, buyTRef, buyTDecl]) {
      const res = await fetch(`${baseUrl}/api/organizer/events/${e3OrgA.id}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
        body: JSON.stringify({ code: ownTicket.code }),
      });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), {
        allowed: false,
        code: 'event_cancelled',
        message: 'Evento cancelado',
      });
    }
  });

  it('CT-F04-04 (R13, CF-04) & Concorrência: bloqueia visitante (401), participante (403) e outro organizador (403), retorna 404 para evento inexistente e garante check-in único sob concorrência', async () => {
    const e1 = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento Isolamento e Concorrência F04',
      capacity: 5,
      priceCents: 7500,
    });

    const buyRes = await fetch(`${baseUrl}/api/partner/events/${e1.id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'seguranca@catraca.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyRes.status, 202);
    const ticket = (await buyRes.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, ticket.ticketId, 'confirmed');

    // 1. Visitante sem autenticação -> 401 {"error":"unauthenticated"}
    const anonRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ticket.code }),
    });
    assert.equal(anonRes.status, 401);
    assert.deepEqual(await anonRes.json(), { error: 'unauthenticated' });

    // 2. Participante autenticado -> 403 {"error":"forbidden"}
    const partRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ code: ticket.code }),
    });
    assert.equal(partRes.status, 403);
    assert.deepEqual(await partRes.json(), { error: 'forbidden' });

    // 3. Organizador B tentando fazer check-in no evento E1 do Organizador A -> 403 {"error":"forbidden"}
    const orgBRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgBToken}`,
      },
      body: JSON.stringify({ code: ticket.code }),
    });
    assert.equal(orgBRes.status, 403);
    assert.deepEqual(await orgBRes.json(), { error: 'forbidden' });

    // Confirma que nenhuma das tentativas negadas realizou o check-in
    const untouchedRes = await fetch(`${baseUrl}/api/partner/tickets/${ticket.ticketId}`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    const untouched = (await untouchedRes.json()) as { checkedIn: boolean };
    assert.equal(untouched.checkedIn, false);

    // 4. Evento inexistente -> 404 {"error":"not_found"}
    const missingEventRes = await fetch(
      `${baseUrl}/api/organizer/events/evt_inexistente_f04/checkin`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAToken}`,
        },
        body: JSON.stringify({ code: ticket.code }),
      },
    );
    assert.equal(missingEventRes.status, 404);
    assert.deepEqual(await missingEventRes.json(), { error: 'not_found' });

    // 5. Concorrência: 12 requisições simultâneas com o mesmo código válido -> exatamente 1x 200 ("Entrada liberada") e 11x 422 ("Ingresso já utilizado")
    const burst = Array.from({ length: 12 }, () =>
      fetch(`${baseUrl}/api/organizer/events/${e1.id}/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAToken}`,
        },
        body: JSON.stringify({ code: ticket.code }),
      }).then(async (res) => ({
        status: res.status,
        body: (await res.json()) as Record<string, unknown>,
      })),
    );

    const results = await Promise.all(burst);
    const allowed = results.filter((r) => r.status === 200);
    const alreadyUsed = results.filter((r) => r.status === 422);

    assert.equal(allowed.length, 1);
    assert.deepEqual(allowed[0].body, {
      allowed: true,
      code: 'valid',
      message: 'Entrada liberada',
      ticketId: ticket.ticketId,
    });

    assert.equal(alreadyUsed.length, 11);
    for (const rej of alreadyUsed) {
      assert.deepEqual(rej.body, {
        allowed: false,
        code: 'already_used',
        message: 'Ingresso já utilizado',
      });
    }
  });

  it('integra widget de check-in (checkin-widget.js) na página de gestão (organizer-event.js), mantendo controles habilitados inclusive em evento cancelado', async () => {
    // Verifica que os módulos frontend estão servidos e integrados em #event-checkin-slot
    const organizerEventJsRes = await fetch(`${baseUrl}/views/organizer-event.js`);
    assert.equal(organizerEventJsRes.status, 200);
    const organizerEventJs = await organizerEventJsRes.text();
    assert.match(organizerEventJs, /renderCheckinWidget/);
    assert.match(organizerEventJs, /#event-checkin-slot/);

    const widgetJsRes = await fetch(`${baseUrl}/views/checkin-widget.js`);
    assert.equal(widgetJsRes.status, 200);
    const widgetJs = await widgetJsRes.text();
    assert.match(widgetJs, /checkin-form/);
    assert.match(widgetJs, /checkin-code-input/);
    assert.match(widgetJs, /checkin-feedback/);

    // Exercita renderCheckinWidget diretamente contra o servidor HTTP real (ativo e cancelado)
    const ev = await createAndPublishEvent(baseUrl, orgAToken, {
      name: 'Evento UI Widget Check-in',
      capacity: 5,
      priceCents: 6000,
    });

    const buyRes = await fetch(`${baseUrl}/api/partner/events/${ev.id}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
      body: JSON.stringify({
        buyerEmail: 'widget@catraca.local',
        cardNumber: '4000000000000001',
      }),
    });
    const uiTicket = (await buyRes.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, uiTicket.ticketId, 'confirmed');

    // Stub DOM enxuto para exercitar submissões reais do widget
    let submitHandler: ((ev: { preventDefault: () => void }) => Promise<void>) | null = null;
    const codeInputStub = { value: '', disabled: false };
    const submitBtnStub = { disabled: false };
    const feedbackStub = {
      textContent: '',
      className: 'alert',
      hidden: true,
      dataset: {} as Record<string, string>,
    };
    const formStub = {
      addEventListener: (type: string, fn: (ev: { preventDefault: () => void }) => Promise<void>) => {
        if (type === 'submit') submitHandler = fn;
      },
    };
    const slotStub = {
      innerHTML: '',
      contains: () => true,
      querySelector: (sel: string) => {
        if (sel === '#checkin-form') return formStub;
        if (sel === '#checkin-code-input') return codeInputStub;
        if (sel === '#checkin-submit-btn') return submitBtnStub;
        if (sel === '#checkin-feedback') return feedbackStub;
        return null;
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has('Cookie') && !headers.has('Authorization')) {
        headers.set('Cookie', orgACookie);
      }
      return originalFetch(input, { ...init, headers });
    }) as typeof fetch;

    try {
      const successCalls: Array<unknown> = [];
      renderCheckinWidget(slotStub as unknown as HTMLElement, {
        eventId: ev.id,
        apiBaseUrl: baseUrl,
        onCheckinSuccess: (res: unknown) => {
          successCalls.push(res);
        },
      });

      assert.ok(!slotStub.innerHTML.includes('disabled'), 'Formulário de check-in deve nascer habilitado');
      assert.ok(submitHandler, 'Deve registrar listener de submit no formulário');

      // 1ª submissão válida -> "Entrada liberada" + limpa campo + dispara onCheckinSuccess
      codeInputStub.value = uiTicket.code;
      await submitHandler!({ preventDefault: () => {} });
      assert.equal(feedbackStub.hidden, false);
      assert.equal(feedbackStub.textContent, 'Entrada liberada');
      assert.equal(feedbackStub.className, 'alert success');
      assert.equal(codeInputStub.value, '');
      assert.equal(successCalls.length, 1);
      assert.equal(submitBtnStub.disabled, false);

      // 2ª submissão do mesmo código -> "Ingresso já utilizado"
      codeInputStub.value = uiTicket.code;
      await submitHandler!({ preventDefault: () => {} });
      assert.equal(feedbackStub.textContent, 'Ingresso já utilizado');
      assert.equal(feedbackStub.className, 'alert error');
      assert.equal(successCalls.length, 1);

      // Após cancelamento do evento, o widget permanece habilitado e exibe a ordem estrita de R10
      await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [
        ev.id,
      ]);

      renderCheckinWidget(slotStub as unknown as HTMLElement, {
        eventId: ev.id,
        apiBaseUrl: baseUrl,
      });
      assert.ok(
        !slotStub.innerHTML.includes('disabled'),
        'Formulário de check-in permanece habilitado mesmo em evento cancelado',
      );

      // Código inexistente em evento cancelado -> "Ingresso inválido para este evento" (prioridade 1 > 2)
      codeInputStub.value = 'ZZZZZZZZ';
      await submitHandler!({ preventDefault: () => {} });
      assert.equal(feedbackStub.textContent, 'Ingresso inválido para este evento');

      // Código do próprio evento cancelado -> "Evento cancelado" (prioridade 2)
      codeInputStub.value = uiTicket.code;
      await submitHandler!({ preventDefault: () => {} });
      assert.equal(feedbackStub.textContent, 'Evento cancelado');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
