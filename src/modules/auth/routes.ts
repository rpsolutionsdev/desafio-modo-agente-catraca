import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../../db/pool.js';
import { generateId } from '../../shared/ids.js';
import { hashPassword, verifyPassword } from './crypto.js';
import {
  clearSessionCookie,
  setSessionCookie,
  signSessionToken,
  type AuthUser,
  type UserRole,
} from './session.js';
import { requireAuth } from './middleware.js';

export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  if (trimmed.includes('..')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const authRouter = Router();

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isPlainObject(req.body)) {
      res.status(422).json({ error: 'invalid_request' });
      return;
    }

    const { name, email, password } = req.body;

    if (
      typeof name !== 'string' ||
      name.trim().length < 1 ||
      name.trim().length > 200 ||
      typeof email !== 'string' ||
      !isValidEmail(email) ||
      typeof password !== 'string' ||
      password.length < 6 ||
      password.length > 200
    ) {
      res.status(422).json({ error: 'invalid_request' });
      return;
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const id = generateId('usr');
    const passwordHash = hashPassword(password);

    // O papel é sempre 'participant'; qualquer campo extra (ex.: role) no body é estritamente ignorado.
    let user: AuthUser;
    try {
      const { rows } = await pool.query<AuthUser>(
        `INSERT INTO users (id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'participant')
         RETURNING id, name, email, role`,
        [id, cleanName, cleanEmail, passwordHash],
      );
      user = rows[0];
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        res.status(409).json({ error: 'email_in_use' });
        return;
      }
      throw err;
    }

    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.status(201).json({ user, token });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isPlainObject(req.body)) {
      res.status(422).json({ error: 'invalid_request' });
      return;
    }

    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(422).json({ error: 'invalid_request' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    const { rows } = await pool.query<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      role: UserRole;
    }>('SELECT id, name, email, password_hash, role FROM users WHERE email = $1', [cleanEmail]);

    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    const row = rows[0];
    const user: AuthUser = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
    };

    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.status(200).json({ user, token });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});
