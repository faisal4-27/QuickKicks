import type { Lineup, LineupPlayer, Position } from '@quickkicks/shared';
import { describe, expect, it } from 'vitest';
import { deriveEvents } from './derive.js';
import type { ApiEvent, ApiFixture, ApiPlayerStatistics } from './types.js';

const HOME = 40;
const AWAY = 49;
const team = (id: number) => `apifootball:team:${id}`;
const player = (id: number) => `apifootball:player:${id}`;

/** Home 1xx, away 2xx: x01 keeper, x02-x03 defenders, x04 midfielder, x05 forward, x06 bench defender. */
function squad(base: number): LineupPlayer[] {
  const spec: [number, Position, boolean][] = [
    [1, 'GK', true],
    [2, 'DEF', true],
    [3, 'DEF', true],
    [4, 'MID', true],
    [5, 'FWD', true],
    [6, 'DEF', false],
  ];
  return spec.map(([n, position, isStarter]) => ({
    playerRef: player(base + n),
    fullName: `P${base + n}`,
    position,
    shirtNumber: n,
    isStarter,
  }));
}

const lineup: Lineup = {
  matchId: 'room',
  home: { teamRef: team(HOME), name: 'Home', shortName: 'HOM', players: squad(100) },
  away: { teamRef: team(AWAY), name: 'Away', shortName: 'AWA', players: squad(200) },
};

function event(
  minute: number,
  teamId: number,
  type: string,
  detail: string,
  playerId: number | null,
  assistId: number | null = null,
): ApiEvent {
  return {
    time: { elapsed: minute, extra: null },
    team: { id: teamId, name: '', logo: null },
    player: { id: playerId, name: null },
    assist: { id: assistId, name: null },
    type,
    detail,
    comments: null,
  };
}

function stats(overrides: Partial<{ passes: number; accurate: string; shots: number; on: number; goals: number }>): ApiPlayerStatistics {
  return {
    games: { minutes: 30, number: 4, position: 'M', rating: null, captain: false, substitute: false },
    shots: { total: overrides.shots ?? null, on: overrides.on ?? null },
    goals: { total: overrides.goals ?? null, conceded: 0, assists: null, saves: null },
    passes: { total: overrides.passes ?? null, key: null, accuracy: overrides.accurate ?? null },
    tackles: { total: null, blocks: null, interceptions: null },
    fouls: { drawn: null, committed: null },
    cards: { yellow: 0, red: 0 },
  };
}

function fixture(events: ApiEvent[], playerStats: [number, number, ApiPlayerStatistics][] = []): ApiFixture {
  return {
    fixture: { id: 999, date: '2026-10-03T19:00:00+00:00', timestamp: 0, status: { long: '', short: '2H', elapsed: 60 } },
    league: { id: 39, name: 'Premier League', country: 'England', logo: null, flag: null, season: 2026, round: null },
    teams: { home: { id: HOME, name: 'Home', logo: null }, away: { id: AWAY, name: 'Away', logo: null } },
    goals: { home: 0, away: 0 },
    events,
    players: [HOME, AWAY].map((teamId) => ({
      team: { id: teamId, name: '', logo: null },
      players: playerStats
        .filter(([t]) => t === teamId)
        .map(([, id, s]) => ({ player: { id, name: '' }, statistics: [s] })),
    })),
  };
}

const live = { minute: 60, finished: false };
const summary = (events: ReturnType<typeof deriveEvents>) => events.map((e) => `${e.type} ${e.playerRef}`);

describe('deriveEvents', () => {
  it('turns a goal into the assist, the goal, and a concession for each keeper and defender on the pitch', () => {
    const events = deriveEvents(fixture([event(23, HOME, 'Goal', 'Normal Goal', 105, 104)]), lineup, live);
    expect(summary(events)).toEqual([
      `assist ${player(104)}`,
      `goal.scored ${player(105)}`,
      `goal.conceded ${player(201)}`,
      `goal.conceded ${player(202)}`,
      `goal.conceded ${player(203)}`,
    ]);
    expect(events.every((e) => e.minute === 23)).toBe(true);
  });

  it('charges an own goal to the scorer\'s side and pays nobody for it', () => {
    // The feed's team field is not trusted for own goals; the lineup says 202 plays for the away side.
    const events = deriveEvents(fixture([event(50, HOME, 'Goal', 'Own Goal', 202, 104)]), lineup, live);
    expect(summary(events)).toEqual([
      `goal.own ${player(202)}`,
      `goal.conceded ${player(201)}`,
      `goal.conceded ${player(202)}`,
      `goal.conceded ${player(203)}`,
    ]);
    expect(events[0]!.teamRef).toBe(team(AWAY));
  });

  it('ignores a missed penalty', () => {
    expect(deriveEvents(fixture([event(10, HOME, 'Goal', 'Missed Penalty', 105)]), lineup, live)).toEqual([]);
  });

  it('follows substitutions, whichever way round the feed names the two players', () => {
    const events = deriveEvents(
      fixture([
        // Documented order: player on, assist off.
        event(55, AWAY, 'subst', 'Substitution 1', 206, 202),
        // Reversed: the player already on the pitch is the one going off.
        event(56, AWAY, 'subst', 'Substitution 2', 203, 207),
        event(70, HOME, 'Goal', 'Normal Goal', 105),
      ]),
      lineup,
      live,
    );
    expect(summary(events)).toEqual([
      `sub.off ${player(202)}`,
      `sub.on ${player(206)}`,
      `sub.off ${player(203)}`,
      `sub.on ${player(207)}`,
      `goal.scored ${player(105)}`,
      `goal.conceded ${player(201)}`,
      `goal.conceded ${player(206)}`,
    ]);
  });

  it('turns a second yellow into a red and stops charging the dismissed player for goals', () => {
    const events = deriveEvents(
      fixture([
        event(30, AWAY, 'Card', 'Yellow Card', 202),
        event(40, AWAY, 'Card', 'Second Yellow card', 202),
        event(80, HOME, 'Goal', 'Penalty', 105),
      ]),
      lineup,
      live,
    );
    expect(summary(events)).toEqual([
      `card.yellow ${player(202)}`,
      `card.red ${player(202)}`,
      `goal.scored ${player(105)}`,
      `goal.conceded ${player(201)}`,
      `goal.conceded ${player(203)}`,
    ]);
    expect(events[1]!.meta).toEqual({ secondYellow: true });
  });

  it('expands running totals into one event each, never paying a scored shot as a shot on target', () => {
    const events = deriveEvents(
      fixture([], [[HOME, 105, stats({ passes: 5, accurate: '3', shots: 4, on: 3, goals: 1 })]]),
      lineup,
      live,
    );
    const count = (type: string) => events.filter((e) => e.type === type).length;
    expect(count('pass.completed')).toBe(3);
    expect(count('pass.missed')).toBe(2);
    expect(count('shot.on_target')).toBe(2);
    expect(count('shot.off_target')).toBe(1);
    expect(events.every((e) => e.minute === 60)).toBe(true);
  });

  it('gives a counted event the same id however many polls derive it', () => {
    const early = deriveEvents(fixture([], [[HOME, 104, stats({ passes: 10, accurate: '8' })]]), lineup, { minute: 20, finished: false });
    const later = deriveEvents(fixture([], [[HOME, 104, stats({ passes: 14, accurate: '11' })]]), lineup, { minute: 30, finished: false });
    const laterIds = new Set(later.map((e) => e.id));
    expect(early.every((e) => laterIds.has(e.id))).toBe(true);
    expect(later.filter((e) => !early.some((x) => x.id === e.id)).map((e) => e.type)).toEqual([
      'pass.completed',
      'pass.completed',
      'pass.completed',
      'pass.missed',
    ]);
  });

  it('offers clean sheets to every non-forward starter at full time, and only then', () => {
    const goal = [event(20, HOME, 'Goal', 'Normal Goal', 105)];
    expect(deriveEvents(fixture(goal), lineup, live).some((e) => e.type === 'clean_sheet.awarded')).toBe(false);

    const offered = deriveEvents(fixture(goal), lineup, { minute: 90, finished: true })
      .filter((e) => e.type === 'clean_sheet.awarded')
      .map((e) => e.playerRef);
    expect(offered).toEqual([101, 102, 103, 104, 201, 202, 203, 204].map(player));
  });
});
