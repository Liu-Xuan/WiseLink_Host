import type {
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';
import type { SourceBoundSectionWindow } from './family-section-topology.builder';

export type AirbusOperatorTransmissionSubtype = 'OIT' | 'FOT' | 'SBIT';

export interface SourceBoundOperatorTransmissionDocument {
  readonly semanticState: 'CONTENT' | 'MISSING';
  readonly documentStructured: boolean;
  readonly unstructuredReason:
    | 'PRIMARY_IDENTITY_UNRESOLVED'
    | 'PAGE_FURNITURE_CONFLICT'
    | 'SUBTYPE_UNRESOLVED'
    | 'SELF_CLASSIFICATION_UNRESOLVED'
    | 'SUBJECT_UNRESOLVED'
    | 'AIRCRAFT_SCOPE_UNRESOLVED'
    | 'DISTRIBUTION_MODALITY_UNRESOLVED'
    | 'SECTION_SEQUENCE_UNRESOLVED'
    | 'REFERENCE_CATALOG_UNRESOLVED'
    | 'ACTION_MODEL_UNRESOLVED'
    | 'REVISION_MARKER_UNRESOLVED'
    | null;
  readonly subtype: AirbusOperatorTransmissionSubtype | null;
  readonly identity: {
    readonly documentCode: string;
    readonly businessRevision: string;
    readonly revisionDate: string;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  } | null;
  readonly selfClassification: {
    readonly value: 'ADVICE' | 'SBIT';
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  } | null;
  readonly subject: {
    readonly textRaw: string;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  } | null;
  readonly statedAircraftScopes: readonly {
    readonly field: 'AIRCRAFT_TYPE' | 'TO' | 'APPLICABLE_AIRCRAFT';
    readonly textRaw: string;
    readonly aircraftTypeTokens: readonly string[];
    readonly qualifiersRaw: readonly string[];
    readonly decisionInferred: false;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  }[];
  readonly distributionModality: {
    readonly value: 'OPERATOR_DISCRETION' | 'OPERATOR_RESPONSIBILITY';
    readonly textRaw: string;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  } | null;
  readonly references: readonly {
    readonly referenceLabel: string;
    readonly targetDocumentKind:
      | 'SERVICE_BULLETIN'
      | 'SAFETY_FIRST'
      | 'TROUBLESHOOTING_MANUAL_TASK';
    readonly targetDocumentCode: string;
    readonly targetRevision: string | null;
    readonly mandatoryQualifier: boolean;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  }[];
  readonly recommendations: readonly {
    readonly modality:
      | 'HIGHLY_RECOMMENDED'
      | 'INVITED'
      | 'ENCOURAGED'
      | 'CONFIRMED_NOTE_CHANGE';
    readonly textRaw: string;
    readonly readinessInferred: false;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  }[];
  readonly followUp: {
    readonly state:
      | 'PLANNED_INSPECTION_BULLETIN'
      | 'NO_UPDATE_PLANNED'
      | 'PLANNED_REFERENCE_REVISION';
    readonly textRaw: string;
    readonly completionInferred: false;
    readonly closureInferred: false;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  } | null;
  readonly revisionBlock: {
    readonly state: 'CONTENT' | 'SOURCE_ABSENT';
    readonly markerPairStructured: boolean;
    readonly textRaw: string | null;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  };
  readonly contact: {
    readonly channel: 'TECHREQUEST';
    readonly textRaw: string;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  } | null;
  readonly pageFurniture: readonly {
    readonly page: number;
    readonly pageCount: number;
    readonly prefix: 'OIT' | 'FOT';
    readonly documentCode: string;
    readonly businessRevision: string;
    readonly revisionDate: string;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  }[];
  readonly prohibitedInferences: {
    readonly documentMandatoryInferred: false;
    readonly applicabilityDecisionInferred: false;
    readonly referencePromotedToAttachment: false;
    readonly actionReadinessInferred: false;
    readonly completionInferred: false;
    readonly approvalInferred: false;
    readonly closureInferred: false;
  };
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

const PROHIBITED_INFERENCES = {
  documentMandatoryInferred: false,
  applicabilityDecisionInferred: false,
  referencePromotedToAttachment: false,
  actionReadinessInferred: false,
  completionInferred: false,
  approvalInferred: false,
  closureInferred: false,
} as const;

export function buildSourceBoundOperatorTransmissionDocument(input: {
  readonly unitSet: SourceUnitSet;
  readonly sections: readonly SourceBoundSectionWindow[];
  readonly documentCode: string;
  readonly documentType: string;
}): SourceBoundOperatorTransmissionDocument | null {
  if (input.documentType !== 'operator_transmission') return null;
  const units = orderedContentUnits(input.unitSet);
  const empty = emptyDocument(units);
  const identityCandidates = units.flatMap((unit) => {
    const match = unit.text
      .normalize('NFKC')
      .trim()
      .match(
        /^OUR\s+REF\.\s*:\s*([A-Z0-9]+(?:[./-][A-Z0-9]+)+)\s+REV\s+(\d{1,3})\s+DATED\s+(\d{1,2}-[A-Z]{3,9}-\d{4})$/iu,
      );
    const revisionDate = match ? parseSourceDate(match[3]) : null;
    return match && revisionDate
      ? [
          {
            documentCode: match[1].toUpperCase(),
            businessRevision: `R${Number(match[2])}`,
            revisionDate,
            unit,
          },
        ]
      : [];
  });
  const expectedDocumentCode = input.documentCode
    .normalize('NFKC')
    .trim()
    .toUpperCase();
  if (
    identityCandidates.length !== 1 ||
    identityCandidates[0].documentCode !== expectedDocumentCode
  ) {
    return failDocument(empty, 'PRIMARY_IDENTITY_UNRESOLVED');
  }
  const primary = identityCandidates[0];
  const identity = {
    documentCode: primary.documentCode,
    businessRevision: primary.businessRevision,
    revisionDate: primary.revisionDate,
    sourceUnitIds: [primary.unit.sourceUnitId],
    sourceRefIds: [...primary.unit.sourceRefIds],
  };

  const pageFurniture = buildPageFurniture(units, input.unitSet);
  if (
    pageFurniture.length === 0 ||
    pageFurniture.some(
      (entry) =>
        entry.documentCode !== identity.documentCode ||
        entry.businessRevision !== identity.businessRevision ||
        entry.revisionDate !== identity.revisionDate,
    )
  ) {
    return failDocument(empty, 'PAGE_FURNITURE_CONFLICT');
  }

  const subtype = resolveSubtype(units);
  if (!subtype) return failDocument(empty, 'SUBTYPE_UNRESOLVED');
  const selfClassification = buildSelfClassification(units, subtype);
  if (!selfClassification) {
    return failDocument(empty, 'SELF_CLASSIFICATION_UNRESOLVED');
  }
  const subject = buildSubject(units);
  if (!subject) return failDocument(empty, 'SUBJECT_UNRESOLVED');
  if (!sectionSequenceMatches(input.sections, subtype)) {
    return failDocument(empty, 'SECTION_SEQUENCE_UNRESOLVED');
  }

  const references = buildReferenceCatalog(units, input.sections, subtype);
  if (!references) {
    return failDocument(empty, 'REFERENCE_CATALOG_UNRESOLVED');
  }
  const statedAircraftScopes = buildStatedAircraftScopes(
    units,
    input.sections,
    subtype,
  );
  if (statedAircraftScopes.length === 0) {
    return failDocument(empty, 'AIRCRAFT_SCOPE_UNRESOLVED');
  }
  const distributionModality = buildDistributionModality(units);
  if (!distributionModality) {
    return failDocument(empty, 'DISTRIBUTION_MODALITY_UNRESOLVED');
  }
  const recommendations = buildRecommendations(input.sections, subtype);
  const followUp = buildFollowUp(input.sections, subtype);
  if (recommendations.length === 0 || !followUp) {
    return failDocument(empty, 'ACTION_MODEL_UNRESOLVED');
  }
  const revisionBlock = buildRevisionBlock(input.sections, subtype);
  if (subtype === 'SBIT' && !revisionBlock.markerPairStructured) {
    return failDocument(empty, 'REVISION_MARKER_UNRESOLVED');
  }
  const contact = buildContact(input.sections);
  const evidenceUnits = uniqueUnits([
    primary.unit,
    ...pageFurniture.flatMap((entry) =>
      units.filter((unit) => entry.sourceUnitIds.includes(unit.sourceUnitId)),
    ),
    ...unitsForValue(units, selfClassification),
    ...unitsForValue(units, subject),
    ...statedAircraftScopes.flatMap((value) => unitsForValue(units, value)),
    ...unitsForValue(units, distributionModality),
    ...references.flatMap((value) => unitsForValue(units, value)),
    ...recommendations.flatMap((value) => unitsForValue(units, value)),
    ...unitsForValue(units, followUp),
    ...unitsForValue(units, revisionBlock),
    ...unitsForValue(units, contact),
  ]);
  return {
    semanticState: 'CONTENT',
    documentStructured: true,
    unstructuredReason: null,
    subtype,
    identity,
    selfClassification,
    subject,
    statedAircraftScopes,
    distributionModality,
    references,
    recommendations,
    followUp,
    revisionBlock,
    contact,
    pageFurniture,
    prohibitedInferences: PROHIBITED_INFERENCES,
    sourceUnitIds: evidenceUnits.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(evidenceUnits.flatMap((unit) => unit.sourceRefIds)),
  };
}

function emptyDocument(
  units: readonly SourceUnit[],
): SourceBoundOperatorTransmissionDocument {
  return {
    semanticState: units.length > 0 ? 'CONTENT' : 'MISSING',
    documentStructured: false,
    unstructuredReason: null,
    subtype: null,
    identity: null,
    selfClassification: null,
    subject: null,
    statedAircraftScopes: [],
    distributionModality: null,
    references: [],
    recommendations: [],
    followUp: null,
    revisionBlock: {
      state: 'SOURCE_ABSENT',
      markerPairStructured: true,
      textRaw: null,
      sourceUnitIds: [],
      sourceRefIds: [],
    },
    contact: null,
    pageFurniture: [],
    prohibitedInferences: PROHIBITED_INFERENCES,
    sourceUnitIds: units.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
  };
}

function failDocument(
  empty: SourceBoundOperatorTransmissionDocument,
  reason: NonNullable<
    SourceBoundOperatorTransmissionDocument['unstructuredReason']
  >,
): SourceBoundOperatorTransmissionDocument {
  return { ...empty, unstructuredReason: reason };
}

function buildPageFurniture(
  units: readonly SourceUnit[],
  unitSet: SourceUnitSet,
): SourceBoundOperatorTransmissionDocument['pageFurniture'] {
  const pageCount = Math.max(
    0,
    ...unitSet.sourceRefs.map((sourceRef) => sourceRef.pageEnd),
  );
  const rows = units.flatMap((unit) => {
    const match = unit.text
      .normalize('NFKC')
      .trim()
      .match(
        /^(OIT|FOT)\s+ref\s*:\s*([A-Z0-9]+(?:[./-][A-Z0-9]+)+)\s+Rev\s+(\d{1,3})\s*Page\s+(\d+)\s+of\s+(\d+)\s*Date\s*:\s*(\d{1,2}-[A-Z]{3,9}-\d{4})$/iu,
      );
    const revisionDate = match ? parseSourceDate(match[6]) : null;
    return match && revisionDate
      ? [
          {
            page: Number(match[4]),
            pageCount: Number(match[5]),
            prefix: match[1].toUpperCase() as 'OIT' | 'FOT',
            documentCode: match[2].toUpperCase(),
            businessRevision: `R${Number(match[3])}`,
            revisionDate,
            sourceUnitIds: [unit.sourceUnitId],
            sourceRefIds: [...unit.sourceRefIds],
          },
        ]
      : [];
  });
  if (
    rows.length !== pageCount ||
    rows.some((row) => row.pageCount !== pageCount) ||
    new Set(rows.map((row) => row.page)).size !== pageCount ||
    !Array.from({ length: pageCount }, (_, index) => index + 1).every((page) =>
      rows.some((row) => row.page === page),
    )
  ) {
    return [];
  }
  return rows.slice().sort((left, right) => left.page - right.page);
}

function resolveSubtype(
  units: readonly SourceUnit[],
): AirbusOperatorTransmissionSubtype | null {
  const normalized = units.map((unit) => normalizeLabel(unit.text));
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
  if (
    oitBannerCount === 1 &&
    sbitCategoryCount === 1 &&
    fotBannerCount === 0
  ) {
    return 'SBIT';
  }
  if (
    oitBannerCount === 1 &&
    adviceCategoryCount === 1 &&
    sbitCategoryCount === 0 &&
    fotBannerCount === 0
  ) {
    return 'OIT';
  }
  if (
    fotBannerCount === 1 &&
    oitBannerCount === 0 &&
    sbitCategoryCount === 0
  ) {
    return 'FOT';
  }
  return null;
}

function buildSelfClassification(
  units: readonly SourceUnit[],
  subtype: AirbusOperatorTransmissionSubtype,
): SourceBoundOperatorTransmissionDocument['selfClassification'] {
  const matches = units.filter((unit) => {
    const label = normalizeLabel(unit.text);
    if (subtype === 'FOT') return label === 'classificationadvice';
    if (subtype === 'OIT') return label === 'oitcategoryadvice';
    return (
      label === 'oitcategoryservicebulletininformationtransmissionsbit'
    );
  });
  if (matches.length !== 1) return null;
  return sourceBoundValue(matches, {
    value: subtype === 'SBIT' ? ('SBIT' as const) : ('ADVICE' as const),
  });
}

function buildSubject(
  units: readonly SourceUnit[],
): SourceBoundOperatorTransmissionDocument['subject'] {
  const indexes = units.flatMap((unit, index) =>
    /^SUBJECT\s*:/iu.test(unit.text.normalize('NFKC').trim()) ? [index] : [],
  );
  if (indexes.length !== 1) return null;
  const start = indexes[0];
  const end = units.findIndex(
    (unit, index) =>
      index > start &&
      /^(?:AIRCRAFT\s+TYPE|OUR\s+REF\.|OIT\s+CATEGORY|CLASSIFICATION|APPLICABLE\s+AIRCRAFT)\s*:/iu.test(
        unit.text.normalize('NFKC').trim(),
      ),
  );
  const values = units.slice(start, end < 0 ? start + 1 : end);
  const textRaw = joinWrapped(values).replace(/^SUBJECT\s*:\s*/iu, '');
  return textRaw ? sourceBoundValue(values, { textRaw }) : null;
}

function buildStatedAircraftScopes(
  units: readonly SourceUnit[],
  sections: readonly SourceBoundSectionWindow[],
  subtype: AirbusOperatorTransmissionSubtype,
): SourceBoundOperatorTransmissionDocument['statedAircraftScopes'] {
  const definitions = [
    {
      field: 'AIRCRAFT_TYPE' as const,
      pattern: /^AIRCRAFT\s+TYPE\s*:/iu,
    },
    { field: 'TO' as const, pattern: /^TO\s*:/iu },
    {
      field: 'APPLICABLE_AIRCRAFT' as const,
      pattern: /^APPLICABLE\s+AIRCRAFT\s*:/iu,
    },
  ];
  const purpose = sections.find((section) => section.sectionKey === 'purpose');
  const purposeText = purpose ? joinWrapped(purpose.bodyUnits) : '';
  const equippedQualifier =
    subtype === 'OIT'
      ? purposeText.match(
          /operators\s+with\s+aircraft\s+equipped\s+with\s+NAV\s+mode\s+in\s+Go-Around\s+function/iu,
        )?.[0] ?? null
      : null;
  return definitions.flatMap((definition) => {
    const matching = units.filter((unit) =>
      definition.pattern.test(unit.text.normalize('NFKC').trim()),
    );
    if (matching.length !== 1) return [];
    const textRaw = matching[0].text
      .normalize('NFKC')
      .replace(definition.pattern, '')
      .trim();
    const aircraftTypeTokens = unique([
      ...textRaw.matchAll(/\bA(?:318|319|320|321|330|340|350|380)\b/giu),
    ].map((match) => match[0].toUpperCase()));
    return [
      sourceBoundValue(
        uniqueUnits([
          ...matching,
          ...(equippedQualifier && purpose ? purpose.bodyUnits : []),
        ]),
        {
          field: definition.field,
          textRaw,
          aircraftTypeTokens,
          qualifiersRaw:
            definition.field === 'AIRCRAFT_TYPE' && equippedQualifier
              ? [equippedQualifier]
              : [],
          decisionInferred: false as const,
        },
      ),
    ];
  });
}

function buildDistributionModality(
  units: readonly SourceUnit[],
): SourceBoundOperatorTransmissionDocument['distributionModality'] {
  const noticeIndexes = units.flatMap((unit, index) =>
    /^NOTICE\s*:/iu.test(unit.text.normalize('NFKC').trim()) ? [index] : [],
  );
  if (noticeIndexes.length !== 1) return null;
  const start = noticeIndexes[0];
  const end = units.findIndex(
    (unit, index) =>
      index > start &&
      (/^(?:EXPORT\s+CONTROL|REFERENCED\s+DOCUMENTS)\s*:/iu.test(
        unit.text.normalize('NFKC').trim(),
      ) || /^\d+\s*\.\s*[A-Z]/iu.test(unit.text.normalize('NFKC').trim())),
  );
  const values = units.slice(start, end < 0 ? units.length : end);
  const textRaw = joinWrapped(values);
  const discretionary = /left\s+to\s+each\s+Operator[’']s\s+discretion/iu.test(
    textRaw,
  );
  const responsibility = /each\s+Operator[’']s\s+responsibility/iu.test(
    textRaw,
  );
  if (discretionary === responsibility) return null;
  return sourceBoundValue(values, {
    value: discretionary
      ? ('OPERATOR_DISCRETION' as const)
      : ('OPERATOR_RESPONSIBILITY' as const),
    textRaw,
  });
}

function buildReferenceCatalog(
  units: readonly SourceUnit[],
  sections: readonly SourceBoundSectionWindow[],
  subtype: AirbusOperatorTransmissionSubtype,
): SourceBoundOperatorTransmissionDocument['references'] | null {
  const headerIndexes = units.flatMap((unit, index) =>
    normalizeLabel(unit.text) === 'referenceddocuments' ? [index] : [],
  );
  const explicitReferences: Array<
    SourceBoundOperatorTransmissionDocument['references'][number]
  > = [];
  if (headerIndexes.length > 1) return null;
  if (headerIndexes.length === 1) {
    const headerIndex = headerIndexes[0];
    const firstSectionIndex = units.findIndex(
      (unit, index) =>
        index > headerIndex &&
        /^\d+\s*\.\s*[A-Z]/iu.test(unit.text.normalize('NFKC').trim()),
    );
    const referenceUnits = units.slice(
      headerIndex + 1,
      firstSectionIndex < 0 ? units.length : firstSectionIndex,
    );
    const blocks = referenceBlocks(referenceUnits);
    if (blocks.length === 0) return null;
    for (const block of blocks) {
      const parsed = parseReferenceBlock(block.label, block.units);
      if (parsed.length === 0) return null;
      explicitReferences.push(...parsed);
    }
  }
  const description = sections.find(
    (section) => section.sectionKey === 'description',
  );
  const inlineTsm = description
    ? buildInlineTsmReferences(description.bodyUnits)
    : [];
  const combined = [...explicitReferences, ...inlineTsm];
  if (subtype === 'FOT') {
    return headerIndexes.length === 0 && inlineTsm.length === 1
      ? combined
      : null;
  }
  return headerIndexes.length === 1 && explicitReferences.length > 0
    ? combined
    : null;
}

function referenceBlocks(
  units: readonly SourceUnit[],
): Array<{ label: string; units: SourceUnit[] }> {
  const starts = units.flatMap((unit, index) => {
    const match = unit.text.normalize('NFKC').trim().match(/^Ref\.?\s*(\d+)\s*:/iu);
    return match ? [{ index, label: `Ref.${Number(match[1])}` }] : [];
  });
  if (
    starts.length === 0 ||
    new Set(starts.map((start) => start.label)).size !== starts.length ||
    starts.some((start, index) => start.label !== `Ref.${index + 1}`)
  ) {
    return [];
  }
  return starts.map((start, index) => ({
    label: start.label,
    units: units.slice(start.index, starts[index + 1]?.index ?? units.length),
  }));
}

function parseReferenceBlock(
  label: string,
  units: readonly SourceUnit[],
): Array<SourceBoundOperatorTransmissionDocument['references'][number]> {
  const textRaw = joinWrapped(units);
  const common = {
    referenceLabel: label,
    sourceUnitIds: units.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
  };
  if (/Safety\s+First/iu.test(textRaw)) {
    const date = textRaw.match(/Safety\s+First\s+([A-Z]+\s+\d{4})/iu);
    return date
      ? [
          {
            ...common,
            targetDocumentKind: 'SAFETY_FIRST',
            targetDocumentCode: `SAFETY FIRST ${date[1].toUpperCase()}`,
            targetRevision: null,
            mandatoryQualifier: false,
          },
        ]
      : [];
  }
  const matches = [
    ...textRaw.matchAll(
      /(?:Inspection\s+SB|Service\s+Bulletin|Mandatory\s+SB|\bSB)\s+([A-Z]\d{3}-\d{2}-\d{4}|\d{2}-[A-Z0-9]{4})\b(?:\s+(?:REV|R)(?:ISION)?\s*(\d{1,3}))?/giu,
    ),
  ];
  const entries = matches.map((match) => ({
    ...common,
    targetDocumentKind: 'SERVICE_BULLETIN' as const,
    targetDocumentCode: match[1].toUpperCase(),
    targetRevision: match[2] ? `R${Number(match[2])}` : null,
    mandatoryQualifier: /Mandatory\s+SB/iu.test(
      textRaw.slice(Math.max(0, match.index - 20), match.index + match[0].length),
    ),
  }));
  return uniqueBy(entries, (entry) => entry.targetDocumentCode);
}

function buildInlineTsmReferences(
  units: readonly SourceUnit[],
): Array<SourceBoundOperatorTransmissionDocument['references'][number]> {
  const matches = units.flatMap((unit, index) => {
    const span = units.slice(index, Math.min(units.length, index + 3));
    const match = joinWrapped(span).match(
      /\bTSM\s+task\s+(\d{2}-\d{2}-\d{2}-\d{3}-\d{3}-[A-Z])\b/iu,
    );
    return match ? [{ targetDocumentCode: match[1].toUpperCase(), span }] : [];
  });
  const uniqueMatches = uniqueBy(
    matches,
    (match) => match.targetDocumentCode,
  );
  if (uniqueMatches.length !== 1) return [];
  const [match] = uniqueMatches;
  return [
    {
      referenceLabel: 'inline',
      targetDocumentKind: 'TROUBLESHOOTING_MANUAL_TASK',
      targetDocumentCode: match.targetDocumentCode,
      targetRevision: null,
      mandatoryQualifier: false,
      sourceUnitIds: match.span.map((unit) => unit.sourceUnitId),
      sourceRefIds: unique(match.span.flatMap((unit) => unit.sourceRefIds)),
    },
  ];
}

function buildRecommendations(
  sections: readonly SourceBoundSectionWindow[],
  subtype: AirbusOperatorTransmissionSubtype,
): SourceBoundOperatorTransmissionDocument['recommendations'] {
  const candidate =
    sections.find((section) =>
      ['recommendation', 'recommendations'].includes(section.sectionKey),
    ) ?? sections.find((section) => section.sectionKey === 'follow_up');
  if (!candidate) return [];
  const textRaw = joinWrapped(candidate.bodyUnits);
  const modalities =
    subtype === 'OIT'
      ? ([
          ['HIGHLY_RECOMMENDED', /highly\s+recommended/iu],
          ['INVITED', /Operators\s+are\s+invited/iu],
        ] as const)
      : subtype === 'FOT'
        ? ([['ENCOURAGED', /Airbus\s+encourages/iu]] as const)
        : ([
            [
              'CONFIRMED_NOTE_CHANGE',
              /Airbus\s+confirms\s+that\s+the\s+following\s+second\s+NOTE\s+should\s+be\s+added/iu,
            ],
          ] as const);
  return modalities.flatMap(([modality, pattern]) =>
    pattern.test(textRaw)
      ? [
          sourceBoundValue(candidate.bodyUnits, {
            modality,
            textRaw,
            readinessInferred: false as const,
          }),
        ]
      : [],
  );
}

function buildFollowUp(
  sections: readonly SourceBoundSectionWindow[],
  subtype: AirbusOperatorTransmissionSubtype,
): SourceBoundOperatorTransmissionDocument['followUp'] {
  const section = sections.find((value) =>
    ['follow_up', 'follow_up_plan'].includes(value.sectionKey),
  );
  if (!section) return null;
  const textRaw = joinWrapped(section.bodyUnits);
  const state =
    subtype === 'OIT' &&
    /will\s+issue\s+Inspection\s+Service\s+Bulletin/iu.test(textRaw) &&
    /will\s+be\s+dispatched\s+in\s+Q2\s+2026/iu.test(textRaw)
      ? ('PLANNED_INSPECTION_BULLETIN' as const)
      : subtype === 'FOT' && /No\s+update\s+of\s+this\s+FOT\s+is\s+planned/iu.test(textRaw)
        ? ('NO_UPDATE_PLANNED' as const)
        : subtype === 'SBIT' &&
            /will\s+be\s+included\s+in\s+the\s+next\s+revision\s+02/iu.test(
              textRaw.replace(/bysecond\s+quarter2026/iu, 'by second quarter 2026'),
            )
          ? ('PLANNED_REFERENCE_REVISION' as const)
          : null;
  return state
    ? sourceBoundValue(section.bodyUnits, {
        state,
        textRaw,
        completionInferred: false as const,
        closureInferred: false as const,
      })
    : null;
}

function buildRevisionBlock(
  sections: readonly SourceBoundSectionWindow[],
  subtype: AirbusOperatorTransmissionSubtype,
): SourceBoundOperatorTransmissionDocument['revisionBlock'] {
  if (subtype !== 'SBIT') {
    return {
      state: 'SOURCE_ABSENT',
      markerPairStructured: true,
      textRaw: null,
      sourceUnitIds: [],
      sourceRefIds: [],
    };
  }
  const reason = sections.find(
    (section) => section.sectionKey === 'reason_for_revision',
  );
  const followUp = sections.find(
    (section) => section.sectionKey === 'follow_up',
  );
  if (!reason || !followUp) {
    return {
      state: 'CONTENT',
      markerPairStructured: false,
      textRaw: null,
      sourceUnitIds: [],
      sourceRefIds: [],
    };
  }
  const markerUnits = followUp.bodyUnits.filter((unit) =>
    /[“"](?:BEG|END)\.?\s*REV[”"]/iu.test(unit.text.normalize('NFKC')),
  );
  const units = uniqueUnits([...reason.bodyUnits, ...markerUnits]);
  return sourceBoundValue(units, {
    state: 'CONTENT' as const,
    markerPairStructured:
      markerUnits.length === 2 &&
      /BEG/iu.test(markerUnits[0].text) &&
      /END/iu.test(markerUnits[1].text),
    textRaw: joinWrapped(reason.bodyUnits),
  });
}

function buildContact(
  sections: readonly SourceBoundSectionWindow[],
): SourceBoundOperatorTransmissionDocument['contact'] {
  const section =
    sections.find((value) => value.sectionKey === 'contacts') ??
    sections.find((value) =>
      ['follow_up', 'follow_up_plan'].includes(value.sectionKey),
    );
  if (!section) return null;
  const units = section.bodyUnits.filter((unit) =>
    /TechRequest|AirbusWorld|Airbus\s+World/iu.test(unit.text),
  );
  if (units.length === 0) return null;
  return sourceBoundValue(units, {
    channel: 'TECHREQUEST' as const,
    textRaw: joinWrapped(units),
  });
}

function sectionSequenceMatches(
  sections: readonly SourceBoundSectionWindow[],
  subtype: AirbusOperatorTransmissionSubtype,
): boolean {
  const expected =
    subtype === 'OIT'
      ? ['purpose', 'background', 'description', 'follow_up', 'contacts']
      : subtype === 'FOT'
        ? ['purpose', 'description', 'recommendations', 'follow_up_plan']
        : [
            'reason_for_revision',
            'purpose',
            'background',
            'recommendation',
            'follow_up',
            'contacts',
          ];
  return (
    sections.length === expected.length &&
    sections.every(
      (section, index) =>
        section.family === 'SB' &&
        section.scopeKey === 'operator_transmission' &&
        section.sectionKey === expected[index],
    )
  );
}

function sourceBoundValue<T extends Record<string, unknown>>(
  units: readonly SourceUnit[],
  value: T,
): T & { sourceUnitIds: string[]; sourceRefIds: string[] } {
  const evidence = uniqueUnits(units);
  return {
    ...value,
    sourceUnitIds: evidence.map((unit) => unit.sourceUnitId),
    sourceRefIds: unique(evidence.flatMap((unit) => unit.sourceRefIds)),
  };
}

function unitsForValue(
  units: readonly SourceUnit[],
  value: { readonly sourceUnitIds: readonly string[] } | null,
): SourceUnit[] {
  if (!value) return [];
  const wanted = new Set(value.sourceUnitIds);
  return units.filter((unit) => wanted.has(unit.sourceUnitId));
}

function orderedContentUnits(unitSet: SourceUnitSet): SourceUnit[] {
  return unitSet.units
    .filter((unit) => unit.kind !== 'source_metadata')
    .slice()
    .sort((left, right) => left.order - right.order);
}

function joinWrapped(units: readonly SourceUnit[]): string {
  return units.reduce((joined, unit) => {
    const value = unit.text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!value) return joined;
    if (!joined) return value;
    return joined.endsWith('-')
      ? `${joined}${value}`
      : `${joined} ${value}`;
  }, '');
}

function parseSourceDate(value: string): string | null {
  const match = value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .match(/^(\d{1,2})-([A-Z]{3,9})-(\d{4})$/u);
  if (!match) return null;
  const months: Record<string, string> = {
    JAN: '01',
    FEB: '02',
    MAR: '03',
    APR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08',
    SEP: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12',
  };
  const month = months[match[2].slice(0, 3)];
  if (!month) return null;
  const day = match[1].padStart(2, '0');
  const date = new Date(`${match[3]}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.getUTCDate() !== Number(day)
    ? null
    : `${match[3]}-${month}-${day}`;
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function uniqueUnits(values: readonly SourceUnit[]): SourceUnit[] {
  return uniqueBy(values, (value) => value.sourceUnitId);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
