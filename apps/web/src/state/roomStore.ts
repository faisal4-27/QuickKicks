import type {
  DraftPickView,
  FeedItem,
  MatchRecap,
  MatchView,
  MemberView,
  Player,
  PowerUpView,
  RoomSnapshot,
  StandingRow,
  TradeView,
} from '@quickkicks/shared';
import { create } from 'zustand';

const FEED_CAP = 80;

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

interface RoomState {
  snapshot: RoomSnapshot | null;
  standings: StandingRow[];
  recap: MatchRecap | null;
  /** The member id belonging to this browser, resolved from the snapshot. */
  myMemberId: string | null;
  connected: boolean;
  toasts: Toast[];

  setSnapshot: (snapshot: RoomSnapshot, myMemberId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setStatus: (status: RoomSnapshot['room']['status']) => void;
  setMembers: (members: MemberView[]) => void;
  setPresence: (connectedMemberIds: string[]) => void;
  setStandings: (standings: StandingRow[]) => void;
  setTurn: (turn: NonNullable<RoomSnapshot['draft']['onTheClock']>) => void;
  applyPick: (pick: DraftPickView, availablePlayerIds: string[]) => void;
  completeDraft: (picks: DraftPickView[]) => void;
  applyTick: (match: MatchView) => void;
  appendFeed: (items: FeedItem[]) => void;
  applyPowerUp: (memberId: string, powerUp: PowerUpView) => void;
  expirePowerUp: (memberId: string, powerUpId: string) => void;
  applySwap: (payload: {
    memberId: string;
    outPlayerId: string;
    inPlayerId: string;
    availablePlayerIds: string[];
  }) => void;
  upsertTrade: (trade: TradeView) => void;
  setRecap: (recap: MatchRecap) => void;
  pushToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  reset: () => void;
}

let toastId = 0;

/**
 * The client keeps one snapshot and folds every server delta into it. Nothing here recomputes
 * game state: the server is the only authority, and this store only mirrors what it publishes.
 */
export const useRoomStore = create<RoomState>((set) => ({
  snapshot: null,
  standings: [],
  recap: null,
  myMemberId: null,
  connected: false,
  toasts: [],

  setSnapshot: (snapshot, myMemberId) =>
    set((state) => ({
      snapshot,
      myMemberId: myMemberId ?? state.myMemberId,
    })),

  setConnected: (connected) => set({ connected }),

  setStatus: (status) =>
    set((state) =>
      state.snapshot ? { snapshot: { ...state.snapshot, room: { ...state.snapshot.room, status } } } : state,
    ),

  setMembers: (members) =>
    set((state) => (state.snapshot ? { snapshot: { ...state.snapshot, members } } : state)),

  setPresence: (connectedMemberIds) =>
    set((state) => {
      if (!state.snapshot) return state;
      const online = new Set(connectedMemberIds);
      return {
        snapshot: {
          ...state.snapshot,
          members: state.snapshot.members.map((m) => ({ ...m, connected: online.has(m.id) })),
        },
      };
    }),

  setStandings: (standings) =>
    set((state) => {
      // Keep the member point totals in step so roster cards and the leaderboard agree.
      if (!state.snapshot) return { standings };
      const points = new Map(standings.map((s) => [s.memberId, s.points]));
      return {
        standings,
        snapshot: {
          ...state.snapshot,
          members: state.snapshot.members.map((m) => ({
            ...m,
            points: points.get(m.id) ?? m.points,
          })),
        },
      };
    }),

  setTurn: (turn) =>
    set((state) =>
      state.snapshot
        ? { snapshot: { ...state.snapshot, draft: { ...state.snapshot.draft, onTheClock: turn } } }
        : state,
    ),

  applyPick: (pick, availablePlayerIds) =>
    set((state) => {
      if (!state.snapshot) return state;
      const picks = state.snapshot.draft.picks.some((p) => p.pickNumber === pick.pickNumber)
        ? state.snapshot.draft.picks
        : [...state.snapshot.draft.picks, pick].sort((a, b) => a.pickNumber - b.pickNumber);

      const members = state.snapshot.members.map((member) =>
        member.id === pick.memberId
          ? {
              ...member,
              roster: [
                ...member.roster,
                {
                  playerId: pick.playerId,
                  slotIndex: pick.round - 1,
                  acquiredAtMinute: 0,
                  acquiredVia: 'draft' as const,
                  points: 0,
                },
              ],
            }
          : member,
      );

      return {
        snapshot: {
          ...state.snapshot,
          members,
          draft: { ...state.snapshot.draft, picks, availablePlayerIds },
        },
      };
    }),

  completeDraft: (picks) =>
    set((state) =>
      state.snapshot
        ? {
            snapshot: {
              ...state.snapshot,
              draft: { ...state.snapshot.draft, picks, onTheClock: null },
            },
          }
        : state,
    ),

  applyTick: (match) =>
    set((state) => (state.snapshot ? { snapshot: { ...state.snapshot, match } } : state)),

  appendFeed: (items) =>
    set((state) => {
      if (!state.snapshot) return state;
      const known = new Set(state.snapshot.feed.map((f) => f.id));
      const fresh = items.filter((item) => !known.has(item.id));
      if (fresh.length === 0) return state;
      return {
        snapshot: {
          ...state.snapshot,
          feed: [...fresh.reverse(), ...state.snapshot.feed].slice(0, FEED_CAP),
        },
      };
    }),

  applyPowerUp: (memberId, powerUp) =>
    set((state) => {
      if (!state.snapshot) return state;
      return {
        snapshot: {
          ...state.snapshot,
          members: state.snapshot.members.map((member) =>
            member.id === memberId
              ? {
                  ...member,
                  powerUps: [...member.powerUps.filter((p) => p.id !== powerUp.id), powerUp],
                  powerUpChargesRemaining: Math.max(0, member.powerUpChargesRemaining - 1),
                }
              : member,
          ),
        },
      };
    }),

  expirePowerUp: (memberId, powerUpId) =>
    set((state) => {
      if (!state.snapshot) return state;
      return {
        snapshot: {
          ...state.snapshot,
          members: state.snapshot.members.map((member) =>
            member.id === memberId
              ? {
                  ...member,
                  powerUps: member.powerUps.map((p) =>
                    p.id === powerUpId ? { ...p, active: false } : p,
                  ),
                }
              : member,
          ),
        },
      };
    }),

  applySwap: (payload) =>
    set((state) => {
      if (!state.snapshot) return state;
      return {
        snapshot: {
          ...state.snapshot,
          draft: { ...state.snapshot.draft, availablePlayerIds: payload.availablePlayerIds },
        },
      };
    }),

  upsertTrade: (trade) =>
    set((state) => {
      if (!state.snapshot) return state;
      const others = state.snapshot.trades.filter((t) => t.id !== trade.id);
      return { snapshot: { ...state.snapshot, trades: [trade, ...others] } };
    }),

  setRecap: (recap) => set({ recap }),

  pushToast: (message, tone = 'info') =>
    set((state) => {
      toastId += 1;
      return { toasts: [...state.toasts, { id: toastId, message, tone }].slice(-4) };
    }),

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  reset: () => set({ snapshot: null, standings: [], recap: null, myMemberId: null, connected: false }),
}));

/** Player lookup built from the snapshot, so components never hold a stale copy. */
export function playerIndex(snapshot: RoomSnapshot | null): Map<string, Player> {
  if (!snapshot) return new Map();
  return new Map(snapshot.players.map((p) => [p.id, p]));
}

export function memberById(snapshot: RoomSnapshot | null, memberId: string | null) {
  if (!snapshot || !memberId) return null;
  return snapshot.members.find((m) => m.id === memberId) ?? null;
}
