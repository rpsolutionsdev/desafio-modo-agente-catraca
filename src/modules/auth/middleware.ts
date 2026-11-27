import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../../db/pool.js';
import { config } from '../../shared/config.js';
import {
  extractTokenFromRequest,
  verifySessionToken,
  type AuthUser,
  type UserRole,
} from './session.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    next();
    return;
  }

  const payload = verifySessionToken(token);
  if (!payload) {
    next();
    return;
  }

  pool
    .query<{ id: string; name: string; email: string; role: UserRole }>(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [payload.sub],
    )
    .then(({ rows }) => {
      if (rows.length > 0) {
        const row = rows[0];
        req.user = {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
        };
      }
      next();
    })
    .catch((err) => {
      next(err);
    });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}

export function requireParticipant(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  if (req.user.role !== 'participant') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

export function requireOrganizer(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  if (req.user.role !== 'organizer') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

export function requirePartnerApiKey(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header('X-Api-Key');
  const expected = config.partnerApiKey;

  if (typeof provided !== 'string' || provided.length === 0 || !expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const providedHash = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const isEqual =
    crypto.timingSafeEqual(providedHash, expectedHash) && provided.length === expected.length;

  if (!isEqual) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}
