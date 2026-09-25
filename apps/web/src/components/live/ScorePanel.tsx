import { POWER_UP_LABELS, formatPoints } from '@quickkicks/shared';
import { kitFor } from '../../lib/teamKits.js';
import { memberById, playerIndex, useRoomStore } from '../../state/roomStore.js';
import { Jersey } from './Jersey.js';
import { LiveFeed } from './LiveFeed.js';
import { SectionLabel, surname, teamFor } from './shared.js';
import { useStandingRows } from './useStandings.js';

export function ScorePanel() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const rows = useStandingRows();
  const me = memberById(snapshot, myMemberId);
  const players = playerIndex(snapshot);

  if (!snapshot || !me) return null;

  const myRow = rows.find((r) => r.memberId === me.id);
  const minute = snapshot.match.minute;
  const [first, second] = me.roster;

  const card = (slot: typeof first) => {
    if (!slot) return <div className="flex-1" />;
    const player = players.get(slot.playerId);
    const team = player ? teamFor(snapshot, player.teamId) : undefined;
    const boost = me.powerUps.find((p) => p.active && p.playerId === slot.playerId);

    return (
      <div className="flex min-w-0 flex-1 flex-col items-center text-center">
        <span className="rounded-full border border-sky/70 bg-sky/10 px-4 py-1 font-display text-lg font-bold tracking-wider text-sky">
          {formatPoints(slot.points)} PTS
        </span>
        <span className={`mt-2 h-5 text-xs font-semibold ${boost ? 'text-sky' : 'text-transparent'}`}>
          {boost ? `⚡ ${POWER_UP_LABELS[boost.kind]} · ${Math.max(0, boost.expiresAtMinute - minute)}'` : '·'}
        </span>
        <Jersey
          kit={kitFor(team)}
          number={player?.shirtNumber ?? null}
          boosted={Boolean(boost)}
          className="my-2 w-32 sm:w-44"
        />
        <h2 className="max-w-full truncate font-display text-2xl font-extrabold uppercase tracking-wide text-white sm:text-3xl">
          {surname(player?.fullName)}
        </h2>
        <p className="text-sm text-sky">
          {team?.name} · {player?.position}
        </p>
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-col items-center overflow-y-auto px-4 py-6 lg:px-8">
      <SectionLabel className="text-sky!">Total score</SectionLabel>
      <p className="mt-1 font-display text-7xl leading-none font-extrabold text-white sm:text-8xl">
        {formatPoints(me.points)}
      </p>
      <p className="mt-2 text-sm text-mist">
        {myRow ? `Rank #${myRow.rank}${myRow.tied ? ' (tied)' : ''} of ${rows.length}` : ''}
      </p>

      <div className="mt-6 flex w-full max-w-xl items-center gap-2 sm:gap-6">
        {card(first)}
        <div className="flex flex-col items-center gap-2 self-stretch py-10" aria-hidden>
          <span className="w-px flex-1 bg-linear-to-b from-transparent to-navy-600" />
          <span className="font-display text-sm font-bold tracking-widest text-mist">VS</span>
          <span className="w-px flex-1 bg-linear-to-t from-transparent to-navy-600" />
        </div>
        {card(second)}
      </div>

      <LiveFeed />
    </section>
  );
}
