import { createHash, randomUUID } from 'node:crypto';

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(bytes).digest('hex');
}

export function digestValue(value) {
  return sha256Hex(stableStringify(value));
}

export function deterministicId(prefix, ...parts) {
  return `${prefix}_${sha256Hex(parts.map((part) => String(part)).join('|')).slice(0, 24)}`;
}

export function defaultIdFactory(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function assertNonEmptyString(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw Object.assign(new Error(`${fieldName} is required.`), {
      code: 'REQUIRED_FIELD_MISSING',
      fieldName,
    });
  }
  return normalized;
}
