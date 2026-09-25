import { POWER_UP_KINDS, POWER_UP_LABELS, type PowerUpKind } from '@quickkicks/shared';
import { useState, type ReactNode } from 'react';
import type { AppSocket } from '../../hooks/useSocket.js';
import { memberById, playerIndex, useRoomStore } from '../../state/roomStore.js';
import { SectionLabel, surname } from './shared.js';

const DESCRIPTIONS: Record<PowerUpKind, string> = {
  double_passes: '2× points on completed passes',
  double_goals: '2× points on goals',
  double_all: '2× points on everything positive',
};

const ICONS: Record<PowerUpKind, ReactNode> = {
  double_passes: (
    <path d="M4 12h12m0 0-4-4m4 4-4 4M20 5v14" strokeLinecap="round" strokeLinejoin="round" />
  ),
  double_goals: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m12 7 3.5 2.5-1.3 4h-4.4l-1.3-4Z" strokeLinejoin="round" />
    </>
  ),
  double_all: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" strokeLinejoin="round" />,
};

interface Props {
  socket: AppSocket | null;
}

/**
 * Each power-up is used once, on one of the manager's players. A player carries one at a time,
 * but both players can be boosted at once. The server enforces all of this; the disabled states
 * here only stop the manager asking for something it would refuse.
 */
export function PowerUpsTab({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const pushToast = useRoomStore((s) => s.pushToast);
  const [choosing, setChoosing] = useState<PowerUpKind | null>(null);
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot || !me) return null;

  const minute = snapshot.match.minute;
  const { durationMinutes } = snapshot.room.scoringRules.powerUps;
  const live = snapshot.room.status === 'live';
  const usedByKind = new Map(me.powerUps.map((p) => [p.kind, p]));
  const boostedPlayerIds = new Set(me.powerUps.filter((p) => p.active).map((p) => p.playerId));

  const activate = (kind: PowerUpKind, playerId: string) => {
    if (!socket) return;
    socket.emit('powerup:activate', { kind, playerId }, (result) => {
      if (!result.ok) pushToast(result.message, 'error');
      else setChoosing(null);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Available this match</SectionLabel>
        <span className="text-xs text-mist">
          {me.powerUpChargesRemaining} of {POWER_UP_KINDS.length} left
        </span>
      </div>

      {POWER_UP_KINDS.map((kind) => {
        const used = usedByKind.get(kind);
        const running = used?.active ? used : undefined;
        const spent = Boolean(used) && !running;
        const remaining = running ? Math.max(0, running.expiresAtMinute - minute) : 0;
        const target = used ? surname(players.get(used.playerId)?.fullName) : null;
        const isChoosing = choosing === kind && !used;

        return (
          <article
            key={kind}
            className={[
              'rounded-xl border p-4 transition-colors',
              running ? 'border-sky bg-sky/10' : 'border-navy-600 bg-navy-800',
              spent ? 'opacity-45' : '',
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className={`mt-0.5 size-6 shrink-0 ${spent ? 'text-mist' : 'text-sky'}`}
                aria-hidden
              >
                {ICONS[kind]}
              </svg>
              <div className="min-w-0 flex-1">
                <h3 className="text-[0.95rem] font-semibold text-white">{POWER_UP_LABELS[kind]}</h3>
                <p className="text-sm text-mist">
                  {DESCRIPTIONS[kind]} · {durationMinutes} min
                </p>
              </div>
              {spent ? (
                <span className="rounded bg-navy-700 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-mist">
                  Used
                </span>
              ) : null}
            </div>

            {running ? (
              <div className="mt-3">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-sky">On {target}</span>
                  <span className="text-mist">{remaining}' left</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-navy-700">
                  <div
                    className="h-full rounded-full bg-sky transition-[width] duration-500"
                    style={{ width: `${(remaining / durationMinutes) * 100}%` }}
                  />
                </div>
              </div>
            ) : spent ? (
              <p className="mt-2 text-xs text-mist">Used on {target}</p>
            ) : isChoosing ? (
              <div className="mt-3">
                <p className="mb-2 text-xs text-mist">Boost which player?</p>
                <div className="flex flex-wrap gap-2">
                  {me.roster.map((slot) => {
                    const busy = boostedPlayerIds.has(slot.playerId);
                    return (
                      <button
                        key={slot.playerId}
                        type="button"
                        disabled={busy}
                        title={busy ? 'This player already has a power-up running' : undefined}
                        onClick={() => activate(kind, slot.playerId)}
                        className="rounded-full border border-sky/60 px-3 py-1 text-sm font-medium text-white hover:bg-sky hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white"
                      >
                        {surname(players.get(slot.playerId)?.fullName)}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setChoosing(null)}
                    className="px-2 py-1 text-sm text-mist hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={!live || me.roster.length === 0}
                onClick={() => setChoosing(kind)}
                className="mt-3 w-full rounded-lg bg-sky py-2 text-sm font-semibold text-ink hover:bg-sky-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                Activate
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
