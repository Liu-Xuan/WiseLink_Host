import type {
  PdfSourceRefValue,
  ProfessionalInputDocumentIdentityInput,
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';

export type SemanticSectionBodyState = 'CONTENT' | 'NONE' | 'MISSING';

export interface SourceBoundSectionWindow {
  readonly family: 'FTD' | 'SB' | 'AD';
  readonly sectionKey: string;
  readonly matchedHeading: string;
  readonly occurrence: number;
  readonly nodeKind?: 'register' | 'section' | 'action';
  readonly scopeKey?: string;
  readonly ordinal?: string;
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

export interface SourceBoundAdObligation {
  readonly itemOrdinal: string;
  readonly actionTitle: string | null;
  readonly modality: 'REQUIRED' | 'CONDITIONAL';
  readonly conditionRaw: string | null;
  readonly complianceTimeRaw: string | null;
  readonly actionTextRaw: string;
  readonly nestedParagraphCount: number;
  readonly conditionalClauseCount: number;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAdObligations {
  readonly semanticState: SemanticSectionBodyState;
  readonly obligationsStructured: boolean;
  readonly unstructuredReason:
    | 'LEADING_UNSCOPED_CONTENT'
    | 'NO_TOP_LEVEL_ACTIONS'
    | null;
  readonly obligations: readonly SourceBoundAdObligation[];
}

export type SourceBoundAdRelationKind =
  | 'AFFECTS'
  | 'TERMINATES'
  | 'APPLICABILITY_SCOPE'
  | 'ACTION_BASIS'
  | 'INCORPORATED_BY_REFERENCE';

export interface SourceBoundAdDocumentRelation {
  readonly relationKind: SourceBoundAdRelationKind;
  readonly targetDocumentKind:
    | 'AIRWORTHINESS_DIRECTIVE'
    | 'SERVICE_BULLETIN'
    | 'AMOC_LETTER';
  readonly targetDocumentCode: string;
  readonly targetRevision: string | null;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAdDocumentRelations {
  readonly semanticState: SemanticSectionBodyState;
  readonly relationsStructured: boolean;
  readonly relations: readonly SourceBoundAdDocumentRelation[];
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
  readonly nodeKind?: 'register' | 'section' | 'action';
  readonly scopeKey?: string;
  readonly ordinal?: string;
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
const FAA_AD_SECTION_GRAMMAR: readonly SectionGrammarEntry[] = [
  { sectionKey: 'effective_date', aliases: ['effective date'] },
  { sectionKey: 'affected_ads', aliases: ['affected ads'] },
  { sectionKey: 'applicability', aliases: ['applicability'] },
  { sectionKey: 'subject', aliases: ['subject'] },
  { sectionKey: 'unsafe_condition', aliases: ['unsafe condition'] },
  { sectionKey: 'compliance', aliases: ['compliance'] },
  { sectionKey: 'required_actions', aliases: ['required actions'] },
  {
    sectionKey: 'terminating_action_for_affected_ads',
    aliases: ['terminating action for affected ads'],
  },
  { sectionKey: 'special_flight_permit', aliases: ['special flight permit'] },
  {
    sectionKey: 'alternative_methods_of_compliance',
    aliases: [
      'alternative methods of compliance (amocs)',
      'alternative methods of compliance',
    ],
  },
  { sectionKey: 'related_information', aliases: ['related information'] },
  {
    sectionKey: 'material_incorporated_by_reference',
    aliases: ['material incorporated by reference'],
  },
] as const;
const FAA_AD_OPERATIVE_SCOPE = 'operative_rule';
const FAA_AD_OPERATIVE_START = '3913amended';
const FAA_AD_CORE_SECTIONS = new Set([
  'effective_date',
  'applicability',
  'compliance',
  'alternative_methods_of_compliance',
  'material_incorporated_by_reference',
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
  if (input.document.documentType === 'airworthiness_directive') {
    return buildFaaAdSectionTopology(input.unitSet);
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

export function buildSourceBoundAdObligations(
  section: SourceBoundSectionWindow,
): SourceBoundAdObligations | null {
  if (
    section.family !== 'AD' ||
    (section.sectionKey !== 'required_actions' && section.nodeKind !== 'action')
  ) {
    return null;
  }
  if (section.semanticBodyState !== 'CONTENT') {
    return {
      semanticState: section.semanticBodyState,
      obligationsStructured: true,
      unstructuredReason: null,
      obligations: [],
    };
  }
  const numbered =
    section.sectionKey === 'required_actions'
      ? splitTopLevelNumberedParagraphs(section.bodyUnits)
      : null;
  if (numbered?.leadingUnits.length) {
    return {
      semanticState: 'CONTENT',
      obligationsStructured: false,
      unstructuredReason: 'LEADING_UNSCOPED_CONTENT',
      obligations: [],
    };
  }
  const groups = numbered
    ? numbered.groups
    : [
        {
          itemOrdinal: section.ordinal ?? String(section.occurrence),
          units: [...section.bodyUnits],
        },
      ];
  if (groups.length === 0) {
    return {
      semanticState: 'CONTENT',
      obligationsStructured: false,
      unstructuredReason: 'NO_TOP_LEVEL_ACTIONS',
      obligations: [],
    };
  }
  const obligations: SourceBoundAdObligation[] = groups.map(
    ({ itemOrdinal, units }) => {
      const actionTextRaw = joinSourceText(units);
      const conditionRaw = firstMatch(
        actionTextRaw,
        /(?:^|\n)(?:\([^)]+\)\s*)?(For\s+airplanes\b[^:]+):/iu,
        1,
      );
      const complianceTimeRaw =
        firstMatch(
          actionTextRaw,
          /\b(Within\s+\d+(?:\.\d+)?\s+(?:days?|months?|years?)\s+after\s+the\s+effective\s+date\s+of\s+this\s+AD)\b/iu,
          1,
        ) ??
        firstMatch(
          actionTextRaw,
          /\b(Before\s+further\s+flight(?:\s+after\s+[^,.;:]+)?)/iu,
          1,
        );
      const nestedParagraphCount = units.filter((unit) =>
        /^\([^)]+\)\s/u.test(unit.text.trim()),
      ).length;
      const conditionalClauseCount = units.filter((unit) =>
        /^(?:\([^)]+\)\s*)?If\b/iu.test(unit.text.trim()),
      ).length;
      return {
        itemOrdinal,
        actionTitle:
          section.nodeKind === 'action' ? section.matchedHeading : null,
        modality: conditionRaw ? 'CONDITIONAL' : 'REQUIRED',
        conditionRaw,
        complianceTimeRaw,
        actionTextRaw,
        nestedParagraphCount,
        conditionalClauseCount,
        sourceUnitIds: units.map((unit) => unit.sourceUnitId),
        sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
      };
    },
  );
  return {
    semanticState: 'CONTENT',
    obligationsStructured: true,
    unstructuredReason: null,
    obligations,
  };
}

export function buildSourceBoundAdDocumentRelations(
  section: SourceBoundSectionWindow,
): SourceBoundAdDocumentRelations | null {
  if (section.family !== 'AD') return null;
  const relationKind = adRelationKind(section);
  if (!relationKind) return null;
  if (section.semanticBodyState !== 'CONTENT') {
    return {
      semanticState: section.semanticBodyState,
      relationsStructured: true,
      relations: [],
    };
  }
  const indexedText = indexSourceText(section.bodyUnits);
  const relations =
    relationKind === 'AFFECTS' || relationKind === 'TERMINATES'
      ? parseAdRelations(indexedText, relationKind)
      : parseAdSupportRelations(indexedText, relationKind);
  if (section.nodeKind === 'action' && relations.length === 0) return null;
  return {
    semanticState: 'CONTENT',
    relationsStructured: relations.length > 0,
    relations,
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

function buildFaaAdSectionTopology(
  unitSet: SourceUnitSet,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet);
  let operativeStartIndex = -1;
  for (const [index, unit] of contentUnits.entries()) {
    if (
      unit.expectedSemantic === 'heading' &&
      normalizeLabel(unit.text) === FAA_AD_OPERATIVE_START
    ) {
      operativeStartIndex = index;
    }
  }
  if (
    operativeStartIndex < 0 ||
    !contentUnits
      .slice(0, operativeStartIndex + 1)
      .some(
        (unit) => normalizeLabel(unit.text) === 'federalaviationadministration',
      ) ||
    !contentUnits
      .slice(0, operativeStartIndex + 1)
      .some((unit) => normalizeLabel(unit.text) === '14cfrpart39')
  ) {
    return [];
  }
  const operativeIdentityCount = contentUnits
    .slice(operativeStartIndex + 1)
    .filter((unit) => isFaaAdOperativeIdentity(unit.text)).length;
  // A Federal Register final rule can amend Part 39 with multiple ADs. Until
  // each identity owns a separate bounded topology, never emit a partially
  // merged package that silently assigns AD2 actions to AD1.
  if (operativeIdentityCount !== 1) return [];
  const grammarByAlias = new Map<string, SectionGrammarEntry>();
  for (const entry of FAA_AD_SECTION_GRAMMAR) {
    for (const alias of entry.aliases) {
      grammarByAlias.set(normalizeLabel(alias), entry);
    }
  }
  const fixedCandidates = contentUnits.flatMap(
    (unit, index): SectionAnchorCandidate[] => {
      if (index <= operativeStartIndex || unit.expectedSemantic !== 'heading') {
        return [];
      }
      const heading = parseFaaAdHeading(unit.text);
      const grammar = grammarByAlias.get(normalizeLabel(heading.label));
      if (!grammar) return [];
      const ordinal =
        heading.ordinal ?? firstFollowingFaaOrdinal(contentUnits, index);
      return [
        {
          unit,
          index,
          sectionKey: grammar.sectionKey,
          matchedHeading: heading.label,
          nodeKind: 'section',
          scopeKey: FAA_AD_OPERATIVE_SCOPE,
          ...(ordinal ? { ordinal } : {}),
        },
      ];
    },
  );
  if (
    [...FAA_AD_CORE_SECTIONS].some(
      (sectionKey) =>
        !fixedCandidates.some(
          (candidate) => candidate.sectionKey === sectionKey,
        ),
    )
  ) {
    return [];
  }
  const complianceIndex = fixedCandidates.find(
    (candidate) => candidate.sectionKey === 'compliance',
  )?.index;
  const complianceOrdinal = fixedCandidates.find(
    (candidate) => candidate.sectionKey === 'compliance',
  )?.ordinal;
  const administrativeStartIndex = fixedCandidates
    .filter(
      (candidate) =>
        candidate.sectionKey === 'alternative_methods_of_compliance' ||
        candidate.sectionKey === 'related_information' ||
        candidate.sectionKey === 'material_incorporated_by_reference',
    )
    .reduce(
      (minimum, candidate) => Math.min(minimum, candidate.index),
      contentUnits.length,
    );
  const fixedIndexes = new Set(
    fixedCandidates.map((candidate) => candidate.index),
  );
  const actionCandidates = contentUnits.flatMap(
    (unit, index): SectionAnchorCandidate[] => {
      if (
        complianceIndex === undefined ||
        index <= complianceIndex ||
        index >= administrativeStartIndex ||
        unit.expectedSemantic !== 'heading' ||
        fixedIndexes.has(index) ||
        isFaaAdSubordinateHeading(unit.text)
      ) {
        return [];
      }
      const ordinal = firstFollowingFaaOrdinal(contentUnits, index);
      if (ordinal && complianceOrdinal && ordinal <= complianceOrdinal) {
        return [];
      }
      const matchedHeading = unit.text.normalize('NFKC').trim();
      return [
        {
          unit,
          index,
          sectionKey: toSectionKey(matchedHeading),
          matchedHeading,
          nodeKind: 'action',
          scopeKey: FAA_AD_OPERATIVE_SCOPE,
          ...(ordinal ? { ordinal } : {}),
        },
      ];
    },
  );
  const candidates = [...fixedCandidates, ...actionCandidates].sort(
    (left, right) => left.index - right.index,
  );
  return materializeSectionWindows(unitSet, contentUnits, candidates, 'AD');
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
          !isPageNumberAuxiliary(unit, refById, family),
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
      ...(anchor.ordinal ? { ordinal: anchor.ordinal } : {}),
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

interface IndexedSourceText {
  readonly text: string;
  readonly spans: readonly {
    readonly start: number;
    readonly end: number;
    readonly unit: SourceUnit;
  }[];
}

function parseFaaAdHeading(value: string): {
  label: string;
  ordinal: string | null;
} {
  const normalized = value.normalize('NFKC').trim();
  const match = normalized.match(/^\(([a-z])\)\s*(\S.*)$/iu);
  return match
    ? { label: match[2].trim(), ordinal: match[1].toLowerCase() }
    : { label: normalized, ordinal: null };
}

function firstFollowingFaaOrdinal(
  units: readonly SourceUnit[],
  headingIndex: number,
): string | null {
  const next = units[headingIndex + 1];
  if (!next || next.expectedSemantic === 'heading') return null;
  return (
    next.text
      .normalize('NFKC')
      .trim()
      .match(/^\(([a-z])\)(?:\(|\s|$)/iu)?.[1]
      ?.toLowerCase() ?? null
  );
}

function splitTopLevelNumberedParagraphs(units: readonly SourceUnit[]): {
  groups: Array<{ itemOrdinal: string; units: SourceUnit[] }>;
  leadingUnits: SourceUnit[];
} {
  const groups: Array<{ itemOrdinal: string; units: SourceUnit[] }> = [];
  const leadingUnits: SourceUnit[] = [];
  for (const unit of units) {
    const ordinal = unit.text
      .normalize('NFKC')
      .trim()
      .match(/^\((\d+)\)(?:\s|$)/u)?.[1];
    if (ordinal) {
      groups.push({ itemOrdinal: ordinal, units: [unit] });
      continue;
    }
    const current = groups.at(-1);
    if (current) current.units.push(unit);
    else leadingUnits.push(unit);
  }
  return { groups, leadingUnits };
}

function isFaaAdOperativeIdentity(value: string): boolean {
  return /^\s*\d{4}-\d{2}-\d{2}\s*[^:\n]{2,160}:\s*Amendment\s*39-\d+\b/iu.test(
    value.normalize('NFKC'),
  );
}

function isFaaAdSubordinateHeading(value: string): boolean {
  return /^(?:Note|Exception)\s+\d*\s*to\s+paragraph\b/iu.test(
    value.normalize('NFKC').trim(),
  );
}

function firstMatch(
  value: string,
  pattern: RegExp,
  group: number,
): string | null {
  return value.match(pattern)?.[group]?.replace(/\s+/gu, ' ').trim() ?? null;
}

function joinSourceText(units: readonly SourceUnit[]): string {
  return units.map((unit) => unit.text).join('\n');
}

function indexSourceText(units: readonly SourceUnit[]): IndexedSourceText {
  let text = '';
  const spans: Array<{ start: number; end: number; unit: SourceUnit }> = [];
  for (const unit of units) {
    if (text.length > 0) text += '\n';
    const start = text.length;
    text += unit.text;
    spans.push({ start, end: text.length, unit });
  }
  return { text, spans };
}

function adRelationKind(
  section: SourceBoundSectionWindow,
): SourceBoundAdRelationKind | null {
  if (
    section.nodeKind === 'action' ||
    section.sectionKey === 'required_actions'
  ) {
    return 'ACTION_BASIS';
  }
  const bySection = new Map<string, SourceBoundAdRelationKind>([
    ['affected_ads', 'AFFECTS'],
    ['terminating_action_for_affected_ads', 'TERMINATES'],
    ['applicability', 'APPLICABILITY_SCOPE'],
    ['material_incorporated_by_reference', 'INCORPORATED_BY_REFERENCE'],
  ]);
  return bySection.get(section.sectionKey) ?? null;
}

function parseAdRelations(
  indexed: IndexedSourceText,
  relationKind: 'AFFECTS' | 'TERMINATES',
): SourceBoundAdDocumentRelation[] {
  return mergeAdRelations(
    [
      ...indexed.text.matchAll(/\bAD\s+(\d{4}-\d{2}-\d{2}(?:\s+R\d+)?)\b/giu),
    ].map((match) =>
      sourcedAdRelation(indexed, match, {
        relationKind,
        targetDocumentKind: 'AIRWORTHINESS_DIRECTIVE',
        targetDocumentCode: `AD ${match[1]}`
          .replace(/\s+/gu, ' ')
          .toUpperCase(),
        targetRevision: null,
      }),
    ),
  );
}

function parseAdSupportRelations(
  indexed: IndexedSourceText,
  relationKind:
    | 'APPLICABILITY_SCOPE'
    | 'ACTION_BASIS'
    | 'INCORPORATED_BY_REFERENCE',
): SourceBoundAdDocumentRelation[] {
  const bulletinRelations = [
    ...indexed.text.matchAll(
      /\b(?:Boeing\s+)?(?:Alert\s+)?(?:Service|Requirements)\s+Bulletin\s+([A-Z0-9]+(?:-[A-Z0-9]+){1,})(?:\s+RB)?(?:,\s*Issue\s+(\d+))?/giu,
    ),
  ].map((match) =>
    sourcedAdRelation(indexed, match, {
      relationKind,
      targetDocumentKind: 'SERVICE_BULLETIN',
      targetDocumentCode: match[1].toUpperCase(),
      targetRevision: match[2] ? `ISSUE ${match[2]}` : null,
    }),
  );
  if (relationKind !== 'ACTION_BASIS') {
    return mergeAdRelations(bulletinRelations);
  }
  const amocRelations = [
    ...indexed.text.matchAll(/\bAMOC\s+Letter\s+([A-Z0-9-]+)\b/giu),
  ].map((match) =>
    sourcedAdRelation(indexed, match, {
      relationKind,
      targetDocumentKind: 'AMOC_LETTER',
      targetDocumentCode: match[1].toUpperCase(),
      targetRevision: null,
    }),
  );
  return mergeAdRelations([...bulletinRelations, ...amocRelations]);
}

function sourcedAdRelation(
  indexed: IndexedSourceText,
  match: RegExpMatchArray,
  relation: Omit<
    SourceBoundAdDocumentRelation,
    'sourceUnitIds' | 'sourceRefIds'
  >,
): SourceBoundAdDocumentRelation {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  const units = indexed.spans
    .filter((span) => span.end > start && span.start < end)
    .map((span) => span.unit);
  return {
    ...relation,
    sourceUnitIds: units.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
  };
}

function mergeAdRelations(
  values: readonly SourceBoundAdDocumentRelation[],
): SourceBoundAdDocumentRelation[] {
  const byIdentity = new Map<string, SourceBoundAdDocumentRelation>();
  for (const value of values) {
    const key = [
      value.relationKind,
      value.targetDocumentKind,
      value.targetDocumentCode,
      value.targetRevision ?? '',
    ].join(':');
    const previous = byIdentity.get(key);
    byIdentity.set(
      key,
      previous
        ? {
            ...previous,
            sourceUnitIds: unique([
              ...previous.sourceUnitIds,
              ...value.sourceUnitIds,
            ]),
            sourceRefIds: unique([
              ...previous.sourceRefIds,
              ...value.sourceRefIds,
            ]),
          }
        : value,
    );
  }
  return [...byIdentity.values()];
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
  family: SourceBoundSectionWindow['family'],
): boolean {
  if (!isBottomLocated(unit, refById)) return false;
  const match = unit.text
    .normalize('NFKC')
    .trim()
    .match(family === 'AD' ? /^(?:Page\s*)?(\d+)$/iu : /^Page\s*(\d+)$/iu);
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
