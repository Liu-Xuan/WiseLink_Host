import type { WorkbenchNode } from './WorkItemContextTree';

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

export function structuredSourceDeepLink(
  sourceRef: string,
  pageStart: number | null | undefined,
): Record<string, string | null> {
  return {
    node: 'reader',
    tab: 'reader',
    unit: null,
    sourceRef,
    readerMode: 'source',
    page:
      pageStart === null || pageStart === undefined ? null : String(pageStart),
  };
}
