import { localDateKey, type FixtureView } from '@quickkicks/shared';

/** "Premier League · Sat 27 Sep, 15:00" — the one-line summary a lobby shows above the teams. */
export function fixtureMeta(fixture: FixtureView): string {
  const kickoff = new Date(fixture.kickoffAt).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${fixture.competition.name} · ${kickoff}`;
}

/**
 * Just the clock, for the left edge of a fixture row. `numeric` hours rather than `2-digit` so a
 * 12-hour locale reads "4:30 PM" instead of "04:30 PM".
 */
export function kickoffTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Today's `YYYY-MM-DD` in the viewer's timezone, which is what the day tabs are keyed by. */
export function todayKey(): string {
  return localDateKey(new Date().toISOString());
}

/**
 * Names a day tab. Relative labels for the two days people actually care about, and a date for
 * the rest. Built from the key rather than a Date so the label and the tab never disagree; noon
 * sidesteps the day flipping under a timezone offset.
 */
export function dayTabLabel(dateKey: string, today = todayKey()): string {
  const asDate = new Date(`${dateKey}T12:00:00`);
  const todayDate = new Date(`${today}T12:00:00`);
  const daysAway = Math.round((asDate.getTime() - todayDate.getTime()) / 86_400_000);

  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway === -1) return 'Yesterday';
  return asDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export interface LineupTiming {
  announced: boolean;
  /** Badge text: the state once the XIs are out, the expected time until then. */
  label: string;
  /** Tooltip for the host screen, where the badge is all the room there is. */
  hint: string;
  /** The expected (or actual) release time on its own, for pages writing their own copy. */
  at: string;
}

/**
 * What a screen says about a fixture's starting XIs, which is the only thing gating the draft.
 * Until they land the time is an estimate, so the label hedges with a tilde rather than promising.
 */
export function lineupTiming(fixture: FixtureView): LineupTiming {
  const at = kickoffTime(fixture.lineupsExpectedAt);
  if (fixture.lineupsAnnounced) {
    return {
      announced: true,
      label: 'XIs out',
      hint: `Starting XIs announced at ${at}. Draft as soon as everyone has joined.`,
      at,
    };
  }
  return {
    announced: false,
    label: `XIs ~${at}`,
    hint:
      `Starting XIs are expected around ${at}, about an hour before kickoff. Host now anyway — ` +
      `the lobby unlocks the draft by itself when they land.`,
    at,
  };
}
