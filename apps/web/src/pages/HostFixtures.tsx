import { groupFixturesByDay, type FixtureView } from '@quickkicks/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createRoom, listFixtures, rememberMember } from '../lib/api.js';
import { dayTabLabel, kickoffTime, lineupTiming, todayKey } from '../lib/fixtures.js';
import { useSession } from '../session.js';
import { useRoomStore } from '../state/roomStore.js';

/**
 * The host's match picker, laid out the way a livescore app does it: a tab per day, then a section
 * per country, then a block per competition. The grouping itself is `groupFixturesByDay` in shared,
 * so this file only decides what it looks like.
 *
 * Every fixture is hostable, announced XIs or not. The draft is what waits on the lineup, and the
 * lobby unlocks itself when `fixture:lineups` arrives, so there is no reason to make someone come
 * back here an hour before kickoff.
 */
export function HostFixturesPage() {
  const navigate = useNavigate();
  const { user, ready } = useSession();
  const pushToast = useRoomStore((s) => s.pushToast);
  const [fixtures, setFixtures] = useState<FixtureView[] | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [hosting, setHosting] = useState<string | null>(null);

  // Hosting needs a nickname, and that is what the landing page collects.
  useEffect(() => {
    if (ready && !user) navigate('/', { replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    let cancelled = false;
    listFixtures()
      .then(({ fixtures: list }) => {
        if (!cancelled) setFixtures(list);
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

  const days = useMemo(() => groupFixturesByDay(fixtures ?? []), [fixtures]);
  const today = todayKey();

  // Open on today when today has matches, otherwise on the next day that does.
  const selectedDay =
    days.find((d) => d.date === activeDay) ?? days.find((d) => d.date === today) ?? days[0];

  const host = async (fixture: FixtureView) => {
    setHosting(fixture.id);
    try {
      const room = await createRoom(fixture.id);
      rememberMember(room.roomId, room.memberId);
      navigate(`/room/${room.roomId}`);
    } catch (error) {
      pushToast((error as Error).message, 'error');
      setHosting(null);
    }
  };

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">Host a room</p>
          <h1>Pick a match</h1>
          <p className="lede">
            Draft two starters from one match and score off it live. Pick any fixture — the draft
            opens as soon as its starting XIs are announced.
          </p>
        </div>
        <Link className="btn page__head-action" to="/">
          Back
        </Link>
      </header>

      {fixtures === null ? (
        <p className="muted">Loading fixtures…</p>
      ) : days.length === 0 ? (
        <p className="muted">No upcoming fixtures right now. Run `npm run seed` to load some.</p>
      ) : (
        <>
          <nav className="day-tabs" aria-label="Match day">
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                className={`day-tab ${day.date === selectedDay?.date ? 'is-active' : ''}`}
                aria-current={day.date === selectedDay?.date}
                onClick={() => setActiveDay(day.date)}
              >
                <span className="day-tab__label">{dayTabLabel(day.date, today)}</span>
                <span className="day-tab__count">{day.fixtureCount}</span>
              </button>
            ))}
          </nav>

          {selectedDay?.countries.map((country) => (
            <section className="country" key={country.name}>
              <h2 className="country__head">
                {country.flagUrl ? (
                  <img className="country__flag" src={country.flagUrl} alt="" />
                ) : (
                  <span className="country__flag country__flag--world" aria-hidden="true" />
                )}
                {country.name}
              </h2>

              {country.competitions.map(({ competition, fixtures: matches }) => (
                <div className="competition" key={competition.id}>
                  <header className="competition__head">
                    {competition.logoUrl ? (
                      <img className="competition__logo" src={competition.logoUrl} alt="" />
                    ) : null}
                    <h3>{competition.name}</h3>
                    {matches[0]?.round ? <span className="muted small">{matches[0].round}</span> : null}
                  </header>

                  <ul className="fixture-rows">
                    {matches.map((fixture) => {
                      const lineups = lineupTiming(fixture);
                      return (
                        <li key={fixture.id}>
                          <button
                            type="button"
                            className="fixture-row"
                            disabled={hosting !== null}
                            onClick={() => void host(fixture)}
                          >
                            <time className="fixture-row__time" dateTime={fixture.kickoffAt}>
                              {kickoffTime(fixture.kickoffAt)}
                            </time>
                            <span className="fixture-row__teams">
                              <span>{fixture.homeTeam.name}</span>
                              <span>{fixture.awayTeam.name}</span>
                            </span>
                            <span
                              className={`lineup-badge ${
                                lineups.announced ? 'is-out' : 'lineup-badge--timed'
                              }`}
                              title={lineups.hint}
                            >
                              {lineups.label}
                            </span>
                            <span className="fixture-row__cta">
                              {hosting === fixture.id ? 'Creating…' : 'Host'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
