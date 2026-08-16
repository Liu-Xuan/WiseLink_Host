export type UnifiedPackageSourceKind = 'pdf' | 'native_s1000d';

export interface UnifiedPackageArtifactDescriptor {
  storeRole: 'UnifiedArtifactStoreCandidate';
  ref: string;
  sha256: string;
  byteLength: number;
  mediaType: 'application/json';
}

export interface UnifiedReaderReadinessResponse {
  schemaVersion: 'wiselink.3_1.unified_reader_readiness.v0.candidate';
  status: 'VERIFICATION_PENDING';
  hostedServiceRevision: string;
  packageContract: {
    selectionStatus: 'R1_FROZEN';
    preferredCandidate: {
      contractId: 'techpub.parsed-package.v1';
      contractRevision: 'frozen.2';
      contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    };
  };
  capabilities: {
    candidateSourceAvailable: true;
    unifiedAcceptanceFacadeSourceAvailable: true;
    aeoSpecialistReaderConfigured: boolean;
    artifactStoreConfigured: boolean;
    fullU0ValidatorConfigured: boolean;
    immutableAcceptanceReceiptOwnerConfigured: boolean;
    immutableArtifactPersistAndReadback: false;
    sourceBoundCandidateReadback: false;
    boundedSourceQuery: true;
    workItemMutation: false;
    publication: false;
    currentnessMutation: false;
  };
  blockers: string[];
}

export interface UnifiedPackageReadbackRequest {
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  permissionSnapshotVersion: string;
  package: {
    packageId: string;
    contractId: string;
    contractRevision: string;
    artifact: UnifiedPackageArtifactDescriptor;
  };
  query: string;
}

export interface UnifiedReaderQueryResult {
  unitId: string;
  kind: string;
  text: string;
  sourceRefIds: string[];
}

export interface UnifiedReaderCandidateReceipt {
  schemaVersion: 'wiselink.3_1.reader_candidate_receipt.v0.candidate';
  readerReceiptId: string;
  reader: {
    role: 'UnifiedReaderCandidate';
    contractId: string;
    revision: string;
    implementationRevision: string;
  };
  packageId: string;
  packageArtifactSha256: string;
  validationStatus: 'CONSUMER_READBACK_VERIFIED';
  summaryHash: string;
  sourceBoundUnitCount: number;
  queryProbe: {
    query: string;
    resultCount: number;
    allResultsHaveSourceRefs: true;
  };
  authority: {
    createsWorkItemState: false;
    createsEngineeringConclusion: false;
    grantsPublication: false;
    selectsCurrent: false;
  };
}

export interface UnifiedPackageReadbackResponse {
  schemaVersion: 'wiselink.3_1.unified_package_readback.v0.candidate';
  status: 'CANDIDATE_READBACK_VERIFIED';
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  permissionSnapshotVersion: string;
  artifact: UnifiedPackageArtifactDescriptor;
  package: {
    packageId: string;
    contractId: string;
    contractRevision: string;
    sourceKind: UnifiedPackageSourceKind;
    contentHash: string;
    semanticHash: string;
    provenanceHash: string;
    coverageHash: string;
    resultStatus: 'complete' | 'partial';
    title: string;
    revisionLabel: string | null;
    contentUnitCount: number;
    sourceRefCount: number;
  };
  receipt: UnifiedReaderCandidateReceipt;
  fullValidatorProof: {
    status: 'FULL_STRICT_VALIDATOR_PASSED';
    validatorId: 'U0Frozen2SchemaSemanticValidator';
    validatorRevision: string;
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    artifactSha256: string;
  };
  queryResults: UnifiedReaderQueryResult[];
}

export type UnifiedAcceptanceContract =
  | {
      contractId: 'techpub.parsed-package.v1';
      contractRevision: 'frozen.2';
    }
  | {
      contractId: 'aeo_structured_parse_v1';
      contractRevision: 'candidate.1';
    };

export interface UnifiedAcceptanceCorrelation {
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  permissionSnapshotVersion: string;
  classificationFingerprint: string;
}

export interface AeoSpecialistAcceptanceContext {
  family: 'AEO';
  formalAeoIdentity: string;
  revision: string;
  iteration: string;
  sourceMediaType: string;
  sourceByteLength: number;
  sourceSha256: string;
  packageHash: string;
  currentness: 'UNVERIFIED' | 'CURRENT' | 'HISTORICAL' | 'CANCELLED';
}

export interface UnifiedAcceptanceRequest {
  schemaVersion: 'wiselink.3_1.unified_acceptance_request.v0.candidate';
  correlation: UnifiedAcceptanceCorrelation;
  package: {
    packageId: string;
    contract: UnifiedAcceptanceContract;
    artifact: UnifiedPackageArtifactDescriptor;
  };
  specialistContext: AeoSpecialistAcceptanceContext | null;
}

export interface UnifiedAcceptanceCandidateReceipt {
  schemaVersion: 'wiselink.3_1.unified_acceptance_receipt.v0.candidate.2';
  receiptId: string;
  receiptCanonicalSha256: string;
  acceptanceFacade: {
    role: 'UnifiedAcceptanceFacadeCandidate';
    registryRevision: 'unified-acceptance-registry.candidate.1';
    implementationRevision: 'unified-acceptance-facade.candidate.2';
  };
  correlation: UnifiedAcceptanceCorrelation;
  package: {
    packageId: string;
    contract: UnifiedAcceptanceContract;
    artifactStoreRole: 'UnifiedArtifactStoreCandidate';
    artifactRef: string;
    artifactSha256: string;
    artifactByteLength: number;
    artifactMediaType: 'application/json';
  };
  dispatch: {
    route: 'UNIFIED_FROZEN_2' | 'AEO_SPECIALIST';
    handlerId: string;
    handlerRevision: string;
    fallbackUsed: false;
  };
  validationStatus: 'CANDIDATE_ACCEPTED';
  validatedSummaryHash: string;
  sourceBoundUnitCount: number;
  authority: {
    canonicalReaderActivated: false;
    createsWorkItemState: false;
    createsEngineeringConclusion: false;
    grantsPublication: false;
    selectsCurrent: false;
  };
}

export interface ImmutableReceiptArtifactDescriptor {
  storeRole: 'ImmutableAcceptanceReceiptStoreCandidate';
  ref: string;
  sha256: string;
  byteLength: number;
  mediaType: 'application/json';
}

export interface UnifiedAcceptanceOwnedReceipt {
  schemaVersion: 'wiselink.3_1.unified_acceptance_owned_receipt.v0.candidate.1';
  owner: {
    portRevision: 'wiselink.3_1.port.immutable_acceptance_receipt_owner.v0.candidate.1';
    fingerprint: string;
    activationStatus: 'CANDIDATE_ONLY';
  };
  selectedContract: {
    contractId: 'techpub.parsed-package.v1';
    contractRevision: 'frozen.2';
  };
  u0: {
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    contractManifestSha256: string;
  };
  handler: UnifiedAcceptanceCandidateReceipt['dispatch'];
  artifactStoreIdentity: {
    storeRole: 'UnifiedArtifactStoreCandidate';
    artifactRef: string;
    artifactSha256: string;
    artifactByteLength: number;
  };
  correlation: UnifiedAcceptanceCorrelation;
  candidateReceipt: UnifiedAcceptanceCandidateReceipt;
}

export type CanonicalWorkItemParsePhase =
  | 'PARSE_REQUESTED'
  | 'PARSING'
  | 'CANDIDATE_READBACK_VERIFIED'
  | 'FAILED'
  | 'RECORDING_FAILED';

export interface CanonicalDocumentVersionSelection {
  documentId: string;
  documentVersionId: string;
  parserRequestId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  driveFileToken: string;
  driveSourceVersion: string;
}

export interface CanonicalClassificationSelection {
  status: 'CANDIDATE' | 'CONFIRMED';
  normalizedFamily: string;
  classifierReleaseId: string;
  classifierReleaseHash: string;
  parserProfileId: string;
  parserProfileHash: string;
  fingerprint: string;
}

export interface CanonicalParsedPackageUsagePolicy {
  presentationMode: 'ENGINEERING_DOCUMENT' | 'REFERENCE_ONLY';
  qualityStatus: 'PASS' | 'NEEDS_REVIEW';
  applicability: {
    sourceExpressionCount: number;
    normalizedCandidateCount: number;
    assignmentCount: number;
  };
  assessmentAutoAdoptionAllowed: false;
  aeoAutoAdoptionAllowed: false;
  projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES';
}

export interface CanonicalWorkItemPackageProjection {
  packageId: string;
  contractId: 'techpub.parsed-package.v1';
  contractRevision: 'frozen.2';
  artifact: UnifiedPackageArtifactDescriptor;
  contentHash: string;
  semanticHash: string;
  provenanceHash: string;
  coverageHash: string;
  resultStatus: 'complete' | 'partial';
  title: string;
  documentIdentity?: {
    documentCode: string;
    businessRevision: string | null;
  };
  contentUnitCount: number;
  sourceRefCount: number;
  readerReceiptId: string;
  usagePolicy?: CanonicalParsedPackageUsagePolicy;
  fullValidatorProof: {
    validatorId: 'U0Frozen2SchemaSemanticValidator';
    validatorRevision: string;
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    artifactSha256: string;
  };
}

export interface CanonicalWorkItemFailureProjection {
  failureCode: string;
  message: string;
  artifact: UnifiedPackageArtifactDescriptor;
  adapterReceipt: U0Frozen2FailureAdapterReceipt;
  validationWriteReceipt: CanonicalFailureValidationWriteReceipt;
}

export interface UnifiedParseFailureReport {
  $schema: 'urn:techpub:schema:v1:parse-failure-report:frozen-2';
  schemaVersion: 'techpub.parse-failure-report.v1';
  contractRevision: 'frozen.2';
  failureId: string;
  sourceKind: 'pdf' | 'native_s1000d' | 'unknown';
  inputRef: string;
  inputHash: string;
  stage:
    | 'discovery'
    | 'source_integrity'
    | 'security'
    | 'schema_binding'
    | 'parse'
    | 'projection';
  code: string;
  message: string;
  blocking: true;
  packageProduced: false;
  producer: {
    name: string;
    version: string;
    buildHash: string;
  };
  observedAt: string;
  parameters: Record<string, string | number | boolean | string[]>;
}

export type U0FailureProjectStage =
  | 'RESOLVE_CANONICAL_ROLE'
  | 'BIND_WORKITEM'
  | 'VERIFY_SOURCE'
  | 'CLASSIFY_OR_ROUTE'
  | 'PARSE_SOURCE'
  | 'VALIDATE_PACKAGE'
  | 'PERSIST_ARTIFACT'
  | 'READBACK_ARTIFACT';

export type U0FailureRetryClass =
  | 'NOT_SAFE_WITHOUT_OWNER_ACTION'
  | 'REQUIRES_INPUT_OR_OWNER_ACTION'
  | 'SAFE_WITH_SAME_INPUT';

export interface U0Frozen2FailureAdapterReceipt {
  schemaVersion:
    'wiselink.3_1.u0_frozen2_failure_adapter_receipt.v0.candidate.1';
  receiptId: string;
  receiptHash: string;
  adapter: {
    port: 'wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1';
    adapterId: 'U0Frozen2FailureAdapterService';
    adapterRevision: 'candidate.1';
    buildHash: string;
  };
  selectedFailureContract: {
    schemaId: 'urn:techpub:schema:v1:parse-failure-report:frozen-2';
    schemaVersion: 'techpub.parse-failure-report.v1';
    contractRevision: 'frozen.2';
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    contractManifestSha256: string;
    schemaRelativePath: 'schema/parse-failure-report.schema.json';
    semanticValidator: 'scripts.contract_core.validate_parse_failure_report';
  };
  failureId: string;
  failureArtifact: UnifiedPackageArtifactDescriptor;
  actualByteReadbackVerified: true;
  strictValidation: {
    status: 'FULL_STRICT_FAILURE_REPORT_VALIDATOR_PASSED';
    validatorId: 'U0Frozen2ParseFailureReportValidator';
    validatorRevision: string;
    contractId: 'techpub.parse-failure-report.v1';
    contractRevision: 'frozen.2';
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    failureId: string;
    artifactSha256: string;
  };
  taxonomy: {
    stableErrorCode: string;
    causeCode: string;
    errorClass: string;
    reportStage: UnifiedParseFailureReport['stage'];
    projectStage: U0FailureProjectStage;
    retryClass: U0FailureRetryClass;
    userAction: string;
  };
  correlation: {
    workItemId: string;
    requestId: string;
    documentId: string | null;
    documentVersionId: string;
    permissionSnapshotVersion: string;
    classificationFingerprint: string;
  };
  input: {
    sourceKind: 'pdf' | 'native_s1000d' | 'unknown';
    sourceArtifactId: string;
    inputRef: string;
    inputHash: string;
  };
  packageAttempt: {
    packageId: string;
    contractId: string;
    contractRevision: string;
  } | null;
  producer: {
    producerId: string;
    producerRevision: string;
    producerBuildHash: string;
    executionRoute: string;
  };
  authority: {
    failureContractAuthority: 'U0_FROZEN_2';
    createsWorkItemState: false;
    writeAuthorized: false;
    publicationAuthorized: false;
  };
}

export interface CanonicalFailureValidationWriteReceipt {
  schemaVersion:
    'wiselink.3_1.failure_validation_write_receipt.v0.candidate.1';
  status: 'AUTHORIZED';
  receiptId: string;
  receiptHash: string;
  port: 'wiselink.3_1.port.failure_validation_write_authorization.v0.candidate.1';
  revision: 'candidate.1';
  fingerprint: string;
  scope: 'PERSIST_U0_FROZEN2_FAILURE_AND_CAS_WORKITEM';
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  failureId: string;
  reportBytesSha256: string;
  reportByteLength: number;
  authority: {
    failureArtifactPersistAuthorized: true;
    failureWorkItemCasAuthorized: true;
    packageArtifactPersistAuthorized: false;
    publicationAuthorized: false;
    currentSwitchAuthorized: false;
  };
}

export interface CanonicalWorkItemRecordingFailureProjection {
  failureCode: 'FAILURE_REPORT_RECORDING_FAILED';
  originalFailureCode: string;
  message: string;
}

export interface CanonicalAssessmentCandidateProjection {
  status: 'CANDIDATE_ONLY' | 'CANDIDATE_ONLY_RESYNTHESIZED';
  criterionSetId: string;
  criterionCount: number;
  evaluationItemCount: number;
  packageStatus: string;
  applicabilityOverall: string;
  authorityLevel: 'candidate_only';
  warningCodes: string[];
  blocksEngineeringClosure: boolean;
  externalDiscoveryStatus: string | null;
  externalDiscoveryIsEvidence: false;
  previousOverallStale: boolean;
  staleReason:
    | 'ENGINEER_ITEM_SET_CHANGED'
    | 'EXTERNAL_CONTEXT_STALE'
    | null;
  currentContextHash: string;
  currentTransportHash: string;
  artifact: UnifiedPackageArtifactDescriptor;
  evaluateAttemptId: string;
  resynthesisAttemptId: string | null;
}

export interface CanonicalAeoCandidateArtifactProjection {
  artifactKind:
    | 'AUTHORING_BOOTSTRAP'
    | 'WORKING_COPY'
    | 'DRAFT_PACKAGE'
    | 'WORD_EXPORT';
  artifactRef: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: string;
  state: 'AVAILABLE' | 'CANDIDATE' | 'BLOCKED';
}

export interface CanonicalAeoCandidateProjection {
  status: 'CANDIDATE_AUTHORING_IN_PROGRESS' | 'CANDIDATE_WORD_EXPORTED';
  targetIdentity: 'AEO-B787-46-0015-R09';
  disposition: 'ADOPT';
  authorityLevel: 'candidate_only';
  sourceCandidateCount: number;
  automaticallyAdopted: false;
  engineeringApproved: false;
  actionAttemptId: string;
  ownerCommit: '8a2ea67aea5d60c0c72750a9e539404214296aeb';
  artifacts: CanonicalAeoCandidateArtifactProjection[];
}

export interface CanonicalParseAuthorizationProjection {
  action: 'PARSE_PDF';
  actorFingerprint: string;
  decisionId: string;
  decisionHash: string;
  permissionSnapshotVersion: string;
}

export interface CanonicalWorkItemProjection {
  schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate';
  workItemId: string;
  requestId: string;
  revision: number;
  phase: CanonicalWorkItemParsePhase;
  permissionSnapshotVersion: string;
  parseAuthorization: CanonicalParseAuthorizationProjection;
  source: CanonicalDocumentVersionSelection;
  classification: CanonicalClassificationSelection;
  package: CanonicalWorkItemPackageProjection | null;
  assessment?: CanonicalAssessmentCandidateProjection | null;
  aeo?: CanonicalAeoCandidateProjection | null;
  failure: CanonicalWorkItemFailureProjection | null;
  recordingFailure: CanonicalWorkItemRecordingFailureProjection | null;
}

export interface CanonicalPdfVerticalRunRequest {
  schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate';
  workItemId: string;
  requestId: string;
  source: CanonicalDocumentVersionSelection;
  classification: CanonicalClassificationSelection;
  query: string;
}

export interface CanonicalPdfVerticalRunResponse {
  schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_response.v0.candidate';
  status: 'CANDIDATE_VERTICAL_VERIFIED' | 'FAILED' | 'RECORDING_FAILED';
  workItem: CanonicalWorkItemProjection;
  readback: UnifiedPackageReadbackResponse | null;
  entry: CanonicalEntryFacadeResponse;
  authority: {
    canonicalRoleSelected: false;
    onlineWritePerformed: boolean;
    applicationPublished: false;
    currentSelectionChanged: false;
    engineeringConclusionCreated: false;
  };
}

export interface CanonicalEntryFacadeResponse {
  schemaVersion: 'wiselink.3_1.canonical_entry_facade.v0.candidate';
  workItemId: string;
  requestId: string;
  phase: CanonicalWorkItemParsePhase;
  documentVersionId: string;
  normalizedFamily: string;
  packageId: string | null;
  packageArtifactSha256: string | null;
  failureCode: string | null;
  deepLinkPath: string;
  capabilities: {
    status: true;
    queryParsedUnits: boolean;
    deepLink: true;
    mutatesParsingState: false;
  };
}

export interface CanonicalEntryQueryRequest {
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  query: string;
}

export interface AilyParsedPackageSummary {
  packageId: string;
  contractId: 'techpub.parsed-package.v1';
  contractRevision: 'frozen.2';
  artifactSha256: string;
  resultStatus: 'complete' | 'partial';
  title: string;
  contentUnitCount: number;
  sourceRefCount: number;
  readerReceiptId: string;
  fullValidationStatus: 'FULL_STRICT_VALIDATOR_PASSED';
}

export interface AilyWorkItemStatusResponse {
  entry: CanonicalEntryFacadeResponse;
  packageSummary: AilyParsedPackageSummary | null;
  assessmentSummary: CanonicalAssessmentCandidateProjection | null;
}

export interface AilyParsedPackageQueryResponse {
  workItemId: string;
  packageId: string;
  query: string;
  resultCount: number;
  results: UnifiedReaderQueryResult[];
}

export interface AilyWorkItemDeepLinkResponse {
  workItemId: string;
  deepLink: string;
}

export interface CanonicalEntryQueryResponse {
  schemaVersion: 'wiselink.3_1.canonical_entry_query.v0.candidate';
  status: 'CANDIDATE_QUERY_VERIFIED';
  entry: CanonicalEntryFacadeResponse;
  readback: UnifiedPackageReadbackResponse;
}

export interface CanonicalDocumentParsingPageResponse {
  schemaVersion: 'wiselink.3_1.document_parsing_page.v0.candidate';
  status: 'FRESH_READ';
  workItem: CanonicalWorkItemProjection;
  entry: CanonicalEntryFacadeResponse;
  queryResults: UnifiedReaderQueryResult[];
  readAuthorization: {
    action: 'READ_DOCUMENT_PARSING';
    decisionId: string;
    permissionSnapshotVersion: string;
  };
  validationActions: {
    phase10AeoCandidateLoop: {
      enabled: boolean;
      targetIdentity: 'AEO-B787-46-0015-R09';
      disposition: 'ADOPT';
      authorityLevel: 'candidate_only';
    };
  };
}

export interface FileServiceP0ProbeResponse {
  schemaVersion: 'wiselink.3_1.fileservice_p0_probe.v1';
  status: 'PASS';
  stage: 'ACTUAL_BYTE_READBACK_VERIFIED';
  artifact: {
    bucketId: string;
    filePath: string;
    providerFilePath: string;
    providerObjectId: string;
    sha256: string;
    byteLength: number;
    mediaType: 'application/json';
    readbackVerified: true;
    reusedExisting: false;
  };
  authority: {
    authenticatedActorRequired: true;
    businessWritePerformed: false;
    databaseWritePerformed: false;
    workItemCreated: false;
  };
}

export type ExternalDiscoveryResultStatus =
  | 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER'
  | 'ACCESS_DENIED'
  | 'PARTIAL_RESULTS'
  | 'TRUNCATED'
  | 'CANDIDATES_FOUND';

export type ExternalDiscoveryReviewStatus =
  | 'PENDING'
  | 'HUMAN_SELECTED'
  | 'REJECTED';

export interface ExternalDiscoveryCandidateView {
  searchRunRef: string;
  candidateRef: string;
  publisher: 'AIRBUS' | 'BOEING' | 'COMAC';
  title: string;
  url: string;
  disposition: string;
  reviewStatus: ExternalDiscoveryReviewStatus;
  reviewDecision:
    | 'HUMAN_SELECTED_FOR_INGEST'
    | 'HUMAN_REJECTED'
    | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  eligibleForHumanSelection: boolean;
  selectionBlockReason: string | null;
}

export interface ExternalDiscoverySearchRunView {
  searchRunRef: string;
  sourceSystem: string;
  query: string;
  resultStatus: ExternalDiscoveryResultStatus;
  observedAt: string;
  accessRestricted: boolean;
  truncated: boolean;
  partialOnly: boolean;
  candidates: ExternalDiscoveryCandidateView[];
}

export interface ExternalDiscoveryPageResponse {
  status: 'FRESH_READ';
  searchRuns: ExternalDiscoverySearchRunView[];
  authority: {
    currentnessChanged: false;
    documentManagementIoPerformed: false;
    engineeringConclusionCreated: false;
  };
}

export interface ExternalDiscoverySelectionResponse {
  status: 'HUMAN_REVIEW_RECORDED';
  searchRunRef: string;
  candidateRef: string;
  reviewStatus: 'HUMAN_SELECTED' | 'REJECTED';
  reviewDecision: 'HUMAN_SELECTED_FOR_INGEST' | 'HUMAN_REJECTED';
  reviewedByUserId: string;
  reviewedAt: string;
  documentManagementIoPerformed: false;
}
