import type { SessionUser } from '@quickkicks/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getUser } from '../domain/room/roomService.js';

export const SESSION_COOKIE = 'qk_session';

const COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  signed: true,
  maxAge: 60 * 60 * 24 * 30,
};

/**
 * Identity is a nickname in a signed cookie, no password. The users row still exists so ledger
 * foreign keys resolve, which means adding real accounts later is an additive migration rather
 * than a rewrite.
 */
export function setSessionCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(SESSION_COOKIE, userId, COOKIE_OPTIONS);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function readSessionUserId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export async function currentUser(request: FastifyRequest): Promise<SessionUser | null> {
  const userId = readSessionUserId(request);
  if (!userId) return null;
  return getUser(userId);
}

export async function requireUser(request: FastifyRequest): Promise<SessionUser> {
  const user = await currentUser(request);
  if (!user) {
    const error = new Error('Pick a name first.') as Error & { statusCode?: number };
    error.statusCode = 401;
    throw error;
  }
  return user;
}

/** Same cookie parsing, for the websocket handshake. */
export function readSessionFromCookieHeader(
  cookieHeader: string | undefined,
  unsign: (value: string) => { valid: boolean; value: string | null },
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== SESSION_COOKIE) continue;
    const raw = decodeURIComponent(rest.join('='));
    const unsigned = unsign(raw);
    return unsigned.valid && unsigned.value ? unsigned.value : null;
  }
  return null;
}
