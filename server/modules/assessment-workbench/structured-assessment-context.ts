import { ConflictException } from '@nestjs/common';

import type {
  StructuredAssessmentContext,
  StructuredConcurrentRequirementEntry,
  StructuredSourceBinding,
  StructuredWorkInstructionStep,
} from '@shared/assessment-host.interface';

const CONTEXT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.structured_assessment_context.v1' as const;
const APPLICABILITY_PATH = 'coreFields.applicabilityRaw.value';
const CONCURRENT_PATH =
  /^familyFields\.groupSpecificConcurrentRequirements\.value\[(\d+)\]$/u;
const WORK_STEP_PATH =
  /^familyFields\.workInstructionSteps\.value\[(\d+)\]$/u;

interface StructuredObjectRecord {
  id: string;
  record: Record<string, unknown>;
}

export function buildStructuredAssessmentContext(
  records: StructuredObjectRecord[],
): StructuredAssessmentContext {
  const applicabilityRecord = onlyPath(records, APPLICABILITY_PATH);
  const concurrentRecords = indexedPathRecords(records, CONCURRENT_PATH);
  const workStepRecords = indexedPathRecords(records, WORK_STEP_PATH);

  const applicability = applicabilityRecord
    ? {
        availability: 'AVAILABLE_CANDIDATE' as const,
        rawText: requiredString(
          baseTextCell(applicabilityRecord.record.field_value),
          `${APPLICABILITY_PATH}.field_value`,
        ),
        source: sourceBinding(applicabilityRecord),
      }
    : {
        availability: 'MISSING' as const,
        rawText: null,
        source: null,
      };
  const concurrentRequirements = concurrentRecords.map(({ record }) =>
    concurrentEntry(record),
  );
  const rawWorkInstructionSteps = workStepRecords.map(({ record }) =>
    workInstructionStep(record),
  );
  const pathCounts = rawWorkInstructionSteps.reduce((counts, step) => {
    counts.set(step.stepPath, (counts.get(step.stepPath) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const workInstructionSteps = rawWorkInstructionSteps.map((step) => ({
    ...step,
    stepId: pathCounts.get(step.stepPath) === 1
      ? step.stepPath
      : `${step.stepPath}@${step.source.objectId}`,
  }));
  const stepIds = workInstructionSteps.map((step) => step.stepId);
  if (new Set(stepIds).size !== stepIds.length) {
    throw new ConflictException('STRUCTURED_WORK_STEP_ID_DUPLICATE');
  }

  return {
    schemaVersion: CONTEXT_SCHEMA,
    applicability,
    concurrentRequirements: {
      availability:
        concurrentRequirements.length > 0
          ? 'AVAILABLE_CANDIDATE'
          : 'MISSING',
      entries: concurrentRequirements,
    },
    workInstructions: {
      availability:
        workInstructionSteps.length > 0
          ? 'AVAILABLE_CANDIDATE'
          : 'MISSING',
      stepCount: workInstructionSteps.length,
      stepIds,
      steps: workInstructionSteps,
    },
    authorityBoundary: {
      sourceBoundParserCandidateOnly: true,
      documentApplicabilityProvesFleetApplicability: false,
      createsFleetFact: false,
      createsEvidenceRef: false,
      createsEngineerDecision: false,
    },
  };
}

export function missingStructuredAssessmentContext(): StructuredAssessmentContext {
  return {
    schemaVersion: CONTEXT_SCHEMA,
    applicability: {
      availability: 'MISSING',
      rawText: null,
      source: null,
    },
    concurrentRequirements: {
      availability: 'MISSING',
      entries: [],
    },
    workInstructions: {
      availability: 'MISSING',
      stepCount: 0,
      stepIds: [],
      steps: [],
    },
    authorityBoundary: {
      sourceBoundParserCandidateOnly: true,
      documentApplicabilityProvesFleetApplicability: false,
      createsFleetFact: false,
      createsEvidenceRef: false,
      createsEngineerDecision: false,
    },
  };
}

function concurrentEntry(
  record: StructuredObjectRecord,
): StructuredConcurrentRequirementEntry {
  const value = fieldValueObject(record);
  const requirementState = requiredString(
    value.requirementState,
    'requirementState',
  );
  const documentRequirements = optionalStringArray(
    value.documentRequirements,
    'documentRequirements',
  );
  const nonDocumentRequirements = optionalStringArray(
    value.nonDocumentRequirements,
    'nonDocumentRequirements',
  );
  return {
    requirementState,
    normalizedPresence: normalizeRequirementPresence(requirementState),
    requirementsStructured:
      documentRequirements.present && nonDocumentRequirements.present,
    documentRequirements: documentRequirements.values,
    nonDocumentRequirements: nonDocumentRequirements.values,
    retrievalEvaluationLoopRequired: optionalBoolean(
      value.retrievalEvaluationLoopRequired,
      'retrievalEvaluationLoopRequired',
    ),
    rawText: optionalString(value.rawText),
    source: sourceBinding(record),
  };
}

function workInstructionStep(
  record: StructuredObjectRecord,
): Omit<StructuredWorkInstructionStep, 'stepId'> {
  const value = fieldValueObject(record);
  return {
    stepPath: requiredString(value.stepPath, 'stepPath'),
    stepLabel: requiredString(value.stepLabel, 'stepLabel'),
    instructionText: requiredString(value.instructionText, 'instructionText'),
    workPackageNumber: optionalString(value.workPackageNumber),
    workPackageLabel: optionalString(value.workPackageLabel),
    workPackageTitle: optionalString(value.workPackageTitle),
    sourcePage: optionalNumber(value.sourcePage, 'sourcePage'),
    source: sourceBinding(record),
  };
}

function sourceBinding(record: StructuredObjectRecord): StructuredSourceBinding {
  const row = record.record;
  const objectId = requiredString(baseTextCell(row.element_id), 'element_id');
  const sourceUnitIds = stringArray(
    parseJson(row.source_unit_ids_json, `source_unit_ids_json:${objectId}`),
    `source_unit_ids_json:${objectId}`,
  );
  if (sourceUnitIds.length === 0) {
    throw new ConflictException(`STRUCTURED_SOURCE_UNIT_IDS_EMPTY:${objectId}`);
  }
  const sourceRefs = objectArray(
    parseJson(row.source_refs_json, `source_refs_json:${objectId}`),
    `source_refs_json:${objectId}`,
  );
  if (sourceRefs.length === 0) {
    throw new ConflictException(`STRUCTURED_SOURCE_REFS_EMPTY:${objectId}`);
  }
  return {
    structurePath: requiredString(
      baseTextCell(row.structure_path),
      'structure_path',
    ),
    objectId,
    objectHash: requiredString(baseTextCell(row.object_hash), 'object_hash'),
    sourceUnitIds,
    sourceRefs,
  };
}

function onlyPath(
  records: StructuredObjectRecord[],
  path: string,
): StructuredObjectRecord | null {
  const matches = records.filter(
    (record) => optionalString(baseTextCell(record.record.structure_path)) === path,
  );
  if (matches.length > 1) {
    throw new ConflictException(
      `STRUCTURED_OBJECT_PATH_CARDINALITY_INVALID:${path}:${matches.length}`,
    );
  }
  return matches[0] ?? null;
}

function indexedPathRecords(
  records: StructuredObjectRecord[],
  pattern: RegExp,
): Array<{ index: number; record: StructuredObjectRecord }> {
  return records
    .map((record) => {
      const path = optionalString(baseTextCell(record.record.structure_path));
      const match = path?.match(pattern);
      return match
        ? { index: Number(match[1]), record }
        : null;
    })
    .filter(
      (value): value is { index: number; record: StructuredObjectRecord } =>
        value !== null,
    )
    .sort((left, right) => left.index - right.index);
}

function fieldValueObject(record: StructuredObjectRecord): Record<string, unknown> {
  const objectId = requiredString(
    baseTextCell(record.record.element_id),
    'element_id',
  );
  const value = parseJson(
    record.record.field_value_json,
    `field_value_json:${objectId}`,
  );
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConflictException(
      `STRUCTURED_FIELD_VALUE_OBJECT_INVALID:${objectId}`,
    );
  }
  return value as Record<string, unknown>;
}

function parseJson(value: unknown, field: string): unknown {
  const text = optionalString(baseTextCell(value));
  if (!text) {
    throw new ConflictException(`STRUCTURED_JSON_MISSING:${field}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConflictException(`STRUCTURED_JSON_INVALID:${field}`);
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ConflictException(`STRUCTURED_STRING_ARRAY_INVALID:${field}`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function optionalStringArray(
  value: unknown,
  field: string,
): { present: boolean; values: string[] } {
  if (value === null || value === undefined) {
    return { present: false, values: [] };
  }
  return { present: true, values: stringArray(value, field) };
}

function normalizeRequirementPresence(
  requirementState: string,
): 'NONE' | 'PRESENT' | 'UNKNOWN' {
  const normalized = requirementState.toLowerCase();
  if (normalized === 'none') return 'NONE';
  if (normalized === 'unknown') return 'UNKNOWN';
  return 'PRESENT';
}

function objectArray(
  value: unknown,
  field: string,
): Array<Record<string, unknown>> {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => !item || typeof item !== 'object' || Array.isArray(item),
    )
  ) {
    throw new ConflictException(`STRUCTURED_OBJECT_ARRAY_INVALID:${field}`);
  }
  return value as Array<Record<string, unknown>>;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new ConflictException(`STRUCTURED_TEXT_MISSING:${field}`);
  }
  return normalized;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function baseTextCell(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).text === 'string',
      )
    ) {
      return value
        .map((item) => String((item as Record<string, unknown>).text))
        .join('');
    }
    if (value.length === 1) return baseTextCell(value[0]);
    throw new ConflictException('STRUCTURED_BASE_TEXT_CARDINALITY_INVALID');
  }
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const key of ['text', 'name', 'value']) {
      if (typeof row[key] === 'string') return row[key];
    }
  }
  throw new ConflictException('STRUCTURED_BASE_TEXT_VALUE_INVALID');
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') {
    throw new ConflictException(`STRUCTURED_BOOLEAN_INVALID:${field}`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConflictException(`STRUCTURED_NUMBER_INVALID:${field}`);
  }
  return value;
}
