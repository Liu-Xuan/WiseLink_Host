import { useSyncExternalStore } from 'react';
let generation = 1;
const listeners = new Set<() => void>();
export function changeTestSession() { generation++; listeners.forEach(listener => listener()); }
export function useCurrentUserSession() {
  const sessionGeneration = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => generation);
  return { authenticationRequired: false, profileSettled: true, sessionGeneration,
    currentUser: { user_id: 'LOCAL_TEST_ONLY' } };
}
