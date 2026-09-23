import type { Position } from '@quickkicks/shared';

export interface PositionRates {
  passCompleted: number;
  passMissed: number;
  tackle: number;
  interception: number;
  foul: number;
  shot: number;
}

/**
 * Per-player, per-minute event rates, chosen so a 90 minute match lands near real numbers:
 * a busy midfielder finishes on roughly 45 completed passes at about 85% accuracy, each team
 * puts 4-5 shots on target, and the two sides share about 2.7 goals.
 *
 * Pass volume is the number that matters most, because passes dominate the point total if the
 * per-pass value and the per-minute rate drift apart.
 */
export const POSITION_RATES: Record<Position, PositionRates> = {
  GK: { passCompleted: 0.22, passMissed: 0.045, tackle: 0.002, interception: 0.004, foul: 0.002, shot: 0 },
  DEF: { passCompleted: 0.44, passMissed: 0.07, tackle: 0.033, interception: 0.022, foul: 0.015, shot: 0.004 },
  MID: { passCompleted: 0.5, passMissed: 0.085, tackle: 0.025, interception: 0.017, foul: 0.013, shot: 0.014 },
  FWD: { passCompleted: 0.25, passMissed: 0.07, tackle: 0.01, interception: 0.006, foul: 0.011, shot: 0.025 },
};

export const SHOT_ON_TARGET_P = 0.38;
export const ON_TARGET_CONVERSION_P = 0.3;
/** An on-target shot that is not a goal is usually, but not always, a keeper save. */
export const SAVE_GIVEN_NO_GOAL_P = 0.85;
export const ASSIST_P = 0.75;
export const YELLOW_GIVEN_FOUL_P = 0.09;
export const STRAIGHT_RED_GIVEN_FOUL_P = 0.004;

/** Finishing ability by position, applied on top of the base conversion rate. */
export const CONVERSION_BIAS: Record<Position, number> = { GK: 0.5, DEF: 0.8, MID: 1, FWD: 1.15 };

/** How likely each position is to be credited with an assist. */
export const ASSIST_WEIGHT: Record<Position, number> = { GK: 0.2, DEF: 1, MID: 3, FWD: 2.5 };

/** Turns a 0-100 rating into a modest activity multiplier. */
export function ratingFactor(rating: number): number {
  return Math.min(1.2, Math.max(0.8, rating / 80));
}
