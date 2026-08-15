import type {
  AeoDocxNestedTableEnrichedParsePackageCandidate,
} from './aeo-docx-nested-table';

export const AEO_DOCX_NOTE_REFERENCE_PATCH_VERSION =
  'aeo_docx_note_reference_patch_v1.candidate.1' as const;

export interface AeoDocxNoteReferenceDeclaration {
  sourceTableRowNodeId: string;
  sourceColumnStart: number;
  referenceTokenMixed: string;
  targetNoteNodeId: string;
  pageNumbers: number[];
}

export interface AeoDocxNoteReferenceCoverageAssertion {
  embeddedTableNodeId: string;
  expectedReferenceCount: number;
  coverageAuthority: 'DEVELOPMENT_STRUCTURAL_QA_FULL_XML_AND_VISUAL';
}

export interface AeoDocxNoteReferencePatch {
  patchVersion: typeof AEO_DOCX_NOTE_REFERENCE_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  declarations: AeoDocxNoteReferenceDeclaration[];
  coverageAssertions: AeoDocxNoteReferenceCoverageAssertion[];
}

export interface AeoDocxReviewedNoteReferenceEdge {
  referenceEdgeId: string;
  sourceTableNodeId: string;
  sourceTableRowNodeId: string;
  sourceColumnStart: number;
  sourceCellTextSha256: string;
  referenceTokenMixed: string;
  targetNoteNodeId: string;
  pageNumbers: number[];
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  reviewState: 'NEEDS_ENGINEERING_REVIEW';
}

export interface AeoDocxNoteReferenceEnrichedParsePackageCandidate
  extends AeoDocxNestedTableEnrichedParsePackageCandidate {
  noteReferenceParentParsePackageId: string;
  noteReferenceParentPackageHash: string;
  noteReferencePatchVersion: typeof AEO_DOCX_NOTE_REFERENCE_PATCH_VERSION;
  noteReferencePatchHash: string;
  noteReferenceStructureReview: {
    reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
    coverageAssertionCount: number;
    referenceEdgeCount: number;
    referencedNoteNodeCount: number;
  };
  noteReferenceEdges: AeoDocxReviewedNoteReferenceEdge[];
}
