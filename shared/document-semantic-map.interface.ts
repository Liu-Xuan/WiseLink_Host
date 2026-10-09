import type {
  DocumentOriginalBinding,
  DocumentOriginalCoverage,
} from './document-original.interface';

/** Discover only saved organization of an exact published original; never produce it on GET. */
export interface DocumentSemanticReadingRequest {
  documentVersionId: string;
  parseRunId: string;
  semanticRevision?: number;
}

export interface DocumentSemanticReadingResponse {
  familyId: string;
  binding: DocumentOriginalBinding;
  coverage: DocumentOriginalCoverage;
  /** Null means no saved semantic revision, not empty original content. */
  semanticMap: DocumentSemanticMap | null;
}

/** An organization of an immutable original, never a second source or an engineering conclusion. */
export interface DocumentSemanticMap {
  schemaVersion: 'wiselink.document.semantic-map.v1';
  binding: DocumentOriginalBinding;
  /** Allocated with CAS by Host, scoped to this parseRun. */
  semanticRevision: number;
  profileRef: string;
  /** Absent on historical maps means the selection basis was not recorded.
   * Selection identifies organization rules only, not source completeness or engineering acceptance. */
  profileSelection?: DocumentSemanticProfileSelection;
  sections: DocumentSemanticSection[];
  unassignedUnitIds: string[];
  /** Known source roles interrupted by ambiguous heading formatting need bounded structural review. */
  organizationWarnings: Array<{
    code: 'EMPTY_ROLE_FOLLOWED_BY_UNCLASSIFIED_HEADING';
    sectionIds: string[];
    unitIds: string[];
  }>;
  unresolvedRanges: DocumentOriginalCoverage['unresolvedRanges'];
}

export interface DocumentSemanticSection {
  sectionId: string;
  headingUnitId: string;
  parentSectionId: string | null;
  titleRaw: string;
  /** A source content role, not applicability, compliance or implementation status. */
  roleKey: string | null;
  occurrence: number;
  /** Direct members only. Descendants are obtained through parentSectionId. */
  bodyUnitIds: string[];
  sourceRefIds: string[];
  contentState:
    | 'CONTENT'
    | 'EXPLICIT_NONE'
    | 'EXPLICIT_NA'
    | 'EMPTY'
    | 'UNREAD';
  emptyLiteral: string | null;
  mappingSource: 'AUTHOR_HEADING' | 'PROFILE_RULE';
}

/** Recorded inputs for organization-template selection, not verified business identity or origin. */
export interface DocumentSemanticProfileSelection {
  policyVersion: string;
  reason:
    | 'REGISTERED_FAMILY_ISSUER'
    | 'REGISTERED_METADATA_TEMPLATE'
    | 'UNKNOWN_FAMILY'
    | 'UNSUPPORTED_FAMILY'
    | 'UNKNOWN_ISSUER'
    | 'UNSUPPORTED_ISSUER'
    | 'IDENTITY_CONFLICT'
    | 'UNSUPPORTED_LAYOUT';
  /** Exact dm_publication_family values observed at selection. Their upstream origin is unknown here;
   * they do not establish a user declaration, publisher identity, applicability, or acceptance. */
  registeredIdentity: { family: string | null; issuer: string | null };
  /** Only exact SourceRefs of this map's original; empty when no heading observation was used. */
  evidenceSourceRefIds: string[];
}

/** Caller selects organization rules only; references in body text do not establish identity. */
export interface DocumentSemanticProfile {
  profileRef: string;
  roles: Array<{ roleKey: string; aliases: string[]; headingLevel?: number }>;
}

export interface DocumentSemanticSelection {
  binding: DocumentOriginalBinding;
  semanticRevision: number;
  profileRef: string;
  sectionId: string;
  ancestorSectionIds: string[];
  organizationWarnings: DocumentSemanticMap['organizationWarnings'];
  /** Includes ancestor direct content: conditions outside the requested leaf must remain visible. */
  contextUnitIds: string[];
  unitIds: string[];
  sourceRefIds: string[];
  unresolvedRanges: DocumentOriginalCoverage['unresolvedRanges'];
}
