import { POSITIONS, type Position } from '@quickkicks/shared';
import { useMemo, useState } from 'react';
import { DraftBoard } from '../components/DraftBoard.js';
import { PickTimer } from '../components/PickTimer.js';
import { PlayerCard } from '../components/PlayerCard.js';
import type { AppSocket } from '../hooks/useSocket.js';
import { memberById, playerIndex, useRoomStore } from '../state/roomStore.js';

interface Props {
  socket: AppSocket | null;
}

export function Draft({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [teamId, setTeamId] = useState<string>('ALL');

  const available = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.draft.availablePlayerIds
      .map((id) => players.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .filter((p) => position === 'ALL' || p.position === position)
      .filter((p) => teamId === 'ALL' || p.teamId === teamId)
      .sort((a, b) => b.rating - a.rating);
  }, [snapshot, players, position, teamId]);

  if (!snapshot) return null;

  const onClock = snapshot.draft.onTheClock;
  const myTurn = onClock?.memberId === myMemberId;
  const onClockMember = memberById(snapshot, onClock?.memberId ?? null);
  const { homeTeam, awayTeam } = snapshot.fixture;

  const pick = (playerId: string) => {
    if (!socket || !myTurn) return;
    socket.emit('draft:pick', { playerId }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  const teamFor = (id: string) => (id === homeTeam.id ? homeTeam : awayTeam);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">
            Snake draft · {snapshot.draft.picks.length}/{snapshot.draft.totalPicks}
          </p>
          <h1>{myTurn ? 'You are on the clock' : `${onClockMember?.displayName ?? 'Someone'} is picking`}</h1>
        </div>
        {onClock ? (
          <PickTimer
            deadlineMs={onClock.deadlineMs}
            label={`Round ${onClock.round} · pick ${onClock.pickNumber}`}
          />
        ) : null}
      </header>

      <DraftBoard snapshot={snapshot} />

      {me && me.roster.length > 0 ? (
        <p className="muted">
          Your picks:{' '}
          {me.roster
            .map((slot) => players.get(slot.playerId)?.fullName)
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}

      <div className="filters">
        <button
          type="button"
          className={`chip ${teamId === 'ALL' ? 'is-on' : ''}`}
          onClick={() => setTeamId('ALL')}
        >
          Both
        </button>
        <button
          type="button"
          className={`chip ${teamId === homeTeam.id ? 'is-on' : ''}`}
          onClick={() => setTeamId(homeTeam.id)}
        >
          {homeTeam.shortName}
        </button>
        <button
          type="button"
          className={`chip ${teamId === awayTeam.id ? 'is-on' : ''}`}
          onClick={() => setTeamId(awayTeam.id)}
        >
          {awayTeam.shortName}
        </button>
        <span className="filters__gap" />
        <button
          type="button"
          className={`chip ${position === 'ALL' ? 'is-on' : ''}`}
          onClick={() => setPosition('ALL')}
        >
          All
        </button>
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            className={`chip ${position === pos ? 'is-on' : ''}`}
            onClick={() => setPosition(pos)}
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="player-grid">
        {available.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            team={teamFor(player.teamId)}
            disabled={!myTurn}
            onClick={myTurn ? () => pick(player.id) : undefined}
          />
        ))}
      </div>
    </main>
  );
}
