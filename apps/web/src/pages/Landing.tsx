import type { FixtureView } from '@quickkicks/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom, joinRoom, listFixtures, rememberMember } from '../lib/api.js';
import { fixtureMeta } from '../lib/fixtures.js';
import { useSession } from '../session.js';
import { useRoomStore } from '../state/roomStore.js';

export function LandingPage() {
  const { user, ready, signIn } = useSession();
  const navigate = useNavigate();
  const pushToast = useRoomStore((s) => s.pushToast);
  const [name, setName] = useState(user?.displayName ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fixtures, setFixtures] = useState<FixtureView[] | null>(null);
  const [fixtureId, setFixtureId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFixtures()
      .then(({ fixtures: list }) => {
        if (cancelled) return;
        setFixtures(list);
        // Default to a match that can be drafted right away.
        setFixtureId((list.find((f) => f.lineupsAnnounced) ?? list[0])?.id ?? null);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setFixtures([]);
        pushToast(error.message, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  const ensureName = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error('Pick a name of at least 2 characters.');
    if (!user || user.displayName !== trimmed) return signIn(trimmed);
    return user;
  };

  const onCreate = async () => {
    if (!fixtureId) {
      pushToast('Pick a match to play.', 'error');
      return;
    }
    setBusy(true);
    try {
      await ensureName();
      const room = await createRoom(fixtureId);
      rememberMember(room.roomId, room.memberId);
      navigate(`/room/${room.roomId}`);
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
        <p className="eyebrow">Premier League · two players · live</p>
        <h1>QuickKicks</h1>
        <p className="lede">
          Draft two Premier League players. Live or die by their stats for ninety minutes. No
          benches, no weekly grind — just one match with your friends.
        </p>
      </div>

      <form
        className="landing__card"
        onSubmit={(e) => {
          e.preventDefault();
          void onCreate();
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

        <fieldset className="fixture-picker">
          <legend>Match</legend>
          {fixtures === null ? (
            <p className="muted">Loading matches…</p>
          ) : fixtures.length === 0 ? (
            <p className="muted">No upcoming matches right now.</p>
          ) : (
            fixtures.map((fixture) => (
              <label
                key={fixture.id}
                className={`fixture-option ${fixture.id === fixtureId ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="fixture"
                  value={fixture.id}
                  checked={fixture.id === fixtureId}
                  onChange={() => setFixtureId(fixture.id)}
                />
                <span className="fixture-option__teams">
                  {fixture.homeTeam.name} vs {fixture.awayTeam.name}
                </span>
                <span className="fixture-option__meta">{fixtureMeta(fixture)}</span>
                <span className={`lineup-badge ${fixture.lineupsAnnounced ? 'is-out' : ''}`}>
                  {fixture.lineupsAnnounced ? 'XIs out' : 'XIs pending'}
                </span>
              </label>
            ))
          )}
        </fieldset>

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !ready || !fixtureId}
        >
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
