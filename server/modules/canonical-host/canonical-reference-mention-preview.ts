import type {
  CanonicalReferenceContextRole,
  CanonicalReferenceDocumentType,
  CanonicalReferenceMentionPreviewItem,
  CanonicalStructuredContentUnit,
} from '@shared/api.interface';

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
  /\b(SERVICE\s+BULLETIN|SERVICE\s+LETTER|FLEET\s+TEAM\s+DIGEST|AIRWORTHINESS\s+DIRECTIVE|SB|SL|FTD|AD)\s*(?:\((SB|SL|FTD|AD)\))?[\s:#-]+([A-Z0-9][A-Z0-9/-]*(?:-[A-Z0-9]+){2,})\b/giu;
const EMBEDDED_REFERENCE =
  /\b([A-Z0-9]{2,12}-(FTD|SL|SB)-\d{2}-[A-Z0-9][A-Z0-9-]*)\b/giu;
const MANUAL_REFERENCE =
  /\b(?:([A-Z0-9/-]*\d[A-Z0-9/-]*)\s+)?(AMM|CMM|SRM|IPC|WDM|FIM)\s+(\d{2}-\d{2}-\d{2})\b/giu;

export function deriveCanonicalReferenceMentionPreview(
  units: CanonicalStructuredContentUnit[],
  currentDocumentCode?: string,
): CanonicalReferenceMentionCandidate[] {
  const mentions: CanonicalReferenceMentionCandidate[] = [];
  const currentTarget: string = normalizeCode(currentDocumentCode ?? '');
  let currentSection = '';

  for (const unit of units) {
    if (unit.sectionTitle) currentSection = unit.sectionTitle;
    const candidates: MentionCandidate[] = [
      ...prefixedCandidates(unit.displayText),
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
        mentions.push({
          mentionId: `RM-${unit.ordinal}-${candidate.start}-${mentions.length + 1}`,
          unitOrdinal: unit.ordinal,
          matchedText: candidate.matchedText,
          normalizedTarget: candidate.normalizedTarget,
          documentType: candidate.documentType,
          contextRole: contextRole(localContext),
          targetApplicability: 'NOT_EVALUATED',
          sourceRefIds: [...unit.sourceRefIds],
          sourceLocators: unit.sourceLocators.map((locator) => ({
            ...locator,
          })),
        });
      });
  }

  return mentions;
}

function prefixedCandidates(text: string): MentionCandidate[] {
  return [...text.matchAll(PREFIXED_REFERENCE)].map((match) => {
    const matchedText: string = match[0];
    const code: string = match[3].toUpperCase();
    const type: CanonicalReferenceDocumentType = prefixType(
      match[2] || match[1],
    );
    return {
      start: match.index,
      end: match.index + matchedText.length,
      matchedText,
      normalizedTarget: code,
      documentType: type,
    };
  });
}

function embeddedCandidates(text: string): MentionCandidate[] {
  return [...text.matchAll(EMBEDDED_REFERENCE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    matchedText: match[0],
    normalizedTarget: match[1].toUpperCase(),
    documentType: match[2].toUpperCase() as CanonicalReferenceDocumentType,
  }));
}

function manualCandidates(text: string): MentionCandidate[] {
  return [...text.matchAll(MANUAL_REFERENCE)].map((match) => {
    const matchedText: string = match[0];
    const aircraft: string = match[1]?.toUpperCase() ?? '';
    const type = match[2].toUpperCase() as CanonicalReferenceDocumentType;
    const chapter: string = match[3];
    return {
      start: match.index,
      end: match.index + matchedText.length,
      matchedText,
      normalizedTarget: [aircraft, type, chapter].filter(Boolean).join(' '),
      documentType: type,
    };
  });
}

function prefixType(value: string): CanonicalReferenceDocumentType {
  const normalized: string = value.toUpperCase().replace(/\s+/gu, ' ');
  if (normalized === 'SERVICE BULLETIN') return 'SB';
  if (normalized === 'SERVICE LETTER') return 'SL';
  if (normalized === 'FLEET TEAM DIGEST') return 'FTD';
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
  return value.trim().toUpperCase().replace(/\s+/gu, '');
}
