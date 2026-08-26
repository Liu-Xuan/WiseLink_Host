import type { CanonicalReaderTranslationProjection } from '@shared/api.interface';

/**
 * WL31 translation-reader candidate: two independent consumption axes.
 *
 * Source of truth: R08 rev613 fresh-read 2026-08-26 (contract) plus the
 * owner-confirmed docs/WORKBENCH_V1_0_11_REUSE_MAPPING_20260820.md guard list.
 * The two axes are NOT interchangeable and NOT derivable from each other:
 *
 *   ownerSourceReaderConsumptionAllowed =
 *     owner.currentConsumptionAllowed && all currentness/identity guards pass
 *
 *   bilingualTranslationConsumptionAllowed =
 *     ownerSourceReaderConsumptionAllowed &&
 *     owner.productState === 'reading_aid_available' &&
 *     owner.pendingTranslationUnitCount === 0
 *
 * Closing either axis must never silently open the other. Missing, stale,
 * mismatched, or unrecognized owner fields fail closed.
 */

const RECOGNIZED_OWNER_OBSERVATION_SCHEMA_VERSIONS = [
  'wiselink.3_1.translation_owner_observation.v0.candidate',
] as const;

const OWNER_SOURCE_TRUTH = 'StructuredBilingualDocument.units';

export interface CanonicalTranslationOwnerObservation {
  schemaVersion: string;
  documentId: string;
  revisionId: string;
  sourceTruth: string;
  /** Owner flag for a current, source-bound reading projection. */
  currentConsumptionAllowed: boolean;
  /** Owner may set a source-truth/currentness guard; any guard fails closed. */
  currentnessGuardReason: string | null;
  productState: string;
  translatedUnitCount: number;
  pendingTranslationUnitCount: number;
  translationRequiredUnitCount: number;
  /**
   * Owner-provided slim unit rows. Rows are mandatory whenever translation-
   * required units exist: aggregate counts cannot prove row identity,
   * SourceRef binding, or translated-text state.
   */
  units: readonly CanonicalTranslationOwnerUnitRow[] | null;
  lineage: {
    documentId: string;
    revisionId: string;
    sbdPackageId: string;
    sbdContentHash: string;
    /** Owner-reported TCP lineage; null when the owner reports none. */
    tcpPackageId: string | null;
    tcpContentHash: string | null;
  };
}

/**
 * SourceUnit row identities retained verbatim from the Host-owned
 * translation observation. Consumers must not reconstruct these fields.
 */
export interface CanonicalTranslationOwnerUnitRow {
  unitKey: string;
  sourceUnitId: string;
  sourceRef: string;
  sourceHash: string;
  sourceTextHash: string;
  targetLocale: string;
  translatedTextState: 'translated' | 'pending';
}

/**
 * The current document/lineage identity the owner observation must match
 * exactly. Package presence alone is insufficient: SBD and TCP package
 * identities and source-package hashes must match the current
 * DTI -> SBD -> TCP lineage.
 */
export interface CanonicalTranslationConsumptionBinding {
  documentId: string;
  revisionId: string;
  sbdPackageId: string;
  sbdContentHash: string;
  /** Host-known TCP lineage; null until Host projects one. Never fabricated. */
  tcpPackageId: string | null;
  tcpContentHash: string | null;
}

export interface CanonicalTranslationConsumptionInput {
  observation: CanonicalTranslationOwnerObservation | null;
  binding: CanonicalTranslationConsumptionBinding | null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function unitCountsConsistent(
  observation: CanonicalTranslationOwnerObservation,
): boolean {
  return (
    isNonNegativeInteger(observation.translatedUnitCount) &&
    isNonNegativeInteger(observation.pendingTranslationUnitCount) &&
    isNonNegativeInteger(observation.translationRequiredUnitCount) &&
    observation.translatedUnitCount +
      observation.pendingTranslationUnitCount ===
      observation.translationRequiredUnitCount
  );
}

const RECOGNIZED_TRANSLATED_TEXT_STATES = ['translated', 'pending'] as const;

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Runtime row guard. The observation crosses a payload boundary, so its
 * declared TypeScript type cannot establish runtime shape. Missing or
 * malformed rows, duplicate unit keys, blank identities, unknown states, or
 * row/count drift all fail closed instead of throwing.
 */
function unitRowsConsistent(
  observation: CanonicalTranslationOwnerObservation,
): boolean {
  const rows: unknown = observation.units;
  if (rows === undefined) return false;
  if (rows === null) {
    return observation.translationRequiredUnitCount === 0;
  }
  if (!Array.isArray(rows)) return false;
  if (rows.length !== observation.translationRequiredUnitCount) return false;

  const seenUnitKeys = new Set<string>();
  let translatedRows = 0;
  let pendingRows = 0;

  for (const row of rows) {
    if (row === null || typeof row !== 'object') return false;
    if (!isNonBlankString(row.unitKey)) return false;
    if (!isNonBlankString(row.sourceUnitId)) return false;
    if (!isNonBlankString(row.sourceRef)) return false;
    if (!isNonBlankString(row.sourceHash)) return false;
    if (!isNonBlankString(row.sourceTextHash)) return false;
    if (!isNonBlankString(row.targetLocale)) return false;
    if (
      !(RECOGNIZED_TRANSLATED_TEXT_STATES as readonly string[]).includes(
        row.translatedTextState,
      )
    ) {
      return false;
    }
    if (seenUnitKeys.has(row.unitKey)) return false;
    seenUnitKeys.add(row.unitKey);
    if (row.translatedTextState === 'translated') translatedRows += 1;
    else pendingRows += 1;
  }

  return (
    translatedRows === observation.translatedUnitCount &&
    pendingRows === observation.pendingTranslationUnitCount
  );
}

function lineageMatches(
  observation: CanonicalTranslationOwnerObservation,
  binding: CanonicalTranslationConsumptionBinding,
): boolean {
  return (
    observation.lineage.documentId === binding.documentId &&
    observation.lineage.revisionId === binding.revisionId &&
    observation.lineage.sbdPackageId === binding.sbdPackageId &&
    observation.lineage.sbdContentHash === binding.sbdContentHash &&
    (observation.lineage.tcpPackageId ?? null) ===
      (binding.tcpPackageId ?? null) &&
    (observation.lineage.tcpContentHash ?? null) ===
      (binding.tcpContentHash ?? null)
  );
}

function unavailable(): CanonicalReaderTranslationProjection {
  return {
    status: 'UNAVAILABLE',
    reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
  };
}

/**
 * Derive the reader translation projection with the two independent
 * consumption axes. Every guard fails closed: any missing, unrecognized,
 * mismatched, stale, or inconsistent owner field denies the owner-source
 * axis, and the bilingual axis additionally requires the owner-provided
 * reading-aid readiness.
 */
export function deriveTranslationConsumptionAxes(
  input: CanonicalTranslationConsumptionInput,
): CanonicalReaderTranslationProjection {
  const observation = input.observation;
  const binding = input.binding;
  if (observation === null || binding === null) return unavailable();

  const failureReasons: string[] = [];

  if (
    !(
      RECOGNIZED_OWNER_OBSERVATION_SCHEMA_VERSIONS as readonly string[]
    ).includes(observation.schemaVersion)
  ) {
    failureReasons.push('OWNER_SCHEMA_UNRECOGNIZED');
  }
  if (
    observation.documentId !== binding.documentId ||
    observation.revisionId !== binding.revisionId
  ) {
    failureReasons.push('OWNER_DOCUMENT_IDENTITY_MISMATCH');
  }
  if (observation.sourceTruth !== OWNER_SOURCE_TRUTH) {
    failureReasons.push('OWNER_SOURCE_TRUTH_UNEXPECTED');
  }
  if (observation.currentConsumptionAllowed !== true) {
    failureReasons.push('OWNER_CURRENT_CONSUMPTION_NOT_ALLOWED');
  }
  if (observation.currentnessGuardReason !== null) {
    failureReasons.push('OWNER_CURRENTNESS_GUARD_SET');
  }
  if (!lineageMatches(observation, binding)) {
    failureReasons.push('OWNER_LINEAGE_IDENTITY_MISMATCH');
  }
  if (!unitCountsConsistent(observation)) {
    failureReasons.push('OWNER_UNIT_COUNTS_INCONSISTENT');
  }
  if (!unitRowsConsistent(observation)) {
    failureReasons.push('OWNER_UNIT_ROWS_INCONSISTENT');
  }

  const ownerSourceReaderConsumptionAllowed = failureReasons.length === 0;

  const bilingualTranslationConsumptionAllowed =
    ownerSourceReaderConsumptionAllowed &&
    observation.productState === 'reading_aid_available' &&
    observation.pendingTranslationUnitCount === 0;

  if (!ownerSourceReaderConsumptionAllowed) {
    return {
      status: 'TRANSLATION_GAP',
      axes: {
        ownerSourceReaderConsumptionAllowed,
        bilingualTranslationConsumptionAllowed,
        ownerProductState: observation.productState,
        translatedUnitCount: observation.translatedUnitCount,
        pendingTranslationUnitCount: observation.pendingTranslationUnitCount,
        translationRequiredUnitCount: observation.translationRequiredUnitCount,
        failureReasons,
      },
    };
  }

  return {
    status: bilingualTranslationConsumptionAllowed
      ? 'BILINGUAL_READING_AID_AVAILABLE'
      : 'SOURCE_CURRENT_TRANSLATION_PENDING',
    axes: {
      ownerSourceReaderConsumptionAllowed,
      bilingualTranslationConsumptionAllowed,
      ownerProductState: observation.productState,
      translatedUnitCount: observation.translatedUnitCount,
      pendingTranslationUnitCount: observation.pendingTranslationUnitCount,
      translationRequiredUnitCount: observation.translationRequiredUnitCount,
      failureReasons,
    },
  };
}
