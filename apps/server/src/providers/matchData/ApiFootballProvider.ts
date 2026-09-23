import type { Lineup, MatchSnapshot } from '@quickkicks/shared';
import type {
  MatchDataProvider,
  MatchEventHandler,
  SubscribeOptions,
  Subscription,
} from './MatchDataProvider.js';

export interface ApiFootballConfig {
  apiKey: string;
  baseUrl?: string;
  /** Real providers are polled, not streamed. */
  pollIntervalMs?: number;
}

/**
 * Placeholder for the paid integration. It exists to prove the interface holds for a polling,
 * revising data source, and to record the two things that will differ from the mock:
 *
 *  1. Events arrive in batches and are redelivered. `sinceSequence` plus the unique index on
 *     (room_id, provider_event_id) is what keeps the ledger from double-counting.
 *  2. Stats get revised after the fact (VAR reassigns a goal, pass counts are corrected). The
 *     fix is to diff `getSnapshot` against the ledger and append adjustment rows, never to
 *     mutate what was already awarded.
 *
 * Note it deliberately does not implement DrivableMatchDataProvider: we cannot step reality, so
 * the room clock would follow `getSnapshot().minute` instead of driving it.
 */
export class ApiFootballProvider implements MatchDataProvider {
  readonly name = 'api-football';

  constructor(private readonly config: ApiFootballConfig) {
    if (!config.apiKey) throw new Error('ApiFootballProvider requires an apiKey');
  }

  async getLineups(_matchId: string): Promise<Lineup> {
    throw new Error('ApiFootballProvider.getLineups is not implemented yet');
  }

  async getSnapshot(_matchId: string): Promise<MatchSnapshot> {
    throw new Error('ApiFootballProvider.getSnapshot is not implemented yet');
  }

  async subscribe(
    _matchId: string,
    _handler: MatchEventHandler,
    _opts?: SubscribeOptions,
  ): Promise<Subscription> {
    throw new Error('ApiFootballProvider.subscribe is not implemented yet');
  }

  get pollIntervalMs(): number {
    return this.config.pollIntervalMs ?? 15_000;
  }
}
