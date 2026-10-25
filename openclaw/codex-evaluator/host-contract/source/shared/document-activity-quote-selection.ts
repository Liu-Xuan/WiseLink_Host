import type { DocumentActivityQuote, DocumentActivitySourceBinding } from './document-activity.interface';

/** Transport-only selector; canonical source candidates remain versioned separately. */
export const DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA = 'wiselink.document.activity-quote-selection.v1' as const;
export interface QuoteSelection { anchorId: string; text: string }
export interface QuoteAnchor { anchorId: string; sourceText: string }
export interface QuoteSelectionHostContext {
  sourceBinding: DocumentActivitySourceBinding;
  expectedSourceBinding: DocumentActivitySourceBinding;
  anchors: readonly QuoteAnchor[];
  allowedAnchorIds: readonly string[];
}
export type QuoteSelectionReason = 'SELECTION_INVALID' | 'HOST_CONTEXT_INVALID' | 'SOURCE_BINDING_MISMATCH' |
  'UNKNOWN_ANCHOR' | 'ANCHOR_NOT_ALLOWED' | 'EMPTY_TEXT' | 'TEXT_NOT_FOUND' | 'TEXT_AMBIGUOUS';
export type QuoteResolution = { status: 'RESOLVED'; quote: DocumentActivityQuote } |
  { status: 'UNRESOLVED'; reason: QuoteSelectionReason };
type Location = { status: 'UNIQUE'; start: number; end: number } |
  { status: 'INVALID_TEXT' | 'EMPTY_TEXT' | 'NOT_FOUND' | 'AMBIGUOUS' };

/** Pure and unauthenticated. JS UTF-16 code units, end-exclusive; no normalization. */
export function locateExactQuoteText(sourceText: unknown, text: unknown): Location {
  if (typeof sourceText !== 'string' || typeof text !== 'string') return { status: 'INVALID_TEXT' };
  if (!text.trim()) return { status: 'EMPTY_TEXT' };
  const start = sourceText.indexOf(text);
  if (start < 0) return { status: 'NOT_FOUND' };
  if (sourceText.indexOf(text, start + 1) !== -1) return { status: 'AMBIGUOUS' };
  return { status: 'UNIQUE', start, end: start + text.length };
}

/** Caller owns source verification, authorization, READ receipt origin and save fences. */
export function resolveSourceQuoteSelection(selection: unknown, host: unknown): QuoteResolution {
  const fail = (reason: QuoteSelectionReason): QuoteResolution => ({ status: 'UNRESOLVED', reason });
  if (!record(selection) || Object.keys(selection).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(selection, 'anchorId') || !Object.prototype.hasOwnProperty.call(selection, 'text') ||
      !nonempty(selection.anchorId) || typeof selection.text !== 'string') return fail('SELECTION_INVALID');
  if (!context(host)) return fail('HOST_CONTEXT_INVALID');
  const fields: (keyof DocumentActivitySourceBinding['original'])[] =
    ['documentVersionId', 'parseRunId', 'parseRevision', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'];
  if (host.sourceBinding.semanticRevision !== host.expectedSourceBinding.semanticRevision ||
      fields.some(key => host.sourceBinding.original[key] !== host.expectedSourceBinding.original[key])) return fail('SOURCE_BINDING_MISMATCH');
  const anchor = host.anchors.find(value => value.anchorId === selection.anchorId);
  if (!anchor) return fail('UNKNOWN_ANCHOR');
  if (!host.allowedAnchorIds.includes(anchor.anchorId)) return fail('ANCHOR_NOT_ALLOWED');
  const result = locateExactQuoteText(anchor.sourceText, selection.text);
  if (result.status === 'EMPTY_TEXT') return fail('EMPTY_TEXT');
  if (result.status === 'NOT_FOUND') return fail('TEXT_NOT_FOUND');
  if (result.status === 'AMBIGUOUS') return fail('TEXT_AMBIGUOUS');
  if (result.status !== 'UNIQUE') return fail('HOST_CONTEXT_INVALID');
  return { status: 'RESOLVED', quote: { anchorId: anchor.anchorId, start: result.start, end: result.end, text: selection.text } };
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function positive(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function binding(value: unknown): value is DocumentActivitySourceBinding {
  if (!record(value) || !positive(value.semanticRevision) || !record(value.original)) return false;
  const original = value.original;
  return ['documentVersionId', 'parseRunId', 'sourceArtifactId'].every(key => nonempty(original[key])) && positive(original.parseRevision) &&
    Number.isSafeInteger(original.sourceByteLength) && Number(original.sourceByteLength) >= 0 &&
    typeof original.sourceSha256 === 'string' && /^[a-f0-9]{64}$/u.test(original.sourceSha256);
}
function context(value: unknown): value is QuoteSelectionHostContext {
  if (!record(value) || !binding(value.sourceBinding) || !binding(value.expectedSourceBinding) ||
      !Array.isArray(value.anchors) || !Array.isArray(value.allowedAnchorIds)) return false;
  if (value.anchors.some((anchor: unknown) => !record(anchor) || !nonempty(anchor.anchorId) || typeof anchor.sourceText !== 'string') ||
      value.allowedAnchorIds.some((id: unknown) => !nonempty(id))) return false;
  const ids = value.anchors.map((anchor: QuoteAnchor) => anchor.anchorId);
  return new Set(ids).size === ids.length && new Set(value.allowedAnchorIds).size === value.allowedAnchorIds.length &&
    value.allowedAnchorIds.every((id: string) => ids.includes(id));
}
