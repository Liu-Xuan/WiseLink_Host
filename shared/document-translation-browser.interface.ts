/** First browser continuation scope: the signed-in user's existing upload delivery. */
export type DocumentTranslationBrowserAction =
  | 'RESUME_KNOWN_FAILURE'
  | 'RECOVER_KNOWN_FAILURE'
  | 'CONTINUE_PARTIAL'
  | 'RECOVER_EXPIRED';

export interface DocumentTranslationContinuationPreparation {
  documentVersionId: string;
  parseRunId: string;
  supportedScope: 'OWNED_UPLOAD_ZH_FULL';
  state: 'READY' | 'ACTIVE' | 'COMPLETE' | 'UNSUPPORTED' | 'REQUIRES_RECONCILIATION';
  reason: string;
  attempt: { attemptRef: string; status: string } | null;
  action: DocumentTranslationBrowserAction | null;
}

export interface ContinueDocumentTranslationRequest {
  parseRunId: string;
  expectedAttemptRef: string;
  action: DocumentTranslationBrowserAction;
}

export interface ContinueDocumentTranslationResponse {
  documentVersionId: string;
  parseRunId: string;
  predecessorAttemptRef: string;
  attemptRef: string;
  status: string;
  reused: boolean;
}
