const CANONICAL_HOST_SHA256 = /^(?:sha256:)?([0-9a-f]{64})$/u;

export function canonicalHostBareSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return CANONICAL_HOST_SHA256.exec(value)?.[1] ?? null;
}
