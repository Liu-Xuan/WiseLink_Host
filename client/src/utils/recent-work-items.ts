import { logger } from '@lark-apaas/client-toolkit/logger';

const LEGACY_RECENT_WORK_ITEMS_KEY =
  'wiselink:canonical-host:recent-work-items';
const RECENT_WORK_ITEMS_KEY_PREFIX =
  'wiselink:canonical-host:recent-work-items:v2';
const RECENT_WORK_ITEM_LIMIT = 12;

export interface RecentWorkItemReference {
  workItemId: string;
  openedAt: string;
  family: string;
  documentLabel: string;
  documentVersionId: string;
}

export interface RecentWorkItemInput {
  workItemId: string;
  family: string;
  documentLabel: string;
  documentVersionId: string;
}

export interface RecentWorkItemIdentity {
  userId: string;
  tenantId: string;
}

export function readRecentWorkItems(
  identity: RecentWorkItemIdentity,
): RecentWorkItemReference[] {
  if (typeof window === 'undefined') return [];
  try {
    window.localStorage.removeItem(LEGACY_RECENT_WORK_ITEMS_KEY);
    const stored: string | null = window.localStorage.getItem(
      identityStorageKey(identity),
    );
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeReference)
      .filter(
        (
          reference: RecentWorkItemReference | null,
        ): reference is RecentWorkItemReference => reference !== null,
      )
      .slice(0, RECENT_WORK_ITEM_LIMIT);
  } catch (error) {
    logger.error('读取最近访问 WorkItem 导航记录失败', error);
    return [];
  }
}

export function rememberRecentWorkItem(
  identity: RecentWorkItemIdentity,
  input: RecentWorkItemInput,
): void {
  if (typeof window === 'undefined') return;
  const normalizedWorkItemId: string = input.workItemId.trim();
  if (!normalizedWorkItemId) return;
  const next: RecentWorkItemReference[] = [
    {
      workItemId: normalizedWorkItemId,
      openedAt: new Date().toISOString(),
      family: input.family.trim() || '未分类',
      documentLabel: input.documentLabel.trim() || normalizedWorkItemId,
      documentVersionId: input.documentVersionId.trim(),
    },
    ...readRecentWorkItems(identity).filter(
      (reference: RecentWorkItemReference): boolean =>
        reference.workItemId !== normalizedWorkItemId,
    ),
  ].slice(0, RECENT_WORK_ITEM_LIMIT);
  try {
    window.localStorage.setItem(
      identityStorageKey(identity),
      JSON.stringify(next),
    );
  } catch (error) {
    logger.error('记录最近访问 WorkItem 导航记录失败', error);
  }
}

export function forgetRecentWorkItem(
  identity: RecentWorkItemIdentity,
  workItemId: string,
): void {
  if (typeof window === 'undefined') return;
  const normalizedWorkItemId = workItemId.trim();
  if (!normalizedWorkItemId) return;
  try {
    const next = readRecentWorkItems(identity).filter(
      (reference) => reference.workItemId !== normalizedWorkItemId,
    );
    window.localStorage.setItem(
      identityStorageKey(identity),
      JSON.stringify(next),
    );
  } catch (error) {
    logger.error('清理无权访问的 WorkItem 导航记录失败', error);
  }
}

export function workItemIdFromLocator(value: string): string {
  const normalized: string = value.trim();
  if (!normalized) return '';
  try {
    const parsed: URL = new URL(normalized, window.location.origin);
    const routeMatch: RegExpMatchArray | null = parsed.pathname.match(
      /\/work-items\/([^/]+)/u,
    );
    if (routeMatch?.[1]) return decodeURIComponent(routeMatch[1]).trim();
    return parsed.searchParams.get('workItemId')?.trim() ?? normalized;
  } catch (error) {
    logger.error('解析 WorkItem 定位链接失败', error);
    return normalized;
  }
}

function normalizeReference(value: unknown): RecentWorkItemReference | null {
  if (!isRecord(value)) return null;
  const candidate: Record<string, unknown> = value;
  if (
    typeof candidate.workItemId !== 'string' ||
    !candidate.workItemId.trim() ||
    typeof candidate.openedAt !== 'string' ||
    !candidate.openedAt.trim()
  ) {
    return null;
  }
  return {
    workItemId: candidate.workItemId.trim(),
    openedAt: candidate.openedAt.trim(),
    family:
      typeof candidate.family === 'string' && candidate.family.trim()
        ? candidate.family.trim()
        : '未分类',
    documentLabel:
      typeof candidate.documentLabel === 'string' &&
      candidate.documentLabel.trim()
        ? candidate.documentLabel.trim()
        : candidate.workItemId.trim(),
    documentVersionId:
      typeof candidate.documentVersionId === 'string'
        ? candidate.documentVersionId.trim()
        : '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identityStorageKey(identity: RecentWorkItemIdentity): string {
  const userId = identity.userId.trim();
  const tenantId = identity.tenantId.trim();
  if (!userId || !tenantId) {
    throw new Error('RECENT_WORK_ITEM_IDENTITY_REQUIRED');
  }
  return `${RECENT_WORK_ITEMS_KEY_PREFIX}:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}`;
}
