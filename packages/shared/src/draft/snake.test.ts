import { describe, expect, it } from 'vitest';
import { draftPositionForPick, draftSchedule, snakeOrder, totalPicks } from './snake.js';

describe('snakeOrder', () => {
  it('reverses every other round', () => {
    expect(snakeOrder(4, 2)).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
  });

  it('gives the first picker of round 1 the last pick of round 2', () => {
    const order = snakeOrder(5, 2);
    expect(order[0]).toBe(0);
    expect(order[order.length - 1]).toBe(0);
  });

  it('handles three rounds by running forwards again', () => {
    expect(snakeOrder(3, 3)).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });

  it('gives every manager exactly one pick per round', () => {
    const memberCount = 7;
    const rounds = 2;
    const order = snakeOrder(memberCount, rounds);
    for (let round = 0; round < rounds; round += 1) {
      const slice = order.slice(round * memberCount, (round + 1) * memberCount);
      expect([...slice].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('degenerates sensibly for a single manager', () => {
    expect(snakeOrder(1, 2)).toEqual([0, 0]);
  });

  it('rejects nonsense inputs rather than producing a silent empty draft', () => {
    expect(() => snakeOrder(0, 2)).toThrow();
    expect(() => snakeOrder(4, 0)).toThrow();
    expect(() => snakeOrder(2.5, 2)).toThrow();
  });
});

describe('draftSchedule', () => {
  it('numbers picks and rounds from one', () => {
    const schedule = draftSchedule(3, 2);
    expect(schedule).toHaveLength(6);
    expect(schedule[0]).toEqual({ pickNumber: 1, round: 1, draftPosition: 0, pickInRound: 1 });
    expect(schedule[3]).toEqual({ pickNumber: 4, round: 2, draftPosition: 2, pickInRound: 1 });
    expect(schedule[5]).toEqual({ pickNumber: 6, round: 2, draftPosition: 0, pickInRound: 3 });
  });
});

describe('draftPositionForPick', () => {
  it('matches the flat order', () => {
    expect(draftPositionForPick(1, 4, 2)).toBe(0);
    expect(draftPositionForPick(5, 4, 2)).toBe(3);
    expect(draftPositionForPick(8, 4, 2)).toBe(0);
  });

  it('returns null once the draft is over, which is how the server knows to start the match', () => {
    expect(draftPositionForPick(9, 4, 2)).toBeNull();
  });
});

describe('totalPicks', () => {
  it('is managers times rounds', () => {
    expect(totalPicks(6, 2)).toBe(12);
  });
});
