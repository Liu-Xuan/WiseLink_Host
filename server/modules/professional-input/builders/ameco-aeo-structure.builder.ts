import type {
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';
import type { SourceBoundSectionWindow } from './family-section-topology.builder';

export interface SourceBoundAeoEffectivityGroup {
  readonly groupId: string;
  readonly aircraftModel: string;
  readonly declaredAircraftCount: number;
  readonly aircraftRegistrations: readonly string[];
  readonly zoneId: string;
  readonly workTypeId: string;
  readonly phaseId: string;
  readonly applicabilitySourceUnitIds: readonly string[];
  readonly applicabilitySourceRefIds: readonly string[];
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAeoEffectivity {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly effectivityStructured: boolean;
  readonly unstructuredReason:
    | 'TABLE_CHAIN_UNRESOLVED'
    | 'GROUP_ROW_UNRESOLVED'
    | 'GROUP_RELATION_UNRESOLVED'
    | null;
  readonly groups: readonly SourceBoundAeoEffectivityGroup[];
}

export interface SourceBoundAeoProcedureAction {
  readonly itemOrdinal: number;
  readonly actionTextRaw: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAeoProcedureBranch {
  readonly fromItemOrdinal: 2;
  readonly condition: 'SOFTWARE_ALREADY_PRESENT';
  readonly whenTrue: {
    readonly nextItemOrdinal: 4;
    readonly markItemOrdinalNotApplicable: 3;
  };
  readonly whenFalse: {
    readonly nextItemOrdinal: 3;
  };
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAeoProcedureReference {
  readonly relationKind: 'PROCEDURE_REFERENCE';
  readonly targetDocumentKind: 'AIRCRAFT_MAINTENANCE_MANUAL';
  readonly targetDocumentCode: string;
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAeoProcedure {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly procedureStructured: boolean;
  readonly unstructuredReason:
    | 'PROCEDURE_HEADER_UNRESOLVED'
    | 'ITEM_SEQUENCE_UNRESOLVED'
    | 'CONDITIONAL_BRANCH_UNRESOLVED'
    | null;
  readonly actions: readonly SourceBoundAeoProcedureAction[];
  readonly branches: readonly SourceBoundAeoProcedureBranch[];
  readonly references: readonly SourceBoundAeoProcedureReference[];
}

export interface SourceBoundAeoSoftwareAssignment {
  readonly partNumber: string;
  readonly groupScope: 'G1' | 'G2' | 'ALL_GROUPS';
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAeoInvalidSoftwarePart {
  readonly partNumber: string;
  readonly disposition: 'REMOVE_REPLACED_SOFTWARE';
  readonly sourceUnitIds: readonly string[];
  readonly sourceRefIds: readonly string[];
}

export interface SourceBoundAeoSoftwareControl {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly softwareControlStructured: boolean;
  readonly unstructuredReason:
    | 'NEW_SOFTWARE_TABLE_UNRESOLVED'
    | 'CONFLICTING_GROUP_SCOPE'
    | 'INVALID_SOFTWARE_TABLE_UNRESOLVED'
    | null;
  readonly assignments: readonly SourceBoundAeoSoftwareAssignment[];
  readonly invalidSoftwareParts: readonly SourceBoundAeoInvalidSoftwarePart[];
}

export interface SourceBoundAeoSafetyBoundary {
  readonly semanticState: 'CONTENT' | 'NONE' | 'MISSING';
  readonly checklistStructured: boolean;
  readonly unstructuredReason: 'CHECKLIST_ITEMS_UNRESOLVED' | null;
  readonly selectionState: 'UNRESOLVED';
  readonly operationalRequirementInferred: false;
  readonly items: readonly {
    readonly itemCode: string;
    readonly rawText: string;
    readonly displayedNaMarker: boolean;
    readonly sourceUnitIds: readonly string[];
    readonly sourceRefIds: readonly string[];
  }[];
}

export function buildSourceBoundAeoEffectivity(
  section: SourceBoundSectionWindow,
): SourceBoundAeoEffectivity | null {
  if (!isAeoSection(section, 'engineering_basis')) return null;
  const empty: SourceBoundAeoEffectivity = {
    semanticState: section.semanticBodyState,
    effectivityStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    groups: [],
  };
  if (section.semanticBodyState !== 'CONTENT') return empty;

  const groupIndex = singleNormalizedIndex(section.bodyUnits, 'a分组group');
  const zoneIndex = singleNormalizedIndex(
    section.bodyUnits,
    'b区域部件位置zone',
  );
  const workTypeIndex = singleNormalizedIndex(
    section.bodyUnits,
    'c工作类别worktype',
  );
  const phaseIndex = singleNormalizedIndex(
    section.bodyUnits,
    '20分阶段任务列表eophaseslist',
  );
  if (
    groupIndex === null ||
    zoneIndex === null ||
    workTypeIndex === null ||
    phaseIndex === null ||
    !(groupIndex < zoneIndex && zoneIndex < workTypeIndex && workTypeIndex < phaseIndex)
  ) {
    return {
      ...empty,
      effectivityStructured: false,
      unstructuredReason: 'TABLE_CHAIN_UNRESOLVED',
    };
  }

  const parsedGroups = parseAeoGroupRows(
    section.bodyUnits.slice(groupIndex + 1, zoneIndex),
  );
  if (!parsedGroups) {
    return {
      ...empty,
      effectivityStructured: false,
      unstructuredReason: 'GROUP_ROW_UNRESOLVED',
    };
  }
  const zones = parseUniqueRelationRows(
    section.bodyUnits.slice(zoneIndex + 1, workTypeIndex),
    /^(G\d+)(Z\d+)$/u,
  );
  const workTypes = parseUniqueRelationRows(
    section.bodyUnits.slice(workTypeIndex + 1, phaseIndex),
    /^(G\d+)(Z\d+)(W\d+)$/u,
  );
  const phases = parseUniqueRelationRows(
    section.bodyUnits.slice(phaseIndex + 1),
    /^阶段编号(G\d+)-(Z\d+)-(W\d+)/u,
  );
  const expectedGroups = new Set(parsedGroups.map((group) => group.groupId));
  if (
    !zones ||
    !workTypes ||
    !phases ||
    !sameKeys(expectedGroups, zones) ||
    !sameKeys(expectedGroups, workTypes) ||
    !sameKeys(expectedGroups, phases)
  ) {
    return {
      ...empty,
      effectivityStructured: false,
      unstructuredReason: 'GROUP_RELATION_UNRESOLVED',
    };
  }

  const groups = parsedGroups.flatMap((group) => {
    const zone = zones.get(group.groupId);
    const workType = workTypes.get(group.groupId);
    const phase = phases.get(group.groupId);
    if (
      !zone ||
      !workType ||
      !phase ||
      workType.values[0] !== zone.values[0] ||
      phase.values[0] !== zone.values[0] ||
      phase.values[1] !== workType.values[1]
    ) {
      return [];
    }
    const evidenceUnits = uniqueUnits([
      ...group.units,
      zone.unit,
      workType.unit,
      phase.unit,
    ]);
    return [
      {
        groupId: group.groupId,
        aircraftModel: group.aircraftModel,
        declaredAircraftCount: group.declaredAircraftCount,
        aircraftRegistrations: group.aircraftRegistrations,
        zoneId: zone.values[0],
        workTypeId: workType.values[1],
        phaseId: `${group.groupId}-${phase.values[0]}-${phase.values[1]}`,
        applicabilitySourceUnitIds: group.units.map(
          (unit) => unit.sourceUnitId,
        ),
        applicabilitySourceRefIds: unique(
          group.units.flatMap((unit) => unit.sourceRefIds),
        ),
        sourceUnitIds: evidenceUnits.map((unit) => unit.sourceUnitId),
        sourceRefIds: unique(
          evidenceUnits.flatMap((unit) => unit.sourceRefIds),
        ),
      },
    ];
  });
  if (groups.length !== parsedGroups.length) {
    return {
      ...empty,
      effectivityStructured: false,
      unstructuredReason: 'GROUP_RELATION_UNRESOLVED',
    };
  }
  return {
    semanticState: 'CONTENT',
    effectivityStructured: true,
    unstructuredReason: null,
    groups,
  };
}

export function buildSourceBoundAeoProcedure(
  section: SourceBoundSectionWindow,
): SourceBoundAeoProcedure | null {
  if (!isAeoSection(section, 'accomplishment_instructions')) return null;
  const empty: SourceBoundAeoProcedure = {
    semanticState: section.semanticBodyState,
    procedureStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    actions: [],
    branches: [],
    references: [],
  };
  if (section.semanticBodyState !== 'CONTENT') return empty;
  const headerIndexes = section.bodyUnits.flatMap((unit, index) =>
    normalizeLabel(unit.text) === '施工说明accomplishmentinstructions'
      ? [index]
      : [],
  );
  if (headerIndexes.length !== 1) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'PROCEDURE_HEADER_UNRESOLVED',
    };
  }
  const completionIndex = section.bodyUnits.findIndex((unit) =>
    /^Certifies that the work specified/iu.test(unit.text.trim()),
  );
  const procedureEnd =
    completionIndex >= 0 ? completionIndex : section.bodyUnits.length;
  const procedureUnits = section.bodyUnits.slice(
    headerIndexes[0] + 1,
    procedureEnd,
  );
  const markers = procedureUnits.flatMap((unit, index) => {
    const match = unit.text
      .normalize('NFKC')
      .trim()
      .match(/^([1-7])(?![\d).．])(?=[\p{L}\p{Script=Han}])(.*)$/u);
    return match
      ? [{ ordinal: Number(match[1]), index, unit, remainder: match[2].trim() }]
      : [];
  });
  if (
    markers.length !== 7 ||
    markers.some((marker, index) => marker.ordinal !== index + 1)
  ) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'ITEM_SEQUENCE_UNRESOLVED',
    };
  }
  const actions = markers.map((marker, index) => {
    const units = procedureUnits.slice(
      marker.index,
      markers[index + 1]?.index ?? procedureUnits.length,
    );
    const actionTextRaw = units
      .map((unit, unitIndex) =>
        unitIndex === 0 ? marker.remainder : unit.text.trim(),
      )
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    return {
      itemOrdinal: marker.ordinal,
      actionTextRaw,
      sourceUnitIds: units.map((unit) => unit.sourceUnitId),
      sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
      units,
    };
  });
  if (
    actions.some(
      (action) =>
        !action.actionTextRaw ||
        action.sourceUnitIds.length === 0 ||
        action.sourceRefIds.length === 0,
    )
  ) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'ITEM_SEQUENCE_UNRESOLVED',
    };
  }

  const itemTwo = actions[1];
  const yesUnits = itemTwo.units.filter(
    (unit) =>
      /如果包含，则跳至步骤Item\s*4，并对步骤Item\s*3签署N\/A/iu.test(
        unit.text,
      ) ||
      /If Yes, go to Item 4, and sign N\/A for Item 3/iu.test(unit.text),
  );
  const noUnits = itemTwo.units.filter(
    (unit) =>
      /如果不包含，则依次执行后续步骤/iu.test(unit.text) ||
      /If No, perform following Items in sequence/iu.test(unit.text),
  );
  if (yesUnits.length === 0 || noUnits.length === 0) {
    return {
      ...empty,
      procedureStructured: false,
      unstructuredReason: 'CONDITIONAL_BRANCH_UNRESOLVED',
    };
  }
  const branchUnits = uniqueUnits([...yesUnits, ...noUnits]);
  const references = buildProcedureReferences(actions);
  return {
    semanticState: 'CONTENT',
    procedureStructured: true,
    unstructuredReason: null,
    actions: actions.map(({ units: _units, ...action }) => action),
    branches: [
      {
        fromItemOrdinal: 2,
        condition: 'SOFTWARE_ALREADY_PRESENT',
        whenTrue: {
          nextItemOrdinal: 4,
          markItemOrdinalNotApplicable: 3,
        },
        whenFalse: { nextItemOrdinal: 3 },
        sourceUnitIds: branchUnits.map((unit) => unit.sourceUnitId),
        sourceRefIds: unique(
          branchUnits.flatMap((unit) => unit.sourceRefIds),
        ),
      },
    ],
    references,
  };
}

export function buildSourceBoundAeoSoftwareControl(
  section: SourceBoundSectionWindow,
): SourceBoundAeoSoftwareControl | null {
  if (!isAeoSection(section, 'accomplishment_instructions')) return null;
  const empty: SourceBoundAeoSoftwareControl = {
    semanticState: section.semanticBodyState,
    softwareControlStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    assignments: [],
    invalidSoftwareParts: [],
  };
  if (section.semanticBodyState !== 'CONTENT') return empty;
  const invalidHeaderIndex = section.bodyUnits.findIndex(
    (unit) => normalizeLabel(unit.text) === 'softwarenameinvalidsoftwarepn',
  );
  const itemSevenIndex = section.bodyUnits.findIndex((unit) =>
    /^7(?![\d).．])[结束]/u.test(unit.text.normalize('NFKC').trim()),
  );
  if (invalidHeaderIndex < 0 || itemSevenIndex <= invalidHeaderIndex) {
    return {
      ...empty,
      softwareControlStructured: false,
      unstructuredReason: 'INVALID_SOFTWARE_TABLE_UNRESOLVED',
    };
  }

  const assignmentRows = section.bodyUnits
    .slice(0, invalidHeaderIndex)
    .flatMap((unit) => {
      const match = unit.text
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .match(
          /(CCA[A-Z0-9]*\d[A-Z0-9]*-[A-Z0-9]+-[A-Z0-9]+)(Group\s*1|Group\s*2|All\s+Groups)/iu,
        );
      if (!match) return [];
      const groupScope =
        normalizeLabel(match[2]) === 'group1'
          ? ('G1' as const)
          : normalizeLabel(match[2]) === 'group2'
            ? ('G2' as const)
            : ('ALL_GROUPS' as const);
      return [
        {
          partNumber: match[1].toUpperCase(),
          groupScope,
          unit,
        },
      ];
    });
  if (assignmentRows.length === 0) {
    return {
      ...empty,
      softwareControlStructured: false,
      unstructuredReason: 'NEW_SOFTWARE_TABLE_UNRESOLVED',
    };
  }
  const byPartNumber = new Map<string, typeof assignmentRows>();
  for (const row of assignmentRows) {
    const rows = byPartNumber.get(row.partNumber) ?? [];
    rows.push(row);
    byPartNumber.set(row.partNumber, rows);
  }
  if (
    [...byPartNumber.values()].some(
      (rows) => new Set(rows.map((row) => row.groupScope)).size !== 1,
    )
  ) {
    return {
      ...empty,
      softwareControlStructured: false,
      unstructuredReason: 'CONFLICTING_GROUP_SCOPE',
    };
  }
  const assignments = [...byPartNumber]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([partNumber, rows]) => {
      const units = uniqueUnits(rows.map((row) => row.unit));
      return {
        partNumber,
        groupScope: rows[0].groupScope,
        sourceUnitIds: units.map((unit) => unit.sourceUnitId),
        sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
      };
    });

  const invalidRows = section.bodyUnits
    .slice(invalidHeaderIndex + 1, itemSevenIndex)
    .flatMap((unit) => {
      const matches = [
        ...unit.text
          .normalize('NFKC')
          .matchAll(/(CCA[A-Z0-9]*\d[A-Z0-9]*-[A-Z0-9]+-[A-Z0-9]+)/giu),
      ];
      return matches.map((match) => ({
        partNumber: match[1].toUpperCase(),
        unit,
      }));
    });
  const invalidByPartNumber = new Map<string, SourceUnit[]>();
  for (const row of invalidRows) {
    const units = invalidByPartNumber.get(row.partNumber) ?? [];
    units.push(row.unit);
    invalidByPartNumber.set(row.partNumber, units);
  }
  if (invalidByPartNumber.size === 0) {
    return {
      ...empty,
      softwareControlStructured: false,
      unstructuredReason: 'INVALID_SOFTWARE_TABLE_UNRESOLVED',
    };
  }
  const invalidSoftwareParts = [...invalidByPartNumber]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([partNumber, values]) => {
      const units = uniqueUnits(values);
      return {
        partNumber,
        disposition: 'REMOVE_REPLACED_SOFTWARE' as const,
        sourceUnitIds: units.map((unit) => unit.sourceUnitId),
        sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
      };
    });
  return {
    semanticState: 'CONTENT',
    softwareControlStructured: true,
    unstructuredReason: null,
    assignments,
    invalidSoftwareParts,
  };
}

export function buildSourceBoundAeoSafetyBoundary(
  section: SourceBoundSectionWindow,
): SourceBoundAeoSafetyBoundary | null {
  if (!isAeoSection(section, 'safety_checklist')) return null;
  const empty: SourceBoundAeoSafetyBoundary = {
    semanticState: section.semanticBodyState,
    checklistStructured: section.semanticBodyState !== 'CONTENT',
    unstructuredReason: null,
    selectionState: 'UNRESOLVED',
    operationalRequirementInferred: false,
    items: [],
  };
  if (section.semanticBodyState !== 'CONTENT') return empty;
  const items = section.bodyUnits.flatMap((unit) => {
    const match = unit.text.normalize('NFKC').trim().match(/^([AB]\d{2})(.+)$/u);
    return match
      ? [
          {
            itemCode: match[1],
            rawText: match[2].trim(),
            displayedNaMarker: /N\/A$/iu.test(match[2].trim()),
            sourceUnitIds: [unit.sourceUnitId],
            sourceRefIds: [...unit.sourceRefIds],
          },
        ]
      : [];
  });
  const expectedCodes = [
    ...Array.from({ length: 6 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 14 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`),
  ];
  if (
    items.length !== expectedCodes.length ||
    items.some((item, index) => item.itemCode !== expectedCodes[index])
  ) {
    return {
      ...empty,
      checklistStructured: false,
      unstructuredReason: 'CHECKLIST_ITEMS_UNRESOLVED',
    };
  }
  return {
    semanticState: 'CONTENT',
    checklistStructured: true,
    unstructuredReason: null,
    selectionState: 'UNRESOLVED',
    operationalRequirementInferred: false,
    items,
  };
}

function parseAeoGroupRows(units: readonly SourceUnit[]): Array<{
  groupId: string;
  aircraftModel: string;
  declaredAircraftCount: number;
  aircraftRegistrations: string[];
  units: SourceUnit[];
}> | null {
  const starts = units.flatMap((unit, index) => {
    const match = unit.text
      .normalize('NFKC')
      .replace(/\s+/gu, '')
      .match(/^(G\d+)(B\d{3}(?:-\d+)?)(?:\2)?\((\d+)\):(.*)$/u);
    return match
      ? [
          {
            index,
            unit,
            groupId: match[1],
            aircraftModel: match[2],
            declaredAircraftCount: Number(match[3]),
            firstRegistrationText: match[4],
          },
        ]
      : [];
  });
  if (starts.length === 0 || new Set(starts.map((row) => row.groupId)).size !== starts.length) {
    return null;
  }
  const parsed = starts.map((start, index) => {
    const rowUnits = units.slice(start.index, starts[index + 1]?.index ?? units.length);
    const registrationText = [
      start.firstRegistrationText,
      ...rowUnits.slice(1).map((unit) => unit.text),
    ]
      .map((value) => value.normalize('NFKC').replace(/\s+/gu, '').replace(/No$/iu, ''))
      .join('');
    const aircraftRegistrations = [
      ...registrationText.matchAll(/B-\d{4}/gu),
    ].map((match) => match[0]);
    const residual = registrationText
      .replace(/B-\d{4}/gu, '')
      .replace(/[,;]+/gu, '');
    return {
      groupId: start.groupId,
      aircraftModel: start.aircraftModel,
      declaredAircraftCount: start.declaredAircraftCount,
      aircraftRegistrations,
      residual,
      units: rowUnits,
    };
  });
  if (
    parsed.some(
      (row) =>
        row.residual !== '' ||
        row.declaredAircraftCount !== row.aircraftRegistrations.length ||
        new Set(row.aircraftRegistrations).size !== row.aircraftRegistrations.length,
    ) ||
    new Set(parsed.flatMap((row) => row.aircraftRegistrations)).size !==
      parsed.reduce((count, row) => count + row.aircraftRegistrations.length, 0)
  ) {
    return null;
  }
  return parsed.map(({ residual: _residual, ...row }) => row);
}

function parseUniqueRelationRows(
  units: readonly SourceUnit[],
  pattern: RegExp,
): Map<string, { values: string[]; unit: SourceUnit }> | null {
  const rows = units.flatMap((unit) => {
    const match = unit.text.normalize('NFKC').replace(/\s+/gu, '').match(pattern);
    return match
      ? [
          {
            key: match[1],
            values: match.slice(2),
            unit,
          },
        ]
      : [];
  });
  if (rows.length === 0 || new Set(rows.map((row) => row.key)).size !== rows.length) {
    return null;
  }
  return new Map(
    rows.map((row) => [row.key, { values: row.values, unit: row.unit }]),
  );
}

function buildProcedureReferences(
  actions: readonly {
    readonly units: readonly SourceUnit[];
  }[],
): SourceBoundAeoProcedureReference[] {
  const byCode = new Map<string, SourceUnit[]>();
  for (const action of actions) {
    for (const unit of action.units) {
      const matches = [
        ...unit.text
          .normalize('NFKC')
          .matchAll(
            /\b((?:DMC-)?B787-A-\d{2}-\d{2}-\d{2}-\d{2}[A-Z]-\d{3}[A-Z]-[A-Z])\b/giu,
          ),
      ];
      for (const match of matches) {
        const code = match[1].toUpperCase();
        const units = byCode.get(code) ?? [];
        units.push(unit);
        byCode.set(code, units);
      }
    }
  }
  return [...byCode]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([targetDocumentCode, values]) => {
      const units = uniqueUnits(values);
      return {
        relationKind: 'PROCEDURE_REFERENCE' as const,
        targetDocumentKind: 'AIRCRAFT_MAINTENANCE_MANUAL' as const,
        targetDocumentCode,
        sourceUnitIds: units.map((unit) => unit.sourceUnitId),
        sourceRefIds: unique(units.flatMap((unit) => unit.sourceRefIds)),
      };
    });
}

function sameKeys(
  expected: ReadonlySet<string>,
  actual: ReadonlyMap<string, unknown>,
): boolean {
  return (
    expected.size === actual.size &&
    [...expected].every((value) => actual.has(value))
  );
}

function singleNormalizedIndex(
  units: readonly SourceUnit[],
  expected: string,
): number | null {
  const indexes = units.flatMap((unit, index) =>
    normalizeLabel(unit.text) === expected ? [index] : [],
  );
  return indexes.length === 1 ? indexes[0] : null;
}

function isAeoSection(
  section: SourceBoundSectionWindow,
  sectionKey: string,
): boolean {
  return (
    section.family === 'AEO' &&
    section.scopeKey === 'engineering_order' &&
    section.sectionKey === sectionKey
  );
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
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
