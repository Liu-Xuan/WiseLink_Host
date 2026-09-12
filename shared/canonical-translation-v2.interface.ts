import type {
  CanonicalExecutionModelSelection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderSourceLocator,
} from './api.interface';

/** The validated parsed package, before the legacy Reader flattens payloads. */
export interface TranslationStructuredSourceUnit {
  unitId: string;
  kind: string;
  moduleId: string;
  parentUnitId: string | null;
  order: number;
  depth: number;
  continuityKey: string;
  sourceRefIds: string[];
  sourceSegmentIds: string[];
  mapping: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface TranslationStructuredSource {
  units: TranslationStructuredSourceUnit[];
  modules: Array<{ moduleId: string; order: number }>;
  sourceLocators: UnifiedReaderSourceLocator[];
  findings: Record<string, unknown>[];
  references: Record<string, unknown>[];
}

export type TranslationIssueSeverity = 'BLOCK' | 'REVIEW' | 'NOTE';

export interface TranslationIssueV2 {
  code: string;
  severity: TranslationIssueSeverity;
  origin: 'SOURCE' | 'TRANSLATION' | 'OUTPUT_CONTRACT' | 'SERVICE';
  message: string;
  blockIds: string[];
  anchorIds: string[];
  sourceFindingId?: string;
}

export interface TranslationSourceAnchorV2 {
  anchorId: string;
  sourceUnitId: string;
  /** JSON pointer into the original unit payload; never a guessed PDF offset. */
  payloadPath: string;
  sourceText: string;
  sourceRefIds: string[];
  sourceLocators: UnifiedReaderSourceLocator[];
}

export interface TranslationSemanticBlockV2 {
  blockId: string;
  order: number;
  kind:
    | 'heading'
    | 'prose'
    | 'list'
    | 'step'
    | 'advisory'
    | 'table'
    | 'figure'
    | 'reference'
    | 'preserved_source';
  moduleId: string;
  sourceUnitIds: string[];
  anchorIds: string[];
  /** Immutable source layout. Model output fills text, never row/column spans. */
  sourceStructure: Array<{
    sourceUnitId: string;
    kind: string;
    payload: Record<string, unknown>;
  }>;
  contextBlockIds: string[];
  requiredTogetherBlockIds: string[];
  sourceCharacterCount: number;
  sourceIssues: TranslationIssueV2[];
  organization:
    | 'ORIGINAL_UNIT'
    | 'ADJACENT_PROSE_CONTEXT'
    | 'EXPLICIT_LIST'
    | 'EXPLICIT_TABLE_CONTINUATION';
}

export interface TranslationSourcePlanV2 {
  schemaVersion: 'wiselink.3_1.translation_source_plan.v2';
  planRevision: number;
  source: {
    documentVersionId: string;
    packageId: string;
    parsedArtifact: UnifiedPackageArtifactDescriptor;
    originalBinding?: import('./document-original.interface').DocumentOriginalBinding;
  };
  anchors: TranslationSourceAnchorV2[];
  blocks: TranslationSemanticBlockV2[];
  inventory: Array<{
    sourceUnitId: string;
    blockId: string;
    anchorIds: string[];
    sourceCharacterCount: number;
    textAvailability:
      | 'TEXT_AVAILABLE'
      | 'STRUCTURE_ONLY'
      | 'SOURCE_REVIEW_REQUIRED';
  }>;
  documentContext: {
    revision: number;
    title: string;
    outline: Array<{ blockId: string; anchorIds: string[]; level: number }>;
    /** Exact source quotations with anchors. No unverified model summary. */
    scopedConditions: Array<{
      advisoryBlockId: string;
      targetBlockIds: string[];
      anchorIds: string[];
    }>;
    references: Record<string, unknown>[];
    /** Navigation candidates retain full quotations; detection grants no authority. */
    conditionAnchorIds: string[];
    definitionAnchorIds: string[];
  };
}

export interface TranslationReadingElementV2 {
  elementId: string;
  kind:
    | 'paragraph'
    | 'heading'
    | 'list_item'
    | 'advisory'
    | 'table_cell'
    | 'caption'
    | 'label';
  translatedText: string;
  anchorIds: string[];
}

export interface TranslationBlockCandidateV2 {
  blockId: string;
  elements: TranslationReadingElementV2[];
}

export interface TranslationBlockDependenciesV2 {
  planRevision: number;
  contextRevision: number;
  sourceAnchorIds: string[];
  contextAnchorIds: string[];
  methodVersion: string;
}

export interface TranslationGenerationRequestV2 {
  generationRequestRef: string;
  clientRequestId: string;
  attemptId: string;
  leaseGeneration: number;
  blockIds: string[];
  dependencies: TranslationBlockDependenciesV2;
  purpose: 'GENERATE' | 'CORRECT' | 'CHECK' | 'CHECK_BATCH' | 'REUSE';
  /** Exact candidate being corrected or reviewed; null for new generation. */
  targetBlockRevisionId: string | null;
  /** Host-captured immutable candidates and their check CAS versions. */
  checkTargets?: {
    blockId: string;
    blockRevisionId: string;
    rowVersion: number;
  }[];
  status: 'REGISTERED' | 'SAVED' | 'SUPERSEDED' | 'FAILED';
  registeredAt: string;
  finishedAt: string | null;
  error: {
    origin:
      | 'TRANSPORT'
      | 'UPSTREAM'
      | 'OUTPUT_CONTRACT'
      | 'SOURCE'
      | 'TRANSLATION';
    code: string;
    outcome: 'KNOWN_FAILURE' | 'GENERATION_UNKNOWN';
    retryable: boolean;
  } | null;
}

export interface TranslationOfficialPluginProducerV2 {
  kind: 'OFFICIAL_PLUGIN';
  instanceId: string;
  pluginVersion: string;
  actionKey: string;
  concreteModel: string | null;
}

export interface TranslationBlockProvenanceV2 {
  /** Host copied the existing candidate after exact dependency comparison; no new generation. */
  reusedFrom?: { workspaceId: string; blockRevisionId: string; generationRequestRef: string;
    parseRunId: string; importedByAttemptId: string; importedAt: string };
  producer?: TranslationOfficialPluginProducerV2;
  authorKind: 'MODEL' | 'ENGINEER';
  authorUserId: string;
  executionModel: CanonicalExecutionModelSelection | null;
  modelVersion: string | null;
  skillVersion: string | null;
  promptVersion: string | null;
  generationRequestRef: string;
  originAttemptId: string | null;
  providerRequestId: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface TranslationBlockCheckV2 {
  schemaVersion: 'wiselink.3_1.translation_block_check.v2';
  checkVersion: string;
  issues: TranslationIssueV2[];
  semanticCheck: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETED';
  semanticReview: TranslationBlockProvenanceV2 | null;
}

export interface TranslationBlockRevisionV2 {
  blockRevisionId: string;
  workspaceId: string;
  blockId: string;
  planRevision: number;
  contentRevision: number;
  rowVersion: number;
  candidate: TranslationBlockCandidateV2;
  dependencies: TranslationBlockDependenciesV2;
  provenance: TranslationBlockProvenanceV2;
  generatedAt: string | null;
  savedAt: string;
  check: TranslationBlockCheckV2 | null;
  checkedAt: string | null;
  selectedForReading: boolean;
}

export interface TranslationWorkspaceV2 {
  workspaceId: string;
  tenantId: string;
  workItemId: string | null;
  subjectKind?: 'WORK_ITEM' | 'DOCUMENT_VERSION';
  rowVersion: number;
  methodVersion: string;
  activeAttemptId: string | null;
  plan: TranslationSourcePlanV2;
  generationRequests: TranslationGenerationRequestV2[];
  resultArtifact: UnifiedPackageArtifactDescriptor | null;
  resultManifest: TranslationResultManifestV2 | null;
}

export interface TranslationResultManifestV2 {
  workspaceId: string;
  planRevision: number;
  contextRevision: number;
  workspaceRowVersion: number;
  blockRevisions: Array<{
    blockId: string;
    blockRevisionId: string;
    contentRevision: number;
  }>;
}

export interface TranslationWorkspaceReadingV2 {
  schemaVersion: 'wiselink.3_1.translation_workspace_reading.v2';
  workspaceId: string;
  rowVersion: number;
  completeness: 'PARTIAL' | 'COMPLETE_WITH_ISSUES' | 'COMPLETE';
  candidateOnly: true;
  source: TranslationSourcePlanV2['source'];
  coverage: {
    registeredSourceCharacters: number;
    savedSourceCharacters: number;
    readableSourceCharacters: number;
    sourceUnitCount: number;
    unresolvedSourceUnitCount: number;
    missingBlockCount: number;
    pendingCheckBlockCount: number;
    blockedBlockCount: number;
  };
  anchors: TranslationSourceAnchorV2[];
  blocks: Array<{
    source: TranslationSemanticBlockV2;
    readingStatus: 'MISSING' | 'PENDING_CHECK' | 'READABLE' | 'BLOCKED';
    /** Absent until a checked, applicable revision is selected. */
    selected: TranslationBlockRevisionV2 | null;
    issues: TranslationIssueV2[];
  }>;
  finalCandidate: {
    artifact: UnifiedPackageArtifactDescriptor;
    manifest: TranslationResultManifestV2;
  } | null;
}

export interface BilingualTranslationArtifactV2 {
  schemaVersion: 'wiselink.3_1.bilingual_translation_artifact.v2';
  candidateOnly: true;
  source: TranslationSourcePlanV2['source'];
  methodVersion: string;
  manifest: TranslationResultManifestV2;
  completeness: TranslationWorkspaceReadingV2['completeness'];
  anchors: TranslationSourceAnchorV2[];
  blocks: TranslationWorkspaceReadingV2['blocks'];
  coverage: TranslationWorkspaceReadingV2['coverage'];
}

export interface TranslationEngineerRevisionCommandV2 {
  requestId: string;
  workspaceId: string;
  expectedWorkItemRevision: number;
  baseBlockRevisionId: string;
  expectedRowVersion: number;
  candidate: TranslationBlockCandidateV2;
  confirmedSourceReview: true;
}

export interface TranslationRevisionReadModelV2 {
  reading: TranslationWorkspaceReadingV2;
  revisions: TranslationBlockRevisionV2[];
}

/** Knowledge previews retain the whole semantic block and its original mapping. */
export interface TranslationKnowledgeSemanticScopeV2 {
  workspaceId: string;
  blockId: string;
  blockRevisionId: string;
  planRevision: number;
  contextRevision: number;
  sourceUnitIds: string[];
  anchors: TranslationSourceAnchorV2[];
  elements: TranslationReadingElementV2[];
  provenance: TranslationBlockProvenanceV2;
}
