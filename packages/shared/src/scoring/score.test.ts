import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_RULES, type ScoringRules } from './rules.js';
import { basePointsFor, resolveMultiplier, roundPoints, scoreEvent } from './score.js';

const rules = DEFAULT_SCORING_RULES;

describe('basePointsFor', () => {
  it('reads flat values', () => {
    expect(basePointsFor('tackle.won', 'DEF', rules)).toBe(1);
  });

  it('prefers a positional value over the default', () => {
    expect(basePointsFor('goal.scored', 'FWD', rules)).toBe(9);
    expect(basePointsFor('goal.scored', 'GK', rules)).toBe(12);
  });

  it('falls back to the default for positions that are not named', () => {
    expect(basePointsFor('clean_sheet.awarded', 'FWD', rules)).toBe(0);
    expect(basePointsFor('clean_sheet.awarded', 'GK', rules)).toBe(6);
  });
});

describe('resolveMultiplier', () => {
  const config = rules.powerUps;

  it('is 1 with nothing active', () => {
    expect(resolveMultiplier('goal.scored', 9, [], config)).toBe(1);
  });

  it('doubles only the events a targeted power-up covers', () => {
    expect(resolveMultiplier('goal.scored', 9, ['double_goals'], config)).toBe(2);
    expect(resolveMultiplier('pass.completed', 0.05, ['double_goals'], config)).toBe(1);
    expect(resolveMultiplier('pass.completed', 0.05, ['double_passes'], config)).toBe(2);
  });

  it('doubles everything under double_all', () => {
    expect(resolveMultiplier('tackle.won', 1, ['double_all'], config)).toBe(2);
    expect(resolveMultiplier('assist', 4.5, ['double_all'], config)).toBe(2);
  });

  it('leaves losses alone, so a boost is never a punishment', () => {
    expect(resolveMultiplier('pass.missed', -0.05, ['double_passes'], config)).toBe(1);
    expect(resolveMultiplier('card.red', -3, ['double_all'], config)).toBe(1);
  });

  it('amplifies losses when a ruleset opts in', () => {
    const harsh: ScoringRules['powerUps'] = { ...config, applyToNegative: true };
    expect(resolveMultiplier('pass.missed', -0.05, ['double_passes'], harsh)).toBe(2);
  });

  it('caps the product of overlapping power-ups', () => {
    const overlapping: ScoringRules['powerUps'] = {
      ...config,
      allowOverlap: true,
      maxMultiplier: 2,
    };
    // double_passes and double_all would otherwise compound to 4x.
    expect(
      resolveMultiplier('pass.completed', 0.05, ['double_passes', 'double_all'], overlapping),
    ).toBe(2);
  });

  it('honours a ruleset that allows compounding above 2x', () => {
    const generous: ScoringRules['powerUps'] = {
      ...config,
      allowOverlap: true,
      maxMultiplier: 4,
    };
    expect(
      resolveMultiplier('pass.completed', 0.05, ['double_passes', 'double_all'], generous),
    ).toBe(4);
  });
});

describe('scoreEvent', () => {
  it('splits base points from the multiplier, which is what the ledger stores', () => {
    expect(scoreEvent('goal.scored', 'FWD', ['double_goals'], rules)).toEqual({
      basePoints: 9,
      multiplier: 2,
      awardedPoints: 18,
    });
  });

  it('awards nothing for structural events', () => {
    expect(scoreEvent('period.start', 'MID', ['double_all'], rules).awardedPoints).toBe(0);
    expect(scoreEvent('sub.on', 'MID', [], rules).awardedPoints).toBe(0);
  });

  it('keeps small pass values on the 2dp grid the database uses', () => {
    const scored = scoreEvent('pass.completed', 'MID', ['double_passes'], rules);
    expect(scored.awardedPoints).toBe(0.1);
  });

  it('scores a goal by the position of the player who scored it', () => {
    expect(scoreEvent('goal.scored', 'GK', [], rules).awardedPoints).toBe(12);
    expect(scoreEvent('goal.scored', 'MID', [], rules).awardedPoints).toBe(9);
  });
});

describe('roundPoints', () => {
  it('kills floating point dust', () => {
    expect(roundPoints(0.1 + 0.2)).toBe(0.3);
    expect(roundPoints(1 / 3)).toBe(0.33);
  });
});
