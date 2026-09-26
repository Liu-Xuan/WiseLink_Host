/** Persisted tenant choices, captured once when a local parse is admitted. */
export interface DocumentParsingSettingsSnapshot {
  revision: number;
  /** Existing field name retained: local MinerU is now the default parser when enabled. */
  localMineruFallbackEnabled: boolean;
  titleEnhancementEnabled: boolean;
}
export interface DocumentParsingSettingsReadModel extends DocumentParsingSettingsSnapshot {
  updatedAt: string | null;
  canManage: boolean;
  managementStatus: 'CONFIGURED' | 'ROLE_NOT_CONFIGURED';
  /** New admissions only; an exact parse-resume successor retains the admitted snapshot. */
  effectiveFor: 'NEW_LOCAL_DOCUMENT_PARSE_RUNS_ONLY';
}
export interface UpdateDocumentParsingSettingsRequest {
  expectedRevision: number;
  /** Existing field name retained: local MinerU is now the default parser when enabled. */
  localMineruFallbackEnabled: boolean;
  titleEnhancementEnabled: boolean;
}
