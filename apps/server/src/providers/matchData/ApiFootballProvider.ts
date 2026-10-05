import type { Lineup, LineupTeam, MatchSnapshot, PlayerStatLine } from '@quickkicks/shared';
import { apiGet } from '../apiFootball/client.js';
import { deriveEvents, statLineFrom } from '../apiFootball/derive.js';
import {
  apiRefs,
  isFullTime,
  mapPosition,
  mapStatus,
  minuteOf,
  shortNameFor,
} from '../apiFootball/refs.js';
import type { ApiFixture, ApiLineup } from '../apiFootball/types.js';
import type {
  MatchEventHandler,
  PollingMatchDataProvider,
  SubscribeOptions,
  Subscription,
} from './MatchDataProvider.js';

export interface ApiFootballProviderOptions {
  /** Our id for the match; events carry it as `matchId`. The room id, like the mock. */
  matchId: string;
  /** API-Football's fixture id. */
  fixtureId: number;
  /** The lineup announced to the draft. Fills in sides and positions the payload leaves out. */
  lineup: Lineup;
  pollIntervalMs: number;
}

/**
 * Live match data from API-Football, one request per poll: `/fixtures?id=` embeds the timeline,
 * the lineups and every player's running totals, and `deriveEvents` turns that into the scoring
 * stream. The response is cached for just under a poll interval, so every room on the fixture —
 * and a server restarting mid-match — shares the same request.
 *
 * Deliberately not drivable: reality cannot be stepped, so the room clock polls this instead.
 */
export class ApiFootballProvider implements PollingMatchDataProvider {
  readonly name = 'api-football';
  readonly pollIntervalMs: number;

  private readonly options: ApiFootballProviderOptions;
  private handler: MatchEventHandler | null = null;
  private sequence = 0;
  private readonly delivered = new Set<string>();

  constructor(options: ApiFootballProviderOptions) {
    this.options = options;
    this.pollIntervalMs = options.pollIntervalMs;
  }

  async getLineups(matchId: string): Promise<Lineup> {
    this.assertMatch(matchId);
    const teams = await apiGet<ApiLineup[]>('/fixtures/lineups', { fixture: this.options.fixtureId });
    const [home, away] = teams;
    if (!home || !away) return this.options.lineup;
    return { matchId, home: lineupTeam(home), away: lineupTeam(away) };
  }

  async getSnapshot(matchId: string): Promise<MatchSnapshot> {
    this.assertMatch(matchId);
    return snapshotOf(matchId, await this.fetchFixture());
  }

  async subscribe(
    matchId: string,
    handler: MatchEventHandler,
    opts: SubscribeOptions = {},
  ): Promise<Subscription> {
    this.assertMatch(matchId);
    this.handler = handler;
    // Event ids are deterministic, so resuming only has to keep new sequence numbers above the
    // old ones; anything re-derived that was already recorded is dropped at ingest.
    this.sequence = opts.sinceSequence ?? 0;
    return {
      unsubscribe: () => {
        this.handler = null;
      },
    };
  }

  async poll(matchId: string): Promise<MatchSnapshot> {
    this.assertMatch(matchId);
    const fixture = await this.fetchFixture();
    const snapshot = snapshotOf(matchId, fixture);

    const events = deriveEvents(fixture, this.options.lineup, {
      minute: snapshot.minute,
      finished: isFullTime(fixture.fixture.status.short),
    });
    for (const event of events) {
      if (this.delivered.has(event.id)) continue;
      if (!this.handler) break;
      this.sequence += 1;
      await this.handler({ ...event, matchId, sequence: this.sequence });
      this.delivered.add(event.id);
    }
    return snapshot;
  }

  private async fetchFixture(): Promise<ApiFixture> {
    const rows = await apiGet<ApiFixture[]>(
      '/fixtures',
      { id: this.options.fixtureId },
      { cacheSeconds: Math.max(5, Math.floor(this.pollIntervalMs / 1000) - 2) },
    );
    const fixture = rows[0];
    if (!fixture) throw new Error(`API-Football has no fixture ${this.options.fixtureId}`);
    return fixture;
  }

  private assertMatch(matchId: string): void {
    if (matchId !== this.options.matchId) {
      throw new Error(`ApiFootballProvider is bound to ${this.options.matchId}, got ${matchId}`);
    }
  }
}

function snapshotOf(matchId: string, fixture: ApiFixture): MatchSnapshot {
  const status = mapStatus(fixture.fixture.status.short);
  const elapsed = minuteOf(fixture.fixture.status.elapsed);
  const perPlayer: Record<string, PlayerStatLine> = {};
  for (const block of fixture.players ?? []) {
    for (const entry of block.players) {
      const stats = entry.statistics[0];
      if (stats) perPlayer[apiRefs.player(entry.player.id)] = statLineFrom(stats);
    }
  }
  return {
    matchId,
    status,
    // A completed match sits on its last minute, never earlier than the regulation whistle.
    minute: isFullTime(fixture.fixture.status.short) ? Math.max(90, elapsed) : elapsed,
    score: { home: fixture.goals.home ?? 0, away: fixture.goals.away ?? 0 },
    perPlayer,
  };
}

function lineupTeam(team: ApiLineup): LineupTeam {
  const players = (starter: boolean) => (entry: ApiLineup['startXI'][number]) => ({
    playerRef: apiRefs.player(entry.player.id),
    fullName: entry.player.name,
    position: mapPosition(entry.player.pos),
    shirtNumber: entry.player.number,
    isStarter: starter,
  });
  return {
    teamRef: apiRefs.team(team.team.id),
    name: team.team.name,
    shortName: shortNameFor(team.team.name),
    players: [...team.startXI.map(players(true)), ...team.substitutes.map(players(false))],
  };
}
