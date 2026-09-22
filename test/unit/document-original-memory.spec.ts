import { createHash } from 'node:crypto';
import { clearDocumentOriginalMemory, readReusableDocumentOriginal } from '../../client/src/utils/document-original-memory';
const mockRead = jest.fn();
const mockIdentity = jest.fn();
let mockGeneration = 1;
const mockListeners = new Set<() => void>();
jest.mock('@client/src/api/canonical-host', () => ({
 readDocumentVersionOriginal: (...args: unknown[]) => mockRead(...args),
 readDocumentVersionOriginalIdentity: (...args: unknown[]) => mockIdentity(...args),
 getCanonicalHostClientSessionGeneration: () => mockGeneration,
 subscribeCanonicalHostClientSession: (listener: () => void) => { mockListeners.add(listener); return () => mockListeners.delete(listener); },
}));
const signal = () => new AbortController().signal;
const bytes = Buffer.from('%PDF-fixture');
const blob = () => new Blob([bytes], { type: 'application/pdf' });
const identity = (id: string) => ({ documentVersionId: id, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length });
beforeEach(() => { clearDocumentOriginalMemory(); mockRead.mockReset().mockImplementation(async () => blob()); mockIdentity.mockReset().mockImplementation(async id => identity(id)); mockGeneration=1; });
afterEach(() => { clearDocumentOriginalMemory(); jest.useRealTimers(); expect(mockListeners.size).toBe(0); });

test('requires fresh identity on every warm access and rejects revoked or failed authorization without fallback', async () => {
 const first = await readReusableDocumentOriginal('a', signal());
 expect(await readReusableDocumentOriginal('a', signal())).toBe(first);
 expect(await readReusableDocumentOriginal('a', signal())).toBe(first);
 expect(mockIdentity).toHaveBeenCalledTimes(2);
 expect(mockRead).toHaveBeenCalledTimes(1);
 mockIdentity.mockRejectedValueOnce(new Error('403 revoked'));
 await expect(readReusableDocumentOriginal('a', signal())).rejects.toThrow('403 revoked');
 expect(mockRead).toHaveBeenCalledTimes(1);
 await readReusableDocumentOriginal('a', signal());
 expect(mockRead).toHaveBeenCalledTimes(2);
 mockIdentity.mockRejectedValueOnce(new Error('503 unavailable'));
 await expect(readReusableDocumentOriginal('a', signal())).rejects.toThrow('503 unavailable');
 expect(mockRead).toHaveBeenCalledTimes(2);
});

test('invalidates digest/length mismatches and never crosses document or login generations', async () => {
 await readReusableDocumentOriginal('a', signal());
 mockIdentity.mockResolvedValueOnce({ ...identity('a'), sha256: 'b'.repeat(64) });
 await readReusableDocumentOriginal('a', signal());
 expect(mockRead).toHaveBeenCalledTimes(2);
 mockIdentity.mockResolvedValueOnce({ ...identity('a'), byteLength: bytes.length+1 });
 await readReusableDocumentOriginal('a', signal());
 await readReusableDocumentOriginal('b', signal());
 expect(mockRead).toHaveBeenCalledTimes(4);
 mockGeneration++; mockListeners.forEach(listener => listener());
 expect(mockListeners.size).toBe(0);
 await readReusableDocumentOriginal('a', signal());
 expect(mockRead).toHaveBeenCalledTimes(5);
});

test('evicts old bytes by count, total bytes and actual timer expiry; oversize files are not retained', async () => {
 jest.useFakeTimers();
 for (const id of ['a','b','c','d','e']) await readReusableDocumentOriginal(id, signal());
 await readReusableDocumentOriginal('a', signal());
 expect(mockRead).toHaveBeenCalledTimes(6);
 jest.advanceTimersByTime(5*60*1000);
 expect(mockListeners.size).toBe(0);
 await readReusableDocumentOriginal('a', signal());
 expect(mockRead).toHaveBeenCalledTimes(7);
 clearDocumentOriginalMemory(); mockRead.mockClear();
 mockRead.mockImplementation(async () => new Blob([new Uint8Array(12*1024*1024)]));
 for (const id of ['a','b','c','a']) await readReusableDocumentOriginal(id, signal());
 expect(mockRead).toHaveBeenCalledTimes(4); // 36 MiB exceeds the 32 MiB retention budget.
 clearDocumentOriginalMemory(); mockRead.mockClear(); mockIdentity.mockClear();
 mockRead.mockImplementation(async () => new Blob([new Uint8Array(17*1024*1024)]));
 await readReusableDocumentOriginal('large', signal()); await readReusableDocumentOriginal('large', signal());
 expect(mockRead).toHaveBeenCalledTimes(2); expect(mockIdentity).not.toHaveBeenCalled();
});

test('limits concurrent work to two and removes aborted queued reads without issuing a request', async () => {
 const releases: Array<(blob: Blob) => void> = [];
 mockRead.mockImplementation(() => new Promise<Blob>(resolve => releases.push(resolve)));
 const a=readReusableDocumentOriginal('a', signal());
 const b=readReusableDocumentOriginal('b', signal());
 const controller=new AbortController();
 const c=readReusableDocumentOriginal('c', controller.signal);
 const rejected=expect(c).rejects.toThrow('OBSOLETE');
 await Promise.resolve(); await Promise.resolve();
 expect(mockRead).toHaveBeenCalledTimes(2);
 controller.abort(); await rejected;
 releases.forEach(resolve => resolve(blob())); await Promise.all([a,b]);
 expect(mockRead).toHaveBeenCalledTimes(2);
});

test('does not retain or return a download completed after abort or identity change', async () => {
 const controller = new AbortController();
 mockRead.mockImplementationOnce(async () => { controller.abort(); return blob(); });
 await expect(readReusableDocumentOriginal('a', controller.signal)).rejects.toThrow('OBSOLETE');
 await readReusableDocumentOriginal('a', signal());
 expect(mockRead).toHaveBeenCalledTimes(2);
 mockIdentity.mockImplementationOnce(async () => { mockGeneration++; mockListeners.forEach(listener => listener()); return identity('a'); });
 await expect(readReusableDocumentOriginal('a', signal())).rejects.toThrow('OBSOLETE');
 expect(mockListeners.size).toBe(0);
});

test('shares only byte hashing across concurrent hits while authorizing each read independently', async () => {
 const sample=blob();
 const arrayBuffer=jest.spyOn(sample, 'arrayBuffer');
 mockRead.mockResolvedValueOnce(sample);
 await readReusableDocumentOriginal('a', signal());
 const [first, second]=await Promise.all([readReusableDocumentOriginal('a', signal()), readReusableDocumentOriginal('a', signal())]);
 expect(first).toBe(sample); expect(second).toBe(sample);
 expect(arrayBuffer).toHaveBeenCalledTimes(1);
 expect(mockIdentity).toHaveBeenCalledTimes(2);
});
