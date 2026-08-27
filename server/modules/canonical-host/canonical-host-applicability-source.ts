import type {
  CanonicalWorkItemProjection,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import { canonicalSha256 } from '../action-attempt/action-attempt-envelope';
import type {
  ApplicabilityAstNode,
  ApplicabilityFragment,
} from '../assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import { getRegistry } from '../assessment-workbench/applicability-fleet/applicabilityPropertyRegistry';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import type { ApplicabilityTaskSourceExpression } from './canonical-host-openclaw-applicability.contract';

export interface CanonicalFrozenApplicabilitySourceBinding {
  sourceExpressions: ApplicabilityTaskSourceExpression[];
  deterministicFragments: ApplicabilityFragment[];
  targetBindingHash: string;
}

/**
 * Parses the already full-validated frozen.2 package into the one Host-owned
 * expression-to-target binding used by EXTRACT_APPLICABILITY. Deterministic
 * normalized candidates already produced inside frozen.2 are mapped onto the
 * existing Host evaluator AST; this reader neither extracts source text nor
 * evaluates Fleet facts.
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
  const normalizedCandidateRows = array(
    applicability.normalizedCandidates,
    'APPLICABILITY_NORMALIZED_CANDIDATES_INVALID',
  );
  const expected = input.workItem.package?.usagePolicy?.applicability;
  if (
    (expected?.sourceExpressionCount !== undefined &&
      expected.sourceExpressionCount !== expressionRows.length) ||
    (expected?.normalizedCandidateCount !== undefined &&
      expected.normalizedCandidateCount !== normalizedCandidateRows.length) ||
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
  const sourceExpressionById = new Map(
    sourceExpressions.map((expression) => [
      expression.expressionId,
      expression,
    ]),
  );
  const deterministicExpressionIds = new Set<string>();
  const deterministicFragments = normalizedCandidateRows.flatMap((value) => {
    const candidate = record(
      value,
      'APPLICABILITY_NORMALIZED_CANDIDATE_INVALID',
    );
    requiredText(
      candidate.candidateId,
      'APPLICABILITY_NORMALIZED_CANDIDATE_ID_REQUIRED',
    );
    if (
      candidate.language !== 'techpub-applicability-expr.v1' ||
      candidate.authority !== 'parser_candidate'
    ) {
      throw new Error('APPLICABILITY_NORMALIZED_CANDIDATE_INVALID');
    }
    const sourceExpressionIds = requiredStringArray(
      candidate.sourceExpressionIds,
      'APPLICABILITY_NORMALIZED_CANDIDATE_SOURCE_IDS_INVALID',
    );
    if (
      sourceExpressionIds.some(
        (expressionId) => !sourceExpressionById.has(expressionId),
      )
    ) {
      throw new Error('APPLICABILITY_NORMALIZED_CANDIDATE_BINDING_INVALID');
    }
    if (candidate.confidence !== 'deterministic') return [];
    const expressionAst = deterministicExpressionAst(candidate.expression);
    return sourceExpressionIds.map((expressionId) => {
      if (deterministicExpressionIds.has(expressionId)) {
        throw new Error('APPLICABILITY_DETERMINISTIC_CANDIDATE_NOT_UNIQUE');
      }
      deterministicExpressionIds.add(expressionId);
      const sourceExpression = sourceExpressionById.get(expressionId)!;
      return {
        ruleFragmentId: expressionId,
        extractionStatus: 'extracted',
        applicabilityLevel: sourceExpression.applicabilityLevel,
        contentRef: sourceExpression.contentRef,
        expressionAst: structuredClone(expressionAst),
      } satisfies ApplicabilityFragment;
    });
  });
  return {
    sourceExpressions,
    deterministicFragments,
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

function deterministicExpressionAst(value: unknown): ApplicabilityAstNode {
  const expression = record(
    value,
    'APPLICABILITY_DETERMINISTIC_EXPRESSION_INVALID',
  );
  if (expression.operator === 'predicate') {
    return deterministicPredicateAst(expression.predicate);
  }
  const children = array(
    expression.children,
    'APPLICABILITY_DETERMINISTIC_EXPRESSION_CHILDREN_INVALID',
  );
  if (expression.operator === 'not') {
    if (children.length !== 1) {
      throw new Error('APPLICABILITY_DETERMINISTIC_NOT_ARITY_INVALID');
    }
    return { type: 'not', child: deterministicExpressionAst(children[0]) };
  }
  if (
    !['all', 'any'].includes(String(expression.operator)) ||
    children.length === 0
  ) {
    throw new Error('APPLICABILITY_DETERMINISTIC_OPERATOR_UNSUPPORTED');
  }
  return {
    type: expression.operator === 'all' ? 'and' : 'or',
    children: children.map(deterministicExpressionAst),
  };
}

function deterministicPredicateAst(value: unknown): ApplicabilityAstNode {
  const predicate = record(
    value,
    'APPLICABILITY_DETERMINISTIC_PREDICATE_INVALID',
  );
  const property = requiredText(
    predicate.property,
    'APPLICABILITY_DETERMINISTIC_PROPERTY_REQUIRED',
  );
  const operator = requiredText(
    predicate.comparator,
    'APPLICABILITY_DETERMINISTIC_COMPARATOR_REQUIRED',
  );
  const values = array(
    predicate.values,
    'APPLICABILITY_DETERMINISTIC_VALUES_INVALID',
  );
  const definition = getRegistry().properties.find(
    (entry) => entry.property === property,
  );
  if (!definition || !definition.supportedOperators.includes(operator)) {
    throw new Error('APPLICABILITY_DETERMINISTIC_PREDICATE_UNSUPPORTED');
  }
  if (definition.qualifierNormalizer !== null) {
    if (
      definition.valueType !== 'boolean' ||
      !['eq', 'neq'].includes(operator) ||
      values.length !== 1 ||
      typeof values[0] !== 'string' ||
      !values[0].trim()
    ) {
      throw new Error('APPLICABILITY_DETERMINISTIC_QUALIFIER_INVALID');
    }
    return {
      type: 'assert',
      property,
      operator,
      value: true,
      qualifier: values[0],
    };
  }
  let expectedValue: unknown;
  if (['eq', 'neq', 'gte', 'lte'].includes(operator)) {
    if (values.length !== 1) {
      throw new Error('APPLICABILITY_DETERMINISTIC_VALUE_ARITY_INVALID');
    }
    [expectedValue] = values;
  } else if (['in', 'not_in'].includes(operator)) {
    if (values.length === 0) {
      throw new Error('APPLICABILITY_DETERMINISTIC_VALUE_ARITY_INVALID');
    }
    expectedValue = [...values];
  } else if (operator === 'range') {
    if (values.length !== 2) {
      throw new Error('APPLICABILITY_DETERMINISTIC_VALUE_ARITY_INVALID');
    }
    expectedValue = { min: values[0], max: values[1] };
  } else {
    throw new Error('APPLICABILITY_DETERMINISTIC_PREDICATE_UNSUPPORTED');
  }
  return { type: 'assert', property, operator, value: expectedValue };
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
