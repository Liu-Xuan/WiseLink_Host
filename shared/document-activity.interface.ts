import type { DocumentOriginalBinding, DocumentOriginalCoverage } from './document-original.interface';
import type { TranslationSourceAnchorV2 } from './canonical-translation-v2.interface';

export const DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA = 'wiselink.document.activity-candidate.v1' as const;
export interface DocumentActivitySelection { sectionIds: string[] }
/** Recorded by Host after actual delivery, including ancestor/context units. */
export interface DocumentActivityDeliveryRange {
  sectionId: string;
  offset: number;
  unitIds: string[];
  anchorIds: string[];
  nextOffset: number | null;
}
export interface DocumentActivityQuote {
  anchorId: string;
  /** Exact UTF-16 offsets within this anchor's sourceText, end exclusive. */
  start: number;
  end: number;
  text: string;
}
export interface DocumentActivityTime {
  role: 'TARGET' | 'OCCURRED' | 'SOURCE_PUBLICATION' | 'EFFECTIVE' | 'CONDITION' | 'UNKNOWN';
  precision: 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY' | 'UNKNOWN';
  expression: 'CALENDAR' | 'TBD' | 'RELATIVE' | 'UNKNOWN';
  /** Source wording only. No inferred calendar date, timezone or frequency. */
  raw: string;
  quoteIndex: number;
}
export interface DocumentActivityStatementProposal {
  /** Local to this candidate request; never a cross-version activity identity. */
  statementKey: string;
  label: string;
  quotes: DocumentActivityQuote[];
  time: DocumentActivityTime | null;
  statusRaw: string | null;
  limitations: string[];
}
export interface DocumentActivityCandidateProposal {
  schemaVersion: typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA;
  statements: DocumentActivityStatementProposal[];
}
export interface DocumentActivitySourceBinding {
  original: DocumentOriginalBinding;
  semanticRevision: number;
}
export interface DocumentActivityReadCoverage {
  status: 'DELIVERED_RANGES_ONLY';
  selection: DocumentActivitySelection;
  deliveredRanges: DocumentActivityDeliveryRange[];
  sourceCoverage: DocumentOriginalCoverage;
}
/** Model interpretation of exact source quotations; not verified execution or adoption. */
export interface ValidatedDocumentActivityCandidate extends DocumentActivityCandidateProposal {
  candidateOnly: true;
  sourceBinding: DocumentActivitySourceBinding;
  readCoverage: DocumentActivityReadCoverage;
  /** Full delivered anchors preserve conditions, table cell paths and SourceRefs. */
  sourceAnchors: TranslationSourceAnchorV2[];
}
export interface DocumentActivityStatement extends DocumentActivityStatementProposal {
  /** Host allocated identity, independent of any assessment work. */
  statementId: string;
}
export interface DocumentActivityRevision extends Omit<ValidatedDocumentActivityCandidate, 'statements'> {
  runRef: string;
  candidateRevision: number;
  statements: DocumentActivityStatement[];
  producer: { skillVersion: string; modelVersion: string };
  savedAt: string;
}
/** A work cites a saved source statement; it does not own or redefine that statement. */
export interface DocumentActivityStatementReference {
  runRef: string;
  candidateRevision: number;
  statementId: string;
}

export interface DocumentActivityReadingRequest {
  documentVersionId: string;
  parseRunId: string;
  candidateRevision?: number;
}
export interface DocumentActivityReadingResponse {
  familyId: string;
  binding: DocumentOriginalBinding;
  /** No saved result for this exact source/revision, not a claim that it has no activities. */
  candidate: DocumentActivityRevision | null;
}
