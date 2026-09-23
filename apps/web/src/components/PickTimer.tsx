import { useEffect, useState } from 'react';

interface Props {
  deadlineMs: number;
  label: string;
}

/**
 * Counts down against the server's deadline rather than a local duration, so a client that lags
 * or sleeps still shows the truth when it wakes up.
 */
export function PickTimer({ deadlineMs, label }: Props) {
  const [remainingMs, setRemainingMs] = useState(() => deadlineMs - Date.now());

  useEffect(() => {
    setRemainingMs(deadlineMs - Date.now());
    const interval = setInterval(() => setRemainingMs(deadlineMs - Date.now()), 200);
    return () => clearInterval(interval);
  }, [deadlineMs]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const urgent = seconds <= 5;

  return (
    <div className={`pick-timer ${urgent ? 'is-urgent' : ''}`}>
      <span className="pick-timer__label">{label}</span>
      <span className="pick-timer__value">{seconds}s</span>
    </div>
  );
}
