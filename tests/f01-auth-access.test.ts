import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createApp } from '../src/server.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { pool } from '../src/db/pool.js';
import { config } from '../src/shared/config.js';
import {
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
} from '../src/modules/auth/session.js';
import { attachUser, requireParticipant } from '../src/modules/auth/middleware.js';

function extractCookiePair(setCookieHeader: string | null, cookieName: string): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]*)`));
  if (!match) return null;
  return `${cookieName}=${match[1]}`;
}

describe('F01 — Autenticação, Contas e Controle de Acesso', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    await runMigrations();
    await runSeed();
    await pool.query("DELETE FROM users WHERE email LIKE 'f01test_%@catraca.local'");

    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE 'f01test_%@catraca.local'");
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await pool.end();
  });

  it('assina e valida tokens de sessão HMAC-SHA256, rejeitando adulteração e expiração', () => {
    const valid = signSessionToken({ id: 'usr_abc123', role: 'participant' });
    const payload = verifySessionToken(valid);
    assert.ok(payload);
    assert.equal(payload.sub, 'usr_abc123');
    assert.equal(payload.role, 'participant');

    const [p, s] = valid.split('.');
    const tamperedSig = `${p}.${s.slice(0, -2)}aa`;
    assert.equal(verifySessionToken(tamperedSig), null);

    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'usr_abc123', role: 'organizer', iat: payload.iat, exp: payload.exp }),
    ).toString('base64url');
    assert.equal(verifySessionToken(`${forgedPayload}.${s}`), null);

    const expired = signSessionToken({ id: 'usr_abc123', role: 'participant' }, -5);
    assert.equal(verifySessionToken(expired), null);
    assert.equal(verifySessionToken('token-invalido'), null);
  });

  it('CT-F01-01: cadastra participante inédito, autentica via cookie/Bearer e encerra sessão no logout', async () => {
    const uniqueEmail = `f01test_${Date.now()}@catraca.local`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '  Ana Participante  ',
        email: `  ${uniqueEmail.toUpperCase()}  `,
        password: 'SenhaSegura123',
      }),
    });

    assert.equal(regRes.status, 201);
    const setCookie = regRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Deve retornar cabeçalho Set-Cookie');
    assert.match(setCookie, new RegExp(`${SESSION_COOKIE_NAME}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /SameSite=Lax/i);

    const regBody = (await regRes.json()) as {
      user: { id: string; name: string; email: string; role: string; password_hash?: string };
      token: string;
    };
    assert.ok(regBody.user.id.startsWith('usr_'));
    assert.equal(regBody.user.name, 'Ana Participante');
    assert.equal(regBody.user.email, uniqueEmail);
    assert.equal(regBody.user.role, 'participant');
    assert.equal('password_hash' in regBody.user, false);
    assert.equal(typeof regBody.token, 'string');
    assert.ok(regBody.token.length > 20);

    const cookiePair = extractCookiePair(setCookie, SESSION_COOKIE_NAME);
    assert.ok(cookiePair);

    // GET /api/auth/me via cookie
    const meCookieRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(meCookieRes.status, 200);
    const meCookieBody = await meCookieRes.json();
    assert.deepEqual(meCookieBody, { user: regBody.user });

    // GET /api/auth/me via Authorization: Bearer
    const meBearerRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${regBody.token}` },
    });
    assert.equal(meBearerRes.status, 200);
    const meBearerBody = await meBearerRes.json();
    assert.deepEqual(meBearerBody, { user: regBody.user });

    // POST /api/auth/logout limpa o cookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookiePair },
    });
    assert.equal(logoutRes.status, 200);
    assert.deepEqual(await logoutRes.json(), { ok: true });

    const logoutSetCookie = logoutRes.headers.get('set-cookie');
    assert.ok(logoutSetCookie);
    const clearedCookiePair = extractCookiePair(logoutSetCookie, SESSION_COOKIE_NAME);
    assert.ok(clearedCookiePair);

    // Após logout, /api/auth/me com o cookie limpo retorna 401
    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: clearedCookiePair },
    });
    assert.equal(meAfterLogout.status, 401);
    assert.deepEqual(await meAfterLogout.json(), { error: 'unauthenticated' });

    // Sem credenciais também retorna 401
    const meAnon = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(meAnon.status, 401);
    assert.deepEqual(await meAnon.json(), { error: 'unauthenticated' });
  });

  it('valida conflito 409 email_in_use e payload inválido 422 invalid_request no registro', async () => {
    const email = `f01test_dup_${Date.now()}@catraca.local`;

    const first = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Primeiro', email, password: 'Password123' }),
    });
    assert.equal(first.status, 201);

    const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Segundo', email: email.toUpperCase(), password: 'Password123' }),
    });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: 'email_in_use' });

    const invalidCases = [
      { name: '', email: 'valido@catraca.local', password: 'Password123' },
      { name: 'Valido', email: 'email-sem-arroba', password: 'Password123' },
      { name: 'Valido', email: 'invalido@x', password: 'Password123' },
      { name: 'Valido', email: 'valido@catraca.local', password: '12345' },
      {},
    ];

    for (const payload of invalidCases) {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: 'invalid_request' });
    }

    const malformedRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": "quebrado"',
    });
    assert.equal(malformedRes.status, 422);
    assert.deepEqual(await malformedRes.json(), { error: 'invalid_request' });
  });

  it('CT-F01-02: autentica contas da seed, ignora role="organizer" no registro e mantém seed idempotente', async () => {
    await runSeed();

    const seedLogins = [
      { email: 'org.a@catraca.local', password: 'OrgA@123', expectedRole: 'organizer' },
      { email: 'org.b@catraca.local', password: 'OrgB@123', expectedRole: 'organizer' },
      { email: 'participante@catraca.local', password: 'Part@123', expectedRole: 'participant' },
    ];

    for (const item of seedLogins) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: item.email, password: item.password }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { user: { email: string; role: string }; token: string };
      assert.equal(body.user.email, item.email);
      assert.equal(body.user.role, item.expectedRole);
      assert.ok(body.token);
    }

    // Credenciais inválidas retornam 401 invalid_credentials
    const badPass = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'org.a@catraca.local', password: 'wrong-password' }),
    });
    assert.equal(badPass.status, 401);
    assert.deepEqual(await badPass.json(), { error: 'invalid_credentials' });

    const unknownUser = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inexistente@catraca.local', password: 'Password123' }),
    });
    assert.equal(unknownUser.status, 401);
    assert.deepEqual(await unknownUser.json(), { error: 'invalid_credentials' });

    // Tentar escalar privilégio enviando role: 'organizer' no registro cria apenas 'participant'
    const escalationEmail = `f01test_noesc_${Date.now()}@catraca.local`;
    const escRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tentativa Organizador',
        email: escalationEmail,
        password: 'Password123',
        role: 'organizer',
      }),
    });
    assert.equal(escRes.status, 201);
    const escBody = (await escRes.json()) as { user: { role: string } };
    assert.equal(escBody.user.role, 'participant');

    const dbCheck = await pool.query<{ role: string }>('SELECT role FROM users WHERE email = $1', [
      escalationEmail,
    ]);
    assert.equal(dbCheck.rows[0]?.role, 'participant');

    // UI de /register não expõe opção de criar conta de organizador
    const authViewJsRes = await fetch(`${baseUrl}/views/auth.js`);
    assert.equal(authViewJsRes.status, 200);
    const authViewSource = await authViewJsRes.text();
    assert.match(authViewSource, /id="register-form"/);
    assert.doesNotMatch(authViewSource, /name="role"/i);
  });

  it('CT-F01-03 (R13): bloqueia visitantes (401) e participantes (403) em /api/organizer/* e protege /organizer* na SPA', async () => {
    // 1. Visitante deslogado -> 401 unauthenticated
    const anonList = await fetch(`${baseUrl}/api/organizer/events`);
    assert.equal(anonList.status, 401);
    assert.deepEqual(await anonList.json(), { error: 'unauthenticated' });

    const anonSubroute = await fetch(`${baseUrl}/api/organizer/events/evt_123`);
    assert.equal(anonSubroute.status, 401);
    assert.deepEqual(await anonSubroute.json(), { error: 'unauthenticated' });

    // 2. Participante autenticado -> 403 forbidden
    const partLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'participante@catraca.local', password: 'Part@123' }),
    });
    assert.equal(partLogin.status, 200);
    const { token: partToken } = (await partLogin.json()) as { token: string };

    const partList = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { Authorization: `Bearer ${partToken}` },
    });
    assert.equal(partList.status, 403);
    assert.deepEqual(await partList.json(), { error: 'forbidden' });

    const partSubroute = await fetch(`${baseUrl}/api/organizer/events/evt_123`, {
      headers: { Authorization: `Bearer ${partToken}` },
    });
    assert.equal(partSubroute.status, 403);
    assert.deepEqual(await partSubroute.json(), { error: 'forbidden' });

    // 3. Organizador autenticado -> 200 []
    const orgLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'org.a@catraca.local', password: 'OrgA@123' }),
    });
    assert.equal(orgLogin.status, 200);
    const { token: orgToken } = (await orgLogin.json()) as { token: string };

    const orgList = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { Authorization: `Bearer ${orgToken}` },
    });
    assert.equal(orgList.status, 200);
    assert.deepEqual(await orgList.json(), []);

    // 4. requireParticipant bloqueia visitante (401) e organizador (403), liberando participante (200)
    const auxApp = express();
    auxApp.use(attachUser);
    auxApp.get('/only-participant', requireParticipant, (_req, res) => {
      res.status(200).json({ allowed: true });
    });
    const auxServer = http.createServer(auxApp);
    await new Promise<void>((resolve) => auxServer.listen(0, '127.0.0.1', resolve));
    const auxAddr = auxServer.address();
    const auxPort = typeof auxAddr === 'object' && auxAddr ? auxAddr.port : 0;
    try {
      const rAnon = await fetch(`http://127.0.0.1:${auxPort}/only-participant`);
      assert.equal(rAnon.status, 401);

      const rOrg = await fetch(`http://127.0.0.1:${auxPort}/only-participant`, {
        headers: { Authorization: `Bearer ${orgToken}` },
      });
      assert.equal(rOrg.status, 403);

      const rPart = await fetch(`http://127.0.0.1:${auxPort}/only-participant`, {
        headers: { Authorization: `Bearer ${partToken}` },
      });
      assert.equal(rPart.status, 200);
    } finally {
      await new Promise<void>((resolve) => auxServer.close(() => resolve()));
    }

    // 5. Rotas da SPA (/organizer e /organizer/events/:id) entregam shell limpo sem dados internos e possuem guarda explícita em app.js
    const orgPageHtml = await (await fetch(`${baseUrl}/organizer`)).text();
    assert.doesNotMatch(orgPageHtml, /Área do Organizador/);

    const appJsSource = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(appJsSource, /path === '\/organizer' \|\| path\.startsWith\('\/organizer\/'\)/);
    assert.match(appJsSource, /state\.user\.role !== 'organizer'/);
    assert.match(appJsSource, /renderOrganizerGuardBlockedView/);
  });

  it('CT-F01-04: exige X-Api-Key válida em /api/partner/* respondendo 401 {"error":"unauthorized"} quando ausente ou inválida', async () => {
    const missingKeyRes = await fetch(`${baseUrl}/api/partner/events`);
    assert.equal(missingKeyRes.status, 401);
    assert.deepEqual(await missingKeyRes.json(), { error: 'unauthorized' });

    const invalidKeyRes = await fetch(`${baseUrl}/api/partner/events`, {
      headers: { 'X-Api-Key': 'chave-invalida' },
    });
    assert.equal(invalidKeyRes.status, 401);
    assert.deepEqual(await invalidKeyRes.json(), { error: 'unauthorized' });

    // Mesmo enviando JSON malformado sem X-Api-Key, a prioridade é 401 unauthorized
    const malformedWithoutKey = await fetch(`${baseUrl}/api/partner/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken":',
    });
    assert.equal(malformedWithoutKey.status, 401);
    assert.deepEqual(await malformedWithoutKey.json(), { error: 'unauthorized' });

    const validKeyRes = await fetch(`${baseUrl}/api/partner/events`, {
      headers: { 'X-Api-Key': config.partnerApiKey },
    });
    assert.equal(validKeyRes.status, 200);
    assert.deepEqual(await validKeyRes.json(), []);
  });
});
