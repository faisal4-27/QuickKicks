import { roundPoints, type StandingRow } from '@quickkicks/shared';

export interface StandingInput {
  memberId: string;
  displayName: string;
  draftPosition: number;
  points: number;
}

/**
 * Ranks managers by points, marking genuine ties rather than hiding them. Equal scores share
 * a rank; draft position only decides the display order so the list is stable between renders.
 */
export function computeStandings(rows: readonly StandingInput[]): StandingRow[] {
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || a.draftPosition - b.draftPosition,
  );

  const counts = new Map<number, number>();
  for (const row of sorted) {
    const key = roundPoints(row.points);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let rank = 0;
  let previousPoints: number | null = null;
  return sorted.map((row, index) => {
    const points = roundPoints(row.points);
    if (previousPoints === null || points !== previousPoints) {
      rank = index + 1;
      previousPoints = points;
    }
    return {
      memberId: row.memberId,
      displayName: row.displayName,
      points,
      rank,
      tied: (counts.get(points) ?? 0) > 1,
    };
  });
}
