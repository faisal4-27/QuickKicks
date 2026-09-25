import { describe, expect, it } from 'vitest';
import { POSITIONS } from '../types/enums.js';
import { DEFAULT_SCORING_RULES, type ScoringRules } from './rules.js';
import { basePointsFor, resolveMultiplier, roundPoints, scoreEvent } from './score.js';

const rules = DEFAULT_SCORING_RULES;

describe('basePointsFor', () => {
  it('reads flat values', () => {
    expect(basePointsFor('tackle.won', 'DEF', rules)).toBe(20);
  });

  it('prefers a positional value over the default', () => {
    expect(basePointsFor('goal.scored', 'FWD', rules)).toBe(180);
    expect(basePointsFor('goal.scored', 'GK', rules)).toBe(240);
  });

  it('falls back to the default for positions that are not named', () => {
    expect(basePointsFor('clean_sheet.awarded', 'FWD', rules)).toBe(0);
    expect(basePointsFor('clean_sheet.awarded', 'GK', rules)).toBe(120);
  });
});

describe('resolveMultiplier', () => {
  const config = rules.powerUps;

  it('is 1 with nothing active', () => {
    expect(resolveMultiplier('goal.scored', 180, [], config)).toBe(1);
  });

  it('doubles only the events a targeted power-up covers', () => {
    expect(resolveMultiplier('goal.scored', 180, ['double_goals'], config)).toBe(2);
    expect(resolveMultiplier('pass.completed', 1, ['double_goals'], config)).toBe(1);
    expect(resolveMultiplier('pass.completed', 1, ['double_passes'], config)).toBe(2);
  });

  it('doubles everything under double_all', () => {
    expect(resolveMultiplier('tackle.won', 20, ['double_all'], config)).toBe(2);
    expect(resolveMultiplier('assist', 90, ['double_all'], config)).toBe(2);
  });

  it('leaves losses alone, so a boost is never a punishment', () => {
    expect(resolveMultiplier('pass.missed', -1, ['double_passes'], config)).toBe(1);
    expect(resolveMultiplier('card.red', -60, ['double_all'], config)).toBe(1);
  });

  it('amplifies losses when a ruleset opts in', () => {
    const harsh: ScoringRules['powerUps'] = { ...config, applyToNegative: true };
    expect(resolveMultiplier('pass.missed', -1, ['double_passes'], harsh)).toBe(2);
  });

  it('caps the product of power-ups stacked on one player', () => {
    const stacking: ScoringRules['powerUps'] = {
      ...config,
      allowStackingOnPlayer: true,
      maxMultiplier: 2,
    };
    // double_passes and double_all would otherwise compound to 4x.
    expect(
      resolveMultiplier('pass.completed', 1, ['double_passes', 'double_all'], stacking),
    ).toBe(2);
  });

  it('honours a ruleset that allows compounding above 2x', () => {
    const generous: ScoringRules['powerUps'] = {
      ...config,
      allowStackingOnPlayer: true,
      maxMultiplier: 4,
    };
    expect(
      resolveMultiplier('pass.completed', 1, ['double_passes', 'double_all'], generous),
    ).toBe(4);
  });
});

describe('scoreEvent', () => {
  it('splits base points from the multiplier, which is what the ledger stores', () => {
    expect(scoreEvent('goal.scored', 'FWD', ['double_goals'], rules)).toEqual({
      basePoints: 180,
      multiplier: 2,
      awardedPoints: 360,
    });
  });

  it('awards nothing for structural events', () => {
    expect(scoreEvent('period.start', 'MID', ['double_all'], rules).awardedPoints).toBe(0);
    expect(scoreEvent('sub.on', 'MID', [], rules).awardedPoints).toBe(0);
  });

  it('scores a completed pass at 1, the anchor of the whole scale', () => {
    expect(scoreEvent('pass.completed', 'MID', [], rules).awardedPoints).toBe(1);
    expect(scoreEvent('pass.completed', 'MID', ['double_passes'], rules).awardedPoints).toBe(2);
  });

  it('only ever awards whole numbers', () => {
    const types = Object.keys(rules.base) as (keyof typeof rules.base)[];
    for (const type of types) {
      for (const position of POSITIONS) {
        for (const boosted of [false, true]) {
          const { awardedPoints } = scoreEvent(type, position, boosted ? ['double_all'] : [], rules);
          expect(Number.isInteger(awardedPoints), `${type} ${position}`).toBe(true);
        }
      }
    }
  });

  it('scores a goal by the position of the player who scored it', () => {
    expect(scoreEvent('goal.scored', 'GK', [], rules).awardedPoints).toBe(240);
    expect(scoreEvent('goal.scored', 'MID', [], rules).awardedPoints).toBe(180);
  });
});

describe('roundPoints', () => {
  it('rounds to a whole number', () => {
    expect(roundPoints(0.1 + 0.2)).toBe(0);
    expect(roundPoints(179.6)).toBe(180);
  });
});
