import type { SessionUser } from '@quickkicks/shared';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearSession, getSession, setName } from './lib/api.js';

interface SessionContextValue {
  user: SessionUser | null;
  ready: boolean;
  signIn: (displayName: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((result) => {
        if (!cancelled) setUser(result.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      ready,
      signIn: async (displayName) => {
        const result = await setName(displayName);
        setUser(result.user);
        return result.user;
      },
      signOut: async () => {
        await clearSession();
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
