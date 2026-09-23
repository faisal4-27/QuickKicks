import type { MatchStatus, RoomStatus } from '@quickkicks/shared';
import { redis } from './client.js';
import { ROOM_STATE_FIELDS as F, keys } from './keys.js';

export interface RoomLiveState {
  status: RoomStatus;
  currentPickNumber: number;
  currentMemberId: string | null;
  pickDeadlineMs: number | null;
  matchMinute: number;
  matchStatus: MatchStatus;
  homeGoals: number;
  awayGoals: number;
  clockStartedAt: number | null;
  /** Last provider sequence consumed, so a restart resumes without re-reading everything. */
  sequence: number;
}

const DEFAULTS: RoomLiveState = {
  status: 'lobby',
  currentPickNumber: 0,
  currentMemberId: null,
  pickDeadlineMs: null,
  matchMinute: 0,
  matchStatus: 'scheduled',
  homeGoals: 0,
  awayGoals: 0,
  clockStartedAt: null,
  sequence: 0,
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maybeNum(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'null') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readRoomState(roomId: string): Promise<RoomLiveState | null> {
  const raw = await redis.hgetall(keys.roomState(roomId));
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    status: (raw[F.status] as RoomStatus | undefined) ?? DEFAULTS.status,
    currentPickNumber: num(raw[F.currentPickNumber], DEFAULTS.currentPickNumber),
    currentMemberId: raw[F.currentMemberId] && raw[F.currentMemberId] !== 'null'
      ? (raw[F.currentMemberId] as string)
      : null,
    pickDeadlineMs: maybeNum(raw[F.pickDeadlineMs]),
    matchMinute: num(raw[F.matchMinute], DEFAULTS.matchMinute),
    matchStatus: (raw[F.matchStatus] as MatchStatus | undefined) ?? DEFAULTS.matchStatus,
    homeGoals: num(raw[F.homeGoals], 0),
    awayGoals: num(raw[F.awayGoals], 0),
    clockStartedAt: maybeNum(raw[F.clockStartedAt]),
    sequence: num(raw[F.sequence], 0),
  };
}

export async function writeRoomState(
  roomId: string,
  patch: Partial<RoomLiveState>,
): Promise<void> {
  const fields: Record<string, string> = {};
  if (patch.status !== undefined) fields[F.status] = patch.status;
  if (patch.currentPickNumber !== undefined)
    fields[F.currentPickNumber] = String(patch.currentPickNumber);
  if (patch.currentMemberId !== undefined)
    fields[F.currentMemberId] = patch.currentMemberId ?? 'null';
  if (patch.pickDeadlineMs !== undefined)
    fields[F.pickDeadlineMs] = patch.pickDeadlineMs === null ? 'null' : String(patch.pickDeadlineMs);
  if (patch.matchMinute !== undefined) fields[F.matchMinute] = String(patch.matchMinute);
  if (patch.matchStatus !== undefined) fields[F.matchStatus] = patch.matchStatus;
  if (patch.homeGoals !== undefined) fields[F.homeGoals] = String(patch.homeGoals);
  if (patch.awayGoals !== undefined) fields[F.awayGoals] = String(patch.awayGoals);
  if (patch.clockStartedAt !== undefined)
    fields[F.clockStartedAt] = patch.clockStartedAt === null ? 'null' : String(patch.clockStartedAt);
  if (patch.sequence !== undefined) fields[F.sequence] = String(patch.sequence);

  if (Object.keys(fields).length === 0) return;
  await redis.hset(keys.roomState(roomId), fields);
}

export function emptyRoomState(): RoomLiveState {
  return { ...DEFAULTS };
}

export async function clearRoomState(roomId: string): Promise<void> {
  await redis.del(
    keys.roomState(roomId),
    keys.scores(roomId),
    keys.available(roomId),
    keys.owners(roomId),
    keys.powerUps(roomId),
  );
}
