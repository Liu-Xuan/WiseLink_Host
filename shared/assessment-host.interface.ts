export type ShadowEvaluationStatus =
  | 'NOT_STARTED'
  | 'EVIDENCE_MISSING'
  | 'AI_DRAFT'
  | 'NEEDS_REVIEW'
  | 'CANDIDATE_PASS'
  | 'CANDIDATE_FAIL';

export type ShadowCandidateConclusion =
  | 'pass'
  | 'fail'
  | 'not_applicable'
  | 'insufficient_data'
  | 'conditional';

export interface ShadowSourceEvidenceRef {
  schemaVersion: string;
  sourceUnitId: string;
  sourceUnitHash: string;
  artifactRef: string;
  anchorTextHash: string;
  locator: Record<string, unknown>;
  anchorPreview: string | null;
}

export interface ShadowSourceEvidenceCandidate {
  schemaVersion: 'wiselink.v3_1.sb_job_aid.source_evidence_candidate.v1';
  candidateId: string;
  routerVersion: 'sb-job-aid-source-evidence-router@1';
  bindingRoles: Array<
    'PREDICATE_INPUT_SOURCE' | 'REQUIRED_DOCUMENT_EVIDENCE_SOURCE'
  >;
  predicatePaths: string[];
  requiredDocumentFieldPaths: string[];
  fieldPath: string;
  structuredObjectId: string;
  structuredObjectHash: string;
  pageRange: { startPage: number; endPage: number };
  sourceRefs: ShadowSourceEvidenceRef[];
  sourceBounded: true;
  authorityLevel: 'candidate_only';
  createsEvidenceRef: false;
}

export interface ShadowEvaluationAnalysis {
  criterionVersionId: string | null;
  criterionHash: string | null;
  stageCode: string;
  stageName: string;
  criterionName: string;
  predicateResult: 'TRUE' | 'FALSE' | 'UNKNOWN';
  automationMode: string;
  normativeForce: string;
  rationale: string | null;
  sourceLocatorCandidates: string[];
  sourceLocatorCandidatesAreEvidenceRefs: false;
  sourceEvidenceCandidates: ShadowSourceEvidenceCandidate[];
  sourceEvidenceCandidatesAreEvidenceRefs: false;
}

export interface ShadowEvaluationItem {
  evaluationItemId: string;
  criterionId: string;
  sequence: number;
  question: string;
  status: ShadowEvaluationStatus;
  candidateConclusion: ShadowCandidateConclusion;
  blocking: boolean;
  blockingReason: string | null;
  missingInformation: string | null;
  aiConfidence: number | null;
  evidenceRefCount: number;
  sourceEvidenceAdoptions: SourceEvidenceAdoptionState[];
  engineerReview: EngineerReviewState | null;
  analysis: ShadowEvaluationAnalysis;
}

export interface SourceEvidenceAdoptionState {
  schemaVersion: 'wiselink.v3_1.sb_job_aid.source_evidence_adoption.v1';
  patchId: string;
  baseRecordId: string;
  packageId: string;
  evaluationItemId: string;
  assessmentContentHash: string;
  criterionId: string;
  candidateIds: string[];
  comment: string;
  validatingEngineerUserIds: string[];
  appliedToPackage: boolean;
  createsEvidenceRef: false;
  createdAt: string;
}

export interface AdoptSourceEvidenceRequest {
  packageId: string;
  evaluationItemId: string;
  expectedAssessmentContentHash: string;
  candidateIds: string[];
  comment: string;
}

export interface AdoptSourceEvidenceResponse {
  packageId: string;
  evaluationItemId: string;
  assessmentContentHash: string;
  idempotentReplay: boolean;
  adoption: SourceEvidenceAdoptionState;
}

export type EngineerDecision =
  | 'confirmed_pass'
  | 'confirmed_fail'
  | 'overridden'
  | 'returned_for_rework'
  | 'deferred';

export type EngineerActionDecision = Exclude<EngineerDecision, 'overridden'>;

export type EvaluationItemBaseStatus =
  | 'NOT_STARTED'
  | 'AI_DRAFT'
  | 'EVIDENCE_MISSING'
  | 'NEEDS_RETRIEVAL'
  | 'NEEDS_REVIEW'
  | 'CONFLICT'
  | 'CANDIDATE_PASS'
  | 'CANDIDATE_FAIL'
  | 'ENGINEER_CONFIRMED';

export interface EngineerReviewState {
  baseRecordId: string;
  decision: EngineerDecision;
  comment: string;
  reviewingEngineerUserIds: string[];
  status: EvaluationItemBaseStatus;
  updatedAt: string;
}

export interface SubmitEngineerActionRequest {
  packageId: string;
  evaluationItemId: string;
  expectedAssessmentContentHash: string;
  decision: EngineerActionDecision;
  comment: string;
}

export interface SubmitEngineerActionResponse {
  packageId: string;
  evaluationItemId: string;
  assessmentContentHash: string;
  idempotentReplay: boolean;
  finalEngineeringConclusion: boolean;
  review: EngineerReviewState;
}

export interface ShadowSnapshotCounts {
  total: number;
  unresolved: number;
  humanRequired: number;
  byStatus: Record<ShadowEvaluationStatus, number>;
  byConclusion: Record<ShadowCandidateConclusion, number>;
}

export interface ShadowSnapshotProvenance {
  baseToken: string;
  assessmentPackagesTableId: string;
  assessmentPackageRecordId: string;
  evaluationItemsTableId: string;
  capabilityRunsTableId: string;
  capabilityRunRecordId: string;
  domainEventsTableId: string;
  domainEventRecordId: string;
  assessmentContentHash: string;
  upstreamFingerprint: string;
  parserPackageId: string;
  parserPackageSchemaVersion: string | null;
  parserPackageContentHash: string | null;
  parserQualityGateStatus: string | null;
  parserCurrentness: string | null;
  parserArtifactOutputHash: string | null;
  semanticOutputHash: string;
  semanticHashPolicySchema: string | null;
  sourceUnitSetId: string | null;
  sourceUnitSetHash: string | null;
  specManifestId: string;
  sourceContractVersion: string;
  assessmentAsOf: string;
  rulePackVersion: string;
  rulePackSourceHash: string;
  rulePackCriteriaCount: number;
  criterionSetLifecycleStatus?: 'ACTIVE' | 'DRAFT';
  criterionSetUseBoundary?: 'FORMAL_ACTIVE' | 'DEVELOPMENT_VALIDATION';
  criterionSetId: string | null;
  criterionSetHash: string | null;
  criterionSetMemberIdentityHash: string | null;
  ruleArtifactRef: string | null;
  ruleArtifactDigest: string | null;
  ruleArtifactVersion: string | null;
  sourceJobAidDocumentVersionId: string | null;
  sourceJobAidDocumentVersionStatus: 'CONFIRMED' | 'VERSION_UNCONFIRMED' | null;
  readbackVerifiedAt: string;
  importedAt: string;
}

export interface ShadowSnapshotAuthorityBoundary {
  runMode: 'SHADOW' | 'PRODUCTION';
  datasetSplit: 'VALIDATION' | 'DEVELOPMENT';
  isCurrent: boolean;
  outputAuthorityLevel: 'candidate_only';
  eventRoutable: false;
  createsEvidenceRef: false;
  writesEngineerDecision: false;
  writesEngineerConfirmation: false;
  createsClosureDecision: false;
  createsActionReadiness: false;
  publishesResult: false;
}

export interface SbJobAidShadowSnapshotResponse {
  snapshotId: string;
  projectionSchemaVersion: string;
  documentId: string;
  revisionId: string;
  documentFamily: 'SB';
  packageId: string;
  packageStatus: string;
  packageVersion: string;
  applicabilityOverall: string;
  structuredSummary: string;
  candidateRecommendation: string;
  runId: string;
  runStatus: string;
  eventId: string;
  eventStatus: 'IGNORED';
  counts: ShadowSnapshotCounts;
  provenance: ShadowSnapshotProvenance;
  authorityBoundary: ShadowSnapshotAuthorityBoundary;
  parsedPackage?: ParsedPackageManifestIdentity;
  parsedSourceContext?: ParsedSourceContext;
  structuredAssessmentContext?: StructuredAssessmentContext;
  items: ShadowEvaluationItem[];
}

export interface ParsedPackageManifestIdentity {
  contractKind:
    | 'FEISHU_NATIVE_STRUCTURED_PARSE_PACKAGE'
    | 'UNIFIED_PARSED_PACKAGE';
  schemaVersion: string;
  contractRevision: string;
  packageId: string;
  contentHash: string;
  semanticHash: string;
  provenanceHash: string | null;
  coverageHash: string | null;
  artifactRef: string;
  artifactHash: string;
  resultStatus: 'complete' | 'partial' | 'PASS';
}

export interface ParsedSourcePageRef {
  sourceRefId: string;
  artifactRef: string;
  pageStart: number;
  pageEnd: number;
  quote: string;
  anchorTextHash: string;
}

export interface ParsedSourceContext {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.parsed_source_context.v1';
  contextHash: string;
  status: 'AVAILABLE_CANDIDATE';
  resultStatus: 'complete' | 'partial';
  pageCount: number;
  sourcePages: ParsedSourcePageRef[];
  authorityBoundary: {
    sourceTextCandidateOnly: true;
    createsFleetFact: false;
    createsEvidenceRef: false;
    createsEngineerDecision: false;
  };
}

export interface StructuredSourceBinding {
  structurePath: string;
  objectId: string;
  objectHash: string;
  sourceUnitIds: string[];
  sourceRefs: Array<Record<string, unknown>>;
}

export interface StructuredApplicabilityContext {
  availability: 'AVAILABLE_CANDIDATE' | 'MISSING';
  rawText: string | null;
  source: StructuredSourceBinding | null;
}

export interface StructuredConcurrentRequirementEntry {
  requirementState: string;
  normalizedPresence: 'NONE' | 'PRESENT' | 'UNKNOWN';
  requirementsStructured: boolean;
  documentRequirements: string[];
  nonDocumentRequirements: string[];
  retrievalEvaluationLoopRequired: boolean | null;
  rawText: string | null;
  source: StructuredSourceBinding;
}

export interface StructuredWorkInstructionStep {
  /**
   * Consumer-stable identity. It equals stepPath when that path is unique in
   * the package; repeated group-local paths are qualified by source objectId.
   */
  stepId: string;
  stepPath: string;
  stepLabel: string;
  instructionText: string;
  workPackageNumber: string | null;
  workPackageLabel: string | null;
  workPackageTitle: string | null;
  sourcePage: number | null;
  source: StructuredSourceBinding;
}

export interface StructuredAssessmentContext {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.structured_assessment_context.v1';
  applicability: StructuredApplicabilityContext;
  concurrentRequirements: {
    availability: 'AVAILABLE_CANDIDATE' | 'MISSING';
    entries: StructuredConcurrentRequirementEntry[];
  };
  workInstructions: {
    availability: 'AVAILABLE_CANDIDATE' | 'MISSING';
    stepCount: number;
    stepIds: string[];
    steps: StructuredWorkInstructionStep[];
  };
  authorityBoundary: {
    sourceBoundParserCandidateOnly: true;
    documentApplicabilityProvesFleetApplicability: false;
    createsFleetFact: false;
    createsEvidenceRef: false;
    createsEngineerDecision: false;
  };
}

export interface FormalAssessmentCandidateSummary {
  packageId: string;
  documentId: string;
  revisionId: string;
  documentFamily: 'SB';
  documentLabel: string;
  assessmentAsOf: string;
  assessmentContentHash: string;
  structuredParsePackageId: string;
  sourceUnitSetId: string;
  applicabilityOverall: string;
  packageStatus: string;
  evaluationItemCount: number;
  unresolvedCount: number;
  criterionSetLifecycleStatus: 'ACTIVE' | 'DRAFT';
  criterionSetUseBoundary: 'FORMAL_ACTIVE' | 'DEVELOPMENT_VALIDATION';
  inputStatus: 'READY' | 'STALE';
  staleReason: string | null;
}

export interface FormalAssessmentCandidateListResponse {
  schemaVersion:
    'wiselink.v3_1.feishu_native.job_aid_candidate_list.v1';
  count: number;
  candidates: FormalAssessmentCandidateSummary[];
  authorityBoundary: {
    baseReadOnly: true;
    currentParserInputRequired: true;
    candidateOnly: true;
  };
}

export interface FormalAssessmentCandidateSnapshotRequest {
  packageId: string;
}

export interface EvaluationContextPackageRequest {
  packageId: string;
}

export type ResourceAvailabilityStatus =
  | 'AVAILABLE_VERIFIED'
  | 'AVAILABLE_CANDIDATE'
  | 'MISSING'
  | 'ACCESS_DENIED'
  | 'VERSION_UNCONFIRMED'
  | 'STALE'
  | 'CONFLICT'
  | 'NOT_APPLICABLE';

export interface EvaluationResourceAssessment {
  requirementId: string;
  evaluationItemId: string;
  criterionId: string;
  resourceType: 'ITEM_DECISION_INPUTS';
  availabilityStatus: ResourceAvailabilityStatus;
  validationStatus: 'VALIDATED' | 'CANDIDATE_ONLY' | 'NOT_VALIDATED';
  evidenceRefCount: number;
  sourceEvidenceCandidateCount: number;
  sourceEvidenceAdoptionCount: number;
  engineerReviewPresent: boolean;
  missingReason: string | null;
  impact: string | null;
  nextAction: string | null;
  authorityBoundary: 'candidate_only';
}

export interface EvaluationContextCriterionCard {
  evaluationItemId: string;
  criterionId: string;
  criterionVersionId: string;
  criterionHash: string;
  sequence: number;
  stageCode: string;
  stageName: string;
  question: string;
  predicateResult: 'TRUE' | 'FALSE' | 'UNKNOWN';
  automationMode: string;
  normativeForce: string;
  status: ShadowEvaluationStatus;
  candidateConclusion: ShadowCandidateConclusion;
  blocking: boolean;
  blockingReason: string | null;
  missingInformation: string | null;
  rationale: string | null;
  evidenceRefCount: number;
  sourceEvidenceCandidateCount: number;
  sourceEvidenceAdoptionCount: number;
  sourceEvidenceCandidates: ShadowSourceEvidenceCandidate[];
  sourceEvidenceAdoptions: SourceEvidenceAdoptionState[];
  engineerReview: EngineerReviewState | null;
}

export type HistoricalContextAvailabilityStatus =
  | 'AVAILABLE_VERIFIED'
  | 'AVAILABLE_WITH_VERSION_GAPS'
  | 'MISSING'
  | 'PARTIAL'
  | 'READ_BLOCKED';

export type HistoricalAssessmentRelationshipLevel =
  | 'L0_SAME_DOCUMENT_SAME_REVISION'
  | 'L1_SAME_DOCUMENT_OTHER_REVISION'
  | 'SAME_DOCUMENT_REVISION_UNCONFIRMED';

export interface HistoricalContextReadAttempt {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.historical_context_read_attempt.v1';
  attemptId: string;
  attemptHash: string;
  sourceSystem: 'TDMS';
  operationId: string;
  queryDocumentNumber: string;
  operationStatus: string;
  resultStatus: 'FOUND' | 'NO_MATCH' | 'PARTIAL' | 'READ_BLOCKED';
  reasonCode: string;
  attemptedAt: string | null;
  currentnessStatus: string | null;
  selectedDocumentNumber: string | null;
  selectedDocumentState: string | null;
  latestObservedDocumentNumber: string | null;
  assessmentCount: number;
  readbackVerified: boolean;
  readbackComplete: boolean;
  tdmsMutationObserved: false;
  blocker: {
    code: string;
    message: string;
    recoveryAction: string | null;
  } | null;
}

export interface HistoricalAssessmentSnapshot {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.historical_assessment_snapshot.v1';
  snapshotId: string;
  snapshotHash: string;
  sourceSystem: 'TDMS';
  sourceRecordId: string;
  assessmentNumber: string;
  assessmentVersion: string | null;
  assessmentVersionStatus: 'VERIFIED' | 'VERSION_UNCONFIRMED';
  assessmentState: string | null;
  assessor: string | null;
  assessmentDate: string | null;
  createdBy: string | null;
  lastModified: string | null;
  documentNumber: string;
  documentRevisionLabel: string | null;
  documentVersionStatus: 'OBSERVED_LABEL' | 'VERSION_UNCONFIRMED';
  documentState: string | null;
  documentLastModified: string | null;
  documentHash: string | null;
  documentHashStatus: 'VERIFIED' | 'VERSION_UNCONFIRMED';
  jobAidVersion: string | null;
  jobAidVersionStatus: 'VERIFIED' | 'VERSION_UNCONFIRMED';
  ruleSetVersion: string | null;
  conclusion: string | null;
  opinion: string | null;
  affected: Record<string, unknown>;
  applicabilityNote: string | null;
  reinspectionRequired: string | null;
  deadlines: Record<string, unknown>;
  relatedEngineeringFiles: Array<Record<string, unknown>>;
  sourceObservedAt: string | null;
  sourceCurrentnessStatus: string | null;
  authorityLevel: 'HISTORICAL_OPINION';
  usableAsCurrentFact: false;
  createsCurrentEngineerDecision: false;
}

export interface HistoricalAssessmentContextRecord {
  contextRecordId: string;
  relationshipLevel: HistoricalAssessmentRelationshipLevel;
  relationshipReason: string;
  sourceAttemptIds: string[];
  snapshot: HistoricalAssessmentSnapshot;
  authorityLevel: 'HISTORICAL_OPINION';
  usagePolicy: 'CONTEXT_ONLY';
  usableAsCurrentFact: false;
}

export interface BoundHistoricalAssessmentContext {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.historical_assessment_context.v1';
  contextId: string;
  contextHash: string;
  status: HistoricalContextAvailabilityStatus;
  reasonCode: string;
  queryDocumentNumber: string;
  targetDocumentId: string;
  targetDocumentVersionId: string;
  targetRevisionLabel: string | null;
  records: HistoricalAssessmentContextRecord[];
  readAttempts: HistoricalContextReadAttempt[];
  versionWarnings: string[];
  authorityBoundary: {
    historicalOpinionIsCurrentFact: false;
    createsCurrentEngineerDecision: false;
    createsEvidenceRef: false;
    createsApplicabilityConclusion: false;
  };
}

export interface UnboundHistoricalAssessmentContext {
  status: 'MISSING';
  reasonCode: 'HISTORICAL_ASSESSMENTS_NOT_BOUND';
  records: [];
}

export type HistoricalAssessmentContext =
  | BoundHistoricalAssessmentContext
  | UnboundHistoricalAssessmentContext;

export type KnowledgeContextAvailabilityStatus =
  | 'AVAILABLE_VERIFIED'
  | 'AVAILABLE_WITH_VERSION_GAPS'
  | 'MISSING'
  | 'READ_BLOCKED';

export type SimilarCaseRelationshipLevel =
  | 'L2_SAME_FAMILY_ATA_MODEL_TOPIC'
  | 'L3_SEMANTICALLY_RELATED_REFERENCE';

export interface KnowledgeSourceLocator {
  pageStart: number;
  pageEnd: number;
  section: string;
  excerpt: string;
}

export interface FeishuKnowledgeRetrievalCandidate {
  candidateId: string;
  candidateHash: string;
  sourceSystem: 'FEISHU_DRIVE';
  retrievalChannel: 'FEISHU_DRIVE_SEARCH_V2';
  sourceFileToken: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceFileVersion: string;
  sourceFileByteHash: string;
  sourceFileSizeBytes: number;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  sourceOwnerName: string;
  sourceContainerMembershipStatus: 'UNCONFIRMED';
  documentFamily: string;
  documentNumber: string;
  revisionLabel: string | null;
  revisionStatus: 'OBSERVED_LABEL' | 'VERSION_UNCONFIRMED';
  sourceCurrentnessStatus: 'REFERENCE_ONLY_REQUIRES_SOURCE_APP';
  relationshipLevel: SimilarCaseRelationshipLevel;
  relationshipReason: string;
  locators: KnowledgeSourceLocator[];
  extractedClaims: string[];
  affectedCriterionIds: string[];
  authorityLevel: 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY';
  usableAsCurrentFact: false;
  createsCurrentEngineerDecision: false;
}

export interface ExternalOemKnowledgeReference {
  candidateId: string;
  candidateHash: string;
  sourceSystem: 'DOCUMENT_MANAGEMENT';
  retrievalChannel: 'EXTERNAL_OEM_SEARCH_ADOPTION';
  sourceFileToken: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceFileVersion: string;
  sourceFileByteHash: string;
  sourceFileSizeBytes: number;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  sourceOwnerName: 'CanonicalDocumentCatalog';
  sourceContainerMembershipStatus: 'CONFIRMED';
  documentFamily: string;
  documentNumber: string;
  revisionLabel: string;
  revisionStatus: 'DM_CONFIRMED_EXACT_DOCUMENT_VERSION';
  sourceCurrentnessStatus:
    | 'DM_REVIEWED_ACTIVE_REFERENCE'
    | 'DM_REVIEWED_VERSION_GAP';
  relationshipLevel: SimilarCaseRelationshipLevel;
  relationshipReason: string;
  locators: Array<{
    sourceUnitId: string;
    sourceUnitHash: string;
    locator: Record<string, unknown>;
    locatorHash: string;
  }>;
  extractedClaims: [];
  affectedCriterionIds: [];
  authorityLevel: 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY';
  usableAsCurrentFact: false;
  createsCurrentEngineerDecision: false;
  provider: 'BOEING' | 'AIRBUS' | 'COMAC';
  externalDocumentId: string;
  externalDocumentVersionId: string;
  artifactRef: string;
  parsedPackageId: string;
  parsedPackageArtifactRef: string;
  parsedPackageSemanticHash: string;
  adoptionDecisionRef: string;
}

export type KnowledgeRetrievalCandidate =
  | FeishuKnowledgeRetrievalCandidate
  | ExternalOemKnowledgeReference;

export interface BoundKnowledgeRetrievalContext {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.knowledge_retrieval_context.v1';
  contextId: string;
  contextHash: string;
  status: KnowledgeContextAvailabilityStatus;
  reasonCode: string;
  query: string;
  targetPackageId: string;
  targetDocumentId: string;
  targetDocumentVersionId: string;
  requestedKnowledgeSpaceIds: string[];
  observedAt: string;
  records: KnowledgeRetrievalCandidate[];
  versionWarnings: string[];
  authorityBoundary: {
    knowledgeCandidateIsCurrentFact: false;
    sourceContainerMembershipConfirmed: false;
    createsEvidenceRef: false;
    createsCurrentEngineerDecision: false;
    createsApplicabilityConclusion: false;
  };
}

export interface UnboundKnowledgeRetrievalContext {
  status: 'MISSING';
  reasonCode: 'KNOWLEDGE_RETRIEVAL_NOT_BOUND';
  records: [];
}

export type KnowledgeRetrievalContext =
  | BoundKnowledgeRetrievalContext
  | UnboundKnowledgeRetrievalContext;

export interface BoundSimilarCaseContext {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.similar_case_context.v1';
  contextId: string;
  contextHash: string;
  status: KnowledgeContextAvailabilityStatus;
  reasonCode: string;
  records: Array<{
    candidateId: string;
    candidateHash: string;
    sourceTitle: string;
    documentNumber: string;
    revisionLabel: string | null;
    relationshipLevel: SimilarCaseRelationshipLevel;
    relationshipReason: string;
    sourceCurrentnessStatus:
      | 'REFERENCE_ONLY_REQUIRES_SOURCE_APP'
      | 'DM_REVIEWED_ACTIVE_REFERENCE'
      | 'DM_REVIEWED_VERSION_GAP';
    authorityLevel: 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY';
    usableAsCurrentFact: false;
  }>;
  authorityBoundary: {
    similarCaseIsCurrentFact: false;
    createsEvidenceRef: false;
    createsCurrentEngineerDecision: false;
    createsApplicabilityConclusion: false;
  };
}

export interface UnboundSimilarCaseContext {
  status: 'MISSING';
  reasonCode: 'SIMILAR_CASES_NOT_BOUND';
  records: [];
}

export type SimilarCaseContext =
  | BoundSimilarCaseContext
  | UnboundSimilarCaseContext;

export interface CaptureKnowledgeRetrievalContextRequest {
  packageId: string;
  commit: true;
  retrievalSnapshot: Record<string, unknown>;
}

export interface CaptureKnowledgeRetrievalContextResponse {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.knowledge_retrieval_capture.v1';
  packageId: string;
  context: BoundKnowledgeRetrievalContext;
  persistence: {
    baseRecordIds: string[];
    createdCount: number;
    replayedCount: number;
    readbackVerified: true;
  };
  authorityBoundary: {
    feishuReadOnlySource: true;
    sourceContainerMembershipConfirmed: false;
    knowledgeCandidateIsCurrentFact: false;
    createsEvidenceRef: false;
    createsCurrentEngineerDecision: false;
    createsApplicabilityConclusion: false;
  };
}

export interface CaptureHistoricalAssessmentContextRequest {
  packageId: string;
  commit: true;
  tdmsOperation: Record<string, unknown>;
}

export interface CaptureHistoricalAssessmentContextResponse {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.historical_assessment_capture.v1';
  packageId: string;
  context: BoundHistoricalAssessmentContext;
  persistence: {
    baseRecordIds: string[];
    createdCount: number;
    replayedCount: number;
    readbackVerified: true;
  };
  authorityBoundary: {
    tdmsReadOnly: true;
    historicalOpinionIsCurrentFact: false;
    createsCurrentEngineerDecision: false;
    createsEvidenceRef: false;
    createsApplicabilityConclusion: false;
  };
}

export type MaterialQuestionStatus =
  | 'RESOLVED'
  | 'RESOLVED_WITH_ASSUMPTION'
  | 'SOURCE_EXHAUSTED'
  | 'HUMAN_INPUT_REQUIRED'
  | 'ACCESS_BLOCKED'
  | 'CONFLICTING_EVIDENCE'
  | 'NOT_MATERIAL';

export interface MaterialQuestionView {
  questionId: string;
  questionKey:
    | 'CURRENT_APPLICABILITY_FACTS'
    | 'RELATED_ENGINEERING_ACTION_STATUS'
    | 'RELATED_KNOWLEDGE_AND_REVISION_BOUNDARY'
    // Read compatibility for the first 737-46-1029 persisted run.
    | 'CURRENT_FLEET_ONS_CONFIGURATION'
    | 'AEO_EXECUTION_COMPLETION'
    | 'FTD_RELATION_TO_CURRENT_REVISION';
  question: string;
  materiality: 'CAN_CHANGE_OVERALL_RECOMMENDATION';
  affectedCriterionIds: string[];
  requiredResourceTypes: string[];
  allowedToolIds: string[];
  minimumAuthority: string;
  status: MaterialQuestionStatus;
  resolutionSummary: string;
  assumptions: string[];
  nextAction: string;
  blocksEvaluation: boolean;
  authorityLevel: 'candidate_only';
}

export interface InvestigationToolSnapshotView {
  toolCallId: string;
  questionIds: string[];
  toolId:
    | 'CURRENT_SOURCE_READER'
    | 'TDMS_HISTORY_READ'
    | 'FEISHU_KNOWLEDGE_RETRIEVAL';
  toolVersion: string;
  inputIdentity: Record<string, unknown>;
  inputHash: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'NOT_AVAILABLE';
  resultClassification:
    | 'SOURCE_EXTRACTED_CANDIDATE'
    | 'HISTORICAL_OPINION_CONTEXT_ONLY'
    | 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY';
  resultSummary: string;
  resultHash: string;
  sourceVersions: Array<Record<string, unknown>>;
  locators: Array<Record<string, unknown>>;
  mutationObserved: false;
  authorityLevel: 'candidate_only';
}

export interface BoundedInvestigationPlanResponse {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.bounded_investigation_plan.v1';
  planId: string;
  planHash: string;
  packageId: string;
  evaluationContextId: string;
  evaluationContextHash: string;
  evaluationItemSetHash: string;
  jobAidVersion: string;
  questions: MaterialQuestionView[];
  toolSnapshots: InvestigationToolSnapshotView[];
  budget: {
    maxToolCalls: 3;
    maxAttemptsPerQuestion: 1;
    allowedSourceScope: 'CURRENT_SOURCE_TDMS_HISTORY_FEISHU_KNOWLEDGE';
  };
  investigationText: string;
  authorityBoundary: {
    candidateOnly: true;
    statusesAreDeterministic: true;
    aiMayNotChangeQuestionStatus: true;
    createsEngineerDecision: false;
    createsApplicabilityConclusion: false;
  };
}

export interface PersistBoundedInvestigationRequest {
  packageId: string;
  expectedPlanId: string;
  expectedPlanHash: string;
  expectedEvaluationContextId: string;
  expectedEvaluationContextHash: string;
  expectedEvaluationItemSetHash: string;
  investigationNarrative: string;
  startedAt: string;
  completedAt: string;
  modelIdentity: {
    capabilityId: 'sb-bounded-investigation';
    pluginVersion: '1.0.18';
    modelId: '2015';
    runtimeModelIdentity: string;
    identityStatus: 'UNCONFIRMED';
    promptIdentity: string;
  };
}

export interface BoundedInvestigationRunView {
  baseRecordId: string;
  runId: string;
  runHash: string;
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.bounded_investigation_run.v1';
  packageId: string;
  documentId: string;
  documentVersionId: string;
  evaluationContextId: string;
  evaluationContextHash: string;
  evaluationItemSetHash: string;
  planId: string;
  planHash: string;
  status: 'PARTIAL';
  stopReason: 'HUMAN_INPUT_REQUIRED_AFTER_BOUNDED_SOURCE_READ';
  questions: MaterialQuestionView[];
  toolSnapshots: InvestigationToolSnapshotView[];
  investigationNarrative: string;
  modelCapabilityId: 'sb-bounded-investigation';
  modelPluginVersion: '1.0.18';
  modelId: '2015';
  runtimeModelIdentity: string;
  modelIdentityStatus: 'UNCONFIRMED';
  promptIdentity: string;
  executionPlane: 'MIAODA_AI_PLUGIN';
  ailyRuntimeVerified: false;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  authorityLevel: 'candidate_only';
}

export interface PersistBoundedInvestigationResponse {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.bounded_investigation_persistence.v1';
  status: 'PERSISTED_AND_READ_BACK';
  idempotentReplay: boolean;
  run: BoundedInvestigationRunView;
  persistence: {
    processingRunRecordId: string;
    engineeringNeedRecordIds: string[];
    toolSnapshotRecordIds: string[];
    readbackVerified: true;
  };
  authorityBoundary: {
    candidateOnly: true;
    ailyRuntimeVerified: false;
    createsEngineerDecision: false;
    createsEvidenceRef: false;
    createsApplicabilityConclusion: false;
  };
}

export interface EvaluationContextPackageResponse {
  schemaVersion: 'wiselink.v3_1.sb_job_aid.evaluation_context_package.v1';
  contextId: string;
  contextHash: string;
  evaluationItemSetHash: string;
  manifest: {
    documentId: string;
    documentVersionId: string;
    documentFamily: 'SB';
    assessmentPackageId: string;
    assessmentContentHash: string;
    assessmentAsOf: string;
    structuredParsePackageId: string;
    structuredParsePackageSchemaVersion: string | null;
    structuredParseSemanticOutputHash: string;
    sourceUnitSetId: string | null;
    sourceUnitSetHash: string | null;
    sourceContractVersion: string;
    parsedPackage: ParsedPackageManifestIdentity;
    jobAidRuleSet: {
      selectedVersion?: string;
      activeVersion: string;
      lifecycleStatus?: 'ACTIVE' | 'DRAFT';
      useBoundary?: 'FORMAL_ACTIVE' | 'DEVELOPMENT_VALIDATION';
      sourceHash: string;
      criteriaCount: number;
      criterionSetId: string;
      criterionSetHash: string;
      criterionSetMemberIdentityHash: string;
      ruleArtifactRef: string;
      ruleArtifactDigest: string;
      ruleArtifactVersion: string;
      sourceJobAidDocumentVersionId: string | null;
      sourceJobAidDocumentVersionStatus:
        | 'CONFIRMED'
        | 'VERSION_UNCONFIRMED';
      targetCandidateVersion: '0.3-candidate';
      derivationMode: 'V0_2_COMPATIBILITY_DERIVATION';
    };
  };
  parsedSourceContext?: ParsedSourceContext;
  currentAssessment: {
    packageStatus: string;
    applicabilityOverall: string;
    structuredSummary: string;
    candidateRecommendation: string;
    counts: ShadowSnapshotCounts;
  };
  structuredAssessmentContext: StructuredAssessmentContext;
  resourceSummary: Record<ResourceAvailabilityStatus, number>;
  resourceAssessments: EvaluationResourceAssessment[];
  criterionCards: EvaluationContextCriterionCard[];
  historicalContext: HistoricalAssessmentContext;
  similarCaseContext: SimilarCaseContext;
  knowledgeContext: KnowledgeRetrievalContext;
  latestInvestigation: BoundedInvestigationRunView | null;
  authorityBoundary: {
    outputAuthorityLevel: 'candidate_only';
    historicalOpinionIsCurrentFact: false;
    aiInferenceCreatesFact: false;
    documentApplicabilityProvesFleetApplicability: false;
    createsEngineerDecision: false;
    createsClosureDecision: false;
    createsAirworthinessConclusion: false;
  };
  latestOverallDraft: OverallAssessmentDraftView | null;
  contextText: string;
}

export type OverallAssessmentDraftLifecycleStatus =
  | 'CURRENT'
  | 'STALE'
  | 'SUPERSEDED'
  | 'FAILED';

export interface OverallAssessmentDraftView {
  baseRecordId: string;
  draftId: string;
  schemaVersion: 'wiselink.v3_1.sb_job_aid.overall_assessment_draft.v1';
  packageId: string;
  documentId: string;
  documentVersionId: string;
  documentFamily: 'SB';
  revision: number;
  lifecycleStatus: OverallAssessmentDraftLifecycleStatus;
  evaluationContextId: string;
  evaluationContextHash: string;
  evaluationItemSetHash: string;
  assessmentContentHash: string;
  structuredParsePackageId: string;
  structuredParseSemanticHash: string;
  sourceUnitSetId: string | null;
  sourceUnitSetHash: string | null;
  jobAidVersion: string;
  jobAidSourceHash: string;
  jobAidCriteriaCount: number;
  modelCapabilityId: 'sb-holistic-assessment';
  modelPluginVersion: '1.0.18';
  modelId: '2015';
  runtimeModelIdentity: string;
  modelIdentityStatus: 'UNCONFIRMED' | 'VERIFIED';
  promptIdentity: string;
  synthesisMode: 'HOLISTIC';
  overallOpinion: string;
  outputHash: string;
  supersedesDraftId: string | null;
  authorityLevel: 'candidate_only';
  generatedAt: string;
  generatedByUserIds: string[];
  runMode: 'SHADOW' | 'PRODUCTION';
  datasetSplit: 'DEVELOPMENT' | 'VALIDATION';
}

export interface PersistOverallAssessmentDraftRequest {
  packageId: string;
  expectedEvaluationContextId: string;
  expectedEvaluationContextHash: string;
  expectedEvaluationItemSetHash: string;
  overallOpinion: string;
  modelIdentity: {
    capabilityId: 'sb-holistic-assessment';
    pluginVersion: '1.0.18';
    modelId: '2015';
    runtimeModelIdentity: string;
    identityStatus: 'UNCONFIRMED';
    promptIdentity: string;
  };
}

export interface PersistOverallAssessmentDraftResponse {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.overall_assessment_persistence.v1';
  status: 'PERSISTED_AND_READ_BACK';
  idempotentReplay: boolean;
  draft: OverallAssessmentDraftView;
  authorityBoundary: {
    candidateOnly: true;
    createsEngineerDecision: false;
    createsClosureDecision: false;
    createsAirworthinessConclusion: false;
  };
}

export interface FormalAssessmentInputReadinessRequest {
  documentId: string;
  documentVersionId: string;
  structuredParsePackageId: string;
  semanticOutputHash: string;
  sourceUnitSetId: string;
  sourceUnitSetHash: string;
  assessmentAsOf: string;
  criterionSetSelection?: DevelopmentCriterionSetSelection;
}

export type WiseLink31CanonicalRole =
  | 'CanonicalMiaodaApp'
  | 'CanonicalAily'
  | 'CanonicalWorkItemStore'
  | 'CanonicalDocumentCatalog'
  | 'CanonicalArtifactStore'
  | 'CanonicalUnifiedReader';

export interface CanonicalRoleResolutionSnapshot {
  status: 'VERIFIED_CANONICAL' | 'PENDING' | 'REJECTED';
  resolutionId: string;
  resolutionHash: string;
  resolverSnapshotRef: string;
  verifiedRoles: WiseLink31CanonicalRole[];
}

export interface AssessmentWorkItemInputReadinessRequest {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.work_item_input_request.v1';
  roleResolution: CanonicalRoleResolutionSnapshot;
  acceptedContract: {
    status: 'ACCEPTED' | 'PENDING' | 'REJECTED';
    selectionId: string;
    selectionHash: string;
    packageContractId: string;
    packageContractRevision: string;
    readerRevision: string;
  };
  workItem: {
    schemaVersion: 'wiselink.3_1.work_item_projection.v0.candidate';
    workItemId: string;
    stateVersion: number;
    phase: string;
    documentBinding: {
      documentId: string;
      documentVersionId: string;
      catalogRole: 'CanonicalDocumentCatalog';
      documentFamily: string;
      classificationStatus:
        | 'CONFIRMED'
        | 'AMBIGUOUS'
        | 'UNKNOWN'
        | 'CATALOG_ONLY';
      classificationFingerprint: string;
    };
    activeRequestId: string;
    acceptedResult: null | {
      packageId: string;
      artifactRef: string;
      artifactSha256: string;
      readerReceiptId: string;
    };
    acceptedFailure: null | { failureReportId: string };
    permissionSnapshotVersion: string;
    updatedByDecisionId: string;
  };
  producedPackage: {
    schemaVersion:
      'wiselink.3_1.unified_parsed_package_produced.v0.candidate';
    workItemId: string;
    requestId: string;
    documentVersionId: string;
    sourceArtifactSha256: string;
    producer: { kind: string; id: string; version: string };
    package: {
      packageId: string;
      contractId: string;
      contractRevision: string;
      artifact: {
        storeRole: 'CanonicalArtifactStore';
        ref: string;
        sha256: string;
        byteLength: number;
        mediaType: 'application/json';
      };
      contentHash: string;
      semanticHash: string;
      provenanceHash: string;
      coverageHash: string;
      partial: boolean;
      warningCount: number;
    };
    producerRunId: string;
  };
  readerReceipt: {
    schemaVersion: 'wiselink.3_1.reader_receipt.v0.candidate';
    readerReceiptId: string;
    reader: {
      role: 'CanonicalUnifiedReader';
      contractId: string;
      revision: string;
    };
    packageId: string;
    packageArtifactSha256: string;
    validationStatus: 'ACCEPTED' | 'REJECTED';
    summaryHash: string;
    sourceBoundUnitCount: number;
    queryProbe: {
      query: string;
      resultCount: number;
      allResultsHaveSourceRefs: boolean;
    };
  };
  criterionSetSelection: {
    status: 'ACCEPTED' | 'PENDING' | 'REJECTED';
    selectionId: string;
    selectionHash: string;
    criterionSetId: string;
    criterionSetHash: string;
    memberIdentityHash: string;
    criteriaCount: number;
    ruleArtifactRef: string;
    ruleArtifactDigest: string;
    ruleArtifactVersion: string;
  };
  criterionSet: {
    schemaVersion: 'wiselink.v3_1.job_aid.criterion_set_version.v1';
    criterionSetId: string;
    criterionSetHash: string;
    memberIdentityHash: string;
    criteriaCount: number;
    lifecycleStatus: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
    ruleArtifact: {
      storeRole: 'CanonicalArtifactStore';
      ref: string;
      digest: string;
      version: string;
    };
    sourceJobAidDocumentVersion: {
      documentVersionId: string | null;
      status: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
    };
  };
  jobAidSourceIdentity: {
    schemaVersion: 'wiselink.v3_1.job_aid.source_identity_receipt.v1';
    criterionSetId: string;
    criterionSetHash: string;
    ruleArtifactRef: string;
    ruleArtifactDigest: string;
    ruleArtifactVersion: string;
    sourceManifestHash: string;
    status:
      | 'VERIFIED'
      | 'SOURCE_IDENTITY_MISMATCH'
      | 'VERSION_UNCONFIRMED';
    auditRef: string;
    auditDigest: string;
    allowsCandidateOnlyAssessment: boolean;
    blocksEngineeringClosure: boolean;
    blocksRulePromotion: boolean;
  };
  assessmentAsOf: string;
}

export interface AssessmentWorkItemInputReadinessResponse {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.work_item_input_readiness.v1';
  status: 'READY_FOR_CANDIDATE_ASSESSMENT';
  workItemId: string;
  observedWorkItemStateVersion: number;
  document: {
    documentId: string;
    documentVersionId: string;
    documentFamily: string;
    classificationFingerprint: string;
  };
  parsedPackage: {
    requestId: string;
    sourceArtifactSha256: string;
    producer: { kind: string; id: string; version: string };
    packageId: string;
    packageContractId: string;
    packageContractRevision: string;
    artifactRef: string;
    artifactSha256: string;
    artifactByteLength: number;
    contentHash: string;
    semanticHash: string;
    provenanceHash: string;
    coverageHash: string;
    partial: boolean;
    warningCount: number;
    readerRevision: string;
    readerSummaryHash: string;
    sourceBoundUnitCount: number;
    readerReceiptId: string;
  };
  criterionSet: {
    selectionId: string;
    selectionHash: string;
    criterionSetId: string;
    criterionSetHash: string;
    memberIdentityHash: string;
    criteriaCount: number;
    ruleArtifactRef: string;
    ruleArtifactDigest: string;
    ruleArtifactVersion: string;
    sourceJobAidDocumentVersion: {
      documentVersionId: string | null;
      status: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
    };
    sourceIdentityStatus:
      | 'VERIFIED'
      | 'SOURCE_IDENTITY_MISMATCH'
      | 'VERSION_UNCONFIRMED';
    sourceManifestHash: string;
  };
  assessmentAsOf: string;
  inputIdentityHash: string;
  audit: {
    roleResolutionId: string;
    roleResolutionHash: string;
    resolverSnapshotRef: string;
    acceptedContractSelectionId: string;
    acceptedContractSelectionHash: string;
    criterionSetSelectionId: string;
    criterionSetSelectionHash: string;
    permissionSnapshotVersion: string;
    updatedByDecisionId: string;
    producerRunId: string;
    readerReceiptId: string;
    jobAidSourceIdentityAuditRef: string;
    jobAidSourceIdentityAuditDigest: string;
  };
  gaps: Array<{
    code:
      | 'PARSED_PACKAGE_PARTIAL'
      | 'PARSED_PACKAGE_WARNINGS_PRESENT'
      | 'JOB_AID_DOCUMENT_VERSION_UNCONFIRMED'
      | 'JOB_AID_SOURCE_IDENTITY_MISMATCH'
      | 'JOB_AID_SOURCE_IDENTITY_UNCONFIRMED';
    scope: 'PARSED_PACKAGE' | 'JOB_AID';
    blocksCandidateDraft: false;
    blocksEngineeringClosure: true;
  }>;
  authorityBoundary: {
    hubAcceptedResultOnly: true;
    assessmentSelectsPackageRevision: false;
    assessmentReadsProducerPrivateState: false;
    documentApplicabilityProvesFleetApplicability: false;
    createsFleetFact: false;
    createsEvidenceRef: false;
    createsEngineerDecision: false;
    createsClosureDecision: false;
    createsAirworthinessConclusion: false;
    writesWorkItem: false;
  };
}

export interface DevelopmentCriterionSetSelection {
  schemaVersion:
    'wiselink.v3_1.job_aid.criterion_set_selection.v1';
  purpose: 'DYNAMIC_CRITERION_SET_HOSTED_VALIDATION';
  lifecycleStatus: 'DRAFT';
  rulePackVersion: string;
  criteriaRecordStatus: 'draft';
  metadataCriteriaId: string;
  metadataRecordStatus: 'draft';
  artifactRef: string;
  artifactDigest: string;
  artifactVersion: string;
  canonicalCriteriaHash: string;
  criterionSetId: string;
  criterionSetHash: string;
  memberIdentityHash: string;
  criteriaCount: number;
  sourceJobAidDocumentVersionId: string | null;
  sourceJobAidDocumentVersionStatus:
    | 'CONFIRMED'
    | 'VERSION_UNCONFIRMED';
  formalUseAllowed: false;
  promotionAllowed: false;
}

export interface FormalAssessmentInputReadinessResponse {
  schemaVersion: 'wiselink.v3_1.feishu_native.job_aid_formal_input_readiness.v1';
  status: 'READY_FOR_ASSESSMENT';
  documentId: string;
  documentVersionId: string;
  assessmentAsOf: string;
  structuredParsePackage: {
    baseRecordId: string;
    packageId: string;
    schemaVersion: string;
    semanticOutputHash: string;
    sourceUnitSetId: string;
    sourceUnitSetHash: string;
    objectCount: number;
    lifecycleStatus: 'FROZEN';
    qualityGateStatus: 'PASS';
    selectionStatus: 'SELECTED';
    current: true;
  };
  sourceUnitSet: {
    baseRecordId: string;
    setId: string;
    setHash: string;
    schemaVersion: string;
    unitCount: number;
    sourceBoundedUnitCount: number;
    lifecycleStatus: 'FROZEN';
    current: true;
  };
  structuredObjects: {
    count: number;
    sourceBoundedCount: number;
    frozenCount: number;
    validatedCount: number;
  };
  rulePack: {
    schemaVersion: string;
    sourceHash: string;
    canonicalCriteriaHash: string;
    criteriaCount: number;
    attachment5ItemCount: number;
    metadataBaseRecordId: string;
    artifactRef: string;
    artifactVersion: string;
    criterionSetId: string;
    criterionSetHash: string;
    criterionSetMemberIdentityHash: string;
    criterionSetLifecycleStatus: 'ACTIVE' | 'DRAFT';
    useBoundary: 'FORMAL_ACTIVE' | 'DEVELOPMENT_VALIDATION';
    sourceJobAidDocumentVersion: {
      documentVersionId: string | null;
      status: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
    };
  };
  applicabilityGate: {
    status: 'WAITING_INPUT';
    reasonCode: 'APPLICABILITY_INPUTS_NOT_BOUND';
    documentTextDoesNotProveFleetApplicability: true;
    predicatesConsumed: false;
    fleetFactsConsumed: false;
  };
  authorityBoundary: {
    baseReadOnly: true;
    recordWriteAttempted: false;
    assessmentPackageCreated: false;
    evaluationItemsCreated: false;
    evidenceRefCreated: false;
    engineerDecisionCreated: false;
    applicabilityConclusionCreated: false;
  };
}

export interface FormalAssessmentDraftResponse {
  schemaVersion: 'wiselink.v3_1.feishu_native.job_aid_assessment_draft.v1';
  status: 'BLOCKED_MISSING_INPUT';
  documentIdentity: Record<string, unknown>;
  package: {
    schemaVersion: string;
    packageId: string;
    contentHash: string;
    upstreamFingerprint: string;
    assessmentAsOf: string;
    generatedAt: string;
    outputAuthorityLevel: 'candidate_only';
  };
  applicability: {
    overall: '待核实';
    predicateCount: 0;
    fleetMatrixCount: 0;
    reasonCode: 'APPLICABILITY_INPUTS_NOT_BOUND';
  };
  evaluationSummary: Record<string, unknown>;
  predicateCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  sourceEvidenceCandidateCount: number;
  evidenceRefCount: number;
  gates: Record<string, unknown>;
  formalAttachment5: Record<string, unknown>;
  evaluationItems: Array<Record<string, unknown>>;
  candidateProjection: {
    schemaVersion: string;
    mode: string;
    identities: Record<string, string>;
    recordCounts: {
      assessmentPackages: number;
      evaluationItems: number;
      capabilityRuns: number;
      domainEvents: number;
    };
    authorityBoundary: Record<string, boolean>;
  };
  authorityBoundary: {
    baseReadOnly: true;
    recordWriteAttempted: false;
    createsEvidenceRef: false;
    writesEngineerDecision: false;
    writesEngineerConfirmation: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
    publishesResult: false;
    humanConfirmationRequiredForFormalConclusion: true;
  };
}

export interface FormalAssessmentPersistRequest
  extends FormalAssessmentInputReadinessRequest {
  commit: true;
}

export interface FormalAssessmentPersistResponse {
  schemaVersion: 'wiselink.v3_1.feishu_native.job_aid_candidate_persistence.v1';
  status: 'PERSISTED_AND_READ_BACK';
  packageId: string;
  contentHash: string;
  assessmentStatus: 'BLOCKED_MISSING_INPUT';
  applicabilityOverall: '待核实';
  evaluationItemCount: number;
  tableResults: Record<
    'assessmentPackages' | 'evaluationItems' | 'capabilityRuns' | 'domainEvents',
    {
      expectedCount: number;
      existingBeforeCount: number;
      createdCount: number;
      readbackVerifiedCount: number;
    }
  >;
  authorityBoundary: {
    currentBusinessObject: false;
    eventProcessingStatus: 'IGNORED';
    eventRoutable: false;
    engineerDecisionWritten: false;
    engineerConfirmationWritten: false;
    evidenceRefCreated: false;
    applicabilityDecisionCreated: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
  };
}
