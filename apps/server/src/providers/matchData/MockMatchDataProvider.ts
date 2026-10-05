import {
  emptyStatLine,
  type Lineup,
  type MatchEvent,
  type MatchSnapshot,
  type MatchStatus,
  type PlayerStatLine,
} from '@quickkicks/shared';
import type {
  DrivableMatchDataProvider,
  MatchEventHandler,
  SubscribeOptions,
  Subscription,
} from './MatchDataProvider.js';
import { DEFAULT_SIMULATION_CONFIG, simulateMatch, type SimulationConfig } from './simulator/simulate.js';

export interface MockProviderOptions {
  matchId: string;
  lineup: Lineup;
  /** Ratings by player ref, used to weight the simulation. */
  ratings?: Record<string, number>;
  /** Any string replays the same match every time. */
  seed?: string | number;
  /** Supply events directly to replay a scripted scenario instead of simulating. */
  events?: MatchEvent[];
  config?: Partial<SimulationConfig>;
}

/**
 * Generates a whole match up-front, then hands it out as the room clock steps forward. Holding
 * the full timeline in memory is fine at this scale and buys determinism: the same seed always
 * produces the same match, so a failing scoring test is reproducible.
 */
export class MockMatchDataProvider implements DrivableMatchDataProvider {
  readonly name = 'mock';
  readonly finalMinute: number;

  private readonly matchId: string;
  private readonly lineup: Lineup;
  private readonly events: MatchEvent[];
  private readonly halfTimeMinute: number;
  private cursor = 0;
  private currentMinute = 0;
  private handler: MatchEventHandler | null = null;

  constructor(options: MockProviderOptions) {
    const config = { ...DEFAULT_SIMULATION_CONFIG, ...options.config };
    this.matchId = options.matchId;
    this.lineup = options.lineup;
    this.finalMinute = config.finalMinute;
    this.halfTimeMinute = config.halfTimeMinute;
    this.events =
      options.events ??
      simulateMatch({
        matchId: options.matchId,
        lineup: options.lineup,
        seed: options.seed ?? options.matchId,
        ...(options.ratings ? { ratings: options.ratings } : {}),
        config,
      });
  }

  async getLineups(): Promise<Lineup> {
    return this.lineup;
  }

  async subscribe(
    matchId: string,
    handler: MatchEventHandler,
    opts: SubscribeOptions = {},
  ): Promise<Subscription> {
    this.assertMatch(matchId);
    this.handler = handler;
    if (opts.sinceSequence !== undefined) {
      // Resume: skip everything already consumed rather than replaying it.
      this.cursor = this.events.findIndex((e) => e.sequence > opts.sinceSequence!);
      if (this.cursor === -1) this.cursor = this.events.length;
      const last = this.events[Math.max(0, this.cursor - 1)];
      this.currentMinute = last ? last.minute : 0;
    }
    return {
      unsubscribe: () => {
        this.handler = null;
      },
    };
  }

  /** Steps the timeline. Called by the room clock, which is the only timer in the system. */
  async advanceTo(matchId: string, minute: number): Promise<void> {
    this.assertMatch(matchId);
    this.currentMinute = Math.min(minute, this.finalMinute);
    while (this.cursor < this.events.length) {
      const event = this.events[this.cursor]!;
      if (event.minute > this.currentMinute) break;
      this.cursor += 1;
      if (this.handler) await this.handler(event);
    }
  }

  async getSnapshot(matchId: string): Promise<MatchSnapshot> {
    this.assertMatch(matchId);
    return this.snapshotAt(this.currentMinute);
  }

  /** Cumulative stats through `minute`, from the same timeline the stream serves. */
  snapshotAt(minute: number): MatchSnapshot {
    const perPlayer: Record<string, PlayerStatLine> = {};
    let home = 0;
    let away = 0;

    const lineFor = (ref: string): PlayerStatLine => {
      const existing = perPlayer[ref];
      if (existing) return existing;
      const fresh = emptyStatLine();
      perPlayer[ref] = fresh;
      return fresh;
    };

    for (const event of this.events) {
      if (event.minute > minute) break;
      if (!event.playerRef) continue;
      const line = lineFor(event.playerRef);
      switch (event.type) {
        case 'pass.completed': line.passesCompleted += 1; break;
        case 'pass.missed': line.passesMissed += 1; break;
        case 'tackle.won': line.tackles += 1; break;
        case 'interception': line.interceptions += 1; break;
        case 'foul.committed': line.fouls += 1; break;
        case 'shot.on_target': line.shotsOnTarget += 1; break;
        case 'shot.off_target': line.shotsOffTarget += 1; break;
        case 'assist': line.assists += 1; break;
        case 'save': line.saves += 1; break;
        case 'goal.conceded': line.goalsConceded += 1; break;
        case 'card.yellow': line.yellowCards += 1; break;
        case 'card.red': line.redCards += 1; break;
        case 'clean_sheet.awarded': line.cleanSheet = true; break;
        case 'goal.scored':
          line.goals += 1;
          // A goal was a shot on target. The stream does not emit one for it — that would score
          // the shot twice — so the stat line adds it back here.
          line.shotsOnTarget += 1;
          if (event.teamRef === this.lineup.home.teamRef) home += 1;
          else away += 1;
          break;
        case 'goal.own':
          if (event.teamRef === this.lineup.home.teamRef) away += 1;
          else home += 1;
          break;
        default: break;
      }
      line.minutesPlayed = Math.max(line.minutesPlayed, event.minute);
    }

    return {
      matchId: this.matchId,
      status: this.statusAt(minute),
      minute,
      score: { home, away },
      perPlayer,
    };
  }

  /** The full generated timeline, for the headless CLI and for tests. */
  allEvents(): readonly MatchEvent[] {
    return this.events;
  }

  private statusAt(minute: number): MatchStatus {
    if (minute <= 0) return 'scheduled';
    if (minute >= this.finalMinute) return 'finished';
    if (minute === this.halfTimeMinute) return 'half_time';
    return 'live';
  }

  private assertMatch(matchId: string): void {
    if (matchId !== this.matchId) {
      throw new Error(`MockMatchDataProvider is bound to ${this.matchId}, got ${matchId}`);
    }
  }
}
