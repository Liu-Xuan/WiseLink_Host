export type UnifiedPackageSourceKind = 'pdf' | 'native_s1000d';

export interface OfficialOauthStartResponse {
  authorizeUrl: string;
}

export interface OfficialOauthCallbackRequest {
  code: string;
  state: string;
}

export type ReviewConversationStatus =
  | 'ACTIVE'
  | 'STALE_CONTEXT'
  | 'CLOSED';

export type EngineerSuppliedInputType = 'ENGINEER_TEXT';

export type EngineerSuppliedInputAdoptionStatus = 'CANDIDATE_UNADOPTED';

export type ReviewTurnResponseType =
  | 'ANSWER'
  | 'CLARIFYING_QUESTION'
  | 'SOURCE_LINK'
  | 'CANDIDATE_EVIDENCE'
  | 'REVIEW_ACTION_DRAFT'
  | 'INPUT_REQUEST'
  | 'AFFECTED_ITEMS_PREVIEW'
  | 'RESYNTHESIS_RESULT'
  | 'TASK_STATUS';

export interface ReviewActionDraftCandidate {
  baseRevision: number;
  evaluationItemId: string;
  proposedStatus: string;
  adoptedInputRefs: string[];
  sourceRefs: string[];
  assumptions: string[];
  affectedItemIds: string[];
  overallImpact: boolean;
}

export interface ReviewTurnAssistantCandidate {
  responseType: ReviewTurnResponseType;
  answer: string;
  sourceRefs: string[];
  missingInputs: string[];
  candidateEvidenceRefs: string[];
  reviewActionDraft: ReviewActionDraftCandidate | null;
  affectedItemIds: string[];
  warnings: string[];
  actionAttemptRef: string;
  provenance: {
    runtimeAppId: 'app_17c3zn24kv2';
    profileRef: 'wiselink-engineering';
    modelVersion: string;
    promptVersion: string;
    skillVersion: string;
    toolVersions: Record<string, string>;
    resultContentHash: string;
  };
  completedAt: string;
}

export interface ReviewTurnReadModel {
  reviewTurnId: string;
  turnNo: number;
  requestId: string;
  inputRevision: number;
  userMessage: string;
  engineerSuppliedInput: {
    engineerSuppliedInputId: string;
    inputType: EngineerSuppliedInputType;
    adoptionStatus: EngineerSuppliedInputAdoptionStatus;
    text: string;
    attachmentRefs: string[];
  };
  attachmentRefs: string[];
  assistantCandidate: ReviewTurnAssistantCandidate | null;
  createdAt: string;
}

/**
 * Browser-safe ReviewConversation projection. Host actor and OpenClaw
 * session identifiers are deliberately absent from this contract.
 */
export interface ReviewConversationReadModel {
  schemaVersion: 'wiselink.3_1.review_conversation.v1.c1';
  reviewConversationId: string;
  workItemId: string;
  startedAtRevision: number;
  lastSyncedRevision: number;
  currentWorkItemRevision: number;
  currentRevisionSynced: boolean;
  status: ReviewConversationStatus;
  createdAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  turns: ReviewTurnReadModel[];
}

export interface CreateOrResumeReviewConversationResponse {
  conversation: ReviewConversationReadModel;
  resumed: boolean;
}

export interface CurrentReviewConversationResponse {
  conversation: ReviewConversationReadModel | null;
  currentWorkItemRevision: number;
}

export interface AppendReviewTextTurnRequest {
  requestId: string;
  userMessage: string;
  attachmentSelection?: {
    bucketId: string;
    filePath: string;
  };
}

export interface AppendReviewTextTurnResponse {
  conversation: ReviewConversationReadModel;
  turn: ReviewTurnReadModel;
  replayed: boolean;
}

export interface CloseReviewConversationResponse {
  conversation: ReviewConversationReadModel;
  alreadyClosed: boolean;
}

export interface ConfirmReviewActionDraftResponse {
  conversation: ReviewConversationReadModel;
  turn: ReviewTurnReadModel;
  reviewAction: {
    evaluationItemId: string;
    affectedItemIds: string[];
    workItemRevision: number;
    engineerReviewRevision: number;
    overallStatus: 'STALE' | 'NOT_AVAILABLE';
    overallRevision: number | null;
    selectiveResynthesis: 'AFFECTED_ONLY_PENDING';
  };
}

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
  /** Frozen.2 source locator details when the package provides them. */
  sourceLocators?: UnifiedReaderSourceLocator[];
}

export interface UnifiedReaderSourceLocator {
  sourceRefId: string;
  kind: string;
  artifactId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  charOffsetUnit: string | null;
  normalizedPath: string | null;
  xpath: string | null;
  elementId: string | null;
  quote: string | null;
  bbox: number[] | null;
}

export interface CanonicalReaderTranslationAxesProjection {
  ownerSourceReaderConsumptionAllowed: boolean;
  bilingualTranslationConsumptionAllowed: boolean;
  ownerProductState: string;
  translatedUnitCount: number;
  pendingTranslationUnitCount: number;
  translationRequiredUnitCount: number;
  failureReasons: string[];
}

export type CanonicalReaderTranslationProjection =
  | {
      status: 'UNAVAILABLE';
      reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE';
    }
  | {
      status:
        | 'BILINGUAL_READING_AID_AVAILABLE'
        | 'SOURCE_CURRENT_TRANSLATION_PENDING'
        | 'TRANSLATION_GAP';
      axes: CanonicalReaderTranslationAxesProjection;
      artifact?: UnifiedPackageArtifactDescriptor;
      units?: CanonicalReaderBilingualUnit[];
    };

export interface CanonicalReaderBilingualUnit {
  unitId: string;
  kind: string;
  sourceText: string;
  translatedText: string;
  sourceRefIds: string[];
  engineerRevisionId: string | null;
}

export type CanonicalPdfPreviewProjection =
  | {
      status: 'AVAILABLE';
      opaqueLocator: string;
      expiresAt: string;
      mediaType: 'application/pdf';
      byteLength: number;
      supportsRange: boolean;
      navigation: 'PAGE_START';
    }
  | {
      status: 'UNAVAILABLE';
      reason:
        | 'PDF_PREVIEW_NOT_CONFIGURED'
        | 'PDF_PREVIEW_SOURCE_NOT_PDF'
        | 'PDF_PREVIEW_SOURCE_IDENTITY_INVALID'
        | 'PDF_PREVIEW_SOURCE_TOO_LARGE'
        | 'PDF_PREVIEW_SERVICE_UNAVAILABLE';
      retryable: boolean;
    };

export interface CanonicalReaderProjection {
  sourceKind: UnifiedPackageSourceKind;
  structuredUnitCount: number;
  sourceRefCount: number;
  query: string;
  units: Array<{
    unitId: string;
    kind: string;
    text: string;
    sourceRefIds: string[];
    sourceLocators: UnifiedReaderSourceLocator[];
  }>;
  pdfPreview: CanonicalPdfPreviewProjection;
  translation: CanonicalReaderTranslationProjection;
}

/**
 * Browser-safe SourceRef locator for structured-content browsing. Artifact
 * identities stay inside the Host; the browser receives only the coordinates
 * needed to navigate the current controlled document.
 */
export interface CanonicalStructuredContentSourceLocator {
  sourceRefId: string;
  kind: string;
  pageStart: number | null;
  pageEnd: number | null;
  /** Browser-safe excerpt, bounded by the Host. */
  quote: string | null;
}

export interface CanonicalStructuredContentUnit {
  /** One-based position in the current frozen.2 contentUnits sequence. */
  ordinal: number;
  displayKind: 'section' | 'body' | 'unavailable';
  /** Explicit browser outline semantics; the UI never infers this from source kind. */
  outlineKind: 'SECTION' | 'NONE';
  sectionTitle: string | null;
  /** Browser-safe engineering text or an honest typed summary, never raw JSON. */
  displayText: string;
  sourceRefIds: string[];
  sourceLocators: CanonicalStructuredContentSourceLocator[];
}

export interface CanonicalStructuredContentPageResponse {
  schemaVersion: 'wiselink.3_1.structured_content_page.v1';
  status: 'FRESH_READ';
  mode: 'BROWSE';
  /** Current WorkItem revision; the client must echo it for continuation. */
  revision: number;
  resultStatus: 'complete' | 'partial';
  qualityStatus: 'PASS' | 'NEEDS_REVIEW';
  /** All source contentUnits in the exact current frozen.2 package. */
  totalSourceUnitCount: number;
  /** Units represented in browser pagination after non-content metadata omission. */
  totalDisplayUnitCount: number;
  omittedUnitCount: number;
  sourceRefCount: number;
  returnedUnitCount: number;
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  units: CanonicalStructuredContentUnit[];
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

export interface CanonicalTranslationCandidateProjection {
  schemaVersion: 'wiselink.3_1.translation_candidate_projection.v1';
  status: 'CANDIDATE_ONLY' | 'STALE';
  currentness: 'CURRENT' | 'STALE';
  staleReason: 'SOURCE_CHANGED' | 'RULE_SET_CHANGED' | null;
  sourceResultId: string;
  actionAttemptId: string;
  inputRevision: number;
  documentId: string;
  documentVersionId: string;
  sourcePackageId: string;
  sourcePackageContentHash: string;
  ruleSetId: string;
  ruleSetVersion: string;
  sourceLocale: string;
  targetLocale: string;
  sourceUnitCount: number;
  translatedUnitCount: number;
  pendingTranslationUnitCount: number;
  sourceRefCount: number;
  engineerRevisionCount: number;
  validationVerdict: 'ACCEPTED' | 'REVIEW_REQUIRED';
  validationFindingCount: number;
  artifact: UnifiedPackageArtifactDescriptor;
}

export interface CanonicalApplicabilityFleetSourceRef {
  sourceTable: string;
  sourceRecordId: string;
  sourceField?: string | null;
}

export interface CanonicalApplicabilityFleetAsset {
  assetId: string;
  assetVersionId: string;
  aircraftNumber: string;
  aliases?: Array<{ aliasValue: string }>;
  fleetFamily?: string | null;
  aircraftModel?: string | null;
  series?: string | null;
  msn?: string | null;
  lineNumber?: number | null;
  deliveryDate?: string | null;
  sourceRef: CanonicalApplicabilityFleetSourceRef;
  recordHash: string;
}

export interface CanonicalApplicabilityFleetFact {
  factId: string;
  assetId: string;
  factType: 'fleet_configuration' | 'sb_incorporation' | 'data_quality_issue';
  property: string;
  qualifier?: string | null;
  value: unknown;
  validAsOf?: string | null;
  sourceRef: CanonicalApplicabilityFleetSourceRef;
  recordHash: string;
}

/**
 * Host-owned engineer selection persisted inside the canonical WorkItem
 * projection. Fleet facts are deliberately not stored here: they are read
 * from the server-private Host FleetMasterData configuration at use time.
 */
export interface CanonicalApplicabilityControlledSelectionProjection {
  schemaVersion: 'wiselink.3_1.controlled_applicability_selection.v1';
  selectionRevision: string;
  currentness: 'CURRENT';
  documentVersionId: string;
  aircraftIdentifier: string;
  asOf: string;
  fleetSourceSnapshotId: string;
  fleetSourceRevisionKey: string;
  fleetAuthorityRevision: string;
  fleetSourceAsOf: string;
}

export interface ConfigureCanonicalApplicabilitySelectionRequest {
  aircraftIdentifier: string;
  asOf: string;
}

/** Public, credential-free read model for the current WorkItem selection. */
export interface CanonicalApplicabilitySelectionReadModel {
  schemaVersion: 'wiselink.3_1.applicability_selection_read_model.v1';
  workItemId: string;
  workItemRevision: number;
  documentVersionId: string;
  aircraftIdentifier: string;
  asOf: string;
  selectionRevision: string;
  currentness: 'CURRENT' | 'STALE';
  fleetSource: {
    sourceRevisionKey: string;
    authorityRevision: string;
    sourceAsOf: string;
  };
  frozenSourceBinding: {
    status: 'READY' | 'MISSING';
    sourceExpressionCount: number;
    assignmentCount: number;
  };
}

/**
 * Host-owned current aircraft selection and controlled fact snapshot.
 * OpenClaw cannot create or update this projection. The opaque context ref is
 * resolved by service authorization before the WorkItem is fresh-read.
 */
export interface CanonicalApplicabilityInputProjection {
  schemaVersion: 'wiselink.3_1.applicability_input_projection.v1';
  applicabilityContextRef: string;
  /** Host-derived exact WorkItem/DocumentVersion/package binding. */
  workItemId: string;
  documentVersionId: string;
  sourcePackageId: string;
  sourcePackageContentHash: string;
  sourcePackageArtifactSha256: string;
  /** Canonical hash of frozen.2 sourceExpressions + assignments.target. */
  targetBindingHash: string;
  /** Revision of the server-private controlled aircraft/Fleet selection. */
  selectionRevision: string;
  bindingRevision: string;
  currentness: 'CURRENT' | 'STALE' | 'CONFLICT' | 'UNVERIFIED';
  aircraftNumber: string;
  assessmentAsOf: string;
  fleetMasterData: {
    schemaVersion: 'wiselink.v3_1.applicability_fleet.fleet_master_data.v1';
    sourceSnapshotId: string | null;
    sourceRevisionKey: string | null;
    authorityRevision: string | null;
    sourceAsOf: string | null;
    assets: CanonicalApplicabilityFleetAsset[];
    facts: CanonicalApplicabilityFleetFact[];
  };
}

export interface CanonicalApplicabilityCandidateProjection {
  schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1';
  status: 'CANDIDATE_ONLY' | 'WAITING_INPUT' | 'STALE';
  currentness: 'CURRENT' | 'STALE';
  staleReason:
    | 'SOURCE_CHANGED'
    | 'AIRCRAFT_SELECTION_CHANGED'
    | 'FLEET_FACTS_CHANGED'
    | null;
  sourceResultId: string;
  actionAttemptId: string;
  inputRevision: number;
  documentId: string;
  documentVersionId: string;
  sourcePackageId: string;
  sourcePackageContentHash: string;
  translationActionAttemptId: string;
  applicabilityContextRef: string;
  applicabilityBindingRevision: string;
  aircraftNumber: string;
  assessmentAsOf: string;
  fleetSourceSnapshotId: string;
  fleetSourceRevisionKey: string;
  fleetAuthorityRevision: string;
  fleetSourceAsOf: string;
  sourceExpressionCount: number;
  sourceRefCount: number;
  decision: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';
  kleeneResult: true | false | 'unknown';
  /** True only for the evaluated APPLICABLE decision. */
  pass: boolean;
  blockingUnknownCount: number;
  artifact: UnifiedPackageArtifactDescriptor;
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
  schemaVersion: 'wiselink.3_1.u0_frozen2_failure_adapter_receipt.v0.candidate.1';
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
  schemaVersion: 'wiselink.3_1.failure_validation_write_receipt.v0.candidate.1';
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
  staleReason: 'ENGINEER_ITEM_SET_CHANGED' | 'EXTERNAL_CONTEXT_STALE' | null;
  currentContextHash: string;
  currentTransportHash: string;
  artifact: UnifiedPackageArtifactDescriptor;
  evaluateAttemptId: string;
  resynthesisAttemptId: string | null;
}

export type CanonicalRuleSetLifecycleStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

export type CanonicalRuleSetActivationAction = 'PROMOTE' | 'ROLLBACK';

export interface CreateCanonicalRuleSetSnapshotRequest {
  selection: {
    bucketId: string;
    filePath: string;
  };
}

export interface ActivateCanonicalRuleSetSnapshotRequest {
  targetSnapshotId: string;
  expectedRevision: number;
  reason: string;
}

export interface CanonicalRuleSetSnapshotReadModel {
  snapshotId: string;
  lifecycleStatus: CanonicalRuleSetLifecycleStatus;
  rulePackVersion: string;
  criterionSetId: string;
  criterionSetHash: string;
  memberIdentityHash: string;
  criteriaCount: number;
  artifact: {
    ref: string;
    digest: string;
    version: string;
  };
  canonicalCriteriaHash: string;
  sourceJobAidDocumentVersion: {
    documentVersionId: string | null;
    status: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
  };
  createdByEngineeringOwnerUserId: string;
  createdAt: string;
}

export interface CanonicalRuleSetActivationReadModel {
  activationId: string;
  revision: number;
  action: CanonicalRuleSetActivationAction;
  fromSnapshotId: string | null;
  activeSnapshotId: string;
  engineeringOwnerUserId: string;
  requiredRoleId: string;
  reason: string;
  activatedAt: string;
}

export interface CanonicalRuleSetLifecycleReadModel {
  schemaVersion: 'wiselink.3_1.rule_set_lifecycle.v1_1.candidate';
  ruleSetKey: 'JOB_AID';
  headRevision: number;
  activeSnapshotId: string | null;
  snapshots: CanonicalRuleSetSnapshotReadModel[];
  rollbackCandidates: Array<{
    targetSnapshotId: string;
    expectedRevision: number;
  }>;
  activations: CanonicalRuleSetActivationReadModel[];
  authority: {
    currentOwner: 'CANONICAL_HOST';
    currentCasEnforced: true;
    activationAuditAppendOnly: true;
    requiresExplicitEngineeringOwner: true;
    aiMayPromote: false;
    providerMayPromote: false;
    publishesEngineeringApproval: false;
  };
}

export interface CreateCanonicalRuleSetSnapshotResponse {
  snapshot: CanonicalRuleSetSnapshotReadModel;
  lifecycle: CanonicalRuleSetLifecycleReadModel;
  replayed: boolean;
}

export interface ActivateCanonicalRuleSetSnapshotResponse {
  activation: CanonicalRuleSetActivationReadModel;
  lifecycle: CanonicalRuleSetLifecycleReadModel;
}

export interface CanonicalBaseRuleCandidateProjection {
  /**
   * Backward-compatible storage name. In the current runtime this projection
   * is produced only by the hosted OpenClaw dynamic-N evaluation; Base may
   * hold RuleSet/review projections but is not an evaluation executor.
   */
  status: 'CANDIDATE_ONLY';
  revision: number;
  sourceResultId: string;
  criterionSetId: string;
  criterionCount: number;
  evaluationItemCount: number;
  unresolvedCount: number;
  sourceBoundCandidateCount: number;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
}

export type CanonicalEngineeringStatementBasis =
  | 'SOURCE_FACT'
  | 'CONDITIONAL_INFERENCE';

export interface CanonicalSourceBoundEngineeringStatement {
  text: string;
  basis: CanonicalEngineeringStatementBasis;
  /** Every statement remains bound to the current DocumentVersion. */
  sourceRefIds: string[];
}

export interface CanonicalOverallEngineeringSummary {
  schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1';
  conclusion: CanonicalSourceBoundEngineeringStatement;
  whyItMatters: CanonicalSourceBoundEngineeringStatement[];
  applicability: {
    sourceScope: CanonicalSourceBoundEngineeringStatement;
    fleetMatch: CanonicalSourceBoundEngineeringStatement;
    requiredFacts: CanonicalSourceBoundEngineeringStatement[];
  };
  implementationImpact: CanonicalSourceBoundEngineeringStatement[];
  dispositionPriority: CanonicalSourceBoundEngineeringStatement[];
  nextActions: CanonicalSourceBoundEngineeringStatement[];
}

export interface CanonicalOpenClawOverallProjection {
  status: 'CANDIDATE_ONLY' | 'STALE';
  revision: number;
  sourceResultId: string;
  basedOnBaseRuleRevision: number;
  basedOnBaseRuleArtifactSha256: string;
  basedOnEngineerReviewRevision: number | null;
  basedOnEngineerReviewArtifactSha256: string | null;
  discoveryStatus: string;
  gap: string | null;
  candidateRefCount: number;
  findingCount: number;
  unresolvedCount: number;
  authorityLevel: 'candidate_only';
  externalDiscoveryIsEvidence: false;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
  staleReason: 'BASE_RULE_RESULT_CHANGED' | 'ENGINEER_REVIEW_CHANGED' | null;
  /** Business-readable candidate content copied from the verified overall artifact. */
  overallCandidate?: string;
  /** Source-bound engineering synthesis for the user-visible Overall view. */
  engineeringSummary?: CanonicalOverallEngineeringSummary;
  findings?: Array<{
    finding: string;
    basis: string;
    sourceRefIds: string[];
    assumptions: string[];
    uncertainty: string;
  }>;
  missingInputs?: string[];
  applicabilityStatus?: string;
  engineeringReviewRequired?: boolean;
  providers?: Record<string, unknown>;
  /** Verified per-turn runtime provenance; absent on projections created before R09. */
  modelVersion?: string;
  promptVersion?: string;
  skillVersion?: string;
  toolVersions?: Record<string, string>;
}

export interface CanonicalOverallRegenerationSourceIdentity {
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  packageId: string;
  packageArtifactSha256: string;
}

export interface RequestCanonicalOverallRegenerationRequest {
  requestId: string;
  expectedRevision: number;
  sourceIdentity: CanonicalOverallRegenerationSourceIdentity;
}

/**
 * Host-owned request marker retained on the WorkItem after the replacement
 * candidate is committed. It links a browser request to the existing overall
 * ActionAttempt runtime without exposing a lease or task envelope. The actor
 * is resolved by the Host and is never accepted from the browser request.
 */
export interface CanonicalOverallRegenerationRequestProjection {
  schemaVersion: 'wiselink.3_1.overall_regeneration_request.v1';
  requestId: string;
  requestedByUserId: string;
  requestedAt: string;
  requestedFromRevision: number;
  executionRevision: number;
  staleReason: 'USER_REQUESTED_REGENERATION';
  sourceIdentity: CanonicalOverallRegenerationSourceIdentity;
  sourceOverall: {
    revision: number;
    actionAttemptId: string;
    artifactSha256: string;
  };
}

export type CanonicalOverallRegenerationExecutionStatus =
  | 'REQUESTED'
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRY_SCHEDULED'
  | 'COMMITTING'
  | 'SUCCEEDED'
  | 'WAITING_INPUT'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | 'CONFLICT'
  | 'OBSOLETE';

export interface CanonicalOverallRegenerationReadModel {
  schemaVersion: 'wiselink.3_1.overall_regeneration_read.v1';
  workItemId: string;
  requestId: string;
  requestedAt: string;
  requestedFromRevision: number;
  executionRevision: number;
  currentWorkItemRevision: number;
  staleReason: 'USER_REQUESTED_REGENERATION';
  status: CanonicalOverallRegenerationExecutionStatus;
  attemptRef: string | null;
  projectionApplied: boolean;
  terminalReason: string | null;
  terminalErrorCode: string | null;
  authority: {
    candidateOnly: true;
    reviewActionCreated: false;
    engineeringApprovalChanged: false;
    documentCurrentnessChanged: false;
  };
}

export interface RequestCanonicalOverallRegenerationResponse {
  regeneration: CanonicalOverallRegenerationReadModel;
  replayed: boolean;
}

export type CanonicalEngineerReviewDecision =
  | 'confirmed_pass'
  | 'confirmed_fail'
  | 'returned_for_rework'
  | 'deferred';

export interface CanonicalEngineerReviewLedgerProjection {
  status: 'HUMAN_REVIEW_RECORDED';
  revision: number;
  reviewCount: number;
  criterionSetId: string;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
}

export interface CanonicalEngineerReviewPageItem {
  criterionId: string;
  criterionName?: string;
  evaluationQuestion?: string;
  decisionRule?: string;
  appliesWhen?: string;
  dynamicResult: string;
  candidateConclusion: string;
  humanReviewRequired: boolean;
  factsConsidered?: string[];
  ruleApplication?: string;
  analysisSummary?: string;
  sourceRefs?: string[];
  missingInputs?: string[];
  latestReview: {
    decision: CanonicalEngineerReviewDecision;
    status: 'ENGINEER_CONFIRMED' | 'NEEDS_REVIEW';
    comment: string;
    recordedAt: string;
  } | null;
}

export interface CanonicalEngineerReviewPageContext {
  criterionSetId: string;
  baseRuleRevision: number;
  ledger: CanonicalEngineerReviewLedgerProjection | null;
  items: CanonicalEngineerReviewPageItem[];
}

export interface CanonicalOverallForAeoConfirmationProjection {
  status: 'HUMAN_CONFIRMED';
  authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ';
  workItemRevision: number;
  overallRevision: number;
  overallArtifactRef: string;
  overallArtifactSha256: string;
  actionAttemptId: string;
  confirmingActorUserId: string;
  confirmedAt: string;
}

export interface CanonicalIntegratedAssessmentProjection {
  status:
    | 'BASE_RULE_CANDIDATE_READY'
    | 'OVERALL_CANDIDATE_READY'
    | 'OVERALL_CANDIDATE_STALE';
  baseRules: CanonicalBaseRuleCandidateProjection;
  overallSynthesis: CanonicalOpenClawOverallProjection | null;
  /** Append-only, actual-byte verified human review history. */
  engineerReviews?: CanonicalEngineerReviewLedgerProjection | null;
  /** Absent on older projections; only an explicit authenticated host action sets it. */
  overallForAeoConfirmation?: CanonicalOverallForAeoConfirmationProjection | null;
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
  /** Server-derived candidate identity; never accepted from the client. */
  targetIdentity: string;
  disposition: 'ADOPT';
  authorityLevel: 'candidate_only';
  sourceCandidateCount: number;
  automaticallyAdopted: false;
  engineeringApproved: false;
  actionAttemptId: string;
  ownerCommit: '74333547ae5cd1878259812353d59563cc9041da';
  /**
   * Historical authoring source, distinct from the candidate target.
   *
   * Older hosted candidate projections predate this audit field. They remain
   * readable, but the UI must not invent a template identity for them.
   */
  authoringTemplate?: {
    role: 'CONTROLLED_TEMPLATE_SOURCE';
    identity: 'AEO-B787-46-0015-R09';
    artifactRef: string;
    artifactSha256: string;
  } | null;
  sourceOverall: {
    revision: number;
    artifactRef: string;
    artifactSha256: string;
    confirmationActionAttemptId: string;
    confirmedWorkItemRevision: number;
    engineerReviewRevision: number | null;
    engineerReviewArtifactSha256: string | null;
  };
  artifacts: CanonicalAeoCandidateArtifactProjection[];
}

export interface CanonicalAeoCandidateRunResponse {
  schemaVersion: 'wiselink.3_1.aeo_candidate_run.v1';
  status: 'CANDIDATE_WORD_EXPORTED';
  workItem: CanonicalWorkItemProjection;
  aeo: CanonicalAeoCandidateProjection;
  replayed: boolean;
  baseAiCallCount: 0;
  authority: {
    candidateOnly: true;
    automaticallyAdopted: false;
    engineeringApproved: false;
    productionPublished: false;
    currentChanged: false;
  };
}

export interface CanonicalAeoEditingSourceRef {
  sourceId: string;
  locator: string;
}

export interface CanonicalAeoEditingBoundSourceArtifact {
  sourceId: string;
  artifactRef: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: string;
}

/**
 * Host-owned input pointer for the isolated AEO editing-knowledge adapter.
 * Requests cannot supply producer/manifest bytes or replace these bindings.
 */
export interface CanonicalAeoEditingInputProjection {
  schemaVersion: 'wiselink.3_1.aeo_editing_input.v0.candidate.1';
  status: 'HOST_INPUT_READY';
  inputRevision: number;
  workItemId: string;
  documentVersionId: string;
  sourcePackageId: string;
  sourcePackageArtifactSha256: string;
  currentProducerArtifact: UnifiedPackageArtifactDescriptor;
  sourceManifestArtifact: UnifiedPackageArtifactDescriptor;
  sourceArtifacts: CanonicalAeoEditingBoundSourceArtifact[];
  selectedUnitIds: string[];
  currentSourceRefs: CanonicalAeoEditingSourceRef[];
  draftTitle: string;
  authority: 'HOST_OWNED_INPUT_ACTUAL_BYTES_REVALIDATED_ON_USE';
}

export interface CanonicalAeoEditingBlockingGap {
  code:
    | 'AEO_MISSING_INPUT'
    | 'AEO_SOURCE_CONFLICT'
    | 'AEO_TYPED_FIGURE_OR_TABLE_NOT_PROJECTED'
    | 'AEO_SPECIALIZED_CONTROL_REQUIRES_ENGINEER_REVIEW';
  message: string;
  sourceRefs: CanonicalAeoEditingSourceRef[];
  blocking: true;
}

export interface CanonicalAeoEditingDraftProjection {
  schemaVersion: 'wiselink.3_1.aeo_editing_draft_projection.v0.candidate.1';
  status: 'CANDIDATE_ONLY';
  revision: number;
  generationRevision: number;
  basedOnInputRevision: number;
  currentProducerArtifactSha256: string;
  sourceManifestArtifactSha256: string;
  suggestionCount: number;
  blockCount: number;
  blockingGapCount: number;
  feedbackCount: number;
  doNotLearnFeedbackCount: number;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
  adoptionDecisions: [];
  automaticallyAdopted: false;
  engineeringApproved: false;
  productionPublished: false;
  currentChanged: false;
}

export interface CanonicalAeoEditingDraftCreateRequest {
  expectedRevision: number;
}

export interface CanonicalAeoEditingDraftFeedbackRequest {
  expectedRevision: number;
  feedbackId: string;
  suggestionId: string;
  expectedGenerationRevision: number;
  decision: 'ACCEPT' | 'MODIFY' | 'REJECT';
  note: string;
  revisedBodyZh?: string | null;
  revisedBodyEn?: string | null;
  revisionSourceRefs?: CanonicalAeoEditingSourceRef[];
  semanticField: string;
  reasonCode:
    | 'SOURCE_MISMATCH'
    | 'APPLICABILITY'
    | 'COMPANY_PROCESS'
    | 'EXECUTABILITY'
    | 'SAFETY'
    | 'DUPLICATE'
    | 'SUPERSEDED'
    | 'TERMINOLOGY'
    | 'LAYOUT'
    | 'ROLE'
    | 'TEST_OR_ACCEPTANCE'
    | 'RESTORATION'
    | 'OTHER';
  learningDisposition:
    | 'THIS_DRAFT_ONLY'
    | 'SERIES_PATTERN_CANDIDATE'
    | 'CATEGORY_PATTERN_CANDIDATE'
    | 'DO_NOT_LEARN';
}

export interface CanonicalAeoEditingDraftReadModel {
  schemaVersion: 'wiselink.3_1.aeo_editing_draft_read_model.v0.candidate.1';
  status: 'CANDIDATE_ONLY';
  workItemId: string;
  workItemRevision: number;
  documentVersionId: string;
  sourcePackageId: string;
  projection: CanonicalAeoEditingDraftProjection;
  title: string;
  generationRevision: number;
  sources: Array<{
    sourceId: string;
    role: string;
    artifactRef: string;
    artifactSha256: string;
    byteLength: number;
    observedIdentity: string | null;
  }>;
  currentSourceRefs: CanonicalAeoEditingSourceRef[];
  suggestions: Array<{
    suggestionId: string;
    sourceUnitId: string;
    section: string;
    kind: 'APPLICABLE_TEMPLATE_CANDIDATE' | 'COMPANY_STEP_CANDIDATE';
    bodyZh: string | null;
    bodyEn: string | null;
    parameters: unknown[];
    conditions: unknown[];
    conditionSourceRefs: CanonicalAeoEditingSourceRef[];
    dependencies: unknown[];
    branches: Array<{
      when: string;
      then: string;
      sourceRefs: CanonicalAeoEditingSourceRef[];
    }>;
    performerRoles: string[];
    inspectorRoles: string[];
    signatureGranularity: string | null;
    verifications: unknown[];
    closeout: unknown[];
    safetyNotes: unknown[];
    inspectionDetail: {
      area: Record<string, unknown>;
      method: Record<string, unknown>;
      referenceCondition: Record<string, unknown>;
      thresholdsAndLimits: unknown[];
      findingClassification: Record<string, unknown>;
      repeatInterval: Record<string, unknown>;
      ndt: Record<string, unknown>;
      recording: Record<string, unknown>;
      explicitAbsences: string[];
    } | null;
    sourceRefs: CanonicalAeoEditingSourceRef[];
    reviewStatus:
      | 'PENDING_ENGINEER_REVIEW'
      | 'ACCEPTED_CANDIDATE'
      | 'MODIFIED_CANDIDATE'
      | 'REJECTED_CANDIDATE';
    engineerDecisionRef: string | null;
  }>;
  blocks: import('./aeo-editor').AeoContentBlock[];
  blockingGaps: CanonicalAeoEditingBlockingGap[];
  feedback: Array<{
    feedbackId: string;
    suggestionId: string;
    targetGenerationRevision: number;
    decision: 'ACCEPT' | 'MODIFY' | 'REJECT';
    engineerDecisionRef: string;
    note: string;
    reasonCode: CanonicalAeoEditingDraftFeedbackRequest['reasonCode'];
    learningDisposition: CanonicalAeoEditingDraftFeedbackRequest['learningDisposition'];
    sourceRefs: CanonicalAeoEditingSourceRef[];
  }>;
  learning: {
    eligibleFeedbackCount: number;
    excludedDoNotLearnFeedbackIds: string[];
    boundary: 'FEEDBACK_INPUT_NOT_AUTOMATIC_RULE_NOT_AUTHORITY';
  };
  adoptionDecisions: [];
  nonClaims: string[];
  authority: {
    candidateOnly: true;
    automaticallyAdopted: false;
    engineeringApproved: false;
    signed: false;
    sent: false;
    productionPublished: false;
    currentChanged: false;
  };
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
  translation?: CanonicalTranslationCandidateProjection | null;
  applicabilityControlledSelection?: CanonicalApplicabilityControlledSelectionProjection | null;
  applicabilityInput?: CanonicalApplicabilityInputProjection | null;
  applicability?: CanonicalApplicabilityCandidateProjection | null;
  assessment?: CanonicalAssessmentCandidateProjection | null;
  integratedAssessment?: CanonicalIntegratedAssessmentProjection | null;
  overallRegenerationRequest?: CanonicalOverallRegenerationRequestProjection | null;
  aeo?: CanonicalAeoCandidateProjection | null;
  aeoEditingInput?: CanonicalAeoEditingInputProjection | null;
  aeoEditingDraft?: CanonicalAeoEditingDraftProjection | null;
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

export interface CanonicalDevelopmentWorkItemRunRequest {
  documentVersionId?: string;
  selection?: {
    bucketId: string;
    filePath: string;
  };
  developmentRunToken: string;
  query?: string;
}

export interface CanonicalOrdinaryWorkItemRunResponse {
  schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1';
  workItemCreated: boolean;
  workItemReused: boolean;
  actionAttemptId: string;
  result: CanonicalPdfVerticalRunResponse;
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
  integratedAssessmentSummary: CanonicalIntegratedAssessmentProjection | null;
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

export type CanonicalWorkbenchTargetNode =
  | 'document'
  | 'package'
  | 'reader'
  | 'assessment'
  | 'overall'
  | 'aeo';

export type CanonicalLibraryIndexNodeKind =
  | 'WORK_ITEM'
  | 'DOCUMENT'
  | 'DOCUMENT_VERSION'
  | 'PARSED_PACKAGE'
  | 'READER_QUERY'
  | 'DYNAMIC_EVALUATION'
  | 'OVERALL_SYNTHESIS'
  | 'ENGINEER_REVIEW'
  | 'AEO_CANDIDATE';

export interface CanonicalLibraryIndexNode {
  id: string;
  parentId: string | null;
  kind: CanonicalLibraryIndexNodeKind;
  label: string;
  detail: string;
  state: string;
  targetNode: CanonicalWorkbenchTargetNode;
  authority:
    | 'HOST_WORKITEM_PROJECTION'
    | 'HOST_READER_PROJECTION'
    | 'HOST_ENGINEER_REVIEW_CONTEXT';
}

export interface CanonicalLibraryIndexProjection {
  schemaVersion: 'wiselink.3_1.library_index_projection.v0.candidate';
  scope: 'CURRENT_WORKITEM_ONLY';
  workItemId: string;
  rootLabel: string;
  nodes: CanonicalLibraryIndexNode[];
  completeness: {
    crossWorkItemLibraryAvailable: false;
    relatedDocumentIndexAvailable: false;
    note: string;
  };
}

export interface CanonicalLibraryIndexReadResponse {
  schemaVersion: 'wiselink.3_1.library_index_read.v0.candidate';
  scope: 'CURRENT_WORKITEM_ONLY';
  workItem: {
    workItemId: string;
    revision: number;
    phase: string;
  };
  document: {
    documentId: string;
    documentVersionId: string;
    documentCode: string;
    businessRevision: string;
    normalizedFamily: string;
  };
  currentness: {
    familyId: string;
    currentDocumentVersionId: string | null;
    currentGeneration: number;
    selectedVersionIsCurrent: boolean;
  };
  libraryIndex: CanonicalLibraryIndexProjection;
  readAuthorization: {
    action: 'READ_LIBRARY_INDEX';
    decisionId: string;
    permissionSnapshotVersion: string;
  };
}

export interface CreateEngineeringMatterRequest {
  requestId: string;
  title: string;
  primaryWorkItemId: string;
}

export interface LinkEngineeringMatterWorkItemRequest {
  requestId: string;
  expectedMatterRevision: number;
  workItemId: string;
  changeSummary?: string;
}

export type EngineeringMatterWorkItemRole = 'PRIMARY' | 'RELATED';

export interface EngineeringMatterCatalogEntry {
  workItemId: string;
  relationRole: EngineeringMatterWorkItemRole;
  linkedAtWorkItemRevision: number;
  currentWorkItemRevision: number;
  workItemChangedSinceLink: boolean;
  workItemStatus: string;
  document: {
    documentId: string;
    documentVersionId: string;
    documentCode: string;
    businessRevision: string;
    normalizedFamily: string;
  };
  documentCurrentness: {
    familyId: string;
    currentDocumentVersionId: string | null;
    currentGeneration: number;
    selectedVersionIsCurrent: boolean;
  };
  sourceNavigation:
    | {
        status: 'AVAILABLE';
        sourceRefCount: number;
        structuredContentPath: string;
      }
    | {
        status: 'NOT_PARSED';
        sourceRefCount: 0;
        structuredContentPath: null;
      };
}

/**
 * Browser-safe cross-WorkItem catalog. It contains no tenant, actor, artifact
 * locator, content-addressed package id, file hash, permission fingerprint, or
 * server-side session value.
 */
export interface EngineeringMatterReadModel {
  schemaVersion: 'wiselink.3_1.engineering_matter_catalog.v1';
  matterId: string;
  title: string;
  status: 'ACTIVE';
  currentRevision: {
    matterRevisionId: string;
    revisionNo: number;
    changeKind: 'CREATED' | 'WORK_ITEM_LINKED';
    changeSummary: string;
    createdAt: string;
  };
  catalog: {
    scope: 'CROSS_WORK_ITEM';
    entries: EngineeringMatterCatalogEntry[];
  };
  authorization: {
    policy: 'ALL_LINKED_WORK_ITEMS_REQUIRED';
    authorizedWorkItemCount: number;
  };
  authority: {
    workItemCurrentRemainsAuthoritative: true;
    documentManagementRemainsAuthoritative: true;
    sourceRefsRemainWorkItemScoped: true;
    matterCreatesAssessmentCurrent: false;
  };
}

export interface CreateEngineeringMatterResponse {
  matter: EngineeringMatterReadModel;
  created: boolean;
}

export interface LinkEngineeringMatterWorkItemResponse {
  matter: EngineeringMatterReadModel;
  linked: boolean;
  replayed: boolean;
}

export type CanonicalRelatedDocumentRelationRole =
  | 'SELECTED_DOCUMENT_VERSION'
  | 'PRODUCED_PARSED_PACKAGE'
  | 'HAS_READER_RESULTS'
  | 'HAS_DYNAMIC_EVALUATION'
  | 'HAS_ENGINEER_REVIEW'
  | 'HAS_OVERALL_SYNTHESIS'
  | 'HAS_AEO_CANDIDATE';

export interface CanonicalRelatedDocumentRelation {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationRole: CanonicalRelatedDocumentRelationRole;
  label: string;
  sourceLocator: string;
  resolution: 'RESOLVED';
  authority: 'EXPLICIT_WORKITEM_BINDING' | 'DERIVED_FROM_CURRENT_PROJECTION';
}

export interface CanonicalRelatedDocumentProjection {
  schemaVersion: 'wiselink.3_1.related_document_projection.v0.candidate';
  scope: 'CURRENT_WORKITEM_ONLY';
  workItemId: string;
  relations: CanonicalRelatedDocumentRelation[];
  boundary: {
    externalRelatedDocumentsInferred: false;
    note: string;
  };
}

export interface CanonicalWorkbenchAuditProjection {
  schemaVersion: 'wiselink.3_1.workbench_audit_projection.v0.candidate';
  workItemId: string;
  packageReadback: {
    packageId: string | null;
    contractRevision: string | null;
    resultStatus: string | null;
    contentUnitCount: number;
    sourceRefCount: number;
    artifactRef: string | null;
    artifactSha256: string | null;
  };
  reader: {
    queryResultCount: number;
    sourceBoundResultCount: number;
    uniqueSourceRefCount: number;
    allReturnedResultsSourceBound: boolean;
    applicabilityConclusionAllowed: false;
    note: string;
  };
  applicabilityAuthority: {
    sourceExpressionCount: number | null;
    normalizedCandidateCount: number | null;
    assignmentCount: number | null;
    inferredFromDocumentPresence: false;
  };
  dynamicEvaluation: {
    status: string;
    criterionSetId: string;
    criterionCount: number;
    evaluationItemCount: number;
    unresolvedCount: number;
    sourceBoundCandidateCount: number;
    artifactSha256: string;
    actionAttemptId: string;
  } | null;
  engineerReview: {
    revision: number;
    reviewCount: number;
    effectiveReviewedCount: number;
    actionAttemptId: string;
  } | null;
  overallSynthesis: {
    status: string;
    revision: number;
    discoveryStatus: string;
    gap: string | null;
    findingCount: number;
    candidateRefCount: number;
    unresolvedCount: number;
    staleReason: string | null;
    artifactSha256: string;
    actionAttemptId: string;
  } | null;
  candidateFormationSteps: {
    id: string;
    label: string;
    status: string;
    summary: string;
    evidenceRef: string;
  }[];
}

export interface CanonicalTimelineEvent {
  id: string;
  sequence: number;
  kind:
    | 'WORKITEM_REVISION'
    | 'DOCUMENT_VERSION_BOUND'
    | 'PACKAGE_READBACK'
    | 'READER_QUERY'
    | 'DYNAMIC_EVALUATION'
    | 'ENGINEER_REVIEW'
    | 'OVERALL_SYNTHESIS'
    | 'OVERALL_CONFIRMATION'
    | 'AEO_CANDIDATE'
    | 'FAILURE';
  label: string;
  status: string;
  detail: string;
  occurredAt: string | null;
  revision: number | null;
  artifactRef: string | null;
  actionAttemptId: string | null;
}

export interface CanonicalTimelineProjection {
  schemaVersion: 'wiselink.3_1.timeline_projection.v0.candidate';
  workItemId: string;
  events: CanonicalTimelineEvent[];
  boundary: {
    onlyServerObservedEvents: true;
    note: string;
  };
}

export interface CanonicalDocumentParsingPageResponse {
  schemaVersion: 'wiselink.3_1.document_parsing_page.v0.candidate';
  status: 'FRESH_READ';
  workItem: CanonicalWorkItemProjection;
  entry: CanonicalEntryFacadeResponse;
  queryResults: UnifiedReaderQueryResult[];
  readerProjection?: CanonicalReaderProjection | null;
  engineerReviewContext?: CanonicalEngineerReviewPageContext | null;
  libraryIndex: CanonicalLibraryIndexProjection;
  relatedDocuments: CanonicalRelatedDocumentProjection;
  workbenchAudit: CanonicalWorkbenchAuditProjection;
  timeline: CanonicalTimelineProjection;
  readAuthorization: {
    action: 'READ_DOCUMENT_PARSING';
    decisionId: string;
    permissionSnapshotVersion: string;
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
  reviewDecision: 'HUMAN_SELECTED_FOR_INGEST' | 'HUMAN_REJECTED' | null;
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
  failureCode: string | null;
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
