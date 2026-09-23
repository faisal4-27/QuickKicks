import { EventFeed } from '../components/EventFeed.js';
import { Leaderboard } from '../components/Leaderboard.js';
import { MatchHeader } from '../components/MatchHeader.js';
import { PowerUpBar } from '../components/PowerUpBar.js';
import { RosterStrip } from '../components/RosterStrip.js';
import { SwapPanel } from '../components/SwapPanel.js';
import { TradeModal } from '../components/TradeModal.js';
import type { AppSocket } from '../hooks/useSocket.js';

interface Props {
  socket: AppSocket | null;
}

export function Live({ socket }: Props) {
  return (
    <main className="page page--live">
      <MatchHeader />
      <div className="live-grid">
        <div className="live-grid__main">
          <Leaderboard />
          <RosterStrip />
          <PowerUpBar socket={socket} />
          <SwapPanel socket={socket} />
          <TradeModal socket={socket} />
        </div>
        <EventFeed />
      </div>
    </main>
  );
}
