import { type OwnershipStint, ownerAt } from './ownership.js';
import type { CleanSheetConfig } from './rules.js';

/**
 * Minutes at which `teamRef` conceded, read off the goals the other side scored. A fixture has
 * exactly two teams, so every goal not scored by this team is one it let in.
 *
 * This exists so the direction of that comparison is written down once: the live engine reads goals
 * out of Postgres and `replayLedger` reads them out of an event list, and the two must not be
 * allowed to disagree about which way round it goes.
 */
export function concededMinutes(
  goals: readonly { minute: number; teamRef: string }[],
  teamRef: string,
): number[] {
  return goals.filter((goal) => goal.teamRef !== teamRef).map((goal) => goal.minute);
}

export interface CleanSheetClaim {
  /** Stints for the player being settled. Stints for other players are ignored. */
  stints: readonly OwnershipStint[];
  playerRef: string;
  /** Minutes at which this player's team conceded, in any order. */
  concededMinutes: readonly number[];
  /** Used to close out a stint that is still open, which is the usual case at full time. */
  finalMinute: number;
  config: CleanSheetConfig;
}

/**
 * Who, if anyone, earned this player's clean sheet.
 *
 * Unlike every other event, a clean sheet is not a moment — it is a claim about a stretch of the
 * match, so it cannot be settled by asking who owned the player at one minute. A manager earns it
 * by holding the player long enough (`minMinutesOwned`, summed across stints) *and* by the team
 * keeping the ball out of the net for the whole time they held him. Conceding before a manager
 * arrived is not their problem; conceding in the 90th minute while they still hold the player
 * costs them the lot.
 *
 * Because `minMinutesOwned` is more than half a match, at most one manager can qualify, so this
 * still produces at most one ledger row per clean sheet. The return type says so.
 */
export function cleanSheetClaimant(claim: CleanSheetClaim): string | null {
  const mine = claim.stints.filter((s) => s.playerRef === claim.playerRef);

  const minutesOwned = new Map<string, number>();
  for (const stint of mine) {
    const to = stint.toMinute ?? claim.finalMinute;
    const held = Math.max(0, to - stint.fromMinute);
    minutesOwned.set(stint.memberId, (minutesOwned.get(stint.memberId) ?? 0) + held);
  }

  // A concession counts against whoever held the player at that minute, using the same ownership
  // lookup as every other event. An open final stint covers the whistle, which is what makes a
  // 90th-minute goal take the clean sheet away from the manager still holding him.
  const conceded = new Set<string>();
  for (const minute of claim.concededMinutes) {
    const owner = ownerAt(mine, claim.playerRef, minute);
    if (owner) conceded.add(owner);
  }

  let claimant: string | null = null;
  let longest = 0;
  for (const [memberId, minutes] of minutesOwned) {
    if (minutes < claim.config.minMinutesOwned || conceded.has(memberId)) continue;
    if (minutes > longest) {
      claimant = memberId;
      longest = minutes;
    }
  }
  return claimant;
}
