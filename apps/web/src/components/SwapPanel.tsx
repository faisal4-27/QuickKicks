import { useMemo, useState } from 'react';
import type { AppSocket } from '../hooks/useSocket.js';
import { memberById, playerIndex, useRoomStore } from '../state/roomStore.js';
import { PlayerCard } from './PlayerCard.js';

interface Props {
  socket: AppSocket | null;
}

export function SwapPanel({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);
  const [outId, setOutId] = useState<string | null>(null);
  const [inId, setInId] = useState<string | null>(null);

  const available = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.draft.availablePlayerIds
      .map((id) => players.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .sort((a, b) => b.rating - a.rating);
  }, [snapshot, players]);

  if (!snapshot || !me || snapshot.room.status !== 'live') return null;

  const cutoff = snapshot.room.scoringRules.swaps.cutoffMinute;
  const closed = snapshot.match.minute >= cutoff || me.swapsRemaining <= 0;

  const execute = () => {
    if (!socket || !outId || !inId) return;
    socket.emit('swap:execute', { outPlayerId: outId, inPlayerId: inId }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
      else {
        setOutId(null);
        setInId(null);
        pushToast('Swap complete. Points already earned stay with you.');
      }
    });
  };

  const teamFor = (teamId: string) =>
    teamId === snapshot.fixture.homeTeam.id ? snapshot.fixture.homeTeam : snapshot.fixture.awayTeam;

  return (
    <section className="panel">
      <header className="panel__head">
        <h3>Swap</h3>
        <span className="muted">
          {me.swapsRemaining} left · closes at {cutoff}&apos;
        </span>
      </header>
      {closed ? (
        <p className="muted">
          {me.swapsRemaining <= 0
            ? 'You have already used your swap.'
            : `Swaps closed at ${cutoff}'.`}
        </p>
      ) : (
        <>
          <p className="muted small">
            Drop one of yours for anyone still undrafted. You keep the points you already earned;
            the incoming player starts from zero for you.
          </p>
          <div className="swap-grid">
            <div>
              <h4>Drop</h4>
              {me.roster.map((slot) => {
                const player = players.get(slot.playerId);
                if (!player) return null;
                return (
                  <PlayerCard
                    key={slot.playerId}
                    player={player}
                    team={teamFor(player.teamId)}
                    selected={outId === player.id}
                    onClick={() => setOutId(player.id)}
                  />
                );
              })}
            </div>
            <div>
              <h4>Bring in</h4>
              <div className="swap-grid__pool">
                {available.map((player) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    team={teamFor(player.teamId)}
                    selected={inId === player.id}
                    onClick={() => setInId(player.id)}
                  />
                ))}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn--primary" disabled={!outId || !inId} onClick={execute}>
            Confirm swap
          </button>
        </>
      )}
    </section>
  );
}
