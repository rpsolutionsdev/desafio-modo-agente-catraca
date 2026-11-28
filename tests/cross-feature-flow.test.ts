import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';

const rawBaseDbUrl =
  process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca';
const isolatedSchema = 'cross_feature_test';
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
const { stopCancellationReconciler } = await import('../src/modules/cancellation/service.js');

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

describe('Cross-Feature E2E — Jornada Integrada F01..F06 (E1 a E5, CF-01..CF-14, R01..R13)', () => {
  let server: http.Server;
  let baseUrl: string;
  let orgAToken: string;
  let orgBToken: string;
  let participantToken: string;

  let e1Id = '';
  let e2Id = '';
  let e3Id = '';
  let c1Showcase = { ticketId: '', code: '' };
  let c2Partner = { ticketId: '', code: '' };
  let c3OrgB = { ticketId: '', code: '' };
  let declinedE1Code = '';

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

  it('Etapa 1 (F01 -> F02 | E1 & E2): cadastro/sessão de participante, isolamento R13 entre organizadores, rascunho R01/R02 e publicação', async () => {
    // Cadastro, sessão, logout e re-login de novo participante (F01, CF-02)
    const email = `jornada.${Date.now()}@catraca.local`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Marina Participante',
        email,
        password: 'PartPassword@123',
      }),
    });
    assert.equal(regRes.status, 201);
    const regCookie = (regRes.headers.get('set-cookie') || '').split(';')[0] || '';
    assert.match(regCookie, /^catraca_session=.+/);

    const meBeforeLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: regCookie },
    });
    assert.equal(meBeforeLogout.status, 200);
    assert.equal((await meBeforeLogout.json()).user.email, email);

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: regCookie },
    });
    assert.equal(logoutRes.status, 200);
    const clearedCookie = (logoutRes.headers.get('set-cookie') || '').split(';')[0] || '';
    assert.equal(clearedCookie, 'catraca_session=');

    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: clearedCookie },
    });
    assert.equal(meAfterLogout.status, 401);

    participantToken = await loginUser(baseUrl, email, 'PartPassword@123');

    // API de Parceiros exige X-Api-Key válida (CF-01, CF-02)
    const partnerNoKey = await fetch(`${baseUrl}/api/partner/events`);
    assert.equal(partnerNoKey.status, 401);
    assert.deepEqual(await partnerNoKey.json(), { error: 'unauthorized' });

    // R01: data no passado é rejeitada na criação
    const pastRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Evento Passado Inválido',
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        location: 'Local Inválido',
        capacity: 5,
        priceCents: 5000,
      }),
    });
    assert.equal(pastRes.status, 422);

    // Organizador A cria E1 (lotação 2, R$ 100,00) -> nasce em draft (R02)
    const futureStartsAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    const createE1Res = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Jornada E1 — Show Principal',
        startsAt: futureStartsAt,
        location: 'Bar Catraca Centro',
        capacity: 2,
        priceCents: 10000,
      }),
    });
    assert.equal(createE1Res.status, 201);
    const e1Created = (await createE1Res.json()) as { id: string; status: string };
    assert.equal(e1Created.status, 'draft');
    e1Id = e1Created.id;

    // E1 em draft não aparece na vitrine nem em GET /api/partner/events e recusa compra (R02, CF-03)
    const showcaseWhileDraft = (await (await fetch(`${baseUrl}/api/events`)).json()) as Array<{
      id: string;
    }>;
    assert.equal(showcaseWhileDraft.some((ev) => ev.id === e1Id), false);

    const buyDraftRes = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'draft@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyDraftRes.status, 404);
    assert.deepEqual(await buyDraftRes.json(), { error: 'event_not_available' });

    // Organizador B cria e publica E2 (lotação 5, R$ 80,00)
    const createE2Res = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgBToken}`,
      },
      body: JSON.stringify({
        name: 'Jornada E2 — Workshop Org B',
        startsAt: futureStartsAt,
        location: 'Estúdio B',
        capacity: 5,
        priceCents: 8000,
      }),
    });
    assert.equal(createE2Res.status, 201);
    e2Id = ((await createE2Res.json()) as { id: string }).id;

    const pubE2Res = await fetch(`${baseUrl}/api/organizer/events/${e2Id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(pubE2Res.status, 200);

    // Isolamento R13 (CF-01): Org B não vê E1, Org A não vê E2, participante/visitante bloqueados
    const orgBList = (await (
      await fetch(`${baseUrl}/api/organizer/events`, {
        headers: { Authorization: `Bearer ${orgBToken}` },
      })
    ).json()) as Array<{ id: string }>;
    assert.deepEqual(
      orgBList.map((ev) => ev.id),
      [e2Id],
    );

    const orgBDirectE1 = await fetch(`${baseUrl}/api/organizer/events/${e1Id}`, {
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBDirectE1.status, 403);

    const partOrgAttempt = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    assert.equal(partOrgAttempt.status, 403);

    const anonOrgAttempt = await fetch(`${baseUrl}/api/organizer/events`);
    assert.equal(anonOrgAttempt.status, 401);

    // Organizador A publica E1 -> visível na vitrine e na API de parceiros
    const pubE1Res = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(pubE1Res.status, 200);

    const partnerEvents = (await (
      await fetch(`${baseUrl}/api/partner/events`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json()) as Array<{ id: string; availableSeats: number; priceCents: number }>;
    const e1InPartner = partnerEvents.find((ev) => ev.id === e1Id);
    assert.ok(e1InPartner);
    assert.equal(e1InPartner.availableSeats, 2);
    assert.equal(e1InPartner.priceCents, 10000);
  });

  it('Etapa 2 (F02 -> F03 -> F06 | E1): compras vitrine + parceiros, recusa devolvendo vaga, trava de lotação R03, preço histórico e painel R12', async () => {
    // 1. Participante compra C1 na vitrine (cartão 0001, R$ 100,00)
    const buyC1Res = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyC1Res.status, 202);
    c1Showcase = (await buyC1Res.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, c1Showcase.ticketId, 'confirmed');

    // 2. Parceiro compra em E1 com cartão lento recusado (0004)
    const buySlowDeclineRes = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'lento.recusado@parceiro.local',
        cardNumber: '4000000000000004',
      }),
    });
    assert.equal(buySlowDeclineRes.status, 202);
    const slowDecline = (await buySlowDeclineRes.json()) as { ticketId: string; code: string };
    declinedE1Code = slowDecline.code;

    // Enquanto pending: E1 fica esgotado (409 sold_out) e painel registra Pendentes: 1, Vagas: 0 (CF-12, R05, R07)
    const soldOutWhilePending = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(soldOutWhilePending.status, 409);
    assert.deepEqual(await soldOutWhilePending.json(), { error: 'sold_out' });

    const dashDuringPending = await (
      await fetch(`${baseUrl}/api/organizer/events/${e1Id}/dashboard`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      })
    ).json();
    assert.equal(dashDuringPending.confirmed, 1);
    assert.equal(dashDuringPending.pending, 1);
    assert.equal(dashDuringPending.availableSeats, 0);
    assert.equal(dashDuringPending.revenueFormatted, 'R$ 100,00');

    // Após recusa de 0004: vaga retorna para 1
    await waitForTicketStatus(baseUrl, slowDecline.ticketId, 'declined');

    // 3. Parceiro compra C2 em E1 (cartão 0001, R$ 100,00)
    const buyC2Res = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'aprovado.e1@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyC2Res.status, 202);
    c2Partner = (await buyC2Res.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, c2Partner.ticketId, 'confirmed');

    // 4. R03 / CF-03: reduzir lotação para 1 (abaixo das 2 ocupadas) falha com 409
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

    // Aumenta lotação para 3 e muda preço para R$ 150,00 (CF-11)
    const expandRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 3, priceCents: 15000 }),
    });
    assert.equal(expandRes.status, 200);

    // 5. 3ª compra em E1 sob o novo preço (R$ 150,00)
    const buyThirdRes = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyThirdRes.status, 202);
    const thirdTicket = (await buyThirdRes.json()) as { ticketId: string };
    await waitForTicketStatus(baseUrl, thirdTicket.ticketId, 'confirmed');

    // Painel consolida 2x R$ 100 + 1x R$ 150 = R$ 350,00 (CF-11, CF-12, R12)
    const dashE1 = await (
      await fetch(`${baseUrl}/api/organizer/events/${e1Id}/dashboard`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      })
    ).json();
    assert.deepEqual(dashE1, {
      eventId: e1Id,
      status: 'published',
      confirmed: 3,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 35000,
      revenueFormatted: 'R$ 350,00',
      refunded: 0,
    });
  });

  it('Etapa 3 (F04 -> F06 | E1 & E2): árvore de prioridade de check-in R10, isolamento CF-04/CF-10 e reflexo em Check-ins sem alterar Confirmados (CF-13)', async () => {
    // Emite C3 confirmado no evento E2 do Organizador B
    const buyC3Res = await fetch(`${baseUrl}/api/partner/events/${e2Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'c3.e2@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyC3Res.status, 202);
    c3OrgB = (await buyC3Res.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, c3OrgB.ticketId, 'confirmed');

    // CF-04 & CF-10 (R13): Organizador B recebe 403 em check-in e painel de E1
    const orgBCheckinE1 = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgBToken}`,
      },
      body: JSON.stringify({ code: c1Showcase.code }),
    });
    assert.equal(orgBCheckinE1.status, 403);

    const orgBDashE1 = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/dashboard`, {
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBDashE1.status, 403);

    // CF-05 (R10 regra 1): C3 (de E2) submetido em E1 -> "Ingresso inválido para este evento"
    const crossEventCheckin = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c3OrgB.code }),
    });
    assert.equal(crossEventCheckin.status, 422);
    assert.equal((await crossEventCheckin.json()).message, 'Ingresso inválido para este evento');

    // CF-06 (R10 regra 3): ingresso recusado -> "Ingresso não confirmado"
    const declinedCheckin = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: declinedE1Code }),
    });
    assert.equal(declinedCheckin.status, 422);
    assert.equal((await declinedCheckin.json()).message, 'Ingresso não confirmado');

    // CF-06 (R10 regras 5 e 4): 1ª leitura de C1 -> "Entrada liberada", 2ª -> "Ingresso já utilizado"
    const firstC1 = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c1Showcase.code }),
    });
    assert.equal(firstC1.status, 200);
    assert.equal((await firstC1.json()).message, 'Entrada liberada');

    const secondC1 = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c1Showcase.code }),
    });
    assert.equal(secondC1.status, 422);
    assert.equal((await secondC1.json()).message, 'Ingresso já utilizado');

    // GET /api/partner/tickets/:id reflete checkedIn: true mantendo status: "confirmed" (CF-06)
    const c1PartnerLookup = await (
      await fetch(`${baseUrl}/api/partner/tickets/${c1Showcase.ticketId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    assert.equal(c1PartnerLookup.status, 'confirmed');
    assert.equal(c1PartnerLookup.checkedIn, true);

    // CF-13: Painel de E1 reflete Check-ins = 1 mantendo Confirmados = 3 e Receita = R$ 350,00
    const dashAfterCheckin = await (
      await fetch(`${baseUrl}/api/organizer/events/${e1Id}/dashboard`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      })
    ).json();
    assert.equal(dashAfterCheckin.confirmed, 3);
    assert.equal(dashAfterCheckin.checkIns, 1);
    assert.equal(dashAfterCheckin.revenueFormatted, 'R$ 350,00');
  });

  it('Etapa 4 (F05 -> F04 -> F06 | E3): cancelamento irreversível R11, estorno <10s, gateway tardio 0003 ignorado, check-in pós-cancelamento e painel zerado (CF-07..CF-09, CF-14)', async () => {
    const startsAt = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000).toISOString();
    const createE3Res = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Jornada E3 — Show que será Cancelado',
        startsAt,
        location: 'Galpão Catraca',
        capacity: 5,
        priceCents: 5000,
      }),
    });
    assert.equal(createE3Res.status, 201);
    e3Id = ((await createE3Res.json()) as { id: string }).id;

    await fetch(`${baseUrl}/api/organizer/events/${e3Id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });

    // C6 confirmado na vitrine (com check-in prévio antes do cancelamento)
    const buyC6Res = await fetch(`${baseUrl}/api/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyC6Res.status, 202);
    const c6 = (await buyC6Res.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, c6.ticketId, 'confirmed');

    const c6PreCheckin = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c6.code }),
    });
    assert.equal(c6PreCheckin.status, 200);

    // Ingresso lento T_slow com cartão 0003 (aprovaria entre 30s e 40s)
    const slowStartedAt = Date.now();
    const buySlow0003Res = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'tardio.0003@parceiro.local',
        cardNumber: '4000000000000003',
      }),
    });
    assert.equal(buySlow0003Res.status, 202);
    const slow0003 = (await buySlow0003Res.json()) as { ticketId: string; code: string };

    // CF-07: Organizador B não pode cancelar E3
    const orgBCancelAttempt = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBCancelAttempt.status, 403);

    // Organizador A cancela E3
    const cancelRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(await cancelRes.json(), {
      id: e3Id,
      status: 'cancelled',
      availableSeats: 0,
    });

    // CF-08 & CF-09: E3 sai imediatamente da vitrine e de parceiros e recusa novas compras/edição/republicação
    const showcaseAfterCancel = (await (await fetch(`${baseUrl}/api/events`)).json()) as Array<{
      id: string;
    }>;
    assert.equal(showcaseAfterCancel.some((ev) => ev.id === e3Id), false);

    const buyAfterCancel = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'pos.cancel@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyAfterCancel.status, 404);
    assert.deepEqual(await buyAfterCancel.json(), { error: 'event_not_available' });

    const editAfterCancel = await fetch(`${baseUrl}/api/organizer/events/${e3Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 10 }),
    });
    assert.equal(editAfterCancel.status, 409);

    // Em < 10s: C6 -> refunded (estornado) e slow0003 -> cancelled (cancelado)
    await waitForTicketStatus(baseUrl, c6.ticketId, 'refunded', 4000);
    await waitForTicketStatus(baseUrl, slow0003.ticketId, 'cancelled', 4000);

    // Verifica rótulo "estornado" em "Meus ingressos" (R09 + R11)
    const myTickets = (await (
      await fetch(`${baseUrl}/api/my-tickets`, {
        headers: { Authorization: `Bearer ${participantToken}` },
      })
    ).json()) as Array<{ ticketId: string; status: string; statusLabel: string }>;
    const myC6 = myTickets.find((t) => t.ticketId === c6.ticketId);
    assert.ok(myC6);
    assert.equal(myC6.status, 'refunded');
    assert.equal(myC6.statusLabel, 'estornado');

    // R10 + CF-14: em E3 cancelado, C3 (outro evento) retorna regra 1 e C6 (de E3) retorna regra 2 ("Evento cancelado")
    const outsiderOnCancelled = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c3OrgB.code }),
    });
    assert.equal(outsiderOnCancelled.status, 422);
    assert.equal((await outsiderOnCancelled.json()).message, 'Ingresso inválido para este evento');

    const c6OnCancelled = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c6.code }),
    });
    assert.equal(c6OnCancelled.status, 422);
    assert.equal((await c6OnCancelled.json()).message, 'Evento cancelado');

    // Aguarda retorno tardio do cartão 0003 e garante que não sobrescreveu cancelled (CF-09)
    const waitMs = Math.ceil(42000 * config.gatewayDelayMultiplier) + 250;
    const elapsed = Date.now() - slowStartedAt;
    if (elapsed < waitMs) {
      await sleep(waitMs - elapsed);
    }

    const slow0003After = await (
      await fetch(`${baseUrl}/api/partner/tickets/${slow0003.ticketId}`, {
        headers: { 'X-Api-Key': config.partnerApiKey },
      })
    ).json();
    assert.equal(slow0003After.status, 'cancelled');

    // CF-14 & R12: Painel de E3 zera Confirmados, Pendentes, Check-ins, Vagas e Receita e contabiliza Estornados = 1
    const dashE3 = await (
      await fetch(`${baseUrl}/api/organizer/events/${e3Id}/dashboard`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      })
    ).json();
    assert.deepEqual(dashE3, {
      eventId: e3Id,
      status: 'cancelled',
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 0,
      revenueFormatted: 'R$ 0,00',
      refunded: 1,
    });
  });

  it('Etapa 5 (F03 -> F06 | E4 & E5): 30 compras concorrentes em duas rodadas independentes (5x 202 + 25x 409) consolidadas com exatidão no painel (R07, R12)', async () => {
    const startsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

    for (const round of [
      {
        name: 'Jornada E4 — Concorrência Parceiros',
        priceCents: 12000,
        expectedRevenue: 'R$ 600,00',
        expectedRevenueCents: 60000,
        mixedChannels: false,
      },
      {
        name: 'Jornada E5 — Concorrência Mista Vitrine + Parceiros',
        priceCents: 8000,
        expectedRevenue: 'R$ 400,00',
        expectedRevenueCents: 40000,
        mixedChannels: true,
      },
    ]) {
      const createRes = await fetch(`${baseUrl}/api/organizer/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAToken}`,
        },
        body: JSON.stringify({
          name: round.name,
          startsAt,
          location: 'Arena Concorrência',
          capacity: 5,
          priceCents: round.priceCents,
        }),
      });
      assert.equal(createRes.status, 201);
      const ev = (await createRes.json()) as { id: string };

      await fetch(`${baseUrl}/api/organizer/events/${ev.id}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAToken}` },
      });

      const burst = Array.from({ length: 30 }, (_, idx) => {
        const useShowcase = round.mixedChannels && idx % 2 === 0;
        if (useShowcase) {
          return fetch(`${baseUrl}/api/events/${ev.id}/purchases`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${participantToken}`,
            },
            body: JSON.stringify({ cardNumber: '4000000000000001' }),
          }).then(async (res) => ({
            status: res.status,
            body: (await res.json()) as Record<string, unknown>,
          }));
        }

        return fetch(`${baseUrl}/api/partner/events/${ev.id}/purchases`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.partnerApiKey,
          },
          body: JSON.stringify({
            buyerEmail: `burst.${idx}@parceiro.local`,
            cardNumber: '4000000000000001',
          }),
        }).then(async (res) => ({
          status: res.status,
          body: (await res.json()) as Record<string, unknown>,
        }));
      });

      const results = await Promise.all(burst);
      const accepted = results.filter((r) => r.status === 202);
      const soldOut = results.filter((r) => r.status === 409);

      assert.equal(accepted.length, 5, `[${round.name}] Esperava 5 respostas 202`);
      assert.equal(soldOut.length, 25, `[${round.name}] Esperava 25 respostas 409`);
      for (const rej of soldOut) {
        assert.deepEqual(rej.body, { error: 'sold_out' });
      }

      await Promise.all(
        accepted.map((a) => waitForTicketStatus(baseUrl, String(a.body.ticketId), 'confirmed')),
      );

      const dashRes = await fetch(`${baseUrl}/api/organizer/events/${ev.id}/dashboard`, {
        headers: { Authorization: `Bearer ${orgAToken}` },
      });
      assert.equal(dashRes.status, 200);
      assert.deepEqual(await dashRes.json(), {
        eventId: ev.id,
        status: 'published',
        confirmed: 5,
        pending: 0,
        checkIns: 0,
        availableSeats: 0,
        revenueCents: round.expectedRevenueCents,
        revenueFormatted: round.expectedRevenue,
        refunded: 0,
      });
    }
  });
});
