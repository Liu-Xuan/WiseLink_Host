/** Persisted tenant choices, captured once when a local parse is admitted. */
export interface DocumentParsingSettingsSnapshot {
  revision: number;
  localMineruFallbackEnabled: boolean;
  titleEnhancementEnabled: boolean;
}
export interface DocumentParsingSettingsReadModel extends DocumentParsingSettingsSnapshot {
  updatedAt: string | null;
  canManage: boolean;
  managementStatus: 'CONFIGURED' | 'ROLE_NOT_CONFIGURED';
  effectiveFor: 'NEW_LOCAL_DOCUMENT_PARSE_RUNS_ONLY';
}
export interface UpdateDocumentParsingSettingsRequest {
  expectedRevision: number;
  localMineruFallbackEnabled: boolean;
  titleEnhancementEnabled: boolean;
}
