import type { StandingRow } from '@quickkicks/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoomStore } from '../../state/roomStore.js';

/**
 * The server's standings once it has published any, otherwise the snapshot's member totals in
 * the same order the server uses. Both the header rank and the leaderboard read this, so they
 * cannot disagree.
 */
export function useStandingRows(): StandingRow[] {
  const snapshot = useRoomStore((s) => s.snapshot);
  const standings = useRoomStore((s) => s.standings);

  return useMemo(() => {
    if (standings.length > 0) return standings;
    if (!snapshot) return [];
    return [...snapshot.members]
      .sort((a, b) => b.points - a.points || a.draftPosition - b.draftPosition)
      .map((member, index) => ({
        memberId: member.id,
        displayName: member.displayName,
        points: member.points,
        rank: index + 1,
        tied: false,
      }));
  }, [snapshot, standings]);
}

export type Trend = 'up' | 'down';

/**
 * Which way each manager last moved in the rankings. Display only: it is remembered in this tab
 * from the standings as they arrive, so a fresh page load starts with no arrows.
 */
export function useRankTrends(rows: StandingRow[]): Map<string, Trend> {
  const previous = useRef<Map<string, number> | null>(null);
  const [trends, setTrends] = useState<Map<string, Trend>>(new Map());
  const key = rows.map((r) => `${r.memberId}:${r.rank}`).join('|');

  useEffect(() => {
    const now = new Map(rows.map((r) => [r.memberId, r.rank]));
    const before = previous.current;
    previous.current = now;
    if (!before) return;

    setTrends((current) => {
      const next = new Map(current);
      for (const [memberId, rank] of now) {
        const was = before.get(memberId);
        if (was === undefined || was === rank) continue;
        next.set(memberId, rank < was ? 'up' : 'down');
      }
      return next;
    });
    // `key` captures every rank change; `rows` itself is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return trends;
}
