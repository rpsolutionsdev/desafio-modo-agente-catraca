import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';

const rawBaseDbUrl =
  process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca';
const isolatedSchema = 'f06_test';
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
const { formatRevenueBRL } = await import('../src/modules/dashboard/service.js');
const { renderDashboardWidget } = await import('../src/web/views/dashboard-widget.js');
const { renderOrganizerEventView } = await import('../src/web/views/organizer-event.js');

interface DashboardResponse {
  eventId: string;
  status: 'draft' | 'published' | 'cancelled';
  confirmed: number;
  pending: number;
  checkIns: number;
  availableSeats: number;
  revenueCents: number;
  revenueFormatted: string;
  refunded: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginUser(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{
  token: string;
  cookie: string;
  user: { id: string; name: string; email: string; role: string };
}> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  const rawSetCookie = res.headers.get('set-cookie') || '';
  const cookie = rawSetCookie.split(';')[0] || '';
  const body = (await res.json()) as {
    token: string;
    user: { id: string; name: string; email: string; role: string };
  };
  assert.ok(body.token);
  return { token: body.token, cookie, user: body.user };
}

async function createEvent(
  baseUrl: string,
  orgToken: string,
  params: { name: string; capacity: number; priceCents: number },
): Promise<{ id: string; name: string; status: string; capacity: number; priceCents: number }> {
  const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${baseUrl}/api/organizer/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgToken}`,
    },
    body: JSON.stringify({
      name: params.name,
      startsAt,
      location: 'Auditório Catraca F06',
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

async function fetchDashboard(
  baseUrl: string,
  orgToken: string,
  eventId: string,
): Promise<DashboardResponse> {
  const res = await fetch(`${baseUrl}/api/organizer/events/${eventId}/dashboard`, {
    headers: { Authorization: `Bearer ${orgToken}` },
  });
  assert.equal(res.status, 200);
  return (await res.json()) as DashboardResponse;
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

describe('F06 — Painel Operacional e Financeiro do Evento', () => {
  let server: http.Server;
  let baseUrl: string;
  let orgAToken: string;
  let orgACookie: string;
  let orgBToken: string;
  let orgBCookie: string;
  let orgBUser: { id: string; name: string; email: string; role: string };
  let participantToken: string;
  let participantCookie: string;
  let participantUser: { id: string; name: string; email: string; role: string };

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
    orgBCookie = orgB.cookie;
    orgBUser = orgB.user;

    const part = await loginUser(baseUrl, 'participante@catraca.local', 'Part@123');
    participantToken = part.token;
    participantCookie = part.cookie;
    participantUser = part.user;
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

  it('formata valores em reais deterministicamente com espaço ASCII comum (U+0020)', () => {
    assert.equal(formatRevenueBRL(0), 'R$ 0,00');
    assert.equal(formatRevenueBRL(5000), 'R$ 50,00');
    assert.equal(formatRevenueBRL(35000), 'R$ 350,00');
    assert.equal(formatRevenueBRL(125050), 'R$ 1.250,50');
    assert.equal(formatRevenueBRL(123456789), 'R$ 1.234.567,89');
    assert.equal(formatRevenueBRL(35000).charCodeAt(2), 0x20);
  });

  let e1Id = '';
  let c1ShowcaseCode = '';
  let e3Id = '';

  it('CT-F06-01 (CA-F06-01, R12, R03, R05, CF-11, CF-12): consolida vitrine + API de parceiros, pendentes/recusados, mudança de lotação e receita histórica', async () => {
    const e1 = await createEvent(baseUrl, orgAToken, {
      name: 'Show Painel E1',
      capacity: 2,
      priceCents: 10000,
    });
    e1Id = e1.id;

    // Painel em estado inicial (draft, sem vendas)
    const draftDash = await fetchDashboard(baseUrl, orgAToken, e1Id);
    assert.deepEqual(draftDash, {
      eventId: e1Id,
      status: 'draft',
      confirmed: 0,
      pending: 0,
      checkIns: 0,
      availableSeats: 2,
      revenueCents: 0,
      revenueFormatted: 'R$ 0,00',
      refunded: 0,
    });

    await publishEvent(baseUrl, orgAToken, e1Id);

    // 1. 1ª compra na vitrine confirmada (cartão 0001, R$ 100,00)
    const buyC1Res = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyC1Res.status, 202);
    const c1 = (await buyC1Res.json()) as { ticketId: string; code: string };
    c1ShowcaseCode = c1.code;
    await waitForTicketStatus(baseUrl, c1.ticketId, 'confirmed');

    // 2. Compra na API de parceiros com cartão lento 0004 (nasce pending e depois recusa)
    const buySlowDeclineRes = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'pendente.0004@parceiro.local',
        cardNumber: '4000000000000004',
      }),
    });
    assert.equal(buySlowDeclineRes.status, 202);
    const slowDeclineTicket = (await buySlowDeclineRes.json()) as { ticketId: string };

    // Enquanto 0004 está pendente: Pendentes = 1, Vagas disponíveis = 0, Receita = R$ 100,00 (pending não entra na receita)
    const duringPendingDash = await fetchDashboard(baseUrl, orgAToken, e1Id);
    assert.deepEqual(duringPendingDash, {
      eventId: e1Id,
      status: 'published',
      confirmed: 1,
      pending: 1,
      checkIns: 0,
      availableSeats: 0,
      revenueCents: 10000,
      revenueFormatted: 'R$ 100,00',
      refunded: 0,
    });

    // Após recusa do cartão 0004 -> sai de Pendentes (0) e devolve a vaga (availableSeats = 1)
    await waitForTicketStatus(baseUrl, slowDeclineTicket.ticketId, 'declined');
    const afterDeclineDash = await fetchDashboard(baseUrl, orgAToken, e1Id);
    assert.deepEqual(afterDeclineDash, {
      eventId: e1Id,
      status: 'published',
      confirmed: 1,
      pending: 0,
      checkIns: 0,
      availableSeats: 1,
      revenueCents: 10000,
      revenueFormatted: 'R$ 100,00',
      refunded: 0,
    });

    // 3. 2ª compra confirmada via API de parceiros (cartão 0001, ainda a R$ 100,00)
    const buyC2Res = await fetch(`${baseUrl}/api/partner/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'confirmado.parceiro@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    assert.equal(buyC2Res.status, 202);
    const c2 = (await buyC2Res.json()) as { ticketId: string };
    await waitForTicketStatus(baseUrl, c2.ticketId, 'confirmed');

    // 4. Altera preço para R$ 150,00 (15000) e aumenta lotação para 3 (CF-11, R03)
    const patchRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ priceCents: 15000, capacity: 3 }),
    });
    assert.equal(patchRes.status, 200);

    // Logo após editar: Vagas disponíveis reflete a nova lotação (1) e Receita preserva 2x R$ 100,00 = R$ 200,00
    const afterEditDash = await fetchDashboard(baseUrl, orgAToken, e1Id);
    assert.deepEqual(afterEditDash, {
      eventId: e1Id,
      status: 'published',
      confirmed: 2,
      pending: 0,
      checkIns: 0,
      availableSeats: 1,
      revenueCents: 20000,
      revenueFormatted: 'R$ 200,00',
      refunded: 0,
    });

    // 5. 3ª compra confirmada (cartão 0001, já com o novo preço de R$ 150,00)
    const buyC3Res = await fetch(`${baseUrl}/api/events/${e1Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${participantToken}`,
      },
      body: JSON.stringify({ cardNumber: '4000000000000001' }),
    });
    assert.equal(buyC3Res.status, 202);
    const c3 = (await buyC3Res.json()) as { ticketId: string };
    await waitForTicketStatus(baseUrl, c3.ticketId, 'confirmed');

    // Consolidação final: 2x R$ 100,00 + 1x R$ 150,00 = R$ 350,00 (35000 centavos)
    const finalDash = await fetchDashboard(baseUrl, orgAToken, e1Id);
    assert.deepEqual(finalDash, {
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

  it('CT-F06-02 (CA-F06-01, R12, CF-13): check-in de ingresso confirmado incrementa Check-ins mantendo Confirmados e Receita intactos', async () => {
    const checkinRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c1ShowcaseCode }),
    });
    assert.equal(checkinRes.status, 200);
    const checkinBody = (await checkinRes.json()) as { allowed: boolean; message: string };
    assert.equal(checkinBody.allowed, true);
    assert.equal(checkinBody.message, 'Entrada liberada');

    const dashAfterCheckin = await fetchDashboard(baseUrl, orgAToken, e1Id);
    assert.deepEqual(dashAfterCheckin, {
      eventId: e1Id,
      status: 'published',
      confirmed: 3,
      pending: 0,
      checkIns: 1,
      availableSeats: 0,
      revenueCents: 35000,
      revenueFormatted: 'R$ 350,00',
      refunded: 0,
    });
  });

  it('CT-F06-03 (CA-F06-01, R12, R11, R10, R05, CF-14): após cancelar E3 e estornar em <10s, check-in retorna Evento cancelado e painel zera receita/vagas/check-ins e conta Estornados', async () => {
    const e3 = await createEvent(baseUrl, orgAToken, {
      name: 'Show Cancelado Painel E3',
      capacity: 4,
      priceCents: 5000,
    });
    e3Id = e3.id;
    await publishEvent(baseUrl, orgAToken, e3Id);

    // 1 ingresso confirmed (C6, cartão 0001)
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

    // 1 ingresso pending lento (cartão 0003)
    const slowPurchaseStartedAt = Date.now();
    const buyPendingRes = await fetch(`${baseUrl}/api/partner/events/${e3Id}/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.partnerApiKey,
      },
      body: JSON.stringify({
        buyerEmail: 'pendente.e3@parceiro.local',
        cardNumber: '4000000000000003',
      }),
    });
    assert.equal(buyPendingRes.status, 202);
    const slowPending = (await buyPendingRes.json()) as { ticketId: string };

    const beforeCancelDash = await fetchDashboard(baseUrl, orgAToken, e3Id);
    assert.deepEqual(beforeCancelDash, {
      eventId: e3Id,
      status: 'published',
      confirmed: 1,
      pending: 1,
      checkIns: 0,
      availableSeats: 2,
      revenueCents: 5000,
      revenueFormatted: 'R$ 50,00',
      refunded: 0,
    });

    // Cancela E3
    const cancelRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(cancelRes.status, 200);

    // Aguarda liquidação (< 10s; leva < 500ms em teste)
    await waitForTicketStatus(baseUrl, c6.ticketId, 'refunded', 4000);
    await waitForTicketStatus(baseUrl, slowPending.ticketId, 'cancelled', 4000);

    // Check-in de C6 retorna "Evento cancelado" (R10, CF-14)
    const checkinAfterCancelRes = await fetch(`${baseUrl}/api/organizer/events/${e3Id}/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ code: c6.code }),
    });
    assert.equal(checkinAfterCancelRes.status, 422);
    assert.deepEqual(await checkinAfterCancelRes.json(), {
      allowed: false,
      code: 'event_cancelled',
      message: 'Evento cancelado',
    });

    // Painel de E3 exibe Receita R$ 0,00 (estorno jamais soma como receita!) e Estornados: 1
    const afterCancelDash = await fetchDashboard(baseUrl, orgAToken, e3Id);
    assert.deepEqual(afterCancelDash, {
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

    // Aguarda janela tardia do cartão 0003 expirar e confirma imutabilidade do painel
    const targetWaitMs = Math.ceil(42000 * config.gatewayDelayMultiplier) + 200;
    const elapsed = Date.now() - slowPurchaseStartedAt;
    if (elapsed < targetWaitMs) {
      await sleep(targetWaitMs - elapsed);
    }

    const dashAfterLateGateway = await fetchDashboard(baseUrl, orgAToken, e3Id);
    assert.deepEqual(dashAfterLateGateway, afterCancelDash);

    // Valida também definição literal de R12 para checkIns quando já havia check-in antes do cancelamento:
    // quando os confirmados viram refunded, checkIns passa a 0!
    const evWithPriorCheckin = await createEvent(baseUrl, orgAToken, {
      name: 'Evento Check-in Prévio depois Cancelado',
      capacity: 3,
      priceCents: 7000,
    });
    await publishEvent(baseUrl, orgAToken, evWithPriorCheckin.id);

    const buyPriorRes = await fetch(
      `${baseUrl}/api/partner/events/${evWithPriorCheckin.id}/purchases`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
        body: JSON.stringify({
          buyerEmail: 'prior.checkin@parceiro.local',
          cardNumber: '4000000000000001',
        }),
      },
    );
    const priorTicket = (await buyPriorRes.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, priorTicket.ticketId, 'confirmed');

    const priorCheckinRes = await fetch(
      `${baseUrl}/api/organizer/events/${evWithPriorCheckin.id}/checkin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
        body: JSON.stringify({ code: priorTicket.code }),
      },
    );
    assert.equal(priorCheckinRes.status, 200);
    assert.equal((await fetchDashboard(baseUrl, orgAToken, evWithPriorCheckin.id)).checkIns, 1);

    await fetch(`${baseUrl}/api/organizer/events/${evWithPriorCheckin.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    await waitForTicketStatus(baseUrl, priorTicket.ticketId, 'refunded', 4000);

    const settledPriorDash = await fetchDashboard(baseUrl, orgAToken, evWithPriorCheckin.id);
    assert.deepEqual(settledPriorDash, {
      eventId: evWithPriorCheckin.id,
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

  it('CT-F06-04 (R13, CF-10): restringe estritamente os dados do painel na API e na UI ao organizador dono do evento', async () => {
    // 1. Visitante deslogado -> 401 {"error":"unauthenticated"}
    const anonRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/dashboard`);
    assert.equal(anonRes.status, 401);
    const anonBody = await anonRes.json();
    assert.deepEqual(anonBody, { error: 'unauthenticated' });
    assert.doesNotMatch(JSON.stringify(anonBody), /350/);

    // 2. Participante autenticado -> 403 {"error":"forbidden"}
    const partRes = await fetch(`${baseUrl}/api/organizer/events/${e1Id}/dashboard`, {
      headers: { Authorization: `Bearer ${participantToken}` },
    });
    assert.equal(partRes.status, 403);
    const partBody = await partRes.json();
    assert.deepEqual(partBody, { error: 'forbidden' });
    assert.doesNotMatch(JSON.stringify(partBody), /350/);

    // 3. Organizador B tentando acessar painel de E1 (e de E3 cancelado) do Organizador A -> 403 {"error":"forbidden"}
    for (const targetEventId of [e1Id, e3Id]) {
      const orgBRes = await fetch(`${baseUrl}/api/organizer/events/${targetEventId}/dashboard`, {
        headers: { Authorization: `Bearer ${orgBToken}` },
      });
      assert.equal(orgBRes.status, 403);
      const orgBBody = await orgBRes.json();
      assert.deepEqual(orgBBody, { error: 'forbidden' });
      assert.doesNotMatch(JSON.stringify(orgBBody), /350|Show Painel/);
    }

    // 4. Evento inexistente -> 404 {"error":"not_found"}
    const notFoundRes = await fetch(
      `${baseUrl}/api/organizer/events/evt_inexistente_f06_999/dashboard`,
      {
        headers: { Authorization: `Bearer ${orgAToken}` },
      },
    );
    assert.equal(notFoundRes.status, 404);
    assert.deepEqual(await notFoundRes.json(), { error: 'not_found' });

    // 5. Na UI (/organizer/events/$E1), Visitante, Participante e Organizador B não veem o painel nem os números de E1
    const origFetch = globalThis.fetch;
    try {
      for (const scenario of [
        { label: 'visitante', user: null, cookie: '' },
        { label: 'participante', user: participantUser, cookie: participantCookie },
        { label: 'organizador B', user: orgBUser, cookie: orgBCookie },
      ]) {
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          const urlStr =
            typeof input === 'string' && input.startsWith('/') ? `${baseUrl}${input}` : input;
          const headers = new Headers(init?.headers);
          if (scenario.cookie && !headers.has('Cookie') && !headers.has('Authorization')) {
            headers.set('Cookie', scenario.cookie);
          }
          return origFetch(urlStr, { ...init, headers });
        }) as typeof fetch;

        const blockedContainer = {
          innerHTML: '',
          isConnected: true,
          contains: () => true,
          querySelector: () => null,
        };

        await renderOrganizerEventView(blockedContainer as unknown as HTMLElement, {
          eventId: e1Id,
          user: scenario.user,
        });

        assert.match(
          blockedContainer.innerHTML,
          /data-view="access-denied"/,
          `UI deve exibir acesso negado para ${scenario.label}`,
        );
        assert.doesNotMatch(blockedContainer.innerHTML, /Painel do evento/);
        assert.doesNotMatch(blockedContainer.innerHTML, /dashboard-confirmed/);
        assert.doesNotMatch(blockedContainer.innerHTML, /350,00/);
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('integra dashboard-widget.js em organizer-event.js com os 6 indicadores rotulados e recarga automática em abertura, check-in, edição, cancelamento e botão Atualizar painel', async () => {
    const widgetJsRes = await fetch(`${baseUrl}/views/dashboard-widget.js`);
    assert.equal(widgetJsRes.status, 200);
    const widgetSource = await widgetJsRes.text();

    assert.match(widgetSource, /Painel do evento/);
    assert.match(widgetSource, /Atualizar painel/);
    assert.match(widgetSource, /Confirmados/);
    assert.match(widgetSource, /Pendentes/);
    assert.match(widgetSource, /Check-ins/);
    assert.match(widgetSource, /Vagas disponíveis/);
    assert.match(widgetSource, /Receita/);
    assert.match(widgetSource, /Estornados/);
    assert.match(widgetSource, /id="dashboard-confirmed"/);
    assert.match(widgetSource, /id="dashboard-pending"/);
    assert.match(widgetSource, /id="dashboard-checkins"/);
    assert.match(widgetSource, /id="dashboard-available-seats"/);
    assert.match(widgetSource, /id="dashboard-revenue"/);
    assert.match(widgetSource, /id="dashboard-refunded"/);
    assert.match(widgetSource, /catraca:checkin-success/);

    const organizerEventSource = await (await fetch(`${baseUrl}/views/organizer-event.js`)).text();
    assert.match(organizerEventSource, /renderDashboardWidget/);
    assert.match(organizerEventSource, /#event-dashboard-slot/);

    // Exercita renderDashboardWidget contra servidor HTTP real em todo o ciclo operacional
    const uiEvent = await createEvent(baseUrl, orgAToken, {
      name: 'Evento UI Painel Completo',
      capacity: 2,
      priceCents: 8000,
    });
    await publishEvent(baseUrl, orgAToken, uiEvent.id);

    const buyRes = await fetch(`${baseUrl}/api/partner/events/${uiEvent.id}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.partnerApiKey },
      body: JSON.stringify({
        buyerEmail: 'ui.painel@parceiro.local',
        cardNumber: '4000000000000001',
      }),
    });
    const uiTicket = (await buyRes.json()) as { ticketId: string; code: string };
    await waitForTicketStatus(baseUrl, uiTicket.ticketId, 'confirmed');

    let refreshClickHandler: (() => void) | null = null;
    const eventListeners = new Map<string, Set<() => void>>();

    const confirmedEl = { textContent: '' };
    const pendingEl = { textContent: '' };
    const checkinsEl = { textContent: '' };
    const availableSeatsEl = { textContent: '' };
    const revenueEl = { textContent: '' };
    const refundedEl = { textContent: '' };
    const errorEl = { textContent: '', hidden: true };
    const refreshBtnEl = {
      disabled: false,
      addEventListener: (evName: string, fn: () => void) => {
        if (evName === 'click') refreshClickHandler = fn;
      },
    };

    const eventContainerStub = {
      addEventListener: (evName: string, fn: () => void) => {
        if (!eventListeners.has(evName)) eventListeners.set(evName, new Set());
        eventListeners.get(evName)!.add(fn);
      },
      removeEventListener: (evName: string, fn: () => void) => {
        eventListeners.get(evName)?.delete(fn);
      },
      dispatchCheckinSuccess: () => {
        for (const fn of eventListeners.get('catraca:checkin-success') || []) {
          fn();
        }
      },
    };

    const dashboardSlotStub = {
      innerHTML: '',
      isConnected: true,
      contains: () => true,
      querySelector: (sel: string) => {
        if (sel === '#dashboard-refresh-btn') return refreshBtnEl;
        if (sel === '#dashboard-error') return errorEl;
        if (sel === '#dashboard-confirmed') return confirmedEl;
        if (sel === '#dashboard-pending') return pendingEl;
        if (sel === '#dashboard-checkins') return checkinsEl;
        if (sel === '#dashboard-available-seats') return availableSeatsEl;
        if (sel === '#dashboard-revenue') return revenueEl;
        if (sel === '#dashboard-refunded') return refundedEl;
        return null;
      },
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has('Cookie') && !headers.has('Authorization')) {
        headers.set('Cookie', orgACookie);
      }
      return origFetch(input, { ...init, headers });
    }) as typeof fetch;

    try {
      // 1. Abertura da gestão carrega automaticamente os 6 indicadores
      const widget = renderDashboardWidget(dashboardSlotStub as unknown as HTMLElement, {
        eventId: uiEvent.id,
        apiBaseUrl: baseUrl,
        eventContainer: eventContainerStub,
        autoSettleRefresh: false,
      });
      await widget.ready;

      assert.equal(confirmedEl.textContent, '1');
      assert.equal(pendingEl.textContent, '0');
      assert.equal(checkinsEl.textContent, '0');
      assert.equal(availableSeatsEl.textContent, '1');
      assert.equal(revenueEl.textContent, 'R$ 80,00');
      assert.equal(refundedEl.textContent, '0');
      assert.equal(errorEl.hidden, true);

      // 2. Check-in realizado + evento catraca:checkin-success recarrega o painel automaticamente
      const checkinRes = await origFetch(
        `${baseUrl}/api/organizer/events/${uiEvent.id}/checkin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
          body: JSON.stringify({ code: uiTicket.code }),
        },
      );
      assert.equal(checkinRes.status, 200);

      eventContainerStub.dispatchCheckinSuccess();
      await sleep(80);
      assert.equal(checkinsEl.textContent, '1');
      assert.equal(confirmedEl.textContent, '1');
      assert.equal(revenueEl.textContent, 'R$ 80,00');

      // 3. Edição do evento (aumentando lotação para 5 e mudando preço para R$ 120,00) + clique em "Atualizar painel"
      const patchRes = await origFetch(`${baseUrl}/api/organizer/events/${uiEvent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orgAToken}` },
        body: JSON.stringify({ capacity: 5, priceCents: 12000 }),
      });
      assert.equal(patchRes.status, 200);

      assert.ok(refreshClickHandler, 'Botão Atualizar painel deve possuir listener de clique');
      refreshClickHandler!();
      await sleep(80);
      assert.equal(availableSeatsEl.textContent, '4');
      assert.equal(revenueEl.textContent, 'R$ 80,00');

      // 4. Cancelamento e estorno do evento -> refresh reflete receita zerada e estornados = 1
      await origFetch(`${baseUrl}/api/organizer/events/${uiEvent.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAToken}` },
      });
      await waitForTicketStatus(baseUrl, uiTicket.ticketId, 'refunded', 4000);

      await widget.refresh();
      assert.equal(confirmedEl.textContent, '0');
      assert.equal(pendingEl.textContent, '0');
      assert.equal(checkinsEl.textContent, '0');
      assert.equal(availableSeatsEl.textContent, '0');
      assert.equal(revenueEl.textContent, 'R$ 0,00');
      assert.equal(refundedEl.textContent, '1');

      widget.destroy();
      assert.equal(eventListeners.get('catraca:checkin-success')?.size ?? 0, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
