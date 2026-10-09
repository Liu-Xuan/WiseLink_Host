/**
 * Display only: rawText may be a note or uninterpreted table text. Do not infer
 * footnote semantics or rewrite saved payloads. Suppress only an exact caption
 * or an exact leading caption block already rendered by this same table.
 * Similar words, embedded matches and single-line conditions remain untouched.
 */
export function tableAttachedSourceText(payload: Record<string, unknown>): string | null {
  const rawText = payload.rawText;
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const caption = payload.caption;
  if (typeof caption !== 'string' || !caption.trim()) return rawText;
  if (rawText === caption) return null;
  if (!rawText.startsWith(caption)) return rawText;
  const remainder = rawText.slice(caption.length);
  if (!/^(?:\r\n|\n|\r)/.test(remainder)) return rawText;
  const attachedText = remainder.replace(/^(?:\r\n|\n|\r)+/, '');
  return attachedText.trim() ? attachedText : null;
}
