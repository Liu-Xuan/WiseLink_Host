import type { AeoDocxAuthoringBilingualEnrichedParsePackageCandidate } from './aeo-docx-authoring-bilingual';

export const AEO_DOCX_SAFETY_PARAGRAPH_REGION_PATCH_VERSION =
  'aeo_docx_safety_paragraph_region_patch_v1.candidate.1' as const;

export type AeoDocxSafetyParagraphStructureKind =
  | 'SAFETY_DISTRIBUTION_HEADING'
  | 'SAFETY_DISTRIBUTION_NOTES_HEADING'
  | 'SAFETY_DISTRIBUTION_NOTE';

export interface AeoDocxRenderedPdfEvidence {
  artifactId: string;
  mediaType: 'application/pdf';
  byteLength: number;
  sha256: string;
  sourceDocxSha256: string;
  producer: 'LibreOfficeDev 26.8.0.0.alpha0 (AARCH64)';
  bboxExtractor: 'Poppler pdftotext 25.03.0 -bbox-layout';
  pageCount: number;
  pageWidthPt: number;
  pageHeightPt: number;
  coordinateSpace: 'PDF_POINTS_TOP_LEFT';
}

export interface AeoDocxParagraphRenderedRegionDeclaration {
  regionIndex: number;
  pageNumber: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  sourceFragment: string;
  visualTextObserved: string;
}

export interface AeoDocxSafetyParagraphDeclaration {
  nodeId: string;
  sourceLocator: string;
  paragraphIndex: number;
  sourceText: string;
  structureKind: AeoDocxSafetyParagraphStructureKind;
  displayedListLabel: string | null;
  regions: AeoDocxParagraphRenderedRegionDeclaration[];
}

export interface AeoDocxSafetyParagraphCoverageAssertion {
  paragraphCount: number;
  headingCount: number;
  notesHeadingCount: number;
  noteItemCount: number;
  regionCount: number;
  coverageAuthority: 'DEVELOPMENT_STRUCTURAL_QA_ALL_TABLE_EXTERNAL_PARAGRAPHS';
}

export interface AeoDocxSafetyParagraphRegionPatch {
  patchVersion: typeof AEO_DOCX_SAFETY_PARAGRAPH_REGION_PATCH_VERSION;
  targetParsePackageId: string;
  targetPackageHash: string;
  originalSourceSha256: string;
  observationHash: string;
  reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
  renderArtifact: AeoDocxRenderedPdfEvidence;
  declarations: AeoDocxSafetyParagraphDeclaration[];
  coverageAssertion: AeoDocxSafetyParagraphCoverageAssertion;
}

export interface AeoDocxReviewedParagraphRegion
  extends AeoDocxParagraphRenderedRegionDeclaration {
  regionId: string;
  nodeId: string;
  sourceLocator: string;
  renderArtifactSha256: string;
  coordinateSpace: 'PDF_POINTS_TOP_LEFT';
}

export interface AeoDocxSafetyParagraphRegionEnrichedParsePackageCandidate
  extends AeoDocxAuthoringBilingualEnrichedParsePackageCandidate {
  safetyParagraphParentParsePackageId: string;
  safetyParagraphParentPackageHash: string;
  safetyParagraphRegionPatchVersion: typeof AEO_DOCX_SAFETY_PARAGRAPH_REGION_PATCH_VERSION;
  safetyParagraphRegionPatchHash: string;
  safetyParagraphStructureReview: {
    reviewAuthority: 'DEVELOPMENT_STRUCTURAL_QA';
    coverageScope: 'ALL_DOCX_TABLE_EXTERNAL_SAFETY_PARAGRAPHS';
    paragraphCount: number;
    headingCount: number;
    notesHeadingCount: number;
    noteItemCount: number;
    preciseRegionCount: number;
    preciseRegionState: 'ALL_SAFETY_PARAGRAPHS_EXACT_OTHER_NODES_PAGE_ONLY';
    renderArtifact: AeoDocxRenderedPdfEvidence;
    regions: AeoDocxReviewedParagraphRegion[];
  };
}
