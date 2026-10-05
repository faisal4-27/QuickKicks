import type { MatchEventType, Position } from '../types/enums.js';
import { cleanSheetClaimant, concededMinutes } from './cleanSheet.js';
import { activeKindsAt, ownerAt, type OwnershipStint, type PowerUpWindow } from './ownership.js';
import type { ScoringRules } from './rules.js';
import { roundPoints, scoreEvent } from './score.js';

export interface ReplayEvent {
  minute: number;
  type: MatchEventType;
  playerRef: string;
}

export interface ReplayInput {
  events: readonly ReplayEvent[];
  positions: Readonly<Record<string, Position>>;
  /**
   * Which team each player belongs to. Only clean sheets need it — they turn on whether the
   * player's *team* conceded, which no single event carries.
   */
  teams: Readonly<Record<string, string>>;
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
 * Minutes at which `teamRef` conceded, picking the goals out of a replay's event list. A scorer
 * missing from `teams` counts as the opposition on purpose: an unmapped scorer is a bug either way,
 * and withholding a clean sheet is the kinder failure than inventing one.
 */
export function concededMinutesFor(
  events: readonly ReplayEvent[],
  teams: Readonly<Record<string, string>>,
  teamRef: string,
): number[] {
  const goals = events
    .filter((e) => e.type === 'goal.scored' || e.type === 'goal.own')
    .map((e) => ({
      minute: e.minute,
      teamRef: teams[e.playerRef] ?? '',
      ownGoal: e.type === 'goal.own',
    }));
  return concededMinutes(goals, teamRef);
}

/**
 * The canonical definition of what a match was worth, as a pure function.
 *
 * The server's live engine writes the same rows incrementally as events arrive; this exists to
 * pin the rules that are otherwise only implicit in that flow, and to make them testable without
 * a database. In particular it defines the carry-over policy: points are attributed to whoever
 * owned the player at the minute of the event, so a manager keeps what they earned and never
 * inherits what someone else did.
 *
 * Clean sheets are the one exception, because they are a claim about a stretch of the match rather
 * than a moment — see `cleanSheet.ts`.
 */
export function replayLedger(input: ReplayInput): ReplayResult {
  const entries: ReplayEntry[] = [];
  const totals: Record<string, number> = {};
  const byMemberPlayer: Record<string, number> = {};

  const finalMinute = input.events.reduce((latest, e) => Math.max(latest, e.minute), 0);

  for (const event of input.events) {
    const position = input.positions[event.playerRef];
    if (!position) continue;

    const memberId =
      event.type === 'clean_sheet.awarded'
        ? cleanSheetClaimant({
            stints: input.stints,
            playerRef: event.playerRef,
            concededMinutes: concededMinutesFor(
              input.events,
              input.teams,
              input.teams[event.playerRef] ?? '',
            ),
            finalMinute,
            config: input.rules.cleanSheet,
          })
        : ownerAt(input.stints, event.playerRef, event.minute);
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
