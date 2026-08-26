import type { ApplicabilityAstNode } from '../assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import {
  getRegistry,
  type ApplicabilityPropertyDefinition,
} from '../assessment-workbench/applicability-fleet/applicabilityPropertyRegistry';

export const APPLICABILITY_TASK_SCHEMA_VERSION =
  'wiselink.3_1.applicability_task.v1' as const;
export const APPLICABILITY_CANDIDATE_SCHEMA_VERSION =
  'wiselink.3_1.applicability_candidate.v1' as const;
export const APPLICABILITY_ARTIFACT_SCHEMA_VERSION =
  'wiselink.3_1.applicability_candidate_artifact.v1' as const;
export const APPLICABILITY_MCP_SERVER_NAME =
  'wiselink-openclaw-engineering-assessment' as const;
export const APPLICABILITY_MCP_SERVER_VERSION = '1.2.0' as const;
export const APPLICABILITY_RUNTIME_APP_ID = 'app_17c3zn24kv2' as const;
export const APPLICABILITY_PROFILE_REF = 'wiselink-engineering' as const;
export const APPLICABILITY_MODEL_VERSION = 'GLM-5.1' as const;
export const APPLICABILITY_PROMPT_VERSION =
  'wiselink-applicability-extraction@r09.c4' as const;
export const APPLICABILITY_SKILL_VERSION =
  'wiselink-research-and-synthesize@r09.applicability.c4' as const;

export interface ApplicabilityTaskSourceExpression {
  expressionId: string;
  text: string;
  sourceRefIds: string[];
  assignmentId: string;
  targetKind: 'module' | 'content_unit' | 'source_element';
  targetId: string | null;
  targetSourceRefIds: string[];
  applicabilityLevel: 'document_effectivity' | 'inline';
  contentRef: string | null;
}

export interface ApplicabilityTaskBilingualSourceUnit {
  unitId: string;
  kind: string;
  sourceText: string;
  translatedText: string;
  sourceRefIds: string[];
}

export interface ApplicabilityTaskContract {
  schemaVersion: typeof APPLICABILITY_TASK_SCHEMA_VERSION;
  operation: 'EXTRACT_APPLICABILITY';
  applicabilityContextRef: string;
  inputRevision: number;
  documentVersionRef: string;
  sourcePackage: { packageId: string; contentHash: string };
  bilingualBinding: {
    actionAttemptId: string;
    artifactSha256: string;
  } | null;
  aircraft: { aircraftNumber: string; assessmentAsOf: string };
  fleetBinding: {
    bindingRevision: string;
    selectionRevision: string;
    sourceSnapshotId: string | null;
    sourceRevisionKey: string | null;
    authorityRevision: string | null;
    sourceAsOf: string | null;
  };
  controlledAircraft: {
    assetId: string;
    assetVersionId: string;
    aircraftNumber: string;
    fleetFamily: string | null;
    aircraftModel: string | null;
    series: string | null;
    msn: string | null;
    lineNumber: number | null;
    deliveryDate: string | null;
    recordHash: string;
  } | null;
  controlledFacts: Array<{
    factId: string;
    factType: string;
    property: string;
    qualifier: string | null;
    value: unknown;
    validAsOf: string | null;
    recordHash: string;
  }>;
  sourceExpressions: ApplicabilityTaskSourceExpression[];
  bilingualSourceUnits: ApplicabilityTaskBilingualSourceUnit[];
  runtimePolicy: ApplicabilityRuntimeProvenance;
  authority: {
    candidateOnly: true;
    documentTextDoesNotProveFleetApplicability: true;
    hostDeterministicEvaluationRequired: true;
  };
}

export interface ApplicabilityRuntimeProvenance {
  runtimeAppId: typeof APPLICABILITY_RUNTIME_APP_ID;
  profileRef: typeof APPLICABILITY_PROFILE_REF;
  modelVersion: typeof APPLICABILITY_MODEL_VERSION;
  promptVersion: typeof APPLICABILITY_PROMPT_VERSION;
  skillVersion: typeof APPLICABILITY_SKILL_VERSION;
  mcpServerName: typeof APPLICABILITY_MCP_SERVER_NAME;
  mcpServerVersion: typeof APPLICABILITY_MCP_SERVER_VERSION;
}

export interface ApplicabilityCandidateExpression {
  expressionId: string;
  sourceRefIds: string[];
  extractionStatus: 'extracted';
  expressionAst: ApplicabilityAstNode;
}

export interface ApplicabilityCandidateContract {
  schemaVersion: typeof APPLICABILITY_CANDIDATE_SCHEMA_VERSION;
  operation: 'EXTRACT_APPLICABILITY';
  candidateStatus: 'CANDIDATE';
  inputRevision: number;
  documentVersionRef: string;
  sourcePackage: { packageId: string; contentHash: string };
  bilingualBinding: ApplicabilityTaskContract['bilingualBinding'];
  aircraft: ApplicabilityTaskContract['aircraft'];
  fleetBinding: ApplicabilityTaskContract['fleetBinding'];
  expressions: ApplicabilityCandidateExpression[];
  runtime: ApplicabilityRuntimeProvenance;
  authority: {
    candidateOnly: true;
    createsEvidenceRef: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
    createsAirworthinessConclusion: false;
  };
}

export function applicabilityRuntimePolicy(): ApplicabilityRuntimeProvenance {
  return {
    runtimeAppId: APPLICABILITY_RUNTIME_APP_ID,
    profileRef: APPLICABILITY_PROFILE_REF,
    modelVersion: APPLICABILITY_MODEL_VERSION,
    promptVersion: APPLICABILITY_PROMPT_VERSION,
    skillVersion: APPLICABILITY_SKILL_VERSION,
    mcpServerName: APPLICABILITY_MCP_SERVER_NAME,
    mcpServerVersion: APPLICABILITY_MCP_SERVER_VERSION,
  };
}

export function parseApplicabilityCandidate(
  value: unknown,
): ApplicabilityCandidateContract {
  const candidate = record(value, 'APPLICABILITY_CANDIDATE_INVALID');
  exactKeys(candidate, [
    'schemaVersion',
    'operation',
    'candidateStatus',
    'inputRevision',
    'documentVersionRef',
    'sourcePackage',
    'bilingualBinding',
    'aircraft',
    'fleetBinding',
    'expressions',
    'runtime',
    'authority',
  ]);
  if (
    candidate.schemaVersion !== APPLICABILITY_CANDIDATE_SCHEMA_VERSION ||
    candidate.operation !== 'EXTRACT_APPLICABILITY' ||
    candidate.candidateStatus !== 'CANDIDATE' ||
    !Number.isSafeInteger(candidate.inputRevision) ||
    Number(candidate.inputRevision) < 0
  ) {
    fail('APPLICABILITY_CANDIDATE_BINDING_INVALID');
  }
  const parsed: ApplicabilityCandidateContract = {
    schemaVersion: APPLICABILITY_CANDIDATE_SCHEMA_VERSION,
    operation: 'EXTRACT_APPLICABILITY',
    candidateStatus: 'CANDIDATE',
    inputRevision: Number(candidate.inputRevision),
    documentVersionRef: text(
      candidate.documentVersionRef,
      'APPLICABILITY_DOCUMENT_VERSION_REQUIRED',
    ),
    sourcePackage: parseSourcePackage(candidate.sourcePackage),
    bilingualBinding: parseBilingualBinding(candidate.bilingualBinding),
    aircraft: parseAircraft(candidate.aircraft),
    fleetBinding: parseFleetBinding(candidate.fleetBinding),
    expressions: array(
      candidate.expressions,
      'APPLICABILITY_EXPRESSIONS_INVALID',
    ).map(parseCandidateExpression),
    runtime: parseRuntime(candidate.runtime),
    authority: parseAuthority(candidate.authority),
  };
  if (parsed.expressions.length === 0 || parsed.expressions.length > 200) {
    fail('APPLICABILITY_EXPRESSIONS_INVALID');
  }
  return parsed;
}

export function validateApplicabilityCandidateBinding(
  candidate: ApplicabilityCandidateContract,
  task: ApplicabilityTaskContract,
): void {
  const expectedExpressions = new Map(
    task.sourceExpressions.map((expression) => [
      expression.expressionId,
      expression,
    ]),
  );
  if (
    candidate.inputRevision !== task.inputRevision ||
    candidate.documentVersionRef !== task.documentVersionRef ||
    stable(candidate.sourcePackage) !== stable(task.sourcePackage) ||
    stable(candidate.bilingualBinding) !== stable(task.bilingualBinding) ||
    stable(candidate.aircraft) !== stable(task.aircraft) ||
    stable(candidate.fleetBinding) !== stable(task.fleetBinding) ||
    stable(candidate.runtime) !== stable(task.runtimePolicy) ||
    candidate.expressions.length !== task.sourceExpressions.length
  ) {
    fail('APPLICABILITY_CANDIDATE_TASK_BINDING_MISMATCH');
  }
  const seen = new Set<string>();
  for (const expression of candidate.expressions) {
    const expected = expectedExpressions.get(expression.expressionId);
    if (
      !expected ||
      seen.has(expression.expressionId) ||
      stable(expression.sourceRefIds) !== stable(expected.sourceRefIds)
    ) {
      fail('APPLICABILITY_CANDIDATE_SOURCE_REF_MISMATCH');
    }
    seen.add(expression.expressionId);
  }
}

function parseCandidateExpression(
  value: unknown,
): ApplicabilityCandidateExpression {
  const expression = record(value, 'APPLICABILITY_EXPRESSION_INVALID');
  exactKeys(expression, [
    'expressionId',
    'sourceRefIds',
    'extractionStatus',
    'expressionAst',
  ]);
  if (expression.extractionStatus !== 'extracted') {
    fail('APPLICABILITY_EXPRESSION_STATUS_INVALID');
  }
  return {
    expressionId: text(
      expression.expressionId,
      'APPLICABILITY_EXPRESSION_ID_REQUIRED',
    ),
    sourceRefIds: stringArray(
      expression.sourceRefIds,
      'APPLICABILITY_EXPRESSION_SOURCE_REFS_INVALID',
    ),
    extractionStatus: 'extracted',
    expressionAst: parseAst(expression.expressionAst),
  };
}

function parseAst(
  value: unknown,
  depth = 0,
  budget = { count: 0 },
): ApplicabilityAstNode {
  if (depth > 24 || ++budget.count > 500) fail('APPLICABILITY_AST_TOO_COMPLEX');
  const node = record(value, 'APPLICABILITY_AST_INVALID');
  const type = text(node.type, 'APPLICABILITY_AST_TYPE_REQUIRED');
  if (type === 'literal') {
    exactKeys(node, ['type', 'value']);
    if (typeof node.value !== 'boolean')
      fail('APPLICABILITY_AST_LITERAL_INVALID');
    return { type, value: node.value };
  }
  if (type === 'assert') {
    exactKeys(
      node,
      Object.prototype.hasOwnProperty.call(node, 'qualifier')
        ? ['type', 'property', 'operator', 'value', 'qualifier']
        : ['type', 'property', 'operator', 'value'],
    );
    const property = text(node.property, 'APPLICABILITY_AST_PROPERTY_REQUIRED');
    const operator = text(node.operator, 'APPLICABILITY_AST_OPERATOR_REQUIRED');
    const definition = getRegistry().properties.find(
      (entry) => entry.property === property,
    );
    if (!definition || !definition.supportedOperators.includes(operator)) {
      fail('APPLICABILITY_AST_ASSERT_UNSUPPORTED');
    }
    const qualifier =
      node.qualifier === undefined || node.qualifier === null
        ? null
        : text(node.qualifier, 'APPLICABILITY_AST_QUALIFIER_INVALID');
    if ((definition.qualifierNormalizer !== null) !== (qualifier !== null)) {
      fail('APPLICABILITY_AST_QUALIFIER_INVALID');
    }
    const parsedValue = parseAssertValue(node.value, operator, definition);
    return {
      type,
      property,
      operator,
      value: parsedValue,
      ...(qualifier === null ? {} : { qualifier }),
    };
  }
  if (type === 'and' || type === 'or') {
    exactKeys(node, ['type', 'children']);
    const children = array(node.children, 'APPLICABILITY_AST_CHILDREN_INVALID');
    if (children.length === 0 || children.length > 100) {
      fail('APPLICABILITY_AST_CHILDREN_INVALID');
    }
    return {
      type,
      children: children.map((child) => parseAst(child, depth + 1, budget)),
    };
  }
  if (type === 'not') {
    exactKeys(node, ['type', 'child']);
    return { type, child: parseAst(node.child, depth + 1, budget) };
  }
  fail('APPLICABILITY_AST_TYPE_UNSUPPORTED');
}

function parseAssertValue(
  value: unknown,
  operator: string,
  definition: ApplicabilityPropertyDefinition,
): unknown {
  if (definition.valueType === 'boolean') {
    if (typeof value !== 'boolean')
      fail('APPLICABILITY_AST_VALUE_TYPE_INVALID');
    return value;
  }
  if (operator === 'in' || operator === 'not_in') {
    const values = array(value, 'APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    if (values.length === 0 || values.length > 200) {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    const parsed = values.map((item) =>
      parseScalarAssertValue(item, definition),
    );
    if (new Set(parsed.map((item) => stable(item))).size !== parsed.length) {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    return parsed;
  }
  if (operator === 'range') {
    if (definition.valueType !== 'number' && definition.valueType !== 'date') {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    const range = record(value, 'APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    const keys = Object.keys(range).sort();
    if (
      keys.length === 0 ||
      keys.some((key) => key !== 'max' && key !== 'min')
    ) {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    const parsed: { min?: number | string; max?: number | string } = {};
    if (Object.prototype.hasOwnProperty.call(range, 'min')) {
      parsed.min = parseScalarAssertValue(range.min, definition) as
        | number
        | string;
    }
    if (Object.prototype.hasOwnProperty.call(range, 'max')) {
      parsed.max = parseScalarAssertValue(range.max, definition) as
        | number
        | string;
    }
    if (
      parsed.min !== undefined &&
      parsed.max !== undefined &&
      parsed.min > parsed.max
    ) {
      fail('APPLICABILITY_AST_VALUE_RANGE_INVALID');
    }
    return parsed;
  }
  return parseScalarAssertValue(value, definition);
}

function parseScalarAssertValue(
  value: unknown,
  definition: ApplicabilityPropertyDefinition,
): boolean | number | string {
  if (definition.valueType === 'boolean') {
    if (typeof value !== 'boolean')
      fail('APPLICABILITY_AST_VALUE_TYPE_INVALID');
    return value;
  }
  if (definition.valueType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail('APPLICABILITY_AST_VALUE_TYPE_INVALID');
    }
    return value;
  }
  if (definition.valueType === 'date') {
    if (typeof value !== 'string' || !isIsoDate(value)) {
      fail('APPLICABILITY_AST_VALUE_TYPE_INVALID');
    }
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    fail('APPLICABILITY_AST_VALUE_TYPE_INVALID');
  }
  return value;
}

function parseSourcePackage(
  value: unknown,
): ApplicabilityTaskContract['sourcePackage'] {
  const item = record(value, 'APPLICABILITY_SOURCE_PACKAGE_INVALID');
  exactKeys(item, ['packageId', 'contentHash']);
  return {
    packageId: text(item.packageId, 'APPLICABILITY_PACKAGE_ID_REQUIRED'),
    contentHash: text(item.contentHash, 'APPLICABILITY_PACKAGE_HASH_REQUIRED'),
  };
}

function parseBilingualBinding(
  value: unknown,
): ApplicabilityTaskContract['bilingualBinding'] {
  if (value === null) return null;
  const item = record(value, 'APPLICABILITY_BILINGUAL_BINDING_INVALID');
  exactKeys(item, ['actionAttemptId', 'artifactSha256']);
  return {
    actionAttemptId: text(
      item.actionAttemptId,
      'APPLICABILITY_TRANSLATION_ATTEMPT_REQUIRED',
    ),
    artifactSha256: text(
      item.artifactSha256,
      'APPLICABILITY_TRANSLATION_HASH_REQUIRED',
    ),
  };
}

function parseAircraft(value: unknown): ApplicabilityTaskContract['aircraft'] {
  const item = record(value, 'APPLICABILITY_AIRCRAFT_INVALID');
  exactKeys(item, ['aircraftNumber', 'assessmentAsOf']);
  const assessmentAsOf = text(
    item.assessmentAsOf,
    'APPLICABILITY_AS_OF_REQUIRED',
  );
  if (!isIsoDate(assessmentAsOf)) {
    fail('APPLICABILITY_AS_OF_INVALID');
  }
  return {
    aircraftNumber: text(
      item.aircraftNumber,
      'APPLICABILITY_AIRCRAFT_NUMBER_REQUIRED',
    ),
    assessmentAsOf,
  };
}

function parseFleetBinding(
  value: unknown,
): ApplicabilityTaskContract['fleetBinding'] {
  const item = record(value, 'APPLICABILITY_FLEET_BINDING_INVALID');
  exactKeys(item, [
    'bindingRevision',
    'selectionRevision',
    'sourceSnapshotId',
    'sourceRevisionKey',
    'authorityRevision',
    'sourceAsOf',
  ]);
  return {
    bindingRevision: text(
      item.bindingRevision,
      'APPLICABILITY_BINDING_REVISION_REQUIRED',
    ),
    selectionRevision: text(
      item.selectionRevision,
      'APPLICABILITY_SELECTION_REVISION_REQUIRED',
    ),
    sourceSnapshotId: nullableText(item.sourceSnapshotId),
    sourceRevisionKey: nullableText(item.sourceRevisionKey),
    authorityRevision: nullableText(item.authorityRevision),
    sourceAsOf: nullableText(item.sourceAsOf),
  };
}

function parseRuntime(value: unknown): ApplicabilityRuntimeProvenance {
  const item = record(value, 'APPLICABILITY_RUNTIME_INVALID');
  exactKeys(item, [
    'runtimeAppId',
    'profileRef',
    'modelVersion',
    'promptVersion',
    'skillVersion',
    'mcpServerName',
    'mcpServerVersion',
  ]);
  const expected = applicabilityRuntimePolicy();
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (item[key] !== expectedValue) fail('APPLICABILITY_RUNTIME_MISMATCH');
  }
  return expected;
}

function parseAuthority(
  value: unknown,
): ApplicabilityCandidateContract['authority'] {
  const item = record(value, 'APPLICABILITY_AUTHORITY_INVALID');
  exactKeys(item, [
    'candidateOnly',
    'createsEvidenceRef',
    'createsClosureDecision',
    'createsActionReadiness',
    'createsAirworthinessConclusion',
  ]);
  if (
    item.candidateOnly !== true ||
    item.createsEvidenceRef !== false ||
    item.createsClosureDecision !== false ||
    item.createsActionReadiness !== false ||
    item.createsAirworthinessConclusion !== false
  ) {
    fail('APPLICABILITY_AUTHORITY_INVALID');
  }
  return {
    candidateOnly: true,
    createsEvidenceRef: false,
    createsClosureDecision: false,
    createsActionReadiness: false,
    createsAirworthinessConclusion: false,
  };
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (stable(actual) !== stable(required)) {
    fail('APPLICABILITY_CANDIDATE_EXACT_SHAPE_REQUIRED');
  }
}

function stringArray(value: unknown, code: string): string[] {
  const items = array(value, code);
  if (
    items.length === 0 ||
    items.some((item) => typeof item !== 'string' || !item.trim()) ||
    new Set(items).size !== items.length
  ) {
    fail(code);
  }
  return [...items] as string[];
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(code);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(code);
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value, 'APPLICABILITY_NULLABLE_TEXT_INVALID');
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(',')}}`;
}

function fail(code: string): never {
  throw new Error(code);
}
