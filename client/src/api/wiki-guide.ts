import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { z } from 'zod/v4';
import type {
  WikiGuideIssuePage, WikiGuideIssueQuery, WikiGuideNavigationPage, WikiGuideNavigationQuery,
  WikiGuidePathSegment,
} from '@shared/wiki-guide.interface';
import { getCanonicalHostClientSessionGeneration, requireCanonicalHostClientAuthentication } from './canonical-host';

const scope = z.object({
  kind: z.enum(['FLEET', 'ATA2', 'ATA4']), title: z.string(), fleetFamilyId: z.string(),
  fleetModelIds: z.array(z.string()), ata2: z.string().nullable(), ata4: z.string().nullable(),
  selectionReason: z.string(),
});
const segment = z.object({
  summaryId: z.string().min(1), parentSummaryId: z.string().nullable(), scope,
  currentSummaryRef: z.string().min(1).nullable(), currentRevision: z.number().int().nonnegative(),
});
const navigation = z.object({
  items: z.array(segment.extend({
    wikiId: z.string(), enabled: z.boolean(), currentBodyStatus: z.enum(['AVAILABLE', 'UPDATING_SCOPE']),
    state: z.enum(['EMPTY', 'CURRENT', 'PENDING', 'WAITING_UPSTREAM', 'QUEUED', 'RUNNING', 'PARTIAL', 'BLOCKED']),
    path: z.array(segment),
  })), nextCursor: z.string().nullable(),
});
const issues = z.object({
  items: z.array(z.object({
    subjectKind: z.enum(['WORK_ITEM', 'ENGINEERING_MATTER']), subjectId: z.string(), workRef: z.string(),
    workRevision: z.number().int().positive(), issueKey: z.string(), question: z.string(),
    documentVersionId: z.string().nullable(), paths: z.array(z.array(segment)),
  })), nextCursor: z.string().nullable(), coverage: z.literal('CONFIRMED_WIKI_MEMBERS'),
});

function responseStatus(reason: unknown): number | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  if ('statusCode' in reason && typeof reason.statusCode === 'number') return reason.statusCode;
  if (!('response' in reason) || !reason.response || typeof reason.response !== 'object') return undefined;
  return 'status' in reason.response && typeof reason.response.status === 'number' ? reason.response.status : undefined;
}

async function read<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const session: number = getCanonicalHostClientSessionGeneration();
  try {
    const response = await axiosForBackend<unknown>({ url, method: 'GET', signal, headers: { 'Cache-Control': 'no-cache' } });
    if (response.status >= 400) throw Object.assign(new Error('WIKI_GUIDE_HTTP_ERROR'), { statusCode: response.status });
    if (session !== getCanonicalHostClientSessionGeneration()) throw new Error('WIKI_GUIDE_SESSION_CHANGED');
    return schema.parse(response.data);
  } catch (reason: unknown) {
    if (signal?.aborted) throw reason;
    const status: number | undefined = responseStatus(reason);
    if (status === 401) requireCanonicalHostClientAuthentication(session);
    throw Object.assign(new Error(status === 401 ? '请先登录，再读取工程知识。'
      : status === 403 || status === 404 ? '此知识内容暂不可读取。'
      : status === 503 ? '知识目录暂时无法读取，请重试。' : '知识读取未完成，请重试。'),
    { statusCode: status, cause: reason });
  }
}

function queryString(input: WikiGuideNavigationQuery | WikiGuideIssueQuery): string {
  const params: URLSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value));
  return params.toString();
}

/** Explicit nullable properties also keep the non-strict test compiler's output exact. */
function pointer(value: z.infer<typeof segment>): WikiGuidePathSegment {
  return { summaryId: value.summaryId, parentSummaryId: value.parentSummaryId ?? null,
    currentSummaryRef: value.currentSummaryRef ?? null, currentRevision: value.currentRevision,
    scope: { ...value.scope, ata2: value.scope.ata2 ?? null, ata4: value.scope.ata4 ?? null } };
}

export function readWikiGuideNavigation(input: WikiGuideNavigationQuery = {}, signal?: AbortSignal): Promise<WikiGuideNavigationPage> {
  return read(`/api/canonical-host/hierarchical-wiki/navigation?${queryString(input)}`, navigation, signal)
    .then(value => ({ items: value.items.map(item => ({ ...pointer(item), wikiId: item.wikiId,
      enabled: item.enabled, state: item.state, currentBodyStatus: item.currentBodyStatus,
      path: item.path.map(pointer) })), nextCursor: value.nextCursor ?? null }));
}
export function searchWikiGuideIssues(input: WikiGuideIssueQuery, signal?: AbortSignal): Promise<WikiGuideIssuePage> {
  return read(`/api/canonical-host/engineering-issues/wiki-guide?${queryString(input)}`, issues, signal)
    .then(value => ({ items: value.items.map(item => ({ ...item, documentVersionId: item.documentVersionId ?? null,
      paths: item.paths.map(path => path.map(pointer)) })), nextCursor: value.nextCursor ?? null,
    coverage: value.coverage }));
}
