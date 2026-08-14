import type { AeoDocxReviewedBranchEdge } from './aeo-structured-parse';
import type { AeoDocxSemanticBilingualEnrichedParsePackageCandidate } from './aeo-docx-semantic-bilingual';

export const AEO_DOCX_AUTHORING_BILINGUAL_PATCH_VERSION =
  'aeo_docx_authoring_bilingual_patch_v1.candidate.1' as const;

export interface AeoDocxAuthoringBilingualWorkItemDeclaration {
  nodeId: string;
  bodyZh: string;
  bodyEn: string;
}

export interface AeoDocxAuthoringBilingualBranchDeclaration {
  branchEdgeId: string;
  sourceFragmentZh: string;
  sourceFragmentEn: string;
}

export interface AeoDocxAuthoringBilingualSignoffDeclaration {
  nodeId: string;
  bodyZh: string;
  bodyEn: string;
  signatureLabelZh: string;
  signatureLabelEn: string;
}

export interface AeoDocxAuthoringBilingualTableCellDeclaration {
  rowNodeId: string;
  columnStart: number;
  sourceTextMixed: string;
  textZhObserved: string;
  textZhCanonical: string;
  textEnObserved: string;
  textEnCanonical: string;
}

export interface AeoDocxAuthoringBilingualCoverageAssertion {
  workItemCount: number;
  signoffCount: number;
  branchEdgeCount: number;
  embeddedTableMixedCellCount: number;
  coverageAuthority: 'DEVELOPMENT_BILINGUAL_QA_FULL_AUTHORING_SCOPE_REVIEW';
}

export interface AeoDocxAuthoringBilingualPatch {
  patchVersion: typeof AEO_DOCX_AUTHORING_BILINGUAL_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  reviewAuthority: 'DEVELOPMENT_BILINGUAL_QA';
  workItemDeclarations: AeoDocxAuthoringBilingualWorkItemDeclaration[];
  branchDeclarations: AeoDocxAuthoringBilingualBranchDeclaration[];
  signoffDeclarations: AeoDocxAuthoringBilingualSignoffDeclaration[];
  tableCellDeclarations: AeoDocxAuthoringBilingualTableCellDeclaration[];
  coverageAssertion: AeoDocxAuthoringBilingualCoverageAssertion;
}

export interface AeoDocxBilingualReviewedBranchEdge
  extends AeoDocxReviewedBranchEdge {
  sourceFragmentZh: string;
  sourceFragmentEn: string;
  bilingualPairingState: 'DEVELOPMENT_BILINGUAL_QA_CONFIRMED';
}

export interface AeoDocxAuthoringBilingualEnrichedParsePackageCandidate
  extends AeoDocxSemanticBilingualEnrichedParsePackageCandidate {
  authoringBilingualParentParsePackageId: string;
  authoringBilingualParentPackageHash: string;
  authoringBilingualPatchVersion: typeof AEO_DOCX_AUTHORING_BILINGUAL_PATCH_VERSION;
  authoringBilingualPatchHash: string;
  authoringBilingualReview: {
    reviewAuthority: 'DEVELOPMENT_BILINGUAL_QA';
    coverageScope: 'WORK_ITEMS_SIGNOFF_BRANCH_AND_EMBEDDED_TABLE_MIXED_CELLS';
    workItemPairCount: number;
    signoffPairCount: number;
    branchPairCount: number;
    embeddedTableMixedCellPairCount: number;
  };
  branchEdges: AeoDocxBilingualReviewedBranchEdge[];
}
