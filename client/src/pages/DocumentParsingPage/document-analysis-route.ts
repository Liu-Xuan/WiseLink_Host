import { libraryDocumentReadingRoute, libraryTaskDocumentReadingRoute } from '@client/src/features/matter/reading-return';
import type { WorkbenchNode } from './document-parsing-navigation';

function routeIdentity(value: string): boolean {
  return Boolean(value && value.trim() === value && value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(value));
}

/** A URL WorkItem is a locator. Quicklook and the independent page read still authorize it. */
export function readDocumentWorkItemLocator(params: URLSearchParams): {
  workItemId: string | null; error: string | null;
} {
  const values: string[] = params.getAll('workItemId');
  if (!values.length) return { workItemId: null, error: null };
  return values.length === 1 && routeIdentity(values[0])
    ? { workItemId: values[0], error: null }
    : { workItemId: null, error: '评估工作定位参数无效或重复，请从资料库重新打开。' };
}

/** Preserve caller-owned read and return state while moving the workspace into its exact version. */
export function documentVersionAnalysisRoute(documentVersionId: string, workItemId: string,
  panel: WorkbenchNode, origin: URLSearchParams = new URLSearchParams()): string {
  if (!routeIdentity(documentVersionId) || !routeIdentity(workItemId))
    throw new Error('文档版本或评估工作定位无效。');
  for (const key of ['documentVersionId', 'workItemId', 'panel', 'parseRunId', 'sourceRef',
    'criterion', 'assessmentTab', 'assessmentCriterion', 'assessmentIssue', ...[...origin.keys()].filter((key: string) => key.startsWith('return'))]) {
    if (origin.getAll(key).length > 1) throw new Error('阅读定位或返回参数有重复，请从资料库重新打开。');
  }
  for (const key of ['parseRunId', 'sourceRef', 'criterion', 'assessmentCriterion', 'assessmentIssue']) {
    if (origin.has(key) && !routeIdentity(origin.get(key)!))
      throw new Error('保存原文或评估定位不完整，请从来源链接重新打开。');
  }
  if ((origin.has('documentVersionId') && origin.get('documentVersionId') !== documentVersionId) ||
    (origin.has('workItemId') && origin.get('workItemId') !== workItemId))
    throw new Error('评估工作与指定文档版本不一致，请从资料库重新打开。');
  const params: URLSearchParams = new URLSearchParams(origin);
  if (params.has('criterion')) {
    if (params.has('assessmentCriterion') && params.get('assessmentCriterion') !== params.get('criterion'))
      throw new Error('复核规则定位有冲突，请重新打开该评估。');
    params.set('assessmentCriterion', params.get('criterion')!);
    params.delete('criterion');
  }
  for (const key of ['node', 'tab', 'documentVersionId']) params.delete(key);
  params.set('workItemId', workItemId);
  const reader: boolean = panel === 'reader' || panel === 'package' || panel === 'document';
  params.set('panel', reader ? 'reader' : 'assessment');
  if (panel === 'review') params.set('assessmentTab', 'review');
  if (panel === 'overall') params.set('assessmentTab', 'process');
  if (panel === 'aeo') params.set('assessmentTab', 'aeo');
  return `/document-versions/${encodeURIComponent(documentVersionId)}?${params}`;
}

export function libraryTaskAnalysisRoute(documentVersionId: string, workItemId: string,
  panel: WorkbenchNode, directory: URLSearchParams): string {
  const route: string = libraryTaskDocumentReadingRoute(documentVersionId, workItemId, directory);
  return documentVersionAnalysisRoute(documentVersionId, workItemId, panel,
    new URLSearchParams(route.slice(route.indexOf('?') + 1)));
}

export function libraryDocumentAssessmentRoute(documentVersionId: string, workItemId: string,
  directory: URLSearchParams): string {
  const state: URLSearchParams = new URLSearchParams(directory);
  state.set('selectedDocumentVersionId', documentVersionId);
  const route: string = libraryDocumentReadingRoute(documentVersionId, state);
  return documentVersionAnalysisRoute(documentVersionId, workItemId, 'assessment',
    new URLSearchParams(route.slice(route.indexOf('?') + 1)));
}
