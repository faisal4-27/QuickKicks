import { DEFAULT_SCORING_RULES, type DraftConfig, type SessionUser } from '@quickkicks/shared';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fixtures, roomMembers, rooms, users } from '../../db/schema.js';
import { env } from '../../env.js';
import { generateJoinCode, normalizeJoinCode } from '../../lib/joinCode.js';
import { keys } from '../../redis/keys.js';
import { redis } from '../../redis/client.js';
import { writeRoomState } from '../../redis/roomState.js';
import { fixturePlayers, lineupSource } from '../../seed/catalog.js';
import { starterIds } from '../../providers/matchData/lineup.js';
import { RoomNotFoundError, loadRoom, publishMembers } from './snapshot.js';

export const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  rounds: 2,
  pickTimerSeconds: 30,
  minManagers: 2,
  maxManagers: 8,
};

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export async function createUser(displayName: string): Promise<SessionUser> {
  const name = displayName.trim();
  if (name.length < 2 || name.length > 24) {
    throw new DomainError('Pick a name between 2 and 24 characters.');
  }
  const [row] = await db.insert(users).values({ displayName: name }).returning();
  if (!row) throw new Error('Failed to create user');
  return { id: row.id, displayName: row.displayName };
}

export async function getUser(userId: string): Promise<SessionUser | null> {
  const row = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  return row ? { id: row.id, displayName: row.displayName } : null;
}

export async function renameUser(userId: string, displayName: string): Promise<SessionUser> {
  const name = displayName.trim();
  if (name.length < 2 || name.length > 24) {
    throw new DomainError('Pick a name between 2 and 24 characters.');
  }
  const [row] = await db
    .update(users)
    .set({ displayName: name })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new DomainError('Session expired. Please pick a name again.');
  return { id: row.id, displayName: row.displayName };
}

export interface CreateRoomResult {
  roomId: string;
  joinCode: string;
  memberId: string;
}

export async function createRoom(
  user: SessionUser,
  fixtureId: string,
  overrides: Partial<DraftConfig> = {},
): Promise<CreateRoomResult> {
  const fixture = (
    await db.select({ status: fixtures.status }).from(fixtures).where(eq(fixtures.id, fixtureId)).limit(1)
  )[0];
  if (!fixture) throw new DomainError('That match does not exist. Pick another one.');
  if (fixture.status !== 'scheduled') {
    throw new DomainError('That match has already kicked off. Pick another one.');
  }

  const draftConfig: DraftConfig = { ...DEFAULT_DRAFT_CONFIG, ...overrides };

  if (draftConfig.rounds < 1 || draftConfig.rounds > 3) {
    throw new DomainError('Rounds must be between 1 and 3.');
  }

  const result = await db.transaction(async (tx) => {
    // Collisions are vanishingly unlikely at this scale, but a retry is cheaper than an error.
    let joinCode = generateJoinCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = (
        await tx.select({ id: rooms.id }).from(rooms).where(eq(rooms.joinCode, joinCode)).limit(1)
      )[0];
      if (!clash) break;
      joinCode = generateJoinCode();
    }

    const [room] = await tx
      .insert(rooms)
      .values({
        joinCode,
        hostUserId: user.id,
        fixtureId,
        status: 'lobby',
        draftConfig,
        scoringRules: DEFAULT_SCORING_RULES,
        msPerMatchMinute: env.MATCH_MS_PER_MINUTE,
      })
      .returning();
    if (!room) throw new Error('Failed to create room');

    const [member] = await tx
      .insert(roomMembers)
      .values({
        roomId: room.id,
        userId: user.id,
        displayName: user.displayName,
        draftPosition: 0,
        isHost: true,
      })
      .returning();
    if (!member) throw new Error('Failed to seat the host');

    return { roomId: room.id, joinCode: room.joinCode, memberId: member.id };
  });

  await writeRoomState(result.roomId, { status: 'lobby' });
  await primeAvailablePool(result.roomId);
  return result;
}

/**
 * Fills the available-player set from the fixture's announced starters. A no-op until the
 * lineups are announced, which is why `startDraft` runs it again right before the first pick.
 */
export async function primeAvailablePool(roomId: string): Promise<void> {
  const room = await loadRoom(roomId);
  const catalog = await fixturePlayers(db, room.fixtureId);
  const ids = starterIds(lineupSource(catalog, roomId));
  if (ids.length === 0) return;
  await redis.del(keys.available(roomId));
  await redis.sadd(keys.available(roomId), ...ids);
}

export async function findRoomByCode(joinCode: string) {
  const code = normalizeJoinCode(joinCode);
  if (code.length === 0) throw new DomainError('Enter a join code.');
  const row = (await db.select().from(rooms).where(eq(rooms.joinCode, code)).limit(1))[0];
  if (!row) throw new RoomNotFoundError(code);
  return row;
}

export interface JoinRoomResult {
  roomId: string;
  memberId: string;
  joinCode: string;
}

export async function joinRoom(user: SessionUser, joinCode: string): Promise<JoinRoomResult> {
  const room = await findRoomByCode(joinCode);

  const existing = (
    await db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id)))
      .limit(1)
  )[0];

  // Rejoining is always allowed: that is how a refresh or a dropped connection recovers.
  if (existing) {
    return { roomId: room.id, memberId: existing.id, joinCode: room.joinCode };
  }

  if (room.status !== 'lobby') {
    throw new DomainError('That game has already started.');
  }

  const memberId = await db.transaction(async (tx) => {
    const seated = await tx
      .select({ count: sql<number>`count(*)` })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, room.id));
    const count = Number(seated[0]?.count ?? 0);

    if (count >= room.draftConfig.maxManagers) {
      throw new DomainError(`This room is full (${room.draftConfig.maxManagers} managers).`);
    }

    const [member] = await tx
      .insert(roomMembers)
      .values({
        roomId: room.id,
        userId: user.id,
        displayName: user.displayName,
        draftPosition: count,
        isHost: false,
      })
      .returning();
    if (!member) throw new Error('Failed to seat the manager');
    return member.id;
  });

  await publishMembers(room.id);

  return { roomId: room.id, memberId, joinCode: room.joinCode };
}

export async function memberFor(roomId: string, userId: string) {
  const row = (
    await db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1)
  )[0];
  return row ?? null;
}

export async function requireMember(roomId: string, userId: string) {
  const member = await memberFor(roomId, userId);
  if (!member) throw new DomainError('You are not in this room.');
  return member;
}

export async function setRoomStatus(
  roomId: string,
  status: 'lobby' | 'drafting' | 'live' | 'finished',
): Promise<void> {
  const timestamps =
    status === 'drafting'
      ? { draftStartedAt: new Date() }
      : status === 'live'
        ? { matchStartedAt: new Date() }
        : status === 'finished'
          ? { finishedAt: new Date() }
          : {};
  await db.update(rooms).set({ status, ...timestamps }).where(eq(rooms.id, roomId));
  await writeRoomState(roomId, { status });
}
