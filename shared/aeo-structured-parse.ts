import type { AeoFormalIdentity } from './aeo-corpus';
import type { AeoDocxNestedTableEnrichedParsePackageCandidate } from './aeo-docx-nested-table';
import type { AeoDocxNoteReferenceEnrichedParsePackageCandidate } from './aeo-docx-note-reference';
import type { AeoDocxSemanticBilingualEnrichedParsePackageCandidate } from './aeo-docx-semantic-bilingual';
import type { AeoDocxAuthoringBilingualEnrichedParsePackageCandidate } from './aeo-docx-authoring-bilingual';
import type { AeoDocxSafetyParagraphRegionEnrichedParsePackageCandidate } from './aeo-docx-safety-paragraph-region';
import type { AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate } from './aeo-docx-authoring-rendered-region';
export * from './aeo-docx-authoring-bilingual';
export * from './aeo-docx-authoring-rendered-region';
export * from './aeo-docx-nested-table';
export * from './aeo-docx-note-reference';
export * from './aeo-docx-safety-paragraph-region';
export * from './aeo-docx-semantic-bilingual';

export const AEO_STRUCTURED_PARSE_CONTRACT_VERSION =
  'aeo_structured_parse_v1.candidate.1' as const;

export const LEGACY_AEO_MARKDOWN_PROJECTOR_VERSION =
  'legacy_aeo_markdown_projector_v1.candidate.1' as const;

export const AEO_VISUAL_REVIEW_PATCH_VERSION =
  'aeo_visual_review_patch_v1.candidate.1' as const;

export const PARTIAL_AEO_XML_PROJECTOR_VERSION =
  'partial_aeo_xml_projector_v1.candidate.1' as const;

export const AEO_SEMANTIC_STRUCTURE_PATCH_VERSION =
  'aeo_semantic_structure_patch_v1.candidate.1' as const;

export const AEO_DOCX_TABLE_OBSERVER_VERSION =
  'aeo_docx_table_observer_v1.local.1' as const;

export const AEO_DOCX_TABLE_PROJECTOR_VERSION =
  'aeo_docx_table_projector_v1.candidate.1' as const;

export const AEO_DOCX_VISUAL_BRANCH_PATCH_VERSION =
  'aeo_docx_visual_branch_patch_v1.candidate.1' as const;

export const AEO_DOCX_SEMANTIC_STRUCTURE_PATCH_VERSION =
  'aeo_docx_semantic_structure_patch_v1.candidate.1' as const;

export type AeoContentNodeType =
  | 'DOCUMENT_ROOT'
  | 'PARAGRAPH'
  | 'DATA_TABLE'
  | 'TABLE_ROW'
  | 'WORK_ITEM'
  | 'PROCEDURE_SUBSTEP'
  | 'NOTE_CALLOUT'
  | 'SAFETY_CALLOUT'
  | 'EMBEDDED_TABLE'
  | 'SIGNOFF'
  | 'SAFETY_CHECK_TABLE'
  | 'SAFETY_CHECK_ITEM';

export type AeoJsonValue =
  | null
  | boolean
  | number
  | string
  | AeoJsonValue[]
  | { [key: string]: AeoJsonValue };

export interface AeoContentSourceRef {
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  locatorKind:
    | 'MARKDOWN_DOCUMENT'
    | 'MARKDOWN_LINE_RANGE'
    | 'MARKDOWN_FRAGMENT'
    | 'DOCX_PARAGRAPH'
    | 'DOCX_TABLE'
    | 'DOCX_TABLE_CELL'
    | 'XML_DOCUMENT'
    | 'XML_XPATH';
  locator: string;
}

export interface AeoContentNode {
  nodeId: string;
  nodeHash: string;
  nodeType: AeoContentNodeType;
  fieldPath: string;
  parentNodeId: string | null;
  sequence: number;
  groupCode: string | null;
  titleZh: string | null;
  titleEn: string | null;
  bodyZh: string | null;
  bodyEn: string | null;
  valueJson: AeoJsonValue;
  sourceRefs: AeoContentSourceRef[];
  visualRegionRefs: string[];
  knowledgeAuthority: 'DOCUMENT_OCCURRENCE';
  reviewState: 'NEEDS_STRUCTURAL_REVIEW';
  importEligibility: 'BLOCKED_PENDING_STRUCTURAL_REVIEW';
}

export interface AeoStructuredParseFinding {
  code: string;
  severity: 'WARNING' | 'BLOCKING_REVIEW';
  nodeId: string | null;
  message: string;
}

export interface AeoTaxonomyCandidate {
  taxonomyVersion: 'aeo_taxonomy_v1.candidate.1';
  aircraftFamily: string | null;
  ataChapter: string | null;
  taskPurposeCandidates: string[];
  executionMethodCandidates: string[];
  reviewState: 'UNREVIEWED';
}

export interface LegacyAeoMarkdownProjectionInput {
  formalIdentity: AeoFormalIdentity;
  originalSource: {
    mediaType: string;
    byteLength: number;
    sha256: string;
  };
  legacyArtifact: {
    artifactId: string;
    producer: string;
    mediaType: 'text/markdown';
    byteLength: number;
    sha256: string;
    text: string;
  };
  currentness: 'UNVERIFIED' | 'CURRENT' | 'HISTORICAL' | 'CANCELLED';
  mappingAuthority: 'LOCAL_IDENTITY_AND_HASH_OBSERVATION';
}

export interface AeoStructuredParsePackageCandidate {
  contractVersion: typeof AEO_STRUCTURED_PARSE_CONTRACT_VERSION;
  projectorVersion: typeof LEGACY_AEO_MARKDOWN_PROJECTOR_VERSION;
  parsePackageId: string;
  packageHash: string;
  formalIdentity: AeoFormalIdentity;
  originalSource: LegacyAeoMarkdownProjectionInput['originalSource'];
  legacyArtifact: Omit<
    LegacyAeoMarkdownProjectionInput['legacyArtifact'],
    'text'
  >;
  projectionKind: 'LEGACY_AEO_PARSE_PROJECTION';
  reuseClass: 'ADAPT_AND_REVIEW';
  currentness: LegacyAeoMarkdownProjectionInput['currentness'];
  mappingAuthority: LegacyAeoMarkdownProjectionInput['mappingAuthority'];
  knowledgeAuthority: 'DOCUMENT_OCCURRENCE';
  knowledgeEligibility: 'NOT_EVALUATED';
  packageState: 'CANDIDATE_REVIEW_REQUIRED';
  taxonomyCandidate: AeoTaxonomyCandidate;
  nodes: AeoContentNode[];
  findings: AeoStructuredParseFinding[];
}

export interface PartialAeoXmlProjectionInput {
  formalIdentity: AeoFormalIdentity;
  xmlArtifact: {
    artifactId: string;
    path: string;
    producer: string;
    mediaType: 'application/xml';
    byteLength: number;
    sha256: string;
    text: string;
  };
  currentness: 'UNVERIFIED' | 'CURRENT' | 'HISTORICAL' | 'CANCELLED';
  mappingAuthority: 'LOCAL_EXACT_XML_OBSERVATION';
}

export interface AeoXmlMissingIncludeMember {
  href: string;
  memberPath: string;
  resolutionState: 'MISSING';
  byteLength: null;
  sha256: null;
}

export interface AeoPartialXmlProjectionPackageCandidate {
  contractVersion: typeof AEO_STRUCTURED_PARSE_CONTRACT_VERSION;
  projectorVersion: typeof PARTIAL_AEO_XML_PROJECTOR_VERSION;
  parsePackageId: string;
  packageHash: string;
  formalIdentity: AeoFormalIdentity;
  originalSource: {
    mediaType: 'application/xml';
    byteLength: number;
    sha256: string;
  };
  xmlArtifact: Omit<PartialAeoXmlProjectionInput['xmlArtifact'], 'text'>;
  projectionKind: 'PARTIAL_AEO_XML_PROJECTION';
  reuseClass: 'SELECTIVE_REPARSE';
  sourceCompleteness: 'PARTIAL_MISSING_XINCLUDE_MEMBER';
  missingIncludeMembers: AeoXmlMissingIncludeMember[];
  currentness: PartialAeoXmlProjectionInput['currentness'];
  mappingAuthority: PartialAeoXmlProjectionInput['mappingAuthority'];
  knowledgeAuthority: 'DOCUMENT_OCCURRENCE';
  knowledgeEligibility: 'NOT_EVALUATED';
  packageState: 'CANDIDATE_SOURCE_INCOMPLETE';
  taxonomyCandidate: AeoTaxonomyCandidate;
  nodes: AeoContentNode[];
  findings: AeoStructuredParseFinding[];
}

export interface AeoDocxObservedParagraph {
  paragraphIndex: number;
  styleName: string;
  text: string;
}

export interface AeoDocxObservedTableRow {
  rowIndex: number;
  cells: string[];
}

export interface AeoDocxObservedTable {
  tableIndex: number;
  rows: AeoDocxObservedTableRow[];
}

export interface AeoDocxTableObservation {
  observerVersion: typeof AEO_DOCX_TABLE_OBSERVER_VERSION;
  producer: 'python-docx local structural observer';
  sourceSha256: string;
  paragraphs: AeoDocxObservedParagraph[];
  tables: AeoDocxObservedTable[];
  inlineShapeCount: number;
  sectionCount: number;
}

export interface AeoDocxTableProjectionInput {
  formalIdentity: AeoFormalIdentity;
  originalSource: {
    mediaType: string;
    byteLength: number;
    sha256: string;
  };
  observation: AeoDocxTableObservation;
  observationHash: string;
  currentness: 'UNVERIFIED' | 'CURRENT' | 'HISTORICAL' | 'CANCELLED';
  mappingAuthority: 'LOCAL_EXACT_DOCX_OBSERVATION';
}

export interface AeoDocxTableProjectionPackageCandidate {
  contractVersion: typeof AEO_STRUCTURED_PARSE_CONTRACT_VERSION;
  projectorVersion: typeof AEO_DOCX_TABLE_PROJECTOR_VERSION;
  parsePackageId: string;
  packageHash: string;
  formalIdentity: AeoFormalIdentity;
  originalSource: AeoDocxTableProjectionInput['originalSource'];
  observationArtifact: {
    observerVersion: typeof AEO_DOCX_TABLE_OBSERVER_VERSION;
    producer: AeoDocxTableObservation['producer'];
    observationHash: string;
    sourceSha256: string;
  };
  projectionKind: 'DOCX_TABLE_OBSERVATION_PROJECTION';
  reuseClass: 'ADAPT_AND_REVIEW';
  currentness: AeoDocxTableProjectionInput['currentness'];
  mappingAuthority: AeoDocxTableProjectionInput['mappingAuthority'];
  knowledgeAuthority: 'DOCUMENT_OCCURRENCE';
  knowledgeEligibility: 'NOT_EVALUATED';
  packageState: 'CANDIDATE_REVIEW_REQUIRED';
  taxonomyCandidate: AeoTaxonomyCandidate;
  nodes: AeoContentNode[];
  findings: AeoStructuredParseFinding[];
}

export interface AeoDocxVisualItemCorrection {
  nodeId: string;
  sourceLocator: string;
  pageNumbers: number[];
  itemLabel: string;
}

export interface AeoDocxVisualBranchDeclaration {
  sourceNodeId: string;
  sourceFragment: string;
  pageNumbers: number[];
  outcomeLabel: 'IF_YES';
  effect: 'GOTO_AND_MARK_NOT_APPLICABLE';
  targetNodeId: string;
  expectedTargetItemLabel: string;
  notApplicableNodeIds: string[];
  expectedNotApplicableItemLabels: string[];
}

export interface AeoDocxVisualBranchPatch {
  patchVersion: typeof AEO_DOCX_VISUAL_BRANCH_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  pageCount: number;
  reviewedPages: number[];
  renderFidelity: 'FULL_VISUAL';
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  itemCorrections: AeoDocxVisualItemCorrection[];
  branchDeclarations: AeoDocxVisualBranchDeclaration[];
}

export interface AeoDocxReviewedBranchEdge {
  branchEdgeId: string;
  sourceNodeId: string;
  sourceFragmentSha256: string;
  pageNumbers: number[];
  outcomeLabel: 'IF_YES';
  effect: 'GOTO_AND_MARK_NOT_APPLICABLE';
  targetNodeId: string;
  targetDisplayedItemLabel: string;
  notApplicableNodeIds: string[];
  notApplicableDisplayedItemLabels: string[];
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  reviewState: 'NEEDS_ENGINEERING_REVIEW';
}

export interface AeoDocxVisuallyReviewedParsePackageCandidate
  extends AeoDocxTableProjectionPackageCandidate {
  parentParsePackageId: string;
  parentPackageHash: string;
  visualBranchPatchVersion: typeof AEO_DOCX_VISUAL_BRANCH_PATCH_VERSION;
  visualBranchPatchHash: string;
  visualBranchReview: Omit<
    AeoDocxVisualBranchPatch,
    'itemCorrections' | 'branchDeclarations'
  > & {
    correctedWorkItemCount: number;
    branchEdgeCount: number;
    preciseRegionState: 'PAGE_ONLY_NO_BBOX';
  };
  branchEdges: AeoDocxReviewedBranchEdge[];
}

export interface AeoDocxNoteCalloutDeclaration {
  structureKind: 'NOTE_CALLOUT';
  structureIndex: number;
  parentNodeId: string;
  pageNumbers: number[];
  sourceFragmentsMixed: string[];
}

export interface AeoDocxProcedureSubstepDeclaration {
  structureKind: 'PROCEDURE_SUBSTEP';
  structureIndex: number;
  parentNodeId: string;
  pageNumbers: number[];
  displayedSubstepLabel: string;
  sourceFragmentsMixed: string[];
}

export type AeoDocxSemanticStructureDeclaration =
  | AeoDocxNoteCalloutDeclaration
  | AeoDocxProcedureSubstepDeclaration;

export interface AeoDocxSemanticStructureCoverageAssertion {
  parentNodeId: string;
  structureKind: AeoDocxSemanticStructureDeclaration['structureKind'];
  expectedDeclarationCount: number;
  coverageAuthority: 'DEVELOPMENT_STRUCTURAL_QA_FULL_VISUAL';
}

export interface AeoDocxSemanticStructurePatch {
  patchVersion: typeof AEO_DOCX_SEMANTIC_STRUCTURE_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  declarations: AeoDocxSemanticStructureDeclaration[];
  coverageAssertions: AeoDocxSemanticStructureCoverageAssertion[];
}

export interface AeoDocxSemanticallyEnrichedParsePackageCandidate
  extends AeoDocxVisuallyReviewedParsePackageCandidate {
  docxSemanticParentParsePackageId: string;
  docxSemanticParentPackageHash: string;
  docxSemanticStructurePatchVersion: typeof AEO_DOCX_SEMANTIC_STRUCTURE_PATCH_VERSION;
  docxSemanticStructurePatchHash: string;
  docxSemanticStructureReview: {
    reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
    declarationCount: number;
    coverageAssertionCount: number;
    addedNodeCount: number;
    noteCalloutCount: number;
    procedureSubstepCount: number;
  };
}

export type AnyAeoStructuredParsePackageCandidate =
  | AeoStructuredParsePackageCandidate
  | AeoPartialXmlProjectionPackageCandidate
  | AeoDocxTableProjectionPackageCandidate
  | AeoDocxVisuallyReviewedParsePackageCandidate
  | AeoDocxSemanticallyEnrichedParsePackageCandidate
  | AeoDocxNestedTableEnrichedParsePackageCandidate
  | AeoDocxNoteReferenceEnrichedParsePackageCandidate
  | AeoDocxSemanticBilingualEnrichedParsePackageCandidate
  | AeoDocxAuthoringBilingualEnrichedParsePackageCandidate
  | AeoDocxSafetyParagraphRegionEnrichedParsePackageCandidate
  | AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate;

export type AeoVisualConfirmedStructure =
  | 'WORK_ITEM_NUMBER'
  | 'SUBSTEP_SEQUENCE'
  | 'EMBEDDED_TABLE_PRESENT'
  | 'SAFETY_CALLOUT_PRESENT'
  | 'SIGNOFF_PRESENT'
  | 'SAFETY_CHECK_TABLE_PRESENT';

export interface AeoVisualReviewCorrection {
  nodeId: string;
  pageNumbers: number[];
  itemLabel: string | null;
  substepLabels: string[];
  confirmedStructures: AeoVisualConfirmedStructure[];
}

export interface AeoVisualReviewPatch {
  patchVersion: typeof AEO_VISUAL_REVIEW_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  pageCount: number;
  reviewedPages: number[];
  renderFidelity:
    | 'FULL_VISUAL'
    | 'STRUCTURE_ONLY_CJK_FONT_INCOMPLETE';
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  corrections: AeoVisualReviewCorrection[];
}

export interface AeoReviewedStructuredParsePackageCandidate
  extends AeoStructuredParsePackageCandidate {
  parentParsePackageId: string;
  parentPackageHash: string;
  reviewPatchVersion: typeof AEO_VISUAL_REVIEW_PATCH_VERSION;
  reviewPatchHash: string;
  visualReview: Omit<AeoVisualReviewPatch, 'corrections'> & {
    correctedNodeCount: number;
  };
}

export interface AeoSemanticSafetyCalloutDeclaration {
  structureKind: 'SAFETY_CALLOUT';
  structureIndex: number;
  parentNodeId: string;
  pageNumbers: number[];
  sourceFragment: string;
  calloutKind: 'WARNING' | 'CAUTION' | 'NOTE';
  bodyMixed: string;
}

export interface AeoSemanticEmbeddedTableDeclaration {
  structureKind: 'EMBEDDED_TABLE';
  structureIndex: number;
  parentNodeId: string;
  pageNumbers: number[];
  sourceFragment: string;
  titleMixed: string;
  columnsMixed: string[];
  rows: Array<{ cellsMixed: string[] }>;
}

export type AeoSemanticStructureDeclaration =
  | AeoSemanticSafetyCalloutDeclaration
  | AeoSemanticEmbeddedTableDeclaration;

export interface AeoSemanticStructurePatch {
  patchVersion: typeof AEO_SEMANTIC_STRUCTURE_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  legacyArtifactSha256: string;
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  declarations: AeoSemanticStructureDeclaration[];
}

export interface AeoSemanticallyEnrichedParsePackageCandidate
  extends AeoReviewedStructuredParsePackageCandidate {
  semanticParentParsePackageId: string;
  semanticParentPackageHash: string;
  semanticStructurePatchVersion: typeof AEO_SEMANTIC_STRUCTURE_PATCH_VERSION;
  semanticStructurePatchHash: string;
  semanticStructureReview: {
    reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
    declarationCount: number;
    addedNodeCount: number;
  };
}

/**
 * The three final outputs emitted by the currently implemented parse chains.
 * Intermediate projection and patch outputs deliberately remain outside this
 * union even though they are covered by AnyAeoStructuredParsePackageCandidate.
 */
export type AeoStructuredParseCurrentFinalPackageCandidate =
  | AeoSemanticallyEnrichedParsePackageCandidate
  | AeoPartialXmlProjectionPackageCandidate
  | AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate;
