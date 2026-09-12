import type { DocumentOriginalCoverage } from './document-original.interface';

export interface DocumentSourceSearchHit {
  kind: 'SOURCE';
  documentVersionId: string;
  parseRunId: string;
  parseRevision: number;
  sourceRefId: string;
  evidenceRef: string;
  originalText: string;
  matchedRange: string;
  reason: 'FULL_TEXT' | 'EXACT_IDENTIFIER';
  rootRefs: string[];
  coverage: DocumentOriginalCoverage;
}
export interface DocumentSourceSearchResponse {
  hits: DocumentSourceSearchHit[];
  hasMore: boolean;
  limitations: string[];
}
