import { POWER_UP_LABELS, formatPoints, type RosterEntryView } from '@quickkicks/shared';
import { useState } from 'react';
import type { AppSocket } from '../../hooks/useSocket.js';
import { memberById, playerIndex, useRoomStore } from '../../state/roomStore.js';
import { Modal, SectionLabel, surname } from './shared.js';

interface Props {
  socket: AppSocket | null;
}

const primary =
  'rounded-lg bg-sky px-3 py-2 text-sm font-semibold text-ink hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-40';
const secondary =
  'rounded-lg border border-navy-600 px-3 py-2 text-sm font-medium text-white hover:bg-navy-700';

export function TradesTab({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const [proposing, setProposing] = useState(false);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot || !me) return null;

  const cutoff = snapshot.room.scoringRules.trades.cutoffMinute;
  const closed = snapshot.room.status !== 'live' || snapshot.match.minute >= cutoff;
  const pending = snapshot.trades.filter((t) => t.status === 'pending');
  const incoming = pending.filter((t) => t.toMemberId === me.id);
  const outgoing = pending.filter((t) => t.fromMemberId === me.id);
  const name = (playerId: string) => players.get(playerId)?.fullName ?? 'a player';

  const respond = (tradeId: string, accept: boolean) => {
    socket?.emit('trade:respond', { tradeId, accept }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  const cancel = (tradeId: string) => {
    socket?.emit('trade:cancel', { tradeId }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
    });
  };

  const boosted = me.powerUps.filter((p) => p.active);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Open offers</SectionLabel>
        <span className="text-xs text-mist">1-for-1 · closes {cutoff}'</span>
      </div>

      {incoming.length + outgoing.length === 0 ? (
        <p className="rounded-xl border border-dashed border-navy-600 p-4 text-center text-sm text-mist">
          No open offers.
        </p>
      ) : null}

      {incoming.map((trade) => (
        <article key={trade.id} className="rounded-xl border border-sky/60 bg-sky/10 p-3 text-sm">
          <p className="text-white">
            <strong>{memberById(snapshot, trade.fromMemberId)?.displayName ?? 'Someone'}</strong> wants
            your {name(trade.requestedPlayerId)} for {name(trade.offeredPlayerId)}.
          </p>
          <p className="mt-1 text-xs text-mist">Expires {trade.expiresAtMinute}'</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className={primary} onClick={() => respond(trade.id, true)}>
              Accept
            </button>
            <button type="button" className={secondary} onClick={() => respond(trade.id, false)}>
              Reject
            </button>
          </div>
        </article>
      ))}

      {outgoing.map((trade) => (
        <article key={trade.id} className="rounded-xl border border-navy-600 bg-navy-800 p-3 text-sm">
          <p className="text-white">
            You offered {name(trade.offeredPlayerId)} to{' '}
            {memberById(snapshot, trade.toMemberId)?.displayName} for {name(trade.requestedPlayerId)}.
          </p>
          <p className="mt-1 text-xs text-mist">Expires {trade.expiresAtMinute}'</p>
          <button type="button" className={`${secondary} mt-3`} onClick={() => cancel(trade.id)}>
            Cancel offer
          </button>
        </article>
      ))}

      {boosted.length > 0 ? (
        <p className="text-xs text-mist">
          Boosted:{' '}
          {boosted.map((p) => `${surname(players.get(p.playerId)?.fullName)} (${POWER_UP_LABELS[p.kind]})`).join(', ')}.
          Trading a boosted player ends their boost.
        </p>
      ) : null}

      <button type="button" className={`${primary} w-full py-2.5`} disabled={closed} onClick={() => setProposing(true)}>
        Propose a trade
      </button>
      {closed && snapshot.room.status === 'live' ? (
        <p className="text-center text-xs text-mist">Trading closed at {cutoff}'.</p>
      ) : null}

      {proposing ? <ProposeModal socket={socket} onClose={() => setProposing(false)} /> : null}
    </div>
  );
}

function ProposeModal({ socket, onClose }: Props & { onClose: () => void }) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);
  const [toMemberId, setToMemberId] = useState('');
  const [offeredId, setOfferedId] = useState<string | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(null);

  if (!snapshot || !me) return null;

  const partner = memberById(snapshot, toMemberId || null);
  const others = snapshot.members.filter((m) => m.id !== me.id);

  const propose = () => {
    if (!socket || !toMemberId || !offeredId || !requestedId) return;
    socket.emit(
      'trade:propose',
      { toMemberId, offeredPlayerId: offeredId, requestedPlayerId: requestedId },
      (result) => {
        if (!result.ok) pushToast(result.message, 'error');
        else {
          pushToast('Offer sent.');
          onClose();
        }
      },
    );
  };

  const option = (slot: RosterEntryView, selected: boolean, onPick: () => void) => (
    <button
      key={slot.playerId}
      type="button"
      onClick={onPick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${selected ? 'border-sky bg-sky/10' : 'border-navy-700 bg-navy-800 hover:border-navy-600'}`}
    >
      <span className="font-medium text-white">{players.get(slot.playerId)?.fullName}</span>
      <span className="font-display text-sm font-bold text-mist">{formatPoints(slot.points)} pts</span>
    </button>
  );

  return (
    <Modal title="Propose a trade" onClose={onClose}>
      <SectionLabel className="mb-2">Manager</SectionLabel>
      <div className="mb-5 flex flex-wrap gap-2">
        {others.map((member) => (
          <button
            key={member.id}
            type="button"
            onClick={() => {
              setToMemberId(member.id);
              setRequestedId(null);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${toMemberId === member.id ? 'border-sky bg-sky font-semibold text-ink' : 'border-navy-600 text-mist hover:text-white'}`}
          >
            {member.displayName}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <SectionLabel className="mb-1">You give</SectionLabel>
          {me.roster.map((slot) => option(slot, offeredId === slot.playerId, () => setOfferedId(slot.playerId)))}
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel className="mb-1">You get</SectionLabel>
          {partner ? (
            partner.roster.map((slot) =>
              option(slot, requestedId === slot.playerId, () => setRequestedId(slot.playerId)),
            )
          ) : (
            <p className="text-sm text-mist">Pick a manager first.</p>
          )}
        </div>
      </div>

      <p className="mt-5 text-sm text-mist">
        Points already earned stay with whoever owned the player at the time. Incoming players start
        from zero for you.
      </p>
      <button
        type="button"
        className={`${primary} mt-4 w-full py-2.5`}
        disabled={!toMemberId || !offeredId || !requestedId}
        onClick={propose}
      >
        Send offer
      </button>
    </Modal>
  );
}
