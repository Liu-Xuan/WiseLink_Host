import type { CanonicalReaderTranslationProjection } from './api.interface';

export interface DocumentTranslationReadingResponse {
  documentVersionId: string;
  parseRunId: string;
  translation: CanonicalReaderTranslationProjection;
  execution: {
    status: string;
    errorCode: string | null;
    /** Only the latest authorized attempt for this exact parse; not a complete request collection. */
    attemptId?: string;
    createdAt?: string;
    startedAt?: string | null;
    completedAt?: string | null;
  } | null;
}
