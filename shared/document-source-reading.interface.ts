import type { AssessmentEvidence } from './assessment-reading.interface';

/** Reading scope refers to physical, one-based PDF pages, never printed labels. */
export interface DocumentSourceReading {
  documentVersionId: string;
  sourceSha256: string;
  sourceByteLength: number;
  pageCount: number;
  extractionScope: 'NATIVE_TEXT_LAYER';
  pages: Array<{
    page: number;
    sourceRefId: string;
    text: string;
    textLayerStatus: 'PRESENT' | 'EMPTY' | 'VISUAL_TEXT_UNVERIFIED';
    visualContentVerified: false;
    evidence: Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }> | null;
  }>;
}
