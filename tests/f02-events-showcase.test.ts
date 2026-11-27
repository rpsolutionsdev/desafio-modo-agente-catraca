import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';

const rawBaseDbUrl =
  process.env.DATABASE_URL || 'postgres://catraca:catraca@localhost:5432/catraca';
const isolatedSchema = 'f02_test';
const isolatedUrl = new URL(rawBaseDbUrl);
isolatedUrl.searchParams.set('options', `-c search_path=${isolatedSchema}`);
process.env.DATABASE_URL = isolatedUrl.toString();

const { createApp } = await import('../src/server.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { runSeed } = await import('../src/db/seed.js');
const { pool } = await import('../src/db/pool.js');
const { config } = await import('../src/shared/config.js');
const { generateId, generateTicketCode } = await import('../src/shared/ids.js');
const { formatPriceBRL, parsePriceInputToCents } = await import('../src/web/views/showcase.js');

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

describe('F02 — Ciclo de Vida de Eventos e Vitrine Pública', () => {
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

  it('converte valores em reais (100, 100,00, 100.00) para priceCents e formata R$ X,XX', () => {
    assert.equal(parsePriceInputToCents('100'), 10000);
    assert.equal(parsePriceInputToCents('100,00'), 10000);
    assert.equal(parsePriceInputToCents('100.00'), 10000);
    assert.equal(parsePriceInputToCents('1.250,50'), 125050);
    assert.equal(parsePriceInputToCents('R$ 75,90'), 7590);
    assert.equal(parsePriceInputToCents('0'), 0);
    assert.equal(parsePriceInputToCents('0,00'), 0);
    assert.equal(parsePriceInputToCents('-15'), -1);
    assert.equal(parsePriceInputToCents('abc'), null);
    assert.equal(parsePriceInputToCents(''), null);

    assert.equal(formatPriceBRL(10000), 'R$ 100,00');
    assert.equal(formatPriceBRL(35000), 'R$ 350,00');
    assert.equal(formatPriceBRL(0), 'R$ 0,00');
  });

  it('CT-F02-01 (R01): rejeita datas passadas e valores inválidos ao criar e ao editar evento', async () => {
    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrowIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const invalidCreatePayloads = [
      // Data no passado
      {
        name: 'Evento Passado',
        startsAt: yesterdayIso,
        location: 'Bar Central',
        capacity: 10,
        priceCents: 5000,
      },
      // Data inexistente no calendário (30 de fevereiro)
      {
        name: 'Data Impossível',
        startsAt: '2028-02-30T20:00:00Z',
        location: 'Bar Central',
        capacity: 10,
        priceCents: 5000,
      },
      // Lotação 0
      {
        name: 'Lotação Zero',
        startsAt: tomorrowIso,
        location: 'Bar Central',
        capacity: 0,
        priceCents: 5000,
      },
      // Lotação fracionária
      {
        name: 'Lotação Decimal',
        startsAt: tomorrowIso,
        location: 'Bar Central',
        capacity: 2.5,
        priceCents: 5000,
      },
      // Preço 0
      {
        name: 'Preço Zero',
        startsAt: tomorrowIso,
        location: 'Bar Central',
        capacity: 10,
        priceCents: 0,
      },
      // Preço negativo
      {
        name: 'Preço Negativo',
        startsAt: tomorrowIso,
        location: 'Bar Central',
        capacity: 10,
        priceCents: -500,
      },
      // Nome vazio
      {
        name: '   ',
        startsAt: tomorrowIso,
        location: 'Bar Central',
        capacity: 10,
        priceCents: 5000,
      },
      // Local vazio
      {
        name: 'Show Válido',
        startsAt: tomorrowIso,
        location: '   ',
        capacity: 10,
        priceCents: 5000,
      },
    ];

    for (const payload of invalidCreatePayloads) {
      const res = await fetch(`${baseUrl}/api/organizer/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAToken}`,
        },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 422, `Deveria rejeitar payload inválido: ${JSON.stringify(payload)}`);
      assert.deepEqual(await res.json(), { error: 'invalid_request' });
    }

    // Cria evento válido futuro
    const validRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Workshop Validação R01',
        startsAt: tomorrowIso,
        location: 'Auditório Sul',
        capacity: 15,
        priceCents: 8000,
      }),
    });
    assert.equal(validRes.status, 201);
    const created = (await validRes.json()) as { id: string; startsAt: string; status: string };
    assert.equal(created.status, 'draft');

    // Tenta editar evento válido para data no passado, lotação 0, preço 0 e body vazio
    const invalidPatchPayloads = [
      { startsAt: yesterdayIso },
      { capacity: 0 },
      { priceCents: 0 },
      { name: '' },
      { location: '' },
      {},
    ];

    for (const patchPayload of invalidPatchPayloads) {
      const patchRes = await fetch(`${baseUrl}/api/organizer/events/${created.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgAToken}`,
        },
        body: JSON.stringify(patchPayload),
      });
      assert.equal(
        patchRes.status,
        422,
        `Deveria rejeitar PATCH inválido: ${JSON.stringify(patchPayload)}`,
      );
      assert.deepEqual(await patchRes.json(), { error: 'invalid_request' });
    }

    // Limpa o evento auxiliar deste teste para manter estado limpo para CT-F02-02
    await pool.query('DELETE FROM events WHERE id = $1', [created.id]);
  });

  it('CT-F02-02 (R02, R05): evento nasce draft (oculto da vitrine e de parceiros) e aparece em ambos após publicar', async () => {
    const futureStartsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const createRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Show Acústico E1',
        startsAt: futureStartsAt,
        location: 'Casa da Música',
        capacity: 2,
        priceCents: 10000,
      }),
    });
    assert.equal(createRes.status, 201);
    const e1 = (await createRes.json()) as {
      id: string;
      name: string;
      status: string;
      capacity: number;
      priceCents: number;
      availableSeats: number;
    };
    assert.ok(e1.id.startsWith('evt_'));
    assert.equal(e1.status, 'draft');
    assert.equal(e1.capacity, 2);
    assert.equal(e1.priceCents, 10000);
    assert.equal(e1.availableSeats, 2);

    // Enquanto rascunho: oculto em GET /api/events e em GET /api/partner/events
    const showcaseDraftRes = await fetch(`${baseUrl}/api/events`);
    assert.equal(showcaseDraftRes.status, 200);
    const showcaseDraftList = (await showcaseDraftRes.json()) as Array<{ id: string }>;
    assert.equal(
      showcaseDraftList.some((ev) => ev.id === e1.id),
      false,
    );

    const partnerDraftRes = await fetch(`${baseUrl}/api/partner/events`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    assert.equal(partnerDraftRes.status, 200);
    const partnerDraftList = (await partnerDraftRes.json()) as Array<{ id: string }>;
    assert.equal(
      partnerDraftList.some((ev) => ev.id === e1.id),
      false,
    );

    // Publica E1
    const pubRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(pubRes.status, 200);
    const published = (await pubRes.json()) as { status: string; availableSeats: number };
    assert.equal(published.status, 'published');
    assert.equal(published.availableSeats, 2);

    // Agora E1 aparece na vitrine pública
    const showcasePubRes = await fetch(`${baseUrl}/api/events`);
    assert.equal(showcasePubRes.status, 200);
    const showcasePubList = (await showcasePubRes.json()) as Array<{
      id: string;
      name: string;
      startsAt: string;
      location: string;
      priceCents: number;
      availableSeats: number;
    }>;
    const inShowcase = showcasePubList.find((ev) => ev.id === e1.id);
    assert.ok(inShowcase, 'E1 publicado deve aparecer na vitrine pública');
    assert.equal(inShowcase.name, 'Show Acústico E1');
    assert.equal(inShowcase.location, 'Casa da Música');
    assert.equal(inShowcase.priceCents, 10000);
    assert.equal(inShowcase.availableSeats, 2);

    // Agora E1 aparece em GET /api/partner/events com contrato fixo exato
    const partnerPubRes = await fetch(`${baseUrl}/api/partner/events`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    assert.equal(partnerPubRes.status, 200);
    const partnerPubList = (await partnerPubRes.json()) as Array<Record<string, unknown>>;
    const inPartner = partnerPubList.find((ev) => ev.id === e1.id);
    assert.ok(inPartner, 'E1 publicado deve aparecer na API de parceiros');
    assert.deepEqual(Object.keys(inPartner).sort(), [
      'availableSeats',
      'id',
      'name',
      'priceCents',
      'startsAt',
    ]);
    assert.deepEqual(inPartner, {
      id: e1.id,
      name: 'Show Acústico E1',
      startsAt: futureStartsAt,
      priceCents: 10000,
      availableSeats: 2,
    });
  });

  it('CT-F02-03 (R03, R04, R05, R11): permite edição na página própria, trava redução de lotação abaixo de ocupados e bloqueia evento cancelado', async () => {
    const orgEventsRes = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(orgEventsRes.status, 200);
    const orgEvents = (await orgEventsRes.json()) as Array<{ id: string; name: string }>;
    const e1 = orgEvents.find((ev) => ev.name === 'Show Acústico E1');
    assert.ok(e1, 'Deve localizar E1 do Organizador A');

    // Consulta detalhe do evento (base da página /organizer/events/:eventId)
    const detailRes = await fetch(`${baseUrl}/api/organizer/events/${e1.id}`, {
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(detailRes.status, 200);
    const detail = (await detailRes.json()) as { id: string; capacity: number; priceCents: number };
    assert.equal(detail.id, e1.id);

    // Aumenta lotação para 5 e altera preço para R$ 150,00 (15000 centavos)
    const patchIncrease = await fetch(`${baseUrl}/api/organizer/events/${e1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 5, priceCents: 15000 }),
    });
    assert.equal(patchIncrease.status, 200);
    const updated = (await patchIncrease.json()) as {
      capacity: number;
      priceCents: number;
      availableSeats: number;
    };
    assert.equal(updated.capacity, 5);
    assert.equal(updated.priceCents, 15000);
    assert.equal(updated.availableSeats, 5);

    // Simula ocupação real em tickets: 1 pending + 2 confirmed (= 3 ocupados) e 1 declined + 1 refunded (não ocupam)
    const statuses: Array<'pending' | 'confirmed' | 'declined' | 'refunded'> = [
      'pending',
      'confirmed',
      'confirmed',
      'declined',
      'refunded',
    ];
    for (const st of statuses) {
      await pool.query(
        `INSERT INTO tickets (id, code, event_id, buyer_email, channel, price_cents, status)
         VALUES ($1, $2, $3, $4, 'partner', 10000, $5)`,
        [generateId('tkt'), generateTicketCode(), e1.id, 'comprador@catraca.local', st],
      );
    }

    // Verifica que ocupação é 3 e availableSeats = 5 - 3 = 2
    const partnerAfterTickets = await fetch(`${baseUrl}/api/partner/events`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    const partnerList = (await partnerAfterTickets.json()) as Array<{
      id: string;
      availableSeats: number;
      priceCents: number;
    }>;
    const e1Partner = partnerList.find((ev) => ev.id === e1.id);
    assert.ok(e1Partner);
    assert.equal(e1Partner.availableSeats, 2);
    assert.equal(e1Partner.priceCents, 15000);

    // Tenta reduzir capacity para 2 (< 3 ocupados) -> deve rejeitar com 409 capacity_below_occupied (R03)
    const patchBelowOccupied = await fetch(`${baseUrl}/api/organizer/events/${e1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 2 }),
    });
    assert.equal(patchBelowOccupied.status, 409);
    assert.deepEqual(await patchBelowOccupied.json(), { error: 'capacity_below_occupied' });

    // Reduzir capacity para exatamente 3 (=== 3 ocupados) e alterar preço para 18000 é permitido e zera availableSeats
    const patchExactOccupied = await fetch(`${baseUrl}/api/organizer/events/${e1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ capacity: 3, priceCents: 18000 }),
    });
    assert.equal(patchExactOccupied.status, 200);
    const exactBody = (await patchExactOccupied.json()) as {
      capacity: number;
      occupiedSeats: number;
      availableSeats: number;
      priceCents: number;
    };
    assert.equal(exactBody.capacity, 3);
    assert.equal(exactBody.occupiedSeats, 3);
    assert.equal(exactBody.availableSeats, 0);
    assert.equal(exactBody.priceCents, 18000);

    // Verifica que o price_cents histórico gravado nos ingressos anteriores permaneceu 10000 (R03)
    const histTickets = await pool.query<{ price_cents: number }>(
      'SELECT DISTINCT price_cents FROM tickets WHERE event_id = $1',
      [e1.id],
    );
    assert.deepEqual(histTickets.rows, [{ price_cents: 10000 }]);

    // Testa bloqueio de edição e republicação quando evento está cancelled (R11, R05)
    const cancelTestEventRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({
        name: 'Evento Cancelado Teste',
        startsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Sala Norte',
        capacity: 10,
        priceCents: 5000,
      }),
    });
    assert.equal(cancelTestEventRes.status, 201);
    const cancelEvt = (await cancelTestEventRes.json()) as { id: string };
    await pool.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [cancelEvt.id],
    );

    const cancelledDetailRes = await fetch(`${baseUrl}/api/organizer/events/${cancelEvt.id}`, {
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    assert.equal(cancelledDetailRes.status, 200);
    const cancelledDetail = (await cancelledDetailRes.json()) as {
      status: string;
      availableSeats: number;
    };
    assert.equal(cancelledDetail.status, 'cancelled');
    assert.equal(cancelledDetail.availableSeats, 0);

    const patchCancelled = await fetch(`${baseUrl}/api/organizer/events/${cancelEvt.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgAToken}`,
      },
      body: JSON.stringify({ name: 'Tentativa Editar Cancelado' }),
    });
    assert.equal(patchCancelled.status, 409);
    assert.deepEqual(await patchCancelled.json(), { error: 'event_cancelled' });

    const publishCancelled = await fetch(
      `${baseUrl}/api/organizer/events/${cancelEvt.id}/publish`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAToken}` },
      },
    );
    assert.equal(publishCancelled.status, 409);
    assert.deepEqual(await publishCancelled.json(), { error: 'event_cancelled' });

    // Verifica que os módulos frontend contêm os slots de integração e mensagens exigidas (R04, R07)
    const orgEventJs = await (await fetch(`${baseUrl}/views/organizer-event.js`)).text();
    assert.match(orgEventJs, /id="event-dashboard-slot"/);
    assert.match(orgEventJs, /id="event-checkin-slot"/);
    assert.match(orgEventJs, /id="event-cancel-slot"/);

    const showcaseJs = await (await fetch(`${baseUrl}/views/showcase.js`)).text();
    assert.match(showcaseJs, /Ingressos esgotados/);
    assert.match(showcaseJs, /event-purchase-slot/);
  });

  it('CT-F02-04 (R13, CF-01): isola totalmente eventos entre organizadores, bloqueia participantes/visitantes e exige X-Api-Key em parceiros', async () => {
    const orgAEventsRes = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { Authorization: `Bearer ${orgAToken}` },
    });
    const orgAEvents = (await orgAEventsRes.json()) as Array<{ id: string; name: string }>;
    const e1 = orgAEvents.find((ev) => ev.name === 'Show Acústico E1');
    assert.ok(e1);

    // 1. Organizador B não vê E1 na listagem
    const orgBListRes = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBListRes.status, 200);
    const orgBList = (await orgBListRes.json()) as Array<{ id: string }>;
    assert.deepEqual(orgBList, []);

    // 2. Organizador B recebe 403 forbidden ao tentar consultar, editar ou publicar E1 de A (sem vazar dados!)
    const orgBGet = await fetch(`${baseUrl}/api/organizer/events/${e1.id}`, {
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBGet.status, 403);
    const orgBGetBody = await orgBGet.json();
    assert.deepEqual(orgBGetBody, { error: 'forbidden' });
    assert.doesNotMatch(JSON.stringify(orgBGetBody), /Show Acústico E1/);

    const orgBPatch = await fetch(`${baseUrl}/api/organizer/events/${e1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgBToken}`,
      },
      body: JSON.stringify({ name: 'Invasão B' }),
    });
    assert.equal(orgBPatch.status, 403);
    assert.deepEqual(await orgBPatch.json(), { error: 'forbidden' });

    const orgBPublish = await fetch(`${baseUrl}/api/organizer/events/${e1.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(orgBPublish.status, 403);
    assert.deepEqual(await orgBPublish.json(), { error: 'forbidden' });

    // Evento inexistente retorna 404 not_found
    const notFoundRes = await fetch(`${baseUrl}/api/organizer/events/evt_inexistente_999`, {
      headers: { Authorization: `Bearer ${orgBToken}` },
    });
    assert.equal(notFoundRes.status, 404);
    assert.deepEqual(await notFoundRes.json(), { error: 'not_found' });

    // 3. Participante autenticado recebe 403 forbidden em todas as rotas de organizador
    for (const [method, url] of [
      ['GET', `${baseUrl}/api/organizer/events`],
      ['GET', `${baseUrl}/api/organizer/events/${e1.id}`],
      ['PATCH', `${baseUrl}/api/organizer/events/${e1.id}`],
      ['POST', `${baseUrl}/api/organizer/events/${e1.id}/publish`],
    ] as const) {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: method === 'PATCH' ? JSON.stringify({ priceCents: 9999 }) : undefined,
      });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: 'forbidden' });
    }

    // 4. Visitante deslogado recebe 401 unauthenticated em todas as rotas de organizador
    for (const [method, url] of [
      ['GET', `${baseUrl}/api/organizer/events`],
      ['GET', `${baseUrl}/api/organizer/events/${e1.id}`],
      ['PATCH', `${baseUrl}/api/organizer/events/${e1.id}`],
      ['POST', `${baseUrl}/api/organizer/events/${e1.id}/publish`],
    ] as const) {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PATCH' ? JSON.stringify({ priceCents: 9999 }) : undefined,
      });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: 'unauthenticated' });
    }

    // Shell HTML de /organizer/events/:id não vaza nenhum dado do evento E1 no SSR/HTML inicial
    const spaShellHtml = await (await fetch(`${baseUrl}/organizer/events/${e1.id}`)).text();
    assert.doesNotMatch(spaShellHtml, /Show Acústico E1/);
    assert.doesNotMatch(spaShellHtml, /Casa da Música/);

    // 5. GET /api/partner/events sem X-Api-Key ou com chave inválida retorna 401 {"error":"unauthorized"} (CF-01)
    const partnerNoKey = await fetch(`${baseUrl}/api/partner/events`);
    assert.equal(partnerNoKey.status, 401);
    assert.deepEqual(await partnerNoKey.json(), { error: 'unauthorized' });

    const partnerWrongKey = await fetch(`${baseUrl}/api/partner/events`, {
      headers: { 'X-Api-Key': 'chave-errada' },
    });
    assert.equal(partnerWrongKey.status, 401);
    assert.deepEqual(await partnerWrongKey.json(), { error: 'unauthorized' });
  });
});
