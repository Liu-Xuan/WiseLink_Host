import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readEngineeringKnowledgeCatalogue, readEngineeringKnowledgeWork, readJobAidAssessmentWork } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { ENGINEERING_MATTER_QUERY_ROOT, readMatterResource, useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import type { EngineeringKnowledgeIdentity, EngineeringKnowledgeScope } from '@shared/engineering-issue-search.interface';

/** Same session boundary, authorization rejection state and lifetime as saved Matter reading. */
export function useKnowledgeResources(query: string, scope: EngineeringKnowledgeScope,
  after: string | undefined, selected: EngineeringKnowledgeIdentity | null,
  workItemId: string | null, enabled: boolean) {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const queryClient = useQueryClient();
  const active = enabled && !authenticationRequired;
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(active, sessionGeneration);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);
  const root = [...ENGINEERING_MATTER_QUERY_ROOT, 'knowledge', identity?.appId,
    identity?.tenantId, identity?.actorId, sessionGeneration];
  const identityRefreshing = identityQuery.isFetching;
  const canRead = active && Boolean(identity) && !identityQuery.error && !identityRefreshing;
  const catalogue = useQuery({
    queryKey: [...root, 'catalogue', query, scope, after ?? null],
    queryFn: ({ signal }) => readMatterResource(
      () => readEngineeringKnowledgeCatalogue(query, scope, after, signal), sessionGeneration),
    enabled: canRead && debouncedQuery === query,
    staleTime: 30_000, gcTime: 5 * 60_000, retry: false,
  });
  const work = useQuery({
    queryKey: [...root, 'work', selected?.subjectKind, selected?.subjectId, selected?.workRef],
    queryFn: ({ signal }) => readMatterResource(
      () => readEngineeringKnowledgeWork(selected!, signal), sessionGeneration),
    enabled: canRead && Boolean(selected),
    staleTime: 30_000, gcTime: 5 * 60_000, retry: false,
  });
  const workItem = useQuery({
    queryKey: [...root, 'work-item-current', workItemId],
    queryFn: ({ signal }) => readMatterResource(
      () => readJobAidAssessmentWork(workItemId!, signal), sessionGeneration),
    enabled: canRead && Boolean(workItemId),
    staleTime: 30_000, gcTime: 5 * 60_000, retry: false,
  });
  const catalogueError = identityQuery.error ?? catalogue.error ?? (catalogue.data?.kind === 'rejected' ? catalogue.data.error : null);
  const workError = identityQuery.error ?? work.error ?? (work.data?.kind === 'rejected' ? work.data.error : null);
  const workItemError = identityQuery.error ?? workItem.error ??
    (workItem.data?.kind === 'rejected' ? workItem.data.error : null);
  const page = canRead && !catalogue.isFetching && !catalogueError && catalogue.data?.kind === 'readable' ? catalogue.data.data : null;
  const read = canRead && selected && !work.isFetching && !workError && work.data?.kind === 'readable' ? work.data.data : null;
  const currentWork = canRead && workItemId && !workItem.isFetching && !workItemError &&
    workItem.data?.kind === 'readable' ? workItem.data.data.current : null;
  return {
    page, read, catalogueError, workError, currentWork, workItemError,
    workItemResolved: canRead && Boolean(workItemId) && !workItem.isFetching &&
      !workItemError && workItem.data?.kind === 'readable',
    workItemLoading: active && Boolean(workItemId) && !currentWork && !workItemError &&
      (identityQuery.isPending || identityRefreshing || workItem.isPending || workItem.isFetching),
    loading: active && !page && !catalogueError && (identityQuery.isPending || identityRefreshing || catalogue.isPending || catalogue.isFetching),
    reading: active && Boolean(selected) && !read && !workError && (identityQuery.isPending || identityRefreshing || work.isPending || work.isFetching),
    async refresh() {
      if (!active) return;
      const checked = !identity || identityQuery.error ? await identityQuery.refetch() : null;
      if (checked?.error) return;
      const authorizedIdentity = checked?.data ?? identity;
      if (!authorizedIdentity) return;
      const authorizedRoot = [...ENGINEERING_MATTER_QUERY_ROOT, 'knowledge', authorizedIdentity.appId,
        authorizedIdentity.tenantId, authorizedIdentity.actorId, sessionGeneration];
      await Promise.allSettled([
        queryClient.fetchQuery({ queryKey: [...authorizedRoot, 'catalogue', query, scope, after ?? null],
          queryFn: ({ signal }) => readMatterResource(
            () => readEngineeringKnowledgeCatalogue(query, scope, after, signal), sessionGeneration), staleTime: 0 }),
        ...(selected ? [queryClient.fetchQuery({
          queryKey: [...authorizedRoot, 'work', selected.subjectKind, selected.subjectId, selected.workRef],
          queryFn: ({ signal }) => readMatterResource(
            () => readEngineeringKnowledgeWork(selected, signal), sessionGeneration), staleTime: 0 })] : []),
        ...(workItemId ? [queryClient.fetchQuery({ queryKey: [...authorizedRoot, 'work-item-current', workItemId],
          queryFn: ({ signal }) => readMatterResource(
            () => readJobAidAssessmentWork(workItemId, signal), sessionGeneration), staleTime: 0 })] : []),
      ]);
    },
  };
}
