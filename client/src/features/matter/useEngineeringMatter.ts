import { useCallback, useEffect, useRef, useState } from 'react';
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
  data: EngineeringMatterWorkspaceRead | null;
  loading: boolean;
  error: string | null;
  revoked: boolean;
  refresh(): Promise<void>;
}

export interface EngineeringMatterWorkingRevisionReadState {
  data: EngineeringMatterWorkingRevisionReadModel | null;
  loading: boolean;
  error: string | null;
  revoked: boolean;
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
  const queryKey = identity
    ? engineeringMatterWorkspaceQueryKey(identity, effectiveMatterId)
    : ([...ENGINEERING_MATTER_QUERY_ROOT, 'workspace-pending'] as const);
  const queryClient = useQueryClient();
  const { revoked, markRevocation, recordSuccessfulFetch } =
    useEngineeringMatterRevokedKey(workspaceQueryRevokedKey(queryKey));
  const workspaceQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<EngineeringMatterWorkspaceRead> => {
      const workspace = await getEngineeringMatterWorkspace(
        effectiveMatterId,
        signal,
      );
      assertCurrentSession(sessionGeneration);
      recordSuccessfulFetch();
      return workspace;
    },
    enabled: enabled && Boolean(identity),
    staleTime: MATTER_STALE_TIME_MS,
    gcTime: MATTER_GC_TIME_MS,
    retry: false,
  });
  const error: unknown = workspaceQuery.error ?? identityQuery.error;
  useEffect(() => {
    if (!enabled) return;
    markRevocation(
      isRevokedMatterError(error)
        ? 'revoked'
        : workspaceQuery.data !== undefined
          ? 'idle'
          : 'unchanged',
    );
  }, [enabled, error, markRevocation, workspaceQuery.data]);
  useEffect(() => {
    if (!revoked) return;
    queryClient.setQueryData(queryKey, undefined);
    writeReviewDraft(`matter:${effectiveMatterId}`, '', sessionGeneration);
    clearMatterReadingLocations(effectiveMatterId);
  }, [effectiveMatterId, queryClient, queryKey, revoked, sessionGeneration]);
  const data: EngineeringMatterWorkspaceRead | null = revoked
    ? null
    : (workspaceQuery.data ?? null);
  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    const identityResult = identityQuery.data
      ? null
      : await identityQuery.refetch({ cancelRefetch: true });
    if (identityResult?.error) throw identityResult.error;
    if (!identityQuery.data && !identityResult?.data) return;
    const result = await workspaceQuery.refetch({ cancelRefetch: true });
    if (result.error) throw result.error;
  }, [
    enabled,
    identityQuery.data,
    identityQuery.refetch,
    workspaceQuery.refetch,
  ]);
  return {
    data,
    loading:
      enabled && !data && (identityQuery.isPending || workspaceQuery.isPending),
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
): EngineeringMatterWorkingRevisionReadState {
  const effectiveMatterId: string = matterId.trim();
  const effectiveWorkRef: string = workRef.trim();
  const queryEnabled: boolean =
    enabled &&
    Boolean(effectiveMatterId) &&
    Boolean(effectiveWorkRef) &&
    !authenticationRequired;
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(
    queryEnabled,
    sessionGeneration,
  );
  const queryKey = identity
    ? engineeringMatterWorkingRevisionQueryKey(
        identity,
        effectiveMatterId,
        effectiveWorkRef,
      )
    : ([...ENGINEERING_MATTER_QUERY_ROOT, 'working-revision-pending'] as const);
  const queryClient = useQueryClient();
  const { revoked, markRevocation, recordSuccessfulFetch } =
    useEngineeringMatterRevokedKey(workspaceQueryRevokedKey(queryKey));
  const revisionQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const revision = await getEngineeringMatterWorkingRevision(
        effectiveMatterId,
        effectiveWorkRef,
        signal,
      );
      assertCurrentSession(sessionGeneration);
      recordSuccessfulFetch();
      return revision;
    },
    enabled: queryEnabled && Boolean(identity),
    staleTime: MATTER_STALE_TIME_MS,
    gcTime: MATTER_GC_TIME_MS,
    retry: false,
  });
  const error: unknown = revisionQuery.error ?? identityQuery.error;
  useEffect(() => {
    if (!queryEnabled) return;
    markRevocation(
      isRevokedMatterError(error)
        ? 'revoked'
        : revisionQuery.data !== undefined
          ? 'idle'
          : 'unchanged',
    );
  }, [error, markRevocation, queryEnabled, revisionQuery.data]);
  useEffect(() => {
    if (!revoked) return;
    queryClient.setQueryData(queryKey, undefined);
  }, [queryClient, queryKey, revoked]);
  const data: EngineeringMatterWorkingRevisionReadModel | null = revoked
    ? null
    : (revisionQuery.data ?? null);
  const refresh = useCallback(async (): Promise<void> => {
    if (!queryEnabled) return;
    const identityResult = identityQuery.data
      ? null
      : await identityQuery.refetch({ cancelRefetch: true });
    if (identityResult?.error) throw identityResult.error;
    if (!identityQuery.data && !identityResult?.data) return;
    const result = await revisionQuery.refetch({ cancelRefetch: true });
    if (result.error) throw result.error;
  }, [
    identityQuery.data,
    identityQuery.refetch,
    queryEnabled,
    revisionQuery.refetch,
  ]);
  return {
    data,
    loading:
      queryEnabled &&
      !data &&
      (identityQuery.isPending || revisionQuery.isPending),
    error: matterErrorMessage(error),
    revoked,
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

function useEngineeringMatterQueryIdentity(
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

type EngineeringMatterRevocationStatus = 'revoked' | 'idle' | 'unchanged';

function workspaceQueryRevokedKey(queryKey: readonly unknown[]): string {
  return JSON.stringify(queryKey);
}

/**
 * A denied resource stays hidden until a fetch succeeds again. Tracking the
 * denied key in component state keeps consumers of the same query key aligned
 * without writing a second source of truth into the shared cache.
 */
function useEngineeringMatterRevokedKey(queryRevokedKey: string): {
  revoked: boolean;
  markRevocation(status: EngineeringMatterRevocationStatus): void;
  recordSuccessfulFetch(): void;
} {
  const [revokedQueryKeys, setRevokedQueryKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const previousQueryRevokedKey = useRef<string>(queryRevokedKey);
  const hasSuccessfulFetch = useRef<boolean>(false);
  if (previousQueryRevokedKey.current !== queryRevokedKey) {
    previousQueryRevokedKey.current = queryRevokedKey;
    hasSuccessfulFetch.current = false;
    if (revokedQueryKeys.has(queryRevokedKey)) {
      setRevokedQueryKeys((current) => {
        if (!current.has(queryRevokedKey)) return current;
        const next = new Set(current);
        next.delete(queryRevokedKey);
        return next;
      });
    }
  }
  const markRevocation: (status: EngineeringMatterRevocationStatus) => void =
    useCallback(
      (status: EngineeringMatterRevocationStatus): void => {
        if (status === 'unchanged') return;
        if (status === 'idle') {
          if (!hasSuccessfulFetch.current) return;
          hasSuccessfulFetch.current = false;
        }
        setRevokedQueryKeys((current) => {
          const isRevoked: boolean = current.has(queryRevokedKey);
          if (status === 'revoked') {
            if (isRevoked) return current;
            const next = new Set(current);
            next.add(queryRevokedKey);
            return next;
          }
          if (!isRevoked) return current;
          const next = new Set(current);
          next.delete(queryRevokedKey);
          return next;
        });
      },
      [queryRevokedKey],
    );
  const recordSuccessfulFetch = useCallback((): void => {
    hasSuccessfulFetch.current = true;
  }, []);
  return {
    revoked: revokedQueryKeys.has(queryRevokedKey),
    markRevocation,
    recordSuccessfulFetch,
  };
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
