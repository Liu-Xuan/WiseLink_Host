import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import {
  AUTHORITY_LABELS,
  FRESHNESS_LABELS,
  staleReasonLabel,
  toWorkItemView,
  type EngineeringStatementView,
} from '@client/src/services/viewModelMappers';
import type {
  CurrentObjectContextView,
  CurrentObjectKind,
} from '@client/src/app/providers/CurrentObjectContextProvider';

export interface EngineeringQuicklookEvidence {
  label: string;
  sourceRefId?: string;
}

export interface EngineeringQuicklookView {
  authorityLabel: string;
  freshnessLabel: string;
  currentJudgment: string;
  applicabilitySummary: string;
  whyItMatters: string;
  keyEvidence: EngineeringQuicklookEvidence[];
  unresolvedQuestions: string[];
  recommendedActions: string[];
  sourceCount?: number;
  documentVersionLabel: string;
  relatedDocumentCount: number;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value: string | null | undefined) => value?.trim()) ?? '';
}

function statementText(statement: EngineeringStatementView | null): string {
  return statement?.text.trim() ?? '';
}

function statementEvidence(
  statement: EngineeringStatementView,
): EngineeringQuicklookEvidence {
  return {
    label: statement.text,
    sourceRefId: statement.sourceRefIds[0],
  };
}

function workItemRoutes(workItemId: string) {
  const encoded: string = encodeURIComponent(workItemId);
  const workbench: string = `/work-items/${encoded}/documents`;
  return {
    overview: `/work-items/${encoded}`,
    workspace: `${workbench}?node=reader&tab=reader&readerMode=structured`,
    process: `${workbench}?node=overall&tab=overall`,
    jobAid: `${workbench}?node=assessment&tab=assessment`,
    review: `${workbench}?node=review&tab=review`,
    history: `${workbench}?node=overall&tab=overall#workspace-history`,
    family: `${workbench}?node=document&tab=source`,
  };
}

export function buildCurrentObjectContext(
  page: CanonicalDocumentParsingPageResponse,
  kind: CurrentObjectKind,
): CurrentObjectContextView {
  const view = toWorkItemView(page);
  const documentCode: string = view.documentLabel;
  const packageTitle: string = page.workItem.package?.title?.trim() ?? '';
  const title: string =
    packageTitle && packageTitle !== documentCode
      ? packageTitle
      : kind === 'MATTER'
        ? `${documentCode} 工程评估`
        : '当前受控资料';
  const baseRules = page.workItem.integratedAssessment?.baseRules;
  const reviewCount: number = page.engineerReviewContext?.items.length ?? 0;

  return {
    kind,
    routeWorkItemId: page.workItem.workItemId,
    displayCode: kind === 'DOCUMENT' ? documentCode : `${documentCode} 事项`,
    title,
    meta: `${view.documentVersion} · ${view.aircraftFamily}`,
    parentLabel:
      kind === 'DOCUMENT'
        ? '关联事项 · 当前工程事项'
        : `当前来源 · ${documentCode}`,
    statusLabel: `${AUTHORITY_LABELS[view.authority]} · ${
      FRESHNESS_LABELS[view.freshness]
    }`,
    routes: workItemRoutes(page.workItem.workItemId),
    badges: {
      process: baseRules?.unresolvedCount,
      jobAid: baseRules ? `${baseRules.evaluationItemCount} 项` : undefined,
      review: reviewCount || undefined,
      family: page.relatedDocuments.relations.length || undefined,
    },
  };
}

export function buildEngineeringQuicklook(
  page: CanonicalDocumentParsingPageResponse,
): EngineeringQuicklookView {
  const view = toWorkItemView(page);
  const overall = view.overall;
  const projection = page.workItem.integratedAssessment?.overallSynthesis;
  const applicabilityStatements: string[] = [
    statementText(overall?.applicability.sourceScope ?? null),
    statementText(overall?.applicability.fleetMatch ?? null),
  ].filter((value: string) => value !== '');
  const evidenceStatements: EngineeringStatementView[] = overall
    ? [
        ...(overall.conclusion ? [overall.conclusion] : []),
        ...overall.whyItMatters,
        ...overall.applicability.requiredFacts,
        ...overall.implementationImpact,
      ]
    : [];
  const evidenceBySourceRef: Map<string, EngineeringQuicklookEvidence> =
    new Map();
  evidenceStatements.forEach((statement: EngineeringStatementView): void => {
    const key: string = statement.sourceRefIds[0] ?? statement.text;
    if (!evidenceBySourceRef.has(key)) {
      evidenceBySourceRef.set(key, statementEvidence(statement));
    }
  });
  const unresolvedQuestions: string[] = [
    ...(overall?.applicability.requiredFacts.map(
      (statement: EngineeringStatementView) => statement.text,
    ) ?? []),
    ...(projection?.missingInputs ?? []),
    ...(projection?.gap ? [projection.gap] : []),
    ...(overall?.staleReason
      ? [staleReasonLabel(overall.staleReason) ?? '当前综合意见需要更新']
      : []),
  ];

  return {
    authorityLabel: AUTHORITY_LABELS[view.authority],
    freshnessLabel: FRESHNESS_LABELS[view.freshness],
    currentJudgment:
      overall?.conclusion?.text ??
      '当前资料尚未返回可直接使用的工程摘要，可先进入工作台查看结构化内容与原文。',
    applicabilitySummary:
      applicabilityStatements.join(' ') || '当前未返回适用范围摘要。',
    whyItMatters: firstNonEmpty(
      overall?.whyItMatters[0]?.text,
      overall?.implementationImpact[0]?.text,
      '当前未返回风险或影响摘要。',
    ),
    keyEvidence: Array.from(evidenceBySourceRef.values()).slice(0, 4),
    unresolvedQuestions: Array.from(new Set(unresolvedQuestions)).slice(0, 5),
    recommendedActions:
      overall?.nextActions.map(
        (statement: EngineeringStatementView) => statement.text,
      ) ?? [],
    sourceCount: overall?.sourceCount,
    documentVersionLabel: view.documentVersion,
    relatedDocumentCount: page.relatedDocuments.relations.length,
  };
}

export function quicklookMarkdown(
  title: string,
  quicklook: EngineeringQuicklookView,
): string {
  const list = (items: string[]): string =>
    items.length > 0
      ? items.map((item: string) => `- ${item}`).join('\n')
      : '- 当前未返回';
  return [
    `# ${title}`,
    '',
    `> ${quicklook.authorityLabel} · ${quicklook.freshnessLabel}；内容仅用于工程辅助，不代表批准或放行。`,
    '',
    '## 当前判断',
    quicklook.currentJudgment,
    '',
    '## 适用范围',
    quicklook.applicabilitySummary,
    '',
    '## 为什么需要关注',
    quicklook.whyItMatters,
    '',
    '## 关键依据',
    list(quicklook.keyEvidence.map((evidence) => evidence.label)),
    '',
    '## 未决问题',
    list(quicklook.unresolvedQuestions),
    '',
    '## 建议下一步',
    list(quicklook.recommendedActions),
  ].join('\n');
}
