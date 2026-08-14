import type {
  AeoContentNodeType,
} from './aeo-structured-parse';
import type {
  AeoDocxRenderedPdfEvidence,
  AeoDocxSafetyParagraphRegionEnrichedParsePackageCandidate,
} from './aeo-docx-safety-paragraph-region';

export const AEO_DOCX_AUTHORING_RENDERED_REGION_PATCH_VERSION =
  'aeo_docx_authoring_rendered_region_patch_v1.candidate.1' as const;

export type AeoDocxAuthoringRenderedRegionNodeType = Extract<
  AeoContentNodeType,
  'WORK_ITEM' | 'NOTE_CALLOUT' | 'PROCEDURE_SUBSTEP' | 'SIGNOFF'
>;

export type AeoDocxAuthoringRenderedRegionSourceRole =
  | 'ITEM_LABEL'
  | 'SUBSTEP_LABEL'
  | 'BODY_ZH'
  | 'BODY_EN'
  | 'PERFORMED_BY'
  | 'INSPECTED_BY'
  | 'SIGNATURE_LABEL_ZH'
  | 'SIGNATURE_LABEL_EN';

export interface AeoDocxAuthoringRenderedSourceText {
  sourceRole: AeoDocxAuthoringRenderedRegionSourceRole;
  sourceText: string;
}

export interface AeoDocxAuthoringRenderedRegionDeclaration {
  regionIndex: number;
  sourceRole: AeoDocxAuthoringRenderedRegionSourceRole;
  pageNumber: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  visualTextObserved: string;
}

export interface AeoDocxAuthoringRenderedNodeDeclaration {
  nodeId: string;
  nodeHash: string;
  nodeType: AeoDocxAuthoringRenderedRegionNodeType;
  sourceLocators: string[];
  sourceTexts: AeoDocxAuthoringRenderedSourceText[];
  regions: AeoDocxAuthoringRenderedRegionDeclaration[];
}

export interface AeoDocxAuthoringRenderedBranchDeclaration {
  branchEdgeId: string;
  branchBindingHash: string;
  sourceNodeId: string;
  sourceLocators: string[];
  sourceTexts: AeoDocxAuthoringRenderedSourceText[];
  regions: AeoDocxAuthoringRenderedRegionDeclaration[];
}

export interface AeoDocxAuthoringRenderedRegionCoverageAssertion {
  workItemCount: number;
  noteCalloutCount: number;
  procedureSubstepCount: number;
  signoffCount: number;
  branchEdgeCount: number;
  sourceTextCount: number;
  regionCount: number;
  coverageAuthority: 'DEVELOPMENT_STRUCTURAL_QA_AUTHORING_PROSE_AND_BRANCH';
}

export interface AeoDocxAuthoringRenderedRegionPatch {
  patchVersion: typeof AEO_DOCX_AUTHORING_RENDERED_REGION_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  renderArtifactSha256: string;
  renderFidelity: 'STRUCTURE_ONLY_CJK_FONT_INCOMPLETE';
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  nodeDeclarations: AeoDocxAuthoringRenderedNodeDeclaration[];
  branchDeclarations: AeoDocxAuthoringRenderedBranchDeclaration[];
  coverageAssertion: AeoDocxAuthoringRenderedRegionCoverageAssertion;
}

export interface AeoDocxReviewedAuthoringRenderedRegion
  extends AeoDocxAuthoringRenderedRegionDeclaration {
  regionId: string;
  subjectKind: 'NODE' | 'BRANCH_EDGE';
  subjectId: string;
  sourceLocators: string[];
  renderArtifactSha256: string;
  coordinateSpace: 'PDF_POINTS_TOP_LEFT';
}

export interface AeoDocxAuthoringRenderedRegionEnrichedParsePackageCandidate
  extends AeoDocxSafetyParagraphRegionEnrichedParsePackageCandidate {
  authoringRenderedRegionParentParsePackageId: string;
  authoringRenderedRegionParentPackageHash: string;
  authoringRenderedRegionPatchVersion: typeof AEO_DOCX_AUTHORING_RENDERED_REGION_PATCH_VERSION;
  authoringRenderedRegionPatchHash: string;
  authoringRenderedRegionReview: {
    reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
    coverageScope: 'WORK_ITEMS_NOTES_SUBSTEPS_SIGNOFF_AND_BRANCH';
    renderFidelity: 'STRUCTURE_ONLY_CJK_FONT_INCOMPLETE';
    workItemCount: number;
    noteCalloutCount: number;
    procedureSubstepCount: number;
    signoffCount: number;
    branchEdgeCount: number;
    sourceTextCount: number;
    preciseRegionCount: number;
    preciseRegionState: 'AUTHORING_PROSE_BBOX_CJK_INCOMPLETE_TABLE_AND_CONTAINER_NODES_PAGE_ONLY';
    renderArtifact: AeoDocxRenderedPdfEvidence;
    nodeRegions: AeoDocxReviewedAuthoringRenderedRegion[];
    branchRegions: AeoDocxReviewedAuthoringRenderedRegion[];
  };
}
