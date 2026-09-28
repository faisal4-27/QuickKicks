import type { ClientToServerEvents, ServerToClientEvents } from '@quickkicks/shared';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { fetchRoom } from '../lib/api.js';
import { useRoomStore } from '../state/roomStore.js';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Owns the single socket for a room. On every (re)connect it resubscribes and the server replies
 * with a fresh snapshot, so a dropped connection self-heals rather than leaving a stale board.
 */
export function useSocket(roomId: string, myUserMemberId: string | null): AppSocket | null {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const store = useRoomStore;

  useEffect(() => {
    if (!roomId || !myUserMemberId) return;

    const socket: AppSocket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    setSocket(socket);

    const subscribe = () => {
      socket.emit('room:subscribe', { roomId }, (result) => {
        if (!result.ok) store.getState().pushToast(result.message, 'error');
      });
    };

    socket.on('connect', () => {
      store.getState().setConnected(true);
      subscribe();
    });
    socket.on('disconnect', () => store.getState().setConnected(false));
    socket.on('connect_error', (error) => {
      store.getState().setConnected(false);
      store.getState().pushToast(error.message, 'error');
    });

    socket.on('room:snapshot', (snapshot) => {
      store.getState().setSnapshot(snapshot, myUserMemberId);
      store.getState().setStandings(
        [...snapshot.members]
          .sort((a, b) => b.points - a.points || a.draftPosition - b.draftPosition)
          .map((member, index) => ({
            memberId: member.id,
            displayName: member.displayName,
            points: member.points,
            rank: index + 1,
            tied: false,
          })),
      );
    });

    socket.on('room:status', ({ status }) => {
      store.getState().setStatus(status);
      if (status === 'drafting') store.getState().pushToast('The draft is under way.');
      if (status === 'live') store.getState().pushToast('Kick off. Points are live.');
    });

    socket.on('presence:update', ({ connectedMemberIds }) =>
      store.getState().setPresence(connectedMemberIds),
    );
    socket.on('members:update', ({ members }) => store.getState().setMembers(members));
    socket.on('fixture:lineups', () => {
      store.getState().pushToast('Starting XIs are out. The draft can start.');
      // The fixture flag and the draft pool both change, so take a clean snapshot.
      void fetchRoom(roomId).then((payload) => {
        const { myMemberId, ...snapshot } = payload;
        store.getState().setSnapshot(snapshot, myMemberId ?? myUserMemberId);
      });
    });
    socket.on('score:update', ({ standings }) => store.getState().setStandings(standings));

    socket.on('draft:turn', (turn) => store.getState().setTurn(turn));
    socket.on('draft:pick-made', ({ pick, availablePlayerIds }) =>
      store.getState().applyPick(pick, availablePlayerIds),
    );
    socket.on('draft:complete', ({ picks }) => {
      store.getState().completeDraft(picks);
      // The rosters and the available pool both moved, so take a clean snapshot.
      void fetchRoom(roomId).then((payload) => {
        const { myMemberId, ...snapshot } = payload;
        store.getState().setSnapshot(snapshot, myMemberId ?? myUserMemberId);
      });
    });

    socket.on('match:tick', (match) => store.getState().applyTick(match));
    socket.on('match:events', ({ items }) => store.getState().appendFeed(items));
    socket.on('match:finished', ({ recap }) => {
      store.getState().setRecap(recap);
      store.getState().pushToast('Full time.');
    });

    socket.on('powerup:activated', ({ memberId, powerUp }) =>
      store.getState().applyPowerUp(memberId, powerUp),
    );
    socket.on('powerup:expired', ({ memberId, powerUpId }) =>
      store.getState().expirePowerUp(memberId, powerUpId),
    );

    socket.on('swap:executed', (payload) => {
      store.getState().applySwap(payload);
      void fetchRoom(roomId).then((payload) => {
        const { myMemberId, ...snapshot } = payload;
        store.getState().setSnapshot(snapshot, myMemberId ?? myUserMemberId);
      });
    });

    socket.on('trade:proposed', ({ trade }) => store.getState().upsertTrade(trade));
    socket.on('trade:resolved', ({ trade }) => {
      store.getState().upsertTrade(trade);
      if (trade.status === 'accepted') {
        void fetchRoom(roomId).then((payload) => {
          const { myMemberId, ...snapshot } = payload;
          store.getState().setSnapshot(snapshot, myMemberId ?? myUserMemberId);
        });
      }
    });

    socket.on('action:error', ({ message }) => store.getState().pushToast(message, 'error'));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setSocket(null);
      store.getState().reset();
    };
  }, [roomId, myUserMemberId, store]);

  return socket;
}
