import type { MatchEventType, Position, PowerUpKind } from '../types/enums.js';
import type { ScoringRules } from './rules.js';
import { roundPoints, scoreEvent } from './score.js';

export interface OwnershipStint {
  memberId: string;
  playerRef: string;
  fromMinute: number;
  /** Null while still held. */
  toMinute: number | null;
}

export interface PowerUpWindow {
  memberId: string;
  /** Power-ups boost one player, and only while the manager who activated it owns them. */
  playerRef: string;
  kind: PowerUpKind;
  fromMinute: number;
  toMinute: number;
}

export interface ReplayEvent {
  minute: number;
  type: MatchEventType;
  playerRef: string;
}

export interface ReplayInput {
  events: readonly ReplayEvent[];
  positions: Readonly<Record<string, Position>>;
  stints: readonly OwnershipStint[];
  powerUps: readonly PowerUpWindow[];
  rules: ScoringRules;
}

export interface ReplayEntry extends ReplayEvent {
  memberId: string;
  basePoints: number;
  multiplier: number;
  awardedPoints: number;
}

export interface ReplayResult {
  entries: ReplayEntry[];
  totals: Record<string, number>;
  byMemberPlayer: Record<string, number>;
}

/**
 * A stint covers [fromMinute, toMinute). A swap at 70' therefore closes the old stint and opens
 * the new one at the same minute, and an event stamped 70' pays the incoming manager.
 */
export function ownerAt(
  stints: readonly OwnershipStint[],
  playerRef: string,
  minute: number,
): string | null {
  const stint = stints.find(
    (s) =>
      s.playerRef === playerRef &&
      s.fromMinute <= minute &&
      (s.toMinute === null || minute < s.toMinute),
  );
  return stint?.memberId ?? null;
}

/**
 * Active over [fromMinute, toMinute), so a 20'-30' boost no longer applies at 30'. Matching on
 * the manager as well as the player means a boosted player who is traded away mid-window does
 * not carry the boost to the new owner.
 */
export function activeKindsAt(
  powerUps: readonly PowerUpWindow[],
  memberId: string,
  playerRef: string,
  minute: number,
): PowerUpKind[] {
  return powerUps
    .filter(
      (p) =>
        p.memberId === memberId &&
        p.playerRef === playerRef &&
        p.fromMinute <= minute &&
        minute < p.toMinute,
    )
    .map((p) => p.kind);
}

/**
 * The canonical definition of what a match was worth, as a pure function.
 *
 * The server's live engine writes the same rows incrementally as events arrive; this exists to
 * pin the rules that are otherwise only implicit in that flow, and to make them testable without
 * a database. In particular it defines the carry-over policy: points are attributed to whoever
 * owned the player at the minute of the event, so a manager keeps what they earned and never
 * inherits what someone else did.
 */
export function replayLedger(input: ReplayInput): ReplayResult {
  const entries: ReplayEntry[] = [];
  const totals: Record<string, number> = {};
  const byMemberPlayer: Record<string, number> = {};

  for (const event of input.events) {
    const position = input.positions[event.playerRef];
    if (!position) continue;

    const memberId = ownerAt(input.stints, event.playerRef, event.minute);
    if (!memberId) continue;

    const activeKinds = activeKindsAt(input.powerUps, memberId, event.playerRef, event.minute);
    const scored = scoreEvent(event.type, position, activeKinds, input.rules);
    if (scored.awardedPoints === 0) continue;

    entries.push({ ...event, memberId, ...scored });
    totals[memberId] = roundPoints((totals[memberId] ?? 0) + scored.awardedPoints);
    const key = `${memberId}:${event.playerRef}`;
    byMemberPlayer[key] = roundPoints((byMemberPlayer[key] ?? 0) + scored.awardedPoints);
  }

  return { entries, totals, byMemberPlayer };
}
