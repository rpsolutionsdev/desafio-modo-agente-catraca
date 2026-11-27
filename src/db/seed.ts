import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { hashPassword } from '../modules/auth/crypto.js';

export const SEED_USERS = [
  {
    id: 'usr_seed_org_a',
    name: 'Organizador A',
    email: 'org.a@catraca.local',
    password: 'OrgA@123',
    role: 'organizer' as const,
  },
  {
    id: 'usr_seed_org_b',
    name: 'Organizador B',
    email: 'org.b@catraca.local',
    password: 'OrgB@123',
    role: 'organizer' as const,
  },
  {
    id: 'usr_seed_participant',
    name: 'Participante Seed',
    email: 'participante@catraca.local',
    password: 'Part@123',
    role: 'participant' as const,
  },
];

export async function runSeed(): Promise<void> {
  for (const u of SEED_USERS) {
    const passwordHash = hashPassword(u.password);
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role`,
      [u.id, u.name, u.email, passwordHash, u.role],
    );
  }
  console.log('[seed] Contas da seed garantidas com sucesso (2 organizadores + 1 participante).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSeed()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error('[seed] Erro:', err);
      await pool.end();
      process.exit(1);
    });
}
