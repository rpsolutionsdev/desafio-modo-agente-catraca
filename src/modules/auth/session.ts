import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../../shared/config.js';

export type UserRole = 'organizer' | 'participant';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface SessionPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export const SESSION_COOKIE_NAME = 'catraca_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function signHmac(data: string): Buffer {
  return crypto.createHmac('sha256', config.authSecret).update(data, 'utf8').digest();
}

export function signSessionToken(
  user: Pick<AuthUser, 'id' | 'role'>,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureB64 = signHmac(payloadB64).toString('base64url');
  return `${payloadB64}.${signatureB64}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) {
    return null;
  }

  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(signatureB64, 'base64url');
  } catch {
    return null;
  }

  const expectedSig = signHmac(payloadB64);
  if (providedSig.length !== expectedSig.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(providedSig, expectedSig)) {
    return null;
  }

  try {
    const raw = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<SessionPayload>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.sub !== 'string' ||
      parsed.sub.length === 0 ||
      (parsed.role !== 'organizer' && parsed.role !== 'participant') ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp <= now) {
      return null;
    }

    return {
      sub: parsed.sub,
      role: parsed.role,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return result;
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }

  return result;
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (match && match[1]) {
      return match[1];
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
  });
}
