import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { decodeLocalMineruResult, encodeLocalMineruResult, localMineruResultTransport,
  LOCAL_MINERU_RESULT_BODY_LIMIT } from '../../../server/modules/professional-input/mineru/local-mineru-result-transport';
import { readLocalMineruCandidate } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-local-candidate';
import { LocalMineruHttpTransport, sha256 } from '../../../scripts/local-mineru-worker-transport';

const spec = (headers: Record<string, string>) => localMineruResultTransport(headers['x-wiselink-candidate-transport'],
  headers['x-wiselink-candidate-raw-byte-length'], headers['x-wiselink-candidate-raw-sha256']);

it('preserves legacy identity and binds versioned identity to exact raw bytes', () => {
  const bytes = Buffer.from('{"complete":"合成原文"}');
  expect(decodeLocalMineruResult(bytes, null)).toBe(bytes);
  const encoded = encodeLocalMineruResult(bytes);
  expect(encoded.headers['x-wiselink-candidate-transport']).toBe('identity.v1');
  expect(encoded.headers).not.toHaveProperty('content-encoding');
  expect(decodeLocalMineruResult(encoded.body, spec(encoded.headers)).equals(bytes)).toBe(true);
});

it('compresses a complete candidate above the gateway limit without changing any raw byte', () => {
  const bytes = Buffer.from(JSON.stringify({ body: 's'.repeat(14 * 1024 * 1024), nested: { retained: true } }));
  const encoded = encodeLocalMineruResult(bytes);
  expect(bytes.length).toBeGreaterThan(12 * 1024 * 1024);
  expect(encoded.body.length).toBeLessThan(LOCAL_MINERU_RESULT_BODY_LIMIT);
  expect(encoded.headers['x-wiselink-candidate-transport']).toBe('gzip.v1');
  expect(decodeLocalMineruResult(encoded.body, spec(encoded.headers)).equals(bytes)).toBe(true);
});

it.each([
  ['gzip.v2', '2', 'a'.repeat(64), 'LOCAL_MINERU_RESULT_TRANSPORT_INVALID'],
  ['br.v1', '2', 'a'.repeat(64), 'LOCAL_MINERU_RESULT_TRANSPORT_INVALID'],
  ['gzip.v1', '0', 'a'.repeat(64), 'LOCAL_MINERU_RESULT_TRANSPORT_INVALID'],
  ['gzip.v1', '1e3', 'a'.repeat(64), 'LOCAL_MINERU_RESULT_TRANSPORT_INVALID'],
  ['gzip.v1', '67108865', 'a'.repeat(64), 'LOCAL_MINERU_CANDIDATE_TOO_LARGE'],
  ['gzip.v1', '9007199254740992', 'a'.repeat(64), 'LOCAL_MINERU_CANDIDATE_TOO_LARGE'],
  ['gzip.v1', '2', 'A'.repeat(64), 'LOCAL_MINERU_RESULT_TRANSPORT_INVALID'],
  [undefined, '2', 'a'.repeat(64), 'LOCAL_MINERU_RESULT_TRANSPORT_INVALID'],
] as Array<[string | undefined, string, string, string]>)('rejects malformed transport %s / %s', (encoding, length, hash, error) => {
  expect(() => localMineruResultTransport(encoding, length, hash)).toThrow(error);
});

it('rejects invalid gzip, decompressed overflow, digest mismatch and identity length mismatch', () => {
  const bytes = Buffer.from('bounded original');
  const metadata = { encoding: 'gzip' as const, rawByteLength: bytes.length, rawSha256: sha256(bytes) };
  expect(() => decodeLocalMineruResult(Buffer.from('not-gzip'), metadata)).toThrow('LOCAL_MINERU_RESULT_GZIP_INVALID');
  expect(() => decodeLocalMineruResult(gzipSync(bytes).subarray(0, 12), metadata)).toThrow('LOCAL_MINERU_RESULT_GZIP_INVALID');
  expect(() => decodeLocalMineruResult(gzipSync(Buffer.alloc(1024)), { ...metadata, rawByteLength: 10 }))
    .toThrow('LOCAL_MINERU_RESULT_DECOMPRESSED_TOO_LARGE');
  expect(() => decodeLocalMineruResult(gzipSync(bytes), { ...metadata, rawSha256: 'a'.repeat(64) }))
    .toThrow('LOCAL_MINERU_RESULT_RAW_MISMATCH');
  expect(() => decodeLocalMineruResult(bytes, { ...metadata, encoding: 'identity', rawByteLength: bytes.length + 1 }))
    .toThrow('LOCAL_MINERU_RESULT_RAW_MISMATCH');
});

it('refuses a payload that cannot fit the bounded transport before any HTTP write', async () => {
  const request = jest.fn();
  const transport = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'isolated-key' }, request);
  await expect(transport.result({ parseRunId: 'PRUN-test', documentVersionId: 'DV-test', lease: {
    leaseOwner: 'owner', leaseToken: 'token', leaseGeneration: 1,
  } }, randomBytes(LOCAL_MINERU_RESULT_BODY_LIMIT + 8192), new AbortController().signal))
    .rejects.toThrow('LOCAL_MINERU_RESULT_TRANSPORT_TOO_LARGE');
  expect(request).not.toHaveBeenCalled();
  expect(() => decodeLocalMineruResult(Buffer.alloc(LOCAL_MINERU_RESULT_BODY_LIMIT + 1), {
    encoding: 'gzip', rawByteLength: 1, rawSha256: 'a'.repeat(64),
  })).toThrow('LOCAL_MINERU_RESULT_TRANSPORT_TOO_LARGE');
});

const actualPath = process.env.WL_LOCAL_MINERU_REAL_CANDIDATE;
(actualPath ? it : it.skip)('replays an authorized actual complete candidate privately through the bounded transport', async () => {
  const raw = readFileSync(actualPath!);
  const parsed = readLocalMineruCandidate(raw);
  expect(raw.length).toBe(Number(process.env.WL_LOCAL_MINERU_REAL_BYTE_LENGTH));
  expect(sha256(raw)).toBe(process.env.WL_LOCAL_MINERU_REAL_SHA256);
  expect(parsed.sourceSha256).toBe(process.env.WL_LOCAL_MINERU_REAL_SOURCE_SHA256);
  const request = jest.fn(async (_url: string | URL | Request, input?: RequestInit) => {
    expect(new Headers(input?.headers).has('content-encoding')).toBe(false);
    const headers = Object.fromEntries(new Headers(input?.headers).entries());
    const body = Buffer.from(input?.body as ArrayBuffer);
    expect(body.length).toBeLessThanOrEqual(LOCAL_MINERU_RESULT_BODY_LIMIT);
    const restored = decodeLocalMineruResult(body, spec(headers));
    expect(restored.equals(raw)).toBe(true);
    const assets = readLocalMineruCandidate(restored).assets;
    expect(assets.map(asset => asset.path)).toEqual(parsed.assets.map(asset => asset.path));
    expect(assets.every((asset, index) => Buffer.from(asset.bytes).equals(Buffer.from(parsed.assets[index].bytes)))).toBe(true);
    return new Response(JSON.stringify({ status: 'ACCEPTED', parseRunId: 'PRUN-isolated', candidateSha256: sha256(restored) }),
      { headers: { 'content-type': 'application/json' } });
  });
  const transport = new LocalMineruHttpTransport({ origin: 'https://host.test', apiKey: 'isolated-key' }, request as typeof fetch);
  expect(await transport.result({ parseRunId: 'PRUN-isolated', documentVersionId: 'DV-isolated', lease: {
    leaseOwner: 'isolated', leaseToken: 'fixture', leaseGeneration: 1,
  } }, raw, new AbortController().signal)).toMatchObject({ status: 'ACCEPTED', candidateSha256: sha256(raw) });
  expect(request).toHaveBeenCalledTimes(1);
});
