import { Link } from 'react-router-dom';
import { memberById, useRoomStore } from '../../state/roomStore.js';
import { Avatar } from './shared.js';

export function LiveTopBar() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const connected = useRoomStore((s) => s.connected);
  const me = memberById(snapshot, myMemberId);

  if (!snapshot) return null;

  const { minute, status } = snapshot.match;
  const badge =
    status === 'half_time' ? 'HT' : status === 'finished' ? 'FT' : status === 'scheduled' ? 'Kick-off' : `LIVE · ${minute}'`;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-navy-700 bg-navy-900/90 px-4 py-3 backdrop-blur lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/"
          className="font-display text-2xl font-extrabold uppercase tracking-wide text-sky no-underline"
        >
          QuickKicks <span aria-hidden>⚽</span>
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-gain/40 bg-gain/10 px-2 py-0.5 font-display text-sm font-bold tracking-wider text-gain">
          {status === 'live' ? <span className="size-1.5 animate-pulse rounded-full bg-gain" /> : null}
          {badge}
        </span>
        {connected ? null : (
          <span className="hidden text-xs text-loss sm:inline">Reconnecting…</span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-4">
        <span className="hidden truncate text-sm text-sky md:inline">
          {snapshot.fixture.homeTeam.name} vs {snapshot.fixture.awayTeam.name}
        </span>
        {me ? (
          <span className="flex items-center gap-2">
            <Avatar name={me.displayName} />
            <span className="hidden text-sm font-medium text-white sm:inline">{me.displayName}</span>
          </span>
        ) : null}
      </div>
    </header>
  );
}
