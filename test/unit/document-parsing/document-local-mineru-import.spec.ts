import { createHash } from 'node:crypto';
import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { readLocalMineruCandidate } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-local-candidate';
import { sameParserInput } from '../../../server/modules/document-management/src/hosted/nest/document-parsing.repository';
import { MiaodaFileServiceArtifactStore } from '../../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import * as authority from '../../../server/modules/document-management/src/hosted/nest/document-upload-authority';

function candidate() { return { schemaVersion: 'wiselink.mineru.local-candidate.v1', source: { sha256: 'a'.repeat(64), byteLength: 1 },
  parser: { version: '3.4.5', backend: 'pipeline' }, raw: { markdown: 'Exact original text.',
    middle: { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: [{ page_idx: 0, page_size: [600, 800] }] },
    contentListV2: [[{ type: 'paragraph', bbox: [0, 0, 200, 100], content: { paragraph_content: [{ type: 'text', content: 'Exact original text.' }] } }]] }, assets: [] }; }
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const context = { actorUserId: 'actor', tenantId: 'tenant', roles: [], appId: 'app_17bzc551rsg', env: 'production' };
const request = { mode: 'LOCAL_MINERU_IMPORT', selection: { bucketId: 'bucket', filePath: '/candidate.json' }, requestId: 'local-request', expectedPublishedRevision: 0 };
function fixture() {
  const bytes = encode(candidate());
  const binding = { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: 'a'.repeat(64), byteLength: 1 };
  const selection = { bucketId: 'bucket', filePath: 'candidate.json', providerObjectId: 'candidate-object', sha256: digest(bytes), byteLength: bytes.length, bytes, readbackVerified: true };
  const run = { parseRunId: 'PR', documentVersionId: 'DV', parseRevision: 2, status: 'RUNNING', startedAt: new Date(), deadlineAt: new Date(Date.now() + 240000), completedAt: null as Date | null,
    sourceBinding: { ...binding, parserInput: { mode: 'LOCAL_MINERU_IMPORT', ...selection } }, bucketId: 'bucket', expectedPublishedRevision: 0,
    artifactProgress: [] as unknown[], manifestArtifact: null as unknown, errorCode: null as string | null };
  let reserved = false;
  const content = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const metadata = (path: string) => ({ id: `object:${path}`, bucketID: 'bucket', filePath: path, metadata: { contentLength: content.get(path)!.bytes.length, mimeType: content.get(path)!.mediaType } });
  const scoped = { getFileMetadata: async (path: string) => content.has(path) ? metadata(path) : null,
    download: async (path: string) => ({ metadata: metadata(path), content: new Blob([Buffer.from(content.get(path)!.bytes)]) }),
    upload: jest.fn(async (data: Uint8Array, options: { filePath: string; contentType: string }) => {
      if (content.has(options.filePath)) throw new Error('OVERWRITE');
      content.set(options.filePath, { bytes: new Uint8Array(data), mediaType: options.contentType }); return metadata(options.filePath);
    }) };
  const readSelection = jest.spyOn(MiaodaFileServiceArtifactStore.prototype, 'readSelection').mockImplementation(async (input: { filePath?: string }) =>
    input.filePath?.endsWith('candidate.json') ? selection as never : { bytes: new Uint8Array([1]), readbackVerified: true, sha256: binding.pdfSha256, byteLength: 1,
      providerObjectId: 'original-object', providerVersionId: 'original-version' } as never);
  const repository = { readRequest: jest.fn(async (_scope: unknown, id: string) => reserved && id === request.requestId ? { ...run } : null), read: async () => ({ ...run }),
    reserve: jest.fn(async (_scope: unknown, input: { sourceBinding: typeof run.sourceBinding }) => { reserved = true; run.sourceBinding = input.sourceBinding; return { row: run, created: true }; }),
    stage: async () => { run.status = 'STAGING'; }, progress: async (_scope: unknown, _id: string, artifacts: unknown[]) => { run.artifactProgress = structuredClone(artifacts); },
    publish: jest.fn(async (_scope: unknown, _id: string, artifact: unknown) => { run.status = 'PUBLISHED'; run.manifestArtifact = artifact; run.completedAt = new Date(); }),
    recordStepFailure: jest.fn(async (_scope: unknown, _fence: unknown, code: string) => { run.errorCode = code; }), current: async () => ({ published: run.status === 'PUBLISHED' ? run : null }) };
  const source = { version: { ...binding, originalFilename: 'original.pdf' }, source: { bucketId: 'bucket', filePath: 'original.pdf', sha256: binding.pdfSha256, byteLength: 1,
    providerObjectId: 'original-object', providerVersionId: 'original-version' } };
  const authorizer = { assertCanRead: jest.fn(async () => undefined), assertCanIngest: jest.fn(async () => undefined) };
  const plugins = { configured: jest.fn(() => false), parseOriginal: jest.fn() };
  const leases = { claim: jest.fn(async () => ({ parseRunId: 'PR', leaseOwner: 'local', leaseToken: 'lease', leaseGeneration: 1 })), check: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
  const settings = { capture: jest.fn(async () => ({ revision: 1, localMineruFallbackEnabled: true, titleEnhancementEnabled: false })) };
  const service = new DocumentParsingHostedService({ from: () => scoped } as never, { readMetadataSource: async () => source } as never,
    repository as never, plugins as never, leases as never, authorizer, settings as never);
  jest.spyOn(authority, 'mintDocumentUploadAuthority').mockReturnValue({} as never);
  return { service, repository, authorizer, plugins, leases, scoped, content, run, selection, readSelection, settings };
}
afterEach(() => jest.restoreAllMocks());
it('publishes exact local original without calling exhausted plugin, then replays without duplication', async () => {
  const f = fixture();
  expect(await f.service.start('DV', request, context)).toMatchObject({ status: 'PUBLISHED', parseRevision: 2 });
  expect(f.authorizer.assertCanIngest).toHaveBeenCalledTimes(2);
  expect(f.plugins.parseOriginal).not.toHaveBeenCalled();
  expect(f.run.sourceBinding.parserInput).toMatchObject({ providerObjectId: 'candidate-object', sha256: f.selection.sha256 });
  expect(await f.service.read('DV', 'PR', context)).toMatchObject({ parser: { name: 'MinerU', version: '3.4.5', backend: 'pipeline' }, original: { producer: { kind: 'MINERU_LOCAL' } } });
  await f.service.start('DV', request, context);
  expect(f.repository.reserve).toHaveBeenCalledTimes(1); expect(f.repository.publish).toHaveBeenCalledTimes(1);
});
it('refuses candidate ingest before downloading files or reserving', async () => {
  const f = fixture(); f.authorizer.assertCanIngest.mockRejectedValue(new Error('DOCUMENT_ACTION_FORBIDDEN'));
  await expect(f.service.start('DV', request, context)).rejects.toThrow('DOCUMENT_ACTION_FORBIDDEN');
  expect(f.readSelection).not.toHaveBeenCalled(); expect(f.repository.reserve).not.toHaveBeenCalled();
});
it('rejects source mismatch and same-request changed candidate', async () => {
  const f = fixture();
  await f.service.start('DV', request, context);
  f.selection.providerObjectId = 'replaced';
  await expect(f.service.start('DV', request, context)).rejects.toThrow('DOCUMENT_PARSE_REQUEST_CONFLICT');
  const other = candidate(); other.source.sha256 = 'b'.repeat(64); f.selection.bytes = encode(other);
  await expect(f.service.start('DV', { ...request, requestId: 'other' }, context)).rejects.toThrow('DOCUMENT_PARSE_ORIGINAL_MISMATCH');
});
it('rejects unknown fields and does not let local mode silently use ordinary parsing', async () => {
  const f = fixture();
  await expect(f.service.start('DV', { ...request, bypass: true }, context)).rejects.toThrow('DOCUMENT_PARSE_INPUT_INVALID');
  await expect(f.service.start('DV', { requestId: 'x', expectedPublishedRevision: 0, selection: request.selection }, context)).rejects.toThrow('DOCUMENT_PARSE_INPUT_INVALID');
});
it('strictly validates parser version, asset content and package identities', () => {
  const value = candidate(); expect(readLocalMineruCandidate(encode(value)).sourceSha256).toBe(value.source.sha256);
  expect(() => readLocalMineruCandidate(encode({ ...value, workItemId: 'WI' }))).toThrow();
  expect(() => readLocalMineruCandidate(encode({ ...value, parser: { ...value.parser, version: '9.9' } }))).toThrow();
  expect(() => readLocalMineruCandidate(encode({ ...value, assets: [{ path: 'images/a.png', mediaType: 'image/png', byteLength: 1, sha256: 'b'.repeat(64), base64: 'AQ==' }] }))).toThrow();
});
it('repository input identity includes immutable object and input bytes', () => {
  const source = { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: 'a'.repeat(64), byteLength: 1 };
  const input = { ...source, parserInput: { mode: 'LOCAL_MINERU_IMPORT' as const, bucketId: 'b', filePath: 'p', providerObjectId: 'o', sha256: 'b'.repeat(64), byteLength: 2 } };
  expect(sameParserInput(source, input)).toBe(false);
  expect(sameParserInput(input, structuredClone(input))).toBe(true);
  expect(sameParserInput(input, { ...input, parserInput: { ...input.parserInput, sha256: 'c'.repeat(64) } })).toBe(false);
});

it('recovers a lost upload receipt on the same run despite recorded transient error', async () => {
  const f = fixture(); const upload = f.scoped.upload.getMockImplementation()!;
  f.scoped.upload.mockImplementationOnce(async (bytes, options) => { await upload(bytes, options); throw new Error('CONSTRUCTED_UPLOAD_RESPONSE_LOST'); });
  await expect(f.service.start('DV', request, context)).rejects.toThrow('CONSTRUCTED_UPLOAD_RESPONSE_LOST');
  expect(f.run.errorCode).toBe('CONSTRUCTED_UPLOAD_RESPONSE_LOST');
  expect(await f.service.start('DV', request, context)).toMatchObject({ status: 'PUBLISHED' });
  expect(f.repository.reserve).toHaveBeenCalledTimes(1);
  expect(f.scoped.upload).toHaveBeenCalledTimes(3);
});
it('captures settings once; disabling later blocks new imports while exact published replay remains readable', async () => {
  const f = fixture(); await f.service.start('DV', request, context);
  f.settings.capture.mockResolvedValue({ revision: 2, localMineruFallbackEnabled: false, titleEnhancementEnabled: false });
  await f.service.start('DV', request, context);
  expect(f.settings.capture).toHaveBeenCalledTimes(1);
  expect(f.run.sourceBinding.parserInput).toMatchObject({ settings: { revision: 1, localMineruFallbackEnabled: true } });
  await expect(f.service.start('DV', { ...request, requestId: 'new-request' }, context)).rejects.toThrow('DOCUMENT_LOCAL_MINERU_DISABLED');
});
it('checks image signatures independently of the supplied media type and matching digest', () => {
  const bytes = Buffer.from('not an image');
  expect(() => readLocalMineruCandidate(encode({ ...candidate(), assets: [{ path: 'images/a.png', mediaType: 'image/png', byteLength: bytes.length,
    sha256: digest(bytes), base64: bytes.toString('base64') }] }))).toThrow('DOCUMENT_MINERU_CANDIDATE_INVALID');
});
it.each([true, false])('validates title levels against raw views and respects captured title switch=%s', async enabled => {
  const f = fixture();
  const value = { ...candidate(), raw: { markdown: '# Scope\n\n# Limits',
    middle: { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: [{ page_idx: 0, page_size: [1000, 1000],
      para_blocks: [{ type: 'title', bbox: [10, 10, 500, 30], level: 1 }, { type: 'title', bbox: [10, 100, 500, 120], level: 1 }] }] },
    contentListV2: [[{ type: 'title', bbox: [10, 10, 500, 30], content: { level: 1, title_content: [{ type: 'text', content: 'Scope' }] } },
      { type: 'title', bbox: [10, 100, 500, 120], content: { level: 1, title_content: [{ type: 'text', content: 'Limits' }] } }]] },
    titleEnhancement: { status: 'APPLIED', levels: [{ id: 'page-1-block-1', level: 1 }, { id: 'page-1-block-2', level: 2 }],
      provider: { model: 'configured-test-model', endpointOrigin: 'http://localhost:8888' } } };
  f.selection.bytes = encode(value); f.selection.byteLength = f.selection.bytes.length; f.selection.sha256 = digest(f.selection.bytes);
  f.settings.capture.mockResolvedValue({ revision: 1, localMineruFallbackEnabled: true, titleEnhancementEnabled: enabled });
  await f.service.start('DV', request, context);
  const reading = await f.service.read('DV', 'PR', context);
  expect(reading.titleEnhancement.status).toBe(enabled ? 'APPLIED' : 'DISABLED');
  expect(reading.original!.source.units.filter(unit => unit.kind === 'heading').map(unit => unit.payload.level)).toEqual(enabled ? [1, 2] : [1, 1]);
  const rawSaved = [...f.content].find(([path]) => path.endsWith('raw/mineru-candidate.json'))![1].bytes;
  expect(Buffer.from(rawSaved)).toEqual(f.selection.bytes);
});
