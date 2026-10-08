// Rebuild implementation generated from shared/document-activity-quote-selection.ts.
/** Transport-only selector; canonical source candidates remain versioned separately. */
export const DOCUMENT_ACTIVITY_QUOTE_SELECTION_SCHEMA = 'wiselink.document.activity-quote-selection.v1';
/** Pure and unauthenticated. JS UTF-16 code units, end-exclusive; no normalization. */
export function locateExactQuoteText(sourceText, text) {
    if (typeof sourceText !== 'string' || typeof text !== 'string')
        return { status: 'INVALID_TEXT' };
    if (!text.trim())
        return { status: 'EMPTY_TEXT' };
    const start = sourceText.indexOf(text);
    if (start < 0)
        return { status: 'NOT_FOUND' };
    if (sourceText.indexOf(text, start + 1) !== -1)
        return { status: 'AMBIGUOUS' };
    return { status: 'UNIQUE', start, end: start + text.length };
}
/** Caller owns source verification, authorization, READ receipt origin and save fences. */
export function resolveSourceQuoteSelection(selection, host) {
    const fail = (reason) => ({ status: 'UNRESOLVED', reason });
    if (!record(selection) || Object.keys(selection).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(selection, 'anchorId') || !Object.prototype.hasOwnProperty.call(selection, 'text') ||
        !nonempty(selection.anchorId) || typeof selection.text !== 'string')
        return fail('SELECTION_INVALID');
    if (!context(host))
        return fail('HOST_CONTEXT_INVALID');
    const fields = ['documentVersionId', 'parseRunId', 'parseRevision', 'sourceArtifactId', 'sourceSha256', 'sourceByteLength'];
    if (host.sourceBinding.semanticRevision !== host.expectedSourceBinding.semanticRevision ||
        fields.some(key => host.sourceBinding.original[key] !== host.expectedSourceBinding.original[key]))
        return fail('SOURCE_BINDING_MISMATCH');
    const anchor = host.anchors.find(value => value.anchorId === selection.anchorId);
    if (!anchor)
        return fail('UNKNOWN_ANCHOR');
    if (!host.allowedAnchorIds.includes(anchor.anchorId))
        return fail('ANCHOR_NOT_ALLOWED');
    const result = locateExactQuoteText(anchor.sourceText, selection.text);
    if (result.status === 'EMPTY_TEXT')
        return fail('EMPTY_TEXT');
    if (result.status === 'NOT_FOUND')
        return fail('TEXT_NOT_FOUND');
    if (result.status === 'AMBIGUOUS')
        return fail('TEXT_AMBIGUOUS');
    if (result.status !== 'UNIQUE')
        return fail('HOST_CONTEXT_INVALID');
    return { status: 'RESOLVED', quote: { anchorId: anchor.anchorId, start: result.start, end: result.end, text: selection.text } };
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function positive(value) { return Number.isSafeInteger(value) && Number(value) > 0; }
function binding(value) {
    if (!record(value) || !positive(value.semanticRevision) || !record(value.original))
        return false;
    const original = value.original;
    return ['documentVersionId', 'parseRunId', 'sourceArtifactId'].every(key => nonempty(original[key])) && positive(original.parseRevision) &&
        Number.isSafeInteger(original.sourceByteLength) && Number(original.sourceByteLength) >= 0 &&
        typeof original.sourceSha256 === 'string' && /^[a-f0-9]{64}$/u.test(original.sourceSha256);
}
function context(value) {
    if (!record(value) || !binding(value.sourceBinding) || !binding(value.expectedSourceBinding) ||
        !Array.isArray(value.anchors) || !Array.isArray(value.allowedAnchorIds))
        return false;
    if (value.anchors.some((anchor) => !record(anchor) || !nonempty(anchor.anchorId) || typeof anchor.sourceText !== 'string') ||
        value.allowedAnchorIds.some((id) => !nonempty(id)))
        return false;
    const ids = value.anchors.map((anchor) => anchor.anchorId);
    return new Set(ids).size === ids.length && new Set(value.allowedAnchorIds).size === value.allowedAnchorIds.length &&
        value.allowedAnchorIds.every((id) => ids.includes(id));
}
