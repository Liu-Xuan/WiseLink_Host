/** Classification of document mentions, never an aircraft applicability decision. */
export interface CanonicalLibraryFleetCatalog {
  scope: 'CURRENT_TENANT_ACTIVE_FLEET';
  status: 'AVAILABLE' | 'MISSING';
  asOf: string;
  source: {
    sourceSnapshotId: string;
    sourceRevisionKey: string;
    sourceAsOf: string;
    authorityRevision: string;
  } | null;
  families: Array<{ fleetFamily: string; models: string[] }>;
  /** Active assets without both authoritative family and model fields. */
  unclassifiedAssetCount: number;
  semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY';
}
