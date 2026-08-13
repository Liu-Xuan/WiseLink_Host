import { createHash } from 'node:crypto';

export const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/u;
export const RAW_SHA256 = /^[0-9a-f]{64}$/u;
export const PACKAGE_ID = /^urn:techpub:package:v1:sha256:[0-9a-f]{64}$/u;

export function sha256Raw(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Prefixed(value: Uint8Array): string {
  return `sha256:${sha256Raw(value)}`;
}

export function sha256Text(value: string): string {
  return sha256Prefixed(new TextEncoder().encode(value));
}

export function requiredText(
  value: unknown,
  field: string,
  maxLength = 1000,
): string {
  if (typeof value !== 'string') {
    throw new Error(`UNIFIED_TEXT_REQUIRED:${field}`);
  }
  const normalized: string = value.trim().normalize('NFC');
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`UNIFIED_TEXT_INVALID:${field}`);
  }
  return normalized;
}

export function recordValue(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`UNIFIED_OBJECT_REQUIRED:${field}`);
  }
  return value as Record<string, unknown>;
}

export function recordArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`UNIFIED_ARRAY_REQUIRED:${field}`);
  }
  return value;
}

export function stringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item: unknown) => typeof item !== 'string')
  ) {
    throw new Error(`UNIFIED_STRING_ARRAY_REQUIRED:${field}`);
  }
  return value as string[];
}

export function hashValue(value: unknown, field: string): string {
  const normalized: string = requiredText(value, field, 71);
  if (!PREFIXED_SHA256.test(normalized)) {
    throw new Error(`UNIFIED_HASH_INVALID:${field}`);
  }
  return normalized;
}

export function rawHashValue(value: unknown, field: string): string {
  const normalized: string = requiredText(value, field, 64);
  if (!RAW_SHA256.test(normalized)) {
    throw new Error(`UNIFIED_HASH_INVALID:${field}`);
  }
  return normalized;
}

export function packageIdValue(value: unknown, field: string): string {
  const normalized: string = requiredText(value, field, 200);
  if (!PACKAGE_ID.test(normalized)) {
    throw new Error(`UNIFIED_PACKAGE_ID_INVALID:${field}`);
  }
  return normalized;
}

export function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  if (value === undefined) return null;
  return recordValue(value, field);
}

export function assertNoDuplicateJsonKeys(text: string): void {
  const stack: Array<Set<string> | null> = [];
  let index = 0;
  let expectingKey = false;
  let pendingKey: string | null = null;
  while (index < text.length) {
    const char: string = text[index];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"') {
      const start: number = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index] === '"') break;
        index += 1;
      }
      if (index >= text.length) {
        throw new Error('UNIFIED_PACKAGE_JSON_INVALID');
      }
      const literal: string = text.slice(start, index + 1);
      index += 1;
      if (expectingKey) pendingKey = JSON.parse(literal) as string;
      continue;
    }
    if (char === '{') {
      stack.push(new Set<string>());
      expectingKey = true;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === '[') {
      stack.push(null);
      expectingKey = false;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === ':') {
      const keys: Set<string> | null | undefined = stack.at(-1);
      if (!(keys instanceof Set) || pendingKey === null) {
        throw new Error('UNIFIED_PACKAGE_JSON_INVALID');
      }
      if (keys.has(pendingKey)) {
        throw new Error(`UNIFIED_PACKAGE_DUPLICATE_KEY:${pendingKey}`);
      }
      keys.add(pendingKey);
      expectingKey = false;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === ',') {
      expectingKey = stack.at(-1) instanceof Set;
      pendingKey = null;
      index += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      expectingKey = false;
      pendingKey = null;
      index += 1;
      continue;
    }
    index += 1;
  }
  if (stack.length !== 0) {
    throw new Error('UNIFIED_PACKAGE_JSON_INVALID');
  }
}

export function canonicalJson(value: unknown, path = '$'): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertValidUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`UNIFIED_JCS_NUMBER_INVALID:${path}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = value.map(
      (item: unknown, index: number) =>
        canonicalJson(item, `${path}[${index}]`),
    );
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries: Array<[string, unknown]> = Object.entries(
      value as Record<string, unknown>,
    )
      .filter((entry: [string, unknown]) => entry[1] !== undefined)
      .sort(
        (left: [string, unknown], right: [string, unknown]) =>
          left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
      );
    const members: string[] = entries.map(([key, item]) => {
      assertValidUnicode(key, `${path}.key`);
      return `${JSON.stringify(key)}:${canonicalJson(item, `${path}.${key}`)}`;
    });
    return `{${members.join(',')}}`;
  }
  throw new Error(`UNIFIED_JCS_VALUE_INVALID:${path}`);
}

export function contentView(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = stripArtifactLocations(
    value,
  ) as Record<string, unknown>;
  delete copy.packageId;
  delete copy.integrity;
  const lineage: unknown = copy.lineage;
  if (lineage && typeof lineage === 'object' && !Array.isArray(lineage)) {
    delete (lineage as Record<string, unknown>).generatedAt;
  }
  return copy;
}

function stripArtifactLocations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => stripArtifactLocations(item));
  }
  if (value && typeof value === 'object') {
    const entries: Array<[string, unknown]> = Object.entries(
      value as Record<string, unknown>,
    ).filter(
      ([key, item]: [string, unknown]) =>
        key !== 'artifactRef' && key !== 'originalPath' && item !== undefined,
    );
    return Object.fromEntries(
      entries.map(([key, item]: [string, unknown]) => [
        key,
        stripArtifactLocations(item),
      ]),
    );
  }
  return value;
}

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code: number = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next: number = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`UNIFIED_JCS_UNICODE_INVALID:${path}`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`UNIFIED_JCS_UNICODE_INVALID:${path}`);
    }
  }
}
