import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket.js';
import { fetchRecap, fetchRoom, rememberMember, rememberedMember } from '../lib/api.js';
import { useSession } from '../session.js';
import { useRoomStore } from '../state/roomStore.js';
import { Draft } from './Draft.js';
import { Live } from './Live.js';
import { Lobby } from './Lobby.js';
import { Recap } from './Recap.js';

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const { user, ready } = useSession();
  const snapshot = useRoomStore((s) => s.snapshot);
  const recap = useRoomStore((s) => s.recap);
  const setSnapshot = useRoomStore((s) => s.setSnapshot);
  const setRecap = useRoomStore((s) => s.setRecap);
  const pushToast = useRoomStore((s) => s.pushToast);
  const [memberId, setMemberId] = useState<string | null>(() =>
    roomId ? rememberedMember(roomId) : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !ready) return;
    if (!user) {
      setLoadError('Pick a name on the home page first, then join this room.');
      return;
    }

    let cancelled = false;
    fetchRoom(roomId)
      .then((payload) => {
        if (cancelled) return;
        const { myMemberId, ...room } = payload;
        if (!myMemberId) {
          setLoadError('You are not in this room. Join from the home page with the code.');
          return;
        }
        rememberMember(roomId, myMemberId);
        setMemberId(myMemberId);
        setSnapshot(room, myMemberId);
        if (room.room.status === 'finished') {
          void fetchRecap(roomId).then((result) => setRecap(result.recap));
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setLoadError(error.message);
          pushToast(error.message, 'error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [roomId, ready, user, setSnapshot, setRecap, pushToast]);

  const socket = useSocket(roomId && memberId ? roomId : '', memberId);

  if (!roomId) return null;

  if (loadError) {
    return (
      <main className="page page--narrow">
        <h1>Could not open the room</h1>
        <p className="lede">{loadError}</p>
        <Link className="btn btn--primary" to="/">
          Back home
        </Link>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="page page--narrow">
        <p className="muted">Loading the room…</p>
      </main>
    );
  }

  const status = snapshot.room.status;
  const showRecap = status === 'finished' || Boolean(recap);

  return (
    <>
      <nav className="topbar">
        <Link to="/" className="brand">
          QuickKicks
        </Link>
        <span className="topbar__code">{snapshot.room.joinCode}</span>
        <span className={`status-pill status-pill--${status}`}>{status}</span>
      </nav>
      {showRecap ? (
        <Recap />
      ) : status === 'lobby' ? (
        <Lobby socket={socket} />
      ) : status === 'drafting' ? (
        <Draft socket={socket} />
      ) : (
        <Live socket={socket} />
      )}
    </>
  );
}
