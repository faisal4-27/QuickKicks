import { POWER_UP_LABELS, formatPoints } from '@quickkicks/shared';
import { useMemo, useState } from 'react';
import type { AppSocket } from '../hooks/useSocket.js';
import { memberById, playerIndex, useRoomStore } from '../state/roomStore.js';
import { PlayerCard } from './PlayerCard.js';

interface Props {
  socket: AppSocket | null;
}

export function TradeModal({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);
  const [open, setOpen] = useState(false);
  const [toMemberId, setToMemberId] = useState<string>('');
  const [offeredId, setOfferedId] = useState<string | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(null);

  const partner = memberById(snapshot, toMemberId || null);
  const pending = useMemo(
    () => snapshot?.trades.filter((t) => t.status === 'pending') ?? [],
    [snapshot],
  );

  if (!snapshot || !me || snapshot.room.status !== 'live') return null;

  const cutoff = snapshot.room.scoringRules.trades.cutoffMinute;
  const closed = snapshot.match.minute >= cutoff;
  const others = snapshot.members.filter((m) => m.id !== me.id);

  const teamFor = (teamId: string) =>
    teamId === snapshot.fixture.homeTeam.id ? snapshot.fixture.homeTeam : snapshot.fixture.awayTeam;

  const propose = () => {
    if (!socket || !toMemberId || !offeredId || !requestedId) return;
    socket.emit(
      'trade:propose',
      { toMemberId, offeredPlayerId: offeredId, requestedPlayerId: requestedId },
      (result) => {
        if (!result.ok) pushToast(result.message, 'error');
        else {
          setOpen(false);
          setOfferedId(null);
          setRequestedId(null);
          pushToast('Offer sent.');
        }
      },
    );
  };

  const respond = (tradeId: string, accept: boolean) => {
    if (!socket) return;
    socket.emit('trade:respond', { tradeId, accept }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  const cancel = (tradeId: string) => {
    if (!socket) return;
    socket.emit('trade:cancel', { tradeId }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  const incoming = pending.filter((t) => t.toMemberId === me.id);
  const outgoing = pending.filter((t) => t.fromMemberId === me.id);

  return (
    <section className="panel">
      <header className="panel__head">
        <h3>Trades</h3>
        <span className="muted">1-for-1 · closes at {cutoff}&apos;</span>
      </header>

      {incoming.length + outgoing.length === 0 ? (
        <p className="muted">No open offers.</p>
      ) : (
        <ul className="trade-list">
          {incoming.map((trade) => {
            const from = memberById(snapshot, trade.fromMemberId);
            const offered = players.get(trade.offeredPlayerId);
            const requested = players.get(trade.requestedPlayerId);
            return (
              <li key={trade.id} className="trade-card">
                <p>
                  <strong>{from?.displayName ?? 'Someone'}</strong> wants your{' '}
                  {requested?.fullName ?? 'player'} for {offered?.fullName ?? 'theirs'}. Expires{' '}
                  {trade.expiresAtMinute}&apos;.
                </p>
                <div className="row">
                  <button type="button" className="btn btn--primary" onClick={() => respond(trade.id, true)}>
                    Accept
                  </button>
                  <button type="button" className="btn" onClick={() => respond(trade.id, false)}>
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
          {outgoing.map((trade) => {
            const to = memberById(snapshot, trade.toMemberId);
            const offered = players.get(trade.offeredPlayerId);
            const requested = players.get(trade.requestedPlayerId);
            return (
              <li key={trade.id} className="trade-card">
                <p>
                  You offered {offered?.fullName} to {to?.displayName} for {requested?.fullName}. Expires{' '}
                  {trade.expiresAtMinute}&apos;.
                </p>
                <button type="button" className="btn" onClick={() => cancel(trade.id)}>
                  Cancel
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="btn btn--ghost" disabled={closed} onClick={() => setOpen(true)}>
        Propose a trade
      </button>
      {closed ? <p className="muted small">Trading closed at {cutoff}&apos;.</p> : null}

      {open ? (
        <div className="modal" role="dialog" aria-label="Propose a trade">
          <div className="modal__card">
            <header className="panel__head">
              <h3>Propose a trade</h3>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>
            <label className="field">
              Manager
              <select value={toMemberId} onChange={(e) => setToMemberId(e.target.value)}>
                <option value="">Pick someone</option>
                {others.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="swap-grid">
              <div>
                <h4>You give</h4>
                {me.roster.map((slot) => {
                  const player = players.get(slot.playerId);
                  if (!player) return null;
                  return (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      team={teamFor(player.teamId)}
                      selected={offeredId === player.id}
                      onClick={() => setOfferedId(player.id)}
                      footer={formatPoints(slot.points)}
                    />
                  );
                })}
              </div>
              <div>
                <h4>You get</h4>
                {partner?.roster.map((slot) => {
                  const player = players.get(slot.playerId);
                  if (!player) return null;
                  return (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      team={teamFor(player.teamId)}
                      selected={requestedId === player.id}
                      onClick={() => setRequestedId(player.id)}
                      footer={formatPoints(slot.points)}
                    />
                  );
                }) ?? <p className="muted">Pick a manager first.</p>}
              </div>
            </div>
            <p className="muted small">
              Points already earned stay with whoever owned the player at the time. Incoming
              players start from zero for you.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!toMemberId || !offeredId || !requestedId}
              onClick={propose}
            >
              Send offer
            </button>
          </div>
        </div>
      ) : null}

      {me.powerUps.some((p) => p.active) ? (
        <p className="muted small">
          Active: {me.powerUps.filter((p) => p.active).map((p) => POWER_UP_LABELS[p.kind]).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
