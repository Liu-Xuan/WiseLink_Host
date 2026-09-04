import type {
  PdfSourceRefValue,
  ProfessionalInputDocumentIdentityInput,
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';
import { airbusRilSemanticContentUnits } from './airbus-ril-structure.builder';

export type SemanticSectionBodyState = 'CONTENT' | 'NONE' | 'MISSING';

export interface SourceBoundSectionWindow {
  readonly family: 'FTD' | 'SB' | 'AD' | 'AEO' | 'SIL' | 'SL';
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

export type SourceBoundSlReferenceKind =
  | 'SERVICE_BULLETIN'
  | 'FLEET_TEAM_DIGEST'
  | 'SERVICE_RELATED_PROBLEM'
  | 'SERVICE_INFORMATION_LETTER'
  | 'AIRPLANE_CONFIGURATION_BULLETIN'
  | 'DRAWING'
  | 'OTHER';

export interface SourceBoundSlReferenceEntry {
  readonly referenceLabel: string;
  readonly referenceKind: SourceBoundSlReferenceKind;
  readonly targetDocumentCode: string | null;
  readonly rawText: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundSlReferenceCatalog {
  readonly semanticState: SemanticSectionBodyState;
  readonly referencesStructured: boolean;
  readonly unstructuredReason:
    | 'DUPLICATE_REFERENCE_LABEL'
    | 'ORPHAN_REFERENCE_CONTINUATION'
    | 'NO_REFERENCE_ENTRIES'
    | null;
  readonly entries: readonly SourceBoundSlReferenceEntry[];
}

export interface SourceBoundSlReferenceRelation {
  readonly referenceLabel: string;
  readonly referenceKind: SourceBoundSlReferenceKind;
  readonly targetDocumentCode: string | null;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundSlReferenceRelations {
  readonly relationsStructured: boolean;
  readonly unstructuredReason: 'UNRESOLVED_REFERENCE_LABEL' | null;
  readonly relations: readonly SourceBoundSlReferenceRelation[];
}

export interface SourceBoundSlAction {
  readonly actionRole:
    | 'BOEING_ACTION'
    | 'SUPPLIER_ACTION'
    | 'OPERATOR_RECOMMENDATION';
  readonly actionTextRaw: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundSilPartNumberRow {
  readonly rowName: string;
  readonly hardwarePartNumberRaw: string;
  readonly softwarePartNumberRaw: string;
  readonly mediaPartNumberRaw: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundSilPartNumberMatrix {
  readonly semanticState: SemanticSectionBodyState;
  readonly rowsStructured: boolean;
  readonly unstructuredReason:
    | 'TABLE_TITLE_OR_HEADER_UNRESOLVED'
    | 'TABLE_ROW_UNRESOLVED'
    | 'DUPLICATE_ROW_NAME'
    | null;
  readonly tableNumber: '1';
  readonly columns: readonly [
    'name',
    'hardware_part_number',
    'software_part_number',
    'media_part_number',
  ];
  readonly rows: readonly SourceBoundSilPartNumberRow[];
}

export interface SourceBoundSilDocumentReference {
  readonly relationKind: 'ASSOCIATED_PUBLICATION';
  readonly issuerAuthority: 'BOEING';
  readonly targetDocumentKind: 'SERVICE_LETTER' | 'SERVICE_BULLETIN';
  readonly targetDocumentCode: string;
  readonly titleRaw: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundSilDocumentReferences {
  readonly semanticState: SemanticSectionBodyState;
  readonly referencesStructured: boolean;
  readonly unstructuredReason:
    | 'NO_REFERENCE_ENTRIES'
    | 'REFERENCE_ENTRY_UNRESOLVED'
    | 'DUPLICATE_REFERENCE'
    | null;
  readonly subsequentRevisionsAcceptableByDefault: boolean;
  readonly references: readonly SourceBoundSilDocumentReference[];
}

export interface SourceBoundSilRecommendationSectionStatus {
  readonly semanticState: 'SOURCE_ABSENT';
  readonly reason: 'COMPLETE_A_TO_H_PUBLICATION_HAS_NO_RECOMMENDATION_SECTION';
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
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
  readonly bodyStartsAtAnchor?: boolean;
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
const BOEING_SL_SECTION_GRAMMAR: readonly SectionGrammarEntry[] = [
  { sectionKey: 'subject', aliases: ['subject'] },
  { sectionKey: 'model', aliases: ['model'] },
  { sectionKey: 'minor_models', aliases: ['minor models'] },
  { sectionKey: 'applicability', aliases: ['applicability'] },
  { sectionKey: 'references', aliases: ['references'] },
  {
    sectionKey: 'export_compliance_statement',
    aliases: ['export compliance statement'],
  },
  { sectionKey: 'summary', aliases: ['summary'] },
  { sectionKey: 'background', aliases: ['background'] },
  { sectionKey: 'discussion', aliases: ['discussion'] },
  { sectionKey: 'boeing_action', aliases: ['boeing action'] },
  { sectionKey: 'supplier_action', aliases: ['supplier action'] },
  {
    sectionKey: 'suggested_operator_action',
    aliases: ['suggested operator action'],
  },
  { sectionKey: 'estimated_labor_hours', aliases: ['estimated labor hours'] },
  {
    sectionKey: 'industry_support_information',
    aliases: ['industry support information'],
  },
  { sectionKey: 'warranty_information', aliases: ['warranty information'] },
  { sectionKey: 'interchangeability', aliases: ['interchangeability'] },
  { sectionKey: 'parts_availability', aliases: ['parts availability'] },
  {
    sectionKey: 'cmc_eicas_messages',
    aliases: ['cmc/eicas message(s)', 'cmc/eicas message'],
  },
  { sectionKey: 'supplier_information', aliases: ['supplier information'] },
  { sectionKey: 'attachment_boundary', aliases: ['attachment'] },
] as const;
const BOEING_SL_CORE_SECTION_ORDER = [
  'subject',
  'applicability',
  'references',
  'background',
  'boeing_action',
  'suggested_operator_action',
] as const;
const BOEING_SL_TERMINAL_SECTION_KEYS = new Set([
  'estimated_labor_hours',
  'industry_support_information',
  'warranty_information',
  'interchangeability',
  'parts_availability',
  'cmc_eicas_messages',
  'attachment_boundary',
]);
const BOEING_SL_EMITTED_SECTION_KEYS = new Set([
  ...BOEING_SL_CORE_SECTION_ORDER,
  'supplier_action',
]);
const HONEYWELL_SIL_SECTION_KEYS = [
  'subject',
  'effectivity',
  'reason',
  'references',
  'summary',
  'contact_information',
  'summary_of_change',
  'revision_history',
] as const;
const HONEYWELL_SIL_SECTION_BY_LETTER = new Map<
  string,
  {
    readonly sectionKey: (typeof HONEYWELL_SIL_SECTION_KEYS)[number];
    readonly title: string;
  }
>([
  ['A', { sectionKey: 'subject', title: 'subject' }],
  ['B', { sectionKey: 'effectivity', title: 'effectivity' }],
  ['C', { sectionKey: 'reason', title: 'reason' }],
  ['D', { sectionKey: 'references', title: 'references' }],
  ['E', { sectionKey: 'summary', title: 'summary' }],
  ['F', { sectionKey: 'contact_information', title: 'contact information' }],
  ['G', { sectionKey: 'summary_of_change', title: 'summary of change' }],
  ['H', { sectionKey: 'revision_history', title: 'revision history' }],
]);
const HONEYWELL_SIL_PART_NUMBER_COLUMNS = [
  'name',
  'hardware_part_number',
  'software_part_number',
  'media_part_number',
] as const;
const AIRBUS_RIL_SECTIONS = [
  {
    ordinal: '1',
    sectionKey: 'general_evaluation',
    title: 'general evaluation',
  },
  {
    ordinal: '2',
    sectionKey: 'document_references',
    title: 'document references',
  },
  { ordinal: '3', sectionKey: 'context', title: 'context' },
  {
    ordinal: '4',
    sectionKey: 'retrofit_procedure',
    title: 'retrofit procedure',
  },
  { ordinal: '5', sectionKey: 'material', title: 'material' },
  { ordinal: '5.1', sectionKey: 'availability', title: 'availability' },
  { ordinal: '5.2', sectionKey: 'list_of_material', title: 'list of material' },
  { ordinal: '5.3', sectionKey: 'ordering', title: 'ordering' },
  { ordinal: '6', sectionKey: 'industry_support', title: 'industry support' },
  { ordinal: '7', sectionKey: 'reporting', title: 'reporting' },
] as const;

export function buildFamilySectionTopology(input: {
  readonly unitSet: SourceUnitSet;
  readonly document: ProfessionalInputDocumentIdentityInput;
}): readonly SourceBoundSectionWindow[] {
  if (input.document.documentType === 'engineering_order') {
    return buildAmecoAeoSectionTopology(input.unitSet, input.document);
  }
  if (input.document.documentType === 'operator_transmission') {
    return buildAirbusOperatorTransmissionSectionTopology(input.unitSet);
  }
  if (input.document.documentType === 'retrofit_information_letter') {
    return buildAirbusRilSectionTopology(input.unitSet, input.document);
  }
  if (input.document.documentType === 'fleet_team_digest') {
    return buildFtdSectionTopology(input.unitSet);
  }
  if (input.document.documentType === 'service_bulletin') {
    return buildAirbusSbSectionTopology(input.unitSet);
  }
  if (input.document.documentType === 'airworthiness_directive') {
    return buildFaaAdSectionTopology(input.unitSet);
  }
  if (input.document.documentType === 'service_letter') {
    return buildBoeingSlSectionTopology(input.unitSet, input.document);
  }
  if (input.document.documentType === 'service_information_letter') {
    return buildHoneywellSilSectionTopology(input.unitSet, input.document);
  }
  return [];
}

function buildAirbusOperatorTransmissionSectionTopology(
  unitSet: SourceUnitSet,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet).filter(
    (unit) => !isAirbusOperatorTransmissionFurniture(unit.text),
  );
  const normalized = contentUnits.map((unit) => normalizeLabel(unit.text));
  const oitBannerCount = normalized.filter(
    (value) => value === 'operatorsinformationtransmissionoit',
  ).length;
  const fotBannerCount = normalized.filter(
    (value) => value === 'flightoperationstransmissionfot',
  ).length;
  const sbitCategoryCount = normalized.filter(
    (value) =>
      value ===
      'oitcategoryservicebulletininformationtransmissionsbit',
  ).length;
  const adviceCategoryCount = normalized.filter(
    (value) => value === 'oitcategoryadvice',
  ).length;
  const subtype =
    oitBannerCount === 1 &&
    sbitCategoryCount === 1 &&
    fotBannerCount === 0
      ? 'SBIT'
      : oitBannerCount === 1 &&
          adviceCategoryCount === 1 &&
          sbitCategoryCount === 0 &&
          fotBannerCount === 0
        ? 'OIT'
        : fotBannerCount === 1 &&
            oitBannerCount === 0 &&
            sbitCategoryCount === 0
          ? 'FOT'
          : null;
  if (!subtype) return [];
  const definitions =
    subtype === 'OIT'
      ? [
          ['1', 'purpose', '1purpose'],
          ['2', 'background', '2background'],
          ['3', 'description', '3description'],
          ['4', 'follow_up', '4followup'],
          ['5', 'contacts', '5contacts'],
        ]
      : subtype === 'FOT'
        ? [
            ['1', 'purpose', '1purpose'],
            ['2', 'description', '2description'],
            ['3', 'recommendations', '3recommendations'],
            ['4', 'follow_up_plan', '4followupplan'],
          ]
        : [
            ['0', 'reason_for_revision', '0reasonforrevision'],
            ['1', 'purpose', '1purpose'],
            ['2', 'background', '2background'],
            ['3', 'recommendation', '3recommendation'],
            ['4', 'follow_up', '4followup'],
            ['5', 'contacts', '5contacts'],
          ];
  const candidates = definitions.flatMap(
    ([ordinal, sectionKey, normalizedHeading]) => {
      const indexes = contentUnits.flatMap((unit, index) =>
        normalizeLabel(unit.text) === normalizedHeading ? [index] : [],
      );
      return indexes.length === 1
        ? [
            {
              unit: contentUnits[indexes[0]],
              index: indexes[0],
              sectionKey,
              matchedHeading: contentUnits[indexes[0]].text.trim(),
              nodeKind: 'section' as const,
              scopeKey: 'operator_transmission',
              ordinal,
            },
          ]
        : [];
    },
  );
  if (
    candidates.length !== definitions.length ||
    candidates.some(
      (candidate, index) =>
        index > 0 && candidate.index <= candidates[index - 1].index,
    )
  ) {
    return [];
  }
  return materializeSectionWindows(unitSet, contentUnits, candidates, 'SB');
}

function isAirbusOperatorTransmissionFurniture(value: string): boolean {
  const text = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return (
    /^(?:OIT|FOT)\s+ref\s*:.+Rev\s+\d+\s*Page\s+\d+\s+of\s+\d+\s*Date\s*:/iu.test(
      text,
    ) ||
    /^©\s*AIRBUS\s+S\.A\.S\./iu.test(text) ||
    /^TELEPHONE\s*\+\s*33\s*\(0\)5\s+61\s+93\s+33\s+33(?:Airbus)?$/iu.test(
      text,
    )
  );
}

function buildAmecoAeoSectionTopology(
  unitSet: SourceUnitSet,
  document: ProfessionalInputDocumentIdentityInput,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet);
  const normalizedDocumentCode = document.documentCode
    .normalize('NFKC')
    .toUpperCase();
  const firstSectionIndexes = contentUnits.flatMap((unit, index) =>
    /^(?:工程指令第一部分|engineeringordersection1)$/u.test(
      normalizeLabel(unit.text),
    )
      ? [index]
      : [],
  );
  const secondSectionIndexes = contentUnits.flatMap((unit, index) =>
    /^(?:工程指令第二部分|engineeringordersection2)$/u.test(
      normalizeLabel(unit.text),
    )
      ? [index]
      : [],
  );
  const safetyIndexes = contentUnits.flatMap((unit, index) =>
    normalizeLabel(unit.text) === '安全检查单配发信息页' ? [index] : [],
  );
  const documentCodePattern = new RegExp(
    `^${escapeRegularExpression(normalizedDocumentCode)}-R\\d{2,3}$`,
    'u',
  );
  const documentCodeUnits = contentUnits.filter((unit) =>
    documentCodePattern.test(unit.text.normalize('NFKC').trim().toUpperCase()),
  );
  const footerUnits = contentUnits.filter((unit) => {
    const text = unit.text.normalize('NFKC').replace(/\s+/gu, '');
    return (
      /^CCA-ED-021CCA-ED-021SECTION1SECTION1PageNo:\d+of\d+Page\d+of\d+$/u.test(
        text,
      ) || /^CCA-ED-021SECTION2PageNo:\d+of\d+$/u.test(text)
    );
  });
  const refById = new Map(
    unitSet.sourceRefs.map((sourceRef) => [sourceRef.sourceRefId, sourceRef]),
  );
  const pageCount = Math.max(
    0,
    ...unitSet.sourceRefs.map((sourceRef) => sourceRef.pageEnd),
  );
  const footerPages = new Set(
    footerUnits.map((unit) => pageForUnit(unit, refById)),
  );
  if (
    firstSectionIndexes.length !== 2 ||
    secondSectionIndexes.length !== 2 ||
    safetyIndexes.length !== 1 ||
    documentCodeUnits.length !== 1 ||
    pageCount < 3 ||
    footerUnits.length !== pageCount ||
    footerPages.size !== pageCount
  ) {
    return [];
  }
  const firstIndex = Math.min(...firstSectionIndexes);
  const secondIndex = Math.min(...secondSectionIndexes);
  const safetyIndex = safetyIndexes[0];
  if (!(firstIndex < secondIndex && secondIndex < safetyIndex)) return [];
  const firstPage = pageForUnit(contentUnits[firstIndex], refById);
  const secondPage = pageForUnit(contentUnits[secondIndex], refById);
  const safetyPage = pageForUnit(contentUnits[safetyIndex], refById);
  const candidates: SectionAnchorCandidate[] = [
    {
      unit: contentUnits[firstIndex],
      index: firstIndex,
      sectionKey: 'engineering_basis',
      matchedHeading: contentUnits[firstIndex].text.trim(),
      nodeKind: 'section',
      scopeKey: 'engineering_order',
      ordinal: '1',
      bodyStartsAtAnchor: true,
    },
    {
      unit: contentUnits[secondIndex],
      index: secondIndex,
      sectionKey: 'accomplishment_instructions',
      matchedHeading: contentUnits[secondIndex].text.trim(),
      nodeKind: 'section',
      scopeKey: 'engineering_order',
      ordinal: '2',
      bodyStartsAtAnchor: true,
    },
    {
      unit: contentUnits[safetyIndex],
      index: safetyIndex,
      sectionKey: 'safety_checklist',
      matchedHeading: contentUnits[safetyIndex].text.trim(),
      nodeKind: 'section',
      scopeKey: 'engineering_order',
      ordinal: '2.safety',
      bodyStartsAtAnchor: true,
    },
  ];
  const windows = materializeSectionWindows(
    unitSet,
    contentUnits,
    candidates,
    'AEO',
  );
  return windows.length === 3 &&
    firstPage === 1 &&
    secondPage > firstPage &&
    safetyPage > secondPage &&
    safetyPage === pageCount &&
    windows[0].pageStart === firstPage &&
    windows[0].pageEnd === secondPage - 1 &&
    windows[1].pageStart === secondPage &&
    windows[1].pageEnd === safetyPage - 1 &&
    windows[2].pageStart === safetyPage &&
    windows[2].pageEnd === pageCount
    ? windows
    : [];
}

function buildAirbusRilSectionTopology(
  unitSet: SourceUnitSet,
  document: ProfessionalInputDocumentIdentityInput,
): readonly SourceBoundSectionWindow[] {
  const rawContentUnits = orderedContentUnits(unitSet);
  const contentUnits = airbusRilSemanticContentUnits(unitSet);
  const rilMastheadProven = rawContentUnits.some(
    (unit) => normalizeLabel(unit.text) === 'retrofitinformationletterril',
  );
  const airbusProven = rawContentUnits.some((unit) =>
    /^airbus/u.test(normalizeLabel(unit.text)),
  );
  const documentCodeProven = rawContentUnits.some((unit) => {
    const text = unit.text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    return new RegExp(
      `^RIL Reference:\\s*${escapeRegularExpression(document.documentCode)}(?:\\s|$)`,
      'iu',
    ).test(text);
  });
  if (!rilMastheadProven || !airbusProven || !documentCodeProven) return [];

  const candidates = contentUnits.flatMap(
    (unit, index): SectionAnchorCandidate[] => {
      if (unit.expectedSemantic !== 'heading') return [];
      const match = unit.text
        .normalize('NFKC')
        .trim()
        .match(/^([1-7])\.(?:(\d)\.?)?(\S.*)$/u);
      if (!match) return [];
      const ordinal = match[2] ? `${match[1]}.${match[2]}` : match[1];
      const definition = AIRBUS_RIL_SECTIONS.find(
        (section) => section.ordinal === ordinal,
      );
      if (
        !definition ||
        normalizeLabel(match[3]) !== normalizeLabel(definition.title)
      ) {
        return [];
      }
      return [
        {
          unit,
          index,
          sectionKey: definition.sectionKey,
          matchedHeading: unit.text.trim(),
          nodeKind: match[2] ? 'section' : 'register',
          scopeKey: match[2] ? 'material' : 'retrofit_information_letter',
          ordinal,
        },
      ];
    },
  );
  if (
    candidates.length !== AIRBUS_RIL_SECTIONS.length ||
    candidates.some((candidate, index) => {
      const expected = AIRBUS_RIL_SECTIONS[index];
      return (
        candidate.ordinal !== expected.ordinal ||
        candidate.sectionKey !== expected.sectionKey
      );
    })
  ) {
    return [];
  }
  const windows = materializeSectionWindows(
    unitSet,
    contentUnits,
    candidates,
    'SB',
  );
  return windows.some((window) => window.semanticBodyState !== 'CONTENT')
    ? []
    : windows;
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

export function buildSourceBoundSlReferenceCatalog(
  sections: readonly SourceBoundSectionWindow[],
): SourceBoundSlReferenceCatalog | null {
  const referenceSections = sections.filter(
    (section) => section.family === 'SL' && section.sectionKey === 'references',
  );
  if (referenceSections.length !== 1) return null;
  const section = referenceSections[0];
  if (section.semanticBodyState !== 'CONTENT') {
    return {
      semanticState: section.semanticBodyState,
      referencesStructured: true,
      unstructuredReason: null,
      entries: [],
    };
  }
  const parsed = parseBoeingSlReferenceEntries(section.bodyUnits);
  if (parsed.orphanContinuation) {
    return {
      semanticState: 'CONTENT',
      referencesStructured: false,
      unstructuredReason: 'ORPHAN_REFERENCE_CONTINUATION',
      entries: [],
    };
  }
  if (parsed.entries.length === 0) {
    return {
      semanticState: 'CONTENT',
      referencesStructured: false,
      unstructuredReason: 'NO_REFERENCE_ENTRIES',
      entries: [],
    };
  }
  const labels = parsed.entries.map((entry) => entry.referenceLabel);
  if (new Set(labels).size !== labels.length) {
    return {
      semanticState: 'CONTENT',
      referencesStructured: false,
      unstructuredReason: 'DUPLICATE_REFERENCE_LABEL',
      entries: [],
    };
  }
  return {
    semanticState: 'CONTENT',
    referencesStructured: true,
    unstructuredReason: null,
    entries: parsed.entries,
  };
}

export function buildSourceBoundSlReferenceRelations(
  section: SourceBoundSectionWindow,
  catalog: SourceBoundSlReferenceCatalog | null,
): SourceBoundSlReferenceRelations | null {
  if (
    section.family !== 'SL' ||
    ![
      'background',
      'discussion',
      'boeing_action',
      'supplier_action',
      'suggested_operator_action',
    ].includes(section.sectionKey) ||
    section.semanticBodyState !== 'CONTENT'
  ) {
    return null;
  }
  const citations = parseBoeingSlReferenceCitations(section.bodyUnits);
  if (citations.length === 0) return null;
  if (!catalog?.referencesStructured) {
    return {
      relationsStructured: false,
      unstructuredReason: 'UNRESOLVED_REFERENCE_LABEL',
      relations: [],
    };
  }
  const entryByLabel = new Map(
    catalog.entries.map((entry) => [entry.referenceLabel, entry]),
  );
  if (citations.some((citation) => !entryByLabel.has(citation.label))) {
    return {
      relationsStructured: false,
      unstructuredReason: 'UNRESOLVED_REFERENCE_LABEL',
      relations: [],
    };
  }
  const byLabel = new Map<string, SourceBoundSlReferenceRelation>();
  for (const citation of citations) {
    const entry = entryByLabel.get(
      citation.label,
    ) as SourceBoundSlReferenceEntry;
    const previous = byLabel.get(citation.label);
    byLabel.set(citation.label, {
      referenceLabel: citation.label,
      referenceKind: entry.referenceKind,
      targetDocumentCode: entry.targetDocumentCode,
      sourceUnitIds: unique([
        ...(previous?.sourceUnitIds ?? []),
        ...citation.sourceUnitIds,
      ]),
      sourceRefIds: unique([
        ...(previous?.sourceRefIds ?? []),
        ...citation.sourceRefIds,
      ]),
    });
  }
  return {
    relationsStructured: true,
    unstructuredReason: null,
    relations: [...byLabel.values()],
  };
}

export function buildSourceBoundSlAction(
  section: SourceBoundSectionWindow,
): SourceBoundSlAction | null {
  if (section.family !== 'SL' || section.semanticBodyState !== 'CONTENT') {
    return null;
  }
  const roles = new Map<string, SourceBoundSlAction['actionRole']>([
    ['boeing_action', 'BOEING_ACTION'],
    ['supplier_action', 'SUPPLIER_ACTION'],
    ['suggested_operator_action', 'OPERATOR_RECOMMENDATION'],
  ]);
  const actionRole = roles.get(section.sectionKey);
  if (!actionRole) return null;
  return {
    actionRole,
    actionTextRaw: joinSourceText(section.bodyUnits),
    sourceUnitIds: section.bodyUnits.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(
      section.bodyUnits.flatMap((unit) => unit.sourceRefIds),
    ),
  };
}

export function buildSourceBoundSilPartNumberMatrix(
  section: SourceBoundSectionWindow,
): SourceBoundSilPartNumberMatrix | null {
  if (section.family !== 'SIL' || section.sectionKey !== 'reason') {
    return null;
  }
  const empty = (
    reason: SourceBoundSilPartNumberMatrix['unstructuredReason'],
  ): SourceBoundSilPartNumberMatrix => ({
    semanticState: section.semanticBodyState,
    rowsStructured: false,
    unstructuredReason: reason,
    tableNumber: '1',
    columns: HONEYWELL_SIL_PART_NUMBER_COLUMNS,
    rows: [],
  });
  if (section.semanticBodyState !== 'CONTENT') {
    return {
      semanticState: section.semanticBodyState,
      rowsStructured: true,
      unstructuredReason: null,
      tableNumber: '1',
      columns: HONEYWELL_SIL_PART_NUMBER_COLUMNS,
      rows: [],
    };
  }

  const titleIndexes = section.bodyUnits.flatMap((unit, index) =>
    /^Table\s+1\.\s*Matrix\s+of\s+Part\s+Numbers(?:\s*\(Cont\))?$/iu.test(
      unit.text.normalize('NFKC').trim(),
    )
      ? [index]
      : [],
  );
  const headerIndexes = section.bodyUnits.flatMap((unit, index) =>
    normalizeLabel(unit.text) ===
    'namehardwarepartnumbersoftwarepartnumbermediapartnumber'
      ? [index]
      : [],
  );
  if (
    titleIndexes.length === 0 ||
    titleIndexes.length !== headerIndexes.length ||
    titleIndexes.some(
      (titleIndex, index) => titleIndex + 1 !== headerIndexes[index],
    ) ||
    !/^Table\s+1\.\s*Matrix\s+of\s+Part\s+Numbers$/iu.test(
      section.bodyUnits[titleIndexes[0]]?.text.normalize('NFKC').trim() ?? '',
    ) ||
    titleIndexes
      .slice(1)
      .some(
        (titleIndex) =>
          !/^Table\s+1\.\s*Matrix\s+of\s+Part\s+Numbers\s*\(Cont\)$/iu.test(
            section.bodyUnits[titleIndex]?.text.normalize('NFKC').trim() ?? '',
          ),
      )
  ) {
    return empty('TABLE_TITLE_OR_HEADER_UNRESOLVED');
  }

  const rows: SourceBoundSilPartNumberRow[] = [];
  for (const [headerPosition, headerIndex] of headerIndexes.entries()) {
    const segmentEnd =
      titleIndexes[headerPosition + 1] ?? section.bodyUnits.length;
    for (const unit of section.bodyUnits.slice(headerIndex + 1, segmentEnd)) {
      if (
        unit.expectedSemantic === 'heading' ||
        isHoneywellSilTableFurniture(unit.text)
      ) {
        continue;
      }
      const row = parseHoneywellSilPartNumberRow(unit);
      if (!row) return empty('TABLE_ROW_UNRESOLVED');
      rows.push(row);
    }
  }
  if (rows.length === 0) return empty('TABLE_ROW_UNRESOLVED');
  const rowNames = rows.map((row) => normalizeLabel(row.rowName));
  if (new Set(rowNames).size !== rowNames.length) {
    return empty('DUPLICATE_ROW_NAME');
  }
  return {
    semanticState: 'CONTENT',
    rowsStructured: true,
    unstructuredReason: null,
    tableNumber: '1',
    columns: HONEYWELL_SIL_PART_NUMBER_COLUMNS,
    rows,
  };
}

export function buildSourceBoundSilDocumentReferences(
  section: SourceBoundSectionWindow,
): SourceBoundSilDocumentReferences | null {
  if (section.family !== 'SIL' || section.sectionKey !== 'references') {
    return null;
  }
  const base = {
    semanticState: section.semanticBodyState,
    subsequentRevisionsAcceptableByDefault: section.bodyUnits.some((unit) =>
      /\bUnless\s+specified\s+differently,\s+you\s+can\s+use\s+subsequent\s+revisions\b/iu.test(
        unit.text.normalize('NFKC'),
      ),
    ),
  };
  if (section.semanticBodyState !== 'CONTENT') {
    return {
      ...base,
      referencesStructured: true,
      unstructuredReason: null,
      references: [],
    };
  }
  const blocks: SourceUnit[][] = [];
  for (const unit of section.bodyUnits) {
    if (/^[•●▪]\s*\S/iu.test(unit.text.normalize('NFKC').trim())) {
      blocks.push([unit]);
    } else if (blocks.length > 0) {
      blocks.at(-1)?.push(unit);
    }
  }
  if (blocks.length === 0) {
    return {
      ...base,
      referencesStructured: false,
      unstructuredReason: 'NO_REFERENCE_ENTRIES',
      references: [],
    };
  }
  const references = blocks.map(parseHoneywellSilDocumentReference);
  if (references.some((reference) => reference === null)) {
    return {
      ...base,
      referencesStructured: false,
      unstructuredReason: 'REFERENCE_ENTRY_UNRESOLVED',
      references: [],
    };
  }
  const resolved = references as SourceBoundSilDocumentReference[];
  const identities = resolved.map(
    (reference) =>
      `${reference.targetDocumentKind}:${reference.targetDocumentCode}`,
  );
  if (new Set(identities).size !== identities.length) {
    return {
      ...base,
      referencesStructured: false,
      unstructuredReason: 'DUPLICATE_REFERENCE',
      references: [],
    };
  }
  return {
    ...base,
    referencesStructured: true,
    unstructuredReason: null,
    references: resolved,
  };
}

export function buildSourceBoundSilRecommendationSectionStatus(
  sections: readonly SourceBoundSectionWindow[],
): SourceBoundSilRecommendationSectionStatus | null {
  if (
    sections.length !== HONEYWELL_SIL_SECTION_KEYS.length ||
    sections.some(
      (section, index) =>
        section.family !== 'SIL' ||
        section.sectionKey !== HONEYWELL_SIL_SECTION_KEYS[index],
    )
  ) {
    return null;
  }
  return {
    semanticState: 'SOURCE_ABSENT',
    reason: 'COMPLETE_A_TO_H_PUBLICATION_HAS_NO_RECOMMENDATION_SECTION',
    sourceUnitIds: sections.map((section) => section.headingUnit.sourceUnitId),
    sourceRefIds: unique(
      sections.flatMap((section) => section.headingUnit.sourceRefIds),
    ),
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

function buildBoeingSlSectionTopology(
  unitSet: SourceUnitSet,
  document: ProfessionalInputDocumentIdentityInput,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet);
  const serviceLetterProven = contentUnits.some((unit) =>
    /^(?:bcacustomersupport|customer)serviceletter$/u.test(
      normalizeLabel(unit.text),
    ),
  );
  const documentCodeProven = contentUnits.some(
    (unit) =>
      normalizeLabel(unit.text) === normalizeLabel(document.documentCode),
  );
  if (!serviceLetterProven || !documentCodeProven) return [];

  const grammarByAlias = new Map<string, SectionGrammarEntry>();
  for (const entry of BOEING_SL_SECTION_GRAMMAR) {
    for (const alias of entry.aliases) {
      grammarByAlias.set(normalizeLabel(alias), entry);
    }
  }
  const attachmentBoundaryIndex = contentUnits.findIndex((unit) =>
    /^ATTACHMENT\s*:/iu.test(unit.text.normalize('NFKC').trim()),
  );
  const candidates = contentUnits.flatMap(
    (unit, index): SectionAnchorCandidate[] => {
      if (attachmentBoundaryIndex >= 0 && index > attachmentBoundaryIndex) {
        return [];
      }
      const parsed = parseBoeingSlSectionAnchor(unit.text, grammarByAlias);
      if (!parsed) return [];
      return [
        {
          unit,
          index,
          sectionKey: parsed.grammar.sectionKey,
          matchedHeading: parsed.matchedHeading,
          nodeKind: 'section',
          scopeKey: 'service_letter',
          ...(parsed.hasInlineBody ? { bodyStartsAtAnchor: true } : {}),
        },
      ];
    },
  );
  const candidatesByKey = new Map<string, SectionAnchorCandidate[]>();
  for (const candidate of candidates) {
    const values = candidatesByKey.get(candidate.sectionKey) ?? [];
    values.push(candidate);
    candidatesByKey.set(candidate.sectionKey, values);
  }
  if (
    BOEING_SL_CORE_SECTION_ORDER.some(
      (sectionKey) => candidatesByKey.get(sectionKey)?.length !== 1,
    ) ||
    [...candidatesByKey.values()].some((values) => values.length > 1)
  ) {
    return [];
  }
  const coreIndexes = BOEING_SL_CORE_SECTION_ORDER.map(
    (sectionKey) =>
      (candidatesByKey.get(sectionKey) as [SectionAnchorCandidate])[0].index,
  );
  if (
    coreIndexes.some(
      (index, position) => position > 0 && index <= coreIndexes[position - 1],
    )
  ) {
    return [];
  }
  const supplierAction = candidatesByKey.get('supplier_action')?.[0];
  if (
    supplierAction &&
    (supplierAction.index <= coreIndexes[4] ||
      supplierAction.index >= coreIndexes[5])
  ) {
    return [];
  }
  const suggestedOperatorActionIndex = coreIndexes[5];
  if (
    !candidates.some(
      (candidate) =>
        candidate.index > suggestedOperatorActionIndex &&
        BOEING_SL_TERMINAL_SECTION_KEYS.has(candidate.sectionKey),
    )
  ) {
    return [];
  }
  const windows = materializeSectionWindows(
    unitSet,
    contentUnits,
    candidates.sort((left, right) => left.index - right.index),
    'SL',
  );
  if (
    BOEING_SL_CORE_SECTION_ORDER.some(
      (sectionKey) =>
        windows.find((window) => window.sectionKey === sectionKey)
          ?.semanticBodyState !== 'CONTENT',
    )
  ) {
    return [];
  }
  return windows.filter((window) =>
    BOEING_SL_EMITTED_SECTION_KEYS.has(window.sectionKey),
  );
}

function buildHoneywellSilSectionTopology(
  unitSet: SourceUnitSet,
  document: ProfessionalInputDocumentIdentityInput,
): readonly SourceBoundSectionWindow[] {
  const contentUnits = orderedContentUnits(unitSet);
  const honeywellProven = contentUnits.some((unit) =>
    /^honeywellinternationalinc/u.test(normalizeLabel(unit.text)),
  );
  const serviceInformationLetterProven = contentUnits.some(
    (unit) => normalizeLabel(unit.text) === 'serviceinformationletter',
  );
  const documentCodeProven = contentUnits.some(
    (unit) =>
      normalizeLabel(unit.text) ===
      `publicationnumber${normalizeLabel(document.documentCode)}`,
  );
  if (
    !honeywellProven ||
    !serviceInformationLetterProven ||
    !documentCodeProven
  ) {
    return [];
  }

  const candidates = contentUnits.flatMap(
    (unit, index): SectionAnchorCandidate[] => {
      if (unit.expectedSemantic !== 'heading') return [];
      const text = unit.text.normalize('NFKC').trim();
      const match = text.match(/^([A-H])\s*\.\s*(\S.*)$/u);
      if (!match) return [];
      const definition = HONEYWELL_SIL_SECTION_BY_LETTER.get(match[1]);
      if (
        !definition ||
        normalizeLabel(match[2]) !== normalizeLabel(definition.title)
      ) {
        return [];
      }
      return [
        {
          unit,
          index,
          sectionKey: definition.sectionKey,
          matchedHeading: text,
          nodeKind: 'section',
          scopeKey: 'service_information_letter',
          ordinal: match[1],
        },
      ];
    },
  );
  if (
    candidates.length !== HONEYWELL_SIL_SECTION_KEYS.length ||
    candidates.some(
      (candidate, index) =>
        candidate.sectionKey !== HONEYWELL_SIL_SECTION_KEYS[index],
    )
  ) {
    return [];
  }

  const exportControl = contentUnits.findIndex(
    (unit) =>
      unit.expectedSemantic === 'heading' &&
      normalizeLabel(unit.text) === 'exportcontrol',
  );
  const boundedCandidates: SectionAnchorCandidate[] = [...candidates];
  if (exportControl > candidates.at(-1)!.index) {
    const unit = contentUnits[exportControl];
    boundedCandidates.push({
      unit,
      index: exportControl,
      sectionKey: 'export_control_boundary',
      matchedHeading: unit.text,
      nodeKind: 'section',
      scopeKey: 'service_information_letter',
    });
  }
  const windows = materializeSectionWindows(
    unitSet,
    contentUnits,
    boundedCandidates,
    'SIL',
  ).filter((window) => window.sectionKey !== 'export_control_boundary');
  if (windows.some((window) => window.semanticBodyState !== 'CONTENT')) {
    return [];
  }
  return windows;
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
      .slice(
        anchor.bodyStartsAtAnchor ? anchor.index : anchor.index + 1,
        nextIndex,
      )
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

function parseHoneywellSilPartNumberRow(
  unit: SourceUnit,
): SourceBoundSilPartNumberRow | null {
  const match = unit.text
    .normalize('NFKC')
    .trim()
    .match(/^(.+?)\s*PN\s+(.+?)\s*PN\s+(.+?)\s*PN\s+(.+)$/iu);
  if (!match) return null;
  const values = match
    .slice(1)
    .map((value) => value.replace(/\s+/gu, ' ').trim());
  if (values.some((value) => value.length === 0)) return null;
  return {
    rowName: values[0],
    hardwarePartNumberRaw: values[1],
    softwarePartNumberRaw: values[2],
    mediaPartNumberRaw: values[3],
    sourceUnitIds: [unit.sourceUnitId],
    sourceRefIds: [...unit.sourceRefIds],
  };
}

function isHoneywellSilTableFurniture(value: string): boolean {
  const text = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return (
    /^\d{1,2}\s+[A-Z][a-z]+\s+\d{4}$/u.test(text) ||
    /^Revision\s+\d+\s*,\s*\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\s*Page\s+\d+(?:\s+of\s+\d+)?$/u.test(
      text,
    ) ||
    /^Publication\s+Number\s+D\d+$/iu.test(text) ||
    /^©\s*Honeywell\s+International\s+Inc\./iu.test(text) ||
    /^This\s+document\s+is\s+governed\s+by\s+the\s+terms\s+of\s+the\s+current\s+Honeywell\s+Confidential\s+Notice/iu.test(
      text,
    ) ||
    /^by\s+logging\s+into\s+https:\/\/aerospace\.honeywell\.com\b/iu.test(text)
  );
}

function parseHoneywellSilDocumentReference(
  units: readonly SourceUnit[],
): SourceBoundSilDocumentReference | null {
  const rawText = units
    .map((unit) => unit.text.normalize('NFKC').trim())
    .join(' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[•●▪]\s*/u, '')
    .trim();
  const match = rawText.match(
    /^Boeing\s+Service\s+(Letter|Bulletin)\s*,\s*Publication\s+Number\s+([A-Z0-9-]+)\s*,\s*(\S.*)$/iu,
  );
  if (!match) return null;
  return {
    relationKind: 'ASSOCIATED_PUBLICATION',
    issuerAuthority: 'BOEING',
    targetDocumentKind:
      match[1].toLowerCase() === 'letter'
        ? 'SERVICE_LETTER'
        : 'SERVICE_BULLETIN',
    targetDocumentCode: match[2].toUpperCase(),
    titleRaw: match[3].trim(),
    sourceUnitIds: units.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
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

function parseBoeingSlSectionAnchor(
  value: string,
  grammarByAlias: ReadonlyMap<string, SectionGrammarEntry>,
): {
  grammar: SectionGrammarEntry;
  matchedHeading: string;
  hasInlineBody: boolean;
} | null {
  const normalized = value.normalize('NFKC').trim();
  const colonIndex = normalized.indexOf(':');
  const label = colonIndex >= 0 ? normalized.slice(0, colonIndex) : normalized;
  const grammar = grammarByAlias.get(normalizeLabel(label));
  if (!grammar) return null;
  const inlineBody =
    colonIndex >= 0 ? normalized.slice(colonIndex + 1).trim() : '';
  return {
    grammar,
    matchedHeading:
      colonIndex >= 0 ? normalized.slice(0, colonIndex + 1) : label,
    hasInlineBody: inlineBody.length > 0,
  };
}

function parseBoeingSlReferenceEntries(units: readonly SourceUnit[]): {
  entries: SourceBoundSlReferenceEntry[];
  orphanContinuation: boolean;
} {
  const entries: SourceBoundSlReferenceEntry[] = [];
  let current:
    | { referenceLabel: string; units: SourceUnit[]; textParts: string[] }
    | undefined;
  let orphanContinuation = false;
  const flush = (): void => {
    if (!current) return;
    const rawText = current.textParts.join(' ').replace(/\s+/gu, ' ').trim();
    const referenceKind = classifyBoeingSlReference(rawText);
    entries.push({
      referenceLabel: current.referenceLabel,
      referenceKind,
      targetDocumentCode: extractBoeingSlReferenceCode(rawText, referenceKind),
      rawText,
      sourceUnitIds: current.units.map((unit) => unit.sourceUnitId),
      sourceRefIds: unique(current.units.flatMap((unit) => unit.sourceRefIds)),
    });
    current = undefined;
  };
  for (const unit of units) {
    const text = stripBoeingSlReferencesPrefix(unit.text);
    if (!text || isBoeingSlReferenceFurniture(unit, text)) continue;
    const marker = text.match(/^([a-z])\)\s*(\S.*)$/iu);
    if (marker) {
      flush();
      current = {
        referenceLabel: marker[1].toLowerCase(),
        units: [unit],
        textParts: [marker[2]],
      };
      continue;
    }
    if (!current) {
      orphanContinuation = true;
      continue;
    }
    current.units.push(unit);
    current.textParts.push(text);
  }
  flush();
  return { entries, orphanContinuation };
}

function stripBoeingSlReferencesPrefix(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^REFERENCES\s*:\s*/iu, '');
}

function isBoeingSlReferenceFurniture(
  unit: SourceUnit,
  value: string,
): boolean {
  const normalized = normalizeLabel(value);
  return (
    normalized === 'referencetypereferencenumberrevisionnumberreference' ||
    normalized === 'date' ||
    /^Page\s+\d+\s+of\s+\d+$/iu.test(value) ||
    /^ATA\s*:/iu.test(value) ||
    /^\d{1,2}\s+[A-Z][a-z]+\s+\d{4}$/u.test(value) ||
    /^ECCN\s*:/iu.test(value) ||
    /^\(EAR\b/iu.test(value) ||
    /^(?:transfer|country\s+group)\b/iu.test(value) ||
    /^Disclaimer\s*:/iu.test(value) ||
    /^required\s+for\s+forwarding\b/iu.test(value) ||
    /\bDocument\s+Generated\s+on\b/iu.test(value) ||
    /^BOEING\s+PROPRIETARY$/iu.test(value) ||
    (unit.expectedSemantic === 'heading' && /revisionnumber/iu.test(normalized))
  );
}

function classifyBoeingSlReference(value: string): SourceBoundSlReferenceKind {
  if (/\bService\s+Information\s+Letter\b|\bSIL\b/iu.test(value)) {
    return 'SERVICE_INFORMATION_LETTER';
  }
  if (
    /\bService\s+Bulletin\b|\bAirplane\s+Service\s+Bulletin\b/iu.test(value)
  ) {
    return 'SERVICE_BULLETIN';
  }
  if (/\bFleet\s+Team\s+Digest\b|\bFTD\b/iu.test(value)) {
    return 'FLEET_TEAM_DIGEST';
  }
  if (/\bService\s+Related\s+Problem\b|\bSRP\b/iu.test(value)) {
    return 'SERVICE_RELATED_PROBLEM';
  }
  if (/\bAirplane\s+Configuration\s+Bulletin\b|\bACB\b/iu.test(value)) {
    return 'AIRPLANE_CONFIGURATION_BULLETIN';
  }
  if (/\bDrawing\b/iu.test(value)) return 'DRAWING';
  return 'OTHER';
}

function extractBoeingSlReferenceCode(
  value: string,
  kind: SourceBoundSlReferenceKind,
): string | null {
  const dashed = value.match(/\b([A-Z0-9]+(?:-[A-Z0-9]+){1,})\b/iu)?.[1];
  if (dashed) return dashed.toUpperCase();
  if (kind === 'SERVICE_INFORMATION_LETTER') {
    return value.match(/\b(D\d{8,})\b/iu)?.[1]?.toUpperCase() ?? null;
  }
  if (kind === 'DRAWING') {
    return value.match(/\b(\d+[A-Z]\d+)\b/iu)?.[1]?.toUpperCase() ?? null;
  }
  return null;
}

function parseBoeingSlReferenceCitations(units: readonly SourceUnit[]): Array<{
  label: string;
  sourceUnitIds: string[];
  sourceRefIds: string[];
}> {
  const indexed = indexSourceText(units);
  const citationPattern =
    /\breferences?\s+([a-z]\)(?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+)[a-z]\))*)/giu;
  return [...indexed.text.matchAll(citationPattern)].flatMap((match) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const evidenceUnits = indexed.spans
      .filter((span) => span.end > start && span.start < end)
      .map((span) => span.unit);
    return [...match[1].matchAll(/\b([a-z])\)/giu)].map((labelMatch) => ({
      label: labelMatch[1].toLowerCase(),
      sourceUnitIds: evidenceUnits.map((unit) => unit.sourceUnitId),
      sourceRefIds: unique(evidenceUnits.flatMap((unit) => unit.sourceRefIds)),
    }));
  });
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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
