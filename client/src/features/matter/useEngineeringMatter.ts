import { useCallback, useEffect } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalHostIdentityContext,
} from '@client/src/api/canonical-host';
import {
  getEngineeringMatterWorkspace,
  getEngineeringMatterWorkingRevision,
  type EngineeringMatterWorkspaceRead,
} from '@client/src/api/engineering-matter';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { writeReviewDraft } from '@client/src/features/review/review-draft-store';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { clearMatterReadingLocations } from './reading-location';

const MATTER_STALE_TIME_MS = 30_000;
const MATTER_GC_TIME_MS = 5 * 60_000;

export const ENGINEERING_MATTER_QUERY_ROOT = [
  'canonical-host',
  'engineering-matter',
] as const;

interface EngineeringMatterQueryIdentity {
  appId: string;
  tenantId: string;
  actorId: string;
  sessionGeneration: number;
}

function sameMatterIdentity(a: EngineeringMatterQueryIdentity, b: EngineeringMatterQueryIdentity): boolean {
  return a.appId === b.appId && a.tenantId === b.tenantId &&
    a.actorId === b.actorId && a.sessionGeneration === b.sessionGeneration;
}

export interface EngineeringMatterReadState {
  authorizedSessionGeneration: number | null;
  data: EngineeringMatterWorkspaceRead | null;
  loading: boolean;
  error: string | null;
  revoked: boolean;
  refresh(): Promise<void>;
}

export interface EngineeringMatterWorkingRevisionReadState {
  authorizedSessionGeneration: number | null;
  data: EngineeringMatterWorkingRevisionReadModel | null;
  loading: boolean;
  error: string | null;
  revoked: boolean;
  withheld: boolean;
  refresh(): Promise<void>;
}

export default function useEngineeringMatter(
  matterId: string,
  sessionGeneration: number,
  authenticationRequired: boolean,
): EngineeringMatterReadState {
  const effectiveMatterId: string = matterId.trim();
  const enabled: boolean =
    Boolean(effectiveMatterId) && !authenticationRequired;
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(
    enabled,
    sessionGeneration,
  );
  const identityUnavailable = identityQuery.isFetching || Boolean(identityQuery.error);
  const queryClient = useQueryClient();
  const queryKey = identity
    ? engineeringMatterWorkspaceQueryKey(identity, effectiveMatterId)
    : ([...ENGINEERING_MATTER_QUERY_ROOT, 'workspace-pending'] as const);
  const workspaceQuery = useQuery({
    queryKey,
    queryFn: async ({
      signal,
    }): Promise<MatterResourceResult<EngineeringMatterWorkspaceRead>> =>
      readMatterResource(
        () => getEngineeringMatterWorkspace(effectiveMatterId, signal),
        sessionGeneration,
      ),
    enabled: enabled && Boolean(identity) && !identityUnavailable,
    staleTime: MATTER_STALE_TIME_MS,
    gcTime: MATTER_GC_TIME_MS,
    retry: false,
  });
  const result: MatterResourceResult<EngineeringMatterWorkspaceRead> | null =
    workspaceQuery.data ?? null;
  const identityError: unknown = identityQuery.error;
  const error: unknown =
    result?.kind === 'rejected'
      ? result.error
      : (workspaceQuery.error ?? identityError);
  const revoked: boolean =
    result?.kind === 'rejected' || isRevokedMatterError(identityError);
  useEffect(() => {
    if (!revoked) return;
    writeReviewDraft(`matter:${effectiveMatterId}`, '', sessionGeneration);
    clearMatterReadingLocations(effectiveMatterId);
  }, [effectiveMatterId, revoked, sessionGeneration]);
  const data: EngineeringMatterWorkspaceRead | null =
    !enabled || identityUnavailable || workspaceQuery.isFetching || workspaceQuery.isError || revoked
    ? null
    : result?.kind === 'readable'
      ? result.data
      : null;
  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    // A consecutive refresh still starts a new exact read; fresh identity runs
    // alongside it. A changed tenant never consumes this prior-scope result.
    const priorIdentity = identityQuery.data;
    const priorRead = priorIdentity && !identityQuery.error
      ? workspaceQuery.refetch({ cancelRefetch: true }) : null;
    void priorRead?.catch(() => undefined);
    const checked = await identityQuery.refetch({ cancelRefetch: false });
    if (checked.error) throw checked.error;
    const authorizedIdentity = checked.data;
    if (!authorizedIdentity) return;
    if (priorRead && priorIdentity && sameMatterIdentity(priorIdentity, authorizedIdentity)) {
      const refreshed = await priorRead;
      if (refreshed.error) throw refreshed.error;
      if (refreshed.data?.kind === 'rejected') throw refreshed.data.error;
      if (refreshed.data?.kind !== 'readable') throw new Error('事项授权读回尚未完成。');
      return;
    }
    const refreshed = await queryClient.fetchQuery({
      queryKey: engineeringMatterWorkspaceQueryKey(authorizedIdentity, effectiveMatterId),
      queryFn: ({ signal }) => readMatterResource(
        () => getEngineeringMatterWorkspace(effectiveMatterId, signal), sessionGeneration),
      staleTime: 0,
    });
    if (refreshed.kind === 'rejected') throw refreshed.error;
  }, [enabled, effectiveMatterId, identityQuery.data, identityQuery.error, identityQuery.refetch,
    workspaceQuery.refetch, queryClient, sessionGeneration]);
  return {
    data,
    authorizedSessionGeneration: data && result?.kind === 'readable'
      ? result.sessionGeneration : null,
    loading:
      enabled && (identityQuery.isPending || identityQuery.isFetching || workspaceQuery.isFetching),
    error: authenticationRequired
      ? '请先登录，再读取当前事项。'
      : matterErrorMessage(error),
    revoked,
    refresh,
  };
}

export function useEngineeringMatterWorkingRevision(
  matterId: string,
  workRef: string,
  sessionGeneration: number,
  authenticationRequired: boolean,
  enabled = true,
  authorizationDenied = false,
): EngineeringMatterWorkingRevisionReadState {
  const effectiveMatterId: string = matterId.trim();
  const effectiveWorkRef: string = workRef.trim();
  const queryEnabled: boolean =
    enabled &&
    !authorizationDenied &&
    Boolean(effectiveMatterId) &&
    Boolean(effectiveWorkRef) &&
    !authenticationRequired;
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(
    queryEnabled,
    sessionGeneration,
  );
  const identityUnavailable = identityQuery.isFetching || Boolean(identityQuery.error);
  const queryClient = useQueryClient();
  const queryKey = identity
    ? engineeringMatterWorkingRevisionQueryKey(
        identity,
        effectiveMatterId,
        effectiveWorkRef,
      )
    : ([...ENGINEERING_MATTER_QUERY_ROOT, 'working-revision-pending'] as const);
  const revisionQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      readMatterResource(
        () =>
          getEngineeringMatterWorkingRevision(
            effectiveMatterId,
            effectiveWorkRef,
            signal,
          ),
        sessionGeneration,
      ),
    enabled: queryEnabled && Boolean(identity) && !identityUnavailable,
    staleTime: MATTER_STALE_TIME_MS,
    gcTime: MATTER_GC_TIME_MS,
    retry: false,
  });
  const result: MatterResourceResult<EngineeringMatterWorkingRevisionReadModel> | null =
    revisionQuery.data ?? null;
  const identityError: unknown = identityQuery.error;
  const error: unknown =
    result?.kind === 'rejected'
      ? result.error
      : (revisionQuery.error ?? identityError);
  const revoked: boolean =
    result?.kind === 'rejected' || isRevokedMatterError(identityError);
  const data: EngineeringMatterWorkingRevisionReadModel | null =
    !queryEnabled || identityUnavailable || revisionQuery.isFetching || revisionQuery.isError || revoked
    ? null
    : authorizationDenied
      ? null
      : result?.kind === 'readable'
        ? result.data
        : null;
  const refresh = useCallback(async (): Promise<void> => {
    if (!queryEnabled) return;
    const priorIdentity = identityQuery.data;
    const priorRead = priorIdentity && !identityQuery.error
      ? revisionQuery.refetch({ cancelRefetch: true }) : null;
    void priorRead?.catch(() => undefined);
    const checked = await identityQuery.refetch({ cancelRefetch: false });
    if (checked.error) throw checked.error;
    const authorizedIdentity = checked.data;
    if (!authorizedIdentity) return;
    if (priorRead && priorIdentity && sameMatterIdentity(priorIdentity, authorizedIdentity)) {
      const refreshed = await priorRead;
      if (refreshed.error) throw refreshed.error;
      if (refreshed.data?.kind === 'rejected') throw refreshed.data.error;
      if (refreshed.data?.kind !== 'readable') throw new Error('事项授权读回尚未完成。');
      return;
    }
    const refreshed = await queryClient.fetchQuery({
      queryKey: engineeringMatterWorkingRevisionQueryKey(authorizedIdentity, effectiveMatterId, effectiveWorkRef),
      queryFn: ({ signal }) => readMatterResource(
        () => getEngineeringMatterWorkingRevision(effectiveMatterId, effectiveWorkRef, signal), sessionGeneration),
      staleTime: 0,
    });
    if (refreshed.kind === 'rejected') throw refreshed.error;
  }, [queryEnabled, effectiveMatterId, effectiveWorkRef, identityQuery.data, identityQuery.error,
    identityQuery.refetch, revisionQuery.refetch, queryClient, sessionGeneration]);
  return {
    data,
    authorizedSessionGeneration: data && result?.kind === 'readable'
      ? result.sessionGeneration : null,
    loading:
      queryEnabled &&
      (identityQuery.isPending || identityQuery.isFetching || revisionQuery.isFetching),
    error: matterErrorMessage(error),
    revoked,
    withheld: revoked || authorizationDenied,
    refresh,
  };
}

export async function clearEngineeringMatterQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ENGINEERING_MATTER_QUERY_ROOT });
  queryClient.removeQueries({
    queryKey: ENGINEERING_MATTER_QUERY_ROOT,
    type: 'inactive',
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  queryClient.removeQueries({
    queryKey: ENGINEERING_MATTER_QUERY_ROOT,
    type: 'inactive',
  });
}

export function useEngineeringMatterQueryIdentity(
  enabled: boolean,
  sessionGeneration: number,
) {
  const { currentUser } = useCurrentUserSession();
  const queryClient = useQueryClient();
  const appId: string = currentAppId();
  const actorId: string = currentUser.user_id?.trim() ?? '';
  const identityKey = [
    ...ENGINEERING_MATTER_QUERY_ROOT,
    'identity', appId, actorId, sessionGeneration,
  ] as const;
  const identityQuery = useQuery({
    queryKey: identityKey,
    queryFn: async (): Promise<EngineeringMatterQueryIdentity> => {
      const identity = await getCanonicalHostIdentityContext({ fresh: true });
      assertCurrentSession(sessionGeneration);
      const next: EngineeringMatterQueryIdentity = {
        appId,
        tenantId: identity.tenantId,
        actorId: identity.userId,
        sessionGeneration,
      };
      const previous = queryClient.getQueryData<EngineeringMatterQueryIdentity>(identityKey);
      if (previous && !sameMatterIdentity(previous, next)) {
        const oldResource = (key: readonly unknown[]) =>
          key[0] === ENGINEERING_MATTER_QUERY_ROOT[0] &&
          key[1] === ENGINEERING_MATTER_QUERY_ROOT[1] && key[2] !== 'identity' &&
          key[3] === previous.appId && key[4] === previous.tenantId &&
          key[5] === previous.actorId && key[6] === previous.sessionGeneration;
        await queryClient.cancelQueries({ predicate: query => oldResource(query.queryKey) });
        queryClient.removeQueries({ predicate: query => oldResource(query.queryKey) });
        assertCurrentSession(sessionGeneration);
      }
      return next;
    },
    enabled,
    staleTime: MATTER_STALE_TIME_MS,
    gcTime: MATTER_GC_TIME_MS,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  return {
    identityQuery,
    identity: identityQuery.data ?? null,
  };
}

function engineeringMatterWorkspaceQueryKey(
  identity: EngineeringMatterQueryIdentity,
  matterId: string,
) {
  return [
    ...ENGINEERING_MATTER_QUERY_ROOT,
    'workspace',
    identity.appId,
    identity.tenantId,
    identity.actorId,
    identity.sessionGeneration,
    matterId,
  ] as const;
}

function engineeringMatterWorkingRevisionQueryKey(
  identity: EngineeringMatterQueryIdentity,
  matterId: string,
  workRef: string,
) {
  return [
    ...ENGINEERING_MATTER_QUERY_ROOT,
    'working-revision',
    identity.appId,
    identity.tenantId,
    identity.actorId,
    identity.sessionGeneration,
    matterId,
    workRef,
  ] as const;
}

function assertCurrentSession(sessionGeneration: number): void {
  if (getCanonicalHostClientSessionGeneration() !== sessionGeneration) {
    throw Object.assign(new Error('登录状态已变化，事项读回已失效。'), {
      name: 'AbortError',
    });
  }
}

function isRevokedMatterError(error: unknown): boolean {
  const statusCode: number | undefined = matterErrorStatus(error);
  return statusCode === 401 || statusCode === 403 || statusCode === 404;
}

type MatterResourceResult<T> =
  | { kind: 'readable'; data: T; sessionGeneration: number }
  | { kind: 'rejected'; error: unknown };

/**
 * Normalise the read outcome inside the shared query value. A denial becomes a
 * readable "rejected" resource, so every consumer and every remount sees the
 * same conclusion until a later successful fetch replaces the cached value.
 */
export async function readMatterResource<T>(
  read: () => Promise<T>,
  sessionGeneration: number,
): Promise<MatterResourceResult<T>> {
  try {
    const data: T = await read();
    assertCurrentSession(sessionGeneration);
    return { kind: 'readable', data, sessionGeneration };
  } catch (error: unknown) {
    if (isRevokedMatterError(error)) return { kind: 'rejected', error };
    throw error;
  }
}

function matterErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : '读取事项失败，请稍后重试。';
}

function matterErrorStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode;
  }
  return undefined;
}

function currentAppId(): string {
  if (typeof window === 'undefined') return 'unknown-app';
  const value: unknown = Reflect.get(window, 'appId');
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : 'unknown-app';
}
