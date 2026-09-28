import type { Lineup, MatchEvent, MatchSnapshot } from '@quickkicks/shared';

export interface Subscription {
  unsubscribe(): Promise<void> | void;
}

export interface SubscribeOptions {
  /**
   * Resume point. Combined with the unique index on (room_id, provider_event_id), this is what
   * stops a restart from silently scoring every event a second time.
   */
  sinceSequence?: number;
}

export type MatchEventHandler = (event: MatchEvent) => Promise<void>;

export interface MatchDataProvider {
  readonly name: string;

  /** The draft pool. Kept separate from the event stream so drafting never waits on kickoff. */
  getLineups(matchId: string): Promise<Lineup>;

  /**
   * Cumulative stats. Used for recovery, and later for reconciliation: real providers revise
   * history (VAR reassigns a goal, pass counts get corrected), and the fix is to diff this
   * against the ledger and append adjustment rows rather than mutate what was already awarded.
   */
  getSnapshot(matchId: string): Promise<MatchSnapshot>;

  /**
   * The event stream is a scoring stream, not a stats feed: one thing that happened on the pitch
   * produces exactly one scoring event. In particular a shot that goes in is delivered as
   * `goal.scored` alone, never as `shot.on_target` followed by `goal.scored`, because scoring pays
   * every event it is handed and would otherwise pay one shot twice. Real feeds do emit both, so
   * collapsing that pair is the adapter's job — do it here, not in the scoring rules.
   */
  subscribe(
    matchId: string,
    handler: MatchEventHandler,
    opts?: SubscribeOptions,
  ): Promise<Subscription>;
}

/**
 * A provider whose timeline we control. Simulations can be stepped; the real world cannot,
 * which is exactly why this is a separate interface rather than an optional method on every
 * provider. The room clock is the only timer in the system: it steps a drivable provider, and
 * for a real provider it would instead poll `getSnapshot` to learn the current minute.
 */
export interface DrivableMatchDataProvider extends MatchDataProvider {
  readonly finalMinute: number;
  /** Emits every not-yet-delivered event up to and including `minute`. */
  advanceTo(matchId: string, minute: number): Promise<void>;
}

export function isDrivable(
  provider: MatchDataProvider,
): provider is DrivableMatchDataProvider {
  return typeof (provider as DrivableMatchDataProvider).advanceTo === 'function';
}

export type { Lineup, MatchEvent, MatchSnapshot };
