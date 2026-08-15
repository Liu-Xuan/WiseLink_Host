import type {
  AeoDocxNoteReferenceEnrichedParsePackageCandidate,
  AeoDocxReviewedNoteReferenceEdge,
} from './aeo-docx-note-reference';

export const AEO_DOCX_SEMANTIC_BILINGUAL_PATCH_VERSION =
  'aeo_docx_semantic_bilingual_patch_v1.candidate.1' as const;

export type AeoDocxSemanticBilingualNodeKind =
  | 'NOTE_CALLOUT'
  | 'PROCEDURE_SUBSTEP';

export interface AeoDocxSemanticBilingualNodeDeclaration {
  nodeId: string;
  structureKind: AeoDocxSemanticBilingualNodeKind;
  bodyZh: string;
  bodyEn: string;
}

export interface AeoDocxBilingualNoteReferenceDeclaration {
  referenceEdgeId: string;
  sourceReferenceTokenZh: string;
  sourceReferenceTokenEnObserved: string;
  canonicalReferenceTokenEn: string;
}

export interface AeoDocxSemanticBilingualCoverageAssertion {
  noteCalloutCount: number;
  procedureSubstepCount: number;
  noteReferenceEdgeCount: number;
  coverageAuthority: 'DEVELOPMENT_BILINGUAL_QA_FULL_SEMANTIC_CHILD_AND_REFERENCE_TOKEN_REVIEW';
}

export interface AeoDocxSemanticBilingualPatch {
  patchVersion: typeof AEO_DOCX_SEMANTIC_BILINGUAL_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  reviewAuthority: 'DEVELOPMENT_BILINGUAL_QA';
  nodeDeclarations: AeoDocxSemanticBilingualNodeDeclaration[];
  referenceDeclarations: AeoDocxBilingualNoteReferenceDeclaration[];
  coverageAssertion: AeoDocxSemanticBilingualCoverageAssertion;
}

export interface AeoDocxBilingualReviewedNoteReferenceEdge
  extends AeoDocxReviewedNoteReferenceEdge {
  referenceTokenZh: string;
  referenceTokenEnObserved: string;
  referenceTokenEnCanonical: string;
  bilingualPairingState: 'DEVELOPMENT_BILINGUAL_QA_CONFIRMED';
}

export interface AeoDocxSemanticBilingualEnrichedParsePackageCandidate
  extends AeoDocxNoteReferenceEnrichedParsePackageCandidate {
  semanticBilingualParentParsePackageId: string;
  semanticBilingualParentPackageHash: string;
  semanticBilingualPatchVersion: typeof AEO_DOCX_SEMANTIC_BILINGUAL_PATCH_VERSION;
  semanticBilingualPatchHash: string;
  semanticBilingualReview: {
    reviewAuthority: 'DEVELOPMENT_BILINGUAL_QA';
    coverageScope: 'NOTE_CALLOUT_PROCEDURE_SUBSTEP_AND_NOTE_REFERENCE_TOKENS';
    nodePairCount: number;
    noteCalloutCount: number;
    procedureSubstepCount: number;
    noteReferenceTokenPairCount: number;
  };
  noteReferenceEdges: AeoDocxBilingualReviewedNoteReferenceEdge[];
}
