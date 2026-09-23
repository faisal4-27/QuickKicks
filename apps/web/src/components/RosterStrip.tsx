import { formatPoints } from '@quickkicks/shared';
import { playerIndex, useRoomStore } from '../state/roomStore.js';

export function RosterStrip() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot) return null;

  return (
    <div className="rosters">
      {snapshot.members.map((member) => (
        <article key={member.id} className={`roster-card ${member.id === myMemberId ? 'is-me' : ''}`}>
          <header>
            <span className={`dot ${member.connected ? 'is-online' : ''}`} />
            <strong>{member.displayName}</strong>
            <span className="roster-card__pts">{formatPoints(member.points)}</span>
          </header>
          <ul>
            {member.roster.length === 0 ? (
              <li className="muted">No players yet</li>
            ) : (
              member.roster.map((slot) => {
                const player = players.get(slot.playerId);
                return (
                  <li key={`${slot.playerId}-${slot.slotIndex}`}>
                    <span>
                      {player?.fullName ?? 'Unknown'}
                      <small>
                        {' '}
                        {player?.position}
                        {slot.acquiredVia !== 'draft' ? ` · ${slot.acquiredVia}` : ''}
                      </small>
                    </span>
                    <span>{formatPoints(slot.points)}</span>
                  </li>
                );
              })
            )}
          </ul>
        </article>
      ))}
    </div>
  );
}
