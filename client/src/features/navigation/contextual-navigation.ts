import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';
import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalLibraryWorkItemSummary,
  CanonicalLibraryQuicklookResponse,
  CanonicalRelatedDocumentRelation,
} from '@shared/api.interface';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
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
  sourceRefIds: string[];
}

export interface EngineeringQuicklookView {
  readingResult: AssessmentReadingResult | null;
  resultIdentity: {
    resultRef: string;
    revision: number;
    workItemId: string;
    documentVersionId: string;
  } | null;
  authorityLabel: string;
  freshnessLabel: string;
  currentJudgment: string;
  applicabilitySummary: string;
  whyItMatters: string;
  keyEvidence: EngineeringQuicklookEvidence[];
  unresolvedQuestions: string[];
  recommendedActions: string[];
  sourceCount?: number;
  currentVersionLabel: string | null;
  derivedArtifactCount: number | null;
  sourceReadNote?: string;
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
    sourceRefIds: [...statement.sourceRefIds],
  };
}

export function countQuicklookDerivedArtifacts(
  relations: CanonicalRelatedDocumentRelation[],
): number {
  return relations.filter(
    (relation: CanonicalRelatedDocumentRelation) =>
      relation.relationRole !== 'SELECTED_DOCUMENT_VERSION' &&
      relation.relationRole !== 'HAS_READER_RESULTS',
  ).length;
}

function workItemRoutes(workItemId: string) {
  const encoded: string = encodeURIComponent(workItemId);
  const workbench: string = `/work-items/${encoded}/analysis`;
  return {
    overview: `/work-items/${encoded}`,
    workspace: `${workbench}?panel=reader&readerMode=structured`,
    process: `${workbench}?panel=overall`,
    jobAid: `${workbench}?panel=assessment`,
    review: `${workbench}?panel=review`,
    history: `${workbench}?panel=overall#workspace-history`,
    family: `${workbench}?panel=document`,
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
      : kind !== 'DOCUMENT'
        ? `${documentCode} 工程评估`
        : '当前受控资料';
  const baseRules = page.workItem.integratedAssessment?.baseRules;

  return {
    kind,
    routeWorkItemId: page.workItem.workItemId,
    /* Host 尚未返回独立 matterCode；此处只展示真实文档身份，不拼造事项编号。 */
    displayCode: documentCode,
    title,
    meta: `${view.documentVersion} · ${view.aircraftFamily}`,
    parentLabel:
      kind === 'DOCUMENT'
        ? '关联评估 · 当前工程评估'
        : `主要来源 · ${documentCode}`,
    statusLabel: `${AUTHORITY_LABELS[view.authority]} · ${
      FRESHNESS_LABELS[view.freshness]
    }`,
    routes: workItemRoutes(page.workItem.workItemId),
    badges: {
      /* 普通统计不进入 rail；这里只呈现工程师可行动的完成度。 */
      jobAid: baseRules
        ? isJobAidProblemProjection(baseRules)
          ? `${baseRules.issueCount} 个问题`
          : `${baseRules.evaluationItemCount}/${baseRules.criterionCount}`
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
  const base = page.workItem.integratedAssessment?.baseRules;
  const problem = isJobAidProblemProjection(base) ? base : null;
  const preferProblem =
    problem &&
    (!projection?.readingResult ||
      projection.status === 'STALE' ||
      projection.basedOnJobAidWorkRevisionRef !== problem.workRevisionRef);
  const readingResult = preferProblem
    ? problem.readingResult
    : (projection?.readingResult ?? null);
  const applicabilityStatements: string[] = [
    statementText(overall?.applicability.sourceScope ?? null),
    statementText(overall?.applicability.fleetMatch ?? null),
  ].filter((value: string) => value !== '');
  const evidenceStatements: EngineeringStatementView[] = overall
    ? [
        ...(overall.conclusion ? [overall.conclusion] : []),
        ...overall.whyItMatters,
        ...(overall.applicability.sourceScope
          ? [overall.applicability.sourceScope]
          : []),
        ...(overall.applicability.fleetMatch
          ? [overall.applicability.fleetMatch]
          : []),
        ...overall.applicability.requiredFacts,
        ...overall.implementationImpact,
        ...overall.dispositionPriority,
        ...overall.nextActions,
      ]
    : [];
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
    readingResult,
    resultIdentity: readingResult
      ? {
          resultRef: readingResult.resultRef,
          revision: readingResult.resultRevision,
          workItemId: page.workItem.workItemId,
          documentVersionId: page.workItem.source.documentVersionId,
        }
      : projection
        ? {
            resultRef: projection.sourceResultId,
            revision: projection.revision,
            workItemId: page.workItem.workItemId,
            documentVersionId: page.workItem.source.documentVersionId,
          }
        : null,
    authorityLabel: AUTHORITY_LABELS[view.authority],
    freshnessLabel: FRESHNESS_LABELS[view.freshness],
    currentJudgment:
      readingResult?.content.headline ?? overall?.conclusion?.text ?? '',
    applicabilitySummary: applicabilityStatements.join(' '),
    whyItMatters: firstNonEmpty(
      overall?.whyItMatters
        .map((statement: EngineeringStatementView) => statement.text)
        .join('\n\n'),
      overall?.implementationImpact
        .map((statement: EngineeringStatementView) => statement.text)
        .join('\n\n'),
    ),
    keyEvidence: evidenceStatements.map(statementEvidence),
    unresolvedQuestions,
    recommendedActions:
      overall?.nextActions.map(
        (statement: EngineeringStatementView) => statement.text,
      ) ?? [],
    sourceCount: overall?.sourceCount,
    currentVersionLabel:
      page.workItem.package?.documentIdentity?.businessRevision?.trim() || null,
    derivedArtifactCount: countQuicklookDerivedArtifacts(
      page.relatedDocuments.relations,
    ),
    sourceReadNote: preferProblem ? '整体意见待更新' : undefined,
  };
}

export function buildLibraryObjectContext(
  document: CanonicalLibraryWorkItemSummary,
  kind: CurrentObjectKind,
): CurrentObjectContextView {
  const displayCode: string =
    document.documentCode || '文档编号待核';
  return {
    kind,
    routeWorkItemId: document.workItemId,
    displayCode,
    title: displayCode,
    meta: `${document.businessRevision || document.sourceGeneratedDate || '版本未标注'} · ${document.normalizedFamily}`,
    parentLabel:
      kind === 'DOCUMENT'
        ? '关联评估 · 当前工程评估'
        : `主要来源 · ${displayCode}`,
    statusLabel: `${document.selectedVersionIsCurrent ? '当前登记版本' : '历史登记版本'} · 原文未核验`,
    routes: workItemRoutes(document.workItemId),
  };
}

/** A saved result is useful even when the source has not been opened in this read. */
export function buildLibraryEngineeringQuicklook(
  response: CanonicalLibraryQuicklookResponse,
): EngineeringQuicklookView {
  const result = response.result;
  const summary = result?.engineeringSummary;
  const evidenceStatements: EngineeringStatementView[] = summary
    ? [
        summary.conclusion,
        ...summary.whyItMatters,
        summary.applicability.sourceScope,
        summary.applicability.fleetMatch,
        ...summary.applicability.requiredFacts,
        ...summary.implementationImpact,
        ...summary.dispositionPriority,
        ...summary.nextActions,
      ]
    : [];
  const unresolvedQuestions: string[] = [
    ...(summary?.applicability.requiredFacts.map(
      (statement) => statement.text,
    ) ?? []),
    ...(result?.missingInputs ?? []),
    ...(result?.gap ? [result.gap] : []),
    ...(result?.staleReason ? [staleReasonLabel(result.staleReason)!] : []),
  ];
  return {
    readingResult: result?.readingResult ?? null,
    resultIdentity: result?.readingResult
      ? {
          resultRef: result.readingResult.resultRef,
          revision: result.readingResult.resultRevision,
          workItemId: response.document.workItemId,
          documentVersionId: response.document.documentVersionId,
        }
      : result
        ? {
            resultRef: result.sourceResultId,
            revision: result.revision,
            workItemId: response.document.workItemId,
            documentVersionId: response.document.documentVersionId,
          }
        : null,
    authorityLabel:
      result?.jobAidRoundCompletion === 'IN_PROGRESS'
        ? '分析进行中 · 已保存工作'
        : result
          ? '已保存候选意见'
          : '',
    freshnessLabel: result?.status === 'STALE' ? '结论需更新' : '',
    currentJudgment: firstNonEmpty(
      result?.readingResult?.content.headline,
      summary?.conclusion.text,
      result?.overallCandidate,
    ),
    applicabilitySummary: [
      summary?.applicability.sourceScope.text,
      summary?.applicability.fleetMatch.text,
    ]
      .filter(Boolean)
      .join(' '),
    whyItMatters: firstNonEmpty(
      summary?.whyItMatters
        .map((statement: EngineeringStatementView) => statement.text)
        .join('\n\n'),
      summary?.implementationImpact
        .map((statement: EngineeringStatementView) => statement.text)
        .join('\n\n'),
    ),
    keyEvidence: evidenceStatements.map(statementEvidence),
    unresolvedQuestions,
    recommendedActions:
      summary?.nextActions.map((statement) => statement.text) ?? [],
    sourceCount: result?.sourceCount,
    currentVersionLabel:
      response.document.businessRevision ||
      response.document.sourceGeneratedDate ||
      null,
    derivedArtifactCount: null,
    sourceReadNote: result?.jobAidRoundCompletion
      ? `${result.jobAidRoundCompletion === 'IN_PROGRESS' ? '本轮分析进行中' : result.jobAidRoundCompletion === 'COMPLETE_WITH_OPEN_QUESTIONS' ? '本轮分析完成，有待确认事项' : '本轮分析完成'}${result.overallStatus === 'STALE' ? ' · 整体意见待更新' : ''}`
      : undefined,
  };
}

export function quicklookMarkdown(
  title: string,
  quicklook: EngineeringQuicklookView,
): string {
  if (quicklook.readingResult) {
    const content = quicklook.readingResult.content;
    return [
      `# ${title}`,
      '',
      `## ${content.headline}`,
      '',
      `> 结果版本：${quicklook.readingResult.resultRef} · ${quicklook.readingResult.resultRevision}`,
      ...(quicklook.sourceReadNote ? ['', quicklook.sourceReadNote] : []),
      '',
      content.listBrief,
      '',
      content.lead,
      '',
      ...content.claims.flatMap((claim) => [
        `### ${claim.basis === 'SOURCE_FACT' ? '来源陈述' : '条件性推断'}`,
        '',
        claim.text,
        '',
        ...claim.premises.flatMap((premise) => [
          `- ${premise.explanation}${premise.limitation ? `；限制：${premise.limitation}` : ''}`,
        ]),
        '',
      ]),
    ].join('\n');
  }
  const sections: Array<[string, string]> = [
    ['当前判断', quicklook.currentJudgment],
    ['适用范围', quicklook.applicabilitySummary],
    ['为什么需要关注', quicklook.whyItMatters],
    [
      '关键依据',
      quicklook.keyEvidence.map((evidence) => `- ${evidence.label}`).join('\n'),
    ],
    [
      '未决问题',
      quicklook.unresolvedQuestions.map((item) => `- ${item}`).join('\n'),
    ],
    [
      '建议下一步',
      quicklook.recommendedActions.map((item) => `- ${item}`).join('\n'),
    ],
  ];
  const labels = [quicklook.authorityLabel, quicklook.freshnessLabel]
    .filter(Boolean)
    .join(' · ');
  return [
    `# ${title}`,
    ...(labels ? ['', `> ${labels}`] : []),
    ...(quicklook.sourceReadNote ? ['', quicklook.sourceReadNote] : []),
    ...sections
      .filter(([, content]) => content.trim())
      .flatMap(([heading, content]) => ['', `## ${heading}`, content]),
  ].join('\n');
}
