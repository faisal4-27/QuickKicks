import type { MatchEventType, Position, PowerUpKind } from '../types/enums.js';

/**
 * A point value is either flat, or varies by the position of the player it happened to.
 * `default` covers any position not named explicitly.
 */
export type PointValue = number | ({ default: number } & Partial<Record<Position, number>>);

export interface PowerUpConfig {
  /** Match-minutes a power-up stays active once triggered. */
  durationMinutes: number;
  /** How many activations each manager gets for the whole match. Each kind is usable once. */
  chargesPerManager: number;
  /**
   * Whether one player may carry a second power-up while the first is still running. A manager's
   * two players can always be boosted at the same time; this only governs stacking on one player.
   */
  allowStackingOnPlayer: boolean;
  /** Multiplier a single matching power-up applies. */
  factor: number;
  /** Ceiling on the product of power-ups stacked on one player. */
  maxMultiplier: number;
  /**
   * Whether multipliers also amplify point losses. Off by default: doubling a
   * manager's misplaced passes turns a fun boost into a punishment.
   */
  applyToNegative: boolean;
  /** Whether a power-up can be armed before the match clock starts. */
  allowBeforeKickoff: boolean;
}

export interface SwapConfig {
  /** Swaps allowed per manager for the whole match. */
  maxPerManager: number;
  /** No swaps at or after this match-minute. */
  cutoffMinute: number;
}

export interface TradeConfig {
  /** Match-minutes a pending offer survives before it auto-expires. */
  offerExpiryMinutes: number;
  /** No new offers at or after this match-minute. */
  cutoffMinute: number;
}

export interface ScoringRules {
  version: number;
  base: Record<MatchEventType, PointValue>;
  powerUps: PowerUpConfig;
  swaps: SwapConfig;
  trades: TradeConfig;
}

/**
 * Tuned against 200 simulated matches (`npm run sim -- --runs 200`) with one goal: every
 * position should be worth drafting, with different risk profiles rather than different
 * expected values. Passes are deliberately small. At 0.1 a pass they dominated so completely
 * that the eight best players by expectation were all midfielders and defenders, and a forward
 * was worth barely half a midfielder, which is absurd in a game about goals.
 *
 * The resulting shape: midfielders and defenders are the steady floor, forwards and keepers are
 * streakier but pay out when they land. Rooms snapshot this object at creation time, so retuning
 * it never rewrites a match that has already been played.
 *
 * v2 keeps v1's ratios but puts them on a whole-number scale anchored at 1 point per completed
 * pass (v1 x20), so every total a manager sees is an integer.
 */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  version: 2,
  base: {
    'pass.completed': 1,
    'pass.missed': -1,
    'tackle.won': 20,
    interception: 20,
    'foul.committed': -10,
    'shot.on_target': 50,
    'shot.off_target': 0,
    'goal.scored': { default: 180, DEF: 200, GK: 240 },
    assist: 90,
    save: 40,
    'goal.conceded': { default: 0, DEF: -10, GK: -15 },
    'card.yellow': -20,
    'card.red': -60,
    'clean_sheet.awarded': { default: 0, MID: 20, DEF: 100, GK: 120 },
    'sub.on': 0,
    'sub.off': 0,
    'period.start': 0,
    'period.end': 0,
  },
  powerUps: {
    durationMinutes: 10,
    chargesPerManager: 3,
    allowStackingOnPlayer: false,
    factor: 2,
    maxMultiplier: 2,
    applyToNegative: false,
    allowBeforeKickoff: false,
  },
  swaps: {
    maxPerManager: 1,
    cutoffMinute: 60,
  },
  trades: {
    offerExpiryMinutes: 3,
    cutoffMinute: 75,
  },
};

/** Which event types each power-up amplifies. `double_all` matches everything. */
export const POWER_UP_TARGETS: Record<PowerUpKind, readonly MatchEventType[] | 'all'> = {
  double_passes: ['pass.completed', 'pass.missed'],
  double_goals: ['goal.scored'],
  double_all: 'all',
};
