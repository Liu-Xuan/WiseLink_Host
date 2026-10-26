export type DocumentWorkbenchPanel = 'reader' | 'interpretation' | 'assessment' | 'wiki';

export type DocumentAssessmentTab = 'overall' | 'investigation' | 'review' | 'process' | 'aeo';
export const DOCUMENT_ASSESSMENT_TABS: ReadonlyArray<{ id: DocumentAssessmentTab; label: string }> = [
  { id: 'overall', label: '综合评估' }, { id: 'investigation', label: '调查问题' },
  { id: 'review', label: '复核意见' }, { id: 'process', label: '分析过程' }, { id: 'aeo', label: 'AEO 候选' },
];

export function readDocumentAssessmentTab(params: URLSearchParams): { tab: DocumentAssessmentTab; error: string | null } {
  const values: string[] = params.getAll('assessmentTab');
  if (!values.length) return { tab: 'overall', error: null };
  const selected = values.length === 1 ? DOCUMENT_ASSESSMENT_TABS.find(item => item.id === values[0]) : null;
  return selected ? { tab: selected.id, error: null } : { tab: 'overall', error: '评估区签参数无效，请重新选择。' };
}

export function readDocumentWorkbenchPanel(params: URLSearchParams, defaultPanel: DocumentWorkbenchPanel = 'reader'): {
  panel: DocumentWorkbenchPanel; error: string | null;
} {
  const values: string[] = params.getAll('panel');
  if (!values.length) return { panel: defaultPanel, error: null };
  if (values.length === 1 && (values[0] === 'reader' || values[0] === 'interpretation' || values[0] === 'assessment' || values[0] === 'wiki'))
    return { panel: values[0], error: null };
  return { panel: 'reader', error: '工作台面板参数无效，请选择原文、解读、评估或 Wiki。' };
}

/** Only the panel changes; exact source and caller-owned return state survive. */
export function documentWorkbenchPanelRoute(params: URLSearchParams, panel: DocumentWorkbenchPanel): string {
  const next: URLSearchParams = new URLSearchParams(params);
  const exactReading = ['semanticRevision', 'readingRevision', 'readingRunRef'].some(key => params.has(key));
  if (panel === 'reader' && !exactReading) next.delete('panel'); else next.set('panel', panel);
  return `?${next.toString()}`;
}
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';
import { readingReturnTarget } from '@client/src/features/matter/reading-return';


const ASSESSMENT_READING_KEYS = new Set(['documentVersionId', 'workItemId', 'panel', 'assessmentTab', 'assessmentCriterion',
  'assessmentIssue', 'assessmentScroll', 'parseRunId', 'sourceRef']);
function readingToken(value: string | null): value is string {
  return Boolean(value && value.trim() === value && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value));
}

/** Only read state is carried, never an arbitrary return URL or an authorization binding. */
export function documentAssessmentReturnParams(documentVersionId: string, origin: URLSearchParams,
  source: { documentVersionId?: string; workItemId?: string }, scroll = 0): URLSearchParams {
  if (!readingToken(documentVersionId)) throw new Error('评估返回对象无效。');
  const nested: URLSearchParams = new URLSearchParams({ documentVersionId, panel: 'assessment',
    assessmentTab: readDocumentAssessmentTab(origin).tab, assessmentScroll: String(Math.max(0, Math.min(9999999, Math.round(scroll)))) });
  for (const key of ['workItemId', 'assessmentCriterion', 'assessmentIssue', 'parseRunId', 'sourceRef']) {
    if (origin.getAll(key).length === 1 && readingToken(origin.get(key))) nested.set(key, origin.get(key)!);
  }
  const returns: string[] = [...origin.keys()].filter(key => key.startsWith('return'));
  if (returns.length) {
    if (returns.some(key => key.startsWith('returnAssessment')) ||
      !readingReturnTarget(origin, documentVersionId, origin.get('parseRunId'), undefined, undefined,
        `/document-versions/${encodeURIComponent(documentVersionId)}`))
      throw new Error('当前来源返回上下文未核定，请重新从资料库打开。');
    for (const key of returns) {
      if (origin.getAll(key).length !== 1) throw new Error('来源返回参数有重复。');
      nested.set(key, origin.get(key)!);
    }
  }
  const result: URLSearchParams = new URLSearchParams({ returnAssessmentQuery: nested.toString() });
  if (source.documentVersionId && readingToken(source.documentVersionId))
    result.set('returnAssessmentSourceVersionId', source.documentVersionId);
  else if (source.workItemId && readingToken(source.workItemId)) result.set('returnAssessmentSourceWorkItemId', source.workItemId);
  else throw new Error('来源返回对象未核定。');
  return result;
}

export function documentAssessmentReturnTarget(params: URLSearchParams, documentVersionId: string,
  workItemId = ''): { route: string; label: string } | null {
  const raw: string | null = params.get('returnAssessmentQuery');
  const binding: string | null = params.get('returnAssessmentSourceVersionId');
  const workBinding: string | null = params.get('returnAssessmentSourceWorkItemId');
  if (params.getAll('returnAssessmentQuery').length !== 1 || !raw || raw.length > 24576 ||
    (params.has('returnAssessmentSourceVersionId') ? !readingToken(binding) || params.getAll('returnAssessmentSourceVersionId').length !== 1 || binding !== documentVersionId || params.has('returnAssessmentSourceWorkItemId')
      : params.getAll('returnAssessmentSourceWorkItemId').length !== 1 || !workBinding || workBinding !== workItemId)) return null;
  const nested: URLSearchParams = new URLSearchParams(raw);
  const origin: string | null = nested.get('documentVersionId');
  if (!readingToken(origin) || nested.getAll('documentVersionId').length !== 1 || nested.getAll('panel').length !== 1 ||
    nested.get('panel') !== 'assessment' || readDocumentAssessmentTab(nested).error ||
    [...nested.keys()].some(key => !ASSESSMENT_READING_KEYS.has(key) && !key.startsWith('return') ||
      key.startsWith('returnAssessment') || nested.getAll(key).length !== 1)) return null;
  for (const key of ['workItemId', 'assessmentCriterion', 'assessmentIssue', 'parseRunId', 'sourceRef'])
    if (nested.has(key) && !readingToken(nested.get(key))) return null;
  if (nested.has('assessmentScroll') && !/^\d{1,7}$/u.test(nested.get('assessmentScroll')!)) return null;
  if ([...nested.keys()].some(key => key.startsWith('return')) &&
    !readingReturnTarget(nested, origin, nested.get('parseRunId'), undefined, undefined,
      `/document-versions/${encodeURIComponent(origin)}`)) return null;
  nested.delete('documentVersionId');
  return { route: `/document-versions/${encodeURIComponent(origin)}?${nested}`, label: '返回文档评估' };
}

/** The accepted WorkItem locator rule: an explicit broken parse locator never falls back to latest. */
export function documentAssessmentExactSourceRoute(evidence: {
  documentVersionId: string; sourceRefId: string; locator?: string;
}): string | null {
  const route: string | null = exactDocumentSourceRoute(evidence);
  if (!route && evidence.locator) {
    let locator: unknown;
    let invalid: boolean = false;
    try { locator = JSON.parse(evidence.locator); } catch { invalid = evidence.locator.trim().startsWith('{'); }
    if (invalid || locator !== null && typeof locator === 'object' && Object.prototype.hasOwnProperty.call(locator, 'parseRunId'))
      throw new Error('这条保存依据的解析定位不完整或与来源不一致，暂不能打开原文。');
  }
  return route;
}
