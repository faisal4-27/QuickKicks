import type { MatchEventType, Position, PowerUpKind } from '../types/enums.js';
import { NON_SCORING_EVENT_TYPES } from '../types/enums.js';
import { POWER_UP_TARGETS, type PointValue, type PowerUpConfig, type ScoringRules } from './rules.js';

/** Points are stored to 2dp in Postgres; keep every intermediate value on the same grid. */
export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100;
}

export function basePointsFor(
  type: MatchEventType,
  position: Position,
  rules: ScoringRules,
): number {
  const value: PointValue | undefined = rules.base[type];
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  const positional = value[position];
  return positional === undefined ? value.default : positional;
}

export function isScoringEvent(type: MatchEventType): boolean {
  return !NON_SCORING_EVENT_TYPES.includes(type);
}

function powerUpMatches(kind: PowerUpKind, type: MatchEventType): boolean {
  const targets = POWER_UP_TARGETS[kind];
  return targets === 'all' || targets.includes(type);
}

/**
 * Resolves the multiplier for one event given the power-ups active at that match-minute.
 * Losses are left alone unless the ruleset opts in via `applyToNegative`.
 */
export function resolveMultiplier(
  type: MatchEventType,
  basePoints: number,
  activeKinds: readonly PowerUpKind[],
  config: PowerUpConfig,
): number {
  if (basePoints === 0) return 1;
  if (basePoints < 0 && !config.applyToNegative) return 1;

  let multiplier = 1;
  for (const kind of activeKinds) {
    if (powerUpMatches(kind, type)) multiplier *= config.factor;
  }
  return Math.min(multiplier, config.maxMultiplier);
}

export interface ScoredEvent {
  basePoints: number;
  multiplier: number;
  awardedPoints: number;
}

/**
 * The single source of truth for what an event is worth. The server persists the result
 * as a ledger row; the web client calls the same function to explain points in the UI.
 */
export function scoreEvent(
  type: MatchEventType,
  position: Position,
  activeKinds: readonly PowerUpKind[],
  rules: ScoringRules,
): ScoredEvent {
  if (!isScoringEvent(type)) {
    return { basePoints: 0, multiplier: 1, awardedPoints: 0 };
  }
  const basePoints = roundPoints(basePointsFor(type, position, rules));
  const multiplier = resolveMultiplier(type, basePoints, activeKinds, rules.powerUps);
  return {
    basePoints,
    multiplier,
    awardedPoints: roundPoints(basePoints * multiplier),
  };
}

/** Formats a point total the way the UI shows it: trimmed, signed where useful. */
export function formatPoints(value: number, opts: { signed?: boolean } = {}): string {
  const rounded = roundPoints(value);
  const body = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  if (opts.signed && rounded > 0) return `+${body}`;
  return body;
}
