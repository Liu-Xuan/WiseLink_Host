import type {
  CanonicalReferenceContextRole,
  CanonicalReferenceDocumentType,
  CanonicalReferenceExtractionMethod,
  CanonicalReferenceMentionPreviewItem,
  CanonicalReferenceTargetResolution,
  CanonicalRelatedContextRelationRole,
  CanonicalRelatedTargetApplicability,
  CanonicalStructuredContentSourceLocator,
  CanonicalStructuredContentUnit,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';

import { projectCanonicalStructuredContentLocator } from './canonical-structured-content-projection';

export interface CanonicalReferenceMentionCandidate {
  mentionId: string;
  unitOrdinal: number;
  matchedText: string;
  normalizedTarget: string;
  requestedBusinessRevision?: string | null;
  documentType: CanonicalReferenceDocumentType;
  contextRole: CanonicalReferenceContextRole;
  relationCue: string | null;
  relationRoleCandidates: CanonicalRelatedContextRelationRole[];
  extractionMethod: CanonicalReferenceExtractionMethod;
  initialResolutionState?: 'UNRESOLVED' | 'UNSUPPORTED_DOCUMENT';
  targetApplicability: 'NOT_EVALUATED';
  sourceRefIds: string[];
  sourceLocators: CanonicalStructuredContentSourceLocator[];
}

interface FinalizeReferenceMentionInput {
  candidate: CanonicalReferenceMentionCandidate;
  primaryDocumentVersionRef: string;
  targetResolution: CanonicalReferenceTargetResolution;
  targetApplicability: CanonicalRelatedTargetApplicability;
  applicabilityResultRef?: string;
  publisherCandidate?: string | null;
}

export function canonicalReferenceResolutionOr(
  candidate: CanonicalReferenceMentionCandidate,
  fallback: CanonicalReferenceTargetResolution,
): CanonicalReferenceTargetResolution {
  return candidate.initialResolutionState
    ? { status: candidate.initialResolutionState }
    : fallback;
}

export function finalizeCanonicalReferenceMentionPreview(
  input: FinalizeReferenceMentionInput,
): CanonicalReferenceMentionPreviewItem {
  const mentionSourceRef = input.candidate.sourceRefIds[0];
  if (!mentionSourceRef) {
    throw new Error('REFERENCE_MENTION_SOURCE_REF_REQUIRED');
  }
  const resolvedDocumentVersionRef =
    input.targetResolution.status === 'RESOLVED_EXACT'
      ? input.targetResolution.documentVersionId
      : null;
  const { initialResolutionState, ...candidate } = input.candidate;
  void initialResolutionState;
  return {
    ...candidate,
    mentionRef: `reference-mention://${encodeURIComponent(input.primaryDocumentVersionRef)}/${input.candidate.mentionId}`,
    primaryDocumentVersionRef: input.primaryDocumentVersionRef,
    mentionSourceRef,
    citationText: input.candidate.matchedText,
    normalizedIdentity: {
      documentNumber:
        input.targetResolution.status === 'UNRESOLVED'
          ? null
          : input.candidate.normalizedTarget.trim() || null,
      title: null,
      publisher: input.publisherCandidate ?? null,
    },
    documentTypeCandidate: input.candidate.documentType,
    resolutionState: input.targetResolution.status,
    resolvedDocumentVersionRef,
    permissionState:
      input.targetResolution.status === 'RESOLVED_EXACT'
        ? 'AUTHORIZED'
        : input.targetResolution.status === 'ACCESS_DENIED'
          ? 'DENIED'
          : 'NOT_CHECKED',
    sourceAuthority: 'UNKNOWN',
    evidenceStance: 'NOT_EVALUATED',
    candidateOnly: true,
    targetResolution: input.targetResolution,
    targetApplicability: input.targetApplicability,
    ...(input.applicabilityResultRef
      ? { applicabilityResultRef: input.applicabilityResultRef }
      : {}),
  };
}

interface MentionCandidate {
  start: number;
  end: number;
  matchedText: string;
  normalizedTarget: string;
  requestedBusinessRevision?: string | null;
  documentType: CanonicalReferenceDocumentType;
  initialResolutionState?: 'UNRESOLVED' | 'UNSUPPORTED_DOCUMENT';
}

const PREFIXED_REFERENCE =
  /\b(SERVICE\s+BULLETIN|SERVICE\s+INFORMATION\s+LETTER|SERVICE\s+LETTER|FLEET\s+TEAM\s+DIGEST|FLIGHT\s+OPERATIONS\s+TECHNICAL\s+BULLETIN|AIRWORTHINESS\s+DIRECTIVE|SB|SIL|SL|FTD|FOTB|AD)\s*(?:\((SB|SIL|SL|FTD|FOTB|AD)\))?[\s:#-]+([A-Z0-9][A-Z0-9/-]*(?:-[A-Z0-9]+)+|D\d{8,})\b/giu;
const EMBEDDED_REFERENCE =
  /\b([A-Z0-9]{2,12}-(FTD|SL|SB)-\d{2}-[A-Z0-9][A-Z0-9-]*)\b/giu;
const MANUAL_REFERENCE =
  /\b(?:([A-Z0-9/-]*\d[A-Z0-9/-]*)\s+)?(AMM|CMM|SRM|IPC|WDM|FIM)\s+(\d{2}-\d{2}-\d{2})((?:\s*,\s*\d{2}-\d{2}-\d{2})*)\b/giu;
const UNSUPPORTED_PREFIXED_REFERENCE =
  /\b(MPD|MRBR)\s*[\s:#-]+([A-Z0-9][A-Z0-9/-]*(?:-[A-Z0-9]+)+)\b/giu;

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
        normalizeCode(structured.normalizedTarget) !== currentTarget ||
        structured.requestedBusinessRevision !== undefined
      ) {
        mentions.push(structured);
      }
      continue;
    }
    const candidates: MentionCandidate[] = [
      ...prefixedCandidates(unit.displayText, currentDocumentCode),
      ...embeddedCandidates(unit.displayText),
      ...manualCandidates(unit.displayText),
      ...unsupportedPrefixedCandidates(unit.displayText),
    ]
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
      .forEach((unversioned, candidateIndex) => {
        const candidate = withReferenceRevision(unversioned, unit.displayText,
          accepted[candidateIndex + 1]?.start ?? unit.displayText.length);
        if (currentTarget !== '' && normalizeCode(candidate.normalizedTarget) === currentTarget &&
            (candidate.requestedBusinessRevision === undefined ||
             !/\b(?:refer(?:ence|red)?|see|prior|previous|earlier|historical|supersedes?)\b|引用|参见|参考|旧版|前版/iu
               .test(unit.displayText.slice(Math.max(0, candidate.start - 100), candidate.start)))) return;
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
        if (evidence.sourceRefIds.length === 0) return;
        const role = contextRole(localContext);
        mentions.push({
          mentionId: `RM-${unit.ordinal}-${candidate.start}-${mentions.length + 1}`,
          unitOrdinal: unit.ordinal,
          matchedText: candidate.matchedText,
          normalizedTarget: candidate.normalizedTarget,
          ...(candidate.requestedBusinessRevision === undefined ? {} :
            { requestedBusinessRevision: candidate.requestedBusinessRevision }),
          documentType: candidate.documentType,
          contextRole: role,
          relationCue: relationCue(localContext, role),
          relationRoleCandidates: candidateRelationRoles(role),
          extractionMethod: 'DETERMINISTIC_TEXT',
          ...(candidate.initialResolutionState
            ? { initialResolutionState: candidate.initialResolutionState }
            : {}),
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
          canonicalReferenceSelectionKey(owner) === canonicalReferenceSelectionKey(mention) &&
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
        normalizedTarget: [aircraft, type, item[0]].filter(Boolean).join(' '),
        documentType: type,
      }),
    );
    return [first, ...continuation];
  });
}

function unsupportedPrefixedCandidates(text: string): MentionCandidate[] {
  return [...text.matchAll(UNSUPPORTED_PREFIXED_REFERENCE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    matchedText: match[0],
    normalizedTarget: match[2].toUpperCase(),
    documentType: 'UNKNOWN',
    initialResolutionState: 'UNSUPPORTED_DOCUMENT',
  }));
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
  const rawReferenceNumber = textValue(value.referenceNumber);
  const supportedDocumentType = referenceDocumentType(value.referenceFamily);
  const referenceFamily = textValue(value.referenceFamily)?.toUpperCase();
  if (!rawReferenceNumber || !referenceFamily) return null;
  const referenceNumberIsUsable = /\d/u.test(rawReferenceNumber);
  const revisionStart = rawReferenceNumber.search(/[\t ]+(?=\(?(?:REV(?:ISION)?\.?|R|ISSUE|ORIGINAL[\t ]+ISSUE|原版)(?=[\t :#\d.]|$))/iu);
  const number = revisionStart < 0 ? rawReferenceNumber : rawReferenceNumber.slice(0, revisionStart);
  const normalizedTarget = referenceNumberIsUsable ? number : '';
  const documentType = supportedDocumentType ?? 'UNKNOWN';
  const matchedText =
    textValue(value.sourceLine) ??
    [textValue(value.referenceType), rawReferenceNumber]
      .filter(Boolean)
      .join(' ');
  const column = textValue(value.revisionLabel);
  const columnRevision = column ? normalizedExplicitRevision(column) ?? column :
    value.revisionLabel != null && typeof value.revisionLabel !== 'string' ? null : undefined;
  const statedRevision = (suffix: string): string | null | undefined => {
    const parsed = referenceRevisionSuffix(suffix).requestedBusinessRevision;
    // The existing structured edition column can name a literal label outside
    // the text parser's supported axes. Only its complete local label agrees.
    return parsed === null && column !== null && suffix.trim() === column ? columnRevision : parsed;
  };
  const numberOffset = matchedText.indexOf(number);
  const lineRevision = statedRevision(numberOffset < 0 ? '' :
    matchedText.slice(numberOffset + number.length).split(/[;；\r\n]/u)[0]);
  const numberRevision = revisionStart < 0 ? undefined :
    statedRevision(rawReferenceNumber.slice(revisionStart));
  const statedRevisions = [columnRevision, numberRevision, lineRevision].filter(revision => revision !== undefined);
  const requestedBusinessRevision = statedRevisions.length === 0 ? undefined :
    statedRevisions.some(revision => revision !== statedRevisions[0]) ? null : statedRevisions[0];
  const orderedLocators = orderedReferenceLocators(
    sourceUnit,
    rawReferenceNumber,
  );
  const sourceRefIds =
    orderedLocators.length > 0
      ? orderedLocators.map((locator) => locator.sourceRefId)
      : [...sourceUnit.sourceRefIds];
  if (sourceRefIds.length === 0) return null;
  return {
    mentionId: `RM-${unit.ordinal}-structured-${sequence}`,
    unitOrdinal: unit.ordinal,
    matchedText,
    normalizedTarget,
    ...(requestedBusinessRevision === undefined ? {} : { requestedBusinessRevision }),
    documentType,
    contextRole: 'RELATED_INFORMATION',
    relationCue: null,
    relationRoleCandidates: ['GENERAL_BACKGROUND'],
    extractionMethod: 'STRUCTURED_REFERENCE',
    ...(!supportedDocumentType
      ? { initialResolutionState: 'UNSUPPORTED_DOCUMENT' as const }
      : !referenceNumberIsUsable || requestedBusinessRevision === null
        ? { initialResolutionState: 'UNRESOLVED' as const }
        : {}),
    targetApplicability: 'NOT_EVALUATED',
    sourceRefIds,
    sourceLocators: orderedLocators,
  };
}

/** The same key follows the source-stated edition through both readers and the
 * persisted snapshot. Missing and unparseable explicit editions are distinct. */
export function canonicalReferenceSelectionKey(value: {
  normalizedTarget: string; requestedBusinessRevision?: string | null; matchedText?: string;
}): string {
  return JSON.stringify([normalizeCode(value.normalizedTarget), value.requestedBusinessRevision === undefined
    ? 'CURRENT' : value.requestedBusinessRevision === null ? ['UNRESOLVED', value.matchedText ?? '']
      : ['EDITION', value.requestedBusinessRevision.trim().toUpperCase()]]);
}

function normalizedExplicitRevision(value: string): string | undefined {
  const label = value.trim().replace(/^\((.*)\)$/u, '$1').trim();
  const revision = label.match(/^(?:R|REV(?:ISION)?\.?)[\t ]*[:#]?[\t ]*(\d{1,4})$/iu);
  if (revision) return `R${Number(revision[1])}`;
  const issue = label.match(/^ISSUE[\t ]*#?[\t ]*(\d{1,6})$/iu);
  if (issue) return `ISSUE ${Number(issue[1])}`;
  if (/^(?:ORIGINAL[\t ]+ISSUE|原版)$/iu.test(label)) return 'ORIGINAL ISSUE';
  return undefined;
}

const REFERENCE_REVISION_PREFIX = /^[\t ]*(?:[,，:：][\t ]*)?(?:\([\t ]*)?(?:REV(?:ISION)?\.?|R|ISSUE|ORIGINAL[\t ]+ISSUE|原版)(?=[\t :#\d.)]|$)/iu;
const REFERENCE_REVISION_VALUE = /^[\t ]*(?:[,，:：][\t ]*)?(?:\([\t ]*)?((?:(?:REV(?:ISION)?\.?|R)[\t ]*[:#]?[\t ]*\d{1,4}|ISSUE[\t ]*#?[\t ]*\d{1,6}|ORIGINAL[\t ]+ISSUE|原版))(?=$|[^A-Z0-9])(?:[\t ]*\))?/iu;

function referenceRevisionSuffix(text: string): { length: number; requestedBusinessRevision?: string | null } {
  if (!REFERENCE_REVISION_PREFIX.test(text)) return { length: 0 };
  const first = text.match(REFERENCE_REVISION_VALUE);
  if (!first) return { length: text.length, requestedBusinessRevision: null };
  const revision = normalizedExplicitRevision(first[1]);
  let length = first[0].length;
  let remainder = text.slice(length);
  // A date or compound label is not the integer prefix of a known edition.
  if (/^[\t ]*[./,\-][\t ]*\d/u.test(remainder))
    return { length: text.length, requestedBusinessRevision: null };
  while (true) {
    const separator = remainder.match(/^[\t ]*(?:\/|,|\bor\b|\band\b|或|及)[\t ]*/iu);
    if (!separator || !REFERENCE_REVISION_PREFIX.test(remainder.slice(separator[0].length))) break;
    const next = remainder.slice(separator[0].length).match(REFERENCE_REVISION_VALUE);
    if (!next || normalizedExplicitRevision(next[1]) !== revision)
      return { length: text.length, requestedBusinessRevision: null };
    length += separator[0].length + next[0].length;
    remainder = text.slice(length);
  }
  return { length, requestedBusinessRevision: revision };
}

function withReferenceRevision(candidate: MentionCandidate, text: string, nextStart: number): MentionCandidate {
  const suffix = text.slice(candidate.end, nextStart).split(/[;；\r\n]/u)[0];
  const revision = referenceRevisionSuffix(suffix);
  if (revision.requestedBusinessRevision === undefined) return candidate;
  return { ...candidate, end: candidate.end + revision.length,
    matchedText: candidate.matchedText + suffix.slice(0, revision.length),
    requestedBusinessRevision: revision.requestedBusinessRevision,
    ...(revision.requestedBusinessRevision === null ? { initialResolutionState: 'UNRESOLVED' as const } : {}) };
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
  const compact = context.toUpperCase().replace(/[^A-Z0-9\u4E00-\u9FFF]/gu, '');
  if (
    /\bconcurrent(?:ly)?\b|并行要求|同期要求/iu.test(context) ||
    /CONCURRENT(?:LY)?|并行要求|同期要求/u.test(compact)
  ) {
    return 'CONCURRENT_REQUIREMENT';
  }
  if (
    /\brelated\s+(?:to|information)\b|see\s+also|相关资料|相关信息/iu.test(
      context,
    ) ||
    /RELATED(?:TO|INFORMATION)|SEEALSO|FORMOREINFORMATION|相关资料|相关信息/u.test(
      compact,
    )
  ) {
    return 'RELATED_INFORMATION';
  }
  if (
    /\brefer(?:red)?\s+to\b|in\s+accordance\s+with|accepted\s+procedure|参考.*程序|按照.*程序/iu.test(
      context,
    ) ||
    /REFER(?:RED)?TO|INACCORDANCEWITH|ACCEPTEDPROCEDURE|参考.*程序|按照.*程序/u.test(
      compact,
    )
  ) {
    return 'PROCEDURE_SUPPORT';
  }
  return 'UNCLASSIFIED';
}

function candidateRelationRoles(
  role: CanonicalReferenceContextRole,
): CanonicalRelatedContextRelationRole[] {
  if (role === 'CONCURRENT_REQUIREMENT' || role === 'PROCEDURE_SUPPORT') {
    return ['IMPLEMENTATION_INSTRUCTION'];
  }
  if (role === 'RELATED_INFORMATION') return ['GENERAL_BACKGROUND'];
  return [];
}

function relationCue(
  context: string,
  role: CanonicalReferenceContextRole,
): string | null {
  const patterns: Record<CanonicalReferenceContextRole, RegExp[]> = {
    CONCURRENT_REQUIREMENT: [
      /concurrent requirements?/iu,
      /并行要求|同期要求/u,
    ],
    PROCEDURE_SUPPORT: [
      /in accordance with|accepted procedure|refer(?:red)? to/iu,
      /参考[^。；\n]*程序|按照[^。；\n]*程序/u,
    ],
    RELATED_INFORMATION: [
      /related (?:to|information)|see also|for more information/iu,
      /相关资料|相关信息/u,
    ],
    UNCLASSIFIED: [],
  };
  for (const pattern of patterns[role]) {
    const match = context.match(pattern)?.[0]?.trim();
    if (match) return match;
  }
  return null;
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}
