import { formatPoints } from '@quickkicks/shared';
import { memberById, useRoomStore } from '../../state/roomStore.js';
import { SectionLabel } from './shared.js';
import { useRankTrends, useStandingRows } from './useStandings.js';

const MEDALS = ['text-gold', 'text-silver', 'text-bronze'];

export function LeaderboardPanel() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const rows = useStandingRows();
  const trends = useRankTrends(rows);

  if (!snapshot) return null;

  return (
    <aside className="flex min-h-0 flex-col border-navy-700 bg-navy-900/60 lg:border-l">
      <header className="flex items-center gap-2 border-b border-navy-700 px-4 py-3.5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4 text-gold" aria-hidden>
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" strokeLinejoin="round" />
        </svg>
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-sky">Leaderboard</h2>
      </header>

      <ol className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {rows.map((row) => {
          const mine = row.memberId === myMemberId;
          const member = memberById(snapshot, row.memberId);
          const trend = trends.get(row.memberId);
          return (
            <li
              key={row.memberId}
              className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${mine ? 'border-sky/70 bg-sky/10' : 'border-navy-700 bg-navy-800'}`}
            >
              <span className={`w-6 text-center font-display text-lg font-bold ${MEDALS[row.rank - 1] ?? 'text-mist'}`}>
                {row.tied ? 'T' : ''}
                {row.rank}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${member?.connected ? 'bg-gain' : 'bg-navy-600'}`}
                  title={member?.connected ? 'Online' : 'Offline'}
                />
                <span className={`truncate ${mine ? 'font-semibold text-sky' : 'text-white'}`}>
                  {row.displayName}
                </span>
                {mine ? <span className="shrink-0 text-xs text-sky">← you</span> : null}
              </span>
              <span className="font-display text-xl font-bold text-white">{formatPoints(row.points)}</span>
              <span
                className={`w-3 text-xs ${trend === 'up' ? 'text-gain' : trend === 'down' ? 'text-loss' : 'text-transparent'}`}
                aria-label={trend ? `Moved ${trend}` : undefined}
              >
                {trend === 'down' ? '▼' : '▲'}
              </span>
            </li>
          );
        })}
      </ol>

      <MatchScore />
    </aside>
  );
}

function MatchScore() {
  const snapshot = useRoomStore((s) => s.snapshot);
  if (!snapshot) return null;

  const { homeTeam, awayTeam, kickoffAt, simulated } = snapshot.fixture;
  const { minute, homeGoals, awayGoals, status } = snapshot.match;
  const kickoff = new Date(kickoffAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const clock =
    status === 'half_time'
      ? 'HT'
      : status === 'finished'
        ? 'FT'
        : status === 'scheduled' && !simulated
          ? `KO ${kickoff}`
          : `${minute}'`;

  return (
    <section className="border-t border-navy-700 p-4">
      <SectionLabel className="mb-3">Match score</SectionLabel>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <p className="truncate text-sm text-sky">{homeTeam.name}</p>
          <p className="font-display text-5xl leading-none font-extrabold text-white">{homeGoals}</p>
        </div>
        <p className="pb-2 font-display text-lg font-bold text-mist">{clock}</p>
        <div className="text-right">
          <p className="truncate text-sm text-sky">{awayTeam.name}</p>
          <p className="font-display text-5xl leading-none font-extrabold text-white">{awayGoals}</p>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-mist">
        {simulated
          ? `Simulated match · 90' in about ${Math.round((snapshot.room.msPerMatchMinute * 90) / 60_000)} min`
          : 'Live match data · updates every minute or two'}
      </p>
    </section>
  );
}
