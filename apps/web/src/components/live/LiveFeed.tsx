import { EVENT_LABELS, formatPoints } from '@quickkicks/shared';
import { useState } from 'react';
import { kitFor } from '../../lib/teamKits.js';
import { memberById, playerIndex, useRoomStore } from '../../state/roomStore.js';
import { surname, teamFor } from './shared.js';

/**
 * Off: only events that paid (or cost) this manager. On: every event in the room, each labelled
 * with the manager who owned the player at that minute.
 */
export function LiveFeed() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const [showAll, setShowAll] = useState(false);
  const players = playerIndex(snapshot);

  if (!snapshot) return null;

  const items = showAll
    ? snapshot.feed
    : snapshot.feed.filter((item) => item.awards.some((a) => a.memberId === myMemberId));

  return (
    <section className="mt-8 w-full max-w-2xl rounded-2xl border border-navy-600 bg-navy-850">
      <header className="flex items-center justify-between gap-3 border-b border-navy-700 px-4 py-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap uppercase tracking-[0.12em] text-sky sm:text-sm sm:tracking-[0.14em]">
          <span className="size-2 animate-pulse rounded-full bg-gain" aria-hidden />
          Live scoring feed
        </h3>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-navy-600 bg-navy-800 py-1 pr-3 pl-1.5 text-xs text-mist select-none">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          <span className="relative h-4 w-7 rounded-full bg-navy-600 transition-colors peer-checked:bg-sky after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-3 peer-focus-visible:outline-2 peer-focus-visible:outline-sky" />
          All players' points
        </label>
      </header>

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-mist">
          {showAll
            ? 'Waiting for the first moment that matters.'
            : 'Nothing from your players yet. Passes still count toward your total.'}
        </p>
      ) : (
        <ol className="max-h-[60dvh] touch-pan-y divide-y divide-navy-700 overflow-y-auto overscroll-y-contain rounded-b-2xl lg:max-h-[26rem]">
          {items.map((item) => {
            const player = item.playerId ? players.get(item.playerId) : undefined;
            const kit = kitFor(player ? teamFor(snapshot, player.teamId) : undefined);
            const award = showAll
              ? item.awards[0]
              : item.awards.find((a) => a.memberId === myMemberId);
            const mine = award?.memberId === myMemberId;
            const owner = award ? memberById(snapshot, award.memberId)?.displayName : null;

            return (
              <li
                key={item.id}
                className={`grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-3 px-4 py-3 ${showAll && mine ? 'bg-sky/10' : ''}`}
              >
                <span className="font-display text-sm font-bold text-sky">{item.minute}'</span>
                <span
                  className="max-w-[8rem] truncate rounded px-2 py-0.5 font-display text-sm font-bold tracking-wide"
                  style={{ background: kit.body, color: kit.ink }}
                >
                  {surname(player?.fullName ?? item.playerName ?? undefined)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.95rem] text-white">{EVENT_LABELS[item.type]}</span>
                  {showAll ? (
                    <span className={`block truncate text-xs ${mine ? 'font-semibold text-sky' : 'text-mist'}`}>
                      {owner ? (mine ? 'You' : owner) : 'Undrafted'}
                    </span>
                  ) : null}
                </span>
                {award ? (
                  <span
                    className={`text-right font-display text-lg font-bold ${award.awardedPoints < 0 ? 'text-loss' : 'text-gain'}`}
                  >
                    {formatPoints(award.awardedPoints, { signed: true })}
                    {award.multiplier > 1 ? (
                      <span className="ml-1 text-xs text-sky">×{award.multiplier}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-right text-sm text-mist">–</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
