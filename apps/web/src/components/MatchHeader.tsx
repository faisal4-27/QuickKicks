import { formatPoints } from '@quickkicks/shared';
import { memberById, playerIndex, useRoomStore } from '../state/roomStore.js';

export function MatchHeader() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const connected = useRoomStore((s) => s.connected);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot) return null;

  const { homeTeam, awayTeam } = snapshot.fixture;
  const { minute, homeGoals, awayGoals, status } = snapshot.match;

  return (
    <header className="match-header">
      <div className="match-header__score">
        <span className="match-header__team">{homeTeam.shortName}</span>
        <strong>
          {homeGoals} – {awayGoals}
        </strong>
        <span className="match-header__team">{awayTeam.shortName}</span>
      </div>
      <div className="match-header__clock">
        <span className={`status-pill status-pill--${status}`}>{status.replace('_', ' ')}</span>
        <span className="match-header__min">{minute}&apos;</span>
        <span className={`dot ${connected ? 'is-online' : ''}`} title={connected ? 'Live' : 'Reconnecting'} />
      </div>
      {me ? (
        <div className="match-header__me">
          <span className="muted">You</span>
          <strong>{formatPoints(me.points)}</strong>
          <span className="muted">
            {me.roster
              .map((slot) => players.get(slot.playerId)?.fullName.split(' ').slice(-1)[0])
              .filter(Boolean)
              .join(' · ') || 'Empty roster'}
          </span>
        </div>
      ) : null}
    </header>
  );
}
