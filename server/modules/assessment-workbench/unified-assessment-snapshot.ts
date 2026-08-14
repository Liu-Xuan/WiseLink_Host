import type {
  SbJobAidShadowSnapshotResponse,
  ShadowCandidateConclusion,
  ShadowEvaluationItem,
  ShadowEvaluationStatus,
  StructuredAssessmentContext,
} from '@shared/assessment-host.interface';

export function buildUnifiedAssessmentSnapshot(
  assessmentPackage: Record<string, any>,
): SbJobAidShadowSnapshotResponse {
  if (assessmentPackage?.schemaVersion
      !== 'wiselink.v3_1.sb_job_aid_assessment_package.v4'
    || assessmentPackage.outputAuthorityLevel !== 'candidate_only'
    || !assessmentPackage.unifiedParsedPackageBinding
    || assessmentPackage.sourceUnitSetBinding !== null) {
    throw new Error('UNIFIED_ASSESSMENT_PACKAGE_NOT_CONSUMABLE');
  }
  const expectedCount = Number(assessmentPackage.rulePackBinding?.criteriaCount);
  if (!Number.isInteger(expectedCount) || expectedCount < 1
    || assessmentPackage.evaluationItems.length !== expectedCount) {
    throw new Error('UNIFIED_ASSESSMENT_CRITERION_SET_COVERAGE_INVALID');
  }
  const items = assessmentPackage.evaluationItems.map(mapItem);
  const counts = {
    total: items.length,
    unresolved: items.filter((item: ShadowEvaluationItem) =>
      !['AI_DRAFT', 'CANDIDATE_FAIL'].includes(item.status)).length,
    humanRequired: items.filter((item: ShadowEvaluationItem) =>
      item.analysis.automationMode === 'HUMAN_REQUIRED').length,
    byStatus: countStatuses(items),
    byConclusion: countConclusions(items),
  };
  const parsed = assessmentPackage.unifiedParsedPackageBinding;
  const rule = assessmentPackage.rulePackBinding;
  const identity = assessmentPackage.documentIdentity;
  const generatedAt = String(assessmentPackage.generatedAt);
  const parsedSourceContext = assessmentPackage.parsedSourceContext;
  if (!parsedSourceContext
    || parsedSourceContext.schemaVersion
      !== 'wiselink.v3_1.sb_job_aid.parsed_source_context.v1'
    || parsedSourceContext.status !== 'AVAILABLE_CANDIDATE'
    || parsedSourceContext.pageCount !== parsedSourceContext.sourcePages?.length) {
    throw new Error('UNIFIED_ASSESSMENT_PARSED_SOURCE_CONTEXT_INVALID');
  }
  return {
    snapshotId: `local-unified:${assessmentPackage.packageId}`,
    projectionSchemaVersion:
      'wiselink.v3_1.sb_job_aid.unified_assessment_snapshot.v1',
    documentId: identity.documentId,
    revisionId: identity.revisionId,
    documentFamily: 'SB',
    packageId: assessmentPackage.packageId,
    packageStatus: assessmentPackage.status,
    packageVersion: 'UNIFIED-FROZEN-2-LOCAL-VERTICAL',
    applicabilityOverall:
      assessmentPackage.assessmentPayload.applicability.overall,
    structuredSummary:
      `Job Aid ${rule.schemaVersion} exact CriterionSet ${rule.criteriaCount} 项；` +
      `Unified Parsed Package=${parsed.resultStatus}；未闭合 ${counts.unresolved} 项。`,
    candidateRecommendation:
      '继续生成 candidate_only 整体草稿；缺失 FleetFacts、受控谓词和工程证据的判断保持 UNKNOWN/WAITING_INPUT。',
    runId: `LOCAL-RUN-${assessmentPackage.packageId}`,
    runStatus: 'WAITING_INPUT',
    eventId: `LOCAL-EVT-${assessmentPackage.packageId}`,
    eventStatus: 'IGNORED',
    counts,
    provenance: {
      baseToken: 'LOCAL_VERTICAL_NO_BASE_WRITE',
      assessmentPackagesTableId: 'NOT_WRITTEN',
      assessmentPackageRecordId: 'NOT_WRITTEN',
      evaluationItemsTableId: 'NOT_WRITTEN',
      capabilityRunsTableId: 'NOT_WRITTEN',
      capabilityRunRecordId: 'NOT_WRITTEN',
      domainEventsTableId: 'NOT_WRITTEN',
      domainEventRecordId: 'NOT_WRITTEN',
      assessmentContentHash: assessmentPackage.contentHash,
      upstreamFingerprint: assessmentPackage.upstreamFingerprint,
      parserPackageId: parsed.packageId,
      parserPackageSchemaVersion: 'techpub.parsed-package.v1',
      parserPackageContentHash: parsed.packageContentHash,
      parserQualityGateStatus: parsed.resultStatus === 'complete'
        ? 'PASS'
        : 'PARTIAL_SOURCE_PRESERVED',
      parserCurrentness: 'current',
      parserArtifactOutputHash: parsed.artifactHash,
      semanticOutputHash: parsed.packageSemanticHash,
      semanticHashPolicySchema: 'techpub.parsed-package.v1/frozen.2',
      sourceUnitSetId: null,
      sourceUnitSetHash: null,
      specManifestId: 'wiselink.unified-service.pdf-to-techpub.v1',
      sourceContractVersion: 'techpub.parsed-package.v1/frozen.2',
      assessmentAsOf: assessmentPackage.assessmentAsOf,
      rulePackVersion: rule.schemaVersion,
      rulePackSourceHash: rule.sourceHash,
      rulePackCriteriaCount: rule.criteriaCount,
      criterionSetLifecycleStatus: rule.criterionSetLifecycleStatus,
      criterionSetUseBoundary: rule.criterionSetLifecycleStatus === 'ACTIVE'
        ? 'FORMAL_ACTIVE'
        : 'DEVELOPMENT_VALIDATION',
      criterionSetId: rule.criterionSetId,
      criterionSetHash: rule.criterionSetHash,
      criterionSetMemberIdentityHash: rule.criterionSetMemberIdentityHash,
      ruleArtifactRef: rule.ruleArtifactRef,
      ruleArtifactDigest: rule.ruleArtifactDigest,
      ruleArtifactVersion: rule.ruleArtifactVersion,
      sourceJobAidDocumentVersionId:
        rule.sourceJobAidDocumentVersion.documentVersionId,
      sourceJobAidDocumentVersionStatus:
        rule.sourceJobAidDocumentVersion.status,
      readbackVerifiedAt: generatedAt,
      importedAt: generatedAt,
    },
    authorityBoundary: {
      runMode: 'SHADOW',
      datasetSplit: 'VALIDATION',
      isCurrent: false,
      outputAuthorityLevel: 'candidate_only',
      eventRoutable: false,
      createsEvidenceRef: false,
      writesEngineerDecision: false,
      writesEngineerConfirmation: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      publishesResult: false,
    },
    parsedPackage: {
      contractKind: 'UNIFIED_PARSED_PACKAGE',
      schemaVersion: 'techpub.parsed-package.v1',
      contractRevision: parsed.contractRevision,
      packageId: parsed.packageId,
      contentHash: parsed.packageContentHash,
      semanticHash: parsed.packageSemanticHash,
      provenanceHash: parsed.packageProvenanceHash,
      coverageHash: parsed.packageCoverageHash,
      artifactRef: parsed.artifactRef,
      artifactHash: parsed.artifactHash,
      resultStatus: parsed.resultStatus,
    },
    parsedSourceContext,
    structuredAssessmentContext: missingUnifiedStructuredContext(),
    items,
  };
}

function mapItem(item: Record<string, any>): ShadowEvaluationItem {
  const status = mapStatus(item.status, item.decision);
  return {
    evaluationItemId: `${item.criterion_id}:${item.criterion_version_id}`,
    criterionId: item.criterion_id,
    sequence: item.global_sequence,
    question: item.evaluation_question,
    status,
    candidateConclusion: mapConclusion(item.decision),
    blocking: item.blocking_condition_met === true,
    blockingReason: item.blocking_condition_met === true
      ? `${item.blocker}: ${item.rationale ?? item.applicability_rationale}`
      : null,
    missingInformation: buildMissing(item),
    aiConfidence: Number.isFinite(item.confidence) ? item.confidence : null,
    evidenceRefCount: item.evidence_refs?.length ?? 0,
    sourceEvidenceAdoptions: [],
    engineerReview: null,
    analysis: {
      criterionVersionId: item.criterion_version_id,
      criterionHash: item.criterion_hash,
      stageCode: item.stage_code,
      stageName: item.stage_name,
      criterionName: item.criterion_name,
      predicateResult: item.predicate_result,
      automationMode: item.automation_mode,
      normativeForce: item.normative_force,
      rationale: item.rationale,
      sourceLocatorCandidates: item.source_locator_candidates,
      sourceLocatorCandidatesAreEvidenceRefs: false,
      sourceEvidenceCandidates: item.source_evidence_candidates,
      sourceEvidenceCandidatesAreEvidenceRefs: false,
    },
  };
}

function mapStatus(status: string, decision: string | null): ShadowEvaluationStatus {
  if (status === '候选符合') return 'CANDIDATE_PASS';
  if (status === '已确认' && decision === '不符合') return 'CANDIDATE_FAIL';
  if (status === '不适用') return 'AI_DRAFT';
  if (status === '需人工复核') return 'NEEDS_REVIEW';
  if (status === '待评估') return 'NOT_STARTED';
  return 'EVIDENCE_MISSING';
}

function mapConclusion(value: string | null): ShadowCandidateConclusion {
  if (value === '符合') return 'pass';
  if (value === '不符合') return 'fail';
  if (value === '不适用') return 'not_applicable';
  if (value === '需人工判断' || value === '冲突') return 'conditional';
  return 'insufficient_data';
}

function buildMissing(item: Record<string, any>): string | null {
  const parts = [];
  if (item.missing_predicate_inputs?.length) {
    parts.push(`缺少谓词输入：${item.missing_predicate_inputs.join('、')}`);
  }
  const evidence = (item.evidence_requirements ?? [])
    .filter((entry: Record<string, unknown>) => entry.status !== 'RESOLVED')
    .map((entry: Record<string, unknown>) => entry.requirement);
  if (evidence.length) parts.push(`待补证据：${evidence.join('；')}`);
  return parts.join('\n') || null;
}

function countStatuses(items: ShadowEvaluationItem[]) {
  const counts: Record<ShadowEvaluationStatus, number> = {
    NOT_STARTED: 0,
    EVIDENCE_MISSING: 0,
    AI_DRAFT: 0,
    NEEDS_REVIEW: 0,
    CANDIDATE_PASS: 0,
    CANDIDATE_FAIL: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

function countConclusions(items: ShadowEvaluationItem[]) {
  const counts: Record<ShadowCandidateConclusion, number> = {
    pass: 0,
    fail: 0,
    not_applicable: 0,
    insufficient_data: 0,
    conditional: 0,
  };
  for (const item of items) counts[item.candidateConclusion] += 1;
  return counts;
}

function missingUnifiedStructuredContext(): StructuredAssessmentContext {
  return {
    schemaVersion: 'wiselink.v3_1.sb_job_aid.structured_assessment_context.v1',
    applicability: { availability: 'MISSING', rawText: null, source: null },
    concurrentRequirements: { availability: 'MISSING', entries: [] },
    workInstructions: {
      availability: 'MISSING', stepCount: 0, stepIds: [], steps: [],
    },
    authorityBoundary: {
      sourceBoundParserCandidateOnly: true,
      documentApplicabilityProvesFleetApplicability: false,
      createsFleetFact: false,
      createsEvidenceRef: false,
      createsEngineerDecision: false,
    },
  };
}
