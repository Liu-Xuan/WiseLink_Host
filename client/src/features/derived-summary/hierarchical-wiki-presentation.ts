import type { HierarchicalWikiStatus } from '@shared/hierarchical-wiki.interface';

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

/** Directory errors describe the present attempt; older diagnostics stay in history. */
export function wikiDirectoryFailureMessage(item: Pick<HierarchicalWikiStatus, 'state' | 'errorCode'>): string | null {
  if (!item.errorCode || item.state === 'RUNNING' || item.state === 'QUEUED') return null;
  return '更新未完成，可打开 Wiki 核对进度。';
}
