import { getCanonicalHostClientSessionGeneration, readDocumentVersionOriginal, readDocumentVersionOriginalIdentity, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';

type Entry = { blob: Blob; generation: number; expires: number; sha256?: string; digest?: Promise<string> };
const entries = new Map<string, Entry>();
const MAX_FILE = 16 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const TTL = 5 * 60 * 1000;
let timer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;

export function clearDocumentOriginalMemory() {
  entries.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
  unsubscribe?.(); unsubscribe = undefined;
}
function sweep() {
  const generation = getCanonicalHostClientSessionGeneration();
  for (const [key, entry] of entries) if (entry.expires <= Date.now() || entry.generation !== generation) entries.delete(key);
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!entries.size) { clearDocumentOriginalMemory(); return; }
  timer = setTimeout(sweep, Math.max(1, Math.min(...[...entries.values()].map(entry => entry.expires)) - Date.now()));
}
function remember(id: string, blob: Blob, generation: number) {
  if (!blob.size || blob.size > MAX_FILE) return;
  entries.delete(id);
  entries.set(id, { blob, generation, expires: Date.now() + TTL });
  let total = [...entries.values()].reduce((sum, entry) => sum + entry.blob.size, 0);
  while (entries.size > 4 || total > MAX_TOTAL) {
    const oldest = entries.keys().next().value!;
    total -= entries.get(oldest)!.blob.size; entries.delete(oldest);
  }
  unsubscribe ??= subscribeCanonicalHostClientSession(clearDocumentOriginalMemory);
  sweep();
}
let activeReads = 0;
const waiting = new Set<() => void>();
function acquireRead(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { waiting.delete(start); signal.removeEventListener('abort', cancel); reject(new Error('DOCUMENT_ORIGINAL_READ_OBSOLETE')); };
    const start = () => {
      if (activeReads >= 2) return;
      waiting.delete(start); signal.removeEventListener('abort', cancel);
      activeReads += 1;
      resolve(() => { activeReads -= 1; for (const next of [...waiting]) next(); });
    };
    if (signal.aborted) { cancel(); return; }
    waiting.add(start); signal.addEventListener('abort', cancel, { once: true }); start();
  });
}
export async function readReusableDocumentOriginal(id: string, signal: AbortSignal): Promise<Blob> {
  const generation = getCanonicalHostClientSessionGeneration();
  const release = await acquireRead(signal);
  try {
    if (signal.aborted || generation !== getCanonicalHostClientSessionGeneration()) throw new Error('DOCUMENT_ORIGINAL_READ_OBSOLETE');
    return await readWithinSlot(id, signal);
  } finally { release(); }
}
/** Reuses bytes, never authorization; each warm read rechecks the exact Host registry. */
async function readWithinSlot(id: string, signal: AbortSignal): Promise<Blob> {
  const generation = getCanonicalHostClientSessionGeneration();
  const current = () => !signal.aborted && generation === getCanonicalHostClientSessionGeneration();
  sweep();
  const cached = entries.get(id);
  if (cached) {
    try {
      const identity = await readDocumentVersionOriginalIdentity(id, signal);
      if (!current()) throw new Error('DOCUMENT_ORIGINAL_READ_OBSOLETE');
      if (identity.byteLength === cached.blob.size) {
        if (!cached.sha256) {
          cached.digest ??= cached.blob.arrayBuffer().then(bytes => globalThis.crypto.subtle.digest('SHA-256', bytes))
            .then(digest => Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
          cached.sha256 = await cached.digest;
        }
        if (!current()) throw new Error('DOCUMENT_ORIGINAL_READ_OBSOLETE');
        if (cached.sha256 === identity.sha256 && cached.expires > Date.now()) {
          if (entries.get(id) === cached) { entries.delete(id); entries.set(id, cached); }
          return cached.blob;
        }
      }
      entries.delete(id); sweep();
    } catch (error) {
      if (entries.get(id) === cached) entries.delete(id);
      sweep();
      throw error; // No stale-byte fallback on denied, failed or obsolete authorization.
    }
  }
  const blob = await readDocumentVersionOriginal(id, signal);
  if (!current()) throw new Error('DOCUMENT_ORIGINAL_READ_OBSOLETE');
  remember(id, blob, generation);
  return blob;
}
