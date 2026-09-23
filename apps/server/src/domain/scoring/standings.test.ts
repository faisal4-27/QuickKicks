import { describe, expect, it } from 'vitest';
import { computeStandings } from './standings.js';

const row = (memberId: string, points: number, draftPosition = 0) => ({
  memberId,
  displayName: memberId,
  draftPosition,
  points,
});

describe('computeStandings', () => {
  it('ranks by points, highest first', () => {
    const standings = computeStandings([row('a', 4, 0), row('b', 11, 1), row('c', 7, 2)]);
    expect(standings.map((s) => s.memberId)).toEqual(['b', 'c', 'a']);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it('shares a rank on a tie and says so', () => {
    const standings = computeStandings([row('a', 10, 0), row('b', 10, 1), row('c', 3, 2)]);
    expect(standings.map((s) => s.rank)).toEqual([1, 1, 3]);
    expect(standings.map((s) => s.tied)).toEqual([true, true, false]);
  });

  it('breaks display order by draft position so the list does not jitter', () => {
    const standings = computeStandings([row('late', 10, 5), row('early', 10, 1)]);
    expect(standings.map((s) => s.memberId)).toEqual(['early', 'late']);
  });

  it('treats scores that differ only by floating point dust as tied', () => {
    const standings = computeStandings([row('a', 0.1 + 0.2, 0), row('b', 0.3, 1)]);
    expect(standings.every((s) => s.tied)).toBe(true);
    expect(standings.map((s) => s.rank)).toEqual([1, 1]);
  });

  it('handles negative totals', () => {
    const standings = computeStandings([row('a', -2, 0), row('b', -5, 1), row('c', 0, 2)]);
    expect(standings.map((s) => s.memberId)).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty list for an empty room', () => {
    expect(computeStandings([])).toEqual([]);
  });
});
