import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readEngineeringKnowledgeCatalogue, readEngineeringKnowledgeWork } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { ENGINEERING_MATTER_QUERY_ROOT, readMatterResource, useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import type { EngineeringKnowledgeIdentity, EngineeringKnowledgeScope } from '@shared/engineering-issue-search.interface';

/** Same session boundary, authorization rejection state and lifetime as saved Matter reading. */
export function useKnowledgeResources(query: string, scope: EngineeringKnowledgeScope,
  after: string | undefined, selected: EngineeringKnowledgeIdentity | null, enabled: boolean) {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const active = enabled && !authenticationRequired;
  const { identityQuery, identity } = useEngineeringMatterQueryIdentity(active, sessionGeneration);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);
  const root = [...ENGINEERING_MATTER_QUERY_ROOT, 'knowledge', identity?.appId,
    identity?.tenantId, identity?.actorId, sessionGeneration];
  const identityRefreshing = identityQuery.isFetching && identityQuery.isStale;
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
  const catalogueError = identityQuery.error ?? catalogue.error ?? (catalogue.data?.kind === 'rejected' ? catalogue.data.error : null);
  const workError = identityQuery.error ?? work.error ?? (work.data?.kind === 'rejected' ? work.data.error : null);
  const page = active && !identityRefreshing && !(catalogue.isFetching && catalogue.isStale) && !catalogueError && catalogue.data?.kind === 'readable' ? catalogue.data.data : null;
  const read = active && selected && !identityRefreshing && !(work.isFetching && work.isStale) && !workError && work.data?.kind === 'readable' ? work.data.data : null;
  return {
    page, read, catalogueError, workError,
    loading: active && !page && !catalogueError && (identityQuery.isPending || identityRefreshing || catalogue.isPending || catalogue.isFetching),
    reading: active && Boolean(selected) && !read && !workError && (identityQuery.isPending || identityRefreshing || work.isPending || work.isFetching),
    async refresh() {
      if (!active) return;
      if (!identity || identityQuery.error) { await identityQuery.refetch(); return; }
      await Promise.allSettled([catalogue.refetch(), ...(selected ? [work.refetch()] : [])]);
    },
  };
}
