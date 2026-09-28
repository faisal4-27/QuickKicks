import {
  draftPositionForPick,
  totalPicks as calcTotalPicks,
  type DraftPickView,
} from '@quickkicks/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { draftPicks, fixtures, players as playersTable, roomMembers } from '../../db/schema.js';
import { redis } from '../../redis/client.js';
import { keys } from '../../redis/keys.js';
import { withLock } from '../../redis/locks.js';
import { emptyRoomState, readRoomState, writeRoomState } from '../../redis/roomState.js';
import { publishToRoom } from '../../redis/pubsub.js';
import { startMatchClock } from '../clock/matchClock.js';
import { markOwned, openSlot } from '../roster/rosterService.js';
import { DomainError, primeAvailablePool, setRoomStatus } from '../room/roomService.js';
import { loadMembers, loadRoom } from '../room/snapshot.js';

/** One pending autopick per room. The draft only ever has one manager on the clock. */
const pickTimers = new Map<string, NodeJS.Timeout>();

function clearPickTimer(roomId: string): void {
  const timer = pickTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    pickTimers.delete(roomId);
  }
}

export function clearAllPickTimers(): void {
  for (const roomId of [...pickTimers.keys()]) clearPickTimer(roomId);
}

/**
 * Draft order is randomised at the start rather than following join order. With only two rounds
 * the first pick is worth a lot, and whoever happened to click the link first should not own it.
 */
async function assignRandomDraftOrder(roomId: string): Promise<void> {
  const members = await loadMembers(roomId);
  const shuffled = [...members];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = shuffled[i]!;
    const b = shuffled[j]!;
    shuffled[i] = b;
    shuffled[j] = a;
  }

  await db.transaction(async (tx) => {
    // draft_position is unique per room, so park the rows out of the way before reassigning.
    for (const [index, member] of shuffled.entries()) {
      await tx
        .update(roomMembers)
        .set({ draftPosition: -(index + 1) })
        .where(eq(roomMembers.id, member.id));
    }
    for (const [index, member] of shuffled.entries()) {
      await tx
        .update(roomMembers)
        .set({ draftPosition: index })
        .where(eq(roomMembers.id, member.id));
    }
  });
}

export async function startDraft(roomId: string, userId: string): Promise<void> {
  const room = await loadRoom(roomId);
  const members = await loadMembers(roomId);

  if (room.hostUserId !== userId) throw new DomainError('Only the host can start the draft.');
  if (room.status !== 'lobby') throw new DomainError('The draft has already started.');
  if (members.length < room.draftConfig.minManagers) {
    throw new DomainError(
      `You need at least ${room.draftConfig.minManagers} managers to start.`,
    );
  }

  // The pool is the announced starting XIs, so without them there is nothing honest to draft.
  const fixture = (
    await db
      .select({ lineupsAnnouncedAt: fixtures.lineupsAnnouncedAt })
      .from(fixtures)
      .where(eq(fixtures.id, room.fixtureId))
      .limit(1)
  )[0];
  if (!fixture?.lineupsAnnouncedAt) {
    throw new DomainError(
      'The starting XIs for this match are not out yet. They usually land about an hour before kickoff.',
    );
  }

  // Rebuilt from the lineup now rather than trusted from room creation: the XIs may have been
  // announced (or revised) while the lobby was waiting.
  await primeAvailablePool(roomId);
  const poolSize = await redis.scard(keys.available(roomId));
  const needed = calcTotalPicks(members.length, room.draftConfig.rounds);
  if (poolSize < needed) {
    // 22 starters and two picks each caps a room at 11 managers.
    throw new DomainError(
      `Only ${poolSize} players are available, but this draft needs ${needed}.`,
    );
  }

  await assignRandomDraftOrder(roomId);
  await setRoomStatus(roomId, 'drafting');
  await publishToRoom(roomId, 'room:status', { status: 'drafting' });

  const reordered = await loadMembers(roomId);
  await openTurn(roomId, 1, reordered.length, room.draftConfig.rounds, room.draftConfig.pickTimerSeconds);
}

interface TurnInfo {
  memberId: string;
  pickNumber: number;
  round: number;
  deadlineMs: number;
}

async function openTurn(
  roomId: string,
  pickNumber: number,
  memberCount: number,
  rounds: number,
  pickTimerSeconds: number,
): Promise<TurnInfo | null> {
  const position = draftPositionForPick(pickNumber, memberCount, rounds);
  if (position === null) return null;

  const members = await loadMembers(roomId);
  const member = members.find((m) => m.draftPosition === position);
  if (!member) throw new Error(`No manager at draft position ${position}`);

  const deadlineMs = Date.now() + pickTimerSeconds * 1000;
  const round = Math.floor((pickNumber - 1) / memberCount) + 1;

  await writeRoomState(roomId, {
    currentPickNumber: pickNumber,
    currentMemberId: member.id,
    pickDeadlineMs: deadlineMs,
  });

  const turn: TurnInfo = { memberId: member.id, pickNumber, round, deadlineMs };
  await publishToRoom(roomId, 'draft:turn', turn);
  scheduleAutopick(roomId, pickNumber, member.id, pickTimerSeconds * 1000);
  return turn;
}

/**
 * Autopick exists so one manager stepping away cannot stall the room. It takes the best player
 * left by rating, which is both defensible and predictable.
 */
function scheduleAutopick(
  roomId: string,
  pickNumber: number,
  memberId: string,
  delayMs: number,
): void {
  clearPickTimer(roomId);
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const state = await readRoomState(roomId);
        // Someone picked in the meantime, so this timer is stale.
        if (!state || state.currentPickNumber !== pickNumber) return;
        const playerId = await bestAvailablePlayer(roomId);
        if (!playerId) return;
        await submitPick(roomId, memberId, playerId, { autopick: true });
      } catch (error) {
        console.error(`[draft] autopick failed for room ${roomId}`, error);
      }
    })();
  }, Math.max(0, delayMs));
  pickTimers.set(roomId, timer);
}

export async function bestAvailablePlayer(roomId: string): Promise<string | null> {
  const availableIds = await redis.smembers(keys.available(roomId));
  if (availableIds.length === 0) return null;
  const rows = await db
    .select({ id: playersTable.id, rating: playersTable.rating })
    .from(playersTable);
  const availableSet = new Set(availableIds);
  const candidates = rows
    .filter((r) => availableSet.has(r.id))
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
}

export interface SubmitPickOptions {
  autopick?: boolean;
}

export async function submitPick(
  roomId: string,
  memberId: string,
  playerId: string,
  opts: SubmitPickOptions = {},
): Promise<DraftPickView> {
  const room = await loadRoom(roomId);
  if (room.status !== 'drafting') throw new DomainError('The draft is not running.');

  const members = await loadMembers(roomId);
  const memberCount = members.length;
  const rounds = room.draftConfig.rounds;

  const pick = await withLock(keys.turnLock(roomId), async () => {
    const state = (await readRoomState(roomId)) ?? emptyRoomState();
    if (state.currentMemberId !== memberId) {
      throw new DomainError("It is not your turn to pick.");
    }

    const pickNumber = state.currentPickNumber;
    const round = Math.floor((pickNumber - 1) / memberCount) + 1;

    if ((await redis.sismember(keys.available(roomId), playerId)) !== 1) {
      throw new DomainError('That player is already taken.');
    }

    const view = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(draftPicks)
        .values({
          roomId,
          round,
          pickNumber,
          memberId,
          playerId,
          wasAutopick: opts.autopick ?? false,
        })
        .returning();
      if (!row) throw new Error('Failed to record the pick');

      // Round 1 fills slot 0, round 2 fills slot 1.
      await openSlot(tx, {
        roomId,
        memberId,
        playerId,
        slotIndex: round - 1,
        minute: 0,
        via: 'draft',
      });

      return {
        pickNumber: row.pickNumber,
        round: row.round,
        memberId: row.memberId,
        playerId: row.playerId,
        wasAutopick: row.wasAutopick,
      } satisfies DraftPickView;
    });

    await markOwned(roomId, playerId, memberId);
    clearPickTimer(roomId);
    return view;
  });

  if (!pick) throw new DomainError('Someone else was mid-pick. Try again.');

  const available = await redis.smembers(keys.available(roomId));
  await publishToRoom(roomId, 'draft:pick-made', { pick, availablePlayerIds: available });

  const nextPickNumber = pick.pickNumber + 1;
  if (nextPickNumber > calcTotalPicks(memberCount, rounds)) {
    await completeDraft(roomId);
  } else {
    await openTurn(roomId, nextPickNumber, memberCount, rounds, room.draftConfig.pickTimerSeconds);
  }

  return pick;
}

/** The last pick ends the draft and starts the match clock, which is what kicks the match off. */
async function completeDraft(roomId: string): Promise<void> {
  clearPickTimer(roomId);
  await writeRoomState(roomId, { currentMemberId: null, pickDeadlineMs: null });

  const picks = await db
    .select()
    .from(draftPicks)
    .where(eq(draftPicks.roomId, roomId))
    .orderBy(draftPicks.pickNumber);

  await publishToRoom(roomId, 'draft:complete', {
    picks: picks.map((p) => ({
      pickNumber: p.pickNumber,
      round: p.round,
      memberId: p.memberId,
      playerId: p.playerId,
      wasAutopick: p.wasAutopick,
    })),
  });

  await setRoomStatus(roomId, 'live');
  await writeRoomState(roomId, { matchStatus: 'live', clockStartedAt: Date.now() });
  await publishToRoom(roomId, 'room:status', { status: 'live' });
  await startMatchClock(roomId);
}

/** Restores the pick timer for a room that was mid-draft when the process restarted. */
export async function resumeDraftTimer(roomId: string): Promise<void> {
  const room = await loadRoom(roomId);
  if (room.status !== 'drafting') return;
  const state = await readRoomState(roomId);
  if (!state?.currentMemberId) {
    await primeAvailablePool(roomId);
    return;
  }
  const remaining = Math.max(1000, (state.pickDeadlineMs ?? Date.now()) - Date.now());
  scheduleAutopick(roomId, state.currentPickNumber, state.currentMemberId, remaining);
}
