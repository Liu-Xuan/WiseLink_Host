import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { libraryDocuments, libraryQuicklook } from './canonical-library';
import { summaryKnowledge } from './derived-summary';
import { jobAidReadingFixture } from '../semantic-reading-ui.fixtures';
import { originalFixture } from '../document-parsing/fixtures/document-original.fixture';
import { referenceUiPreview, reviewUiTurn } from './review-ui';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';

/** Synthetic only: no user document, private screenshot identity, or live endpoint. */
export const assessmentFixtureIdentity = { documentVersionId: 'DV-FAM-1', workItemId: 'WI-OLD', familyId: 'FAM' };
export function assessmentWorkingFixture() {
  const work = jobAidReadingFixture();
  work.workItemId = 'WI-OLD';
  work.current!.workItemId = 'WI-OLD'; work.current!.documentVersionId = 'DV-FAM-1';
  const source = work.current!.content.evidence[0];
  if (source.kind !== 'DOCUMENT_PASSAGE') throw new Error('Synthetic source fixture required');
  work.current!.content.evidence[0] = { ...source, workItemId: 'WI-OLD', documentVersionId: 'DV-FAM-1',
    locator: JSON.stringify({ parseRunId: 'PR-HISTORIC', sourceRefId: 'source-ref-test' }) };
  work.overallStatus = 'CURRENT'; work.overallBasedOnWorkRevisionRef = work.current!.workRevisionRef;
  return work;
}
export function assessmentAssociationFixture(result = true) {
  const value = libraryQuicklook('WI-OLD');
  value.document = { ...value.document, documentVersionId: 'DV-FAM-1', familyId: 'FAM', documentCode: 'SYNTHETIC-SB-01' };
  value.result = result ? { ...value.result!, sourceResultId: 'work-current-test', revision: 3, jobAidRoundCompletion: 'IN_PROGRESS',
    readingResult: jobAidReadingResult(assessmentWorkingFixture().current!) } : null;
  return value;
}
export function assessmentWikiFixture() {
  const knowledge = summaryKnowledge();
  knowledge.entry = { ...knowledge.entry, subjectId: 'WI-OLD', workRef: 'work-current-test', workRevision: 3 };
  knowledge.reading = jobAidReadingResult(assessmentWorkingFixture().current!);
  return knowledge;
}
export function assessmentStatusFixture(run = 'PR1') {
  return { documentVersionId: 'DV-FAM-1', familyId: 'FAM', documentCode: 'SYNTHETIC-SB-01',
    documentTitle: '合成资料 · 构型核对与措施评估', normalizedFamily: 'SB', issuerAuthority: 'SYNTHETIC',
    businessRevision: 'R1', revisionDate: '', sourceGeneratedDate: '', selectedVersionIsCurrent: true,
    originalFilename: 'synthetic.pdf', runtimeAvailable: true, runtime: { state: 'CALL_SUCCEEDED' },
    latestRun: null, publishedRun: { parseRunId: run, parseRevision: 7 } };
}
export function assessmentOriginalFixture(run = 'PR1') {
  const original = originalFixture();
  original.source.units[0].sourceRefIds = ['source-ref-test'];
  original.source.sourceLocators[0].sourceRefId = 'source-ref-test';
  original.locations[0].sourceRefId = 'source-ref-test';
  original.binding = { ...original.binding, documentVersionId: 'DV-FAM-1', parseRunId: run };
  return { documentVersionId: 'DV-FAM-1', parseRunId: run, parseRevision: 7, original, markdown: 'Synthetic original', assets: [],
    parser: { name: 'fixture', version: '1' }, titleEnhancement: { status: 'SUCCEEDED' }, projection: {} };
}
export function assessmentPageFixture(revision = 7): CanonicalDocumentParsingPageResponse {
  const artifact = { storeRole: 'UnifiedArtifactStoreCandidate' as const, ref: 'artifact:synthetic-overall', sha256: 'fixture-only', byteLength: 1, mediaType: 'application/json' as const };
  return {
    schemaVersion: 'wiselink.3_1.document_parsing_page.v0.candidate', status: 'FRESH_READ',
    workItem: { schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate', workItemId: 'WI-OLD', requestId: 'fixture-request', revision,
      phase: 'CANDIDATE_READBACK_VERIFIED', permissionSnapshotVersion: 'fixture-permission',
      parseAuthorization: { action: 'PARSE_PDF', actorFingerprint: 'fixture-actor', decisionId: 'fixture-decision', decisionHash: 'fixture-existing', permissionSnapshotVersion: 'fixture-permission' },
      source: { documentId: 'SYNTHETIC-SB-01', documentVersionId: 'DV-FAM-1', parserRequestId: 'fixture-parser', sourceArtifactId: 'fixture-source', sourceFileSha256: 'fixture-source',
        sourceByteLength: 100, driveFileToken: 'fixture-file', driveSourceVersion: 'fixture-version' },
      classification: { status: 'CONFIRMED', normalizedFamily: 'SB', classifierReleaseId: 'fixture', classifierReleaseHash: 'fixture', parserProfileId: 'fixture', parserProfileHash: 'fixture', fingerprint: 'fixture' },
      package: null, assessment: null, aeo: null, failure: null, recordingFailure: null,
      integratedAssessment: { status: 'OVERALL_CANDIDATE_READY', baseRules: { schemaVersion: 'wiselink.legacy-jobaid-result.v1', status: 'CANDIDATE_ONLY', revision: 1, sourceResultId: 'fixture-rules', criterionSetId: 'fixture-rules', criterionCount: 1,
        evaluationItemCount: 1, unresolvedCount: 1, sourceBoundCandidateCount: 1, artifact, actionAttemptId: 'fixture-attempt' },
        overallSynthesis: { status: 'CANDIDATE_ONLY', revision: 2, sourceResultId: 'fixture-overall', basedOnBaseRuleRevision: 1, basedOnBaseRuleArtifactSha256: 'fixture-only',
          basedOnEngineerReviewRevision: null, basedOnEngineerReviewArtifactSha256: null, discoveryStatus: 'NOT_REQUIRED', gap: '构型仍需核对', candidateRefCount: 1, findingCount: 1, unresolvedCount: 1,
          authorityLevel: 'candidate_only', externalDiscoveryIsEvidence: false, artifact, actionAttemptId: 'fixture-attempt', staleReason: null,
          readingResult: jobAidReadingResult(assessmentWorkingFixture().current!), basedOnJobAidWorkRevisionRef: 'work-current-test' },
        overallForAeoConfirmation: null },
    },
    entry: { schemaVersion: 'wiselink.3_1.canonical_entry_facade.v0.candidate', workItemId: 'WI-OLD', requestId: 'fixture-request', phase: 'CANDIDATE_READBACK_VERIFIED', documentVersionId: 'DV-FAM-1', normalizedFamily: 'SB',
      packageId: null, packageArtifactSha256: null, failureCode: null, deepLinkPath: '/work-items/WI-OLD/analysis', capabilities: { status: true, queryParsedUnits: false, deepLink: true, mutatesParsingState: false } },
    queryResults: [],
    libraryIndex: { schemaVersion: 'wiselink.3_1.library_index_projection.v0.candidate', scope: 'CURRENT_WORKITEM_ONLY', workItemId: 'WI-OLD', rootLabel: '当前文档', nodes: [], completeness: { crossWorkItemLibraryAvailable: false, relatedDocumentIndexAvailable: false, note: 'fixture' } },
    relatedDocuments: { schemaVersion: 'wiselink.3_1.related_document_projection.v0.candidate', scope: 'CURRENT_WORKITEM_ONLY', workItemId: 'WI-OLD', relations: [], boundary: { externalRelatedDocumentsInferred: false, note: 'fixture' } },
    timeline: { schemaVersion: 'wiselink.3_1.timeline_projection.v0.candidate', workItemId: 'WI-OLD', events: [], boundary: { onlyServerObservedEvents: true, note: 'fixture' } },
    workbenchAudit: { schemaVersion: 'wiselink.3_1.workbench_audit_projection.v0.candidate', workItemId: 'WI-OLD',
      packageReadback: { packageId: null, contractRevision: null, resultStatus: null, contentUnitCount: 0, sourceRefCount: 0, artifactRef: null, artifactSha256: null },
      reader: { queryResultCount: 0, sourceBoundResultCount: 0, uniqueSourceRefCount: 0, allReturnedResultsSourceBound: true, applicabilityConclusionAllowed: false, note: 'fixture' },
      applicabilityAuthority: { sourceExpressionCount: null, normalizedCandidateCount: null, assignmentCount: null, inferredFromDocumentPresence: false }, dynamicEvaluation: null, engineerReview: null, overallSynthesis: null, candidateFormationSteps: [] },
    engineerReviewContext: { criterionSetId: 'fixture-rules', baseRuleRevision: 1, ledger: null,
      gapLedger: { schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1', inputRevision: revision, baseRuleRevision: 1, currentness: 'CURRENT', candidateOnly: true, gaps: [],
        summary: { total: 0, open: 0, partiallyResolved: 0, resolved: 0, decisionCritical: 0, reviewQueryable: 0, resolveNow: 0, controlledByDisposition: 0, assumptionOrConservative: 0, monitoringOrDeferred: 0, optimization: 0, lifecycle: 0 } },
      items: [{ criterionId: 'RULE-SYNTHETIC', criterionName: '构型有效性', evaluationQuestion: '措施是否适用于当前构型？', decisionRule: '核对受控构型记录后再判断。', appliesWhen: '仅对已核实构型。', dynamicResult: 'UNDETERMINED', candidateConclusion: 'UNKNOWN', humanReviewRequired: true, factsConsidered: ['合成来源有条件限制'], missingInputs: ['构型未核定'], sourceRefs: ['source-ref-test'], latestReview: null }] },
    readAuthorization: { action: 'READ_DOCUMENT_PARSING', decisionId: 'fixture-decision', permissionSnapshotVersion: 'fixture-permission' },
  };
}
export function assessmentFixtureRead(name: string, ...args: unknown[]): unknown {
  switch (name) {
    case 'getDocumentParsingPage': return assessmentPageFixture();
    case 'readJobAidAssessmentWork': return assessmentWorkingFixture();
    case 'readDocumentParsingStatus': return assessmentStatusFixture();
    case 'readParsedDocument': return assessmentOriginalFixture(String(args[1] ?? 'PR1'));
    case 'getCanonicalLibraryDocuments': return libraryDocuments(['FAM']);
    case 'getCanonicalLibraryQuicklook': return assessmentAssociationFixture();
    case 'readEngineeringKnowledgeWork': return assessmentWikiFixture();
    case 'getReviewOverallProjectionEligibility': return { eligible: false, binding: null };
    case 'getOverallRegenerationEligibility': return { eligible: false };
    case 'getApplicabilitySelection': throw Object.assign(new Error('APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED'), { code: 'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED', statusCode: 404 });
    case 'getConfigurationEvidenceStatus': return { schemaVersion: 'wiselink.3_1.configuration_evidence_status.v1', workItemId: 'WI-OLD', workItemRevision: 7, source: { configured: false }, latestQuery: null, current: null, reevaluation: null,
      authority: { owner: 'CANONICAL_HOST', candidateOnly: true, noRecordMeansFalse: false, notConnectedMeansFalse: false } };
    case 'getApplicabilitySelectionReviewAvailability': return { enabled: false };
    case 'getRelatedContextPreview': { const preview = referenceUiPreview([]); preview.revision = 7; preview.snapshot.workItemRef = 'WI-OLD'; preview.documentVersionId = 'DV-FAM-1'; return preview; }
    case 'reloadReviewConversation': { const reading = assessmentRunningConversationFixture(); reading.conversation.turns = []; return reading; }
    case 'getCanonicalTaskModelOptions': return { options: [], defaultModelRef: null };
    case 'prepareDocumentTranslationContinuation': return { available: false };
    case 'readDocumentTranslationReading': throw Object.assign(new Error('TRANSLATION_NOT_READY'), { statusCode: 404 });
    default: throw new Error(`Unexpected synthetic endpoint: ${name}`);
  }
}
export function assessmentRunningConversationFixture() {
  const turn = reviewUiTurn();
  turn.execution = { status: 'RUNNING', attemptRef: 'fixture-review-attempt', requestedAt: null, startedAt: null, updatedAt: null, completedAt: null, error: null };
  return { conversation: { schemaVersion: 'wiselink.3_1.review_conversation.v1.c1', reviewConversationId: 'fixture-conversation', workItemId: 'WI-OLD', status: 'ACTIVE', startedAtRevision: 7, lastSyncedRevision: 7, currentWorkItemRevision: 7, currentRevisionSynced: true, automaticExecutionAvailable: false, lastActiveAt: '2026-10-23T00:00:00Z', turns: [turn], closedAt: null, createdAt: '2026-10-23T00:00:00Z' }, currentWorkItemRevision: 7 };
}
