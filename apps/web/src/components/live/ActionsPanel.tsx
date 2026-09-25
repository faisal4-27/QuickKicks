import { useState, type ReactNode } from 'react';
import type { AppSocket } from '../../hooks/useSocket.js';
import { useRoomStore } from '../../state/roomStore.js';
import { PowerUpsTab } from './PowerUpsTab.js';
import { Avatar, SectionLabel } from './shared.js';
import { SwapTab } from './SwapTab.js';
import { TradesTab } from './TradesTab.js';

type Tab = 'powerups' | 'swap' | 'trades';

interface Props {
  socket: AppSocket | null;
}

export function ActionsPanel({ socket }: Props) {
  const snapshot = useRoomStore((s) => s.snapshot);
  const myMemberId = useRoomStore((s) => s.myMemberId);
  const [tab, setTab] = useState<Tab>('powerups');

  if (!snapshot) return null;

  const incomingOffers = snapshot.trades.filter(
    (t) => t.status === 'pending' && t.toMemberId === myMemberId,
  ).length;

  const tabs: { id: Tab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: 'powerups', label: 'Power-ups', icon: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" strokeLinejoin="round" /> },
    {
      id: 'swap',
      label: 'Swap',
      icon: <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4m4 4H7" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      id: 'trades',
      label: 'Trades',
      icon: <path d="M8 7h12m0 0-3-3m3 3-3 3M16 17H4m0 0 3 3m-3-3 3-3" strokeLinecap="round" strokeLinejoin="round" />,
      badge: incomingOffers,
    },
  ];

  return (
    <aside className="flex min-h-0 flex-col border-navy-700 bg-navy-900/60 lg:border-r">
      <div role="tablist" className="flex border-b border-navy-700">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 border-b-2 px-1.5 py-3.5 text-[0.7rem] font-semibold whitespace-nowrap uppercase tracking-[0.12em] ${active ? 'border-sky bg-sky/5 text-sky' : 'border-transparent text-mist hover:text-white'}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4" aria-hidden>
                {t.icon}
              </svg>
              {t.label}
              {t.badge ? (
                <span className="grid size-4 place-items-center rounded-full bg-loss text-[0.6rem] font-bold text-white">
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        {tab === 'powerups' ? <PowerUpsTab socket={socket} /> : null}
        {tab === 'swap' ? <SwapTab socket={socket} /> : null}
        {tab === 'trades' ? <TradesTab socket={socket} /> : null}
      </div>

      <RoomInfo />
    </aside>
  );
}

function RoomInfo() {
  const snapshot = useRoomStore((s) => s.snapshot);
  const pushToast = useRoomStore((s) => s.pushToast);
  const [copied, setCopied] = useState(false);

  if (!snapshot) return null;

  const host = snapshot.members.find((m) => m.isHost);
  const code = snapshot.room.joinCode;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast(`Copy failed. The code is ${code}.`, 'error');
    }
  };

  return (
    <section className="border-t border-navy-700 p-4">
      <SectionLabel className="mb-3">Room info</SectionLabel>
      <p className="text-xs text-mist">Host</p>
      <p className="mt-1 mb-3 flex items-center gap-2 font-medium text-white">
        <Avatar name={host?.displayName ?? '?'} size="sm" />
        {host?.displayName ?? 'Unknown'}
      </p>
      <p className="mb-1 text-xs text-mist">Game key</p>
      <button
        type="button"
        onClick={copy}
        title="Copy game key"
        className="flex w-full items-center justify-between rounded-lg border border-navy-600 bg-navy-800 px-3 py-2.5 hover:border-sky/60"
      >
        <span className="font-display text-lg font-bold tracking-[0.2em] text-sky">{code}</span>
        <span className="text-xs text-mist">{copied ? 'Copied ✓' : 'Copy'}</span>
      </button>
    </section>
  );
}
