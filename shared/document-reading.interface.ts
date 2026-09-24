import type { DocumentOriginalBinding, DocumentOriginalCoverage } from './document-original.interface';
import type { TranslationSourceAnchorV2 } from './canonical-translation-v2.interface';

/** File interpretation is independent of activity statements and matter assessments. */
export const DOCUMENT_READING_SCHEMA = 'wiselink.document.reading.v1' as const;

export interface DocumentReadingQuote {
  anchorId: string;
  start: number;
  end: number;
  text: string;
}

export interface DocumentReadingStatement {
  text: string;
  quotes: DocumentReadingQuote[];
}

export interface DocumentReadingProposal {
  schemaVersion: typeof DOCUMENT_READING_SCHEMA;
  headline: string;
  brief: DocumentReadingStatement;
  explanation: DocumentReadingStatement[];
  criticalConditions: DocumentReadingStatement[];
  limitations: string[];
}

/** Host records delivery; the model cannot claim that unseen material was read. */
export interface DocumentReadingDelivery {
  offset: number;
  unitIds: string[];
  anchorIds: string[];
  nextOffset: number | null;
}

export interface DocumentReadingRevision extends DocumentReadingProposal {
  readingRunRef: string;
  readingRevision: number;
  candidateOnly: true;
  sourceBinding: { original: DocumentOriginalBinding; semanticRevision: number };
  readCoverage: {
    /** Complete delivery does not assert that all figures or conditions are understood. */
    status: 'COMPLETE_DELIVERY' | 'PARTIAL_DELIVERY';
    deliveredUnitIds: string[];
    totalUnitCount: number;
    sourceCoverage: DocumentOriginalCoverage;
  };
  /** Only cited anchors, with their original locators; not another copy of the document. */
  sourceAnchors: TranslationSourceAnchorV2[];
  producer: { skillVersion: string; modelVersion: string };
  savedAt: string;
}

export interface DocumentReadingRequest {
  documentVersionId: string;
  parseRunId: string;
  semanticRevision: number;
  readingRevision?: number;
}

export interface DocumentReadingResponse {
  familyId: string;
  sourceBinding: DocumentReadingRevision['sourceBinding'];
  status: 'AVAILABLE' | 'RETRACTED' | 'NOT_GENERATED';
  reading: DocumentReadingRevision | null;
}

/** List projection of the same saved reading, without paragraphs or full source anchors. */
export interface DocumentReadingPreview {
  status: 'AVAILABLE' | 'RETRACTED' | 'SOURCE_CHANGED' | 'NOT_GENERATED';
  reading: {
    readingRunRef: string;
    readingRevision: number;
    headline: string;
    brief: string;
    criticalConditions: string[];
    limitations: string[];
    sourceLimitations: string[];
    sourceBinding: DocumentReadingRevision['sourceBinding'];
    coverageStatus: DocumentReadingRevision['readCoverage']['status'];
    deliveredUnitCount: number;
    totalUnitCount: number;
    savedAt: string;
  } | null;
}
