import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinRoom, rememberMember } from '../lib/api.js';
import { useSession } from '../session.js';
import { useRoomStore } from '../state/roomStore.js';

export function LandingPage() {
  const { user, ready, signIn } = useSession();
  const navigate = useNavigate();
  const pushToast = useRoomStore((s) => s.pushToast);
  const [name, setName] = useState(user?.displayName ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const ensureName = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error('Pick a name of at least 2 characters.');
    if (!user || user.displayName !== trimmed) return signIn(trimmed);
    return user;
  };

  // The nickname is settled here so the fixture browser is nothing but fixtures.
  const onHost = async () => {
    setBusy(true);
    try {
      await ensureName();
      navigate('/host');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    setBusy(true);
    try {
      await ensureName();
      const room = await joinRoom(code.trim());
      rememberMember(room.roomId, room.memberId);
      navigate(`/room/${room.roomId}`);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="landing">
      <div className="landing__hero">
        <p className="eyebrow">One match · two players · live</p>
        <h1>QuickKicks</h1>
        <p className="lede">
          Draft two starters from a single match. Live or die by their stats for ninety minutes. No
          benches, no weekly grind — just one fixture with your friends.
        </p>
      </div>

      <form
        className="landing__card"
        onSubmit={(e) => {
          e.preventDefault();
          void onHost();
        }}
      >
        <label className="field">
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="e.g. Fab"
            autoComplete="nickname"
            disabled={!ready}
          />
        </label>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !ready}>
          Host a room
        </button>

        <div className="landing__split">
          <span>or join with a code</span>
        </div>

        <div className="row">
          <input
            className="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={8}
            autoCapitalize="characters"
          />
          <button type="button" className="btn" disabled={busy || code.length < 4} onClick={() => void onJoin()}>
            Join
          </button>
        </div>
      </form>
    </main>
  );
}
