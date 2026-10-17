import { useInfiniteQuery, useQuery, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import type { WikiGuideNavigationQuery, WikiGuideIssueQuery, WikiGuideNavigationPage, WikiGuideIssuePage } from '@shared/wiki-guide.interface';
import { readWikiGuideNavigation, searchWikiGuideIssues } from '@client/src/api/wiki-guide';
import { wikiGuideIssueAnchor } from '@client/src/lib/wiki-guide-route';

export const WIKI_GUIDE_QUERY_ROOT = ['wiki-guide'] as const;
export function wikiGuideAccessDenied(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error &&
    [401, 403].includes(Number(error.statusCode)));
}
const failure = (error: unknown): string | null => error
  ? error instanceof Error ? error.message : '知识读取未完成，请重试。' : null;

async function authorized<T>(read: () => Promise<T>, signal: AbortSignal, onDenied: () => void): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (!signal.aborted && wikiGuideAccessDenied(error)) onDenied();
    throw error;
  }
}

export function useWikiGuideNavigation(query: WikiGuideNavigationQuery, session: number, revision: number,
  enabled: boolean, onDenied: () => void, initialAfter: string | null = null) {
  const signature = JSON.stringify(query);
  const result = useInfiniteQuery<WikiGuideNavigationPage, Error,
    InfiniteData<WikiGuideNavigationPage, string | undefined>, QueryKey, string | undefined>({
    queryKey: [...WIKI_GUIDE_QUERY_ROOT, session, revision, 'navigation', signature, initialAfter],
    initialPageParam: initialAfter ?? undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => authorized(() => readWikiGuideNavigation({
      ...JSON.parse(signature) as WikiGuideNavigationQuery, limit: 20, ...(pageParam ? { after: pageParam } : {}),
    }, signal), signal, onDenied),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled, staleTime: 30_000, gcTime: 5 * 60_000, retry: false,
  });
  const visible = enabled && !wikiGuideAccessDenied(result.error);
  const pages = new Map<string, string | null>();
  if (visible) result.data?.pages.forEach((page, index) => page.items.forEach(node => {
    if (!pages.has(node.summaryId)) pages.set(node.summaryId, result.data!.pageParams[index] ?? null);
  }));
  return {
    items: visible ? [...new Map(result.data?.pages.flatMap(page => page.items).map(node => [node.summaryId, node]) ?? []).values()] : [],
    loading: enabled && result.isPending, loadingMore: result.isFetchingNextPage,
    error: enabled ? failure(result.error) : null, hasMore: visible && result.hasNextPage,
    pageFor: (id: string): string | null | undefined => pages.get(id),
    loadMore: () => { if (enabled && result.hasNextPage && !result.isFetching) void result.fetchNextPage(); },
  };
}

export function useWikiGuideNode(id: string | null, session: number, revision: number,
  enabled: boolean, onDenied: () => void) {
  const result = useQuery({
    queryKey: [...WIKI_GUIDE_QUERY_ROOT, session, revision, 'node', id],
    queryFn: ({ signal }) => authorized(() => readWikiGuideNavigation({ summaryId: id! }, signal), signal, onDenied),
    enabled: enabled && Boolean(id), staleTime: 30_000, gcTime: 5 * 60_000, retry: false,
  });
  const visible = enabled && Boolean(id) && !wikiGuideAccessDenied(result.error);
  return {
    node: visible ? result.data?.items.find(node => node.summaryId === id) ?? null : null,
    loading: visible && result.isPending, error: visible ? failure(result.error) : null,
    resolved: visible && !result.isPending && !result.error,
  };
}

export function useWikiGuideIssues(query: WikiGuideIssueQuery, session: number, revision: number,
  enabled: boolean, onDenied: () => void, initialAfter: string | null = null) {
  const signature = JSON.stringify(query);
  const result = useInfiniteQuery<WikiGuideIssuePage, Error,
    InfiniteData<WikiGuideIssuePage, string | undefined>, QueryKey, string | undefined>({
    queryKey: [...WIKI_GUIDE_QUERY_ROOT, session, revision, 'issues', signature, initialAfter],
    initialPageParam: initialAfter ?? undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => authorized(() => searchWikiGuideIssues({
      ...JSON.parse(signature) as WikiGuideIssueQuery, limit: 20, ...(pageParam ? { after: pageParam } : {}),
    }, signal), signal, onDenied),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled, staleTime: 30_000, gcTime: 5 * 60_000, retry: false,
  });
  const visible = enabled && !wikiGuideAccessDenied(result.error);
  const pages = new Map<string, string | null>();
  if (visible) result.data?.pages.forEach((page, index) => page.items.forEach(hit => {
    const id = wikiGuideIssueAnchor(hit);
    if (!pages.has(id)) pages.set(id, result.data!.pageParams[index] ?? null);
  }));
  return {
    items: visible ? [...new Map(result.data?.pages.flatMap(page => page.items).map(hit =>
      [wikiGuideIssueAnchor(hit), hit]) ?? []).values()] : [],
    loading: enabled && result.isPending, loadingMore: result.isFetchingNextPage,
    error: enabled ? failure(result.error) : null, hasMore: visible && result.hasNextPage,
    pageFor: (anchor: string): string | null | undefined => pages.get(anchor),
    loadMore: () => { if (enabled && result.hasNextPage && !result.isFetching) void result.fetchNextPage(); },
  };
}
