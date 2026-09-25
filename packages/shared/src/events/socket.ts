import type { PowerUpKind } from '../types/enums.js';
import type {
  DraftPickView,
  FeedItem,
  MatchRecap,
  MatchView,
  MemberView,
  PowerUpView,
  RoomSnapshot,
  StandingRow,
  TradeView,
} from '../types/view.js';

/**
 * Every message the server can push. Both sides import this map, so renaming a field is a
 * compile error rather than a silent runtime mismatch.
 */
export interface ServerToClientEvents {
  'room:snapshot': (payload: RoomSnapshot) => void;
  'room:status': (payload: { status: RoomSnapshot['room']['status'] }) => void;
  'presence:update': (payload: { connectedMemberIds: string[] }) => void;
  'members:update': (payload: { members: MemberView[] }) => void;

  'draft:turn': (payload: {
    memberId: string;
    pickNumber: number;
    round: number;
    deadlineMs: number;
  }) => void;
  'draft:pick-made': (payload: {
    pick: DraftPickView;
    availablePlayerIds: string[];
  }) => void;
  'draft:complete': (payload: { picks: DraftPickView[] }) => void;

  'match:tick': (payload: MatchView) => void;
  'match:events': (payload: { items: FeedItem[] }) => void;
  'match:finished': (payload: { recap: MatchRecap }) => void;

  'score:update': (payload: { standings: StandingRow[] }) => void;

  'powerup:activated': (payload: { memberId: string; powerUp: PowerUpView }) => void;
  'powerup:expired': (payload: { memberId: string; powerUpId: string }) => void;

  'swap:executed': (payload: {
    memberId: string;
    outPlayerId: string;
    inPlayerId: string;
    minute: number;
    availablePlayerIds: string[];
  }) => void;

  'trade:proposed': (payload: { trade: TradeView }) => void;
  'trade:resolved': (payload: { trade: TradeView }) => void;

  'action:error': (payload: { action: string; message: string }) => void;
}

/** Acks let the client surface a failure on the button that caused it. */
export type Ack = (result: { ok: true } | { ok: false; message: string }) => void;

export interface ClientToServerEvents {
  'room:subscribe': (payload: { roomId: string }, ack: Ack) => void;
  'room:start-draft': (payload: Record<string, never>, ack: Ack) => void;
  'draft:pick': (payload: { playerId: string }, ack: Ack) => void;
  'powerup:activate': (payload: { kind: PowerUpKind; playerId: string }, ack: Ack) => void;
  'swap:execute': (payload: { outPlayerId: string; inPlayerId: string }, ack: Ack) => void;
  'trade:propose': (
    payload: { toMemberId: string; offeredPlayerId: string; requestedPlayerId: string },
    ack: Ack,
  ) => void;
  'trade:respond': (payload: { tradeId: string; accept: boolean }, ack: Ack) => void;
  'trade:cancel': (payload: { tradeId: string }, ack: Ack) => void;
}
