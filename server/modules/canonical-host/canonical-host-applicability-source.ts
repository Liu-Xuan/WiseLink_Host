import type {
  CanonicalWorkItemProjection,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import { canonicalSha256 } from '../action-attempt/action-attempt-envelope';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import type { ApplicabilityTaskSourceExpression } from './canonical-host-openclaw-applicability.contract';

export interface CanonicalFrozenApplicabilitySourceBinding {
  sourceExpressions: ApplicabilityTaskSourceExpression[];
  targetBindingHash: string;
}

/**
 * Parses the already full-validated frozen.2 package into the one Host-owned
 * expression-to-target binding used by EXTRACT_APPLICABILITY. This is a
 * binding reader only; it does not parse or evaluate applicability predicates.
 */
export function readFrozenApplicabilitySourceBinding(input: {
  bytes: Uint8Array;
  workItem: CanonicalWorkItemProjection;
  sourceUnits: UnifiedReaderQueryResult[];
}): CanonicalFrozenApplicabilitySourceBinding {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  assertNoDuplicateJsonKeys(text);
  const pkg = record(
    JSON.parse(text) as unknown,
    'APPLICABILITY_FROZEN_PACKAGE_INVALID',
  );
  const applicability = record(
    pkg.applicability,
    'APPLICABILITY_FROZEN_BLOCK_INVALID',
  );
  const knownRefs = new Set(
    array(pkg.sourceRefs, 'APPLICABILITY_SOURCE_REFS_INVALID').map((value) =>
      requiredText(
        record(value, 'APPLICABILITY_SOURCE_REF_INVALID').sourceRefId,
        'APPLICABILITY_SOURCE_REF_ID_REQUIRED',
      ),
    ),
  );
  const moduleIds = new Set(
    array(pkg.modules, 'APPLICABILITY_MODULES_INVALID').map((value) =>
      requiredText(
        record(value, 'APPLICABILITY_MODULE_INVALID').moduleId,
        'APPLICABILITY_MODULE_ID_REQUIRED',
      ),
    ),
  );
  const sourceUnitById = new Map(
    input.sourceUnits.map((unit) => [unit.unitId, unit]),
  );
  const expressionRows = array(
    applicability.sourceExpressions,
    'APPLICABILITY_SOURCE_EXPRESSIONS_INVALID',
  );
  const assignmentRows = array(
    applicability.assignments,
    'APPLICABILITY_ASSIGNMENTS_INVALID',
  );
  const expected = input.workItem.package?.usagePolicy?.applicability;
  if (
    (expected?.sourceExpressionCount !== undefined &&
      expected.sourceExpressionCount !== expressionRows.length) ||
    (expected?.assignmentCount !== undefined &&
      expected.assignmentCount !== assignmentRows.length)
  ) {
    throw new Error('APPLICABILITY_FROZEN_USAGE_COUNT_DRIFT');
  }

  const assignmentByExpression = new Map<string, Record<string, unknown>>();
  const assignmentIds = new Set<string>();
  for (const value of assignmentRows) {
    const assignment = record(value, 'APPLICABILITY_ASSIGNMENT_INVALID');
    const assignmentId = requiredText(
      assignment.assignmentId,
      'APPLICABILITY_ASSIGNMENT_ID_REQUIRED',
    );
    const expressionId = requiredText(
      assignment.expressionId,
      'APPLICABILITY_ASSIGNMENT_EXPRESSION_ID_REQUIRED',
    );
    if (
      assignment.authority !== 'source_asserted' ||
      assignmentIds.has(assignmentId) ||
      assignmentByExpression.has(expressionId)
    ) {
      throw new Error('APPLICABILITY_ASSIGNMENT_NOT_UNIQUE');
    }
    assignmentIds.add(assignmentId);
    assignmentByExpression.set(expressionId, assignment);
  }

  const expressionIds = new Set<string>();
  const sourceExpressions = expressionRows.map((value) => {
    const expression = record(value, 'APPLICABILITY_SOURCE_EXPRESSION_INVALID');
    const expressionId = requiredText(
      expression.expressionId,
      'APPLICABILITY_SOURCE_EXPRESSION_ID_REQUIRED',
    );
    const sourceRefIds = requiredStringArray(
      expression.sourceRefIds,
      'APPLICABILITY_SOURCE_EXPRESSION_REFS_INVALID',
    );
    const assignment = assignmentByExpression.get(expressionId);
    if (
      expression.authority !== 'source_asserted' ||
      expressionIds.has(expressionId) ||
      !assignment ||
      sourceRefIds.some((sourceRefId) => !knownRefs.has(sourceRefId))
    ) {
      throw new Error('APPLICABILITY_SOURCE_EXPRESSION_BINDING_INVALID');
    }
    expressionIds.add(expressionId);
    const target = record(
      assignment.target,
      'APPLICABILITY_ASSIGNMENT_TARGET_INVALID',
    );
    const targetKind = requiredTargetKind(target.kind);
    const targetId =
      target.targetId === undefined || target.targetId === null
        ? null
        : requiredText(
            target.targetId,
            'APPLICABILITY_ASSIGNMENT_TARGET_ID_INVALID',
          );
    const targetSourceRefIds = requiredStringArray(
      target.sourceRefIds,
      'APPLICABILITY_ASSIGNMENT_TARGET_REFS_INVALID',
    );
    if (targetSourceRefIds.some((sourceRefId) => !knownRefs.has(sourceRefId))) {
      throw new Error('APPLICABILITY_ASSIGNMENT_TARGET_BINDING_INVALID');
    }
    const applicabilityLevel =
      targetKind === 'module' ? 'document_effectivity' : 'inline';
    const contentRef = targetKind === 'module' ? null : targetId;
    if (
      (targetKind === 'module' &&
        targetId !== null &&
        !moduleIds.has(targetId)) ||
      (targetKind !== 'module' && targetId === null)
    ) {
      throw new Error('APPLICABILITY_ASSIGNMENT_TARGET_BINDING_INVALID');
    }
    if (targetKind === 'content_unit') {
      const unit = sourceUnitById.get(targetId!);
      if (
        !unit ||
        targetSourceRefIds.some(
          (sourceRefId) => !unit.sourceRefIds.includes(sourceRefId),
        )
      ) {
        throw new Error('APPLICABILITY_ASSIGNMENT_TARGET_BINDING_INVALID');
      }
    }
    return {
      expressionId,
      text: requiredText(
        expression.text,
        'APPLICABILITY_SOURCE_EXPRESSION_TEXT_REQUIRED',
      ),
      sourceRefIds,
      assignmentId: requiredText(
        assignment.assignmentId,
        'APPLICABILITY_ASSIGNMENT_ID_REQUIRED',
      ),
      targetKind,
      targetId,
      targetSourceRefIds,
      applicabilityLevel,
      contentRef,
    } satisfies ApplicabilityTaskSourceExpression;
  });
  if (
    sourceExpressions.length === 0 ||
    sourceExpressions.length !== assignmentRows.length ||
    [...assignmentByExpression.keys()].some(
      (expressionId) => !expressionIds.has(expressionId),
    )
  ) {
    throw new Error('APPLICABILITY_EXPRESSION_TARGET_MAPPING_REQUIRED');
  }
  return {
    sourceExpressions,
    targetBindingHash: canonicalSha256(
      sourceExpressions.map((expression) => ({
        expressionId: expression.expressionId,
        sourceRefIds: expression.sourceRefIds,
        assignmentId: expression.assignmentId,
        targetKind: expression.targetKind,
        targetId: expression.targetId,
        targetSourceRefIds: expression.targetSourceRefIds,
        applicabilityLevel: expression.applicabilityLevel,
        contentRef: expression.contentRef,
      })),
    ),
  };
}

function requiredTargetKind(
  value: unknown,
): ApplicabilityTaskSourceExpression['targetKind'] {
  if (!['module', 'content_unit', 'source_element'].includes(String(value))) {
    throw new Error('APPLICABILITY_ASSIGNMENT_TARGET_KIND_INVALID');
  }
  return value as ApplicabilityTaskSourceExpression['targetKind'];
}

function requiredStringArray(value: unknown, code: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !item.trim()) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(code);
  }
  return [...value] as string[];
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}
