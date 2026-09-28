import type { Player, Team } from '@quickkicks/shared';
import { describe, expect, it } from 'vitest';
import { buildLineup, starterIds, type LineupSource } from './lineup.js';

const team = (id: string): Team => ({
  id,
  externalRef: `ref:${id}`,
  name: id,
  shortName: id,
  crestUrl: null,
  countryName: null,
  national: false,
});
const player = (id: string, teamId: string): Player => ({
  id,
  externalRef: `ref:${id}`,
  teamId,
  fullName: id,
  position: 'MID',
  shirtNumber: null,
  rating: 70,
});

function source(starters: string[]): LineupSource {
  return {
    matchId: 'm',
    homeTeam: team('home'),
    awayTeam: team('away'),
    homePlayers: [player('h1', 'home'), player('h2', 'home')],
    awayPlayers: [player('a1', 'away'), player('a2', 'away')],
    starterIds: new Set(starters),
  };
}

describe('lineup', () => {
  it('offers nobody before the lineups are announced', () => {
    expect(starterIds(source([]))).toEqual([]);
    expect(buildLineup(source([])).home.players.every((p) => !p.isStarter)).toBe(true);
  });

  it('draft pool is exactly the announced starters, bench excluded', () => {
    expect(starterIds(source(['h1', 'a2']))).toEqual(['h1', 'a2']);
    const lineup = buildLineup(source(['h1', 'a2']));
    expect(lineup.home.players.map((p) => p.isStarter)).toEqual([true, false]);
    expect(lineup.away.players.map((p) => p.isStarter)).toEqual([false, true]);
  });
});
