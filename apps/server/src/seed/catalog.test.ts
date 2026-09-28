import { POSITIONS, type Position } from '@quickkicks/shared';
import { describe, expect, it } from 'vitest';
import { catalog, kickoffFor } from './catalog.js';

/**
 * The seed is hand-written data spread across a file per league, so these are the invariants the
 * rest of the system quietly assumes. The starter shape is the sharpest one: the simulator charges
 * a conceded goal to the keeper plus every starting defender, and `MockMatchDataProvider.test.ts`
 * asserts exactly five players are charged per goal, which only holds at 1 GK and 4 DEF.
 */
function shapeOf(players: readonly { position: Position; starter: boolean }[], starter: boolean) {
  return POSITIONS.map((p) => players.filter((x) => x.starter === starter && x.position === p).length);
}

describe('seed squads', () => {
  it('fields a full matchday squad for every team', () => {
    for (const team of catalog.teams) {
      expect(team.players, team.externalRef).toHaveLength(16);
    }
  });

  it('starts 1 GK, 4 DEF, 3 MID and 3 FWD, which the conceded-goal charge depends on', () => {
    for (const team of catalog.teams) {
      expect(shapeOf(team.players, true), team.externalRef).toEqual([1, 4, 3, 3]);
      expect(shapeOf(team.players, false), team.externalRef).toEqual([1, 2, 1, 1]);
    }
  });

  it('keeps every player ref unique, because it is the upsert key', () => {
    const refs = catalog.teams.flatMap((t) => t.players.map((p) => p.externalRef));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('prefixes a player ref with its own team, so a squad is readable from the refs alone', () => {
    for (const team of catalog.teams) {
      const prefix = `mock:${team.shortName.toLowerCase()}:`;
      for (const player of team.players) {
        expect(player.externalRef.startsWith(prefix), player.externalRef).toBe(true);
      }
    }
  });

  it('leads with Chelsea and Liverpool, which the database-free sim and scenarios name directly', () => {
    expect(catalog.teams.slice(0, 2).map((t) => t.externalRef)).toEqual([
      'mock:team:che',
      'mock:team:liv',
    ]);
  });
});

describe('seed fixtures', () => {
  it('points every fixture at a competition and two different seeded teams', () => {
    const teamRefs = new Set(catalog.teams.map((t) => t.externalRef));
    const competitionRefs = new Set(catalog.competitions.map((c) => c.externalRef));

    for (const fixture of catalog.fixtures) {
      expect(competitionRefs.has(fixture.competitionRef), fixture.externalRef).toBe(true);
      expect(teamRefs.has(fixture.homeTeamRef), fixture.externalRef).toBe(true);
      expect(teamRefs.has(fixture.awayTeamRef), fixture.externalRef).toBe(true);
      expect(fixture.homeTeamRef).not.toBe(fixture.awayTeamRef);
    }
  });

  it('announces exactly one fixture, so a host can draft at once and still see the waiting state', () => {
    const announced = catalog.fixtures.filter((f) => f.lineupsAnnounced);
    expect(announced.map((f) => f.externalRef)).toEqual(['mock:fixture:che-liv']);
  });

  it('spreads fixtures over today and the days after, never the past', () => {
    const offsets = catalog.fixtures.map((f) => f.dayOffset);
    expect(Math.min(...offsets)).toBe(0);
    expect(new Set(offsets).size).toBeGreaterThan(2);
  });

  it('covers several countries plus the continental competitions', () => {
    const countries = new Set(catalog.competitions.map((c) => c.countryName));
    expect(countries.has('World')).toBe(true);
    expect(countries.size).toBeGreaterThanOrEqual(5);
  });

  it('resolves a kickoff against the day the seed runs', () => {
    const monday = new Date('2026-05-11T08:00:00');
    const kickoff = kickoffFor(
      { ...catalog.fixtures[0]!, dayOffset: 2, kickoffTime: '19:45' },
      monday,
    );
    expect(kickoff.getDate()).toBe(13);
    expect(kickoff.getHours()).toBe(19);
    expect(kickoff.getMinutes()).toBe(45);
  });
});
