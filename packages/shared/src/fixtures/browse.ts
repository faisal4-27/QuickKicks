import type { Competition } from '../types/entities.js';
import { LINEUP_RELEASE_LEAD_MINUTES } from '../types/enums.js';
import type { FixtureView } from '../types/view.js';

export interface CompetitionGroup {
  competition: Competition;
  fixtures: FixtureView[];
}

export interface CountryGroup {
  /** "World" for continental and international competitions. */
  name: string;
  code: string | null;
  flagUrl: string | null;
  competitions: CompetitionGroup[];
}

export interface FixtureDay {
  /** `YYYY-MM-DD` in the viewer's timezone, which is also the tab's identity. */
  date: string;
  countries: CountryGroup[];
  fixtureCount: number;
}

export interface GroupOptions {
  /**
   * IANA zone to bucket days in. Defaults to wherever the code is running, which is what the
   * browser wants; tests pass it explicitly so a 20:00 kickoff lands on a predictable day.
   */
  timeZone?: string;
}

/**
 * The day a kickoff falls on, as the viewer experiences it. A 20:00 UTC kickoff is tonight in
 * London and this afternoon in New York, so the day tabs cannot be computed from the UTC date.
 * `en-CA` is the shortest route to a `YYYY-MM-DD` string, which sorts lexicographically.
 */
export function localDateKey(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

/** When the starting XIs are expected, given a kickoff. An estimate: no feed publishes this. */
export function expectedLineupRelease(kickoffAt: string): string {
  return new Date(
    new Date(kickoffAt).getTime() - LINEUP_RELEASE_LEAD_MINUTES * 60_000,
  ).toISOString();
}

/**
 * A country sorts by the competition people most want to see in it, so England leads on the
 * Premier League's priority rather than on an also-ran cup sharing the same country.
 */
function countryRank(group: CountryGroup): number {
  return Math.min(...group.competitions.map((c) => c.competition.priority));
}

/**
 * Folds a flat fixture list into the shape the host screen draws: a tab per day, and within a
 * day a section per country, and within that a block per competition. Ordering is by competition
 * `priority` throughout so the seed (and later the provider config) decides what leads, with
 * name as a stable tiebreak.
 */
export function groupFixturesByDay(
  fixtures: readonly FixtureView[],
  opts: GroupOptions = {},
): FixtureDay[] {
  const byDate = new Map<string, Map<string, CountryGroup>>();

  for (const fixture of fixtures) {
    const date = localDateKey(fixture.kickoffAt, opts.timeZone);
    let countries = byDate.get(date);
    if (!countries) {
      countries = new Map();
      byDate.set(date, countries);
    }

    const { competition } = fixture;
    let country = countries.get(competition.countryName);
    if (!country) {
      country = {
        name: competition.countryName,
        code: competition.countryCode,
        flagUrl: competition.flagUrl,
        competitions: [],
      };
      countries.set(competition.countryName, country);
    }

    let group = country.competitions.find((c) => c.competition.id === competition.id);
    if (!group) {
      group = { competition, fixtures: [] };
      country.competitions.push(group);
    }
    group.fixtures.push(fixture);
  }

  return [...byDate.entries()]
    .map(([date, countries]) => {
      const groups = [...countries.values()];
      for (const country of groups) {
        for (const group of country.competitions) {
          group.fixtures.sort(
            (a, b) =>
              a.kickoffAt.localeCompare(b.kickoffAt) || a.homeTeam.name.localeCompare(b.homeTeam.name),
          );
        }
        country.competitions.sort(
          (a, b) =>
            a.competition.priority - b.competition.priority ||
            a.competition.name.localeCompare(b.competition.name),
        );
      }
      groups.sort((a, b) => countryRank(a) - countryRank(b) || a.name.localeCompare(b.name));

      return {
        date,
        countries: groups,
        fixtureCount: groups.reduce(
          (sum, country) =>
            sum + country.competitions.reduce((n, group) => n + group.fixtures.length, 0),
          0,
        ),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
