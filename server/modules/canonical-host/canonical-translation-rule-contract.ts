/**
 * WL31 translation owner/rule migration (round 1, C5 cleanup): private,
 * versioned rule-selection and deterministic validation contract.
 *
 * CANDIDATE_ONLY. Source of truth: R08 rev692 fresh-read (2026-08-26) plus
 * the owner-confirmed docs/WORKBENCH_V1_0_11_REUSE_MAPPING_20260820.md guard
 * list, migrated from the legacy translation-owner lineage (see
 * docs/WL31_TRANSLATION_V1_PRIVATE_MIGRATION_20260826.md for the exact
 * migrate/retain/retire/gap matrix with commits).
 *
 * Boundary (typed and private; wired by the Host translation service):
 *
 *   Host frozen SourceUnits + exact selected rule pack (id + version pair)
 *     + existing currentness binding (CanonicalTranslationConsumptionBinding)
 *     -> durable ActionAttempt -> OpenClaw execution
 *     -> shared ResultEnvelope
 *     -> private runtime-validated TranslationResultContract (here)
 *     -> this deterministic validator
 *     -> Host ResultGate / CAS
 *     -> CANDIDATE bilingual projection (existing two-axis chain).
 *
 * This module owns ONLY versioned rule selection, the private translation
 * task/result contracts, and the deterministic validation that runs AFTER
 * translation. Rule execution happens in OpenClaw; model/provider
 * selection is OpenClaw runtime config. Rules live as data in the private V1
 * Host asset — never only inside a prompt. This module never calls an LLM,
 * provider, gateway, or secret, and never touches 0.11 runtime. The shared
 * ResultEnvelope carries this private TranslationResultContract as modelOutput;
 * Host parses that payload fail-closed after the shared envelope is verified.
 *
 * Currentness single source of truth: the existing private
 * CanonicalTranslationConsumptionBinding from canonical-reader-consumption.ts
 * (documentId/revisionId/SBD/TCP package+contentHash). There is NO second
 * hash, fence, baseline, or gate in this module. Task-start and
 * validation-time compare the exact same identity fields, field by field;
 * any drift or missing binding fails closed. Engineer revisions carry the
 * same full binding identity and are validated field-by-field too.
 *
 * Rule identity is the exact pair (rulePackId, rulePackVersion) — never
 * schemaVersion alone, never a version hidden inside an id string.
 *
 * Everything fails closed: any unrecognized schema, unknown rule id or
 * version, invalid identifier regex, missing/blank identity field,
 * mismatched or duplicated SourceRef set, numeric multiset drift, or
 * inconsistent counts rejects the candidate with diagnostics; nothing is
 * auto-accepted and the validator never throws.
 */

import type { CanonicalTranslationConsumptionBinding } from './canonical-reader-consumption';

/** Versioned rule pack identifier. Selection is exact-match on id+version. */
export type TranslationRulePackId = string;

/** Independent rule pack version — owner-controlled, never implied by id. */
export type TranslationRulePackVersion = string;

export interface TranslationRulePackMeta {
  schemaVersion: string;
  rulePackId: TranslationRulePackId;
  /** Independent version of this pack; the owner pins the exact pair. */
  rulePackVersion: TranslationRulePackVersion;
  /** Human-readable label, e.g. "Boeing FTD zh-CN baseline". */
  label: string;
  targetLocale: string;
  /** Recognized source locales for this pack. */
  sourceLocales: readonly string[];
}

/** Mandatory terminology: source term must be rendered by one of the target renderings. */
export interface TranslationTermRule {
  ruleId: string;
  sourceTerm: string;
  /** At least one rendering must appear in the target text. Case-sensitive. */
  targetRenderings: readonly string[];
  severity: 'mandatory';
  note?: string;
}

/** A term whose translation is forbidden: the source form must be retained verbatim. */
export interface TranslationNoTranslateRule {
  ruleId: string;
  /** Source token that must survive into the target text unchanged. */
  token: string;
  note?: string;
}

/**
 * Deterministic, machine-checkable invariants. Each is validated by
 * validateTranslationCandidate without any model involvement.
 */
export interface TranslationDeterministicRuleSet {
  /** Technical identifiers that must pass through verbatim (regex source,
   *  validated at parse time — an invalid regex fails the whole pack). */
  preservedIdentifierPatterns: readonly string[];
  /**
   * Numeric fidelity: the numeric token MULTISET of the source must equal
   * that of the target exactly — missing, changed, extra, or wrongly
   * duplicated numbers all reject. Catches dropped/changed values
   * (777-FTD-31-21002, dates, counts, part numbers, FL285 flight levels).
   */
  numericFidelity: boolean;
  /** Unit tokens that must be preserved verbatim (kg, mm, psi, ...). */
  preservedUnits: readonly string[];
  /** ATA chapter numbers must pass through verbatim. */
  preserveAtaChapterNumbers: boolean;
  /** Part numbers (e.g. 777-FTD-31-21002, 777-SL-31-064) must pass through. */
  preservePartNumbers: boolean;
  /** Segment alignment: translated unit count must equal source unit count. */
  segmentAlignment: boolean;
  /** Table cell alignment: table units must translate 1:1 (payload parity). */
  tableAlignment: boolean;
  /** Citation cross-references must be preserved (e.g. 777-FTD-23-20001). */
  preserveCitations: boolean;
}

export interface TranslationRulePack {
  meta: TranslationRulePackMeta;
  terms: readonly TranslationTermRule[];
  noTranslate: readonly TranslationNoTranslateRule[];
  deterministic: TranslationDeterministicRuleSet;
}

export const TRANSLATION_RULE_PACK_SCHEMA_VERSION =
  'wiselink.3_1.translation_rule_pack.v0.candidate';

/**
 * A frozen Host source unit as handed to translation. Fields mirror the
 * real frozen-2 unified package units (unitKey, kind, text, sourceRefIds).
 * The kind union is closed: recognized kinds cover the unified-package
 * kinds plus the native S1000D parser kinds (step, list_item, warning,
 * caution, note, figure); anything else fails closed.
 */
export interface TranslationSourceUnit {
  unitKey: string;
  kind:
    | 'paragraph'
    | 'heading'
    | 'text_block'
    | 'table'
    | 'preserved_source'
    | 'step'
    | 'list_item'
    | 'warning'
    | 'caution'
    | 'note'
    | 'figure';
  text: string;
  sourceRefIds: readonly string[];
}

/**
 * Explicit, trackable engineer revision metadata. A bare boolean is not
 * enough: the revision must state a nonblank revision identity, the exact
 * rule identity (id + version) it was based on, the FULL
 * CanonicalTranslationConsumptionBinding identity of the source it was
 * made against (validated field-by-field — documentId alone is
 * insufficient), and its currentness against the task binding.
 */
export interface TranslationEngineerRevisionMetadata {
  /** Nonblank revision identity (e.g. an engineer revision id/ticket). */
  revisionId: string;
  /** The exact rule pack id this revision was made against. */
  rulePackId: TranslationRulePackId;
  /** The exact rule pack version this revision was made against. */
  rulePackVersion: TranslationRulePackVersion;
  /**
   * The full source binding identity this revision was made against.
   * Every field is validated against the task binding; any drift rejects.
   */
  sourceBinding: CanonicalTranslationConsumptionBinding;
  /** Explicit currentness declared against the task binding. */
  currentness: 'CURRENT' | 'STALE';
}

/** A translated candidate unit returned for validation (post execution). */
export interface TranslationCandidateUnit {
  unitKey: string;
  text: string;
  /**
   * Exact SourceRef binding copied from the frozen source unit. The
   * validator compares this set against the source unit's set exactly;
   * duplicate refs on either side fail closed.
   */
  sourceRefIds: readonly string[];
  /** Explicit engineer revision metadata; null when the unit was not revised. */
  engineerRevision: TranslationEngineerRevisionMetadata | null;
}

/**
 * The private translation task contract: what Host freezes and hands to
 * the durable ActionAttempt / OpenClaw execution boundary.
 */
export interface TranslationTaskContract {
  schemaVersion: string;
  /** Frozen Host source units to translate. */
  sourceUnits: readonly TranslationSourceUnit[];
  /** The exact selected rule pack (data, versioned by id+version pair). */
  rulePack: TranslationRulePack;
  /**
   * Task-start currentness identity — the existing private binding type
   * from canonical-reader-consumption.ts. Single source of truth; this
   * module introduces no second hash or fence.
   */
  taskStartBinding: CanonicalTranslationConsumptionBinding;
}

export const TRANSLATION_TASK_SCHEMA_VERSION =
  'wiselink.3_1.translation_task.v0.candidate';

/**
 * The private translation RESULT contract: the runtime shape that comes
 * back from the execution boundary carrying the candidate
 * units, the exact rule identity they claim to have been translated with,
 * and the task/currentness correlation. Parsed fail-closed from unknown —
 * the shared ResultEnvelope/DTO is NOT touched or modified.
 */
export interface TranslationResultContract {
  schemaVersion: string;
  /** The rule pack id this result claims to follow. */
  rulePackId: TranslationRulePackId;
  /** The rule pack version this result claims to follow. */
  rulePackVersion: TranslationRulePackVersion;
  /** The task-start binding this result correlates with. */
  taskStartBinding: CanonicalTranslationConsumptionBinding;
  /** The translated candidate units (runtime-validated shape). */
  candidateUnits: readonly TranslationCandidateUnit[];
}

export const TRANSLATION_RESULT_SCHEMA_VERSION =
  'wiselink.3_1.translation_result.v0.candidate';

export interface TranslationValidationInput {
  rulePack: unknown;
  rulePackId: TranslationRulePackId;
  /** Required rule pack version — the exact pair is validated. */
  rulePackVersion: TranslationRulePackVersion;
  sourceUnits: readonly unknown[];
  candidateUnits: readonly unknown[];
  /**
   * Task-start currentness binding recorded when the task was frozen.
   * Null means no binding was recorded — validation fails closed rather
   * than validating an unfenced source.
   */
  taskStartBinding: CanonicalTranslationConsumptionBinding | null;
  /**
   * Validation-time currentness binding of the source being validated.
   * Compared field-by-field against taskStartBinding (exact identity, no
   * second hash).
   */
  validationTimeBinding: CanonicalTranslationConsumptionBinding | null;
}

export type TranslationCandidateVerdict =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'NEEDS_ENGINEER_REVIEW';

export interface TranslationValidationFinding {
  ruleId: string;
  code:
    | 'MISSING_UNIT' // omission (缺译)
    | 'EXTRA_UNIT' // addition (增译)
    | 'TERM_MANDATORY_MISSING' // terminology violation
    | 'NO_TRANSLATE_VIOLATED'
    | 'IDENTIFIER_NOT_PRESERVED'
    | 'NUMBER_NOT_PRESERVED'
    | 'UNIT_NOT_PRESERVED'
    | 'ATA_CHAPTER_NOT_PRESERVED'
    | 'PART_NUMBER_NOT_PRESERVED'
    | 'CITATION_NOT_PRESERVED'
    | 'TABLE_ALIGNMENT_BROKEN'
    | 'SOURCE_REF_NOT_BOUND'
    | 'SOURCE_REF_MISMATCH'
    | 'CURRENTNESS_DRIFT'
    | 'ENGINEER_REVISION_STALE'
    | 'ENGINEER_REVISION_IDENTITY_MISMATCH'
    | 'UNRECOGNIZED_RULES'
    | 'MALFORMED_INPUT';
  unitKey: string | null;
  message: string;
}

export interface TranslationValidationResult {
  schemaVersion: string;
  verdict: TranslationCandidateVerdict;
  rulePackId: TranslationRulePackId | null;
  rulePackVersion: TranslationRulePackVersion | null;
  findings: readonly TranslationValidationFinding[];
  validatedUnitCount: number;
}

export const TRANSLATION_VALIDATION_SCHEMA_VERSION =
  'wiselink.3_1.translation_validation.v0.candidate';

const RECOGNIZED_RULE_PACK_SCHEMA_VERSIONS = [
  TRANSLATION_RULE_PACK_SCHEMA_VERSION,
] as const;

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNonBlankStringArray(
  value: unknown,
  options: { allowEmpty: boolean },
): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (!options.allowEmpty && value.length === 0) return null;
  const parsed: string[] = [];
  for (const item of value) {
    if (!isNonBlankString(item)) return null;
    parsed.push(item);
  }
  return parsed;
}

function containsDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/** A syntactically valid regex source (no throw at validation time). */
function isValidRegexSource(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

interface ParsedSourceUnit {
  unitKey: string;
  kind: TranslationSourceUnit['kind'];
  text: string;
  isTable: boolean;
  sourceRefIds: readonly string[];
}

interface ParsedEngineerRevision {
  revisionId: string;
  rulePackId: string;
  rulePackVersion: string;
  sourceBinding: CanonicalTranslationConsumptionBinding;
  currentness: 'CURRENT' | 'STALE';
}

interface ParsedCandidateUnit {
  unitKey: string;
  text: string;
  sourceRefIds: readonly string[];
  engineerRevision: ParsedEngineerRevision | null;
}

function parseSourceUnit(value: unknown): ParsedSourceUnit | null {
  if (!isPlainObject(value)) return null;
  if (!isNonBlankString(value.unitKey)) return null;
  if (typeof value.text !== 'string') return null;
  const kind = value.kind;
  if (
    kind !== 'paragraph' &&
    kind !== 'heading' &&
    kind !== 'text_block' &&
    kind !== 'table' &&
    kind !== 'preserved_source' &&
    kind !== 'step' &&
    kind !== 'list_item' &&
    kind !== 'warning' &&
    kind !== 'caution' &&
    kind !== 'note' &&
    kind !== 'figure'
  ) {
    return null;
  }
  const sourceRefIds = parseNonBlankStringArray(value.sourceRefIds, {
    allowEmpty: true,
  });
  if (sourceRefIds === null) return null;
  return {
    unitKey: value.unitKey,
    kind,
    text: value.text,
    isTable: kind === 'table',
    sourceRefIds,
  };
}

function parseEngineerRevision(
  value: unknown,
): ParsedEngineerRevision | null | 'MALFORMED' {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return 'MALFORMED';
  if (!isNonBlankString(value.revisionId)) return 'MALFORMED';
  if (!isNonBlankString(value.rulePackId)) return 'MALFORMED';
  if (!isNonBlankString(value.rulePackVersion)) return 'MALFORMED';
  if (value.currentness !== 'CURRENT' && value.currentness !== 'STALE') {
    return 'MALFORMED';
  }
  if (!isPlainObject(value.sourceBinding)) return 'MALFORMED';
  if (!isBinding(value.sourceBinding)) return 'MALFORMED';
  return {
    revisionId: value.revisionId,
    rulePackId: value.rulePackId,
    rulePackVersion: value.rulePackVersion,
    sourceBinding: value.sourceBinding,
    currentness: value.currentness,
  };
}

function parseCandidateUnit(value: unknown): ParsedCandidateUnit | null {
  if (!isPlainObject(value)) return null;
  if (!isNonBlankString(value.unitKey)) return null;
  if (typeof value.text !== 'string') return null;
  const sourceRefIds = parseNonBlankStringArray(value.sourceRefIds, {
    allowEmpty: true,
  });
  if (sourceRefIds === null) return null;
  const engineerRevision = parseEngineerRevision(value.engineerRevision);
  if (engineerRevision === 'MALFORMED') return null;
  return {
    unitKey: value.unitKey,
    text: value.text,
    sourceRefIds,
    engineerRevision,
  };
}

function parseRulePack(value: unknown): TranslationRulePack | null {
  if (!isPlainObject(value)) return null;
  const meta = value.meta;
  if (!isPlainObject(meta)) return null;
  if (meta.schemaVersion !== TRANSLATION_RULE_PACK_SCHEMA_VERSION) return null;
  if (!isNonBlankString(meta.rulePackId)) return null;
  if (!isNonBlankString(meta.rulePackVersion)) return null;
  if (!isNonBlankString(meta.label)) return null;
  if (!isNonBlankString(meta.targetLocale)) return null;
  const sourceLocales = parseNonBlankStringArray(meta.sourceLocales, {
    allowEmpty: false,
  });
  if (sourceLocales === null || containsDuplicates(sourceLocales)) return null;

  const terms: TranslationTermRule[] = [];
  const ruleIds = new Set<string>();
  const termsRaw = value.terms;
  if (Array.isArray(termsRaw)) {
    for (const term of termsRaw) {
      if (!isPlainObject(term)) return null;
      if (!isNonBlankString(term.ruleId)) return null;
      if (ruleIds.has(term.ruleId)) return null;
      ruleIds.add(term.ruleId);
      if (!isNonBlankString(term.sourceTerm)) return null;
      const targetRenderings = parseNonBlankStringArray(term.targetRenderings, {
        allowEmpty: false,
      });
      if (targetRenderings === null || containsDuplicates(targetRenderings)) {
        return null;
      }
      if (term.severity !== 'mandatory') return null;
      if (term.note !== undefined && typeof term.note !== 'string') return null;
      terms.push({
        ruleId: term.ruleId,
        sourceTerm: term.sourceTerm,
        targetRenderings,
        severity: term.severity,
        note: typeof term.note === 'string' ? term.note : undefined,
      });
    }
  } else {
    return null;
  }

  const noTranslate: TranslationNoTranslateRule[] = [];
  const noTranslateRaw = value.noTranslate;
  if (Array.isArray(noTranslateRaw)) {
    for (const entry of noTranslateRaw) {
      if (!isPlainObject(entry)) return null;
      if (!isNonBlankString(entry.ruleId)) return null;
      if (ruleIds.has(entry.ruleId)) return null;
      ruleIds.add(entry.ruleId);
      if (!isNonBlankString(entry.token)) return null;
      if (entry.note !== undefined && typeof entry.note !== 'string') {
        return null;
      }
      noTranslate.push({
        ruleId: entry.ruleId,
        token: entry.token,
        note: typeof entry.note === 'string' ? entry.note : undefined,
      });
    }
  } else {
    return null;
  }

  const deterministic = value.deterministic;
  if (!isPlainObject(deterministic)) return null;
  const preservedIdentifierPatterns = parseNonBlankStringArray(
    deterministic.preservedIdentifierPatterns,
    { allowEmpty: true },
  );
  if (
    preservedIdentifierPatterns === null ||
    containsDuplicates(preservedIdentifierPatterns)
  ) {
    return null;
  }
  if (typeof deterministic.numericFidelity !== 'boolean') return null;
  const preservedUnits = parseNonBlankStringArray(
    deterministic.preservedUnits,
    { allowEmpty: true },
  );
  if (preservedUnits === null || containsDuplicates(preservedUnits)) {
    return null;
  }
  if (typeof deterministic.preserveAtaChapterNumbers !== 'boolean') return null;
  if (typeof deterministic.preservePartNumbers !== 'boolean') return null;
  if (typeof deterministic.segmentAlignment !== 'boolean') return null;
  if (typeof deterministic.tableAlignment !== 'boolean') return null;
  if (typeof deterministic.preserveCitations !== 'boolean') return null;

  // Invalid identifier regexes fail the whole pack: rule data is validated
  // before it can drive any check, and nothing throws at validation time.
  for (const pattern of preservedIdentifierPatterns) {
    if (!isValidRegexSource(pattern)) return null;
  }

  return {
    meta: {
      schemaVersion: meta.schemaVersion,
      rulePackId: meta.rulePackId,
      rulePackVersion: meta.rulePackVersion,
      label: meta.label,
      targetLocale: meta.targetLocale,
      sourceLocales,
    },
    terms,
    noTranslate,
    deterministic: {
      preservedIdentifierPatterns,
      numericFidelity: deterministic.numericFidelity,
      preservedUnits,
      preserveAtaChapterNumbers: deterministic.preserveAtaChapterNumbers,
      preservePartNumbers: deterministic.preservePartNumbers,
      segmentAlignment: deterministic.segmentAlignment,
      tableAlignment: deterministic.tableAlignment,
      preserveCitations: deterministic.preserveCitations,
    },
  };
}

/** ATA chapter number: two or three digits, optionally fraction like 31-21. */
const ATA_CHAPTER_PATTERN = /\b\d{2,3}(?:-\d{2,3})?\b/;

/** Part number families preserved in the FTD corpus (Boeing style). */
const PART_NUMBER_PATTERN =
  /\b\d{3}-(?:FTD|SL|SIL|FOTB)-\d{2,3}-\d{3,6}(?:\s?R\d+)?\b|\bD\d{10,14}\b/;

/** Citation token: a part number or a document reference like FTD 777-FTD-23-20001. */
const CITATION_PATTERN = /\b\d{3}-FTD-\d{2,3}-\d{3,6}\b/;

function sourceNumbers(text: string): string[] {
  return text.match(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) ?? [];
}

/** Numeric token multiset: token -> occurrence count. */
function numberMultiset(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * Exact field-by-field identity comparison of the existing private binding
 * type. This is the ONLY currentness check: no hash, no second fence.
 */
function bindingsIdentical(
  a: CanonicalTranslationConsumptionBinding,
  b: CanonicalTranslationConsumptionBinding,
): boolean {
  return (
    a.documentId === b.documentId &&
    a.revisionId === b.revisionId &&
    a.sbdPackageId === b.sbdPackageId &&
    a.sbdContentHash === b.sbdContentHash &&
    (a.tcpPackageId ?? null) === (b.tcpPackageId ?? null) &&
    (a.tcpContentHash ?? null) === (b.tcpContentHash ?? null)
  );
}

function bindingDriftFields(
  a: CanonicalTranslationConsumptionBinding,
  b: CanonicalTranslationConsumptionBinding,
): string[] {
  const fields: string[] = [];
  if (a.documentId !== b.documentId) fields.push('documentId');
  if (a.revisionId !== b.revisionId) fields.push('revisionId');
  if (a.sbdPackageId !== b.sbdPackageId) fields.push('sbdPackageId');
  if (a.sbdContentHash !== b.sbdContentHash) fields.push('sbdContentHash');
  if ((a.tcpPackageId ?? null) !== (b.tcpPackageId ?? null)) {
    fields.push('tcpPackageId');
  }
  if ((a.tcpContentHash ?? null) !== (b.tcpContentHash ?? null)) {
    fields.push('tcpContentHash');
  }
  return fields;
}

function isBinding(
  value: unknown,
): value is CanonicalTranslationConsumptionBinding {
  if (!isPlainObject(value)) return false;
  if (!isNonBlankString(value.documentId)) return false;
  if (!isNonBlankString(value.revisionId)) return false;
  if (!isNonBlankString(value.sbdPackageId)) return false;
  if (!isNonBlankString(value.sbdContentHash)) return false;
  if (
    value.tcpPackageId !== null &&
    value.tcpPackageId !== undefined &&
    !isNonBlankString(value.tcpPackageId)
  ) {
    return false;
  }
  if (
    value.tcpContentHash !== null &&
    value.tcpContentHash !== undefined &&
    !isNonBlankString(value.tcpContentHash)
  ) {
    return false;
  }
  return true;
}

/**
 * Exact SourceRef set comparison. Duplicates on EITHER side fail closed —
 * a duplicated ref is not an exact set match.
 */
function sameRefSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== a.length) return false; // duplicates on side a
  const setB = new Set(b);
  if (setB.size !== b.length) return false; // duplicates on side b
  for (const ref of b) {
    if (!setA.has(ref)) return false;
  }
  return true;
}

function hasDuplicateRefs(refs: readonly string[]): boolean {
  return new Set(refs).size !== refs.length;
}

function duplicateUnitKeys(
  units: readonly { unitKey: string }[],
): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.unitKey)) duplicated.add(unit.unitKey);
    seen.add(unit.unitKey);
  }
  return duplicated;
}

function sourceUnitsAreTaskReady(
  value: unknown,
): value is readonly TranslationSourceUnit[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const parsed: ParsedSourceUnit[] = [];
  for (const unit of value) {
    const sourceUnit = parseSourceUnit(unit);
    if (sourceUnit === null) return false;
    if (
      sourceUnit.sourceRefIds.length === 0 ||
      hasDuplicateRefs(sourceUnit.sourceRefIds)
    ) {
      return false;
    }
    parsed.push(sourceUnit);
  }
  return duplicateUnitKeys(parsed).size === 0;
}

/**
 * Deterministic validation of a translated candidate against a versioned
 * rule pack. Fails closed on anything unrecognized, missing, or
 * inconsistent. Never calls a model or network, and never throws.
 */
export function validateTranslationCandidate(
  input: TranslationValidationInput,
): TranslationValidationResult {
  const findings: TranslationValidationFinding[] = [];

  // Currentness: task-start vs validation-time binding identity (the
  // existing private binding type — no second hash/fence). Missing or
  // drifted bindings reject before any content check runs.
  if (
    !isBinding(input.taskStartBinding) ||
    !isBinding(input.validationTimeBinding)
  ) {
    findings.push({
      ruleId: 'currentness.binding',
      code: 'CURRENTNESS_DRIFT',
      unitKey: null,
      message:
        'task-start or validation-time currentness binding is missing/invalid (fail closed)',
    });
  } else if (
    !bindingsIdentical(input.taskStartBinding, input.validationTimeBinding)
  ) {
    const drifted = bindingDriftFields(
      input.taskStartBinding,
      input.validationTimeBinding,
    );
    findings.push({
      ruleId: 'currentness.binding',
      code: 'CURRENTNESS_DRIFT',
      unitKey: null,
      message: `currentness binding drift: ${drifted.join(', ')}`,
    });
  }

  // Rule pack shape and version.
  const rulePack = parseRulePack(input.rulePack);
  if (rulePack === null) {
    findings.push({
      ruleId: 'rulepack.schema',
      code: 'UNRECOGNIZED_RULES',
      unitKey: null,
      message:
        'rule pack failed schema/version/regex recognition (fail closed)',
    });
    return {
      schemaVersion: TRANSLATION_VALIDATION_SCHEMA_VERSION,
      verdict: 'REJECTED',
      rulePackId: null,
      rulePackVersion: null,
      findings,
      validatedUnitCount: 0,
    };
  }
  if (
    !(RECOGNIZED_RULE_PACK_SCHEMA_VERSIONS as readonly string[]).includes(
      rulePack.meta.schemaVersion,
    )
  ) {
    findings.push({
      ruleId: 'rulepack.schema',
      code: 'UNRECOGNIZED_RULES',
      unitKey: null,
      message: `unrecognized rule pack schema version: ${String(
        rulePack.meta.schemaVersion,
      )}`,
    });
  }
  if (rulePack.meta.rulePackId !== input.rulePackId) {
    findings.push({
      ruleId: 'rulepack.selection',
      code: 'UNRECOGNIZED_RULES',
      unitKey: null,
      message: `selected rule pack id ${input.rulePackId} does not match the pack's own id ${rulePack.meta.rulePackId}`,
    });
  }
  if (rulePack.meta.rulePackVersion !== input.rulePackVersion) {
    findings.push({
      ruleId: 'rulepack.selection',
      code: 'UNRECOGNIZED_RULES',
      unitKey: null,
      message: `selected rule pack version ${input.rulePackVersion} does not match the pack's own version ${rulePack.meta.rulePackVersion}`,
    });
  }

  // Source units (Host frozen source units).
  const sourceUnits: ParsedSourceUnit[] = [];
  const sourceUnitsPayload: unknown = input.sourceUnits;
  if (!Array.isArray(sourceUnitsPayload)) {
    findings.push({
      ruleId: 'source.shape',
      code: 'MALFORMED_INPUT',
      unitKey: null,
      message: 'sourceUnits must be an array (fail closed)',
    });
  } else {
    for (const unit of sourceUnitsPayload) {
      const parsed = parseSourceUnit(unit);
      if (parsed === null) {
        findings.push({
          ruleId: 'source.shape',
          code: 'MALFORMED_INPUT',
          unitKey: null,
          message: 'a source unit failed shape recognition (fail closed)',
        });
      } else {
        sourceUnits.push(parsed);
      }
    }
  }

  // Candidate units (translation result).
  const candidates: ParsedCandidateUnit[] = [];
  const candidateUnitsPayload: unknown = input.candidateUnits;
  if (!Array.isArray(candidateUnitsPayload)) {
    findings.push({
      ruleId: 'candidate.shape',
      code: 'MALFORMED_INPUT',
      unitKey: null,
      message: 'candidateUnits must be an array (fail closed)',
    });
  } else {
    for (const unit of candidateUnitsPayload) {
      const parsed = parseCandidateUnit(unit);
      if (parsed === null) {
        findings.push({
          ruleId: 'candidate.shape',
          code: 'MALFORMED_INPUT',
          unitKey: null,
          message: 'a candidate unit failed shape recognition (fail closed)',
        });
      } else {
        candidates.push(parsed);
      }
    }
  }

  const sourceByKey = new Map(sourceUnits.map((unit) => [unit.unitKey, unit]));
  const candidateByKey = new Map(
    candidates.map((unit) => [unit.unitKey, unit]),
  );
  for (const key of duplicateUnitKeys(sourceUnits)) {
    findings.push({
      ruleId: 'source.keying',
      code: 'MALFORMED_INPUT',
      unitKey: key,
      message: 'duplicate source unit key',
    });
  }
  for (const key of duplicateUnitKeys(candidates)) {
    findings.push({
      ruleId: 'candidate.keying',
      code: 'MALFORMED_INPUT',
      unitKey: key,
      message: 'duplicate candidate unit key',
    });
  }

  // Segment alignment: every source unit translated, no additions.
  if (rulePack.deterministic.segmentAlignment) {
    for (const source of sourceUnits) {
      if (!candidateByKey.has(source.unitKey)) {
        findings.push({
          ruleId: 'alignment.segment',
          code: 'MISSING_UNIT',
          unitKey: source.unitKey,
          message: 'source unit has no translated candidate (omission)',
        });
      }
    }
    for (const candidate of candidates) {
      if (!sourceByKey.has(candidate.unitKey)) {
        findings.push({
          ruleId: 'alignment.segment',
          code: 'EXTRA_UNIT',
          unitKey: candidate.unitKey,
          message: 'candidate unit has no source unit (addition)',
        });
      }
    }
  }

  // Table alignment: table units must translate 1:1 with payload parity.
  if (rulePack.deterministic.tableAlignment) {
    for (const source of sourceUnits) {
      if (!source.isTable) continue;
      const candidate = candidateByKey.get(source.unitKey);
      if (candidate === undefined) continue; // already flagged by segment alignment
      const sourceCells = source.text.split('|').length;
      const candidateCells = candidate.text.split('|').length;
      if (sourceCells !== candidateCells) {
        findings.push({
          ruleId: 'alignment.table',
          code: 'TABLE_ALIGNMENT_BROKEN',
          unitKey: source.unitKey,
          message: `table cell parity broken: source ${String(sourceCells)} cells vs candidate ${String(candidateCells)} cells`,
        });
      }
    }
  }

  const taskBinding = isBinding(input.taskStartBinding)
    ? input.taskStartBinding
    : null;

  for (const source of sourceUnits) {
    const candidate = candidateByKey.get(source.unitKey);

    // Source-side SourceRef binding: every source unit must carry at least
    // one non-blank sourceRefId; an unbound unit cannot be validated.
    // Duplicated source refs also fail closed.
    if (source.sourceRefIds.length === 0) {
      findings.push({
        ruleId: 'sourceref.binding',
        code: 'SOURCE_REF_NOT_BOUND',
        unitKey: source.unitKey,
        message: 'source unit carries no non-blank sourceRefId (unbound)',
      });
    } else if (hasDuplicateRefs(source.sourceRefIds)) {
      findings.push({
        ruleId: 'sourceref.binding',
        code: 'SOURCE_REF_MISMATCH',
        unitKey: source.unitKey,
        message:
          'source unit carries duplicate sourceRefIds (not an exact set)',
      });
    }
    if (candidate === undefined) continue;

    // Exact SourceRef set comparison between candidate and source unit.
    if (candidate.sourceRefIds.length === 0) {
      findings.push({
        ruleId: 'sourceref.binding',
        code: 'SOURCE_REF_NOT_BOUND',
        unitKey: source.unitKey,
        message: 'candidate unit carries no non-blank sourceRefId (unbound)',
      });
    } else if (hasDuplicateRefs(candidate.sourceRefIds)) {
      findings.push({
        ruleId: 'sourceref.binding',
        code: 'SOURCE_REF_MISMATCH',
        unitKey: source.unitKey,
        message:
          'candidate unit carries duplicate sourceRefIds (not an exact set)',
      });
    } else if (!sameRefSet(candidate.sourceRefIds, source.sourceRefIds)) {
      findings.push({
        ruleId: 'sourceref.binding',
        code: 'SOURCE_REF_MISMATCH',
        unitKey: source.unitKey,
        message: `candidate SourceRef set does not exactly match the source unit's set (${String(candidate.sourceRefIds.length)} vs ${String(source.sourceRefIds.length)} refs)`,
      });
    }

    // Engineer revision metadata: explicit full identity + currentness.
    // STALE rejects; ANY field drift in the source binding (not just
    // documentId) or in the rule id/version rejects; only a CURRENT
    // revision whose full binding and rule identity exactly match the task
    // routes to engineer review.
    if (candidate.engineerRevision !== null) {
      const revision = candidate.engineerRevision;
      if (revision.currentness === 'STALE') {
        findings.push({
          ruleId: 'engineer.revision',
          code: 'ENGINEER_REVISION_STALE',
          unitKey: source.unitKey,
          message: `engineer revision ${revision.revisionId} is STALE against the task binding`,
        });
      }
      if (taskBinding !== null) {
        const drift = bindingDriftFields(revision.sourceBinding, taskBinding);
        if (drift.length > 0) {
          findings.push({
            ruleId: 'engineer.revision',
            code: 'ENGINEER_REVISION_IDENTITY_MISMATCH',
            unitKey: source.unitKey,
            message: `engineer revision ${revision.revisionId} binding drift: ${drift.join(', ')}`,
          });
        }
      }
      if (revision.rulePackId !== input.rulePackId) {
        findings.push({
          ruleId: 'engineer.revision',
          code: 'ENGINEER_REVISION_IDENTITY_MISMATCH',
          unitKey: source.unitKey,
          message: `engineer revision ${revision.revisionId} was made against rule pack ${revision.rulePackId}, not the task's ${input.rulePackId}`,
        });
      }
      if (revision.rulePackVersion !== input.rulePackVersion) {
        findings.push({
          ruleId: 'engineer.revision',
          code: 'ENGINEER_REVISION_IDENTITY_MISMATCH',
          unitKey: source.unitKey,
          message: `engineer revision ${revision.revisionId} was made against rule pack version ${revision.rulePackVersion}, not the task's ${input.rulePackVersion}`,
        });
      }
    }

    for (const term of rulePack.terms) {
      if (term.severity !== 'mandatory') continue;
      if (!source.text.includes(term.sourceTerm)) continue;
      const rendered = term.targetRenderings.some((rendering) =>
        candidate.text.includes(rendering),
      );
      if (!rendered) {
        findings.push({
          ruleId: term.ruleId,
          code: 'TERM_MANDATORY_MISSING',
          unitKey: source.unitKey,
          message: `mandatory term "${term.sourceTerm}" not rendered by any of [${term.targetRenderings.join(', ')}]`,
        });
      }
    }

    for (const entry of rulePack.noTranslate) {
      if (!source.text.includes(entry.token)) continue;
      if (!candidate.text.includes(entry.token)) {
        findings.push({
          ruleId: entry.ruleId,
          code: 'NO_TRANSLATE_VIOLATED',
          unitKey: source.unitKey,
          message: `no-translate token "${entry.token}" must be retained verbatim`,
        });
      }
    }

    for (const pattern of rulePack.deterministic.preservedIdentifierPatterns) {
      // Patterns were regex-validated at parse time; guard anyway so the
      // validator can never throw.
      let regex: RegExp | null = null;
      try {
        regex = new RegExp(pattern, 'g');
      } catch {
        regex = null;
      }
      if (regex === null) {
        findings.push({
          ruleId: 'identifier.preserve',
          code: 'UNRECOGNIZED_RULES',
          unitKey: source.unitKey,
          message: `identifier pattern is not a valid regex: ${pattern}`,
        });
        continue;
      }
      const matches = source.text.match(regex) ?? [];
      for (const identifier of matches) {
        if (!candidate.text.includes(identifier)) {
          findings.push({
            ruleId: 'identifier.preserve',
            code: 'IDENTIFIER_NOT_PRESERVED',
            unitKey: source.unitKey,
            message: `identifier "${identifier}" must be preserved verbatim`,
          });
        }
      }
    }

    if (rulePack.deterministic.numericFidelity) {
      // Token multiset equality: missing, changed, extra, or wrongly
      // duplicated numbers all reject. A changed value surfaces either as
      // a missing source token or an extra target token.
      const sourceCounts = numberMultiset(sourceNumbers(source.text));
      const targetCounts = numberMultiset(sourceNumbers(candidate.text));
      for (const [token, sourceCount] of sourceCounts) {
        const targetCount = targetCounts.get(token) ?? 0;
        if (targetCount < sourceCount) {
          findings.push({
            ruleId: 'number.fidelity',
            code: 'NUMBER_NOT_PRESERVED',
            unitKey: source.unitKey,
            message: `number "${token}" appears ${String(sourceCount)}x in the source but only ${String(targetCount)}x in the translation`,
          });
        }
      }
      for (const [token, targetCount] of targetCounts) {
        const sourceCount = sourceCounts.get(token) ?? 0;
        if (targetCount > sourceCount) {
          findings.push({
            ruleId: 'number.fidelity',
            code: 'NUMBER_NOT_PRESERVED',
            unitKey: source.unitKey,
            message: `number "${token}" appears ${String(targetCount)}x in the translation but only ${String(sourceCount)}x in the source (extra/changed)`,
          });
        }
      }
    }

    for (const unit of rulePack.deterministic.preservedUnits) {
      if (!source.text.includes(unit)) continue;
      if (!candidate.text.includes(unit)) {
        findings.push({
          ruleId: 'unit.preserve',
          code: 'UNIT_NOT_PRESERVED',
          unitKey: source.unitKey,
          message: `unit "${unit}" must be preserved verbatim`,
        });
      }
    }

    if (rulePack.deterministic.preserveAtaChapterNumbers) {
      const ataMatches = source.text.match(ATA_CHAPTER_PATTERN) ?? [];
      for (const ata of ataMatches) {
        if (!candidate.text.includes(ata)) {
          findings.push({
            ruleId: 'ata.preserve',
            code: 'ATA_CHAPTER_NOT_PRESERVED',
            unitKey: source.unitKey,
            message: `ATA chapter "${ata}" must be preserved verbatim`,
          });
        }
      }
    }

    if (rulePack.deterministic.preservePartNumbers) {
      const partMatches = source.text.match(PART_NUMBER_PATTERN) ?? [];
      for (const part of partMatches) {
        if (!candidate.text.includes(part)) {
          findings.push({
            ruleId: 'part.preserve',
            code: 'PART_NUMBER_NOT_PRESERVED',
            unitKey: source.unitKey,
            message: `part number "${part}" must be preserved verbatim`,
          });
        }
      }
    }

    if (rulePack.deterministic.preserveCitations) {
      const citationMatches = source.text.match(CITATION_PATTERN) ?? [];
      for (const citation of citationMatches) {
        if (!candidate.text.includes(citation)) {
          findings.push({
            ruleId: 'citation.preserve',
            code: 'CITATION_NOT_PRESERVED',
            unitKey: source.unitKey,
            message: `citation "${citation}" must be preserved verbatim`,
          });
        }
      }
    }
  }

  // Verdict: any finding at all — including MALFORMED_INPUT — rejects:
  // nothing fails open. Only a finding-free candidate with at least one
  // CURRENT, fully identity-matching explicit engineer revision routes to
  // NEEDS_ENGINEER_REVIEW; a clean unrevised candidate is ACCEPTED.
  const revisedCount = candidates.filter(
    (candidate) => candidate.engineerRevision !== null,
  ).length;

  const verdict: TranslationCandidateVerdict =
    findings.length > 0
      ? 'REJECTED'
      : revisedCount > 0
        ? 'NEEDS_ENGINEER_REVIEW'
        : 'ACCEPTED';

  return {
    schemaVersion: TRANSLATION_VALIDATION_SCHEMA_VERSION,
    verdict,
    rulePackId: rulePack.meta.rulePackId,
    rulePackVersion: rulePack.meta.rulePackVersion,
    findings,
    validatedUnitCount: candidates.length,
  };
}

/**
 * Rule selection: exact (rulePackId, rulePackVersion) pair match against a
 * registry keyed by id. Unknown ids or versions fail closed (null) — no
 * fallback pack is ever silently selected and a version is never implied
 * by the id or the schemaVersion.
 */
export function selectTranslationRulePack(
  registry: ReadonlyMap<TranslationRulePackId, unknown>,
  rulePackId: TranslationRulePackId,
  rulePackVersion: TranslationRulePackVersion,
): TranslationRulePack | null {
  const candidate = registry.get(rulePackId);
  if (candidate === undefined) return null;
  const parsed = parseRulePack(candidate);
  if (parsed === null) return null;
  if (parsed.meta.rulePackId !== rulePackId) return null;
  if (parsed.meta.rulePackVersion !== rulePackVersion) return null;
  return parsed;
}

/**
 * Build the private translation task contract (the frozen payload handed
 * to the durable ActionAttempt / OpenClaw boundary). Fails
 * closed (null) when the rule pack id/version pair or binding is not
 * exactly selectable.
 */
export function buildTranslationTaskContract(input: {
  sourceUnits: readonly TranslationSourceUnit[];
  rulePack: unknown;
  rulePackId: TranslationRulePackId;
  rulePackVersion: TranslationRulePackVersion;
  taskStartBinding: CanonicalTranslationConsumptionBinding | null;
}): TranslationTaskContract | null {
  const rulePack = parseRulePack(input.rulePack);
  if (rulePack === null) return null;
  if (rulePack.meta.rulePackId !== input.rulePackId) return null;
  if (rulePack.meta.rulePackVersion !== input.rulePackVersion) return null;
  if (!isBinding(input.taskStartBinding)) return null;
  if (!sourceUnitsAreTaskReady(input.sourceUnits)) return null;
  return {
    schemaVersion: TRANSLATION_TASK_SCHEMA_VERSION,
    sourceUnits: input.sourceUnits,
    rulePack,
    taskStartBinding: input.taskStartBinding,
  };
}

/**
 * Parse the private translation RESULT contract from an unknown runtime
 * payload (the shape that returns from the execution boundary).
 * Fail-closed: null on any unrecognized schema, missing rule id/version,
 * missing/invalid binding, or malformed candidate unit. The shared
 * ResultEnvelope/DTO is not touched — this is a lane-local private shape.
 */
export function parseTranslationResultContract(
  value: unknown,
): TranslationResultContract | null {
  if (!isPlainObject(value)) return null;
  if (value.schemaVersion !== TRANSLATION_RESULT_SCHEMA_VERSION) return null;
  if (!isNonBlankString(value.rulePackId)) return null;
  if (!isNonBlankString(value.rulePackVersion)) return null;
  if (!isBinding(value.taskStartBinding)) return null;
  if (!Array.isArray(value.candidateUnits)) return null;
  const candidateUnits: TranslationCandidateUnit[] = [];
  for (const unit of value.candidateUnits) {
    const parsed = parseCandidateUnit(unit);
    if (parsed === null) return null;
    candidateUnits.push({
      unitKey: parsed.unitKey,
      text: parsed.text,
      sourceRefIds: parsed.sourceRefIds,
      engineerRevision: parsed.engineerRevision,
    });
  }
  return {
    schemaVersion: value.schemaVersion,
    rulePackId: value.rulePackId,
    rulePackVersion: value.rulePackVersion,
    taskStartBinding: value.taskStartBinding,
    candidateUnits,
  };
}

/**
 * Validate a private translation result contract end-to-end: the result's
 * rule identity must exactly match the selected task's (id + version),
 * its task/currentness correlation binding must exactly match the task's
 * task-start binding, and the candidate units then run through the full
 * deterministic validation. Fail-closed; never throws; never calls a
 * model or network.
 */
export function validateTranslationResultContract(
  result: unknown,
  input: Omit<TranslationValidationInput, 'candidateUnits'>,
): TranslationValidationResult {
  const parsed = parseTranslationResultContract(result);
  if (parsed === null) {
    return {
      schemaVersion: TRANSLATION_VALIDATION_SCHEMA_VERSION,
      verdict: 'REJECTED',
      rulePackId: null,
      rulePackVersion: null,
      findings: [
        {
          ruleId: 'result.shape',
          code: 'MALFORMED_INPUT',
          unitKey: null,
          message:
            'translation result contract failed runtime shape recognition (fail closed)',
        },
      ],
      validatedUnitCount: 0,
    };
  }

  const findings: TranslationValidationFinding[] = [];

  // Exact rule identity correlation: id AND version.
  if (parsed.rulePackId !== input.rulePackId) {
    findings.push({
      ruleId: 'result.ruleidentity',
      code: 'UNRECOGNIZED_RULES',
      unitKey: null,
      message: `result rule pack id ${parsed.rulePackId} does not match the task's ${input.rulePackId}`,
    });
  }
  if (parsed.rulePackVersion !== input.rulePackVersion) {
    findings.push({
      ruleId: 'result.ruleidentity',
      code: 'UNRECOGNIZED_RULES',
      unitKey: null,
      message: `result rule pack version ${parsed.rulePackVersion} does not match the task's ${input.rulePackVersion}`,
    });
  }

  // Task/currentness correlation: the result's task-start binding must be
  // exactly the task's binding, field by field.
  if (!isBinding(input.taskStartBinding)) {
    findings.push({
      ruleId: 'result.correlation',
      code: 'CURRENTNESS_DRIFT',
      unitKey: null,
      message: 'task-start binding is missing/invalid (fail closed)',
    });
  } else {
    const drift = bindingDriftFields(
      parsed.taskStartBinding,
      input.taskStartBinding,
    );
    if (drift.length > 0) {
      findings.push({
        ruleId: 'result.correlation',
        code: 'CURRENTNESS_DRIFT',
        unitKey: null,
        message: `result task correlation drift: ${drift.join(', ')}`,
      });
    }
  }

  // Content validation of the carried candidate units.
  const contentResult = validateTranslationCandidate({
    ...input,
    candidateUnits: parsed.candidateUnits,
  });

  return {
    schemaVersion: TRANSLATION_VALIDATION_SCHEMA_VERSION,
    verdict:
      findings.length > 0 || contentResult.verdict === 'REJECTED'
        ? 'REJECTED'
        : contentResult.verdict,
    rulePackId: contentResult.rulePackId,
    rulePackVersion: contentResult.rulePackVersion,
    findings: [...findings, ...contentResult.findings],
    validatedUnitCount: contentResult.validatedUnitCount,
  };
}
