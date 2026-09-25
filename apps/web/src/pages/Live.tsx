import { ActionsPanel } from '../components/live/ActionsPanel.js';
import { LeaderboardPanel } from '../components/live/LeaderboardPanel.js';
import { LiveTopBar } from '../components/live/LiveTopBar.js';
import { ScorePanel } from '../components/live/ScorePanel.js';
import type { AppSocket } from '../hooks/useSocket.js';

interface Props {
  socket: AppSocket | null;
}

/**
 * Three columns on desktop, each scrolling on its own inside a full-height screen. On a phone
 * they stack with the manager's own score first, since that is what they opened the page for.
 */
export function Live({ socket }: Props) {
  return (
    <div className="qk-live flex min-h-dvh flex-col bg-navy-900 font-sans text-white lg:h-dvh">
      <LiveTopBar />
      <main className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)_20rem] xl:grid-cols-[22rem_minmax(0,1fr)_22rem]">
        <div className="order-2 min-h-0 lg:order-1 lg:flex lg:flex-col">
          <ActionsPanel socket={socket} />
        </div>
        <div className="order-1 min-h-0 lg:order-2 lg:flex lg:flex-col">
          <ScorePanel />
        </div>
        <div className="order-3 min-h-0 lg:flex lg:flex-col">
          <LeaderboardPanel />
        </div>
      </main>
    </div>
  );
}
