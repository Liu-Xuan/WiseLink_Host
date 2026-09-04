import type {
  PdfSourceRefValue,
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';
import type { SourceBoundSectionWindow } from './family-section-topology.builder';

const RIL_CHROME_MIN_NORMALIZED_Y = 900_000;
const RIL_CHROME_MAX_Y_SPREAD = 15_000;
const RIL_REFERENCE_COLUMN_MAX_X_SPREAD = 15_000;
const RIL_TABLE_MARKER_MAX_X_SPREAD = 15_000;

export interface SourceBoundRilPageChrome {
  readonly chromeStructured: boolean;
  readonly repeatedSignatureCount: number;
  readonly chromeUnitCount: number;
  readonly pageCounts: readonly {
    readonly page: number;
    readonly count: number;
  }[];
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundRilGeneralEvaluation {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly evaluationStructured: boolean;
  readonly unstructuredReason:
    | 'MANDATORY_AUTHORITY_UNRESOLVED'
    | 'RECOMMENDED_OPPORTUNITY_UNRESOLVED'
    | 'MONITORING_END_DATE_UNRESOLVED'
    | null;
  readonly mandatoryAuthorities: readonly {
    readonly issuerAuthority: 'EASA' | 'FAA';
    readonly targetDocumentKind: 'AIRWORTHINESS_DIRECTIVE';
    readonly targetDocumentCode: string;
    readonly effectiveDate: string;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  }[];
  readonly recommendedOpportunityRaw: string | null;
  readonly recommendedOpportunitySourceUnitIds: readonly string[];
  readonly recommendedOpportunitySourceRefIds: readonly string[];
  readonly monitoringEndDate: string | null;
  readonly monitoringEndDateSourceUnitIds: readonly string[];
  readonly monitoringEndDateSourceRefIds: readonly string[];
}

export interface SourceBoundRilDocumentReference {
  readonly relationKind: 'SUPPORTING_PUBLICATION';
  readonly issuerAuthority: 'AIRBUS' | 'EASA' | 'FAA';
  readonly targetDocumentKind:
    | 'AIRWORTHINESS_DIRECTIVE'
    | 'TECHNICAL_FOLLOW_UP'
    | 'SERVICE_BULLETIN'
    | 'ALL_OPERATORS_TRANSMISSION';
  readonly targetDocumentCode: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundRilDocumentReferences {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly referencesStructured: boolean;
  readonly unstructuredReason:
    | 'TABLE_HEADER_UNRESOLVED'
    | 'REFERENCE_ENTRY_UNRESOLVED'
    | 'DUPLICATE_OR_SELF_REFERENCE'
    | null;
  readonly references: readonly SourceBoundRilDocumentReference[];
}

export interface SourceBoundRilProcedureAction {
  readonly actionOrdinal: number;
  readonly actionTextRaw: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundRilProcedure {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly procedureStructured: boolean;
  readonly unstructuredReason:
    | 'TABLE_HEADER_UNRESOLVED'
    | 'STEP_MARKERS_UNRESOLVED'
    | 'STEP_GEOMETRY_UNRESOLVED'
    | null;
  readonly actions: readonly SourceBoundRilProcedureAction[];
  readonly noteRaw: string | null;
  readonly noteSourceUnitIds: readonly string[];
  readonly noteSourceRefIds: readonly string[];
}

/**
 * Removes only page-bottom units proven to be repeated at the same normalized
 * vertical location. This is layout evidence, not an Airbus footer keyword
 * list, so repeated figure captions remain semantic content.
 */
export function airbusRilSemanticContentUnits(
  unitSet: SourceUnitSet,
): SourceUnit[] {
  const chromeIds = new Set(classifyAirbusRilPageChrome(unitSet).sourceUnitIds);
  return orderedContentUnits(unitSet).filter(
    (unit) => !chromeIds.has(unit.sourceUnitId),
  );
}

export function buildSourceBoundRilPageChrome(
  unitSet: SourceUnitSet,
): SourceBoundRilPageChrome {
  const classification = classifyAirbusRilPageChrome(unitSet);
  const pageCount = Math.max(
    0,
    ...unitSet.sourceRefs.map((sourceRef) => sourceRef.pageEnd),
  );
  const pageCounts = new Map<number, number>();
  for (const unit of classification.units) {
    const page = refForUnit(unit, classification.refById)?.pageStart;
    if (page === undefined) continue;
    pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1);
  }
  return {
    chromeStructured:
      classification.signatures.size > 0 &&
      pageCounts.size === pageCount &&
      classification.units.length ===
        classification.signatures.size * pageCount &&
      [...pageCounts.values()].every(
        (count) => count === classification.signatures.size,
      ),
    repeatedSignatureCount: classification.signatures.size,
    chromeUnitCount: classification.units.length,
    pageCounts: [...pageCounts]
      .sort(([left], [right]) => left - right)
      .map(([page, count]) => ({ page, count })),
    sourceUnitIds: classification.units.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(
      classification.units.flatMap((unit) => unit.sourceRefIds),
    ),
  };
}

export function buildSourceBoundRilGeneralEvaluation(
  section: SourceBoundSectionWindow,
  unitSet: SourceUnitSet,
): SourceBoundRilGeneralEvaluation | null {
  if (!isRilSection(section, 'general_evaluation')) return null;
  const empty = emptyEvaluation(section);
  if (section.semanticBodyState !== 'CONTENT') return empty;
  const refById = sourceRefMap(unitSet);
  const mandatoryHeadingCount = section.bodyUnits.filter(
    (unit) => normalizeLabel(unit.text) === 'mandatory',
  ).length;
  const mandatoryAuthorities = section.bodyUnits.flatMap((unit) => {
    const match = unit.text
      .normalize('NFKC')
      .match(
        /^(EASA|FAA)\s*AD\s*(\d{4}-(?:\d{2,4}|\d{2}-\d{2}))\s*-\s*Effective\s+date\s+(\d{2}-[A-Z]{3}-\d{4})$/iu,
      );
    if (!match) return [];
    const effectiveDate = parseSourceDate(match[3]);
    if (!effectiveDate) return [];
    const issuerAuthority = match[1].toUpperCase() as 'EASA' | 'FAA';
    return [
      {
        issuerAuthority,
        targetDocumentKind: 'AIRWORTHINESS_DIRECTIVE' as const,
        targetDocumentCode: `${issuerAuthority} AD ${match[2]}`,
        effectiveDate,
        sourceUnitIds: [unit.sourceUnitId],
        sourceRefIds: [...unit.sourceRefIds],
      },
    ];
  });
  if (
    mandatoryHeadingCount !== 1 ||
    mandatoryAuthorities.length !== 2 ||
    new Set(mandatoryAuthorities.map((value) => value.issuerAuthority)).size !==
      2
  ) {
    return {
      ...empty,
      unstructuredReason: 'MANDATORY_AUTHORITY_UNRESOLVED',
    };
  }

  const opportunity = sourceValueBetweenSplitLabel({
    units: section.bodyUnits,
    refById,
    firstLabel: 'recommended',
    secondLabel: 'opportunity',
  });
  if (!opportunity) {
    return {
      ...empty,
      unstructuredReason: 'RECOMMENDED_OPPORTUNITY_UNRESOLVED',
    };
  }

  const monitoring = sourceValueBetweenSplitLabel({
    units: section.bodyUnits,
    refById,
    firstLabel: 'monitoringend',
    secondLabel: 'date',
    valuePattern: /^\d{2}-[A-Z]{3}-\d{4}$/iu,
  });
  const monitoringEndDate = monitoring
    ? parseSourceDate(monitoring.value.text)
    : null;
  const monitoringFootnoteCount = section.bodyUnits.filter((unit) =>
    /information\s+provided\s+in\s+this\s+RIL\s+applies\s+until\s+the\s+Monitoring\s+End\s+date/iu.test(
      unit.text.normalize('NFKC'),
    ),
  ).length;
  if (!monitoring || !monitoringEndDate || monitoringFootnoteCount !== 1) {
    return {
      ...empty,
      unstructuredReason: 'MONITORING_END_DATE_UNRESOLVED',
    };
  }

  return {
    semanticState: 'CONTENT',
    evaluationStructured: true,
    unstructuredReason: null,
    mandatoryAuthorities,
    recommendedOpportunityRaw: opportunity.value.text.trim(),
    recommendedOpportunitySourceUnitIds: opportunity.units.map(
      (unit) => unit.sourceUnitId,
    ),
    recommendedOpportunitySourceRefIds: unique(
      opportunity.units.flatMap((unit) => unit.sourceRefIds),
    ),
    monitoringEndDate,
    monitoringEndDateSourceUnitIds: monitoring.units.map(
      (unit) => unit.sourceUnitId,
    ),
    monitoringEndDateSourceRefIds: unique(
      monitoring.units.flatMap((unit) => unit.sourceRefIds),
    ),
  };
}

export function buildSourceBoundRilDocumentReferences(
  section: SourceBoundSectionWindow,
  currentDocumentCode: string,
  unitSet: SourceUnitSet,
): SourceBoundRilDocumentReferences | null {
  if (!isRilSection(section, 'document_references')) return null;
  const empty: SourceBoundRilDocumentReferences = {
    semanticState: section.semanticBodyState,
    referencesStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    references: [],
  };
  if (section.semanticBodyState !== 'CONTENT') return empty;
  const headerUnits = section.bodyUnits.filter(
    (unit) => normalizeLabel(unit.text) === 'documentreferencetitle',
  );
  const refById = sourceRefMap(unitSet);
  const headerRef =
    headerUnits.length === 1 ? refForUnit(headerUnits[0], refById) : undefined;
  if (!headerRef) {
    return {
      ...empty,
      referencesStructured: false,
      unstructuredReason: 'TABLE_HEADER_UNRESOLVED',
    };
  }

  const candidateUnits = section.bodyUnits.filter((unit) => {
    if (unit === headerUnits[0]) return false;
    const sourceRef = refForUnit(unit, refById);
    return (
      sourceRef !== undefined &&
      sourceRef.pageStart === headerRef.pageStart &&
      Math.abs(sourceRef.bbox[0] - headerRef.bbox[0]) <=
        RIL_REFERENCE_COLUMN_MAX_X_SPREAD
    );
  });
  const references = candidateUnits
    .map(parseRilDocumentReference)
    .filter(
      (value): value is SourceBoundRilDocumentReference => value !== null,
    );
  if (
    candidateUnits.length === 0 ||
    references.length !== candidateUnits.length
  ) {
    return {
      ...empty,
      referencesStructured: false,
      unstructuredReason: 'REFERENCE_ENTRY_UNRESOLVED',
    };
  }
  const identities = references.map(
    (reference) =>
      `${reference.targetDocumentKind}:${reference.targetDocumentCode}`,
  );
  if (
    new Set(identities).size !== identities.length ||
    references.some(
      (reference) =>
        normalizeLabel(reference.targetDocumentCode) ===
        normalizeLabel(currentDocumentCode),
    )
  ) {
    return {
      ...empty,
      referencesStructured: false,
      unstructuredReason: 'DUPLICATE_OR_SELF_REFERENCE',
    };
  }
  return {
    semanticState: 'CONTENT',
    referencesStructured: true,
    unstructuredReason: null,
    references,
  };
}

export function buildSourceBoundRilProcedure(
  section: SourceBoundSectionWindow,
  unitSet: SourceUnitSet,
): SourceBoundRilProcedure | null {
  if (!isRilSection(section, 'retrofit_procedure')) return null;
  const empty: SourceBoundRilProcedure = {
    semanticState: section.semanticBodyState,
    procedureStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    actions: [],
    noteRaw: null,
    noteSourceUnitIds: [],
    noteSourceRefIds: [],
  };
  if (section.semanticBodyState !== 'CONTENT') return empty;
  const refById = sourceRefMap(unitSet);
  const headerIndexes = section.bodyUnits.flatMap((unit, index) =>
    normalizeLabel(unit.text) === 'description' ? [index] : [],
  );
  if (headerIndexes.length !== 1) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'TABLE_HEADER_UNRESOLVED',
    };
  }
  const noteIndex = section.bodyUnits.findIndex(
    (unit, index) =>
      index > headerIndexes[0] && /^NOTE\b/iu.test(unit.text.trim()),
  );
  const tableEnd = noteIndex >= 0 ? noteIndex : section.bodyUnits.length;
  const tableUnits = section.bodyUnits.slice(headerIndexes[0] + 1, tableEnd);
  const markers = tableUnits.flatMap((unit) => {
    const marker = parseProcedureMarker(unit.text);
    const sourceRef = refForUnit(unit, refById);
    return marker && sourceRef
      ? [{ ...marker, unit, sourceRef, coordinate: globalCenterY(sourceRef) }]
      : [];
  });
  const ordinals = markers.map((marker) => marker.ordinal);
  const markerXs = markers.map((marker) => marker.sourceRef.bbox[0]);
  if (
    markers.length === 0 ||
    new Set(ordinals).size !== ordinals.length ||
    ordinals.some((ordinal, index) => ordinal !== index + 1) ||
    Math.max(...markerXs) - Math.min(...markerXs) >
      RIL_TABLE_MARKER_MAX_X_SPREAD
  ) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'STEP_MARKERS_UNRESOLVED',
    };
  }

  const assigned = new Map<number, SourceUnit[]>();
  const textByUnitId = new Map<string, string>();
  for (const unit of tableUnits) {
    const sourceRef = refForUnit(unit, refById);
    if (!sourceRef) {
      return {
        ...empty,
        procedureStructured: false,
        unstructuredReason: 'STEP_GEOMETRY_UNRESOLVED',
      };
    }
    const coordinate = globalCenterY(sourceRef);
    const distances = markers
      .map((marker) => ({
        marker,
        distance: Math.abs(coordinate - marker.coordinate),
      }))
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.marker.ordinal - right.marker.ordinal,
      );
    if (
      distances.length > 1 &&
      distances[0].distance === distances[1].distance
    ) {
      return {
        ...empty,
        procedureStructured: false,
        unstructuredReason: 'STEP_GEOMETRY_UNRESOLVED',
      };
    }
    const ordinal = distances[0].marker.ordinal;
    const units = assigned.get(ordinal) ?? [];
    units.push(unit);
    assigned.set(ordinal, units);
    const ownMarker = parseProcedureMarker(unit.text);
    textByUnitId.set(
      unit.sourceUnitId,
      ownMarker ? ownMarker.remainder : unit.text.trim(),
    );
  }
  const actions = markers.map((marker) => {
    const units = assigned.get(marker.ordinal) ?? [];
    const actionTextRaw = units
      .map((unit) => textByUnitId.get(unit.sourceUnitId) ?? '')
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    return {
      actionOrdinal: marker.ordinal,
      actionTextRaw,
      sourceUnitIds: units.map((unit) => unit.sourceUnitId),
      sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
    };
  });
  if (
    actions.some(
      (action) =>
        action.actionTextRaw.length === 0 || action.sourceRefIds.length === 0,
    )
  ) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'STEP_GEOMETRY_UNRESOLVED',
    };
  }
  const noteUnits = noteIndex >= 0 ? section.bodyUnits.slice(noteIndex) : [];
  return {
    semanticState: 'CONTENT',
    procedureStructured: true,
    unstructuredReason: null,
    actions,
    noteRaw:
      noteUnits.length > 0
        ? noteUnits
            .map((unit) => unit.text)
            .join(' ')
            .replace(/\s+/gu, ' ')
            .trim()
        : null,
    noteSourceUnitIds: noteUnits.map((unit) => unit.sourceUnitId),
    noteSourceRefIds: unique(noteUnits.flatMap((unit) => unit.sourceRefIds)),
  };
}

function classifyAirbusRilPageChrome(unitSet: SourceUnitSet): {
  readonly refById: ReadonlyMap<string, PdfSourceRefValue>;
  readonly signatures: ReadonlySet<string>;
  readonly units: readonly SourceUnit[];
  readonly sourceUnitIds: readonly string[];
} {
  const refById = sourceRefMap(unitSet);
  const candidates = orderedContentUnits(unitSet).flatMap((unit) => {
    const sourceRef = refForUnit(unit, refById);
    if (!sourceRef || sourceRef.bbox[1] < RIL_CHROME_MIN_NORMALIZED_Y) {
      return [];
    }
    return [
      {
        unit,
        sourceRef,
        signature: normalizeChromeText(unit.text),
      },
    ];
  });
  const bySignature = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (!candidate.signature) continue;
    const group = bySignature.get(candidate.signature) ?? [];
    group.push(candidate);
    bySignature.set(candidate.signature, group);
  }
  const signatures = new Set(
    [...bySignature]
      .filter(([, group]) => {
        const pages = new Set(group.map((value) => value.sourceRef.pageStart));
        const yValues = group.map((value) => value.sourceRef.bbox[1]);
        return (
          pages.size >= 2 &&
          Math.max(...yValues) - Math.min(...yValues) <= RIL_CHROME_MAX_Y_SPREAD
        );
      })
      .map(([signature]) => signature),
  );
  const units = candidates
    .filter((candidate) => signatures.has(candidate.signature))
    .map((candidate) => candidate.unit);
  return {
    refById,
    signatures,
    units,
    sourceUnitIds: units.map((unit) => unit.sourceUnitId),
  };
}

function parseRilDocumentReference(
  unit: SourceUnit,
): SourceBoundRilDocumentReference | null {
  const text = unit.text.normalize('NFKC').trim();
  const definitions: readonly {
    readonly pattern: RegExp;
    readonly issuerAuthority: SourceBoundRilDocumentReference['issuerAuthority'];
    readonly targetDocumentKind: SourceBoundRilDocumentReference['targetDocumentKind'];
    readonly prefix?: string;
  }[] = [
    {
      pattern: /^EASA\s*AD\s*(\d{4}-\d{4})(?![\d-])/iu,
      issuerAuthority: 'EASA',
      targetDocumentKind: 'AIRWORTHINESS_DIRECTIVE',
      prefix: 'EASA AD ',
    },
    {
      pattern: /^FAA\s*AD\s*(\d{4}-\d{2}-\d{2})(?![\d-])/iu,
      issuerAuthority: 'FAA',
      targetDocumentKind: 'AIRWORTHINESS_DIRECTIVE',
      prefix: 'FAA AD ',
    },
    {
      pattern: /^TFU\s*(\d{2}\.\d{2}\.\d{5})(?![\d.-])/iu,
      issuerAuthority: 'AIRBUS',
      targetDocumentKind: 'TECHNICAL_FOLLOW_UP',
      prefix: 'TFU ',
    },
    {
      pattern: /^AIRBUS\s*SB\s*([A-Z]\d{3}-\d{2}-[A-Z]\d{3})(?![\d-])/iu,
      issuerAuthority: 'AIRBUS',
      targetDocumentKind: 'SERVICE_BULLETIN',
    },
    {
      pattern: /^AOT\s*([A-Z]\d{2}[A-Z]\d{3}-\d{2})(?![\d-])/iu,
      issuerAuthority: 'AIRBUS',
      targetDocumentKind: 'ALL_OPERATORS_TRANSMISSION',
      prefix: 'AOT ',
    },
  ];
  for (const definition of definitions) {
    const match = text.match(definition.pattern);
    if (!match) continue;
    return {
      relationKind: 'SUPPORTING_PUBLICATION',
      issuerAuthority: definition.issuerAuthority,
      targetDocumentKind: definition.targetDocumentKind,
      targetDocumentCode: `${definition.prefix ?? ''}${match[1]}`.toUpperCase(),
      sourceUnitIds: [unit.sourceUnitId],
      sourceRefIds: [...unit.sourceRefIds],
    };
  }
  return null;
}

function sourceValueBetweenSplitLabel(input: {
  readonly units: readonly SourceUnit[];
  readonly refById: ReadonlyMap<string, PdfSourceRefValue>;
  readonly firstLabel: string;
  readonly secondLabel: string;
  readonly valuePattern?: RegExp;
}): { value: SourceUnit; units: SourceUnit[] } | null {
  const first = input.units.filter(
    (unit) => normalizeLabel(unit.text) === input.firstLabel,
  );
  const second = input.units.filter(
    (unit) => normalizeLabel(unit.text) === input.secondLabel,
  );
  if (first.length !== 1 || second.length !== 1) return null;
  const firstRef = refForUnit(first[0], input.refById);
  const secondRef = refForUnit(second[0], input.refById);
  if (!firstRef || !secondRef || firstRef.pageStart !== secondRef.pageStart) {
    return null;
  }
  const firstY = centerY(firstRef);
  const secondY = centerY(secondRef);
  if (
    firstY >= secondY ||
    Math.abs(firstRef.bbox[0] - secondRef.bbox[0]) > 15_000
  ) {
    return null;
  }
  const values = input.units.filter((unit) => {
    if (unit === first[0] || unit === second[0]) return false;
    const sourceRef = refForUnit(unit, input.refById);
    if (!sourceRef || sourceRef.pageStart !== firstRef.pageStart) return false;
    const y = centerY(sourceRef);
    return (
      y > firstY &&
      y < secondY &&
      sourceRef.bbox[0] - firstRef.bbox[0] >= 50_000 &&
      (!input.valuePattern || input.valuePattern.test(unit.text.trim()))
    );
  });
  if (values.length !== 1) return null;
  return { value: values[0], units: [first[0], values[0], second[0]] };
}

function emptyEvaluation(
  section: SourceBoundSectionWindow,
): SourceBoundRilGeneralEvaluation {
  return {
    semanticState: section.semanticBodyState,
    evaluationStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    mandatoryAuthorities: [],
    recommendedOpportunityRaw: null,
    recommendedOpportunitySourceUnitIds: [],
    recommendedOpportunitySourceRefIds: [],
    monitoringEndDate: null,
    monitoringEndDateSourceUnitIds: [],
    monitoringEndDateSourceRefIds: [],
  };
}

function parseProcedureMarker(
  value: string,
): { ordinal: number; remainder: string } | null {
  const text = value.normalize('NFKC').trim();
  const exact = text.match(/^(\d+)$/u);
  if (exact) return { ordinal: Number(exact[1]), remainder: '' };
  const fused = text.match(/^(\d+)(?=\p{L})(.*)$/u);
  return fused
    ? { ordinal: Number(fused[1]), remainder: fused[2].trim() }
    : null;
}

function parseSourceDate(value: string): string | null {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(\d{2})-([A-Z]{3})-(\d{4})$/u);
  if (!match) return null;
  const month = new Map([
    ['JAN', '01'],
    ['FEB', '02'],
    ['MAR', '03'],
    ['APR', '04'],
    ['MAY', '05'],
    ['JUN', '06'],
    ['JUL', '07'],
    ['AUG', '08'],
    ['SEP', '09'],
    ['OCT', '10'],
    ['NOV', '11'],
    ['DEC', '12'],
  ]).get(match[2]);
  return month ? `${match[3]}-${month}-${match[1]}` : null;
}

function isRilSection(
  section: SourceBoundSectionWindow,
  sectionKey: string,
): boolean {
  return (
    section.family === 'SB' &&
    section.scopeKey === 'retrofit_information_letter' &&
    section.sectionKey === sectionKey
  );
}

function sourceRefMap(
  unitSet: SourceUnitSet,
): ReadonlyMap<string, PdfSourceRefValue> {
  return new Map(
    unitSet.sourceRefs.map((sourceRef) => [sourceRef.sourceRefId, sourceRef]),
  );
}

function refForUnit(
  unit: SourceUnit,
  refById: ReadonlyMap<string, PdfSourceRefValue>,
): PdfSourceRefValue | undefined {
  return refById.get(unit.sourceRefIds[0]);
}

function centerY(sourceRef: PdfSourceRefValue): number {
  return (sourceRef.bbox[1] + sourceRef.bbox[3]) / 2;
}

function globalCenterY(sourceRef: PdfSourceRefValue): number {
  return (sourceRef.pageStart - 1) * 1_000_000 + centerY(sourceRef);
}

function normalizeChromeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/Page\s*\d+\s*of\s*\d+/giu, 'Page#of#')
    .replace(/\s+/gu, '')
    .toLocaleLowerCase('en-US');
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function orderedContentUnits(unitSet: SourceUnitSet): SourceUnit[] {
  return unitSet.units
    .filter((unit) => unit.kind !== 'source_metadata')
    .slice()
    .sort((left, right) => left.order - right.order);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
