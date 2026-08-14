const CANONICAL_DOCUMENT_TYPES = new Set([
  'SB',
  'SL',
  'AOT',
  'VSB',
  'SIL',
  'OIC',
  'FTD',
  'TFU',
  'FTAR',
]);

/**
 * Translate a source-bound parser family label into the controlled enum used
 * by the Job Aid predicates. Unknown labels stay unknown instead of becoming
 * a false predicate result.
 */
export function normalizeJobAidDocumentType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!normalized) return null;
  const upper = normalized.toUpperCase();
  if (CANONICAL_DOCUMENT_TYPES.has(upper)) return upper;

  const patterns = [
    ['VSB', /\bVENDOR SERVICE BULLETIN\b/u],
    ['AOT', /\bALL OPERATORS? (?:TELEX|TRANSMISSION)\b|\bAOT\b/u],
    ['SIL', /\bSERVICE INFORMATION LETTER\b|\bSIL\b/u],
    ['SL', /\bSERVICE LETTER\b/u],
    ['SB', /\bSERVICE BULLETIN\b/u],
    ['FTAR', /\bFTAR\b|\bFLIGHT TECHNICAL ACTION REQUEST\b/u],
    ['FTD', /\bFTD\b|\bFLIGHT TECHNICAL DIGEST\b/u],
    ['TFU', /\bTFU\b|\bTECHNICAL FOLLOW[- ]?UP\b/u],
    ['OIC', /\bOIC\b|\bOPERATOR INFORMATION (?:COMMUNICATION|LETTER)\b/u],
  ];
  return patterns.find(([, pattern]) => pattern.test(upper))?.[0] ?? null;
}
