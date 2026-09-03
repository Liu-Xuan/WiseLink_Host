import type {
  PdfSourceRefValue,
  ProfessionalInputDocumentIdentityInput,
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';

export type SemanticSectionBodyState = 'CONTENT' | 'NONE' | 'MISSING';

export interface SourceBoundSectionWindow {
  readonly family: 'FTD' | 'SB';
  readonly sectionKey: string;
  readonly matchedHeading: string;
  readonly occurrence: number;
  readonly nodeKind?: 'register' | 'section';
  readonly scopeKey?: string;
  readonly headingUnit: SourceUnit;
  readonly bodyUnits: readonly SourceUnit[];
  readonly semanticBodyState: SemanticSectionBodyState;
  readonly sourceRefIds: readonly string[];
  readonly pageStart: number;
  readonly pageEnd: number;
}

export interface SourceBoundConcurrentRequirement {
  readonly targetDocumentCode: string;
  readonly modificationCode: string | null;
  readonly modality: 'REQUIRED' | 'CONDITIONAL';
  readonly conditionRaw: string | null;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundConcurrentRequirementGroup {
  readonly operator: 'ANY';
  readonly memberDocumentCodes: readonly string[];
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundConcurrentRequirements {
  readonly semanticState: SemanticSectionBodyState;
  readonly requirementsStructured: boolean;
  readonly requirements: readonly SourceBoundConcurrentRequirement[];
  readonly relationGroups: readonly SourceBoundConcurrentRequirementGroup[];
}

interface SectionGrammarEntry {
  readonly sectionKey: string;
  readonly aliases: readonly string[];
}

interface SectionAnchorCandidate {
  readonly unit: SourceUnit;
  readonly index: number;
  readonly sectionKey: string;
  readonly matchedHeading: string;
  readonly nodeKind?: 'register' | 'section';
  readonly scopeKey?: string;
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
const AIRBUS_SB_REGISTERS = new Map([
  ['summary', 'summary'],
  ['1planninginformation', 'planning_information'],
  ['2materialinformation', 'material_information'],
  ['3accomplishmentinstructions', 'accomplishment_instructions'],
]);
const AIRBUS_SB_REQUIRED_REGISTERS = new Set([
  'summary',
  'planning_information',
  'material_information',
  'accomplishment_instructions',
]);

export function buildFamilySectionTopology(input: {
  readonly unitSet: SourceUnitSet;
  readonly document: ProfessionalInputDocumentIdentityInput;
}): readonly SourceBoundSectionWindow[] {
  if (input.document.documentType === 'fleet_team_digest') {
    return buildFtdSectionTopology(input.unitSet);
  }
  if (input.document.documentType === 'service_bulletin') {
    return buildAirbusSbSectionTopology(input.unitSet);
  }
  return [];
}

export function buildSourceBoundConcurrentRequirements(
  section: SourceBoundSectionWindow,
): SourceBoundConcurrentRequirements | null {
  if (
    section.family !== 'SB' ||
    section.sectionKey !== 'concurrent_requirements'
  ) {
    return null;
  }
  if (section.semanticBodyState !== 'CONTENT') {
    return {
      semanticState: section.semanticBodyState,
      requirementsStructured: true,
      requirements: [],
      relationGroups: [],
    };
  }
  const rowUnits = section.bodyUnits.filter((unit) =>
    /^Ref\.\s*SB\s+/iu.test(unit.text),
  );
  const requirements = rowUnits
    .map((unit) => parseConcurrentRequirementRow(unit, section.bodyUnits))
    .filter(
      (value): value is SourceBoundConcurrentRequirement => value !== null,
    );
  const requirementCodes = new Set(
    requirements.map((requirement) => requirement.targetDocumentCode),
  );
  const noteBlocks = concurrentNoteBlocks(section.bodyUnits);
  const relationGroups = noteBlocks
    .map((block) => parseAnyRequirementGroup(block, requirementCodes))
    .filter(
      (value): value is SourceBoundConcurrentRequirementGroup => value !== null,
    );
  const rowCodes = requirements.map(
    (requirement) => requirement.targetDocumentCode,
  );
  return {
    semanticState: 'CONTENT',
    requirementsStructured:
      rowUnits.length > 0 &&
      requirements.length === rowUnits.length &&
      new Set(rowCodes).size === rowCodes.length,
    requirements,
    relationGroups,
  };
}

function buildFtdSectionTopology(
  unitSet: SourceUnitSet,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet);
  const grammarByAlias = new Map<string, SectionGrammarEntry>();
  for (const entry of FTD_SECTION_GRAMMAR) {
    for (const alias of entry.aliases) {
      grammarByAlias.set(normalizeLabel(alias), entry);
    }
  }
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
    )
    .map(
      (anchor): SectionAnchorCandidate => ({
        unit: anchor.unit,
        index: anchor.index,
        sectionKey: anchor.grammar.sectionKey,
        matchedHeading: anchor.unit.text,
      }),
    );
  return materializeSectionWindows(unitSet, contentUnits, anchors, 'FTD');
}

function buildAirbusSbSectionTopology(
  unitSet: SourceUnitSet,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet);
  if (
    !contentUnits.some((unit) => normalizeLabel(unit.text) === 'airbus') ||
    !contentUnits.some(
      (unit) => normalizeLabel(unit.text) === 'servicebulletin',
    )
  ) {
    return [];
  }
  const registerCandidates = contentUnits.flatMap(
    (unit, index): SectionAnchorCandidate[] => {
      if (unit.expectedSemantic !== 'heading') return [];
      const sectionKey = AIRBUS_SB_REGISTERS.get(normalizeLabel(unit.text));
      return sectionKey
        ? [
            {
              unit,
              index,
              sectionKey,
              matchedHeading: unit.text,
              nodeKind: 'register',
              scopeKey: 'document',
            },
          ]
        : [];
    },
  );
  const observedRegisters = new Set(
    registerCandidates.map((candidate) => candidate.sectionKey),
  );
  if (
    [...AIRBUS_SB_REQUIRED_REGISTERS].some(
      (register) => !observedRegisters.has(register),
    )
  ) {
    return [];
  }
  const candidates: SectionAnchorCandidate[] = [...registerCandidates];
  for (const [index, unit] of contentUnits.entries()) {
    if (unit.expectedSemantic !== 'heading') continue;
    const match = unit.text
      .normalize('NFKC')
      .trim()
      .match(/^([A-Z])\s*\.\s*(\S.*)$/u);
    if (!match) continue;
    const register = [...registerCandidates]
      .reverse()
      .find((candidate) => candidate.index < index);
    if (!register) continue;
    const matchedHeading = match[2].replace(/\s+/gu, ' ').trim();
    candidates.push({
      unit,
      index,
      sectionKey: toSectionKey(matchedHeading),
      matchedHeading,
      nodeKind: 'section',
      scopeKey: register.sectionKey,
    });
  }
  candidates.sort((left, right) => left.index - right.index);
  return materializeSectionWindows(unitSet, contentUnits, candidates, 'SB');
}

function materializeSectionWindows(
  unitSet: SourceUnitSet,
  contentUnits: readonly SourceUnit[],
  anchors: readonly SectionAnchorCandidate[],
  family: SourceBoundSectionWindow['family'],
): readonly SourceBoundSectionWindow[] {
  const refById = new Map(
    unitSet.sourceRefs.map((sourceRef) => [sourceRef.sourceRefId, sourceRef]),
  );
  const repeatedAuxiliary = repeatedBottomAuxiliaryText(contentUnits, refById);
  const occurrences = new Map<string, number>();
  return anchors.map((anchor, anchorIndex) => {
    const nextIndex = nextSectionBoundary(
      anchors,
      anchorIndex,
      contentUnits.length,
    );
    const bodyUnits = contentUnits
      .slice(anchor.index + 1, nextIndex)
      .filter(
        (unit) =>
          !isRepeatedBottomAuxiliary(unit, refById, repeatedAuxiliary) &&
          !isPageNumberAuxiliary(unit, refById),
      );
    const occurrenceKey = `${anchor.scopeKey ?? 'document'}:${anchor.sectionKey}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
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
      sectionKey: anchor.sectionKey,
      matchedHeading: anchor.matchedHeading,
      occurrence,
      ...(anchor.nodeKind ? { nodeKind: anchor.nodeKind } : {}),
      ...(anchor.scopeKey ? { scopeKey: anchor.scopeKey } : {}),
      headingUnit: anchor.unit,
      bodyUnits,
      semanticBodyState: semanticBodyState(bodyUnits),
      sourceRefIds,
      pageStart: pages.length > 0 ? Math.min(...pages) : headingPage,
      pageEnd: pages.length > 0 ? Math.max(...pages) : headingPage,
    };
  });
}

function nextSectionBoundary(
  anchors: readonly SectionAnchorCandidate[],
  anchorIndex: number,
  fallback: number,
): number {
  const anchor = anchors[anchorIndex];
  if (anchor.nodeKind !== 'register') {
    return anchors[anchorIndex + 1]?.index ?? fallback;
  }
  return (
    anchors
      .slice(anchorIndex + 1)
      .find((candidate) => candidate.nodeKind === 'register')?.index ?? fallback
  );
}

function orderedContentUnits(unitSet: SourceUnitSet): SourceUnit[] {
  return unitSet.units
    .filter((unit) => unit.kind !== 'source_metadata')
    .slice()
    .sort((left, right) => left.order - right.order);
}

function parseConcurrentRequirementRow(
  unit: SourceUnit,
  bodyUnits: readonly SourceUnit[],
): SourceBoundConcurrentRequirement | null {
  const match = unit.text.match(
    /^Ref\.\s*SB\s+([A-Z]\d{3}-\d{2}-[A-Z]\d{3})(\d{6}[A-Z]\d{5})?$/iu,
  );
  if (!match) return null;
  const targetDocumentCode = match[1].toUpperCase();
  const noteBlock = concurrentNoteBlocks(bodyUnits).find((block) =>
    block.text.includes(targetDocumentCode),
  );
  const conditional =
    noteBlock !== undefined &&
    /concurrent\s*requirement\s*if/iu.test(noteBlock.text) &&
    /not\s*been\s*embodied\s*before\s*delivery/iu.test(noteBlock.text);
  const evidenceUnits = uniqueUnits([unit, ...(noteBlock?.units ?? [])]);
  return {
    targetDocumentCode,
    modificationCode: match[2]?.toUpperCase() ?? null,
    modality: conditional ? 'CONDITIONAL' : 'REQUIRED',
    conditionRaw: conditional ? (noteBlock?.text ?? null) : null,
    sourceUnitIds: evidenceUnits.map((sourceUnit) => sourceUnit.sourceUnitId),
    sourceRefIds: unique(
      evidenceUnits.flatMap((sourceUnit) => sourceUnit.sourceRefIds),
    ),
  };
}

function concurrentNoteBlocks(
  units: readonly SourceUnit[],
): Array<{ text: string; units: SourceUnit[] }> {
  const blocks: Array<{ text: string; units: SourceUnit[] }> = [];
  let current: SourceUnit[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    blocks.push({
      text: current.map((unit) => unit.text).join(' '),
      units: current,
    });
    current = [];
  };
  for (const unit of units) {
    if (/^NOTE\s*:/iu.test(unit.text)) {
      flush();
      current = [unit];
      continue;
    }
    if (current.length > 0) current.push(unit);
  }
  flush();
  return blocks;
}

function parseAnyRequirementGroup(
  block: { text: string; units: SourceUnit[] },
  knownCodes: ReadonlySet<string>,
): SourceBoundConcurrentRequirementGroup | null {
  if (
    !/accomplish\s*either/iu.test(block.text) ||
    !/\sor\s/iu.test(block.text)
  ) {
    return null;
  }
  const memberDocumentCodes = unique(
    [...block.text.matchAll(/[A-Z]\d{3}-\d{2}-[A-Z]\d{3}/giu)].map((match) =>
      match[0].toUpperCase(),
    ),
  );
  if (
    memberDocumentCodes.length < 2 ||
    memberDocumentCodes.some((documentCode) => !knownCodes.has(documentCode))
  ) {
    return null;
  }
  return {
    operator: 'ANY',
    memberDocumentCodes,
    sourceUnitIds: block.units.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(block.units.flatMap((unit) => unit.sourceRefIds)),
  };
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

function isPageNumberAuxiliary(
  unit: SourceUnit,
  refById: ReadonlyMap<string, PdfSourceRefValue>,
): boolean {
  if (!isBottomLocated(unit, refById)) return false;
  const match = unit.text
    .normalize('NFKC')
    .trim()
    .match(/^Page\s*(\d+)$/iu);
  return match !== null && Number(match[1]) === pageForUnit(unit, refById);
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

function toSectionKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function uniqueUnits(values: readonly SourceUnit[]): SourceUnit[] {
  const seen = new Set<string>();
  return values.filter((unit) => {
    if (seen.has(unit.sourceUnitId)) return false;
    seen.add(unit.sourceUnitId);
    return true;
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
