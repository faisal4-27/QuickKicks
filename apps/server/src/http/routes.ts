import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  DomainError,
  createRoom,
  createUser,
  joinRoom,
  memberFor,
  renameUser,
} from '../domain/room/roomService.js';
import { RoomNotFoundError, buildRoomSnapshot } from '../domain/room/snapshot.js';
import { buildRecap } from '../domain/scoring/recap.js';
import { clearSessionCookie, currentUser, requireUser, setSessionCookie } from './session.js';

const nameSchema = z.object({ displayName: z.string().min(2).max(24) });
const joinSchema = z.object({ joinCode: z.string().min(4).max(10) });
const createSchema = z.object({
  rounds: z.coerce.number().int().min(1).max(3).optional(),
  pickTimerSeconds: z.coerce.number().int().min(5).max(180).optional(),
  maxManagers: z.coerce.number().int().min(2).max(11).optional(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  app.get('/api/session', async (request, reply) => {
    const user = await currentUser(request);
    if (!user) return reply.code(401).send({ error: 'No session' });
    return { user };
  });

  app.post('/api/session', async (request, reply) => {
    const body = nameSchema.parse(request.body);
    const existing = await currentUser(request);
    // Reuse the row on a rename so a manager keeps their seat and their points.
    const user = existing
      ? await renameUser(existing.id, body.displayName)
      : await createUser(body.displayName);
    setSessionCookie(reply, user.id);
    return { user };
  });

  app.delete('/api/session', async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/api/rooms', async (request) => {
    const user = await requireUser(request);
    const body = createSchema.parse(request.body ?? {});
    return createRoom(user, body);
  });

  app.post('/api/rooms/join', async (request) => {
    const user = await requireUser(request);
    const body = joinSchema.parse(request.body);
    return joinRoom(user, body.joinCode);
  });

  app.get<{ Params: { roomId: string } }>('/api/rooms/:roomId', async (request) => {
    const user = await requireUser(request);
    const snapshot = await buildRoomSnapshot(request.params.roomId);
    const member = await memberFor(request.params.roomId, user.id);
    return { ...snapshot, myMemberId: member?.id ?? null };
  });

  app.get<{ Params: { roomId: string } }>('/api/rooms/:roomId/recap', async (request) => {
    await requireUser(request);
    return { recap: await buildRecap(request.params.roomId) };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(400).send({ error: error.message });
    }
    if (error instanceof RoomNotFoundError) {
      return reply.code(404).send({ error: 'That room does not exist. Check the code.' });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'That input does not look right.' });
    }
    const failure = error as { statusCode?: number; message?: string };
    const statusCode = failure.statusCode ?? 500;
    if (statusCode >= 500) console.error('[http]', error);
    return reply.code(statusCode).send({ error: failure.message || 'Something went wrong.' });
  });
}
