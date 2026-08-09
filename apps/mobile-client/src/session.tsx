import { ApiClient, RealtimeChannel, type ClientProfile } from '@mobilite/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { API_URL } from './config';
import { secureStorage } from './storage';

/**
 * Session applicative.
 *
 * Un seul `ApiClient` pour toute l'application : il détient les jetons et
 * mutualise leur rotation. Le canal temps réel est créé à la connexion et
 * fermé à la déconnexion.
 */

interface SessionValue {
  api: ApiClient;
  realtime: RealtimeChannel;
  profile: ClientProfile | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  /** À appeler après une vérification d'OTP réussie : recharge le profil. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const expired = useRef(false);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_URL,
        storage: secureStorage,
        onSessionExpired: () => {
          expired.current = true;
          setProfile(null);
          setStatus('anonymous');
        },
      }),
    [],
  );

  const realtime = useMemo(() => new RealtimeChannel(API_URL, () => api.getAccessToken()), [api]);

  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await api.clientProfile());
      setStatus('authenticated');
    } catch {
      // Un échec réseau ne doit pas déconnecter : seul un 401 définitif le fait,
      // via onSessionExpired.
      if (expired.current) setStatus('anonymous');
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const hasSession = await api.restore();
      if (cancelled) return;

      if (!hasSession) {
        setStatus('anonymous');
        return;
      }
      await refreshProfile();
    })();

    return () => {
      cancelled = true;
    };
  }, [api, refreshProfile]);

  const signIn = useCallback(async () => {
    expired.current = false;
    await refreshProfile();
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    realtime.disconnect();
    try {
      await api.logout();
    } finally {
      setProfile(null);
      setStatus('anonymous');
    }
  }, [api, realtime]);

  const value = useMemo(
    () => ({ api, realtime, profile, status, signIn, signOut, refreshProfile }),
    [api, realtime, profile, status, signIn, signOut, refreshProfile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession doit être utilisé dans SessionProvider.');
  return value;
}
