export type WorkbenchNode =
  | 'document'
  | 'package'
  | 'reader'
  | 'assessment'
  | 'review'
  | 'overall'
  | 'aeo';

export interface WorkbenchTabDefinition {
  key: WorkbenchNode;
  label: string;
  mobileLabel?: string;
  mobileOrder?: number;
}

/** Desktop keeps the full workbench; mobile keeps the R05.5 four-tab shell. */
export const WORKBENCH_TAB_DEFINITIONS: WorkbenchTabDefinition[] = [
  {
    key: 'assessment',
    label: '综合评估',
    mobileLabel: '总体',
    mobileOrder: 1,
  },
  { key: 'package', label: '结构化内容' },
  {
    key: 'reader',
    label: 'PDF 原文',
    mobileLabel: '原文',
    mobileOrder: 2,
  },
  {
    key: 'overall',
    label: '分析过程',
    mobileLabel: '动态',
    mobileOrder: 4,
  },
  {
    key: 'review',
    label: '复核意见',
    mobileLabel: '复核',
    mobileOrder: 3,
  },
  { key: 'aeo', label: 'AEO 候选' },
];

export function getWorkbenchNode(value: string | null): WorkbenchNode {
  if (
    value === 'document' ||
    value === 'package' ||
    value === 'reader' ||
    value === 'assessment' ||
    value === 'review' ||
    value === 'overall' ||
    value === 'aeo'
  ) {
    return value;
  }
  return 'assessment';
}

export function getWorkbenchPanel(params: URLSearchParams): WorkbenchNode {
  const panels: string[] = params.getAll('panel');
  return panels.length === 1 ? getWorkbenchNode(panels[0]) : 'assessment';
}

export function workItemAnalysisRoute(
  workItemId: string,
  panel: WorkbenchNode,
  state?: URLSearchParams,
): string {
  const normalizedWorkItemId: string = workItemId.trim();
  if (!normalizedWorkItemId) {
    throw new Error('WORKITEM_ID_REQUIRED');
  }
  const params: URLSearchParams = new URLSearchParams(state);
  params.delete('node');
  params.delete('tab');
  params.delete('panel');
  params.set('panel', panel);
  return `/work-items/${encodeURIComponent(normalizedWorkItemId)}/analysis?${params.toString()}`;
}

export function legacyDocumentWorkbenchRoute(
  workItemId: string,
  search: string,
): string {
  const params: URLSearchParams = new URLSearchParams(search);
  const nodes: string[] = params.getAll('node');
  const tabs: string[] = params.getAll('tab');
  const legacyValue: string | null =
    nodes.length > 0
      ? nodes.length === 1
        ? nodes[0]
        : null
      : tabs.length === 1 && tabs[0] !== 'source'
        ? tabs[0]
        : tabs.length === 1
          ? 'document'
          : null;
  return workItemAnalysisRoute(
    workItemId,
    getWorkbenchNode(legacyValue),
    params,
  );
}

export function structuredSourceDeepLink(
  sourceRef: string,
  pageStart: number | null | undefined,
): Record<string, string | null> {
  return {
    panel: 'package',
    unit: null,
    sourceRef,
    readerMode: null,
    page:
      pageStart === null || pageStart === undefined ? null : String(pageStart),
  };
}
