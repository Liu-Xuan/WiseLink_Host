import {
  getCanonicalHostClientSessionGeneration,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

export interface PdfReadingPosition {
  page: number;
  /** Position of viewport top relative to the observed page's rendered height. */
  offsetRatio: number;
  zoom: number;
}
const positions = new Map<string, { value: PdfReadingPosition; expiresAt: number }>();
const MAX_ENTRIES = 32;
const TTL_MS = 30 * 60 * 1000;
subscribeCanonicalHostClientSession(() => positions.clear());

export function readPdfPosition(key: string | null, session: number): PdfReadingPosition | null {
  if (!key || session !== getCanonicalHostClientSessionGeneration()) return null;
  const entry = positions.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { positions.delete(key); return null; }
  positions.delete(key); positions.set(key, entry);
  return { ...entry.value };
}

export function savePdfPosition(key: string | null, value: PdfReadingPosition, session: number): void {
  if (!key || key.length > 4096 || session !== getCanonicalHostClientSessionGeneration() ||
    !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 100000 ||
    !Number.isFinite(value.offsetRatio) || Math.abs(value.offsetRatio) > 4 ||
    !Number.isFinite(value.zoom) || value.zoom < .75 || value.zoom > 1.75) return;
  for (const [storedKey, entry] of positions) if (entry.expiresAt <= Date.now()) positions.delete(storedKey);
  positions.delete(key);
  positions.set(key, { value: { ...value }, expiresAt: Date.now() + TTL_MS });
  while (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value!);
}
