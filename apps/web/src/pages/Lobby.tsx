import type { AppSocket } from '../hooks/useSocket.js';
import { memberById, useRoomStore } from '../state/roomStore.js';

interface Props {
  socket: AppSocket | null;
}

export function Lobby({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);

  if (!snapshot) return null;

  const { room, fixture, members } = snapshot;
  const min = room.draftConfig.minManagers;
  const canStart = Boolean(me?.isHost) && members.length >= min;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.joinCode);
      pushToast('Join code copied.');
    } catch {
      pushToast(room.joinCode);
    }
  };

  const start = () => {
    if (!socket) return;
    socket.emit('room:start-draft', {}, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  return (
    <main className="page page--narrow">
      <p className="eyebrow">
        {fixture.homeTeam.name} vs {fixture.awayTeam.name}
      </p>
      <h1>Waiting room</h1>
      <p className="lede">Share the code. Draft starts when the host is ready.</p>

      <button type="button" className="join-code-display" onClick={() => void copyCode()}>
        {room.joinCode}
        <small>Click to copy</small>
      </button>

      <section className="panel">
        <header className="panel__head">
          <h3>Managers</h3>
          <span className="muted">
            {members.length} / {room.draftConfig.maxManagers}
          </span>
        </header>
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.id}>
              <span className={`dot ${member.connected ? 'is-online' : ''}`} />
              {member.displayName}
              {member.isHost ? <em>host</em> : null}
              {member.id === myMemberId ? <em>you</em> : null}
            </li>
          ))}
        </ul>
      </section>

      {me?.isHost ? (
        <button type="button" className="btn btn--primary btn--block" disabled={!canStart} onClick={start}>
          {members.length < min ? `Need at least ${min} managers` : 'Start the snake draft'}
        </button>
      ) : (
        <p className="muted">Waiting for the host to start the draft.</p>
      )}
    </main>
  );
}
