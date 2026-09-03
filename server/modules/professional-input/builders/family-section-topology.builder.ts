import type {
  PdfSourceRefValue,
  ProfessionalInputDocumentIdentityInput,
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';

export type SemanticSectionBodyState = 'CONTENT' | 'NONE' | 'MISSING';

export interface SourceBoundSectionWindow {
  readonly family: 'FTD';
  readonly sectionKey: string;
  readonly matchedHeading: string;
  readonly occurrence: number;
  readonly headingUnit: SourceUnit;
  readonly bodyUnits: readonly SourceUnit[];
  readonly semanticBodyState: SemanticSectionBodyState;
  readonly sourceRefIds: readonly string[];
  readonly pageStart: number;
  readonly pageEnd: number;
}

interface SectionGrammarEntry {
  readonly sectionKey: string;
  readonly aliases: readonly string[];
}

/**
 * Family grammars contribute only source-observable section labels. The
 * shared scan below owns ordering, duplicate occurrences, bounded windows,
 * explicit-empty state, repeated-page auxiliary filtering and provenance.
 */
const FTD_SECTION_GRAMMAR: readonly SectionGrammarEntry[] = [
  { sectionKey: 'revision_description', aliases: ['revision description'] },
  { sectionKey: 'applicability', aliases: ['applicability'] },
  { sectionKey: 'description', aliases: ['description'] },
  { sectionKey: 'background', aliases: ['background'] },
  { sectionKey: 'status', aliases: ['status'] },
  { sectionKey: 'interim_action', aliases: ['interim action'] },
  { sectionKey: 'final_action', aliases: ['final action'] },
  { sectionKey: 'milestones', aliases: ['milestones'] },
  { sectionKey: 'operator_action', aliases: ['operator action'] },
  { sectionKey: 'reference_categories', aliases: ['reference categories'] },
  { sectionKey: 'related_categories', aliases: ['related categories'] },
] as const;

const EXPLICIT_NONE_VALUES = new Set(['none', 'n/a', 'not applicable']);
const REPEATED_AUXILIARY_MIN_NORMALIZED_Y = 800_000;

export function buildFamilySectionTopology(input: {
  readonly unitSet: SourceUnitSet;
  readonly document: ProfessionalInputDocumentIdentityInput;
}): readonly SourceBoundSectionWindow[] {
  if (input.document.documentType !== 'fleet_team_digest') return [];
  return buildSectionTopology(input.unitSet, 'FTD', FTD_SECTION_GRAMMAR);
}

function buildSectionTopology(
  unitSet: SourceUnitSet,
  family: SourceBoundSectionWindow['family'],
  grammar: readonly SectionGrammarEntry[],
): readonly SourceBoundSectionWindow[] {
  const refById = new Map(
    unitSet.sourceRefs.map((sourceRef) => [sourceRef.sourceRefId, sourceRef]),
  );
  const grammarByAlias = new Map<string, SectionGrammarEntry>();
  for (const entry of grammar) {
    for (const alias of entry.aliases) {
      grammarByAlias.set(normalizeLabel(alias), entry);
    }
  }
  const contentUnits = unitSet.units
    .filter((unit) => unit.kind !== 'source_metadata')
    .slice()
    .sort((left, right) => left.order - right.order);
  const anchors = contentUnits
    .map((unit, index) => ({
      unit,
      index,
      grammar: grammarByAlias.get(normalizeLabel(unit.text)) ?? null,
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        unit: SourceUnit;
        index: number;
        grammar: SectionGrammarEntry;
      } => candidate.grammar !== null,
    );
  const repeatedAuxiliary = repeatedBottomAuxiliaryText(contentUnits, refById);
  const occurrences = new Map<string, number>();
  return anchors.map((anchor, anchorIndex) => {
    const nextIndex = anchors[anchorIndex + 1]?.index ?? contentUnits.length;
    const bodyUnits = contentUnits
      .slice(anchor.index + 1, nextIndex)
      .filter(
        (unit) => !isRepeatedBottomAuxiliary(unit, refById, repeatedAuxiliary),
      );
    const occurrence = (occurrences.get(anchor.grammar.sectionKey) ?? 0) + 1;
    occurrences.set(anchor.grammar.sectionKey, occurrence);
    const sourceUnits = bodyUnits.length > 0 ? bodyUnits : [anchor.unit];
    const sourceRefIds = unique(
      sourceUnits.flatMap((unit) => unit.sourceRefIds),
    );
    const pages = sourceRefIds
      .map((sourceRefId) => refById.get(sourceRefId))
      .filter(
        (sourceRef): sourceRef is PdfSourceRefValue => sourceRef !== undefined,
      )
      .flatMap((sourceRef) => [sourceRef.pageStart, sourceRef.pageEnd]);
    const headingPage = pageForUnit(anchor.unit, refById);
    return {
      family,
      sectionKey: anchor.grammar.sectionKey,
      matchedHeading: anchor.unit.text,
      occurrence,
      headingUnit: anchor.unit,
      bodyUnits,
      semanticBodyState: semanticBodyState(bodyUnits),
      sourceRefIds,
      pageStart: pages.length > 0 ? Math.min(...pages) : headingPage,
      pageEnd: pages.length > 0 ? Math.max(...pages) : headingPage,
    };
  });
}

function semanticBodyState(
  bodyUnits: readonly SourceUnit[],
): SemanticSectionBodyState {
  if (bodyUnits.length === 0) return 'MISSING';
  const values = bodyUnits.map((unit) => normalizeExplicitState(unit.text));
  return values.length === 1 && EXPLICIT_NONE_VALUES.has(values[0])
    ? 'NONE'
    : 'CONTENT';
}

function repeatedBottomAuxiliaryText(
  units: readonly SourceUnit[],
  refById: ReadonlyMap<string, PdfSourceRefValue>,
): ReadonlySet<string> {
  const pagesByText = new Map<string, Set<number>>();
  for (const unit of units) {
    if (!isBottomLocated(unit, refById)) continue;
    const key = normalizeAuxiliaryText(unit.text);
    if (!key) continue;
    const pages = pagesByText.get(key) ?? new Set<number>();
    pages.add(pageForUnit(unit, refById));
    pagesByText.set(key, pages);
  }
  return new Set(
    [...pagesByText].filter(([, pages]) => pages.size > 1).map(([key]) => key),
  );
}

function isRepeatedBottomAuxiliary(
  unit: SourceUnit,
  refById: ReadonlyMap<string, PdfSourceRefValue>,
  repeatedText: ReadonlySet<string>,
): boolean {
  return (
    isBottomLocated(unit, refById) &&
    repeatedText.has(normalizeAuxiliaryText(unit.text))
  );
}

function isBottomLocated(
  unit: SourceUnit,
  refById: ReadonlyMap<string, PdfSourceRefValue>,
): boolean {
  return unit.sourceRefIds.some((sourceRefId) => {
    const sourceRef = refById.get(sourceRefId);
    return (
      sourceRef !== undefined &&
      sourceRef.bbox[1] >= REPEATED_AUXILIARY_MIN_NORMALIZED_Y
    );
  });
}

function pageForUnit(
  unit: SourceUnit,
  refById: ReadonlyMap<string, PdfSourceRefValue>,
): number {
  return refById.get(unit.sourceRefIds[0])?.pageStart ?? 1;
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizeExplicitState(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[.!:;]+$/gu, '')
    .replace(/\s+/gu, ' ');
}

function normalizeAuxiliaryText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
