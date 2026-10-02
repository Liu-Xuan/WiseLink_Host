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
    if (identityQuery.data && !identityUnavailable) {
      const refreshed = await workspaceQuery.refetch({ cancelRefetch: true });
      if (refreshed.error) throw refreshed.error;
      return;
    }
    const checked = !identityQuery.data || identityQuery.error
      ? await identityQuery.refetch({ cancelRefetch: true }) : null;
    if (checked?.error) throw checked.error;
    const authorizedIdentity = checked?.data ?? identityQuery.data;
    if (!authorizedIdentity) return;
    await queryClient.fetchQuery({
      queryKey: engineeringMatterWorkspaceQueryKey(authorizedIdentity, effectiveMatterId),
      queryFn: ({ signal }) => readMatterResource(
        () => getEngineeringMatterWorkspace(effectiveMatterId, signal), sessionGeneration),
      staleTime: 0,
    });
  }, [enabled, effectiveMatterId, identityQuery.data, identityQuery.error,
    identityQuery.refetch, identityUnavailable, workspaceQuery.refetch, queryClient, sessionGeneration]);
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
    if (identityQuery.data && !identityUnavailable) {
      const refreshed = await revisionQuery.refetch({ cancelRefetch: true });
      if (refreshed.error) throw refreshed.error;
      return;
    }
    const checked = !identityQuery.data || identityQuery.error
      ? await identityQuery.refetch({ cancelRefetch: true }) : null;
    if (checked?.error) throw checked.error;
    const authorizedIdentity = checked?.data ?? identityQuery.data;
    if (!authorizedIdentity) return;
    await queryClient.fetchQuery({
      queryKey: engineeringMatterWorkingRevisionQueryKey(authorizedIdentity, effectiveMatterId, effectiveWorkRef),
      queryFn: ({ signal }) => readMatterResource(
        () => getEngineeringMatterWorkingRevision(effectiveMatterId, effectiveWorkRef, signal), sessionGeneration),
      staleTime: 0,
    });
  }, [queryEnabled, effectiveMatterId, effectiveWorkRef, identityQuery.data,
    identityQuery.error, identityQuery.refetch, identityUnavailable, revisionQuery.refetch, queryClient, sessionGeneration]);
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
  const appId: string = currentAppId();
  const actorId: string = currentUser.user_id?.trim() ?? '';
  const identityQuery = useQuery({
    queryKey: [
      ...ENGINEERING_MATTER_QUERY_ROOT,
      'identity',
      appId,
      actorId,
      sessionGeneration,
    ],
    queryFn: async (): Promise<EngineeringMatterQueryIdentity> => {
      const identity = await getCanonicalHostIdentityContext();
      assertCurrentSession(sessionGeneration);
      return {
        appId,
        tenantId: identity.tenantId,
        actorId: identity.userId,
        sessionGeneration,
      };
    },
    enabled,
    staleTime: MATTER_STALE_TIME_MS,
    gcTime: MATTER_GC_TIME_MS,
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
