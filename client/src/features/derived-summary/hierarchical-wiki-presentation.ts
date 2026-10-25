import type { HierarchicalWikiStatus } from '@shared/hierarchical-wiki.interface';

/** The server-supplied ref pins this observation; the reader rechecks access. */
export function wikiSavedReadingRoute(read: HierarchicalWikiStatus): string {
  const route: string = `/summaries/${encodeURIComponent(read.summaryId)}`;
  return read.savedRevision
    ? `${route}?${new URLSearchParams({ summaryRef: read.savedRevision.summaryRef })}`
    : route;
}

export const wikiStatusLabels: Record<HierarchicalWikiStatus['state'], string> = {
  EMPTY: '尚无已归类的可读成果',
  CURRENT: '已覆盖当前归类范围',
  PENDING: '待更新',
  WAITING_UPSTREAM: '等待下层更新',
  QUEUED: '排队等待执行',
  RUNNING: '正在生成',
  PARTIAL: '部分覆盖，仍有待补材料',
  BLOCKED: '更新未完成',
};
