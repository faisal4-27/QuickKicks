import { POWER_UP_KINDS, POWER_UP_LABELS, type PowerUpKind } from '@quickkicks/shared';
import type { AppSocket } from '../hooks/useSocket.js';
import { memberById, useRoomStore } from '../state/roomStore.js';

interface Props {
  socket: AppSocket | null;
}

export function PowerUpBar({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);

  if (!snapshot || !me || snapshot.room.status !== 'live') return null;

  const used = new Set(me.powerUps.map((p) => p.kind));
  const running = me.powerUps.find((p) => p.active);
  const remaining = Math.max(0, running ? running.expiresAtMinute - snapshot.match.minute : 0);

  const activate = (kind: PowerUpKind) => {
    if (!socket) return;
    socket.emit('powerup:activate', { kind }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  return (
    <section className="powerups">
      <header className="powerups__head">
        <h3>Power-ups</h3>
        <span className="muted">
          {me.powerUpChargesRemaining} left
          {running ? ` · ${POWER_UP_LABELS[running.kind]} ${remaining}' remaining` : ''}
        </span>
      </header>
      <div className="powerups__grid">
        {POWER_UP_KINDS.map((kind) => {
          const spent = used.has(kind);
          const disabled = spent || Boolean(running) || me.powerUpChargesRemaining <= 0;
          return (
            <button
              key={kind}
              type="button"
              className={`powerups__btn ${spent ? 'is-used' : ''} ${running?.kind === kind ? 'is-live' : ''}`}
              disabled={disabled}
              onClick={() => activate(kind)}
            >
              {POWER_UP_LABELS[kind]}
              <small>{spent ? 'Used' : running?.kind === kind ? `${remaining}' left` : '10 match minutes'}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
