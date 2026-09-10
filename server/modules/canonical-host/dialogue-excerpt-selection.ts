/** These are user-submitted origin hints, never native-event or author proof. */
export function normalizeDialogueOriginDetails(value: unknown): {
  label?: string;
  sourceUrl?: string;
  sourceMessageId?: string;
} {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('DIALOGUE_ORIGIN_INVALID');
  const input = value as Record<string, unknown>;
  const result: {
    label?: string;
    sourceUrl?: string;
    sourceMessageId?: string;
  } = {};
  for (const field of ['label', 'sourceMessageId', 'sourceUrl'] as const) {
    const text = input[field];
    if (text === undefined) continue;
    if (
      typeof text !== 'string' ||
      text.length > (field === 'sourceUrl' ? 2048 : 200)
    )
      throw new Error('DIALOGUE_ORIGIN_INVALID');
    if (text.trim()) result[field] = text.trim();
  }
  if (result.sourceUrl) {
    let url: URL;
    try {
      url = new URL(result.sourceUrl);
    } catch {
      throw new Error('DIALOGUE_ORIGIN_INVALID');
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('DIALOGUE_ORIGIN_INVALID');
  }
  return result;
}

/** Offsets refer to saved plain text in JS UTF-16 code units, not rendered HTML.
 * The caller obtains this source after checking message/thread/actor ownership.
 */
export function selectDialogueText(source: string, selection: unknown): string {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection))
    throw new Error('DIALOGUE_SELECTION_INVALID');
  const { start, end } = selection as Record<string, unknown>;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > source.length
  )
    throw new Error('DIALOGUE_SELECTION_INVALID');
  const splitsSurrogatePair = (offset: number) =>
    offset > 0 &&
    offset < source.length &&
    source.charCodeAt(offset - 1) >= 0xd800 &&
    source.charCodeAt(offset - 1) <= 0xdbff &&
    source.charCodeAt(offset) >= 0xdc00 &&
    source.charCodeAt(offset) <= 0xdfff;
  if (splitsSurrogatePair(start) || splitsSurrogatePair(end))
    throw new Error('DIALOGUE_SELECTION_INVALID');
  const text = source.slice(start, end);
  if (!text.trim()) throw new Error('DIALOGUE_SELECTION_INVALID');
  return text;
}
