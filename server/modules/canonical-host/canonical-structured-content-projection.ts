import type {
  CanonicalStructuredContentSourceLocator,
  CanonicalStructuredContentUnit,
  UnifiedReaderQueryResult,
  UnifiedReaderSourceLocator,
} from '@shared/api.interface';

const MAX_SOURCE_QUOTE_LENGTH = 320;

interface BrowserSafeUnitSemantics {
  displayKind: CanonicalStructuredContentUnit['displayKind'];
  outlineKind: CanonicalStructuredContentUnit['outlineKind'];
  sectionTitle: string | null;
  displayText: string;
}

export function projectCanonicalStructuredContentUnit(
  unit: UnifiedReaderQueryResult,
  ordinal: number,
): CanonicalStructuredContentUnit | null {
  const semantics: BrowserSafeUnitSemantics | null =
    browserSafeUnitSemantics(unit);
  if (semantics === null) return null;
  return {
    ordinal,
    displayKind: semantics.displayKind,
    outlineKind: semantics.outlineKind,
    sectionTitle: semantics.sectionTitle,
    displayText: semantics.displayText,
    sourceRefIds: [...unit.sourceRefIds],
    sourceLocators: (unit.sourceLocators ?? []).map((locator) =>
      projectCanonicalStructuredContentLocator(locator),
    ),
  };
}

export function projectCanonicalBrowserQueryResult(
  unit: UnifiedReaderQueryResult,
  ordinal: number,
): UnifiedReaderQueryResult | null {
  const projected: CanonicalStructuredContentUnit | null =
    projectCanonicalStructuredContentUnit(unit, ordinal);
  if (projected === null) return null;
  return {
    unitId: unit.unitId,
    kind: unit.kind,
    text: projected.displayText,
    sourceRefIds: [...unit.sourceRefIds],
    sourceLocators: projected.sourceLocators.map((locator) => ({
      ...locator,
      artifactId: null,
      charStart: null,
      charEnd: null,
      charOffsetUnit: null,
      normalizedPath: null,
      xpath: null,
      elementId: null,
      bbox: null,
    })),
  };
}

function browserSafeUnitSemantics(
  unit: UnifiedReaderQueryResult,
  depth = 0,
): BrowserSafeUnitSemantics | null {
  const normalizedText: string = unit.text.trim().normalize('NFC');
  const sourceOutline: boolean = isSourceHeading(unit.kind);
  const decoded: DecodedStructuredText = decodeStructuredText(normalizedText);
  if (decoded.kind === 'PLAIN') {
    return {
      displayKind: sourceOutline ? 'section' : 'body',
      outlineKind: sourceOutline ? 'SECTION' : 'NONE',
      sectionTitle: sourceOutline ? normalizedText : null,
      displayText: normalizedText,
    };
  }
  if (decoded.kind === 'INVALID') return unavailableSemantics();
  const parsed: unknown = decoded.value;
  if (typeof parsed === 'string') {
    const displayText: string | null = readableText(parsed);
    if (displayText === null) return unavailableSemantics();
    if (depth < 3 && decodeStructuredText(displayText).kind !== 'PLAIN') {
      return browserSafeUnitSemantics(
        { ...unit, text: displayText },
        depth + 1,
      );
    }
    if (depth >= 3 && decodeStructuredText(displayText).kind !== 'PLAIN') {
      return unavailableSemantics();
    }
    return {
      displayKind: sourceOutline ? 'section' : 'body',
      outlineKind: sourceOutline ? 'SECTION' : 'NONE',
      sectionTitle: sourceOutline ? displayText : null,
      displayText,
    };
  }
  if (!isRecord(parsed)) {
    return unavailableSemantics();
  }

  const value: Record<string, unknown> | null = isRecord(parsed.value)
    ? parsed.value
    : null;
  const observationType: string | null = readableText(parsed.observationType);
  if (observationType === 'SECTION_WINDOW') return null;
  const matchedHeading: string | null = firstReadableText(
    value?.matchedHeading,
    parsed.matchedHeading,
  );
  const sectionTitle: string | null = firstReadableText(
    matchedHeading,
    parsed.sectionTitle,
    value?.sectionTitle,
    sourceOutline ? parsed.title : null,
  );
  const sectionAnchor: boolean =
    observationType === 'SECTION_ANCHOR' || sourceOutline;
  const content: string | null = firstReadableText(
    value?.text,
    value?.statement,
    value?.instructionText,
    value?.quote,
    typeof parsed.value === 'string' ? parsed.value : null,
    parsed.text,
    parsed.statement,
    parsed.instructionText,
    parsed.rawText,
    parsed.quote,
    parsed.sourceLine,
    parsed.title,
    parsed.label,
    matchedHeading,
  );
  if (content !== null && decodeStructuredText(content).kind !== 'PLAIN') {
    if (depth >= 3) return unavailableSemantics();
    return browserSafeUnitSemantics({ ...unit, text: content }, depth + 1);
  }

  const displayText: string | null =
    content ??
    structuredMetadataSummary(parsed) ??
    observationSummary(observationType);
  if (displayText === null) return unavailableSemantics();
  const displayKind: CanonicalStructuredContentUnit['displayKind'] =
    sectionAnchor && sectionTitle !== null ? 'section' : 'body';
  return {
    displayKind,
    outlineKind: displayKind === 'section' ? 'SECTION' : 'NONE',
    sectionTitle: displayKind === 'section' ? sectionTitle : null,
    displayText,
  };
}

type DecodedStructuredText =
  | { kind: 'PLAIN' }
  | { kind: 'INVALID' }
  | { kind: 'STRUCTURED'; value: unknown };

function decodeStructuredText(text: string): DecodedStructuredText {
  if (!text.startsWith('{') && !text.startsWith('[') && !text.startsWith('"')) {
    return { kind: 'PLAIN' };
  }
  try {
    return { kind: 'STRUCTURED', value: JSON.parse(text) as unknown };
  } catch {
    return { kind: 'INVALID' };
  }
}

function structuredMetadataSummary(
  record: Record<string, unknown>,
): string | null {
  const aircraftModel: string | null = readableText(record.airplaneModel);
  const ataCode: string | null = readableText(record.ataCode);
  const minorModels: string | null = readableText(record.minorModels);
  const eccn: string | null = readableText(record.eccn);
  const aircraftParts: string[] = [
    aircraftModel ? `机型：${aircraftModel}` : '',
    ataCode ? `ATA：${ataCode}` : '',
    minorModels ? `子型号：${minorModels}` : '',
    eccn ? `出口分类：${eccn}` : '',
  ].filter(Boolean);
  if (aircraftParts.length > 0) return aircraftParts.join(' · ');

  const dateParts: string[] = [
    labeledValue('发起日期', record.originatedDate),
    labeledValue('最近修订', record.lastRevisedDate),
    labeledValue('创建日期', record.createdOn),
    labeledValue('预计完成', record.estimatedCompletionDate),
    labeledValue('下次更新', record.nextUpdateDate),
  ].filter(Boolean);
  if (dateParts.length > 0) return dateParts.join(' · ');

  const referenceType: string | null = readableText(record.referenceType);
  const referenceNumber: string | null = readableText(record.referenceNumber);
  if (referenceType || referenceNumber) {
    return [referenceType, referenceNumber].filter(Boolean).join(' · ');
  }
  return null;
}

function observationSummary(observationType: string | null): string | null {
  if (observationType === 'SECTION_ANCHOR') {
    return '已识别章节位置，但没有可显示的章节标题。';
  }
  return null;
}

function unavailableSemantics(): BrowserSafeUnitSemantics {
  return {
    displayKind: 'unavailable',
    outlineKind: 'NONE',
    sectionTitle: null,
    displayText: '该结构单元暂不支持直接阅读。',
  };
}

function isSourceHeading(kind: string): boolean {
  const normalized: string = kind.toLocaleLowerCase();
  return normalized.includes('heading') || normalized.includes('title');
}

function firstReadableText(...values: unknown[]): string | null {
  for (const value of values) {
    const text: string | null = readableText(value);
    if (text !== null) return text;
  }
  return null;
}

function readableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized: string = value.trim().normalize('NFC');
  return normalized === '' ? null : normalized;
}

function labeledValue(label: string, value: unknown): string {
  const text: string | null = readableText(value);
  return text === null ? '' : `${label}：${text}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function projectCanonicalStructuredContentLocator(
  locator: UnifiedReaderSourceLocator,
  focusText?: string,
): CanonicalStructuredContentSourceLocator {
  return {
    sourceRefId: locator.sourceRefId,
    kind: locator.kind,
    pageStart: locator.pageStart,
    pageEnd: locator.pageEnd,
    quote: boundedQuote(locator.quote, focusText),
  };
}

function boundedQuote(
  value: string | null,
  focusText?: string,
): string | null {
  const quote: string | null = readableText(value);
  if (quote === null) return null;
  if (quote.length <= MAX_SOURCE_QUOTE_LENGTH) return quote;
  const focus = focusText?.trim();
  if (focus) {
    const index = quote.toUpperCase().indexOf(focus.toUpperCase());
    if (index >= 0) {
      const radius = Math.floor((MAX_SOURCE_QUOTE_LENGTH - 3) / 2);
      const start = Math.max(0, index - radius);
      const end = Math.min(quote.length, start + MAX_SOURCE_QUOTE_LENGTH - 2);
      return `${start > 0 ? '…' : ''}${quote.slice(start, end).trim()}${
        end < quote.length ? '…' : ''
      }`;
    }
  }
  return `${quote.slice(0, MAX_SOURCE_QUOTE_LENGTH - 1).trimEnd()}…`;
}
