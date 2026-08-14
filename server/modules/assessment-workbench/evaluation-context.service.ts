import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';

import type {
  BoundedInvestigationRunView,
  EngineerReviewState,
  EvaluationContextCriterionCard,
  EvaluationContextPackageResponse,
  EvaluationResourceAssessment,
  HistoricalAssessmentContext,
  KnowledgeRetrievalContext,
  SimilarCaseContext,
  ResourceAvailabilityStatus,
  SbJobAidShadowSnapshotResponse,
  ShadowEvaluationItem,
  ShadowSourceEvidenceCandidate,
} from '@shared/assessment-host.interface';

import { buildSimilarCaseContext } from './knowledge-retrieval-context.service';
import { missingStructuredAssessmentContext } from './structured-assessment-context';

const CONTEXT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.evaluation_context_package.v1' as const;
const TARGET_RULE_SET = '0.3-candidate' as const;
const DERIVATION_MODE = 'V0_2_COMPATIBILITY_DERIVATION' as const;

const AVAILABILITY_STATUSES: ResourceAvailabilityStatus[] = [
  'AVAILABLE_VERIFIED',
  'AVAILABLE_CANDIDATE',
  'MISSING',
  'ACCESS_DENIED',
  'VERSION_UNCONFIRMED',
  'STALE',
  'CONFLICT',
  'NOT_APPLICABLE',
];

@Injectable()
export class EvaluationContextService {
  build(
    snapshot: SbJobAidShadowSnapshotResponse,
    historicalContext?: HistoricalAssessmentContext,
    knowledgeContext?: KnowledgeRetrievalContext,
    latestInvestigation?: BoundedInvestigationRunView | null,
  ): EvaluationContextPackageResponse {
    return buildEvaluationContextPackage(snapshot, {
      historicalContext,
      knowledgeContext,
      latestInvestigation,
    });
  }
}

export function buildEvaluationContextPackage(
  snapshot: SbJobAidShadowSnapshotResponse,
  options: {
    historicalContext?: HistoricalAssessmentContext;
    knowledgeContext?: KnowledgeRetrievalContext;
    latestInvestigation?: BoundedInvestigationRunView | null;
  } = {},
): EvaluationContextPackageResponse {
  const expectedCriteriaCount = snapshot.provenance.rulePackCriteriaCount;
  if (!Number.isInteger(expectedCriteriaCount) || expectedCriteriaCount < 1) {
    throw new ConflictException('EVALUATION_CONTEXT_RULE_COUNT_INVALID');
  }
  if (snapshot.items.length !== expectedCriteriaCount) {
    throw new ConflictException(
      `EVALUATION_CONTEXT_ITEM_COUNT_INVALID:${snapshot.items.length}:${expectedCriteriaCount}`,
    );
  }
  if (!snapshot.provenance.criterionSetId
    || !snapshot.provenance.criterionSetHash
    || !snapshot.provenance.criterionSetMemberIdentityHash
    || !snapshot.provenance.ruleArtifactRef
    || !snapshot.provenance.ruleArtifactDigest
    || !snapshot.provenance.ruleArtifactVersion
    || !snapshot.provenance.sourceJobAidDocumentVersionStatus) {
    throw new ConflictException('EVALUATION_CONTEXT_CRITERION_SET_IDENTITY_MISSING');
  }
  const unifiedPackage = snapshot.provenance.parserPackageSchemaVersion
    === 'techpub.parsed-package.v1';
  if (
    snapshot.provenance.parserCurrentness !== 'current' ||
    (!unifiedPackage && snapshot.provenance.parserQualityGateStatus !== 'PASS') ||
    (unifiedPackage && !['PASS', 'PARTIAL_SOURCE_PRESERVED'].includes(
      snapshot.provenance.parserQualityGateStatus ?? '',
    ))
  ) {
    throw new ConflictException('EVALUATION_CONTEXT_PARSER_INPUT_NOT_CURRENT');
  }
  if (unifiedPackage && !snapshot.parsedPackage) {
    throw new ConflictException(
      'EVALUATION_CONTEXT_UNIFIED_PACKAGE_IDENTITY_MISSING',
    );
  }

  const criterionCards = [...snapshot.items]
    .sort(compareItems)
    .map(toCriterionCard);
  const resourceAssessments = [...snapshot.items]
    .sort(compareItems)
    .map(buildResourceAssessment);
  const evaluationItemSetHash = hashCanonical(criterionCards);
  const resourceSummary = summarizeResources(resourceAssessments);
  const manifest: EvaluationContextPackageResponse['manifest'] = {
    documentId: snapshot.documentId,
    documentVersionId: snapshot.revisionId,
    documentFamily: snapshot.documentFamily,
    assessmentPackageId: snapshot.packageId,
    assessmentContentHash: snapshot.provenance.assessmentContentHash,
    assessmentAsOf: snapshot.provenance.assessmentAsOf,
    structuredParsePackageId: snapshot.provenance.parserPackageId,
    structuredParsePackageSchemaVersion:
      snapshot.provenance.parserPackageSchemaVersion,
    structuredParseSemanticOutputHash: snapshot.provenance.semanticOutputHash,
    sourceUnitSetId: snapshot.provenance.sourceUnitSetId,
    sourceUnitSetHash: snapshot.provenance.sourceUnitSetHash,
    sourceContractVersion: snapshot.provenance.sourceContractVersion,
    parsedPackage: snapshot.parsedPackage ?? {
      contractKind: 'FEISHU_NATIVE_STRUCTURED_PARSE_PACKAGE',
      schemaVersion: snapshot.provenance.parserPackageSchemaVersion
        ?? 'wiselink.v3_1.feishu_native.structured_parse_package.v1',
      contractRevision: 'v1',
      packageId: snapshot.provenance.parserPackageId,
      contentHash: snapshot.provenance.parserPackageContentHash
        ?? snapshot.provenance.semanticOutputHash,
      semanticHash: snapshot.provenance.semanticOutputHash,
      provenanceHash: null,
      coverageHash: null,
      artifactRef: 'FEISHU_BASE_STRUCTURED_PARSE_PACKAGE',
      artifactHash: snapshot.provenance.parserArtifactOutputHash
        ?? snapshot.provenance.semanticOutputHash,
      resultStatus: 'PASS',
    },
    jobAidRuleSet: {
      selectedVersion: snapshot.provenance.rulePackVersion,
      activeVersion: snapshot.provenance.rulePackVersion,
      lifecycleStatus:
        snapshot.provenance.criterionSetLifecycleStatus ?? 'ACTIVE',
      useBoundary:
        snapshot.provenance.criterionSetUseBoundary ?? 'FORMAL_ACTIVE',
      sourceHash: snapshot.provenance.rulePackSourceHash,
      criteriaCount: snapshot.provenance.rulePackCriteriaCount,
      criterionSetId: snapshot.provenance.criterionSetId,
      criterionSetHash: snapshot.provenance.criterionSetHash,
      criterionSetMemberIdentityHash:
        snapshot.provenance.criterionSetMemberIdentityHash,
      ruleArtifactRef: snapshot.provenance.ruleArtifactRef,
      ruleArtifactDigest: snapshot.provenance.ruleArtifactDigest,
      ruleArtifactVersion: snapshot.provenance.ruleArtifactVersion,
      sourceJobAidDocumentVersionId:
        snapshot.provenance.sourceJobAidDocumentVersionId,
      sourceJobAidDocumentVersionStatus:
        snapshot.provenance.sourceJobAidDocumentVersionStatus,
      targetCandidateVersion: TARGET_RULE_SET,
      derivationMode: DERIVATION_MODE,
    },
  };
  const currentAssessment: EvaluationContextPackageResponse['currentAssessment'] = {
    packageStatus: snapshot.packageStatus,
    applicabilityOverall: snapshot.applicabilityOverall,
    structuredSummary: snapshot.structuredSummary,
    candidateRecommendation: snapshot.candidateRecommendation,
    counts: snapshot.counts,
  };
  const parsedSourceContext = snapshot.parsedSourceContext;
  const structuredAssessmentContext =
    snapshot.structuredAssessmentContext ?? missingStructuredAssessmentContext();
  const historicalContext: HistoricalAssessmentContext =
    options.historicalContext ?? {
    status: 'MISSING' as const,
    reasonCode: 'HISTORICAL_ASSESSMENTS_NOT_BOUND' as const,
    records: [] as [],
  };
  const knowledgeContext: KnowledgeRetrievalContext =
    options.knowledgeContext ?? {
    status: 'MISSING' as const,
    reasonCode: 'KNOWLEDGE_RETRIEVAL_NOT_BOUND' as const,
    records: [] as [],
  };
  const similarCaseContext: SimilarCaseContext = buildSimilarCaseContext(
    isBoundKnowledgeContext(knowledgeContext) ? knowledgeContext : null,
  );
  const latestInvestigation = options.latestInvestigation ?? null;
  const authorityBoundary = {
    outputAuthorityLevel: 'candidate_only' as const,
    historicalOpinionIsCurrentFact: false as const,
    aiInferenceCreatesFact: false as const,
    documentApplicabilityProvesFleetApplicability: false as const,
    createsEngineerDecision: false as const,
    createsClosureDecision: false as const,
    createsAirworthinessConclusion: false as const,
  };
  const identityPayload = {
    schemaVersion: CONTEXT_SCHEMA,
    manifest,
    currentAssessment,
    ...(parsedSourceContext ? { parsedSourceContext } : {}),
    structuredAssessmentContext,
    evaluationItemSetHash,
    resourceSummary,
    resourceAssessments,
    criterionCards,
    historicalContext: historicalContextIdentity(historicalContext),
    similarCaseContext: similarCaseContextIdentity(similarCaseContext),
    knowledgeContext: knowledgeContextIdentity(knowledgeContext),
    ...(latestInvestigation
      ? { latestInvestigation: investigationIdentity(latestInvestigation) }
      : {}),
    authorityBoundary,
  };
  const contextHash = hashCanonical(identityPayload);
  const contextId = `ECP-${hashDigest(contextHash).slice(0, 24).toUpperCase()}`;
  const contextText = buildContextText({
    contextId,
    contextHash,
    evaluationItemSetHash,
    manifest,
    currentAssessment,
    parsedSourceContext,
    structuredAssessmentContext,
    resourceSummary,
    resourceAssessments,
    criterionCards,
    historicalContext,
    similarCaseContext,
    knowledgeContext,
    latestInvestigation,
  });

  return {
    schemaVersion: CONTEXT_SCHEMA,
    contextId,
    contextHash,
    evaluationItemSetHash,
    manifest,
    currentAssessment,
    ...(parsedSourceContext ? { parsedSourceContext } : {}),
    structuredAssessmentContext,
    resourceSummary,
    resourceAssessments,
    criterionCards,
    historicalContext,
    similarCaseContext,
    knowledgeContext,
    latestInvestigation,
    authorityBoundary,
    latestOverallDraft: null,
    contextText,
  };
}

function toCriterionCard(item: ShadowEvaluationItem): EvaluationContextCriterionCard {
  if (!item.analysis.criterionVersionId || !item.analysis.criterionHash) {
    throw new ConflictException(
      `EVALUATION_CONTEXT_CRITERION_VERSION_MISSING:${item.criterionId}`,
    );
  }
  return {
    evaluationItemId: item.evaluationItemId,
    criterionId: item.criterionId,
    criterionVersionId: item.analysis.criterionVersionId,
    criterionHash: item.analysis.criterionHash,
    sequence: item.sequence,
    stageCode: item.analysis.stageCode,
    stageName: item.analysis.stageName,
    question: item.question,
    predicateResult: item.analysis.predicateResult,
    automationMode: item.analysis.automationMode,
    normativeForce: item.analysis.normativeForce,
    status: item.status,
    candidateConclusion: item.candidateConclusion,
    blocking: item.blocking,
    blockingReason: item.blockingReason,
    missingInformation: item.missingInformation,
    rationale: item.analysis.rationale,
    evidenceRefCount: item.evidenceRefCount,
    sourceEvidenceCandidateCount: item.analysis.sourceEvidenceCandidates.length,
    sourceEvidenceAdoptionCount: item.sourceEvidenceAdoptions.length,
    sourceEvidenceCandidates: [...item.analysis.sourceEvidenceCandidates]
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    sourceEvidenceAdoptions: [...item.sourceEvidenceAdoptions]
      .sort((left, right) => left.patchId.localeCompare(right.patchId)),
    engineerReview: item.engineerReview,
  };
}

function buildResourceAssessment(
  item: ShadowEvaluationItem,
): EvaluationResourceAssessment {
  const sourceCandidateCount = item.analysis.sourceEvidenceCandidates.length;
  const adoptionCount = item.sourceEvidenceAdoptions.length;
  const confirmedReview = isConfirmedReview(item.engineerReview);
  let availabilityStatus: ResourceAvailabilityStatus;

  if (confirmedReview || item.evidenceRefCount > 0) {
    availabilityStatus = 'AVAILABLE_VERIFIED';
  } else if (sourceCandidateCount > 0 || adoptionCount > 0) {
    availabilityStatus = 'AVAILABLE_CANDIDATE';
  } else if (item.analysis.predicateResult === 'FALSE') {
    availabilityStatus = 'NOT_APPLICABLE';
  } else if (
    item.analysis.predicateResult === 'UNKNOWN' ||
    item.missingInformation !== null ||
    item.status === 'EVIDENCE_MISSING' ||
    item.status === 'NOT_STARTED' ||
    item.status === 'NEEDS_REVIEW'
  ) {
    availabilityStatus = 'MISSING';
  } else {
    availabilityStatus = 'AVAILABLE_CANDIDATE';
  }

  const missing = availabilityStatus === 'MISSING';
  return {
    requirementId: `${item.criterionId}-R-COMPAT-001`,
    evaluationItemId: item.evaluationItemId,
    criterionId: item.criterionId,
    resourceType: 'ITEM_DECISION_INPUTS',
    availabilityStatus,
    validationStatus:
      availabilityStatus === 'AVAILABLE_VERIFIED'
        ? 'VALIDATED'
        : availabilityStatus === 'AVAILABLE_CANDIDATE' ||
            availabilityStatus === 'NOT_APPLICABLE'
        ? 'CANDIDATE_ONLY'
        : 'NOT_VALIDATED',
    evidenceRefCount: item.evidenceRefCount,
    sourceEvidenceCandidateCount: sourceCandidateCount,
    sourceEvidenceAdoptionCount: adoptionCount,
    engineerReviewPresent: item.engineerReview !== null,
    missingReason: missing
      ? item.missingInformation ?? item.blockingReason ??
        '当前检查项没有可验证的直接证据、受控输入或工程师确认。'
      : null,
    impact: missing
      ? '该项保持信息不足；整体 AI 可以分析影响，但不得补造缺失事实。'
      : null,
    nextAction: missing
      ? '补充当前版本的受控资料、来源证据或工程师显式判断。'
      : null,
    authorityBoundary: 'candidate_only',
  };
}

function isConfirmedReview(review: EngineerReviewState | null): boolean {
  return review?.decision === 'confirmed_pass' ||
    review?.decision === 'confirmed_fail';
}

function summarizeResources(
  assessments: EvaluationResourceAssessment[],
): Record<ResourceAvailabilityStatus, number> {
  const summary = Object.fromEntries(
    AVAILABILITY_STATUSES.map((status) => [status, 0]),
  ) as Record<ResourceAvailabilityStatus, number>;
  for (const assessment of assessments) {
    summary[assessment.availabilityStatus] += 1;
  }
  return summary;
}

function buildContextText(input: {
  contextId: string;
  contextHash: string;
  evaluationItemSetHash: string;
  manifest: EvaluationContextPackageResponse['manifest'];
  currentAssessment: EvaluationContextPackageResponse['currentAssessment'];
  parsedSourceContext?: EvaluationContextPackageResponse['parsedSourceContext'];
  structuredAssessmentContext:
    EvaluationContextPackageResponse['structuredAssessmentContext'];
  resourceSummary: EvaluationContextPackageResponse['resourceSummary'];
  resourceAssessments: EvaluationResourceAssessment[];
  criterionCards: EvaluationContextCriterionCard[];
  historicalContext: HistoricalAssessmentContext;
  similarCaseContext: SimilarCaseContext;
  knowledgeContext: KnowledgeRetrievalContext;
  latestInvestigation: BoundedInvestigationRunView | null;
}): string {
  const lines: string[] = [
    '# WiseLink V3.1 SB Job Aid 整体评估上下文',
    '',
    '## 不可越过的边界',
    '',
    '- 本上下文只支持生成可复核的工程评估候选，不是批准、放行、合规签署或适航结论。',
    '- 文档中出现 Applicability 文字不等于目标机队适用；缺 FleetFacts/predicates 时必须保持 UNKNOWN。',
    '- 历史意见只能作为 HISTORICAL_OPINION；不得复制为当前事实或工程师确认。',
    '- 来源候选与工程师采纳补丁在转成正式 EvidenceRef 前仍是 candidate_only。',
    '- 可以作工程推断，但必须明确列出事实、推断、假设、限制与可能改变意见的缺口。',
    '',
    '## 精确输入身份',
    '',
    `- Context: ${input.contextId}`,
    `- Context hash: ${input.contextHash}`,
    `- Evaluation item set hash: ${input.evaluationItemSetHash}`,
    `- Document/Revision: ${input.manifest.documentId} / ${input.manifest.documentVersionId}`,
    `- AssessmentPackage: ${input.manifest.assessmentPackageId} / ${input.manifest.assessmentContentHash}`,
    `- StructuredParsePackage: ${input.manifest.structuredParsePackageId} / ${input.manifest.structuredParseSemanticOutputHash}`,
    `- ParsedPackage artifact: ${input.manifest.parsedPackage.artifactRef} / ${input.manifest.parsedPackage.artifactHash}`,
    input.manifest.sourceUnitSetId
      ? `- SourceUnitSet: ${input.manifest.sourceUnitSetId} / ${input.manifest.sourceUnitSetHash}`
      : '- SourceUnitSet: NOT_APPLICABLE_FOR_UNIFIED_PARSED_PACKAGE',
    `- assessmentAsOf: ${input.manifest.assessmentAsOf}`,
    `- Selected Job Aid RuleSet: ${input.manifest.jobAidRuleSet.selectedVersion ?? input.manifest.jobAidRuleSet.activeVersion} / ${input.manifest.jobAidRuleSet.lifecycleStatus ?? 'ACTIVE'} / ${input.manifest.jobAidRuleSet.sourceHash}`,
    `- Resource audit target: ${input.manifest.jobAidRuleSet.targetCandidateVersion} (${input.manifest.jobAidRuleSet.derivationMode}; 未激活)`,
    '',
    '## 当前候选包摘要',
    '',
    `- 状态: ${input.currentAssessment.packageStatus}`,
    `- 适用性: ${input.currentAssessment.applicabilityOverall}`,
    `- 摘要: ${input.currentAssessment.structuredSummary}`,
    `- 当前建议: ${input.currentAssessment.candidateRecommendation}`,
    `- 检查项: ${input.currentAssessment.counts.total}; 未闭合: ${input.currentAssessment.counts.unresolved}; 需人工: ${input.currentAssessment.counts.humanRequired}`,
    `- 资源审计: ${AVAILABILITY_STATUSES.map((status) =>
      `${status}=${input.resourceSummary[status]}`).join('; ')}`,
    '',
    ...formatStructuredAssessmentContext(input.structuredAssessmentContext),
    '',
    ...formatParsedSourceContext(input.parsedSourceContext),
    '',
    ...formatHistoricalContext(input.historicalContext),
    '',
    ...formatKnowledgeContext(input.knowledgeContext, input.similarCaseContext),
    '',
    ...formatInvestigationContext(input.latestInvestigation),
    '',
    `## ${input.manifest.jobAidRuleSet.criteriaCount} 项逐项上下文`,
    '',
  ];

  const assessmentByItem = new Map(
    input.resourceAssessments.map((assessment) => [
      assessment.evaluationItemId,
      assessment,
    ]),
  );
  for (const card of input.criterionCards) {
    const resource = assessmentByItem.get(card.evaluationItemId);
    if (!resource) {
      throw new ConflictException(
        `EVALUATION_CONTEXT_RESOURCE_MISSING:${card.evaluationItemId}`,
      );
    }
    lines.push(
      `### ${card.sequence}. ${card.criterionId} — ${card.question}`,
      '',
      `- 阶段: ${card.stageCode} / ${card.stageName}`,
      `- 谓词/状态/候选: ${card.predicateResult} / ${card.status} / ${card.candidateConclusion}`,
      `- 规范强度/执行形态: ${card.normativeForce} / ${card.automationMode}`,
      `- 阻断: ${card.blocking ? '是' : '否'}${card.blockingReason ? `；${card.blockingReason}` : ''}`,
      `- 缺失: ${card.missingInformation ?? '无明确记录'}`,
      `- 候选理由: ${card.rationale ?? '未形成'}`,
      `- 资源可得性: ${resource.availabilityStatus} / ${resource.validationStatus}`,
      `- EvidenceRef=${card.evidenceRefCount}; 来源候选=${card.sourceEvidenceCandidateCount}; 采纳补丁=${card.sourceEvidenceAdoptionCount}`,
      `- 工程师动作: ${formatEngineerReview(card.engineerReview)}`,
    );
    if (resource.missingReason) lines.push(`- 缺失原因: ${resource.missingReason}`);
    if (resource.impact) lines.push(`- 缺失影响: ${resource.impact}`);
    if (resource.nextAction) lines.push(`- 下一动作: ${resource.nextAction}`);
    for (const candidate of card.sourceEvidenceCandidates) {
      lines.push(formatSourceCandidate(candidate));
    }
    for (const adoption of card.sourceEvidenceAdoptions) {
      lines.push(
        `- 来源采纳补丁（仍非 EvidenceRef）: ${adoption.patchId}; ` +
          `候选=${adoption.candidateIds.join(',')}; 说明=${adoption.comment}`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## 当前未绑定的上下文',
    '',
    input.historicalContext.reasonCode === 'HISTORICAL_ASSESSMENTS_NOT_BOUND'
      ? '- 历史评估意见: MISSING / HISTORICAL_ASSESSMENTS_NOT_BOUND'
      : '- 历史评估意见: 已在上文按版本化历史上下文列出',
    isBoundSimilarCaseContext(input.similarCaseContext)
      ? '- 类似文件与案例: 已在上文按版本化候选列出'
      : '- 类似文件与案例: MISSING / SIMILAR_CASES_NOT_BOUND',
    isBoundKnowledgeContext(input.knowledgeContext)
      ? '- 知识空间检索: 已在上文按版本化候选列出'
      : '- 知识空间检索: MISSING / KNOWLEDGE_RETRIEVAL_NOT_BOUND',
  );
  return lines.join('\n');
}

function formatParsedSourceContext(
  context: EvaluationContextPackageResponse['parsedSourceContext'],
): string[] {
  const lines = ['## Unified Parsed Package 逐页来源上下文', ''];
  if (!context) {
    lines.push(
      '- 状态: MISSING / PARSED_SOURCE_CONTEXT_NOT_BOUND',
      '- 整体 AI 不得以缺失来源正文为理由补造文档事实。',
    );
    return lines;
  }
  lines.push(
    `- 状态: ${context.status}; parser result=${context.resultStatus}; ` +
      `pages=${context.pageCount}; contextHash=${context.contextHash}`,
    '- 以下是来源绑定候选正文，不是 FleetFact、EvidenceRef 或工程师确认。',
  );
  for (const page of context.sourcePages) {
    lines.push(
      '',
      `### 来源页 ${page.pageStart}`,
      '',
      `- SourceRef: ${page.sourceRefId}`,
      `- Artifact: ${page.artifactRef}`,
      `- Anchor hash: ${page.anchorTextHash}`,
      '',
      page.quote,
    );
  }
  return lines;
}

function formatStructuredAssessmentContext(
  context: EvaluationContextPackageResponse['structuredAssessmentContext'],
): string[] {
  const lines = [
    '## 解析侧受控工程上下文',
    '',
    `- Applicability 原文: ${context.applicability.availability}`,
    '- 语义边界: 文档中的 Applicability 原文不等于目标机队适用；缺 FleetFacts/predicates 时仍为 UNKNOWN。',
    `- Concurrent Requirements: ${context.concurrentRequirements.availability}; ` +
      `条目=${context.concurrentRequirements.entries.length}`,
    `- Work Instructions: ${context.workInstructions.availability}; ` +
      `步骤=${context.workInstructions.stepCount}; ` +
      `IDs=${context.workInstructions.stepIds.join('/') || 'MISSING'}`,
    '- 以上均为 source-bounded parser candidate；不能创建 FleetFact、EvidenceRef 或工程师决定。',
  ];
  if (context.applicability.rawText) {
    lines.push('', '### Applicability 原文（非机队结论）', '', context.applicability.rawText);
  }
  for (const entry of context.concurrentRequirements.entries) {
    lines.push(
      '',
      `### Concurrent Requirement ${entry.source.structurePath}`,
      '',
      `- state=${entry.requirementState}; presence=${entry.normalizedPresence}; ` +
        `requirementsStructured=${entry.requirementsStructured}; ` +
        `document=${entry.requirementsStructured ? entry.documentRequirements.join(',') || 'none' : 'NOT_STRUCTURED'}; ` +
        `nonDocument=${entry.requirementsStructured ? entry.nonDocumentRequirements.join(',') || 'none' : 'NOT_STRUCTURED'}; ` +
        `retrievalLoop=${String(entry.retrievalEvaluationLoopRequired)}`,
      `- raw=${entry.rawText ?? 'MISSING'}`,
    );
  }
  for (const step of context.workInstructions.steps) {
    lines.push(
      '',
      `### ${step.stepId} — ${step.instructionText}`,
      '',
      `- Source stepPath: ${step.stepPath}`,
      `- Work Package: ${step.workPackageLabel ?? step.workPackageNumber ?? 'MISSING'} / ` +
        `${step.workPackageTitle ?? 'MISSING'}`,
      `- Source page: ${step.sourcePage ?? 'MISSING'}; object=${step.source.objectId}; hash=${step.source.objectHash}`,
    );
  }
  return lines;
}

function investigationIdentity(
  run: BoundedInvestigationRunView | null,
): Record<string, unknown> | null {
  if (!run) return null;
  return {
    runId: run.runId,
    runHash: run.runHash,
    evaluationContextId: run.evaluationContextId,
    evaluationContextHash: run.evaluationContextHash,
    evaluationItemSetHash: run.evaluationItemSetHash,
    planId: run.planId,
    planHash: run.planHash,
    status: run.status,
    stopReason: run.stopReason,
    questionStates: run.questions.map((question) => ({
      questionId: question.questionId,
      status: question.status,
      resolutionSummary: question.resolutionSummary,
      assumptions: question.assumptions,
      nextAction: question.nextAction,
    })),
    toolSnapshots: run.toolSnapshots.map((snapshot) => ({
      toolCallId: snapshot.toolCallId,
      status: snapshot.status,
      inputHash: snapshot.inputHash,
      resultHash: snapshot.resultHash,
      resultClassification: snapshot.resultClassification,
    })),
    modelCapabilityId: run.modelCapabilityId,
    modelPluginVersion: run.modelPluginVersion,
    modelId: run.modelId,
    runtimeModelIdentity: run.runtimeModelIdentity,
    modelIdentityStatus: run.modelIdentityStatus,
    promptIdentity: run.promptIdentity,
    authorityLevel: run.authorityLevel,
  };
}

function formatInvestigationContext(
  run: BoundedInvestigationRunView | null,
): string[] {
  const lines = ['## 宏观有界调查', ''];
  if (!run) {
    lines.push(
      '- 状态: MISSING / BOUNDED_INVESTIGATION_NOT_RUN',
      '- 未运行不阻止整体 AI 分析已有上下文，但必须保留当前未知和人工补证要求。',
    );
    return lines;
  }
  lines.push(
    `- Run: ${run.runId} / ${run.runHash}`,
    `- 状态/停止原因: ${run.status} / ${run.stopReason}`,
    `- 绑定旧上下文: ${run.evaluationContextId} / ${run.evaluationContextHash}`,
    `- 模型: @official-plugins/ai-text-generate@${run.modelPluginVersion}; modelID=${run.modelId}; ${run.modelIdentityStatus}`,
    `- 执行面: ${run.executionPlane}; Aily runtime verified=${run.ailyRuntimeVerified}`,
    '- 权威边界: candidate_only；调查不能创建 FleetFacts、EvidenceRef、工程师确认或适用性结论。',
    '',
    '### Material Questions',
    '',
  );
  for (const question of run.questions) {
    lines.push(
      `- ${question.questionId} / ${question.status}: ${question.question}`,
      `  - 当前说明: ${question.resolutionSummary}`,
      `  - 假设: ${question.assumptions.join('；') || '无'}`,
      `  - 下一动作: ${question.nextAction}`,
    );
  }
  lines.push('', '### 工具快照', '');
  for (const snapshot of run.toolSnapshots) {
    lines.push(
      `- ${snapshot.toolCallId} / ${snapshot.toolId} / ${snapshot.status}: ` +
        `${snapshot.resultClassification}; input=${snapshot.inputHash}; result=${snapshot.resultHash}`,
    );
  }
  lines.push('', '### AI 候选调查说明', '', run.investigationNarrative);
  return lines;
}

function knowledgeContextIdentity(
  context: KnowledgeRetrievalContext,
): KnowledgeRetrievalContext | Record<string, unknown> {
  if (!isBoundKnowledgeContext(context)) return context;
  return {
    schemaVersion: context.schemaVersion,
    contextId: context.contextId,
    contextHash: context.contextHash,
    status: context.status,
    reasonCode: context.reasonCode,
  };
}

function similarCaseContextIdentity(
  context: SimilarCaseContext,
): SimilarCaseContext | Record<string, unknown> {
  if (!isBoundSimilarCaseContext(context)) return context;
  return {
    schemaVersion: context.schemaVersion,
    contextId: context.contextId,
    contextHash: context.contextHash,
    status: context.status,
    reasonCode: context.reasonCode,
  };
}

function formatKnowledgeContext(
  context: KnowledgeRetrievalContext,
  similarCaseContext: SimilarCaseContext,
): string[] {
  const lines = [
    '## 类似案例与知识候选',
    '',
  ];
  if (!isBoundKnowledgeContext(context)) {
    lines.push(
      '- 状态: MISSING / KNOWLEDGE_RETRIEVAL_NOT_BOUND',
      '- 未绑定可复现的知识读取结果；禁止假设知识库已经检索或资料不存在。',
    );
    return lines;
  }
  lines.push(
    `- 状态: ${context.status} / ${context.reasonCode}`,
    `- Knowledge Context: ${context.contextId} / ${context.contextHash}`,
    `- 检索词: ${context.query}`,
    `- 请求知识空间: ${context.requestedKnowledgeSpaceIds.join(', ') || 'NOT_APPLICABLE'}`,
    context.records.some((record) => record.sourceSystem === 'DOCUMENT_MANAGEMENT')
      ? '- 外部资料边界: 仅列出经 Document Management 复核采纳的 exact DocumentVersion/ParsedPackage/SourceUnit 引用；检索 snippet 未进入上下文。'
      : '- 空间归属边界: 当前 Drive Search 结果不能证明文件属于所请求 Aily 知识空间；membership=UNCONFIRMED。',
    '- 权威边界: KNOWLEDGE_CANDIDATE_REFERENCE_ONLY；不是当前机队事实、EvidenceRef、适用性或工程师确认。',
  );
  if (isBoundSimilarCaseContext(similarCaseContext)) {
    lines.push(
      `- Similar Case Context: ${similarCaseContext.contextId} / ${similarCaseContext.contextHash}`,
    );
  }
  for (const warning of context.versionWarnings) {
    lines.push(`- 版本/来源缺口: ${warning}`);
  }
  for (const record of context.records) {
    if (record.sourceSystem === 'DOCUMENT_MANAGEMENT') {
      lines.push(
        '',
        `### 外部 OEM 资料 ${record.documentNumber}`,
        '',
        `- Candidate: ${record.candidateId} / ${record.candidateHash}`,
        `- Provider/DocumentVersion: ${record.provider} / ${record.externalDocumentId} / ${record.externalDocumentVersionId}`,
        `- 原件: ${record.artifactRef}; bytes=${record.sourceFileSizeBytes}; sha256=${record.sourceFileByteHash}`,
        `- ParsedPackage: ${record.parsedPackageId}; artifact=${record.parsedPackageArtifactRef}; semantic=${record.parsedPackageSemanticHash}`,
        `- 文档版次/currentness: ${record.revisionLabel} / ${record.sourceCurrentnessStatus}`,
        `- 采纳回执: ${record.adoptionDecisionRef}`,
        `- 关系: ${record.relationshipLevel}; ${record.relationshipReason}`,
        '- 权威边界: 该资料是带来源的评估参考，不是当前机队事实、适用性结论、工程批准或关闭决定。',
      );
      for (const locator of record.locators) {
        lines.push(
          `- SourceUnit: ${locator.sourceUnitId} / ${locator.sourceUnitHash}; locator=${JSON.stringify(locator.locator)}; locatorHash=${locator.locatorHash}`,
        );
      }
      continue;
    }
    lines.push(
      '',
      `### 知识候选 ${record.documentNumber}`,
      '',
      `- Candidate: ${record.candidateId} / ${record.candidateHash}`,
      `- 文件: ${record.sourceTitle}; token=${record.sourceFileToken}; version=${record.sourceFileVersion}; bytes=${record.sourceFileByteHash}`,
      `- 文档版次: ${record.revisionLabel ?? 'VERSION_UNCONFIRMED'} / ${record.revisionStatus}`,
      `- currentness: ${record.sourceCurrentnessStatus}`,
      `- 关系: ${record.relationshipLevel}; ${record.relationshipReason}`,
      '- 特别语义边界: FTD 里程碑中的 Complete 描述公告/Revision 发布里程碑，不证明目标飞机已经完成改装或软件升级。',
    );
    for (const locator of record.locators) {
      lines.push(
        `- 来源定位: p.${locator.pageStart}-${locator.pageEnd} / ${locator.section} / “${locator.excerpt}”`,
      );
    }
    for (const claim of record.extractedClaims) {
      lines.push(`- 候选信息（非当前事实）: ${claim}`);
    }
  }
  return lines;
}

function historicalContextIdentity(
  context: HistoricalAssessmentContext,
): HistoricalAssessmentContext | Record<string, unknown> {
  if (!isBoundHistoricalContext(context)) return context;
  return {
    schemaVersion: context.schemaVersion,
    contextId: context.contextId,
    contextHash: context.contextHash,
    status: context.status,
    reasonCode: context.reasonCode,
  };
}

function formatHistoricalContext(
  context: HistoricalAssessmentContext,
): string[] {
  const lines = [
    '## 历史评估上下文',
    '',
    `- 状态: ${context.status} / ${context.reasonCode}`,
    '- 权威边界: HISTORICAL_OPINION / CONTEXT_ONLY；不是当前事实、当前适用性或工程师确认。',
  ];
  if (!isBoundHistoricalContext(context)) {
    lines.push('- 未绑定任何历史读取结果；禁止假设历史意见存在。');
    return lines;
  }
  lines.push(
    `- 历史上下文: ${context.contextId} / ${context.contextHash}`,
    `- 查询文档号: ${context.queryDocumentNumber}`,
    `- 当前目标版次: ${context.targetRevisionLabel ?? 'VERSION_UNCONFIRMED'}`,
  );
  for (const attempt of context.readAttempts) {
    lines.push(
      `- 读取尝试: ${attempt.attemptId}; ${attempt.resultStatus}; ` +
        `reason=${attempt.reasonCode}; operation=${attempt.operationId}; ` +
        `currentness=${attempt.currentnessStatus ?? 'UNCONFIRMED'}; ` +
        `verified=${attempt.readbackVerified}; complete=${attempt.readbackComplete}`,
    );
  }
  for (const warning of context.versionWarnings) {
    lines.push(`- 版本缺口: ${warning}`);
  }
  if (context.status === 'MISSING') {
    lines.push(
      '- 缺失语义边界: 本次只读操作在指定查询范围和时间未读回匹配记录；' +
        '不得据此声称该文件从未被评估、从未被处理、不存在历史版本或不存在其他系统记录。',
    );
  }
  for (const record of context.records) {
    const snapshot = record.snapshot;
    lines.push(
      '',
      `### 历史评估 ${snapshot.assessmentNumber}`,
      '',
      `- 关系: ${record.relationshipLevel}; ${record.relationshipReason}`,
      `- Snapshot: ${snapshot.snapshotId} / ${snapshot.snapshotHash}`,
      `- 历史文档: ${snapshot.documentNumber} / ` +
        `${snapshot.documentRevisionLabel ?? 'VERSION_UNCONFIRMED'}; ` +
        `hash=${snapshot.documentHash ?? 'VERSION_UNCONFIRMED'}`,
      `- 历史评估单版本/状态: ` +
        `${snapshot.assessmentVersion ?? 'VERSION_UNCONFIRMED'} / ` +
        `${snapshot.assessmentState ?? 'UNCONFIRMED'}`,
      `- 历史评估单版本确认状态: ${snapshot.assessmentVersionStatus}`,
      `- 历史文档版本确认状态: ${snapshot.documentVersionStatus}`,
      `- 历史文档哈希确认状态: ${snapshot.documentHashStatus}`,
      `- Job Aid/RuleSet: ${snapshot.jobAidVersion ?? 'VERSION_UNCONFIRMED'} / ` +
        `${snapshot.ruleSetVersion ?? 'VERSION_UNCONFIRMED'}`,
      `- Job Aid 版本确认状态: ${snapshot.jobAidVersionStatus}`,
      `- 历史来源 currentness: ${snapshot.sourceCurrentnessStatus ?? 'UNCONFIRMED'}`,
      `- 历史结论（仅上下文）: ${snapshot.conclusion ?? '未读回'}`,
      `- 历史意见模型投影（仅上下文）: ` +
        `${formatHistoricalOpinionForModel(
          snapshot.opinion,
          snapshot.conclusion,
        )}`,
      '- 历史意见原文保留策略: 原文完整显示在工程师工作台；若原文同时包含“发布”和“进行升级”，整体模型只消费上面的动作状态投影，避免把文件发布误读为实施完成。',
      '- 动作状态护栏: “发布/拟/计划/要求执行”不等于“已执行/已完成/已关闭”；' +
        '除非当前受控完成记录明确证明，不得升级动作状态。',
    );
  }
  return lines;
}

function formatHistoricalOpinionForModel(
  opinion: string | null,
  conclusion: string | null,
): string {
  if (!opinion) return '未读回';
  if (!/AEO/iu.test(opinion) || !/发布/u.test(opinion)) return opinion;
  const aeoIds = [...new Set(
    opinion.match(/AEO-[A-Z0-9-]+/giu) ?? ['AEO_ID_UNCONFIRMED'],
  )];
  const intendedScope =
    opinion.match(/全部[^，。；\n]{0,32}飞机/u)?.[0] ?? 'SCOPE_UNCONFIRMED';
  return [
    `historicalAeo=${aeoIds.join(',')}`,
    'documentStatus=PUBLISHED',
    `intendedScope=${intendedScope}`,
    'intendedAction=ONS 9.1升级',
    'executionStatus=UNCONFIRMED',
    'completionStatus=UNCONFIRMED',
    `historicalDisposition=${conclusion ?? 'UNCONFIRMED'}`,
    '该投影仅保留历史意见的动作状态语义，不是当前事实。',
  ].join('; ');
}

function isBoundHistoricalContext(
  context: HistoricalAssessmentContext,
): context is Extract<HistoricalAssessmentContext, { contextHash: string }> {
  return 'contextHash' in context;
}

function isBoundKnowledgeContext(
  context: KnowledgeRetrievalContext,
): context is Extract<KnowledgeRetrievalContext, { contextHash: string }> {
  return 'contextHash' in context;
}

function isBoundSimilarCaseContext(
  context: SimilarCaseContext,
): context is Extract<SimilarCaseContext, { contextHash: string }> {
  return 'contextHash' in context;
}

function formatEngineerReview(review: EngineerReviewState | null): string {
  if (!review) return '无';
  return `${review.decision} / ${review.status}; 评语=${review.comment}; ` +
    `更新时间=${review.updatedAt}`;
}

function formatSourceCandidate(candidate: ShadowSourceEvidenceCandidate): string {
  const refs = candidate.sourceRefs.map((ref) => {
    const pages = `${candidate.pageRange.startPage}-${candidate.pageRange.endPage}`;
    return `${ref.sourceUnitId}@页${pages}` +
      `${ref.anchorPreview ? `：“${ref.anchorPreview}”` : ''}`;
  }).join('；');
  return `- 来源候选（candidate_only）: ${candidate.candidateId}; ` +
    `字段=${candidate.fieldPath}; ${refs}`;
}

function compareItems(left: ShadowEvaluationItem, right: ShadowEvaluationItem): number {
  return left.sequence - right.sequence ||
    left.criterionId.localeCompare(right.criterionId) ||
    left.evaluationItemId.localeCompare(right.evaluationItemId);
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function hashDigest(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice(7) : hash;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
