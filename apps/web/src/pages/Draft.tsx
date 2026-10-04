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

  // The pool is the starters, so available plus drafted is each side's full XI.
  const pool = useMemo(() => {
    if (!snapshot) return [];
    const ids = [...snapshot.draft.availablePlayerIds, ...snapshot.draft.picks.map((p) => p.playerId)];
    return ids
      .map((id) => players.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .filter((p) => position === 'ALL' || p.position === position)
      .sort(
        (a, b) =>
          (a.shirtNumber ?? Number.MAX_SAFE_INTEGER) - (b.shirtNumber ?? Number.MAX_SAFE_INTEGER) ||
          a.fullName.localeCompare(b.fullName),
      );
  }, [snapshot, players, position]);

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

  const takenBy = new Map(snapshot.draft.picks.map((p) => [p.playerId, p.memberId]));

  const lineup = (team: typeof homeTeam) => (
    <section className="lineup">
      <h2 className="lineup__head">{team.name}</h2>
      {pool
        .filter((player) => player.teamId === team.id)
        .map((player) => {
          const owner = takenBy.get(player.id);
          const ownerName = owner
            ? owner === myMemberId
              ? 'You'
              : (memberById(snapshot, owner)?.displayName ?? 'Someone')
            : null;
          return (
            <PlayerCard
              key={player.id}
              player={player}
              team={team}
              disabled={!myTurn || Boolean(owner)}
              onClick={myTurn && !owner ? () => pick(player.id) : undefined}
              footer={ownerName ? `Taken by ${ownerName}` : undefined}
            />
          );
        })}
    </section>
  );

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

      <div className="lineups">
        {lineup(homeTeam)}
        {lineup(awayTeam)}
      </div>
    </main>
  );
}
