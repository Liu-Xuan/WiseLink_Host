import { createHash } from 'node:crypto';

export class AeoEditorProjectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AeoEditorProjectionError';
  }
}

export function projectionError(code: string, message: string): never {
  throw new AeoEditorProjectionError(code, message);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Prefixed(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function requireExactKeys(
  value: Record<string, unknown>,
  expected: string[],
  code: string,
  label: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  const required = [...expected].sort(compareText);
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    projectionError(
      code,
      `${label} has missing or unsupported fields: ${actual.join(', ')}.`,
    );
  }
}

export function requireNonEmptyString(
  value: unknown,
  code: string,
  label: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    projectionError(code, `${label} must be a non-empty string.`);
  }
  return value;
}

export function requireNullableString(
  value: unknown,
  code: string,
  label: string,
): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, code, label);
}

export function requireSha256(
  value: unknown,
  code: string,
  label: string,
): string {
  const exact = requireNonEmptyString(value, code, label);
  if (!/^[a-f0-9]{64}$/u.test(exact)) {
    projectionError(code, `${label} must be a lowercase SHA-256 value.`);
  }
  return exact;
}

export function requirePrefixedSha256(
  value: unknown,
  code: string,
  label: string,
): string {
  const exact = requireNonEmptyString(value, code, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(exact)) {
    projectionError(
      code,
      `${label} must use the sha256:<lowercase hex> wire format.`,
    );
  }
  return exact;
}

export function requirePositiveInteger(
  value: unknown,
  code: string,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    projectionError(code, `${label} must be a positive integer.`);
  }
  return Number(value);
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    projectionError(code, `${label} has an unsupported value.`);
  }
  return value as T;
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
