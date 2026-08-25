import { createHash } from 'node:crypto';

import { ProfessionalInputPureError } from './professional-input-pure.error';

/**
 * RFC 8785 (JCS) restricted canonicalization: object members sorted by
 * UTF-16 code unit order, no whitespace, safe integers only, no undefined
 * values. This mirrors the techpub.hash.v1 canonicalization used by the
 * frozen.2 contract.
 */
export function jcsCanonicalize(value: unknown, path = '$'): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertJcsString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ProfessionalInputPureError(
        'JCS_NUMBER_NOT_SAFE_INTEGER',
        `Number at ${path} is not a safe integer; the pure pipeline only emits integer-valued JSON.`,
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown, index: number) =>
        jcsCanonicalize(item, `${path}[${index}]`),
      )
      .join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry) => entry[1] !== undefined,
    );
    entries.sort((left, right) =>
      left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
    );
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${jcsCanonicalize(item, `${path}.${key}`)}`,
      )
      .join(',')}}`;
  }
  throw new ProfessionalInputPureError(
    'JCS_VALUE_UNSUPPORTED',
    `Value at ${path} is not representable in the canonical JSON domain.`,
  );
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256Urn(input: string | Uint8Array): string {
  return `sha256:${sha256Hex(input)}`;
}

export function techpubEntityId(kind: string, hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new ProfessionalInputPureError(
      'ENTITY_ID_HASH_INVALID',
      `Hash digest for entity kind "${kind}" must be 64 lowercase hex characters.`,
    );
  }
  if (!/^[a-z0-9-]+$/.test(kind)) {
    throw new ProfessionalInputPureError(
      'ENTITY_ID_KIND_INVALID',
      `Entity kind "${kind}" must match ^[a-z0-9-]+$.`,
    );
  }
  return `urn:techpub:${kind}:v1:sha256:${hex}`;
}

function assertJcsString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : NaN;
      const paired = next >= 0xdc00 && next <= 0xdfff ? next : NaN;
      if (Number.isNaN(paired)) {
        throw new ProfessionalInputPureError(
          'JCS_STRING_LONE_SURROGATE',
          `String at ${path} contains an unpaired surrogate and cannot be canonicalized.`,
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ProfessionalInputPureError(
        'JCS_STRING_LONE_SURROGATE',
        `String at ${path} contains an unpaired surrogate and cannot be canonicalized.`,
      );
    }
  }
}
