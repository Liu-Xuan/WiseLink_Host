import { readFileSync } from 'node:fs';
import { canonicalSha256 } from '../../scripts/validate-payload.mjs';

const legacy = readFileSync(new URL('./review-turn-task.c2.json', import.meta.url), 'utf8');
const scope = {tenantId: 'synthetic-tenant', sourceKey: 'TDMS', sourceInstanceId: 'synthetic-source', scopeId: 'scope'};
const sourceVersion = {rawRevision: 'R1', rawIteration: '1', confirmation: 'SOURCE_DECLARED'};
const selectors = [{fieldPath: 'content.opinions[0]', selector: '#opinion'}];

export function reviewRuntimeFixture({count = 1, saved = false} = {}) {
  const review = JSON.parse(legacy);
  review.schemaVersion = 'wiselink.3_1.review_turn_task.v1.c5';
  review.selectedEvaluationItemId = null; review.allowedEvaluationItemIds = []; review.allowedAdoptedInputRefs = [];
  review.context.purpose = 'UPDATE_ASSESSMENT';
  const document = {evidenceRef: 'document:page-1', kind: 'DOCUMENT_PASSAGE', title: 'Synthetic original',
    versionLabel: 'R1', excerpt: 'Document body with full limiting condition.', locator: 'page 1',
    workItemId: review.context.workItem.workItemId, documentVersionId: review.context.workItem.documentVersionId};
  const projection = {opinions: [], contradictions: [], selectedSetApprovedRefs: [], historicalCohortApprovedRefs: [],
    cohorts: [{scope, setRevisionRef: 'set', processingFamilyRef: 'family', cohortRef: 'cohort',
      processingObservationRef: 'processing', rootBindings: [{endpoint: {kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: 'root'},
        fileProcessingAssertionRefs: ['file-binding'], applicabilityEvidenceRefs: ['applicable']}],
      selection: 'HOST_SELECTED', membershipCoverage: 'COMPLETE', versionMappingCoverage: 'COMPLETE',
      approvedBodyCaptureCoverage: 'COMPLETE', approvalReadiness: 'ALL_APPROVED', currentness: 'CURRENT',
      members: [], approvedOpinionRefs: [], qualifiedOpinionRefs: [], revokedOpinionRefs: [], gaps: []}],
    readPerformed: false, interpretation: 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE'};
  for (let i = 1; i <= count; i++) {
    const ref = `native:fresh-${i}`, revision = `retained-${i}`;
    projection.selectedSetApprovedRefs.push(ref);
    projection.opinions.push({evidenceRef: ref, scope, assessment: {recordRef: `record-${i}`, sourceRevisionRef: revision,
      sourceRecordId: `assessment-${i}`, sourceVersion, businessVersion: null}, fieldPath: selectors[0].fieldPath,
      sourceSelector: selectors[0].selector, author: null, lane: null,
      approval: {captureRef: `capture-${i}`, evidencePath: 'rawFields.opinionCollection', mode: 'EXACT_VERSION'},
      sourceVerification: 'DECLARED_ONLY', readPerformed: false, engineeringAdoption: 'NOT_CREATED', executionVerified: false});
    projection.cohorts[0].members.push({memberRef: `member-${i}`, assessmentObservationRef: revision,
      membershipResolution: 'CONFIRMED', opinionRefs: [ref], contributorRefs: [], responsibilityRefs: [], ataScopes: [],
      evidenceRefs: [], opinionContributions: [], status: 'APPROVED'});
    projection.cohorts[0].approvedOpinionRefs.push(ref);
  }
  const runtimeContext = {schemaVersion: 'wiselink.tdms-runtime-context.v1', binding: {
    tenantId: scope.tenantId, actorUserId: 'synthetic-engineer', workItemId: document.workItemId,
    documentVersionId: document.documentVersionId, taskContextRef: 'AQ-native-review-current'},
  selections: [{scope, setRevisionRef: 'set', processingFamilyRef: 'family', generation: 2, sourceRevisionRefs: ['root']}], projection};
  const addon = {schemaVersion: 'wiselink.tdms-review-runtime-context.v1', mode: 'BOUNDED_NATIVE_READ',
    reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef, requestId: review.requestId,
    inputRevision: review.inputRevision, workRevisionRef: 'saved-work-3', workRevision: 3,
    savedEvidenceRefs: [], runtimeContext};
  review.jobAidContext = {schemaVersion: 'wiselink.jobaid-problem-task.v2', tdmsReviewContext: addon,
    sourceCatalog: [document], initiallyDeliveredRefs: [document.evidenceRef],
    sourceBindings: [{workItemId: document.workItemId, artifactRef: 'artifact://synthetic-original', artifactSha256: 'a'.repeat(64)}],
    previousWork: {workRevisionRef: 'saved-work-3', workRevision: 3, content: {issues: [], evidence: []}},
    modelInput: {schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'PROBLEM_REVIEW', expectedWorkRevision: 3,
      tdmsReviewContext: structuredClone(addon), previousWork: {workRevisionRef: 'saved-work-3', workRevision: 3, content: {issues: []}},
      availableSources: [{ref: document.evidenceRef, kind: document.kind, title: document.title,
        versionLabel: document.versionLabel, locator: document.locator}, ...projection.opinions.map(item => ({
        ref: item.evidenceRef, kind: 'TDMS_NATIVE_RECORD', title: item.assessment.sourceRecordId,
        versionLabel: item.assessment.sourceVersion.rawRevision, locator: item.fieldPath}))],
      deliveredEvidence: [plain(document)]}};
  review.resourceRefs = [{sourceRefId: document.evidenceRef, resourceArtifactRef: 'artifact://synthetic-original',
    resourceArtifactSha256: 'a'.repeat(64), value: {...plain(document), sourceRefId: document.evidenceRef}}];
  review.executionPolicy.toolPolicyRef = 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-jobaid-review-c5';
  if (saved) {
    const carrier = freshPacket(review, ['native:fresh-1']).evidence[0];
    carrier.nativeReadReceipt.taskContextRef = 'original-historical-task';
    carrier.nativeReadReceipt.receiptRef = 'original-historical-receipt';
    carrier.nativeReadReceipt.readAt = '2026-10-01T00:00:00Z';
    addon.savedEvidenceRefs.push(carrier.evidenceRef);
    review.jobAidContext.sourceCatalog.push(carrier);
    review.jobAidContext.initiallyDeliveredRefs.push(carrier.evidenceRef);
    review.jobAidContext.previousWork.content.evidence.push(structuredClone(carrier));
    review.jobAidContext.modelInput.deliveredEvidence.push({...plain(carrier), nativeSource: carrier.nativeSource,
      nativeScope: carrier.nativeScope, nativeReadReceipt: carrier.nativeReadReceipt});
    review.jobAidContext.modelInput.availableSources.find(item => item.ref === carrier.evidenceRef).title = carrier.title;
  }
  syncReview(review);
  return JSON.parse(JSON.stringify(review));
}

export function syncReview(review) {
  review.jobAidContext.modelInput.tdmsReviewContext = structuredClone(review.jobAidContext.tdmsReviewContext);
  review.context.problemAssessment = structuredClone(review.jobAidContext.modelInput);
  return review;
}
export function freshPacket(review, refs) {
  const runtime = review.jobAidContext.tdmsReviewContext.runtimeContext;
  const evidence = refs.map(ref => {
    const opinion = runtime.projection.opinions.find(item => item.evidenceRef === ref);
    const sourceRecordId = opinion.assessment.sourceRecordId;
    const observation = {sourceRecordId, recordKind: 'ENGINEER_ASSESSMENT', sourceVersion, state: {rawName: 'Estimated', rawCode: 'Estimated'},
      sourceModifiedAt: null, observedAt: '2026-10-23T00:00:00Z', identitySelector: '#infoPageIdentityObjectIdentifier',
      stateSelector: '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
      versionSelector: '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value', objectBinding: 'EXACT_CURRENT_DETAIL'};
    return {kind: 'TDMS_NATIVE_RECORD', evidenceRef: ref, title: `Approved ${sourceRecordId}`,
      versionLabel: 'R1', excerpt: 'Only for configuration A; execution is unverified.',
      nativeSource: {...opinion.assessment, recordKind: 'ENGINEER_ASSESSMENT', sourceKey: scope.sourceKey,
        sourceInstanceId: scope.sourceInstanceId, title: sourceRecordId, fileType: null, state: observation.state,
        authors: [], observedAt: observation.observedAt, capturedAt: observation.observedAt,
        coverage: {status: 'PARTIAL', gaps: ['Latestness not provided'], readback: 'CONSISTENT'},
        relatedDocumentVersionIds: [], fieldSelectors: selectors, sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION'},
      nativeScope: {sourceRevisionRef: opinion.assessment.sourceRevisionRef, fieldSelectors: selectors,
        grouping: 'TRANSPARENT_FIELDS', limitations: ['Not proof of implementation'],
        processingSetBinding: {scope, setRevisionRef: 'set', generation: 2, processingFamilyRef: 'family', cohortRef: 'cohort',
          processingObservationRef: 'processing', memberRef: `member-${runtime.projection.opinions.indexOf(opinion) + 1}`,
          assessmentObservationRef: opinion.assessment.sourceRevisionRef},
        approval: {...opinion.approval, approvalSubject: {sourceRecordId, sourceVersion}, before: observation, after: observation}},
      nativeReadReceipt: {receiptRef: `TDMS_READ:synthetic-${ref}`, sourceRevisionRef: opinion.assessment.sourceRevisionRef,
        readAt: '2026-10-23T00:00:01.123Z', purpose: 'JOB_AID_NATIVE_RECORD', fieldPaths: ['content.opinions[0]'],
        taskContextRef: runtime.binding.taskContextRef, readPerformed: true, permissionRevision: 'synthetic-source-revision',
        engineeringAdoption: 'NOT_CREATED', executionVerified: false}};
  });
  return structuredClone({schemaVersion: 'wiselink.jobaid-source-read.v2', status: 'AVAILABLE', scope: 'EXACT',
    completeRequestedScope: true, sourceRefs: refs, evidence, nativeReadReceipts: evidence.map(item => item.nativeReadReceipt)});
}
export function reviewEnvelope(review) {
  const unsealed = {schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: 'ATT-native-review-current',
    operationRef: 'AQ-native-review-current', taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100,
    tenantId: scope.tenantId, workItemId: review.context.workItem.workItemId, inputRevision: review.inputRevision,
    baseRevision: review.inputRevision, documentVersionId: review.context.workItem.documentVersionId,
    sourceRefs: review.resourceRefs.map(item => ({ref: item.resourceArtifactRef, sha256: item.resourceArtifactSha256})),
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: review, deadline: '2099-01-01T00:00:00Z',
    idempotencyKey: 'synthetic:bounded-native-review', executionModel: {modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic model',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-01T00:00:00Z'}};
  return {...unsealed, inputHash: canonicalSha256(unsealed)};
}
export function reviewOutput(ref = 'native:fresh-1') {
  return {answer: '保留适用条件，未证明已执行。', sourceRefs: [], jobAidWorkingDelta: {
    schemaVersion: 'wiselink.jobaid-problem-work.v3', completionReason: '按确切来源核对适用条件。', changeSummary: '保留限制条件。',
    issues: [{issueKey: 'bounded-native-review', question: '措施适用条件是什么？', body: `仅适用构型A，执行情况未知。[[${ref}]]`,
      riskScenarios: [], measures: [], otherClassifications: [], openQuestions: [], requirementHandling: []}]}};
}
export function plain(item) {
  return {evidenceRef: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel,
    excerpt: item.excerpt, locator: item.locator ?? null};
}
