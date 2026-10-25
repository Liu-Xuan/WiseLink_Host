import type { DocumentSemanticProfileSelection } from './document-semantic-map.interface';
import type { DocumentOriginalBinding, DocumentOriginalCoverage } from './document-original.interface';
import type { TranslationSourceAnchorV2 } from './canonical-translation-v2.interface';
import type { CanonicalExecutionModelSelection } from './api.interface';

/** Legacy/default contract stays v1; v2 production is an explicit opt-in. */
export const DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA = 'wiselink.document.activity-candidate.v1' as const;
export const DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2 = 'wiselink.document.activity-candidate.v2' as const;
export const DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA = 'wiselink.document.activity-source-context.v1' as const;
export const DOCUMENT_ACTIVITY_QUOTE_OFFSETS_SCHEMA = 'wiselink.document.activity-quote-offsets.v1' as const;
export type DocumentActivityCandidateSchemaVersion = typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA | typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2;
/** Host-owned immutable producer contract. Null means provenance was not recorded. */
export interface DocumentActivityProductionContract {
  promptVersion: string;
  toolSchemaSha256: string;
  sourceContextVersion: typeof DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA;
  quoteTransportVersion: string;
}
export interface DocumentActivitySourceContext {
  schemaVersion: typeof DOCUMENT_ACTIVITY_SOURCE_CONTEXT_SCHEMA;
  sourceBinding: DocumentActivitySourceBinding;
  /** Recorded template provenance is metadata, never a READ receipt or business identity authority. */
  profile:
    | { profileRef: string; selectionBasis: 'NOT_RECORDED'; family: null; issuer: null }
    | { profileRef: string; selectionBasis: 'RECORDED';
        selectionSchemaVersion: 'wiselink.document.semantic-profile-selection.v1';
        /** Exact saved template inputs. No authoritative family/issuer fields are synthesized. */
        selection: DocumentSemanticProfileSelection };
  sections: Array<{
    sectionId: string; parentSectionId: string | null; titleRaw: string | null; roleKey: string | null;
    headingUnitId: string | null; deliveredUnitIds: string[]; contextForSectionIds: string[];
  }>;
  organizationWarnings: Array<{ code: 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING'; sectionIds: string[]; unitIds: string[] }>;
}
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
/** Exact source wording; no normalized or target-object value may be substituted. */
export interface DocumentActivityQuotedCue { raw: string; quoteIndex: number }
export interface DocumentActivityStatementProposalV2 {
  statementKey: string;
  label: string;
  quotes: DocumentActivityQuote[];
  /** null means not captured by this candidate, not absent from the source. */
  subject: DocumentActivityQuotedCue | null;
  action: DocumentActivityQuotedCue | null;
  modality: (DocumentActivityQuotedCue & {
    meaning: 'REQUIRED' | 'RECOMMENDED' | 'PLANNED' | 'POSSIBLE' | 'REPORTED' | 'UNKNOWN';
    negationQuoteIndexes: number[];
  }) | null;
  /** SOURCE_REPORTED_COMPLETED is a source assertion, never verified execution. */
  status: (DocumentActivityQuotedCue & {
    meaning: 'PLANNED' | 'IN_PROGRESS' | 'SOURCE_REPORTED_COMPLETED' | 'ON_HOLD' | 'CANCELLED' | 'UNKNOWN';
  }) | null;
  /** Empty arrays mean not captured; they never prove document-wide absence. */
  times: DocumentActivityTime[];
  technicalIds: Array<DocumentActivityQuotedCue & {
    kind: 'AIRCRAFT_LINE_NUMBER' | 'PART_NUMBER' | 'SERIAL_NUMBER' | 'PUBLICATION_ID' | 'TECHNICAL_LABEL' | 'UNKNOWN';
  }>;
  scope: {
    /** Limited to actual READ sections; this is an interpretation candidate. */
    sectionIds: string[];
    conditions: Array<DocumentActivityQuotedCue & {
      kind: 'CONDITION' | 'EXCEPTION' | 'PREREQUISITE' | 'LIMITATION';
      appliesTo: 'STATEMENT' | 'SECTION' | 'DOCUMENT' | 'UNRESOLVED';
      /** Nonempty only for SECTION; subset of this statement's scope. */
      sectionIds: string[];
    }>;
    completeness: 'DELIVERED_SCOPE_ONLY' | 'PARTIAL' | 'UNRESOLVED';
  };
  limitations: string[];
}
export interface DocumentActivityCandidateProposalV2 {
  schemaVersion: typeof DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA_V2;
  statements: DocumentActivityStatementProposalV2[];
}
export type AnyDocumentActivityCandidateProposal = DocumentActivityCandidateProposal | DocumentActivityCandidateProposalV2;
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
  producer: {
    skillVersion: string;
    /** Actual observed model provenance, independent of the Host selection. */
    modelVersion: string;
    /** Host-frozen run metadata; absent on legacy runs and never supplied by a model or SAVE caller. */
    executionModel?: CanonicalExecutionModelSelection;
  };
  savedAt: string;
}
/** V1 aliases deliberately remain narrow so legacy consumers cannot silently read v2. */
export type DocumentActivityRevisionV1 = DocumentActivityRevision;
export type ValidatedDocumentActivityCandidateV1 = ValidatedDocumentActivityCandidate;
export type ValidatedDocumentActivityCandidateV2 = DocumentActivityCandidateProposalV2 & {
  candidateOnly: true; sourceBinding: DocumentActivitySourceBinding; readCoverage: DocumentActivityReadCoverage;
  sourceAnchors: TranslationSourceAnchorV2[]; sourceContext: DocumentActivitySourceContext;
};
export interface DocumentActivityStatementV2 extends DocumentActivityStatementProposalV2 { statementId: string }
export type DocumentActivityRevisionV2 = Omit<ValidatedDocumentActivityCandidateV2, 'statements'> & {
  runRef: string; candidateRevision: number; statements: DocumentActivityStatementV2[];
  producer: DocumentActivityRevision['producer']; savedAt: string;
};
export type AnyValidatedDocumentActivityCandidate = ValidatedDocumentActivityCandidate | ValidatedDocumentActivityCandidateV2;
export type AnyDocumentActivityRevision = DocumentActivityRevision | DocumentActivityRevisionV2;
export type AnyDocumentActivityStatement = DocumentActivityStatement | DocumentActivityStatementV2;
/** Read-only source views: no normalization, inferred status or discarded time roles. */
export function isDocumentActivityStatementV2(statement: DocumentActivityStatementProposal | DocumentActivityStatementProposalV2): statement is DocumentActivityStatementProposalV2 {
  return 'times' in statement;
}
export function documentActivityStatementTimes(statement: DocumentActivityStatementProposal | DocumentActivityStatementProposalV2): DocumentActivityTime[] {
  const times = isDocumentActivityStatementV2(statement) ? statement.times : statement.time ? [statement.time] : [];
  return times.map(time => ({ ...time }));
}
export function documentActivityStatementStatusRaw(statement: DocumentActivityStatementProposal | DocumentActivityStatementProposalV2): string | null {
  return isDocumentActivityStatementV2(statement) ? statement.status?.raw ?? null : statement.statusRaw;
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
  /** Explicit read-only acceptance of saved v2 DTOs; defaults to the legacy v1 contract. */
  acceptCandidateSchemaV2?: boolean;
}
export interface DocumentActivityReadingResponse {
  familyId: string;
  binding: DocumentOriginalBinding;
  /** No saved result for this exact source/revision, not a claim that it has no activities. */
  candidate: DocumentActivityRevision | null;
}

/** Explicit opt-in response. A null tag records no saved result, never a presumed v2 result. */
export interface DocumentActivityVersionedReadingResponse {
  familyId: string;
  binding: DocumentOriginalBinding;
  sourceSchemaVersion: DocumentActivityCandidateSchemaVersion | null;
  candidate: AnyDocumentActivityRevision | null;
}
export type AnyDocumentActivityReadingResponse = DocumentActivityReadingResponse | DocumentActivityVersionedReadingResponse;
