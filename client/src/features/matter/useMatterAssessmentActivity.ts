import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMatterAssessmentActivity,
  type EngineeringMatterClientError,
} from '@client/src/api/engineering-matter';
import type {
  MatterAssessmentActivityPage,
  MatterAssessmentActivityQuery,
} from '@shared/matter-assessment-activity.interface';
import {
  ENGINEERING_MATTER_QUERY_ROOT,
  useEngineeringMatterQueryIdentity,
} from './useEngineeringMatter';

type ActivityResource =
  | { kind: 'readable'; page: MatterAssessmentActivityPage }
  | { kind: 'rejected'; error: EngineeringMatterClientError };

/** Mounted only while visible. Query owns one request and aborts when its last observer leaves. */
export function useMatterAssessmentActivity(
  matterId: string,
  sessionGeneration: number,
  input: MatterAssessmentActivityQuery,
) {
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(
    true,
    sessionGeneration,
  );
  const queryClient = useQueryClient();
  const queryKey = [
    ...ENGINEERING_MATTER_QUERY_ROOT,
    'activity',
    identity?.appId,
    identity?.tenantId,
    identity?.actorId,
    sessionGeneration,
    matterId,
    input.workRef ?? null,
    input.attemptRef ?? null,
    input.cursor ?? null,
    input.limit ?? 50,
  ];
  const sameSelection = (key: readonly unknown[]) =>
    queryKey.slice(0, 10).every((part, index) => key[index] === part);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<ActivityResource> => {
      try {
        return {
          kind: 'readable',
          page: await getMatterAssessmentActivity(matterId, input, signal),
        };
      } catch (cause: unknown) {
        const error = cause as EngineeringMatterClientError;
        if (
          !signal.aborted &&
          [401, 403, 404].includes(error.statusCode ?? 0)
        ) {
          // A refusal of this authorized attempt/selector applies to every cached page of it.
          // Cancel sibling pages first so an older response cannot resurrect revoked content.
          await queryClient.cancelQueries({
            predicate: (candidate) =>
              sameSelection(candidate.queryKey) &&
              (candidate.queryKey[10] !== queryKey[10] ||
                candidate.queryKey[11] !== queryKey[11]),
          });
          if (signal.aborted) throw cause;
          const rejected: ActivityResource = { kind: 'rejected', error };
          queryClient.setQueriesData<ActivityResource>(
            { predicate: (candidate) => sameSelection(candidate.queryKey) },
            rejected,
          );
          return rejected;
        }
        throw cause;
      }
    },
    enabled: !!identity,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    // Visibility unmounts this observer. A remount must not undo a stopped
    // read or silently retry a known refusal after the stale window expires.
    retryOnMount: false,
    refetchOnMount: (current) => {
      const value = current.state.data;
      return (
        current.state.status !== 'error' &&
        value?.kind !== 'rejected' &&
        !(value?.kind === 'readable' && value.page.error)
      );
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (current) => {
      const value = current.state.data;
      return current.state.status !== 'error' &&
        value?.kind === 'readable' &&
        !value.page.error &&
        value.page.selection === 'CURRENT' &&
        value.page.attempt?.active
        ? 4000
        : false;
    },
  });
  const value = query.data;
  const error =
    value?.kind === 'rejected'
      ? value.error
      : (query.error ?? identityQuery.error);
  return {
    page: value?.kind === 'readable' ? value.page : null,
    error:
      error instanceof Error
        ? error.message
        : error
          ? '活动记录读取失败。'
          : null,
    loading: query.isFetching || identityQuery.isFetching,
    refresh: () =>
      identity
        ? query.refetch({ cancelRefetch: false })
        : identityQuery.refetch({ cancelRefetch: false }),
  };
}
