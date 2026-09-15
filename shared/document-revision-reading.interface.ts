import type { DocumentOriginalBinding, DocumentOriginalCoverage } from './document-original.interface';
import type { DocumentSemanticMap, DocumentSemanticSelection } from './document-semantic-map.interface';
import type { TranslationStructuredSource } from './canonical-translation-v2.interface';

export interface DocumentRevisionReadingIdentity {
  documentVersionId: string;
  parseRunId: string;
  semanticRevision: number;
}
export interface DocumentRevisionReadingRequest {
  before: DocumentRevisionReadingIdentity;
  after: DocumentRevisionReadingIdentity;
  /** A known content role. Repeated roles remain unaligned. */
  roleKey: string;
}
export interface DocumentRevisionSectionReading {
  selection: DocumentSemanticSelection;
  units: TranslationStructuredSource['units'];
  sourceLocators: TranslationStructuredSource['sourceLocators'];
}
export interface DocumentRevisionReadingSide {
  binding: DocumentOriginalBinding;
  semanticRevision: number;
  profileRef: string;
  sections: DocumentSemanticMap['sections'];
  publisherRevisionDescriptions: DocumentRevisionSectionReading[];
  selectedSections: DocumentRevisionSectionReading[];
  coverage: DocumentOriginalCoverage;
  unselectedUnitIds: string[];
}
export interface DocumentRevisionReadingResponse {
  familyId: string;
  before: DocumentRevisionReadingSide;
  after: DocumentRevisionReadingSide;
  systemComparison: {
    roleKey: string;
    status: 'TEXT_EQUAL' | 'TEXT_DIFFERENT' | 'NOT_COMPARED';
    /** Exact text after whitespace normalization; excludes tables, figures and engineering meaning. */
    method: 'PLAIN_TEXT_WITH_PARENT_CONTEXT';
    reasons: string[];
  };
  /** A pair of source versions does not establish publication ordering or adoption. */
  publicationRelationship: 'NOT_VERIFIED';
  assessmentCoverage: 'NOT_RECORDED_BY_THIS_READ';
}
