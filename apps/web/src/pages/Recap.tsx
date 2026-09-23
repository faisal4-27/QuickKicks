import { EVENT_LABELS, formatPoints } from '@quickkicks/shared';
import { useNavigate } from 'react-router-dom';
import { useRoomStore } from '../state/roomStore.js';

export function Recap() {
  const recap = useRoomStore((s) => s.recap);
  const snapshot = useRoomStore((s) => s.snapshot);
  const navigate = useNavigate();

  if (!recap || !snapshot) {
    return (
      <main className="page page--narrow">
        <h1>Full time</h1>
        <p className="muted">Waiting for the recap…</p>
      </main>
    );
  }

  const winner = recap.rows[0];

  return (
    <main className="page">
      <p className="eyebrow">
        {snapshot.fixture.homeTeam.shortName} {recap.homeGoals}–{recap.awayGoals}{' '}
        {snapshot.fixture.awayTeam.shortName} · FT
      </p>
      <h1>{winner ? `${winner.displayName} wins` : 'Full time'}</h1>
      {winner?.tied ? <p className="lede">It is a dead heat on points.</p> : null}

      <ol className="recap-list">
        {recap.rows.map((row) => (
          <li key={row.memberId} className="recap-card">
            <header>
              <span className="leaderboard__rank">
                {row.tied ? 'T' : ''}
                {row.rank}
              </span>
              <strong>{row.displayName}</strong>
              <span className="recap-card__pts">{formatPoints(row.points)}</span>
            </header>
            <ul className="recap-card__players">
              {row.players.map((line) => (
                <li key={`${line.playerId}-${line.fromMinute}`}>
                  <span>
                    {line.playerName}
                    <small>
                      {' '}
                      {line.fromMinute}&apos;–{line.toMinute ?? recap.finalMinute}&apos; · {line.acquiredVia}
                    </small>
                  </span>
                  <span>{formatPoints(line.points)}</span>
                </li>
              ))}
            </ul>
            <ul className="recap-card__break">
              {row.breakdown.slice(0, 6).map((item) => (
                <li key={item.type}>
                  {EVENT_LABELS[item.type]} ×{item.count}{' '}
                  <span>{formatPoints(item.points, { signed: true })}</span>
                </li>
              ))}
              {row.powerUpPoints !== 0 ? (
                <li>
                  Power-up bonus <span>{formatPoints(row.powerUpPoints, { signed: true })}</span>
                </li>
              ) : null}
            </ul>
          </li>
        ))}
      </ol>

      <button type="button" className="btn btn--primary" onClick={() => navigate('/')}>
        New room
      </button>
    </main>
  );
}
