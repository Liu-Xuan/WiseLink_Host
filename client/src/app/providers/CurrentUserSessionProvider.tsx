import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { authClient } from '@lark-apaas/client-toolkit/auth';

import {
  getCanonicalHostClientSessionGeneration,
  invalidateCanonicalHostClientSession,
  isCanonicalHostClientSessionAuthenticationRequired,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

interface CurrentUserProfile {
  user_id?: string;
  email?: string;
  name?: string;
  avatar?: string;
}

interface CurrentUserSessionContextValue {
  currentUser: CurrentUserProfile;
  profileSettled: boolean;
  sessionGeneration: number;
  authenticationRequired: boolean;
  clearCurrentUser(): void;
  invalidateSession(): void;
}

const CurrentUserSessionContext =
  createContext<CurrentUserSessionContextValue | null>(null);

/**
 * Owns the one current-user profile read for the whole application shell.
 * Canonical business APIs remain server-authorized on every request; this
 * provider only prevents route components from repeating browser identity
 * discovery during one stable login generation.
 */
export function CurrentUserSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [currentUser, setCurrentUser] = useState<CurrentUserProfile>({});
  const [profileSettled, setProfileSettled] = useState(false);
  const profileReadEpochRef = useRef(0);
  const sessionGeneration = useSyncExternalStore(
    subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration,
    getCanonicalHostClientSessionGeneration,
  );
  const authenticationRequired =
    isCanonicalHostClientSessionAuthenticationRequired();
  const resolvedUserIdRef = useRef<string | null>(null);

  const clearCurrentUser = useCallback((): void => {
    profileReadEpochRef.current += 1;
    resolvedUserIdRef.current = null;
    setCurrentUser({ user_id: undefined });
    setProfileSettled(true);
  }, []);

  const readCurrentUser = useCallback(async (): Promise<void> => {
    const epoch = profileReadEpochRef.current + 1;
    profileReadEpochRef.current = epoch;
    setProfileSettled(false);
    try {
      const result = await authClient.session.getUserInfo();
      if (profileReadEpochRef.current !== epoch) return;
      const userInfo = result.data?.user_info;
      const userId = String(userInfo?.user_id ?? '').trim();
      if (result.status === 401 || result.error || !userId) {
        resolvedUserIdRef.current = null;
        setCurrentUser({ user_id: undefined });
        return;
      }
      if (
        resolvedUserIdRef.current !== null &&
        resolvedUserIdRef.current !== userId
      ) {
        invalidateCanonicalHostClientSession();
      }
      resolvedUserIdRef.current = userId;
      setCurrentUser({
        user_id: userId,
        email: userInfo?.email,
        name: localizedUserName(userInfo?.name),
        avatar: userInfo?.avatar?.image?.large,
      });
    } catch {
      if (profileReadEpochRef.current === epoch) {
        resolvedUserIdRef.current = null;
        setCurrentUser({ user_id: undefined });
      }
    } finally {
      if (profileReadEpochRef.current === epoch) setProfileSettled(true);
    }
  }, []);

  useLayoutEffect(() => {
    const handlePageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        invalidateCanonicalHostClientSession();
        resolvedUserIdRef.current = null;
        setCurrentUser({});
        void readCurrentUser();
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [readCurrentUser]);

  useEffect(() => {
    void readCurrentUser();
    return () => {
      profileReadEpochRef.current += 1;
    };
  }, [readCurrentUser]);

  const value = useMemo<CurrentUserSessionContextValue>(
    () => ({
      currentUser,
      profileSettled,
      sessionGeneration,
      authenticationRequired,
      clearCurrentUser,
      invalidateSession: invalidateCanonicalHostClientSession,
    }),
    [
      authenticationRequired,
      clearCurrentUser,
      currentUser,
      profileSettled,
      sessionGeneration,
    ],
  );

  return (
    <CurrentUserSessionContext.Provider value={value}>
      {children}
    </CurrentUserSessionContext.Provider>
  );
}

function localizedUserName(
  names: ReadonlyArray<{ language_code: number; text: string }> | undefined,
): string | undefined {
  if (!names || names.length === 0) return undefined;
  return (
    names.find((name) => name.language_code === 2052)?.text ?? names[0]?.text
  );
}

export function useCurrentUserSession(): CurrentUserSessionContextValue {
  const context = useContext(CurrentUserSessionContext);
  if (!context) {
    throw new Error(
      'useCurrentUserSession 必须在 CurrentUserSessionProvider 内使用',
    );
  }
  return context;
}
