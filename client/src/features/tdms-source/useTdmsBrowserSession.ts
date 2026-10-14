import { useSyncExternalStore } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  isCanonicalHostClientSessionAuthenticationRequired,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

/** Reuses the session owned by the app shell; no additional identity or OAuth request. */
export function useTdmsBrowserSession() {
  const sessionGeneration: number = useSyncExternalStore(
    subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration,
    getCanonicalHostClientSessionGeneration,
  );
  return { sessionGeneration, authenticationRequired: isCanonicalHostClientSessionAuthenticationRequired() };
}
