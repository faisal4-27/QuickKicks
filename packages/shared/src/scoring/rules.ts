import type { MatchEventType, Position, PowerUpKind } from '../types/enums.js';

/**
 * A point value is either flat, or varies by the position of the player it happened to.
 * `default` covers any position not named explicitly.
 */
export type PointValue = number | ({ default: number } & Partial<Record<Position, number>>);

export interface PowerUpConfig {
  /** Match-minutes a power-up stays active once triggered. */
  durationMinutes: number;
  /** How many activations each manager gets for the whole match. */
  chargesPerManager: number;
  /** Whether a second power-up may be activated while one is still running. */
  allowOverlap: boolean;
  /** Multiplier a single matching power-up applies. */
  factor: number;
  /** Ceiling on the product of overlapping power-ups. */
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
 */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  version: 1,
  base: {
    'pass.completed': 0.05,
    'pass.missed': -0.05,
    'tackle.won': 1,
    interception: 1,
    'foul.committed': -0.5,
    'shot.on_target': 2.5,
    'shot.off_target': 0,
    'goal.scored': { default: 9, DEF: 10, GK: 12 },
    assist: 4.5,
    save: 2,
    'goal.conceded': { default: 0, DEF: -0.5, GK: -0.75 },
    'card.yellow': -1,
    'card.red': -3,
    'clean_sheet.awarded': { default: 0, MID: 1, DEF: 5, GK: 6 },
    'sub.on': 0,
    'sub.off': 0,
    'period.start': 0,
    'period.end': 0,
  },
  powerUps: {
    durationMinutes: 10,
    chargesPerManager: 2,
    allowOverlap: false,
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
