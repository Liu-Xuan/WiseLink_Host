import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { canonicalModelError } from './canonical-model-catalog';

export function parseExecutionModel(
  value: unknown,
): CanonicalExecutionModelSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const keys = [
    'modelRef',
    'displayName',
    'providerKind',
    'settingsRevision',
    'selectedAt',
  ];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !(key in row)) ||
    typeof row.modelRef !== 'string' ||
    row.modelRef.length > 255 ||
    !/^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9/._:-]*$/u.test(
      row.modelRef,
    ) ||
    typeof row.displayName !== 'string' ||
    !row.displayName.trim() ||
    row.displayName.length > 120 ||
    !['BUILT_IN', 'CUSTOM'].includes(String(row.providerKind)) ||
    typeof row.settingsRevision !== 'number' ||
    !Number.isSafeInteger(row.settingsRevision) ||
    row.settingsRevision < 0 ||
    typeof row.selectedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.selectedAt))
  )
    invalid();
  return row as unknown as CanonicalExecutionModelSelection;
}

export function readStoredExecutionModel(
  value: string | null | undefined,
): CanonicalExecutionModelSelection | null {
  if (value == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid();
  }
  return parseExecutionModel(parsed);
}

function invalid(): never {
  throw canonicalModelError('TASK_EXECUTION_MODEL_INVALID', 400);
}
