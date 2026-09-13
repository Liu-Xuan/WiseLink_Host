import type {
  DocumentOriginalBinding,
  DocumentOriginalCoverage,
} from './document-original.interface';

/** An organization of an immutable original, never a second source or an engineering conclusion. */
export interface DocumentSemanticMap {
  schemaVersion: 'wiselink.document.semantic-map.v1';
  binding: DocumentOriginalBinding;
  /** Allocated with CAS by Host, scoped to this parseRun. */
  semanticRevision: number;
  profileRef: string;
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

/** Caller supplies a verified family/issuer profile; references in body text do not select it. */
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
