import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.js';
import { runMigrations } from '../src/db/migrate.js';
import { runSeed, SEED_USERS } from '../src/db/seed.js';
import { pool } from '../src/db/pool.js';

describe('Harness Base & Seed Idempotency', () => {
  after(async () => {
    await pool.end();
  });

  it('aplica migrações e executa seed múltiplas vezes sem erro (idempotente)', async () => {
    await runMigrations();
    await runSeed();
    await runSeed();

    const { rows } = await pool.query('SELECT email, role FROM users WHERE email = ANY($1)', [
      SEED_USERS.map((u) => u.email),
    ]);
    assert.equal(rows.length, 3);
    const organizers = rows.filter((r) => r.role === 'organizer');
    const participants = rows.filter((r) => r.role === 'participant');
    assert.equal(organizers.length, 2);
    assert.equal(participants.length, 1);
  });

  it('responde 200 ok em GET /api/health', async () => {
    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { status: 'ok' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
