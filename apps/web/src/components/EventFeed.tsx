import { EVENT_LABELS, formatPoints } from '@quickkicks/shared';
import { playerIndex, useRoomStore } from '../state/roomStore.js';

export function EventFeed() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot) return null;

  return (
    <div className="feed">
      <h3>Match feed</h3>
      {snapshot.feed.length === 0 ? (
        <p className="muted">Waiting for the first moment that matters.</p>
      ) : (
        <ol>
          {snapshot.feed.map((item) => {
            const mine = item.awards.find((a) => a.memberId === myMemberId);
            const player = item.playerId ? players.get(item.playerId) : undefined;
            return (
              <li key={item.id} className={`feed__item ${mine ? 'is-mine' : ''}`}>
                <span className="feed__min">{item.minute}&apos;</span>
                <span className="feed__body">
                  <strong>{EVENT_LABELS[item.type]}</strong>
                  {player ? <span> · {player.fullName}</span> : null}
                  {item.playerName && !player ? <span> · {item.playerName}</span> : null}
                </span>
                {mine ? (
                  <span className={`feed__pts ${mine.awardedPoints < 0 ? 'is-neg' : ''}`}>
                    {formatPoints(mine.awardedPoints, { signed: true })}
                    {mine.multiplier > 1 ? ` ×${mine.multiplier}` : ''}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
