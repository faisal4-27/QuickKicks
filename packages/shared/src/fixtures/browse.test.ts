import { describe, expect, it } from 'vitest';
import type { Competition, Team } from '../types/entities.js';
import type { FixtureView } from '../types/view.js';
import { expectedLineupRelease, groupFixturesByDay, localDateKey } from './browse.js';

function competition(
  name: string,
  countryName: string,
  priority: number,
  countryCode: string | null = null,
): Competition {
  return {
    id: `comp:${name}`,
    externalRef: null,
    name,
    type: 'league',
    countryName,
    countryCode,
    flagUrl: null,
    logoUrl: null,
    priority,
  };
}

const premierLeague = competition('Premier League', 'England', 1, 'GB');
const laLiga = competition('La Liga', 'Spain', 2, 'ES');
const faCup = competition('FA Cup', 'England', 20, 'GB');
const championsLeague = competition('UEFA Champions League', 'World', 10);

function team(name: string): Team {
  return {
    id: `team:${name}`,
    externalRef: null,
    name,
    shortName: name.slice(0, 3).toUpperCase(),
    crestUrl: null,
    countryName: null,
    national: false,
  };
}

function fixture(comp: Competition, home: string, away: string, kickoffAt: string): FixtureView {
  return {
    id: `${home}-${away}`,
    homeTeam: team(home),
    awayTeam: team(away),
    competition: comp,
    round: null,
    kickoffAt,
    lineupsAnnounced: false,
    lineupsExpectedAt: expectedLineupRelease(kickoffAt),
  };
}

describe('localDateKey', () => {
  it('buckets a kickoff by the viewer day, not the UTC day', () => {
    // 00:30 UTC on the 12th is still the evening of the 11th in New York.
    expect(localDateKey('2026-05-12T00:30:00.000Z', 'UTC')).toBe('2026-05-12');
    expect(localDateKey('2026-05-12T00:30:00.000Z', 'America/New_York')).toBe('2026-05-11');
    expect(localDateKey('2026-05-12T00:30:00.000Z', 'Australia/Sydney')).toBe('2026-05-12');
  });
});

describe('expectedLineupRelease', () => {
  it('lands an hour before kickoff', () => {
    expect(expectedLineupRelease('2026-05-12T15:00:00.000Z')).toBe('2026-05-12T14:00:00.000Z');
  });
});

describe('groupFixturesByDay', () => {
  const fixtures: FixtureView[] = [
    fixture(laLiga, 'Barcelona', 'Sevilla', '2026-05-12T19:00:00.000Z'),
    fixture(faCup, 'Arsenal', 'Chelsea', '2026-05-11T18:00:00.000Z'),
    fixture(premierLeague, 'Liverpool', 'Everton', '2026-05-11T14:00:00.000Z'),
    fixture(premierLeague, 'Brentford', 'Fulham', '2026-05-11T12:00:00.000Z'),
    fixture(championsLeague, 'Inter', 'Bayern Munich', '2026-05-12T20:00:00.000Z'),
  ];

  const days = groupFixturesByDay(fixtures, { timeZone: 'UTC' });

  it('splits into one day per calendar date, earliest first', () => {
    expect(days.map((d) => d.date)).toEqual(['2026-05-11', '2026-05-12']);
  });

  it('counts the fixtures on each day', () => {
    expect(days.map((d) => d.fixtureCount)).toEqual([3, 2]);
  });

  it('groups a country once even when it hosts several competitions', () => {
    const [first] = days;
    expect(first!.countries.map((c) => c.name)).toEqual(['England']);
    expect(first!.countries[0]!.competitions.map((c) => c.competition.name)).toEqual([
      'Premier League',
      'FA Cup',
    ]);
  });

  it('ranks a country by its strongest competition, not its weakest', () => {
    // England appears via the FA Cup at priority 20, but the Premier League at 1 is what ranks it.
    const [, second] = days;
    expect(second!.countries.map((c) => c.name)).toEqual(['Spain', 'World']);
  });

  it('orders fixtures within a competition by kickoff', () => {
    const league = days[0]!.countries[0]!.competitions[0]!;
    expect(league.fixtures.map((f) => f.homeTeam.name)).toEqual(['Brentford', 'Liverpool']);
  });

  it('carries continental competitions under World rather than inventing a country', () => {
    const world = days[1]!.countries.find((c) => c.name === 'World');
    expect(world?.code).toBeNull();
    expect(world?.competitions[0]?.competition.name).toBe('UEFA Champions League');
  });

  it('returns nothing for an empty list rather than an empty day', () => {
    expect(groupFixturesByDay([], { timeZone: 'UTC' })).toEqual([]);
  });
});
