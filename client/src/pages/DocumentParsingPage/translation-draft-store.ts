import {
  getCanonicalHostClientSessionGeneration,
  isCanonicalHostClientSessionAuthenticationRequired,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

export interface TranslationDraft {
  baseBlockRevisionId: string;
  expectedRowVersion: number;
  expectedWorkItemRevision: number;
  requestId: string;
  texts: Record<string, string>;
  saveUnconfirmed: boolean;
}

// Unsaved user text only. Never persisted across a login/session change.
const drafts: Map<string, TranslationDraft> = new Map();
subscribeCanonicalHostClientSession(() => drafts.clear());

export function readTranslationDraft(key: string): TranslationDraft | null {
  if (isCanonicalHostClientSessionAuthenticationRequired()) return null;
  const draft = drafts.get(key);
  return draft ? structuredClone(draft) : null;
}

export function writeTranslationDraft(
  key: string,
  draft: TranslationDraft | null,
  session: number,
): void {
  if (
    session !== getCanonicalHostClientSessionGeneration() ||
    isCanonicalHostClientSessionAuthenticationRequired()
  )
    return;
  if (draft) drafts.set(key, structuredClone(draft));
  else drafts.delete(key);
}
