/** Rebuildable search text only. Source bodies and registered identities remain authoritative. */
export interface EngineeringSearchText {
  originalText: string;
  tokenizedText: string;
  identifiers: string[];
  textSearchConfiguration: 'simple';
}

let wordSegmenter: Intl.Segmenter | undefined;

function segmenter(): Intl.Segmenter {
  if (!wordSegmenter) {
    if (
      typeof Intl.Segmenter !== 'function' ||
      Intl.Segmenter.supportedLocalesOf(['zh', 'en']).length !== 2
    ) {
      throw new Error('Engineering search requires Node ICU word segmentation for zh and en');
    }
    wordSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  }
  return wordSegmenter;
}

/** Used identically for projection writes and plain query parameters; never emits tsquery syntax. */
export function tokenizeEngineeringSearchText(text: string): string {
  return Array.from(segmenter().segment(text.normalize('NFKC')))
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.toLowerCase())
    .join(' ');
}

/** Candidate lookup key, not authority to merge document families or versions. */
export function normalizeEngineeringSearchIdentifier(identifier: string): string {
  return identifier.normalize('NFKC').trim().toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/\s+/gu, ' ');
}

export function buildEngineeringSearchText(
  originalText: string,
  registeredIdentifiers: readonly string[] = [],
): EngineeringSearchText {
  return {
    originalText,
    tokenizedText: tokenizeEngineeringSearchText(originalText),
    identifiers: Array.from(new Set(registeredIdentifiers
      .map(normalizeEngineeringSearchIdentifier).filter(Boolean))),
    textSearchConfiguration: 'simple',
  };
}

export interface EngineeringSearchQuery {
  originalQuery: string;
  tokenizedText: string;
  /** Bind to identifier equality/array membership; never interpolate into SQL. */
  exactIdentifierCandidates: string[];
  textSearchConfiguration: 'simple';
  queryFunction: 'plainto_tsquery';
}

export function prepareEngineeringSearchQuery(query: string): EngineeringSearchQuery {
  const normalized = normalizeEngineeringSearchIdentifier(query);
  // The whole query also supports identities with spaces. Compound identifiers retain punctuation,
  // especially hyphens and software version dots; full text alone cannot establish exact identity.
  const compounds = normalized.match(/(?<![A-Z0-9])[A-Z0-9]+(?:[-./_][A-Z0-9]+)+(?![A-Z0-9])/gu) ?? [];
  return {
    originalQuery: query,
    tokenizedText: tokenizeEngineeringSearchText(query),
    exactIdentifierCandidates: Array.from(new Set([normalized, ...compounds].filter(Boolean))),
    textSearchConfiguration: 'simple',
    queryFunction: 'plainto_tsquery',
  };
}
