/**
 * WiseLink 3.1 applicability-fleet: Kleene evaluation engine.
 *
 * Migrated from the mature v8 applicabilityKleeneEngine source-level reference
 * onto WiseLink 3.1 FleetMasterData property names and TypeScript. Semantics
 * preserved:
 * - three-valued Kleene logic (true / false / 'unknown') for and/or/not;
 * - false never promotes to true and unknown never silently resolves;
 * - missing fleet facts produce fact_unknown blocking unknowns that the
 *   applicability gate surfaces as WAITING_INPUT;
 * - interpretation failures (unsupported property/operator/value type)
 *   produce interpretation_unknown blocking unknowns instead of throws.
 */

import {
  aircraftModelHierarchyMatches,
  type AircraftModelHierarchy,
} from './aircraftModelHierarchy';
import {
  getRegistry,
  type ApplicabilityPropertyDefinition,
} from './applicabilityPropertyRegistry';

export const UNKNOWN = 'unknown';

export type KleeneResult = boolean | typeof UNKNOWN;

export interface BlockingUnknown {
  kind: string;
  reason?: string;
  strategy?: string;
  fragmentId?: string | null;
  extractionStatus?: string | null;
  rawText?: string | null;
  factType?: string;
  property?: string | null;
  qualifier?: string | null;
  assetId?: string | null;
  assessmentAsOf?: string | null;
  [key: string]: unknown;
}

export interface KleeneTrace {
  result: KleeneResult;
  blockingUnknowns: BlockingUnknown[];
  inheritedFrom?: string;
  shortCircuitReason?: string;
}

export interface ApplicabilityFleetSnapshot {
  assetId?: string | null;
  assessmentAsOf?: string | null;
  properties: Record<string, unknown>;
  context?: Record<string, unknown> | null;
}

export type ApplicabilityAstNode =
  | { type: 'literal'; value: boolean }
  | {
      type: 'assert';
      property: string;
      operator: string;
      value: unknown;
      qualifier?: string | null;
    }
  | { type: 'and'; children: ApplicabilityAstNode[] }
  | { type: 'or'; children: ApplicabilityAstNode[] }
  | { type: 'not'; child: ApplicabilityAstNode }
  | {
      type: 'legacy_clause';
      clause: {
        attribute?: string;
        op?: string;
        operator?: string;
        value?: unknown;
      };
    };

const EXTRACTION_STATUS_VALUES = new Set([
  'extracted',
  'no_rule_found',
  'extraction_failed',
  'not_supported',
]);

const DEFAULT_EFFECTIVITY_POLICY = Object.freeze({
  noRuleFound: 'needs_review',
  notSupported: 'needs_review',
  extractionFailed: 'needs_review',
});

const BUILTIN_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  '737-8': 'B737 MAX 8',
  7378: 'B737 MAX 8',
  B7378: 'B737 MAX 8',
  'B737-8': 'B737 MAX 8',
  B737MAX8: 'B737 MAX 8',
  BOEING7378: 'B737 MAX 8',
  BOEING737MAX8: 'B737 MAX 8',
});

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeExtractionStatus(value: unknown, fallback: string | null = null): string | null {
  if (value === undefined || value === null) return fallback;
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  return EXTRACTION_STATUS_VALUES.has(normalized) ? normalized : fallback;
}

function resolveRegistryProperties(
  registry: { properties: ApplicabilityPropertyDefinition[] } | null,
): ApplicabilityPropertyDefinition[] {
  if (registry && Array.isArray(registry.properties) && registry.properties.length > 0) {
    return registry.properties;
  }
  return getRegistry().properties;
}

function resolvePropertyDefinition(
  property: string,
  registry: { properties: ApplicabilityPropertyDefinition[] } | null,
): ApplicabilityPropertyDefinition | null {
  return (
    resolveRegistryProperties(registry).find(
      (entry) => entry.property === property,
    ) ?? null
  );
}

function normalizeAircraftModel(value: unknown): string {
  const raw = normalizeString(value).toUpperCase();
  if (!raw) return raw;
  const compact = raw.replace(/[^A-Z0-9]/gu, '');
  const withoutMaker = raw.replace(/^(BOEING|AIRBUS|COMAC|EMBRAER|BOMBARDIER)\s+/iu, '').toUpperCase();
  const withoutMakerCompact = withoutMaker.replace(/[^A-Z0-9]/gu, '');
  return (
    BUILTIN_MODEL_ALIASES[raw]
    ?? BUILTIN_MODEL_ALIASES[compact]
    ?? BUILTIN_MODEL_ALIASES[withoutMaker]
    ?? BUILTIN_MODEL_ALIASES[withoutMakerCompact]
    ?? raw
  );
}

function normalizeSbNumber(value: unknown): string {
  return normalizeString(value)
    .toUpperCase()
    .replace(/^(BOEING\s*)?SB\s*/iu, '')
    .replace(/[^A-Z0-9]/gu, '');
}

function normalizeOptionCode(value: unknown): string {
  return normalizeString(value).toUpperCase();
}

function normalizePartNumber(value: unknown): string {
  return normalizeString(value).toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

function normalizeEquipmentModel(value: unknown): string {
  return normalizeString(value).toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

function normalizeIdentifier(value: unknown): string {
  return normalizeString(value).toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

function normalizeSoftwareVersion(value: unknown): string {
  return normalizeString(value).toUpperCase().replace(/\s+/gu, '');
}

function normalizeDateOnly(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) return raw;
  const direct = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
  if (direct) {
    const [, year, month, day] = direct;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error('invalid date');
  return new Date(parsed).toISOString().slice(0, 10);
}

function applyNormalizer(
  normalizerName: string | null,
  value: unknown,
): unknown {
  if (value === undefined || value === null) return value;
  switch (normalizerName) {
    case 'normalizeAircraftModel':
      return normalizeAircraftModel(value);
    case 'normalizeSbNumber':
      return normalizeSbNumber(value);
    case 'normalizeOptionCode':
      return normalizeOptionCode(value);
    case 'normalizePartNumber':
      return normalizePartNumber(value);
    case 'normalizeEquipmentModel':
      return normalizeEquipmentModel(value);
    case 'normalizeIdentifier':
      return normalizeIdentifier(value);
    case 'normalizeSoftwareVersion':
      return normalizeSoftwareVersion(value);
    case 'normalizeDateOnly':
      return normalizeDateOnly(value);
    default:
      return value;
  }
}

function coerceFiniteNumber(value: unknown, property: string): number {
  const normalized = normalizeString(value).replace(/^LN\s*/iu, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${property} must be a finite number`);
  }
  return parsed;
}

function operatorAllowedForProperty(
  operator: string,
  propDef: ApplicabilityPropertyDefinition,
): boolean {
  return propDef.supportedOperators.includes(operator);
}

function normalizeAssertValue(
  propDef: ApplicabilityPropertyDefinition,
  value: unknown,
  operator: string,
): unknown {
  if (propDef.valueType === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Boolean property ${propDef.property} requires boolean value`);
    }
    return value;
  }

  if (propDef.valueType === 'number') {
    if (operator === 'range') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('range requires object value');
      }
      const record = value as { min?: unknown; max?: unknown };
      return {
        min: record.min == null ? undefined : coerceFiniteNumber(record.min, propDef.property),
        max: record.max == null ? undefined : coerceFiniteNumber(record.max, propDef.property),
      };
    }
    if (operator === 'in' || operator === 'not_in') {
      if (!Array.isArray(value)) throw new Error(`${operator} requires array value`);
      return value.map((entry) => coerceFiniteNumber(entry, propDef.property));
    }
    return coerceFiniteNumber(value, propDef.property);
  }

  if (propDef.valueType === 'date') {
    const normalizeOne = (entry: unknown) =>
      normalizeDateOnly(normalizeString(entry));
    if (operator === 'range') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('range requires object value');
      }
      const record = value as { min?: unknown; max?: unknown };
      return {
        min: record.min == null ? undefined : normalizeOne(record.min),
        max: record.max == null ? undefined : normalizeOne(record.max),
      };
    }
    if (operator === 'in' || operator === 'not_in') {
      if (!Array.isArray(value)) throw new Error(`${operator} requires array value`);
      return value.map(normalizeOne);
    }
    return normalizeOne(value);
  }

  if (propDef.valueType === 'string') {
    const normalizeOne = (entry: unknown) =>
      applyNormalizer(propDef.normalizer, normalizeString(entry)) as string;
    if (operator === 'in' || operator === 'not_in') {
      if (!Array.isArray(value)) throw new Error(`${operator} requires array value`);
      return value.map(normalizeOne);
    }
    return normalizeOne(value);
  }

  return value;
}

function normalizeSnapshotComparableValue(
  propDef: ApplicabilityPropertyDefinition,
  value: unknown,
): unknown {
  if (value === undefined || value === null) return value;
  if (propDef.valueType === 'boolean') return value;
  if (propDef.valueType === 'number') {
    return coerceFiniteNumber(value, propDef.property);
  }
  if (propDef.valueType === 'date') {
    return normalizeDateOnly(normalizeString(value));
  }
  if (propDef.valueType === 'string') {
    return applyNormalizer(propDef.normalizer, normalizeString(value));
  }
  return value;
}

function resolveSnapshotValue(
  snapshot: ApplicabilityFleetSnapshot,
  property: string,
  qualifier: string | null,
): unknown {
  const properties = snapshot?.properties ?? {};
  const base = properties[property];
  if (qualifier !== null) {
    if (!base || typeof base !== 'object' || Array.isArray(base)) return undefined;
    return (base as Record<string, unknown>)[qualifier];
  }
  return base;
}

function compareAssertValue(
  operator: string,
  left: unknown,
  right: unknown,
): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'in':
      return Array.isArray(right) && right.includes(left);
    case 'not_in':
      return Array.isArray(right) && !right.includes(left);
    case 'gte':
      return (left as number) >= (right as number);
    case 'lte':
      return (left as number) <= (right as number);
    case 'range': {
      const bounds = right as { min?: number; max?: number };
      const min = bounds?.min;
      const max = bounds?.max;
      return (min == null || (left as number) >= min) && (max == null || (left as number) <= max);
    }
    default:
      throw new Error(`unsupported operator ${operator}`);
  }
}

function resolveSnapshotModelHierarchy(
  snapshot: ApplicabilityFleetSnapshot,
  fallbackModel: unknown,
): AircraftModelHierarchy {
  const properties = snapshot?.properties ?? {};
  if (
    properties.modelHierarchy
    && typeof properties.modelHierarchy === 'object'
    && !Array.isArray(properties.modelHierarchy)
  ) {
    return properties.modelHierarchy as AircraftModelHierarchy;
  }
  return {
    fleetFamily:
      (properties.fleetFamily as string | undefined)
      ?? ((snapshot?.context?.fleetFamily as string | undefined) ?? null),
    series: (properties.series as string | undefined) ?? null,
    aircraftModel:
      (snapshot?.context?.aircraftModel as string | undefined) ?? null,
    model:
      (fallbackModel as string | undefined)
      ?? (properties.model as string | undefined)
      ?? ((snapshot?.context?.model as string | undefined) ?? null),
  };
}

function compareModelAssertValue(
  operator: string,
  snapshot: ApplicabilityFleetSnapshot,
  left: unknown,
  right: unknown,
): boolean {
  const hierarchy = resolveSnapshotModelHierarchy(snapshot, left);
  switch (operator) {
    case 'eq':
      return aircraftModelHierarchyMatches(hierarchy, right);
    case 'neq':
      return !aircraftModelHierarchyMatches(hierarchy, right);
    case 'in':
      return (
        Array.isArray(right)
        && right.some((candidate) => aircraftModelHierarchyMatches(hierarchy, candidate))
      );
    case 'not_in':
      return (
        Array.isArray(right)
        && !right.some((candidate) => aircraftModelHierarchyMatches(hierarchy, candidate))
      );
    default:
      return compareAssertValue(operator, left, right);
  }
}

function interpretationUnknown(
  reason: string,
  extra: Record<string, unknown> = {},
): KleeneTrace {
  const entry: BlockingUnknown = {
    kind: 'interpretation_unknown',
    reason,
    strategy: 'grill_me',
    ...extra,
  };
  return {
    result: UNKNOWN,
    blockingUnknowns: [Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined),
    ) as BlockingUnknown],
  };
}

function buildFactUnknown(options: {
  property: string;
  qualifier: string | null;
  propDef: ApplicabilityPropertyDefinition;
  snapshot: ApplicabilityFleetSnapshot;
}): KleeneTrace {
  return {
    result: UNKNOWN,
    blockingUnknowns: [
      {
        kind: 'fact_unknown',
        factType: options.propDef.factType,
        property: options.property,
        qualifier: options.qualifier,
        assetId: options.snapshot.assetId ?? null,
        assessmentAsOf: options.snapshot.assessmentAsOf ?? null,
        strategy:
          options.propDef.factType === 'data_quality_issue'
            ? 'data_quality_warning'
            : 'direct_fact',
      },
    ],
  };
}

function dedupeBlockingUnknowns(values: BlockingUnknown[]): BlockingUnknown[] {
  const seen = new Set<string>();
  const result: BlockingUnknown[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function evaluateAssertWithTrace(
  node: {
    property?: unknown;
    operator?: unknown;
    value?: unknown;
    qualifier?: unknown;
  },
  snapshot: ApplicabilityFleetSnapshot,
  registry: { properties: ApplicabilityPropertyDefinition[] } | null = null,
): KleeneTrace {
  const property = typeof node.property === 'string' ? node.property : '';
  const operator = typeof node.operator === 'string' ? node.operator : '';
  const value = node.value;
  const qualifier = typeof node.qualifier === 'string' ? node.qualifier : null;

  if (!property || !operator) {
    return interpretationUnknown('invalid_assert_node', {
      property: property || null,
      operator: operator || null,
    });
  }

  const propDef = resolvePropertyDefinition(property, registry);
  if (!propDef) {
    return interpretationUnknown('unsupported_property', { property });
  }
  if (!operatorAllowedForProperty(operator, propDef)) {
    return interpretationUnknown('unsupported_operator', { property, operator });
  }
  const expectsQualifier = propDef.qualifierNormalizer !== null;
  if (expectsQualifier && !qualifier) {
    return interpretationUnknown('missing_qualifier', {
      property,
      expectedQualifierKind: propDef.qualifierNormalizer,
    });
  }
  if (!expectsQualifier && qualifier !== null) {
    return interpretationUnknown('unexpected_qualifier', { property, qualifier });
  }

  let normalizedQualifier: string | null = null;
  let normalizedExpectedValue: unknown;
  try {
    normalizedExpectedValue = normalizeAssertValue(propDef, value, operator);
    if (expectsQualifier && qualifier !== null) {
      normalizedQualifier = applyNormalizer(
        propDef.qualifierNormalizer,
        qualifier,
      ) as string;
    }
  } catch {
    return interpretationUnknown('invalid_value_type', {
      property,
      operator,
      value,
      expectedValueType: propDef.valueType,
    });
  }

  let snapshotValue = resolveSnapshotValue(snapshot, property, normalizedQualifier);
  if (snapshotValue === undefined || snapshotValue === null) {
    return buildFactUnknown({ property, qualifier: normalizedQualifier, propDef, snapshot });
  }
  try {
    snapshotValue = normalizeSnapshotComparableValue(propDef, snapshotValue);
  } catch {
    return interpretationUnknown('invalid_snapshot_value_type', {
      property,
      operator,
      snapshotValue,
    });
  }

  try {
    const result =
      propDef.property === 'model'
        ? compareModelAssertValue(operator, snapshot, snapshotValue, normalizedExpectedValue)
        : compareAssertValue(operator, snapshotValue, normalizedExpectedValue);
    return { result, blockingUnknowns: [] };
  } catch {
    return interpretationUnknown('unsupported_operator', { property, operator });
  }
}

export function kleeneAndTrace(left: KleeneTrace, right: KleeneTrace): KleeneTrace {
  if (left.result === false || right.result === false) {
    return { result: false, blockingUnknowns: [] };
  }
  if (left.result === UNKNOWN || right.result === UNKNOWN) {
    return {
      result: UNKNOWN,
      blockingUnknowns: dedupeBlockingUnknowns([
        ...(Array.isArray(left.blockingUnknowns) ? left.blockingUnknowns : []),
        ...(Array.isArray(right.blockingUnknowns) ? right.blockingUnknowns : []),
      ]),
    };
  }
  return { result: true, blockingUnknowns: [] };
}

export function kleeneOrTrace(left: KleeneTrace, right: KleeneTrace): KleeneTrace {
  if (left.result === true || right.result === true) {
    return { result: true, blockingUnknowns: [] };
  }
  if (left.result === UNKNOWN || right.result === UNKNOWN) {
    return {
      result: UNKNOWN,
      blockingUnknowns: dedupeBlockingUnknowns([
        ...(Array.isArray(left.blockingUnknowns) ? left.blockingUnknowns : []),
        ...(Array.isArray(right.blockingUnknowns) ? right.blockingUnknowns : []),
      ]),
    };
  }
  return { result: false, blockingUnknowns: [] };
}

function evaluateAndWithTrace(
  children: ApplicabilityAstNode[],
  snapshot: ApplicabilityFleetSnapshot,
  registry: { properties: ApplicabilityPropertyDefinition[] } | null,
): KleeneTrace {
  let aggregated: KleeneTrace = { result: true, blockingUnknowns: [] };
  for (const child of children) {
    const trace = evaluateWithTrace(child, snapshot, registry);
    aggregated = kleeneAndTrace(aggregated, trace);
    if (aggregated.result === false) {
      return { result: false, blockingUnknowns: [], shortCircuitReason: 'and_child_false' };
    }
  }
  return aggregated;
}

function evaluateOrWithTrace(
  children: ApplicabilityAstNode[],
  snapshot: ApplicabilityFleetSnapshot,
  registry: { properties: ApplicabilityPropertyDefinition[] } | null,
): KleeneTrace {
  let aggregated: KleeneTrace = { result: false, blockingUnknowns: [] };
  for (const child of children) {
    const trace = evaluateWithTrace(child, snapshot, registry);
    aggregated = kleeneOrTrace(aggregated, trace);
    if (aggregated.result === true) {
      return { result: true, blockingUnknowns: [], shortCircuitReason: 'or_child_true' };
    }
  }
  return aggregated;
}

export function evaluateWithTrace(
  ast: ApplicabilityAstNode | null | undefined,
  snapshot: ApplicabilityFleetSnapshot,
  registry: { properties: ApplicabilityPropertyDefinition[] } | null = null,
): KleeneTrace {
  if (ast === null || ast === undefined) {
    return interpretationUnknown('extraction_failed');
  }

  if (ast.type === 'literal') {
    return { result: ast.value === true, blockingUnknowns: [] };
  }

  if (ast.type === 'assert') {
    return evaluateAssertWithTrace(ast, snapshot, registry);
  }

  if (ast.type === 'and') {
    return evaluateAndWithTrace(
      Array.isArray(ast.children) ? ast.children : [],
      snapshot,
      registry,
    );
  }

  if (ast.type === 'or') {
    return evaluateOrWithTrace(
      Array.isArray(ast.children) ? ast.children : [],
      snapshot,
      registry,
    );
  }

  if (ast.type === 'not') {
    const childTrace = evaluateWithTrace(ast.child, snapshot, registry);
    if (childTrace.result === UNKNOWN) {
      return {
        result: UNKNOWN,
        blockingUnknowns: dedupeBlockingUnknowns(childTrace.blockingUnknowns || []),
      };
    }
    return { result: !childTrace.result, blockingUnknowns: [] };
  }

  if (ast.type === 'legacy_clause') {
    return evaluateLegacyClauseWithTrace(ast.clause || {}, snapshot);
  }

  return interpretationUnknown('unsupported_ast_node', {
    nodeType: (ast as { type?: string }).type ?? null,
  });
}

function normalizeLegacyArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function legacyTextMatch(left: unknown, right: unknown): boolean {
  const l = normalizeString(left).toUpperCase();
  const r = normalizeString(right).toUpperCase();
  if (!l || !r) return false;
  return l === r || l.includes(r) || r.includes(l);
}

const LEGACY_ATTRIBUTE_TO_PROPERTY: Readonly<Record<string, string>> = {
  aircraftModel: 'model',
  model: 'model',
  msn: 'msn',
  lineNumber: 'lineNumber',
  tailNumber: 'tailNumber',
  fleetFamily: 'fleetFamily',
};

function resolveLegacyAttributeValue(
  snapshot: ApplicabilityFleetSnapshot,
  attribute: string,
): unknown {
  const fromContext = snapshot?.context?.[attribute];
  if (fromContext !== undefined) return fromContext;
  const mappedProperty = LEGACY_ATTRIBUTE_TO_PROPERTY[attribute];
  if (mappedProperty) return snapshot?.properties?.[mappedProperty];
  return undefined;
}

function evaluateLegacyClauseWithTrace(
  clause: { attribute?: string; op?: string; operator?: string; value?: unknown },
  snapshot: ApplicabilityFleetSnapshot,
): KleeneTrace {
  const attribute = clause.attribute || '';
  const operator = clause.op || clause.operator || '';
  const actual = resolveLegacyAttributeValue(snapshot, attribute);
  if (actual === undefined || actual === null || actual === '') {
    return { result: UNKNOWN, blockingUnknowns: [] };
  }
  switch (operator) {
    case 'in':
    case 'requires': {
      const matched = normalizeLegacyArray(clause.value).some((candidate) =>
        legacyTextMatch(actual, candidate),
      );
      return { result: matched, blockingUnknowns: [] };
    }
    case 'range_in': {
      const actualNumber = Number(actual);
      if (!Number.isFinite(actualNumber)) {
        return { result: UNKNOWN, blockingUnknowns: [] };
      }
      const matched = normalizeLegacyArray(clause.value).some((range) => {
        const rangeRecord = range as { start?: unknown; from?: unknown; end?: unknown; to?: unknown };
        const start = Number(rangeRecord?.start ?? rangeRecord?.from);
        const end = Number(rangeRecord?.end ?? rangeRecord?.to);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return actualNumber >= Math.min(start, end) && actualNumber <= Math.max(start, end);
      });
      return { result: matched, blockingUnknowns: [] };
    }
    case 'excludes': {
      const matched = normalizeLegacyArray(clause.value).some((candidate) =>
        legacyTextMatch(actual, candidate),
      );
      return { result: !matched, blockingUnknowns: [] };
    }
    default:
      return { result: UNKNOWN, blockingUnknowns: [] };
  }
}

export function kleeneToAssessmentDecision(result: KleeneResult): string {
  if (result === true) return 'applicable';
  if (result === false) return 'not_applicable';
  return 'needs_review';
}

export type ApplicabilityFragment = {
  ruleFragmentId?: string | null;
  fragmentId?: string | null;
  extractionStatus?: string | null;
  extraction_status?: string | null;
  applicabilityLevel?: string | null;
  applicability_level?: string | null;
  applicabilityScope?: string | null;
  applicability_scope?: string | null;
  scopeType?: string | null;
  scope_type?: string | null;
  contentRef?: string | null;
  content_ref?: string | null;
  alternativeGroup?: string | null;
  alternative_group?: string | null;
  rawText?: string | null;
  raw_text?: string | null;
  extractionFailureReason?: string | null;
  extraction_failure_reason?: string | null;
  expressionAst?: ApplicabilityAstNode | null;
  expression_ast_json?: ApplicabilityAstNode | null;
};

export interface EffectivityPolicy {
  noRuleFound: 'applicable' | 'not_applicable' | 'needs_review';
  notSupported: 'applicable' | 'not_applicable' | 'needs_review';
  extractionFailed: 'applicable' | 'not_applicable' | 'needs_review';
}

export interface FragmentEvaluationProfile {
  effectivityPolicy?: Partial<EffectivityPolicy> & {
    no_rule_found?: 'applicable' | 'not_applicable' | 'needs_review';
    not_supported?: 'applicable' | 'not_applicable' | 'needs_review';
    extraction_failed?: 'applicable' | 'not_applicable' | 'needs_review';
  };
}

function resolveFragmentApplicabilityLevel(fragment: ApplicabilityFragment): 'inline' | 'document_effectivity' {
  const explicit =
    fragment.applicabilityLevel
    || fragment.applicability_level
    || fragment.applicabilityScope
    || fragment.applicability_scope
    || null;
  if (explicit) {
    return normalizeString(explicit).toLowerCase() === 'inline'
      ? 'inline'
      : 'document_effectivity';
  }
  if (fragment.scopeType || fragment.scope_type || fragment.contentRef || fragment.content_ref) {
    return 'inline';
  }
  return 'document_effectivity';
}

function resolveAlternativeGroup(fragment: ApplicabilityFragment): string | null {
  const value = fragment.alternativeGroup ?? fragment.alternative_group ?? null;
  if (value === undefined || value === null) return null;
  const normalized = normalizeString(value);
  return normalized || null;
}

function resolveEffectivityPolicy(profile: FragmentEvaluationProfile | null): EffectivityPolicy {
  if (!profile || typeof profile !== 'object') return DEFAULT_EFFECTIVITY_POLICY;
  const policy = profile.effectivityPolicy;
  if (!policy || typeof policy !== 'object') return DEFAULT_EFFECTIVITY_POLICY;
  return {
    noRuleFound: policy.noRuleFound || policy.no_rule_found || DEFAULT_EFFECTIVITY_POLICY.noRuleFound,
    notSupported: policy.notSupported || policy.not_supported || DEFAULT_EFFECTIVITY_POLICY.notSupported,
    extractionFailed: policy.extractionFailed || policy.extraction_failed || DEFAULT_EFFECTIVITY_POLICY.extractionFailed,
  };
}

export function applyEffectivityPolicy(
  policy: 'applicable' | 'not_applicable' | 'needs_review',
  fragment: ApplicabilityFragment = {},
  reason = 'policy_unknown',
): KleeneTrace {
  if (policy === 'applicable') return { result: true, blockingUnknowns: [] };
  if (policy === 'not_applicable') return { result: false, blockingUnknowns: [] };
  if (policy === 'needs_review') return fragmentInterpretationUnknown(reason, fragment);
  return { result: UNKNOWN, blockingUnknowns: [] };
}

function buildInterpretationUnknown(
  reason: string,
  fragment: ApplicabilityFragment = {},
  extra: Record<string, unknown> = {},
): BlockingUnknown {
  const entry: BlockingUnknown = {
    kind: 'interpretation_unknown',
    reason,
    strategy: 'grill_me',
    fragmentId: fragment.ruleFragmentId || fragment.fragmentId || null,
    extractionStatus: normalizeExtractionStatus(
      fragment.extractionStatus ?? fragment.extraction_status,
      null,
    ),
    rawText: fragment.rawText || fragment.raw_text || null,
    extractionFailureReason:
      fragment.extractionFailureReason || fragment.extraction_failure_reason || null,
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined),
  ) as BlockingUnknown;
}

function fragmentInterpretationUnknown(
  reason: string,
  fragment: ApplicabilityFragment = {},
  extra: Record<string, unknown> = {},
): KleeneTrace {
  return {
    result: UNKNOWN,
    blockingUnknowns: [buildInterpretationUnknown(reason, fragment, extra)],
  };
}

function resolveFragmentAst(fragment: ApplicabilityFragment): ApplicabilityAstNode | null {
  if (fragment.expressionAst !== undefined) return fragment.expressionAst ?? null;
  if (fragment.expression_ast_json !== undefined) return fragment.expression_ast_json ?? null;
  return null;
}

export function evaluateFragment(
  fragment: ApplicabilityFragment,
  snapshot: ApplicabilityFleetSnapshot,
  options: {
    profile?: FragmentEvaluationProfile | null;
    registry?: { properties: ApplicabilityPropertyDefinition[] } | null;
    evaluateExtractedWithoutAst?: (
      fragment: ApplicabilityFragment,
      snapshot: ApplicabilityFleetSnapshot,
      context: { applicabilityLevel: 'inline' | 'document_effectivity' },
    ) => KleeneTrace;
  } = {},
): KleeneTrace {
  const extractionStatus = normalizeExtractionStatus(
    fragment.extractionStatus ?? fragment.extraction_status,
    'extracted',
  );
  const applicabilityLevel = resolveFragmentApplicabilityLevel(fragment);
  const effectivityPolicy = resolveEffectivityPolicy(options.profile ?? null);

  switch (extractionStatus) {
    case 'extracted': {
      const ast = resolveFragmentAst(fragment);
      if (ast !== null) {
        return evaluateWithTrace(ast, snapshot, options.registry ?? null);
      }
      if (typeof options.evaluateExtractedWithoutAst === 'function') {
        return options.evaluateExtractedWithoutAst(fragment, snapshot, {
          applicabilityLevel,
        });
      }
      return fragmentInterpretationUnknown('missing_expression_ast', fragment);
    }
    case 'no_rule_found': {
      if (applicabilityLevel === 'inline') {
        return {
          result: true,
          blockingUnknowns: [],
          inheritedFrom: 'document_effectivity',
        };
      }
      return applyEffectivityPolicy(effectivityPolicy.noRuleFound, fragment, 'no_rule_found');
    }
    case 'extraction_failed':
      return applyEffectivityPolicy(effectivityPolicy.extractionFailed, fragment, 'extraction_failed');
    case 'not_supported':
      return applyEffectivityPolicy(effectivityPolicy.notSupported, fragment, 'not_supported');
    default:
      return fragmentInterpretationUnknown('unsupported_extraction_status', fragment, {
        extractionStatus,
      });
  }
}

export function evaluateDocumentEffectivitySetWithTrace(
  fragments: ApplicabilityFragment[],
  snapshot: ApplicabilityFleetSnapshot,
  options: Parameters<typeof evaluateFragment>[2] = {},
): KleeneTrace {
  if (!Array.isArray(fragments) || fragments.length === 0) {
    return applyEffectivityPolicy(
      resolveEffectivityPolicy(options.profile ?? null).noRuleFound,
      { applicabilityLevel: 'document_effectivity', extractionStatus: 'no_rule_found' },
      'no_rule_found',
    );
  }
  return fragments
    .map((fragment) => evaluateFragment(fragment, snapshot, options))
    .reduce((left, right) => kleeneOrTrace(left, right), {
      result: false,
      blockingUnknowns: [],
    });
}

export function combineInlineExtractedRulesToAst(
  rules: ApplicabilityFragment[],
  inlineTemplate: { multiPatternCombination?: string | null; multi_pattern_combination?: string | null } | null = null,
): ApplicabilityAstNode | null {
  const extractedRules = (Array.isArray(rules) ? rules : []).filter(
    (rule) =>
      normalizeExtractionStatus(rule.extractionStatus ?? rule.extraction_status, 'extracted')
        === 'extracted'
      && resolveFragmentAst(rule) !== null,
  );
  if (extractedRules.length === 0) return null;
  if (extractedRules.length === 1) return resolveFragmentAst(extractedRules[0]);

  const combination = normalizeString(
    inlineTemplate?.multiPatternCombination
      || inlineTemplate?.multi_pattern_combination
      || 'and',
  ).toLowerCase();
  const hasAlternativeGroups = extractedRules.some(
    (rule) => resolveAlternativeGroup(rule) !== null,
  );

  if (!hasAlternativeGroups || combination === 'and') {
    return {
      type: 'and',
      children: extractedRules.map((rule) => resolveFragmentAst(rule)! as ApplicabilityAstNode),
    };
  }

  const groups = new Map<string, ApplicabilityAstNode[]>();
  const ungrouped: ApplicabilityAstNode[] = [];
  for (const rule of extractedRules) {
    const group = resolveAlternativeGroup(rule);
    if (group === null) {
      ungrouped.push(resolveFragmentAst(rule)! as ApplicabilityAstNode);
      continue;
    }
    const existing = groups.get(group) || [];
    existing.push(resolveFragmentAst(rule)! as ApplicabilityAstNode);
    groups.set(group, existing);
  }

  const groupedChildren: ApplicabilityAstNode[] = Array.from(groups.values()).map((groupAsts) =>
    groupAsts.length === 1 ? groupAsts[0] : { type: 'or', children: groupAsts },
  );
  const allChildren = [...groupedChildren, ...ungrouped];
  if (allChildren.length === 1) return allChildren[0];
  return { type: 'and', children: allChildren };
}

export function evaluateInlineRuleSetWithTrace(
  rules: ApplicabilityFragment[],
  snapshot: ApplicabilityFleetSnapshot,
  options: {
    profile?: FragmentEvaluationProfile | null;
    registry?: { properties: ApplicabilityPropertyDefinition[] } | null;
    inlineTemplate?: { multiPatternCombination?: string | null } | null;
    evaluateExtractedWithoutAst?: Parameters<typeof evaluateFragment>[2]['evaluateExtractedWithoutAst'];
  } = {},
): KleeneTrace {
  if (!Array.isArray(rules) || rules.length === 0) {
    return { result: true, blockingUnknowns: [] };
  }

  const nonExtractedTraces = rules
    .filter((rule) => {
      const status = normalizeExtractionStatus(
        rule.extractionStatus ?? rule.extraction_status,
        'extracted',
      );
      return status !== 'extracted' && status !== 'no_rule_found';
    })
    .map((rule) =>
      evaluateFragment(rule, snapshot, {
        profile: options.profile,
        registry: options.registry,
        evaluateExtractedWithoutAst: options.evaluateExtractedWithoutAst,
      }),
    );

  const inlineAst = combineInlineExtractedRulesToAst(rules, options.inlineTemplate ?? null);
  const extractedTrace = inlineAst
    ? evaluateWithTrace(inlineAst, snapshot, options.registry ?? null)
    : { result: true, blockingUnknowns: [] };

  return nonExtractedTraces.reduce(
    (left, right) => kleeneAndTrace(left, right),
    extractedTrace,
  );
}

export function evaluateApplicabilityFragmentSetWithTrace(
  fragments: ApplicabilityFragment[],
  snapshot: ApplicabilityFleetSnapshot,
  options: Parameters<typeof evaluateInlineRuleSetWithTrace>[2] = {},
): KleeneTrace {
  const allFragments = Array.isArray(fragments) ? fragments : [];
  const documentEffectivityFragments = allFragments.filter(
    (fragment) => resolveFragmentApplicabilityLevel(fragment) !== 'inline',
  );
  const inlineRules = allFragments.filter(
    (fragment) => resolveFragmentApplicabilityLevel(fragment) === 'inline',
  );

  const effectivityTrace = evaluateDocumentEffectivitySetWithTrace(
    documentEffectivityFragments,
    snapshot,
    {
      profile: options.profile,
      registry: options.registry,
      evaluateExtractedWithoutAst: options.evaluateExtractedWithoutAst,
    },
  );

  if (inlineRules.length === 0) return effectivityTrace;

  if (effectivityTrace.result === false) {
    return {
      result: false,
      blockingUnknowns: [],
      inheritedFrom: 'document_effectivity_short_circuit',
    };
  }

  const inlineTrace = evaluateInlineRuleSetWithTrace(inlineRules, snapshot, options);
  return kleeneAndTrace(effectivityTrace, inlineTrace);
}
