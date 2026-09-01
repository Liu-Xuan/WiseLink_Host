import type {
  CanonicalDocumentParsingPageResponse,
  EngineeringQuicklookProjection,
  LibraryItemSummary,
} from '@shared/api.interface';
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
  relatedDocumentCount: number | null;
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
    process: `${workbench}?node=process&tab=process`,
    jobAid: `${workbench}?node=assessment&tab=assessment`,
    review: `${workbench}?node=review&tab=review`,
    history: `${workbench}?node=process&tab=process#workspace-history`,
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
      : kind === 'DOCUMENT'
        ? '当前受控资料'
        : '工程评估';
  const baseRules = page.workItem.integratedAssessment?.baseRules;
  const completedCriteria = baseRules
    ? Math.max(0, baseRules.evaluationItemCount - baseRules.unresolvedCount)
    : 0;

  return {
    kind,
    routeWorkItemId: page.workItem.workItemId,
    displayCode: documentCode,
    title,
    meta: `${view.documentVersion} · ${view.aircraftFamily}`,
    parentLabel:
      kind === 'DOCUMENT' ? '当前工程评估' : `主要来源 · ${documentCode}`,
    statusLabel: `${AUTHORITY_LABELS[view.authority]} · ${
      FRESHNESS_LABELS[view.freshness]
    }`,
    routes: workItemRoutes(page.workItem.workItemId),
    badges: {
      jobAid: baseRules
        ? `${completedCriteria}/${baseRules.criterionCount}`
        : undefined,
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

export function buildCatalogCurrentObjectContext(
  item: LibraryItemSummary,
  kind: 'DOCUMENT' | 'WORKITEM',
): CurrentObjectContextView {
  const jobAid = item.assessment.jobAid;
  return {
    kind,
    routeWorkItemId: item.workItemId,
    displayCode: item.displayCode,
    title: item.title,
    meta: `${item.document.businessRevision} · ${item.document.family}`,
    parentLabel:
      kind === 'DOCUMENT' ? '当前工程评估' : `主要来源 · ${item.displayCode}`,
    statusLabel: `${catalogAuthorityLabel(item.assessment.authority)} · ${catalogFreshnessLabel(item.assessment.freshness)}`,
    routes: workItemRoutes(item.workItemId),
    badges: {
      jobAid: jobAid ? `${jobAid.completed}/${jobAid.total}` : undefined,
    },
  };
}

export function buildQuicklookCurrentObjectContext(
  projection: EngineeringQuicklookProjection,
  kind: 'DOCUMENT' | 'WORKITEM',
): CurrentObjectContextView {
  return {
    kind,
    routeWorkItemId: projection.workItemId,
    displayCode: projection.displayCode,
    title: projection.title,
    meta: projection.familySummary.currentVersion,
    parentLabel:
      kind === 'DOCUMENT'
        ? '当前工程评估'
        : `主要来源 · ${projection.displayCode}`,
    statusLabel: `${quicklookAuthorityLabel(projection.authorityState)} · ${catalogFreshnessLabel(projection.freshness)}`,
    routes: workItemRoutes(projection.workItemId),
  };
}

export function buildCatalogEngineeringQuicklook(
  projection: EngineeringQuicklookProjection,
): EngineeringQuicklookView {
  const applicability = projection.applicabilitySummary
    .map((statement) => statement.text.trim())
    .filter(Boolean);
  const why = projection.whyItMatters
    .map((statement) => statement.text.trim())
    .filter(Boolean);
  return {
    authorityLabel: quicklookAuthorityLabel(projection.authorityState),
    freshnessLabel: catalogFreshnessLabel(projection.freshness),
    currentJudgment:
      projection.currentJudgment?.text.trim() ||
      '当前尚未形成可直接展示的工程摘要，请进入工作台查看受控原文与解析状态。',
    applicabilitySummary:
      applicability.join(' ') || '当前资料尚未返回适用范围摘要。',
    whyItMatters: why[0] || '当前资料尚未返回风险或影响摘要。',
    keyEvidence: projection.keyEvidence.map((evidence) => ({
      label:
        [evidence.sectionTitle, evidence.pageStart && `P${evidence.pageStart}`]
          .filter(Boolean)
          .join(' · ') || evidence.label,
      sourceRefId: evidence.sourceRefId,
    })),
    unresolvedQuestions: projection.unresolvedQuestions,
    recommendedActions: projection.recommendedActions.map(
      (statement) => statement.text,
    ),
    sourceCount: projection.keyEvidence.length,
    documentVersionLabel: projection.familySummary.currentVersion,
    relatedDocumentCount: projection.familySummary.attachmentCount,
  };
}

function catalogAuthorityLabel(
  authority: LibraryItemSummary['assessment']['authority'],
): string {
  return authority === 'CANDIDATE' ? '候选意见' : '摘要未形成';
}

function quicklookAuthorityLabel(
  authority: EngineeringQuicklookProjection['authorityState'],
): string {
  if (authority === 'ENGINEER_CONFIRMED') return '工程师已确认';
  if (authority === 'FORMAL_READBACK') return '正式结果回读';
  if (authority === 'CANDIDATE') return '候选意见';
  return '摘要未形成';
}

function catalogFreshnessLabel(
  freshness: EngineeringQuicklookProjection['freshness'],
): string {
  if (freshness === 'STALE') return '结论需更新';
  if (freshness === 'SUPERSEDED') return '历史文件版本';
  return '当前有效';
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
