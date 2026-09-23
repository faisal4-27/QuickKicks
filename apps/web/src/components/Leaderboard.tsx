import { formatPoints } from '@quickkicks/shared';
import { memberById, useRoomStore } from '../state/roomStore.js';

export function Leaderboard() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const standings = useRoomStore((s) => s.standings);
  const myMemberId = useRoomStore((s) => s.myMemberId);

  if (!snapshot) return null;

  const rows =
    standings.length > 0
      ? standings
      : [...snapshot.members]
          .sort((a, b) => b.points - a.points || a.draftPosition - b.draftPosition)
          .map((member, index) => ({
            memberId: member.id,
            displayName: member.displayName,
            points: member.points,
            rank: index + 1,
            tied: false,
          }));

  return (
    <ol className="leaderboard">
      {rows.map((row) => {
        const member = memberById(snapshot, row.memberId);
        return (
          <li
            key={row.memberId}
            className={`leaderboard__row ${row.memberId === myMemberId ? 'is-me' : ''}`}
          >
            <span className="leaderboard__rank">
              {row.tied ? 'T' : ''}
              {row.rank}
            </span>
            <span className="leaderboard__name">
              <span className={`dot ${member?.connected ? 'is-online' : ''}`} />
              {row.displayName}
            </span>
            <span className="leaderboard__pts">{formatPoints(row.points)}</span>
          </li>
        );
      })}
    </ol>
  );
}
