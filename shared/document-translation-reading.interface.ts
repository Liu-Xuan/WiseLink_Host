import type { CanonicalReaderTranslationProjection } from './api.interface';

export interface DocumentTranslationReadingResponse {
  documentVersionId: string;
  parseRunId: string;
  translation: CanonicalReaderTranslationProjection;
  execution: { status: string; errorCode: string | null } | null;
}
