import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@quickkicks/shared';
import type { FastifyInstance } from 'fastify';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../env.js';
import { DomainError, memberFor } from '../domain/room/roomService.js';
import { buildRoomSnapshot, publishMembers } from '../domain/room/snapshot.js';
import { startDraft, submitPick } from '../domain/draft/draftService.js';
import { activatePowerUp } from '../domain/powerups/powerUpService.js';
import { executeSwap } from '../domain/roster/swapService.js';
import { cancelTrade, proposeTrade, respondToTrade } from '../domain/roster/tradeService.js';
import { publishToRoom, subscribeToAllRooms } from '../redis/pubsub.js';
import { redis } from '../redis/client.js';
import { keys } from '../redis/keys.js';
import { readSessionFromCookieHeader } from '../http/session.js';
import { markConnected, markDisconnected } from './presence.js';

interface SocketData {
  userId: string;
  roomId: string | null;
  memberId: string | null;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/** Turns any thrown error into a message a manager can act on. */
async function guard(action: string, socket: AppSocket, ack: Ack, fn: () => Promise<void>) {
  try {
    await fn();
    ack({ ok: true });
  } catch (error) {
    const message =
      error instanceof DomainError
        ? error.message
        : ((error as Error)?.message ?? 'Something went wrong.');
    if (!(error instanceof DomainError)) console.error(`[ws:${action}]`, error);
    ack({ ok: false, message });
    socket.emit('action:error', { action, message });
  }
}

export async function createGateway(app: FastifyInstance): Promise<Server> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(
    app.server as HttpServer,
    {
      cors: { origin: env.WEB_ORIGIN, credentials: true },
      // Small friend-group rooms: no need for long polling fallbacks or big buffers.
      transports: ['websocket', 'polling'],
    },
  );

  // The session cookie is the only credential, so it is checked once at handshake time.
  io.use((socket, next) => {
    const userId = readSessionFromCookieHeader(socket.request.headers.cookie, (value) =>
      app.unsignCookie(value),
    );
    if (!userId) {
      next(new Error('Pick a name first.'));
      return;
    }
    socket.data.userId = userId;
    socket.data.roomId = null;
    socket.data.memberId = null;
    next();
  });

  // One pattern subscription fans every room delta out to the sockets in that room.
  await subscribeToAllRooms((roomId, event, payload) => {
    io.to(roomId).emit(event, payload as never);
  });

  io.on('connection', (socket: AppSocket) => {
    socket.on('room:subscribe', (payload, ack) =>
      guard('room:subscribe', socket, ack, async () => {
        const member = await memberFor(payload.roomId, socket.data.userId);
        if (!member) throw new DomainError('You are not in this room.');

        // Leaving any previous room keeps a reconnect from double-subscribing.
        if (socket.data.roomId && socket.data.roomId !== payload.roomId) {
          await leaveRoom(socket);
        }

        socket.data.roomId = payload.roomId;
        socket.data.memberId = member.id;
        await socket.join(payload.roomId);
        await markConnected(payload.roomId, member.id);

        socket.emit('room:snapshot', await buildRoomSnapshot(payload.roomId));
      }),
    );

    socket.on('room:start-draft', (_payload, ack) =>
      guard('room:start-draft', socket, ack, async () => {
        const roomId = requireRoom(socket);
        await startDraft(roomId, socket.data.userId);
      }),
    );

    socket.on('draft:pick', (payload, ack) =>
      guard('draft:pick', socket, ack, async () => {
        const roomId = requireRoom(socket);
        const memberId = requireMemberId(socket);
        await submitPick(roomId, memberId, payload.playerId);
      }),
    );

    socket.on('powerup:activate', (payload, ack) =>
      guard('powerup:activate', socket, ack, async () => {
        const roomId = requireRoom(socket);
        const memberId = requireMemberId(socket);
        const { powerUp } = await activatePowerUp(
          roomId,
          memberId,
          payload.playerId,
          payload.kind,
        );
        await publishToRoom(roomId, 'powerup:activated', {
          memberId,
          powerUp: {
            id: powerUp.id,
            playerId: powerUp.playerId,
            kind: powerUp.kind,
            activatedAtMinute: powerUp.activatedAtMinute,
            expiresAtMinute: powerUp.expiresAtMinute,
            active: powerUp.active,
          },
        });
        await publishMembers(roomId);
      }),
    );

    socket.on('swap:execute', (payload, ack) =>
      guard('swap:execute', socket, ack, async () => {
        const roomId = requireRoom(socket);
        const memberId = requireMemberId(socket);
        const result = await executeSwap(roomId, memberId, payload.outPlayerId, payload.inPlayerId);
        await publishToRoom(roomId, 'swap:executed', {
          ...result,
          availablePlayerIds: await redis.smembers(keys.available(roomId)),
        });
        await publishMembers(roomId);
      }),
    );

    socket.on('trade:propose', (payload, ack) =>
      guard('trade:propose', socket, ack, async () => {
        const roomId = requireRoom(socket);
        const memberId = requireMemberId(socket);
        const trade = await proposeTrade({
          roomId,
          fromMemberId: memberId,
          toMemberId: payload.toMemberId,
          offeredPlayerId: payload.offeredPlayerId,
          requestedPlayerId: payload.requestedPlayerId,
        });
        await publishToRoom(roomId, 'trade:proposed', { trade });
      }),
    );

    socket.on('trade:respond', (payload, ack) =>
      guard('trade:respond', socket, ack, async () => {
        const roomId = requireRoom(socket);
        const memberId = requireMemberId(socket);
        const { trade, applied } = await respondToTrade(
          roomId,
          memberId,
          payload.tradeId,
          payload.accept,
        );
        await publishToRoom(roomId, 'trade:resolved', { trade });
        if (applied) await publishMembers(roomId);
      }),
    );

    socket.on('trade:cancel', (payload, ack) =>
      guard('trade:cancel', socket, ack, async () => {
        const roomId = requireRoom(socket);
        const memberId = requireMemberId(socket);
        const trade = await cancelTrade(roomId, memberId, payload.tradeId);
        await publishToRoom(roomId, 'trade:resolved', { trade });
      }),
    );

    socket.on('disconnect', () => {
      void leaveRoom(socket);
    });
  });

  return io;
}

async function leaveRoom(socket: AppSocket): Promise<void> {
  const { roomId, memberId } = socket.data;
  if (!roomId || !memberId) return;
  await socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.memberId = null;
  await markDisconnected(roomId, memberId);
}

function requireRoom(socket: AppSocket): string {
  const roomId = socket.data.roomId;
  if (!roomId) throw new DomainError('Join a room first.');
  return roomId;
}

function requireMemberId(socket: AppSocket): string {
  const memberId = socket.data.memberId;
  if (!memberId) throw new DomainError('Join a room first.');
  return memberId;
}

