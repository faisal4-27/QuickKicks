import { POSITIONS, formatPoints, type Player, type Position } from '@quickkicks/shared';
import { useMemo, useState } from 'react';
import type { AppSocket } from '../../hooks/useSocket.js';
import { kitFor } from '../../lib/teamKits.js';
import { memberById, playerIndex, useRoomStore } from '../../state/roomStore.js';
import { Modal, SectionLabel, surname, teamFor } from './shared.js';

interface Props {
  socket: AppSocket | null;
}

export function SwapTab({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const [browsing, setBrowsing] = useState(false);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot || !me) return null;

  const cutoff = snapshot.room.scoringRules.swaps.cutoffMinute;
  const pastCutoff = snapshot.match.minute >= cutoff;
  const closed = snapshot.room.status !== 'live' || pastCutoff || me.swapsRemaining <= 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Your players</SectionLabel>
        <span className="text-xs text-mist">
          {me.swapsRemaining} swap left · closes {cutoff}'
        </span>
      </div>

      {me.roster.map((slot) => {
        const player = players.get(slot.playerId);
        const team = player ? teamFor(snapshot, player.teamId) : undefined;
        const kit = kitFor(team);
        return (
          <div
            key={slot.playerId}
            className="flex items-center gap-3 rounded-xl border border-navy-600 bg-navy-800 p-3"
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg font-display text-lg font-bold"
              style={{ background: kit.body, color: kit.ink }}
            >
              {player?.shirtNumber ?? '–'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{player?.fullName ?? 'Unknown'}</p>
              <p className="text-xs text-mist">
                {player?.position} · {team?.name}
              </p>
            </div>
            <span className="font-display text-xl font-bold text-white">{formatPoints(slot.points)}</span>
          </div>
        );
      })}

      <div className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm text-gold">
        <p className="font-semibold">Before you swap</p>
        <p className="mt-1 text-gold/85">
          You keep every point your outgoing player has earned, but the replacement starts from 0
          for you. You only get {snapshot.room.scoringRules.swaps.maxPerManager} swap, and it
          closes at {cutoff}'.
        </p>
      </div>

      <button
        type="button"
        disabled={closed}
        onClick={() => setBrowsing(true)}
        className="w-full rounded-lg bg-sky py-2.5 text-sm font-semibold text-ink hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        Browse replacements
      </button>
      {closed ? (
        <p className="text-center text-xs text-mist">
          {me.swapsRemaining <= 0 ? 'You have used your swap.' : pastCutoff ? `Swaps closed at ${cutoff}'.` : ''}
        </p>
      ) : null}

      {browsing ? <SwapModal socket={socket} onClose={() => setBrowsing(false)} /> : null}
    </div>
  );
}

function SwapModal({ socket, onClose }: Props & { onClose: () => void }) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);
  const [outId, setOutId] = useState<string | null>(me?.roster[0]?.playerId ?? null);
  const [inId, setInId] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');

  const available = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.draft.availablePlayerIds
      .map((id) => players.get(id))
      .filter((p): p is Player => Boolean(p))
      .filter((p) => position === 'ALL' || p.position === position)
      .sort((a, b) => b.rating - a.rating);
  }, [snapshot, players, position]);

  if (!snapshot || !me) return null;

  const outgoing = me.roster.find((slot) => slot.playerId === outId);

  const execute = () => {
    if (!socket || !outId || !inId) return;
    socket.emit('swap:execute', { outPlayerId: outId, inPlayerId: inId }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
      else {
        pushToast('Swap complete. Points already earned stay with you.');
        onClose();
      }
    });
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${active ? 'border-sky bg-sky text-ink font-semibold' : 'border-navy-600 text-mist hover:text-white'}`;

  return (
    <Modal title="Browse replacements" onClose={onClose}>
      <SectionLabel className="mb-2">Drop</SectionLabel>
      <div className="mb-5 flex flex-wrap gap-2">
        {me.roster.map((slot) => (
          <button key={slot.playerId} type="button" onClick={() => setOutId(slot.playerId)} className={chip(outId === slot.playerId)}>
            {surname(players.get(slot.playerId)?.fullName)} · {formatPoints(slot.points)} pts
          </button>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Bring in</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {(['ALL', ...POSITIONS] as const).map((value) => (
            <button key={value} type="button" onClick={() => setPosition(value)} className={chip(position === value)}>
              {value === 'ALL' ? 'All' : value}
            </button>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {available.length === 0 ? (
          <li className="py-6 text-center text-sm text-mist">Nobody undrafted in that position.</li>
        ) : (
          available.map((player) => {
            const team = teamFor(snapshot, player.teamId);
            const kit = kitFor(team);
            const selected = inId === player.id;
            return (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => setInId(player.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${selected ? 'border-sky bg-sky/10' : 'border-navy-700 bg-navy-800 hover:border-navy-600'}`}
                >
                  <span className="w-9 text-xs font-semibold text-mist">{player.position}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-white">{player.fullName}</span>
                  <span
                    className="rounded px-1.5 py-0.5 font-display text-xs font-bold tracking-wide"
                    style={{ background: kit.body, color: kit.ink }}
                  >
                    {team.shortName}
                  </span>
                  <span className="w-8 text-right font-display text-sm font-bold text-mist">{player.rating}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 border-t border-navy-600 bg-navy-850 px-5 py-4">
        <p className="mb-3 text-sm text-mist">
          {outgoing
            ? `You keep the ${formatPoints(outgoing.points)} pts ${surname(players.get(outgoing.playerId)?.fullName)} earned for you. `
            : ''}
          The new player starts from 0.
        </p>
        <button
          type="button"
          disabled={!outId || !inId}
          onClick={execute}
          className="w-full rounded-lg bg-sky py-2.5 text-sm font-semibold text-ink hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm swap
        </button>
      </div>
    </Modal>
  );
}
