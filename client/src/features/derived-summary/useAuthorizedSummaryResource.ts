import { useCallback, useEffect, useRef } from 'react';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import { isTemporarySummaryReadError } from './summary-read-error';
import { useSummaryResource } from './useSummaryResource';

/** Reuse the existing shared identity query. The body stays inside its exact
 * app/tenant/actor/session key; identity rejection never falls back to text. */
export function useAuthorizedSummaryResource<T>(key: string, session: number,
  load: (signal: AbortSignal) => Promise<T>, options: { enabled?: boolean; pollIntervalMs?: number } = {}) {
  const active = options.enabled !== false;
  const { authenticationRequired } = useCurrentUserSession();
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(active && !authenticationRequired, session);
  const authorityError: unknown = identityQuery.error;
  const authorized = active && !authenticationRequired && Boolean(identity) &&
    (!authorityError || isTemporarySummaryReadError(authorityError));
  const authorityKey = JSON.stringify([identity?.appId, identity?.tenantId, identity?.actorId, session]);
  const authority = useRef({ authorityKey, authorized, error: authorityError, checking: identityQuery.isFetching });
  authority.current = { authorityKey, authorized, error: authorityError, checking: identityQuery.isFetching };
  const authorizedLoad = useCallback(async (signal: AbortSignal) => {
    const current = authority.current;
    if (signal.aborted || !current.authorized || current.authorityKey !== authorityKey)
      throw new Error('读取身份已变化。');
    if (current.error) throw current.error;
    // Join an identity check before starting a body read, without cancelling a
    // body already in progress whenever focus/polling rechecks the same actor.
    if (current.checking) {
      const checked = await identityQuery.refetch({ cancelRefetch: false });
      if (checked.error) throw checked.error;
      const checkedKey = JSON.stringify([checked.data?.appId, checked.data?.tenantId, checked.data?.actorId, session]);
      if (signal.aborted || checkedKey !== authorityKey) throw new Error('读取身份已变化。');
    }
    if (signal.aborted || authority.current.authorityKey !== authorityKey || !authority.current.authorized)
      throw new Error('读取身份已变化。');
    return load(signal);
  }, [authorityKey, session, identityQuery.refetch, load]);
  const resource = useSummaryResource(JSON.stringify([authorityKey, key]), session, authorizedLoad, {
    enabled: authorized, visible: authorized, preserveWhileLoading: true,
    preserveAfterTemporaryError: true, refreshOnFocus: false,
  });
  const refresh = useCallback(async () => {
    if (!active || authenticationRequired) return;
    const checked = await identityQuery.refetch({ cancelRefetch: false });
    if (!checked.error) resource.refresh();
  }, [active, authenticationRequired, identityQuery.refetch, resource.refresh]);
  useEffect(() => {
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  useEffect(() => {
    if (!options.pollIntervalMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, options.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [options.pollIntervalMs, refresh]);
  return { ...resource, authorized, refresh,
    loading: active && !authenticationRequired && !authorityError &&
      ((!identity || identityQuery.isFetching) && !resource.data || resource.loading),
    error: authorityError ? authorityError instanceof Error ? authorityError.message : '读取身份未能核对。' : resource.error,
    temporaryError: authorityError ? isTemporarySummaryReadError(authorityError) : resource.temporaryError,
    retainedAfterError: Boolean(resource.data) && (Boolean(authorityError) || resource.retainedAfterError),
  };
}
