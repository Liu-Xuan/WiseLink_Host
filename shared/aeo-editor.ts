export const AEO_EDITOR_PROJECTION_VERSION =
  'aeo_editor_projection_v1.candidate.1' as const;
export const AEO_EDITOR_CHECKPOINT_VERSION =
  'aeo_editor_checkpoint_v1.candidate.1' as const;
export const AEO_EDITOR_LOCAL_RECOVERY_VERSION =
  'aeo_editor_local_recovery_v1.candidate.1' as const;
export const AEO_AUTHORING_CLOUD_VERSION =
  'aeo_authoring_cloud_v1.candidate.1' as const;
export const AEO_SPECIALIST_INTAKE_VERSION =
  'aeo_specialist_intake_v1.candidate.1' as const;
export const AEO_WORK_ITEM_BINDING_VERSION =
  'aeo_hub_work_item_binding_v1.candidate.3' as const;

export type AeoCanonicalRole =
  | 'CanonicalMiaodaApp'
  | 'CanonicalAily'
  | 'CanonicalWorkItemStore'
  | 'CanonicalDocumentCatalog'
  | 'CanonicalArtifactStore'
  | 'CanonicalUnifiedReader';

export type AeoCanonicalRoleResolutionStatus =
  | 'UNRESOLVED'
  | 'PROPOSED_REUSE_ANCHOR'
  | 'PROVISIONED_CANDIDATE'
  | 'VERIFIED_CANONICAL'
  | 'REJECTED';

export interface AeoCanonicalRoleResolution {
  role: AeoCanonicalRole;
  status: AeoCanonicalRoleResolutionStatus;
  resolutionVersion: string;
  exactIdentityRef: string | null;
  tenantRef: string | null;
  environmentRef: string | null;
  accessBaseUrl: string | null;
  verifiedAt: string | null;
}

export interface AeoWorkItemBindingPreflightRequest {
  schemaVersion: typeof AEO_WORK_ITEM_BINDING_VERSION;
  expectedRoleResolutionVersion: string;
  workItemId: string;
  requestId: string;
  stateVersion: number;
  document: {
    documentId: string;
    documentVersionId: string;
    family: string;
    classificationStatus: string;
    classificationAuthority: string;
    catalogRole: 'CanonicalDocumentCatalog';
    classificationFingerprint: string;
  };
  sourceArtifact: {
    storeRole: 'CanonicalArtifactStore';
    ref: string;
    sha256: string;
    mediaType: string;
    byteLength: number;
  };
  parsedPackage: {
    packageId: string;
    storeRole: 'CanonicalArtifactStore';
    ref: string;
    sha256: string;
    contract: string;
    readerReceipt: {
      role: 'CanonicalUnifiedReader';
      receiptId: string;
      readerRevision: string;
      validationStatus: 'ACCEPTED' | 'REJECTED';
      packageArtifactSha256: string;
    };
  };
  aeoState: {
    state:
      | 'NOT_STARTED'
      | 'PARSE_READY'
      | 'AUTHORING'
      | 'CHECKPOINTED'
      | 'BLOCKED';
    ref: string | null;
    version: string;
  };
  permissionSnapshot: {
    version: string;
    subjectRef: string;
    capturedAt: string;
  };
}

export type AeoWorkItemBindingBlockerCode =
  | 'ROLE_RESOLUTION_VERSION_CONFLICT'
  | 'CANONICAL_ROLE_UNRESOLVED'
  | 'CANONICAL_ROLE_NOT_VERIFIED'
  | 'CANONICAL_ROLE_REJECTED'
  | 'CANONICAL_ROLE_TARGET_INCOMPLETE'
  | 'CANONICAL_ROLE_ENVIRONMENT_MISMATCH'
  | 'CANONICAL_MIAODA_URL_INVALID'
  | 'DOCUMENT_FAMILY_NOT_AEO'
  | 'DOCUMENT_CLASSIFICATION_NOT_CONFIRMED'
  | 'DOCUMENT_CLASSIFICATION_AUTHORITY_INVALID'
  | 'PARSED_PACKAGE_READER_NOT_ACCEPTED'
  | 'PARSED_PACKAGE_READER_HASH_MISMATCH'
  | 'CANONICAL_WORKITEM_READ_UNAVAILABLE'
  | 'WORKITEM_PROJECTION_INVALID'
  | 'WORKITEM_STATE_CONFLICT'
  | 'PERMISSION_SNAPSHOT_STALE'
  | 'AEO_SIMILAR_SEARCH_UNAVAILABLE'
  | 'AEO_TOOL_OPERATION_FAILED'
  | 'AEO_ARTIFACT_ACTION_INVALID'
  | 'AEO_ARTIFACT_INPUT_NOT_FOUND'
  | 'AEO_ARTIFACT_INPUT_HASH_MISMATCH'
  | 'AEO_ARTIFACT_PERSIST_UNAVAILABLE'
  | 'AEO_ARTIFACT_PERSIST_FAILED'
  | 'AEO_ARTIFACT_READBACK_MISMATCH'
  | 'AEO_VALIDATION_WRITE_AUTHORITY_UNAVAILABLE'
  | 'AEO_VALIDATION_WRITE_RECEIPT_INVALID'
  | 'AEO_VALIDATION_WRITE_RECEIPT_HASH_MISMATCH'
  | 'AEO_VALIDATION_WRITE_RECEIPT_CANONICAL_HASH_MISMATCH'
  | 'AEO_VALIDATION_WRITE_RECEIPT_EXPIRED'
  | 'AEO_VALIDATION_WRITE_RECEIPT_BINDING_MISMATCH'
  | 'AEO_REGISTRAR_COMMIT_UNAVAILABLE'
  | 'AEO_REGISTRAR_COMMIT_FAILED';

export interface AeoWorkItemBindingBlocker {
  code: AeoWorkItemBindingBlockerCode;
  role: AeoCanonicalRole | null;
  message: string;
}

export interface AeoWorkItemBindingPreflightResult {
  schemaVersion: typeof AEO_WORK_ITEM_BINDING_VERSION;
  status: 'READY' | 'BLOCKED';
  route: 'AEO_SPECIALIST' | 'NONE';
  routeEligible: boolean;
  workItemId: string;
  requestId: string;
  stateVersion: number;
  documentVersionId: string;
  parsedPackageRef: string;
  parsedPackageHash: string;
  aeoState: AeoWorkItemBindingPreflightRequest['aeoState'];
  roleResolutionVersion: string;
  blockers: AeoWorkItemBindingBlocker[];
  deepLink: {
    applicationRole: 'CanonicalMiaodaApp';
    route: '/aeo-authoring';
    query: {
      workItemId: string;
      requestId: string;
      stateVersion: string;
      permissionSnapshotVersion: string;
    };
  } | null;
  authority: 'PREFLIGHT_ONLY_NOT_APPROVAL_NOT_RELEASE';
}

export interface AeoCanonicalRoleGateResult {
  resolutionVersion: string;
  status: 'READY' | 'BLOCKED';
  roles: AeoCanonicalRoleResolution[];
  blockers: AeoWorkItemBindingBlocker[];
  miaodaBaseUrl: string | null;
}

export type AeoContentBlockType =
  | 'PARAGRAPH'
  | 'ORDERED_LIST'
  | 'UNORDERED_LIST'
  | 'REFERENCE'
  | 'WARNING'
  | 'CAUTION'
  | 'NOTE'
  | 'DATA_TABLE'
  | 'CONDITIONAL_BRANCH'
  | 'IMAGE';

export type AeoContentOriginType =
  | 'SOURCE_ADOPTED'
  | 'SOURCE_ADAPTED'
  | 'HISTORICAL_OCCURRENCE_COPIED'
  | 'CATEGORY_PATTERN_INSTANTIATED'
  | 'LOCAL_METHOD'
  | 'ENGINEER_AUTHORED'
  | 'MODEL_SUGGESTED_UNGROUNDED';

export type AeoSourceBindingUsage =
  | 'ADOPTED'
  | 'ADAPTED'
  | 'COPIED'
  | 'INSTANTIATED'
  | 'REFERENCE_ONLY';

export interface AeoSourceBinding {
  bindingId: string;
  originType: Exclude<
    AeoContentOriginType,
    'ENGINEER_AUTHORED' | 'MODEL_SUGGESTED_UNGROUNDED'
  >;
  usage: AeoSourceBindingUsage;
  sourceArtifactRef: string;
  sourceNodeRef: string;
  sourceVersion: string;
  sourceSha256: string;
  locator: string;
  language: 'ZH' | 'EN' | 'BILINGUAL' | 'NONE';
}

export interface AeoBlockUnresolved {
  unresolvedId: string;
  code: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  blocksCheckpoint: boolean;
}

interface AeoContentBlockBase {
  blockId: string;
  orderKey: string;
  blockType: AeoContentBlockType;
  originType: AeoContentOriginType;
  sourceBindings: AeoSourceBinding[];
  engineerDecisionRef: string | null;
  unresolved: AeoBlockUnresolved[];
}

export interface AeoParagraphBlock extends AeoContentBlockBase {
  blockType: 'PARAGRAPH';
  bodyZh: string | null;
  bodyEn: string | null;
}

export interface AeoListItem {
  listItemId: string;
  bodyZh: string | null;
  bodyEn: string | null;
}

export interface AeoListBlock extends AeoContentBlockBase {
  blockType: 'ORDERED_LIST' | 'UNORDERED_LIST';
  items: AeoListItem[];
}

export interface AeoAdvisoryBlock extends AeoContentBlockBase {
  blockType: 'WARNING' | 'CAUTION' | 'NOTE';
  titleZh: string | null;
  titleEn: string | null;
  bodyZh: string | null;
  bodyEn: string | null;
}

export interface AeoReferenceBlock extends AeoContentBlockBase {
  blockType: 'REFERENCE';
  referenceKind: 'AMM' | 'SB' | 'AEO' | 'OTHER';
  referenceLabel: string;
  targetRef: string;
  bodyZh: string | null;
  bodyEn: string | null;
}

export interface AeoDataTableColumn {
  columnId: string;
  titleZh: string | null;
  titleEn: string | null;
}

export interface AeoDataTableCell {
  cellId: string;
  columnId: string;
  textZh: string | null;
  textEn: string | null;
  rowSpan: number;
  columnSpan: number;
}

export interface AeoDataTableRow {
  rowId: string;
  cells: AeoDataTableCell[];
}

export interface AeoDataTableBlock extends AeoContentBlockBase {
  blockType: 'DATA_TABLE';
  columns: AeoDataTableColumn[];
  rows: AeoDataTableRow[];
}

export interface AeoConditionalBranchBlock extends AeoContentBlockBase {
  blockType: 'CONDITIONAL_BRANCH';
  branchEdgeId: string;
  outcomeLabel: string;
  effect: string;
  targetItemId: string;
  notApplicableItemIds: string[];
  displayZh: string;
  displayEn: string;
  reviewState: 'NEEDS_ENGINEERING_REVIEW' | 'ENGINEERING_REVIEWED';
}

export interface AeoImageBlock extends AeoContentBlockBase {
  blockType: 'IMAGE';
  imageRef: string;
  fileName: string;
  mediaType: string;
  sha256: string;
  captionZh: string | null;
  captionEn: string | null;
  anchorRole: 'INLINE' | 'AFTER_ITEM' | 'APPENDIX';
}

export type AeoContentBlock =
  | AeoParagraphBlock
  | AeoListBlock
  | AeoAdvisoryBlock
  | AeoReferenceBlock
  | AeoDataTableBlock
  | AeoConditionalBranchBlock
  | AeoImageBlock;

export interface AeoTiptapJsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AeoTiptapJsonNode[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
}

export interface AeoEditorBlockManifestEntry {
  blockId: string;
  orderKey: string;
  blockType: AeoContentBlockType;
  originType: AeoContentOriginType;
  sourceBindings: AeoSourceBinding[];
  engineerDecisionRef: string | null;
  unresolved: AeoBlockUnresolved[];
  projectedFromBlockHash: string;
  immutableStructureHash: string | null;
}

export interface AeoEditorProjection {
  projectionVersion: typeof AEO_EDITOR_PROJECTION_VERSION;
  procedureItemId: string;
  projectedFromBlockSetHash: string;
  editorDocument: AeoTiptapJsonNode;
  blockManifest: AeoEditorBlockManifestEntry[];
}

export interface AeoEditorProjectionResult {
  procedureItemId: string;
  projectedFromBlockSetHash: string;
  currentBlockSetHash: string;
  changedBlockIds: string[];
  blocks: AeoContentBlock[];
}

export interface AeoEditorValidationSummary {
  procedureItemId: string;
  projectedFromBlockSetHash: string;
  currentBlockSetHash: string;
  changedBlockIds: string[];
  blockCount: number;
  blockingUnresolvedCount: number;
  checkpointEligible: boolean;
}

export type AeoEditorTransactionKind =
  | 'EDIT_TEXT'
  | 'PASTE_PLAIN_TEXT'
  | 'IMPORT_KNOWLEDGE'
  | 'REORDER_BLOCK'
  | 'UNDO'
  | 'REDO';

export interface AeoEditorTransactionEntry {
  sequence: number;
  kind: AeoEditorTransactionKind;
  affectedBlockIds: string[];
}

export interface AeoEditorCheckpointRequest {
  checkpointVersion: typeof AEO_EDITOR_CHECKPOINT_VERSION;
  expectedWorkingRevision: number;
  expectedBaseBlockSetHash: string;
  projection: AeoEditorProjection;
  transactions: AeoEditorTransactionEntry[];
}

export interface AeoEditorShadowCheckpoint {
  checkpointVersion: typeof AEO_EDITOR_CHECKPOINT_VERSION;
  checkpointKind: 'LOCAL_SHADOW_NO_PERSISTENCE';
  checkpointId: string;
  aeoIdentity: 'AEO-B787-46-0015-R09';
  baseWorkingRevision: number;
  candidateWorkingRevision: number;
  baseBlockSetHash: string;
  currentBlockSetHash: string;
  transactionDigest: string;
  transactionCount: number;
  changedBlockIds: string[];
  blockingUnresolvedCount: number;
  exportEligible: boolean;
  persisted: false;
}

export interface AeoEditorShadowFixture {
  fixtureKind: 'LOCAL_REAL_STRUCTURE_FIXTURE';
  aeoIdentity: 'AEO-B787-46-0015-R09';
  workingRevision: 1;
  sourceNotice: string;
  projection: AeoEditorProjection;
  validation: AeoEditorValidationSummary;
}

export interface AeoEditorLocalRecoverySnapshot {
  recoveryVersion: typeof AEO_EDITOR_LOCAL_RECOVERY_VERSION;
  recoveryKind: 'LOCAL_BROWSER_RECOVERY_NOT_DRAFT';
  savedAt: string;
  projection: AeoEditorProjection;
  transactions: AeoEditorTransactionEntry[];
  validationReceipt: AeoEditorShadowCheckpoint;
  recoveryDigest: string;
}

export interface AeoCloudSourceManifest {
  sourceNotice: string;
  fixtureKind?: string;
  exactSourceRefs: string[];
  adoptionDecisions: AeoKnowledgeAdoptionDecision[];
}

export interface AeoCloudAuthoringDocument {
  schemaVersion: typeof AEO_AUTHORING_CLOUD_VERSION;
  documentId: string;
  documentKey: string;
  templateKey: string | null;
  formalAeoIdentity: string | null;
  title: string;
  lifecycleState: 'WORKING';
  workingRevision: number;
  baseBlockSetHash: string;
  currentBlockSetHash: string;
  projection: AeoEditorProjection;
  transactions: AeoEditorTransactionEntry[];
  validation: AeoEditorValidationSummary;
  sourceManifest: AeoCloudSourceManifest;
  updatedAt: string;
}

export interface AeoCloudDocumentBootstrap {
  document: AeoCloudAuthoringDocument;
  initialized: boolean;
  storage: 'MIAODA_POSTGRES';
}

export interface AeoCloudBootstrapRequest {
  documentKey: string;
  templateKey?: string;
}

export interface AeoAuthoringTemplateSummary {
  templateKey: string;
  category: string;
  nameZh: string;
  nameEn: string | null;
  descriptionZh: string;
  templateState: string;
  eligible: boolean;
}

export interface AeoAuthoringTemplateList {
  items: AeoAuthoringTemplateSummary[];
  boundary: string;
}

export interface AeoCloudSaveRequest {
  expectedWorkingRevision: number;
  expectedCurrentBlockSetHash: string;
  projection: AeoEditorProjection;
  transactions: AeoEditorTransactionEntry[];
}

export interface AeoCloudSaveResult {
  document: AeoCloudAuthoringDocument;
  saved: true;
  previousWorkingRevision: number;
}

export interface AeoCloudCheckpointRequest {
  expectedWorkingRevision: number;
  expectedCurrentBlockSetHash: string;
  projection: AeoEditorProjection;
  transactions: AeoEditorTransactionEntry[];
}

export interface AeoCloudDraftCheckpoint {
  schemaVersion: typeof AEO_AUTHORING_CLOUD_VERSION;
  checkpointId: string;
  checkpointKey: string;
  documentId: string;
  documentKey: string;
  workingRevision: number;
  contentHash: string;
  transactionDigest: string;
  checkpointState: 'FROZEN_CANDIDATE';
  snapshot: {
    schemaVersion: typeof AEO_AUTHORING_CLOUD_VERSION;
    document: AeoCloudAuthoringDocument;
    projection: AeoEditorProjection;
    transactions: AeoEditorTransactionEntry[];
    validation: AeoEditorValidationSummary;
    frozenAt: string;
  };
  frozenAt: string;
  persisted: true;
  authority: 'DRAFT_CHECKPOINT_NOT_RELEASE';
}

export interface AeoCloudWordExportRequest {
  expectedWorkingRevision: number;
  expectedCurrentBlockSetHash: string;
}

export interface AeoCloudWordExportReceipt {
  schemaVersion: typeof AEO_AUTHORING_CLOUD_VERSION;
  exportKind: 'CLOUD_DRAFT_WORD_CANDIDATE';
  exportId: string;
  documentKey: string;
  workingRevision: number;
  checkpointKey: string;
  authoringContentHash: string;
  fileName: string;
  filePath: string;
  outputSha256: string;
  outputByteLength: number;
  downloadUrl: string;
  downloadExpiresInSeconds: number;
  productionEligible: false;
  authority: 'DRAFT_EXPORT_NOT_RELEASE';
  blockingUnresolvedCount: number;
  generatedAt: string;
}

export type AeoKnowledgeUnitKind =
  | 'SOURCE_STEP'
  | 'HISTORICAL_AEO_STEP'
  | 'CATEGORY_PATTERN_NODE'
  | 'AI_SUGGESTION';

export interface AeoKnowledgeSuggestion {
  unitKey: string;
  unitKind: AeoKnowledgeUnitKind;
  category: string;
  semanticRole: string;
  titleZh: string;
  titleEn: string | null;
  bodyZh: string | null;
  bodyEn: string | null;
  knowledgeState: string;
  sourceArtifactRef: string | null;
  sourceNodeRef: string | null;
  sourceVersion: string | null;
  sourceSha256: string | null;
  locator: string | null;
  eligible: boolean;
  supportCount: number;
  usageOptions: Array<
    'ADOPT' | 'ADAPT' | 'INSERT_BEFORE' | 'INSERT_AFTER' | 'IGNORE'
  >;
}

export interface AeoKnowledgeSuggestionList {
  items: AeoKnowledgeSuggestion[];
  total: number;
  query: string;
  category: string | null;
  boundary: string;
}

export type AeoKnowledgeApplyUsage = 'ADOPT' | 'ADAPT';

export type AeoKnowledgeDispositionUsage =
  | AeoKnowledgeApplyUsage
  | 'REFERENCE_ONLY'
  | 'IGNORE';

export interface AeoKnowledgeApplyRequest {
  expectedWorkingRevision: number;
  expectedCurrentBlockSetHash: string;
  targetBlockId: string;
  usage: AeoKnowledgeApplyUsage;
  decisionNote: string;
}

export interface AeoKnowledgeAdoptionDecision {
  decisionRef: string;
  unitKey: string;
  unitKind: AeoKnowledgeUnitKind;
  knowledgeState: string;
  targetBlockId: string;
  usage: AeoKnowledgeDispositionUsage;
  decisionNote: string;
  exactSourceRef: string | null;
  appliedAt: string;
}

export interface AeoKnowledgeApplyResult extends AeoCloudSaveResult {
  decision: AeoKnowledgeAdoptionDecision;
}

export type AeoSpecialistSourceState =
  | 'REGISTERED_CANDIDATE'
  | 'CANDIDATE_KNOWLEDGE_CREATED';

export interface AeoSpecialistParseRunSummary {
  runKey: string;
  sourceKey: string;
  documentVersionId: string;
  parsePackageId: string;
  parsePackageHash: string;
  parseContractVersion: string;
  reuseClass: 'ADAPT_EXISTING_PARSE_PACKAGE';
  runState: 'CANDIDATE_KNOWLEDGE_CREATED';
  packageFilePath: string;
  candidateCount: number;
  findingCount: number;
  blockingFindingCount: number;
  createdAt: string;
}

export interface AeoSpecialistSourceSummary {
  sourceKey: string;
  documentId: string;
  documentVersionId: string;
  family: 'AEO';
  classificationState: 'CONFIRMED';
  classificationAuthority:
    | 'DOCUMENT_MANAGEMENT'
    | 'AEO_SPECIALIST_DEVELOPMENT_MIGRATION';
  profile: 'AEO_SECTION2_DOCX';
  profileState: 'CANDIDATE_NOT_FROZEN';
  routingDisposition: 'SPECIALIST_CONTRACT_PENDING';
  formalAeoIdentity: string;
  revision: string;
  iteration: string;
  sourceArtifactRef: string;
  sourceMediaType: string;
  sourceByteLength: number;
  sourceSha256: string;
  currentness: 'UNVERIFIED' | 'CURRENT' | 'HISTORICAL' | 'CANCELLED';
  categoryCandidate: string;
  categoryAuthority: 'ENGINEER_REGISTERED_CANDIDATE';
  parseFilePath: string;
  parseFileSha256: string;
  parsePackageId: string;
  parsePackageHash: string;
  parseContractVersion: string;
  sourceState: AeoSpecialistSourceState;
  latestRun: AeoSpecialistParseRunSummary | null;
  updatedAt: string;
}

export interface AeoSpecialistSourceList {
  schemaVersion: typeof AEO_SPECIALIST_INTAKE_VERSION;
  items: AeoSpecialistSourceSummary[];
  total: number;
  routingBoundary: 'CONFIRMED_AEO_TO_AEO_SPECIALIST_ONLY_NEVER_SB_OR_GENERIC';
  authority: 'CANDIDATE_INTAKE_NOT_RELEASE';
}

export interface AeoSpecialistSourceRegisterRequest {
  sourceKey: string;
  documentId: string;
  documentVersionId: string;
  family: 'AEO';
  classificationState: 'CONFIRMED';
  classificationAuthority:
    | 'DOCUMENT_MANAGEMENT'
    | 'AEO_SPECIALIST_DEVELOPMENT_MIGRATION';
  profile: 'AEO_SECTION2_DOCX';
  profileState: 'CANDIDATE_NOT_FROZEN';
  routingDisposition: 'SPECIALIST_CONTRACT_PENDING';
  formalAeoIdentity: string;
  revision: string;
  iteration: string;
  sourceArtifactRef: string;
  sourceMediaType: string;
  sourceByteLength: number;
  sourceSha256: string;
  currentness: 'UNVERIFIED' | 'CURRENT' | 'HISTORICAL' | 'CANCELLED';
  categoryCandidate: string;
  categoryAuthority: 'ENGINEER_REGISTERED_CANDIDATE';
  parseFilePath: string;
  parseFileSha256: string;
  parsePackageId: string;
  parsePackageHash: string;
  parseContractVersion: string;
}

export interface AeoSpecialistIntakeReceipt {
  schemaVersion: typeof AEO_SPECIALIST_INTAKE_VERSION;
  source: AeoSpecialistSourceSummary;
  run: AeoSpecialistParseRunSummary;
  created: boolean;
  knowledgeCandidateKeys: string[];
  authority: 'CANDIDATE_KNOWLEDGE_NOT_RULE_NOT_RELEASE';
  routingBoundary: 'CONFIRMED_AEO_TO_AEO_SPECIALIST_ONLY_NEVER_SB_OR_GENERIC';
}
