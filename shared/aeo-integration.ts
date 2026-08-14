import type {
  AeoCanonicalRoleGateResult,
  AeoWorkItemBindingBlocker,
} from './aeo-editor';

export const AEO_ARTIFACT_INDEX_VERSION =
  'wiselink.3_1.aeo_artifact_index.v0.candidate.2' as const;
export const AEO_AILY_TOOLSET_VERSION =
  'wiselink.3_1.aeo_aily_toolset.v0.candidate' as const;
export const AEO_ARTIFACT_ACTION_VERSION =
  'wiselink.3_1.aeo_artifact_action.v0.candidate.2' as const;
export const AEO_WORKING_COPY_ARTIFACT_VERSION =
  'wiselink.3_1.aeo_working_copy_artifact.v0.candidate' as const;
export const AEO_DRAFT_PACKAGE_ARTIFACT_VERSION =
  'wiselink.3_1.aeo_draft_package_artifact.v0.candidate' as const;
export const AEO_WORD_CANDIDATE_ARTIFACT_VERSION =
  'wiselink.3_1.aeo_word_candidate_artifact.v0.candidate' as const;
export const AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION =
  'wiselink.3_1.aeo_authoring_bootstrap_artifact.v0.candidate' as const;
export const AEO_AUTHORING_SESSION_VERSION =
  'wiselink.3_1.aeo_authoring_session.v0.candidate' as const;
export const AEO_HOSTED_PLATFORM_BINDING_VERSION =
  'wiselink.3_1.aeo_hosted_platform_binding.v0.candidate.5' as const;
export const AEO_HOSTED_PLATFORM_ACTIVATION_VERSION =
  'wiselink.3_1.aeo_hosted_platform_activation.v0.candidate.4' as const;
export const AEO_HOSTED_ACTIVATION_RECEIPT_VERSION =
  'wiselink.3_1.aeo_hosted_activation_receipt.v0.candidate.3' as const;
export const AEO_HOSTED_PLATFORM_READINESS_VERSION =
  'wiselink.3_1.aeo_hosted_platform_readiness.v0.candidate.6' as const;
export const AEO_HOSTED_CANDIDATE_VERTICAL_VERSION =
  'wiselink.3_1.aeo_hosted_candidate_vertical.v0.candidate.3' as const;
export const AEO_VALIDATION_WRITE_RECEIPT_VERSION =
  'wiselink.3_1.aeo_validation_write_receipt.v0.candidate.1' as const;
export const AEO_VALIDATION_MANIFEST_VERSION =
  'wiselink.3_1.aeo_validation_manifest.v0.candidate' as const;
export const AEO_UNIFIED_ACCEPTANCE_READER_REVISION =
  'aeo-structured-parse-reader.candidate.1' as const;
export const AEO_UNIFIED_ACCEPTANCE_READER_PORT =
  'wiselink.3_1.port.aeo_specialist_reader.v0.candidate' as const;
export const UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_TOKEN =
  'IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER' as const;
export const UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_REVISION =
  'wiselink.3_1.port.immutable_acceptance_receipt_owner.v0.candidate.1' as const;
export const UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_FINGERPRINT =
  'sha256:ae9b18dbe086a04e5a8a8acaca2192d2f1075f572a0adea7fc3f1d56f975da5c' as const;
export const WISELINK_3_1_UNIFIED_POST_VALIDATOR_RECEIPT_OWNER_COMMIT =
  '04e21300dfbfe8ca501e62ea4ccd56be71f55ba4' as const;
export const WISELINK_3_1_R1_SELECTION_COMMIT =
  'd0bfbacfdce4dda172cdc9af29aa86e0b81c5b32' as const;
export const WISELINK_3_1_UNIFIED_SOURCE_BASELINE_COMMIT =
  '0ae998139ea6ccf0800e1aac380d5c06a1aec4c2' as const;
export const WISELINK_3_1_U0_VALIDATOR_COMMIT =
  'fa69ada08265934951df53c7a61a3ccdb8cb2900' as const;
export const WISELINK_3_1_U0_MANIFEST_SHA256 =
  '730baa88e7254bac6d3808ca2ddbfb1824c5891d6ce3d6d29ce177431cd5ffc0' as const;
export const WISELINK_3_1_TECHPUB_PACKAGE_CONTRACT =
  'techpub.parsed-package.v1/frozen.2' as const;
export const WISELINK_3_1_AEO_VALIDATION_PURPOSE =
  'AEO_CANDIDATE_VERTICAL' as const;
export const WISELINK_3_1_UNIFIED_ACCEPTANCE_FACADE_REVISION =
  'unified-acceptance-facade.candidate.2' as const;
export const WISELINK_3_1_UNIFIED_ACCEPTANCE_RECEIPT_VERSION =
  'wiselink.3_1.unified_acceptance_receipt.v0.candidate.2' as const;
export const WISELINK_3_1_UNIFIED_ACCEPTANCE_OWNED_RECEIPT_VERSION =
  'wiselink.3_1.unified_acceptance_owned_receipt.v0.candidate.1' as const;

export type AeoHostedPlatformPortName =
  | 'CANONICAL_ROLE_RESOLVER'
  | 'WORK_ITEM_READ'
  | 'SIMILAR_SEARCH'
  | 'ARTIFACT_STORE'
  | 'HUB_REGISTRAR'
  | 'U0_FULL_PACKAGE_VALIDATOR'
  | 'AEO_SPECIALIST_READER'
  | 'UNIFIED_ACCEPTANCE_FACADE'
  | 'IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER';

export type AeoHostedPlatformPortOwner =
  | 'WiseLink3_1Master'
  | 'CanonicalWorkItemStore'
  | 'CanonicalArtifactStore'
  | 'CanonicalUnifiedReader'
  | 'CanonicalUnifiedAcceptanceReceiptOwner'
  | 'CanonicalHubRegistrar'
  | 'AeoModule';

export interface AeoR1ContractSelection {
  selectionDecisionCommit: typeof WISELINK_3_1_R1_SELECTION_COMMIT;
  techpubPackageContract: typeof WISELINK_3_1_TECHPUB_PACKAGE_CONTRACT;
  u0ValidatorCommit: typeof WISELINK_3_1_U0_VALIDATOR_COMMIT;
  u0ManifestSha256: typeof WISELINK_3_1_U0_MANIFEST_SHA256;
  unifiedSourceBaselineCommit: typeof WISELINK_3_1_UNIFIED_SOURCE_BASELINE_COMMIT;
  aeoValidationPurpose: typeof WISELINK_3_1_AEO_VALIDATION_PURPOSE;
  scopeField: 'ABSENT';
  aeoSpecialistPortToken: typeof AEO_UNIFIED_ACCEPTANCE_READER_PORT;
  aeoSpecialistRevision: typeof AEO_UNIFIED_ACCEPTANCE_READER_REVISION;
  unifiedAcceptanceFacadeRevision: typeof WISELINK_3_1_UNIFIED_ACCEPTANCE_FACADE_REVISION;
  unifiedAcceptanceReceiptVersion: typeof WISELINK_3_1_UNIFIED_ACCEPTANCE_RECEIPT_VERSION;
  unifiedAcceptanceOwnedReceiptVersion: typeof WISELINK_3_1_UNIFIED_ACCEPTANCE_OWNED_RECEIPT_VERSION;
  unifiedPostValidatorReceiptOwnerCommit: typeof WISELINK_3_1_UNIFIED_POST_VALIDATOR_RECEIPT_OWNER_COMMIT;
  immutableAcceptanceReceiptOwnerToken: typeof UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_TOKEN;
  immutableAcceptanceReceiptOwnerRevision: typeof UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_REVISION;
  immutableAcceptanceReceiptOwnerFingerprint: typeof UNIFIED_IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_FINGERPRINT;
  artifactDigestWire: 'LOWERCASE_HEX_64';
  semanticDigestWire: 'SHA256_PREFIXED_LOWERCASE_HEX_64';
}

export interface AeoHostedPlatformPortActivation {
  status: 'UNCONFIGURED' | 'ACTIVE';
  owner: AeoHostedPlatformPortOwner | null;
  adapterId: string | null;
  adapterRevision: string | null;
  adapterFingerprint: string | null;
  activationRef: string | null;
}

export interface AeoHostedPlatformActivationManifest {
  schemaVersion: typeof AEO_HOSTED_PLATFORM_ACTIVATION_VERSION;
  activationId: string;
  activationRevision: string;
  roleResolutionVersion: string;
  roleSetFingerprint: string;
  tenantRef: string;
  environmentRef: string;
  runtimeBindings: {
    canonicalMiaodaAppRef: string;
    canonicalWorkItemStoreRef: string;
    canonicalArtifactStoreRef: string;
    canonicalUnifiedReaderRef: string;
    canonicalHubRegistrarServiceRef: string;
    artifactStoreLocationRef: string;
    immutableAcceptanceReceiptOwnerRef: string;
  };
  r1Selection: AeoR1ContractSelection;
  ports: Record<AeoHostedPlatformPortName, AeoHostedPlatformPortActivation>;
  authority: 'ACTIVATION_ATTESTATION_NOT_WRITE_AUTHORIZATION';
}

export interface AeoHostedPlatformBindingDescriptor {
  schemaVersion: typeof AEO_HOSTED_PLATFORM_BINDING_VERSION;
  bindingId: string;
  bindingRevision: string;
  mode: 'UNCONFIGURED' | 'HOSTED_CANDIDATE' | 'ACTIVE';
  activationManifest: AeoHostedPlatformActivationManifest | null;
  activationManifestSha256: string | null;
  authority: 'BINDING_DESCRIPTOR_NOT_WRITE_AUTHORIZATION';
}

export interface AeoHostedActivationReceipt {
  schemaVersion: typeof AEO_HOSTED_ACTIVATION_RECEIPT_VERSION;
  receiptId: string;
  receiptArtifactRef: string;
  receiptCanonicalSha256: string;
  bindingId: string;
  bindingRevision: string;
  activationManifestArtifactRef: string;
  activationManifestArtifactSha256: string;
  activationManifestCanonicalSha256: string;
  issuedBy: 'WiseLink3_1Master';
  authorizedByDecisionId: string;
  issuedAt: string;
  expiresAt: string;
  authority: 'MASTER_ACTIVATION_RECEIPT_NOT_WRITE_AUTHORIZATION';
}

export interface AeoHostedActivationAuthorityVerification {
  receiptId: string;
  receiptArtifactRef: string;
  receiptArtifactSha256: string;
  receiptCanonicalSha256: string;
  activationManifestArtifactRef: string;
  activationManifestArtifactSha256: string;
  activationManifestCanonicalSha256: string;
  issuedBy: 'WiseLink3_1Master';
  authorizedByDecisionId: string;
  issuedAt: string;
  expiresAt: string;
  verified: true;
}

export interface AeoHostedPlatformReadinessBlocker {
  code:
    | 'AEO_CANONICAL_ROLES_BLOCKED'
    | 'AEO_HOSTED_BINDING_INVALID'
    | 'AEO_HOSTED_BINDING_NOT_ACTIVE'
    | 'AEO_HOSTED_ACTIVATION_MISSING'
    | 'AEO_HOSTED_ACTIVATION_HASH_MISMATCH'
    | 'AEO_HOSTED_ACTIVATION_AUTHORITY_UNAVAILABLE'
    | 'AEO_HOSTED_ACTIVATION_RECEIPT_INVALID'
    | 'AEO_HOSTED_ACTIVATION_RECEIPT_HASH_MISMATCH'
    | 'AEO_HOSTED_ACTIVATION_RECEIPT_CANONICAL_HASH_MISMATCH'
    | 'AEO_HOSTED_ACTIVATION_RECEIPT_EXPIRED'
    | 'AEO_HOSTED_ACTIVATION_RECEIPT_BINDING_MISMATCH'
    | 'AEO_HOSTED_ACTIVATION_MANIFEST_READBACK_MISMATCH'
    | 'AEO_HOSTED_R1_SELECTION_MISMATCH'
    | 'AEO_HOSTED_RUNTIME_BINDING_MISMATCH'
    | 'AEO_HOSTED_ROLE_RESOLUTION_MISMATCH'
    | 'AEO_HOSTED_ROLE_FINGERPRINT_MISMATCH'
    | 'AEO_HOSTED_ENVIRONMENT_MISMATCH'
    | 'AEO_HOSTED_PORT_UNCONFIGURED'
    | 'AEO_HOSTED_PORT_OWNER_INVALID';
  component: AeoHostedPlatformPortName | null;
  message: string;
}

export interface AeoHostedPlatformReadinessResult {
  schemaVersion: typeof AEO_HOSTED_PLATFORM_READINESS_VERSION;
  status: 'READY' | 'BLOCKED';
  observedAt: string;
  binding: AeoHostedPlatformBindingDescriptor | null;
  activationAuthority: AeoHostedActivationAuthorityVerification | null;
  roleResolutionVersion: string | null;
  roles: import('./aeo-editor').AeoCanonicalRoleResolution[];
  roleBlockers: import('./aeo-editor').AeoWorkItemBindingBlocker[];
  bindingBlockers: AeoHostedPlatformReadinessBlocker[];
  authority: 'READINESS_ONLY_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION';
}

export interface AeoHostedCandidateVerticalRequest {
  schemaVersion: typeof AEO_HOSTED_CANDIDATE_VERTICAL_VERSION;
  workItemId: string;
  requestId: string;
  requesterRef: string;
  permissionSnapshotVersion: string;
  expectedStateVersion: number;
  runId: string;
  confirmation: 'RUN_AEO_CANDIDATE_VERTICAL';
}

export interface AeoHostedCandidateVerticalResult {
  schemaVersion: typeof AEO_HOSTED_CANDIDATE_VERTICAL_VERSION;
  status: 'COMPLETED' | 'BLOCKED';
  workItemId: string;
  requestId: string;
  runId: string;
  initialStateVersion: number;
  finalStateVersion: number | null;
  readiness: AeoHostedPlatformReadinessResult;
  steps: AeoArtifactActionResult[];
  finalSession: AeoAuthoringSessionResult | null;
  validationBlockers: Array<{
    code:
      | 'AEO_HOSTED_PLATFORM_NOT_READY'
      | 'AEO_MASTER_ACTIVATION_REQUEST_MISMATCH'
      | 'AEO_VALIDATION_PURPOSE_NOT_AUTHORIZED'
      | 'AEO_VALIDATION_MANIFEST_INVALID'
      | 'AEO_VALIDATION_MANIFEST_EXPIRED'
      | 'AEO_VALIDATION_ACTIVATION_MISMATCH'
      | 'AEO_VALIDATION_WORKITEM_NOT_CLEAN'
      | 'AEO_VALIDATION_STEP_BLOCKED'
      | 'AEO_VALIDATION_FINAL_READBACK_FAILED';
    message: string;
  }>;
  validationWriteAuthorizations: AeoValidationWriteAuthorizationVerification[];
  authority: 'VALIDATION_CANDIDATES_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY';
}

export interface AeoValidationManifest {
  schemaVersion: typeof AEO_VALIDATION_MANIFEST_VERSION;
  manifestId: string;
  purpose: 'AEO_CANDIDATE_VERTICAL';
  workItemId: string;
  requestId: string;
  runId: string;
  initialStateVersion: number;
  permissionSnapshotVersion: string;
  roleResolutionVersion: string;
  activationManifestSha256: string;
  issuedBy: 'CanonicalWorkItemStore';
  authorizedByDecisionId: string;
  issuedAt: string;
  expiresAt: string;
  authority: 'VALIDATION_SCOPE_ONLY_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY';
}

export interface AeoUnifiedAcceptanceSpecialistContext {
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

export interface AeoUnifiedAcceptanceReaderInput {
  artifact: {
    storeRole: 'UnifiedArtifactStoreCandidate';
    ref: string;
    sha256: string;
    byteLength: number;
    mediaType: 'application/json';
  };
  bytes: Uint8Array;
  packageId: string;
  context: AeoUnifiedAcceptanceSpecialistContext;
}

export interface AeoUnifiedAcceptanceReaderInspection {
  packageId: string;
  contractId: 'aeo_structured_parse_v1';
  contractRevision: 'candidate.1';
  handlerId: 'AeoStructuredParseCandidateReader';
  handlerRevision: typeof AEO_UNIFIED_ACCEPTANCE_READER_REVISION;
  summaryHash: string;
  sourceBoundUnitCount: number;
}

export type AeoArtifactKind =
  | 'SOURCE_DOCUMENT'
  | 'PARSED_PACKAGE'
  | 'AUTHORING_BOOTSTRAP'
  | 'WORKING_COPY'
  | 'DRAFT_PACKAGE'
  | 'WORD_EXPORT'
  | 'RELEASE_PACKAGE'
  | 'XML_EXPORT';

export interface AeoArtifactIndexEntry {
  artifactKind: AeoArtifactKind;
  storeRole: 'CanonicalArtifactStore';
  artifactRef: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: string;
  schemaVersion: string;
  workingRevision: number | null;
  casToken: string | null;
  state: 'AVAILABLE' | 'CANDIDATE' | 'BLOCKED';
}

export interface AeoAcceptedParsedPackagePointer {
  packageId: string;
  artifactRef: string;
  artifactSha256: string;
  contractId: string;
  contractRevision: string;
  readerReceiptId: string;
  readerRevision: string;
  validationStatus: 'ACCEPTED';
}

export interface AeoSourceParsedPackagePointer {
  packageId: string;
  artifactRef: string;
  artifactSha256: string;
  contractId: string;
  contractRevision: string;
  readerReceiptId: string;
  fullValidatorRevision: string;
  validationStatus: 'ACCEPTED';
}

export interface AeoAssessmentContextPointer {
  status: 'CANDIDATE_ONLY' | 'CANDIDATE_ONLY_RESYNTHESIZED';
  criterionSetId: string;
  criterionCount: number;
  evaluationItemCount: number;
  packageStatus: string;
  applicabilityOverall: string;
  authorityLevel: 'candidate_only';
  blocksEngineeringClosure: true;
  externalDiscoveryStatus: string | null;
  externalDiscoveryIsEvidence: false;
  previousOverallStale: boolean;
  staleReason: 'ENGINEER_ITEM_SET_CHANGED' | 'EXTERNAL_CONTEXT_STALE' | null;
  currentContextHash: string;
  currentTransportHash: string;
  artifactRef: string;
  artifactSha256: string;
  artifactByteLength: number;
  evaluateAttemptId: string;
  resynthesisAttemptId: string | null;
}

export interface AeoServerConfirmedTargetIdentity {
  value: string;
  confirmationStatus: 'HUMAN_CONFIRMED';
  authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ';
  confirmationRef: string;
}

export interface AeoWorkItemReadModel {
  schemaVersion: typeof AEO_ARTIFACT_INDEX_VERSION;
  workItemId: string;
  requestId: string;
  stateVersion: number;
  permissionSnapshotVersion: string;
  sourceDocumentFamily: 'AEO' | 'SB';
  authoringPurpose: 'AEO';
  aeoTargetIdentity: AeoServerConfirmedTargetIdentity;
  validationRun: {
    purpose: 'AEO_CANDIDATE_VERTICAL';
    runId: string;
    manifestArtifactRef: string;
    manifestArtifactSha256: string;
    authorizedByDecisionId: string;
  } | null;
  sourceContext: {
    document: {
      documentId: string;
      documentVersionId: string;
      classificationStatus: 'CONFIRMED';
      catalogRole: 'CanonicalDocumentCatalog';
      classificationFingerprint: string;
    };
    parsedPackage: AeoSourceParsedPackagePointer;
    assessment: AeoAssessmentContextPointer | null;
  };
  authoringSeed: {
    document: {
      documentId: string;
      documentVersionId: string;
      family: 'AEO';
      classificationStatus: 'CONFIRMED';
      catalogRole: 'CanonicalDocumentCatalog';
      classificationFingerprint: string;
    };
    parsedPackage: AeoAcceptedParsedPackagePointer;
    aeoIdentity: string;
  };
  aeo: {
    state:
      | 'NOT_STARTED'
      | 'PARSE_READY'
      | 'AUTHORING'
      | 'CHECKPOINTED'
      | 'BLOCKED';
    stateVersion: string;
    summary: string;
    blockers: string[];
  };
  artifactIndex: AeoArtifactIndexEntry[];
  todos: Array<{
    todoId: string;
    label: string;
    state: 'OPEN' | 'DONE' | 'BLOCKED';
  }>;
  observedAt: string;
}

export interface AeoWorkItemReadRequest {
  workItemId: string;
  requesterRef: string;
  permissionSnapshotVersion: string;
}

export interface AeoSimilarCandidateSummary {
  candidateId: string;
  sourceKind:
    | 'HISTORICAL_AEO'
    | 'CATEGORY_PATTERN'
    | 'SB_SOURCE'
    | 'OEM_REFERENCE'
    | 'AI_SUGGESTION';
  title: string;
  reason: string;
  sourceArtifactRef: string;
  sourceArtifactSha256: string;
  eligibility: 'CANDIDATE_REQUIRES_REVIEW';
}

export interface AeoAilyToolRequestBase extends AeoWorkItemReadRequest {
  expectedStateVersion: number;
}

export interface AeoAilyToolResponseBase {
  schemaVersion: typeof AEO_AILY_TOOLSET_VERSION;
  status: 'READY' | 'BLOCKED';
  tool:
    | 'aeo.find_similar'
    | 'aeo.start_authoring'
    | 'aeo.check_draft'
    | 'aeo.list_todos'
    | 'workitem.get_deep_link';
  workItemId: string;
  stateVersion: number | null;
  observedAt: string;
  blockers: AeoWorkItemBindingBlocker[];
  deepLink: string | null;
  authority: 'AILY_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY';
}

export interface AeoFindSimilarRequest extends AeoAilyToolRequestBase {
  query: string;
  filters?: {
    sourceKinds?: AeoSimilarCandidateSummary['sourceKind'][];
  };
}

export interface AeoStartAuthoringRequest extends AeoAilyToolRequestBase {
  templateKey?: string;
}

export interface AeoCheckDraftRequest extends AeoAilyToolRequestBase {
  draftRef?: string;
}

export interface AeoListTodosRequest extends AeoAilyToolRequestBase {}

export interface AeoGetDeepLinkRequest extends AeoAilyToolRequestBase {}

export interface AeoAilyToolResponse extends AeoAilyToolResponseBase {
  summary: string;
  result:
    | { kind: 'SIMILAR_CANDIDATES'; items: AeoSimilarCandidateSummary[] }
    | {
        kind: 'AUTHORING_ENTRY';
        aeoState: AeoWorkItemReadModel['aeo']['state'];
        templateKey: string | null;
        actionRequired: 'OPEN_MIAODA';
      }
    | {
        kind: 'DRAFT_CHECK';
        draft: AeoArtifactIndexEntry | null;
        blockingFindings: string[];
      }
    | { kind: 'TODOS'; items: AeoWorkItemReadModel['todos'] }
    | { kind: 'DEEP_LINK' }
    | { kind: 'NONE' };
}

export interface AeoCanonicalRoleGateProvider {
  readRoleGate(): AeoCanonicalRoleGateResult;
}

export type AeoArtifactActionKind =
  | 'BOOTSTRAP_FROM_PARSED_PACKAGE'
  | 'PERSIST_WORKING_COPY'
  | 'FREEZE_DRAFT_PACKAGE'
  | 'EXPORT_WORD_CANDIDATE';

export interface AeoArtifactActionBaseRequest {
  schemaVersion: typeof AEO_ARTIFACT_ACTION_VERSION;
  workItemId: string;
  requestId: string;
  runId: string;
  requesterRef: string;
  permissionSnapshotVersion: string;
  expectedStateVersion: number;
  idempotencyKey: string;
}

export interface AeoBootstrapFromParsedPackageRequest extends AeoArtifactActionBaseRequest {
  action: 'BOOTSTRAP_FROM_PARSED_PACKAGE';
}

export interface AeoPersistWorkingCopyRequest extends AeoArtifactActionBaseRequest {
  action: 'PERSIST_WORKING_COPY';
  expectedWorkingRevision: number;
  expectedContentHash: string | null;
  projection: import('./aeo-editor').AeoEditorProjection;
  transactions: import('./aeo-editor').AeoEditorTransactionEntry[];
  candidateDisposition?: AeoCandidateDispositionRequest;
}

export interface AeoCandidateDispositionRequest {
  candidateId: string;
  targetBlockId: string;
  usage: import('./aeo-editor').AeoKnowledgeDispositionUsage;
  decisionNote: string;
}

export interface AeoFreezeDraftPackageRequest extends AeoArtifactActionBaseRequest {
  action: 'FREEZE_DRAFT_PACKAGE';
  workingArtifactRef: string;
  workingArtifactSha256: string;
  expectedWorkingRevision: number;
}

export interface AeoExportWordCandidateRequest extends AeoArtifactActionBaseRequest {
  action: 'EXPORT_WORD_CANDIDATE';
  draftArtifactRef: string;
  draftArtifactSha256: string;
}

export type AeoArtifactActionRequest =
  | AeoBootstrapFromParsedPackageRequest
  | AeoPersistWorkingCopyRequest
  | AeoFreezeDraftPackageRequest
  | AeoExportWordCandidateRequest;

export interface AeoWorkingCopyArtifact {
  schemaVersion: typeof AEO_WORKING_COPY_ARTIFACT_VERSION;
  artifactKind: 'WORKING_COPY';
  workItemId: string;
  documentId: string;
  documentVersionId: string;
  parsedPackageId: string;
  parsedPackageArtifactSha256: string;
  aeoIdentity: string;
  workingRevision: number;
  baseBlockSetHash: string;
  contentHash: string;
  projection: import('./aeo-editor').AeoEditorProjection;
  transactions: import('./aeo-editor').AeoEditorTransactionEntry[];
  validation: import('./aeo-editor').AeoEditorValidationSummary;
  sourceManifest: import('./aeo-editor').AeoCloudSourceManifest;
  authority: 'WORKING_COPY_NOT_DRAFT_NOT_RELEASE';
}

export interface AeoAuthoringBootstrapArtifact {
  schemaVersion: typeof AEO_AUTHORING_BOOTSTRAP_ARTIFACT_VERSION;
  artifactKind: 'AUTHORING_BOOTSTRAP';
  workItemId: string;
  documentId: string;
  documentVersionId: string;
  parsedPackageId: string;
  parsedPackageArtifactRef: string;
  parsedPackageArtifactSha256: string;
  readerReceiptId: string;
  readerRevision: string;
  aeoIdentity: string;
  procedureItemId: string;
  projection: import('./aeo-editor').AeoEditorProjection;
  validation: import('./aeo-editor').AeoEditorValidationSummary;
  sourceManifest: import('./aeo-editor').AeoCloudSourceManifest;
  candidateKnowledge: AeoSimilarCandidateSummary[];
  authority: 'BOOTSTRAP_CANDIDATE_NOT_DRAFT_NOT_RELEASE';
}

export interface AeoDraftPackageArtifact {
  schemaVersion: typeof AEO_DRAFT_PACKAGE_ARTIFACT_VERSION;
  artifactKind: 'DRAFT_PACKAGE';
  draftPackageId: string;
  workItemId: string;
  documentId: string;
  documentVersionId: string;
  parsedPackageId: string;
  aeoIdentity: string;
  workingArtifactRef: string;
  workingArtifactSha256: string;
  workingRevision: number;
  contentHash: string;
  checkpointEligible: boolean;
  blockingUnresolvedCount: number;
  workingCopy: AeoWorkingCopyArtifact;
  authority: 'DRAFT_PACKAGE_NOT_RELEASE';
}

export interface AeoArtifactPersistReceipt {
  artifactRef: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: string;
}

export interface AeoRegistrarCommitRequest {
  workItemId: string;
  requesterRef: string;
  permissionSnapshotVersion: string;
  expectedStateVersion: number;
  expectedAeoStateVersion: string;
  idempotencyKey: string;
  decisionType: 'ACCEPT_AEO_ARTIFACT';
  action: AeoArtifactActionKind;
  artifact: AeoArtifactIndexEntry;
  nextAeoState: AeoWorkItemReadModel['aeo']['state'];
}

export interface AeoRegistrarCommitReceipt {
  decisionId: string;
  committedStateVersion: number;
  replayed: boolean;
}

export interface AeoArtifactActionResult {
  schemaVersion: typeof AEO_ARTIFACT_ACTION_VERSION;
  status: 'COMMITTED' | 'BLOCKED';
  action: AeoArtifactActionKind;
  workItemId: string;
  previousStateVersion: number | null;
  committedStateVersion: number | null;
  artifact: AeoArtifactIndexEntry | null;
  artifactReadback: {
    verified: true;
    sha256: string;
    byteLength: number;
  } | null;
  decisionId: string | null;
  validationWriteAuthorization: AeoValidationWriteAuthorizationVerification | null;
  blockers: AeoWorkItemBindingBlocker[];
  authority: 'ARTIFACT_ACTION_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY';
}

export interface AeoValidationWriteReceipt {
  schemaVersion: typeof AEO_VALIDATION_WRITE_RECEIPT_VERSION;
  receiptId: string;
  receiptArtifactRef: string;
  receiptCanonicalSha256: string;
  activationManifestCanonicalSha256: string;
  purpose: typeof WISELINK_3_1_AEO_VALIDATION_PURPOSE;
  workItemId: string;
  requestId: string;
  runId: string;
  actorRef: string;
  permissionSnapshotVersion: string;
  action: AeoArtifactActionKind;
  expectedStateVersion: number;
  actionInputHash: string;
  issuedBy: 'WiseLink3_1Master';
  authorizedByDecisionId: string;
  issuedAt: string;
  expiresAt: string;
  authority: 'VALIDATION_WRITE_ONLY_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY';
}

export interface AeoValidationWriteAuthorizationVerification {
  receiptId: string;
  receiptArtifactRef: string;
  receiptArtifactSha256: string;
  receiptCanonicalSha256: string;
  activationManifestCanonicalSha256: string;
  purpose: typeof WISELINK_3_1_AEO_VALIDATION_PURPOSE;
  workItemId: string;
  requestId: string;
  runId: string;
  actorRef: string;
  permissionSnapshotVersion: string;
  action: AeoArtifactActionKind;
  expectedStateVersion: number;
  actionInputHash: string;
  issuedBy: 'WiseLink3_1Master';
  authorizedByDecisionId: string;
  issuedAt: string;
  expiresAt: string;
  verified: true;
}

export interface AeoAuthoringSessionRequest {
  workItemId: string;
  requestId: string;
  requesterRef: string;
  permissionSnapshotVersion: string;
  expectedStateVersion: number;
}

export interface AeoAuthoringSessionResult {
  schemaVersion: typeof AEO_AUTHORING_SESSION_VERSION;
  status: 'READY' | 'ACTION_REQUIRED' | 'BLOCKED';
  workItemId: string;
  requestId: string;
  stateVersion: number | null;
  permissionSnapshotVersion: string | null;
  validationRun: AeoWorkItemReadModel['validationRun'];
  observedAt: string;
  document: {
    documentId: string;
    documentVersionId: string;
    aeoIdentity: string;
    aeoState: AeoWorkItemReadModel['aeo']['state'];
    summary: string;
  } | null;
  parsedPackage: {
    packageId: string;
    artifactRef: string;
    artifactSha256: string;
    readerReceiptId: string;
    readerRevision: string;
  } | null;
  artifactIndex: AeoArtifactIndexEntry[];
  sourceArtifact: AeoArtifactIndexEntry | null;
  workingRevision: number;
  contentHash: string | null;
  projection: import('./aeo-editor').AeoEditorProjection | null;
  transactions: import('./aeo-editor').AeoEditorTransactionEntry[];
  validation: import('./aeo-editor').AeoEditorValidationSummary | null;
  sourceManifest: import('./aeo-editor').AeoCloudSourceManifest | null;
  candidateKnowledge: AeoSimilarCandidateSummary[];
  todos: AeoWorkItemReadModel['todos'];
  actionRequired: 'BOOTSTRAP_FROM_PARSED_PACKAGE' | null;
  blockers: AeoWorkItemBindingBlocker[];
  authority: 'AUTHORING_SESSION_NOT_APPROVAL_NOT_RELEASE_NOT_DELIVERY';
}

export type AeoMiaodaArtifactActionRequest =
  | {
      action: 'BOOTSTRAP_FROM_PARSED_PACKAGE';
      requestId: string;
      runId: string;
      permissionSnapshotVersion: string;
      expectedStateVersion: number;
      idempotencyKey: string;
    }
  | {
      action: 'PERSIST_WORKING_COPY';
      requestId: string;
      runId: string;
      permissionSnapshotVersion: string;
      expectedStateVersion: number;
      idempotencyKey: string;
      expectedWorkingRevision: number;
      expectedContentHash: string | null;
      projection: import('./aeo-editor').AeoEditorProjection;
      transactions: import('./aeo-editor').AeoEditorTransactionEntry[];
      candidateDisposition?: AeoCandidateDispositionRequest;
    }
  | {
      action: 'FREEZE_DRAFT_PACKAGE';
      requestId: string;
      runId: string;
      permissionSnapshotVersion: string;
      expectedStateVersion: number;
      idempotencyKey: string;
      workingArtifactRef: string;
      workingArtifactSha256: string;
      expectedWorkingRevision: number;
    }
  | {
      action: 'EXPORT_WORD_CANDIDATE';
      requestId: string;
      runId: string;
      permissionSnapshotVersion: string;
      expectedStateVersion: number;
      idempotencyKey: string;
      draftArtifactRef: string;
      draftArtifactSha256: string;
    };
