import type {
  CanonicalReferenceContextRole,
  CanonicalReferenceDocumentType,
  CanonicalReferenceMentionPreviewItem,
  CanonicalStructuredContentSourceLocator,
  CanonicalStructuredContentUnit,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

import { projectCanonicalStructuredContentLocator } from './canonical-structured-content-projection';

export type CanonicalReferenceMentionCandidate = Omit<
  CanonicalReferenceMentionPreviewItem,
  'targetResolution'
>;

interface MentionCandidate {
  start: number;
  end: number;
  matchedText: string;
  normalizedTarget: string;
  documentType: CanonicalReferenceDocumentType;
}

const PREFIXED_REFERENCE =
  /\b(SERVICE\s+BULLETIN|SERVICE\s+INFORMATION\s+LETTER|SERVICE\s+LETTER|FLEET\s+TEAM\s+DIGEST|FLIGHT\s+OPERATIONS\s+TECHNICAL\s+BULLETIN|AIRWORTHINESS\s+DIRECTIVE|SB|SIL|SL|FTD|FOTB|AD)\s*(?:\((SB|SIL|SL|FTD|FOTB|AD)\))?[\s:#-]+([A-Z0-9][A-Z0-9/-]*(?:-[A-Z0-9]+)+|D\d{8,})\b/giu;
const EMBEDDED_REFERENCE =
  /\b([A-Z0-9]{2,12}-(FTD|SL|SB)-\d{2}-[A-Z0-9][A-Z0-9-]*)\b/giu;
const MANUAL_REFERENCE =
  /\b(?:([A-Z0-9/-]*\d[A-Z0-9/-]*)\s+)?(AMM|CMM|SRM|IPC|WDM|FIM)\s+(\d{2}-\d{2}-\d{2})((?:\s*,\s*\d{2}-\d{2}-\d{2})*)\b/giu;

export function deriveCanonicalReferenceMentionPreview(
  units: CanonicalStructuredContentUnit[],
  currentDocumentCode?: string,
  sourceUnits: UnifiedReaderQueryResult[] = [],
): CanonicalReferenceMentionCandidate[] {
  const mentions: CanonicalReferenceMentionCandidate[] = [];
  const currentTarget: string = normalizeCode(currentDocumentCode ?? '');
  let currentSection = '';

  for (const unit of units) {
    if (unit.sectionTitle) currentSection = unit.sectionTitle;
    const sourceUnit = sourceUnits[unit.ordinal - 1];
    const structured = structuredReferenceCandidate(
      unit,
      sourceUnit,
      mentions.length + 1,
    );
    if (structured) {
      if (
        currentTarget === '' ||
        normalizeCode(structured.normalizedTarget) !== currentTarget
      ) {
        mentions.push(structured);
      }
      continue;
    }
    const candidates: MentionCandidate[] = [
      ...prefixedCandidates(unit.displayText, currentDocumentCode),
      ...embeddedCandidates(unit.displayText),
      ...manualCandidates(unit.displayText),
    ]
      .filter(
        (candidate) =>
          currentTarget === '' ||
          normalizeCode(candidate.normalizedTarget) !== currentTarget,
      )
      .sort(
        (left, right) =>
          left.start - right.start ||
          right.matchedText.length - left.matchedText.length,
      );
    const accepted: MentionCandidate[] = [];

    for (const candidate of candidates) {
      if (
        accepted.some(
          (existing) =>
            candidate.start < existing.end && candidate.end > existing.start,
        )
      ) {
        continue;
      }
      accepted.push(candidate);
    }

    accepted
      .sort((left, right) => left.start - right.start)
      .forEach((candidate) => {
        const contextStart: number = Math.max(0, candidate.start - 140);
        const contextEnd: number = Math.min(
          unit.displayText.length,
          candidate.end + 140,
        );
        const localContext: string = `${currentSection}\n${unit.displayText.slice(
          contextStart,
          contextEnd,
        )}`;
        const evidence = mentionEvidence(unit, sourceUnit, candidate);
        mentions.push({
          mentionId: `RM-${unit.ordinal}-${candidate.start}-${mentions.length + 1}`,
          unitOrdinal: unit.ordinal,
          matchedText: candidate.matchedText,
          normalizedTarget: candidate.normalizedTarget,
          documentType: candidate.documentType,
          contextRole: contextRole(localContext),
          targetApplicability: 'NOT_EVALUATED',
          sourceRefIds: evidence.sourceRefIds,
          sourceLocators: evidence.sourceLocators,
        });
      });
  }

  return preferStructuredReferenceRows(mentions);
}

function preferStructuredReferenceRows(
  mentions: CanonicalReferenceMentionCandidate[],
): CanonicalReferenceMentionCandidate[] {
  const structured = mentions.filter((mention) =>
    mention.mentionId.includes('-structured-'),
  );
  return mentions.filter(
    (mention) =>
      mention.mentionId.includes('-structured-') ||
      !structured.some(
        (owner) =>
          normalizeCode(owner.normalizedTarget) ===
            normalizeCode(mention.normalizedTarget) &&
          owner.sourceRefIds.some((sourceRefId) =>
            mention.sourceRefIds.includes(sourceRefId),
          ),
      ),
  );
}

function prefixedCandidates(
  text: string,
  currentDocumentCode?: string,
): MentionCandidate[] {
  return [...text.matchAll(PREFIXED_REFERENCE)].map((match) => {
    const code: string = trimReferenceProseTail(match[3]).toUpperCase();
    const matchedText: string = match[0].slice(
      0,
      match[0].length - (match[3].length - code.length),
    );
    const type: CanonicalReferenceDocumentType = prefixType(
      match[2] || match[1],
    );
    return {
      start: match.index,
      end: match.index + matchedText.length,
      matchedText,
      normalizedTarget: canonicalPrefixedTarget(
        code,
        type,
        currentDocumentCode,
      ),
      documentType: type,
    };
  });
}

function embeddedCandidates(text: string): MentionCandidate[] {
  return [...text.matchAll(EMBEDDED_REFERENCE)].map((match) => {
    const matchedText = trimReferenceProseTail(match[0]);
    return {
      start: match.index,
      end: match.index + matchedText.length,
      matchedText,
      normalizedTarget: trimReferenceProseTail(match[1]).toUpperCase(),
      documentType: match[2].toUpperCase() as CanonicalReferenceDocumentType,
    };
  });
}

function trimReferenceProseTail(value: string): string {
  return value.replace(/FOR\s*MORE\s*INFORMATION.*$/iu, '');
}

function canonicalPrefixedTarget(
  code: string,
  type: CanonicalReferenceDocumentType,
  currentDocumentCode?: string,
): string {
  const aircraft = currentDocumentCode
    ?.toUpperCase()
    .match(/^(.+?)-(?:FTD|FOTB|SL|SIL|SB)-/u)?.[1];
  if (!aircraft || !['FTD', 'FOTB', 'SL', 'SIL', 'SB'].includes(type)) {
    return code;
  }
  const relativeCode = code.replace(new RegExp(`^${type}-`, 'u'), '');
  if (relativeCode !== code || /^\d{2}-/u.test(relativeCode)) {
    return `${aircraft}-${type}-${relativeCode}`;
  }
  return code;
}

function manualCandidates(text: string): MentionCandidate[] {
  return [...text.matchAll(MANUAL_REFERENCE)].flatMap((match) => {
    const matchedText: string = match[0];
    const aircraft: string = match[1]?.toUpperCase() ?? '';
    const type = match[2].toUpperCase() as CanonicalReferenceDocumentType;
    const chapter: string = match[3];
    const firstMatchedText = matchedText.slice(
      0,
      matchedText.length - match[4].length,
    );
    const first: MentionCandidate = {
      start: match.index,
      end: match.index + firstMatchedText.length,
      matchedText: firstMatchedText,
      normalizedTarget: [aircraft, type, chapter].filter(Boolean).join(' '),
      documentType: type,
    };
    const tailOffset = match[0].length - match[4].length;
    const continuation = [...match[4].matchAll(/\d{2}-\d{2}-\d{2}/gu)].map(
      (item) => ({
        start: match.index + tailOffset + item.index,
        end: match.index + tailOffset + item.index + item[0].length,
        matchedText: item[0],
        normalizedTarget: [aircraft, type, item[0]]
          .filter(Boolean)
          .join(' '),
        documentType: type,
      }),
    );
    return [first, ...continuation];
  });
}

function structuredReferenceCandidate(
  unit: CanonicalStructuredContentUnit,
  sourceUnit: UnifiedReaderQueryResult | undefined,
  sequence: number,
): CanonicalReferenceMentionCandidate | null {
  if (!sourceUnit?.text.trim().startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(sourceUnit.text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || value.sourceSectionField !== 'referenceCategories') {
    return null;
  }
  const normalizedTarget = textValue(value.referenceNumber);
  const documentType = referenceDocumentType(value.referenceFamily);
  if (!normalizedTarget || !documentType) return null;
  const matchedText =
    textValue(value.sourceLine) ??
    [textValue(value.referenceType), normalizedTarget]
      .filter(Boolean)
      .join(' ');
  const orderedLocators = orderedReferenceLocators(
    sourceUnit,
    normalizedTarget,
  );
  return {
    mentionId: `RM-${unit.ordinal}-structured-${sequence}`,
    unitOrdinal: unit.ordinal,
    matchedText,
    normalizedTarget,
    documentType,
    contextRole: 'RELATED_INFORMATION',
    targetApplicability: 'NOT_EVALUATED',
    sourceRefIds:
      orderedLocators.length > 0
        ? orderedLocators.map((locator) => locator.sourceRefId)
        : [...sourceUnit.sourceRefIds],
    sourceLocators: orderedLocators,
  };
}

function orderedReferenceLocators(
  unit: UnifiedReaderQueryResult,
  target: string,
): CanonicalStructuredContentSourceLocator[] {
  const locators = unit.sourceLocators ?? [];
  return [...locators]
    .sort(
      (left, right) =>
        Number(!quoteIncludes(left.quote, target)) -
        Number(!quoteIncludes(right.quote, target)),
    )
    .map((locator) =>
      projectCanonicalStructuredContentLocator(locator, target),
    );
}

function mentionEvidence(
  unit: CanonicalStructuredContentUnit,
  sourceUnit: UnifiedReaderQueryResult | undefined,
  candidate: MentionCandidate,
): {
  sourceRefIds: string[];
  sourceLocators: CanonicalStructuredContentSourceLocator[];
} {
  const exact = (sourceUnit?.sourceLocators ?? []).filter(
    (locator) =>
      quoteIncludes(locator.quote, candidate.normalizedTarget) ||
      quoteIncludes(locator.quote, candidate.matchedText),
  );
  if (exact.length === 0) {
    return {
      sourceRefIds: [...unit.sourceRefIds],
      sourceLocators: unit.sourceLocators.map((locator) => ({ ...locator })),
    };
  }
  return {
    sourceRefIds: exact.map((locator) => locator.sourceRefId),
    sourceLocators: exact.map((locator) =>
      projectCanonicalStructuredContentLocator(
        locator,
        candidate.normalizedTarget,
      ),
    ),
  };
}

function quoteIncludes(quote: string | null, value: string): boolean {
  return normalizeCode(quote ?? '').includes(normalizeCode(value));
}

function referenceDocumentType(
  value: unknown,
): CanonicalReferenceDocumentType | null {
  const family = textValue(value)?.toUpperCase();
  if (
    family === 'SB' ||
    family === 'SIL' ||
    family === 'SL' ||
    family === 'FTD' ||
    family === 'FOTB'
  ) {
    return family;
  }
  return null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function prefixType(value: string): CanonicalReferenceDocumentType {
  const normalized: string = value.toUpperCase().replace(/\s+/gu, ' ');
  if (normalized === 'SERVICE BULLETIN') return 'SB';
  if (normalized === 'SERVICE INFORMATION LETTER') return 'SIL';
  if (normalized === 'SERVICE LETTER') return 'SL';
  if (normalized === 'FLEET TEAM DIGEST') return 'FTD';
  if (normalized === 'FLIGHT OPERATIONS TECHNICAL BULLETIN') return 'FOTB';
  if (normalized === 'AIRWORTHINESS DIRECTIVE') return 'AD';
  return normalized as CanonicalReferenceDocumentType;
}

function contextRole(context: string): CanonicalReferenceContextRole {
  if (/\bconcurrent(?:ly)?\b|并行要求|同期要求/iu.test(context)) {
    return 'CONCURRENT_REQUIREMENT';
  }
  if (
    /\brelated\s+(?:to|information)\b|see\s+also|相关资料|相关信息/iu.test(
      context,
    )
  ) {
    return 'RELATED_INFORMATION';
  }
  if (
    /\brefer(?:red)?\s+to\b|in\s+accordance\s+with|accepted\s+procedure|参考.*程序|按照.*程序/iu.test(
      context,
    )
  ) {
    return 'PROCEDURE_SUPPORT';
  }
  return 'UNCLASSIFIED';
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, '');
}
