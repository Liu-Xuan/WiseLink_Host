import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { MiaodaFileServiceArtifactStore } from '../../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import * as composition from '../../../server/modules/document-management/src/hosted/nest/document-original-compose';
import { openDocumentPdfSession } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';

jest.mock('../../../server/modules/document-management/src/hosted/nest/document-original-pdf', () => ({ openDocumentPdfSession: jest.fn() }));

function fixture(loseReceipt = false) {
  const compose = jest.spyOn(composition, 'composeDocumentOriginal');
  let receiptLost = false;
  const binding = { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: 'a'.repeat(64), byteLength: 1 };
  const run = { parseRunId: 'PR', documentVersionId: 'DV', parseRevision: 1, status: 'RUNNING',
    sourceBinding: binding, bucketId: 'bucket', expectedPublishedRevision: 0, artifactProgress: [] as unknown[], manifestArtifact: null as unknown };
  const content = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const metadata = (path: string) => ({ id: `object:${path}`, bucketID: 'bucket', filePath: path,
    metadata: { contentLength: content.get(path)!.bytes.length, mimeType: content.get(path)!.mediaType } });
  const scoped = {
    getFileMetadata: async (path: string) => content.has(path) ? metadata(path) : null,
    download: jest.fn(async (path: string) => ({ metadata: metadata(path), content: new Blob([Buffer.from(content.get(path)!.bytes)]) })),
    upload: async (bytes: Uint8Array, options: { filePath: string; contentType: string }) => {
    if (content.has(options.filePath)) throw new Error('OVERWRITE');
    content.set(options.filePath, { bytes: new Uint8Array(bytes), mediaType: options.contentType }); return metadata(options.filePath);
    },
    createSignedUrl: jest.fn(async () => 'https://example.invalid/original'),
  };
  const readOriginal = jest.spyOn(MiaodaFileServiceArtifactStore.prototype, 'readSelection').mockResolvedValue({
    bytes: new Uint8Array([1]), readbackVerified: true, sha256: binding.pdfSha256, byteLength: 1,
    providerObjectId: 'original-object', providerVersionId: 'original-version',
  } as never);
  const text = (index: number) => `Original statement on page ${index}.`;
  const parser = jest.fn(async () => ({ markdown: Array.from({ length: 25 }, (_, index) => text(index)).join('\n\n') }));
  const extract = jest.fn().mockImplementation(async (input: { pageStart: number }) => ({ pageCount: 25,
    pages: Array.from({ length: Math.min(8, 25 - input.pageStart) }, (_, offset) => ({
    pageIndex: input.pageStart + offset, text: text(input.pageStart + offset), items: [], width: 600, height: 800, rotation: 0,
    })) }));
  const repository = { current: jest.fn(async () => ({ published: null as typeof run | null })), read: async () => ({ ...run }), stage: async () => { run.status = 'STAGING'; },
    progress: async (_scope: unknown, _id: string, artifacts: Array<{ relativePath: string; readback: string }>) => {
    if (loseReceipt && !receiptLost && artifacts.some(item => item.relativePath === 'original/pages-0.json' && item.readback === 'UPLOADED')) {
      receiptLost = true; throw new Error('CONSTRUCTED_PROGRESS_RECEIPT_LOST');
    }
    run.artifactProgress = structuredClone(artifacts);
    },
    publish: jest.fn(async (_scope: unknown, _id: string, artifact: unknown) => { run.status = 'PUBLISHED'; run.manifestArtifact = artifact; }),
    recordStepFailure: jest.fn(),
  };
  const source = { version: { ...binding, originalFilename: 'constructed.pdf' }, source: { bucketId: 'bucket', filePath: 'original.pdf',
    sha256: binding.pdfSha256, byteLength: 1, providerObjectId: 'original-object', providerVersionId: 'original-version' } };
  const sessions: Array<{ extract: typeof extract; destroy: jest.Mock }> = [];
  jest.mocked(openDocumentPdfSession).mockImplementation(async () => {
    const session = { extract, destroy: jest.fn(async () => undefined) };
    sessions.push(session); return session;
  });
  const authorize = jest.fn(async () => undefined);
  const checkLease = jest.fn(async () => undefined);
  const service = new DocumentParsingHostedService({ from: () => scoped } as never,
    { readMetadataSource: async () => source } as never, repository as never,
    { parseOriginal: parser, configured: () => true } as never, { check: checkLease } as never,
    { assertCanRead: authorize } as never);
  const scope = { documentVersionId: 'DV', actorUserId: 'actor', tenantId: 'tenant', roles: [] };
  const fence = { parseRunId: 'PR', leaseOwner: 'consumer', leaseToken: 'token', leaseGeneration: 1 };
  return { service, scope, fence, run, repository, source, binding, content, scoped, compose, parser,
    extract, sessions, readOriginal, authorize, checkLease, text };
}

describe('bounded original execute and persisted Reader (isolated source and plugin)', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  it.each([false, true])('checkpoints two groups per execution and recovers lost page receipt=%s', async loseReceipt => {
    const f = fixture(loseReceipt);
    const { service, scope, fence, run, repository, compose, parser, extract, content, readOriginal } = f;
    if (loseReceipt) await expect(service.executeStep('PR', scope, fence)).rejects.toThrow('CONSTRUCTED_PROGRESS_RECEIPT_LOST');
    const first = await service.executeStep('PR', scope, fence);
    expect(first.status).toBe('STAGING');
    expect(first.coverage.readPageIndexes).toHaveLength(16);
    expect(first.coverage.unresolvedRanges.some(range => range.reason === 'UNREAD' && range.pageIndexes.includes(24))).toBe(true);
    expect(compose).not.toHaveBeenCalled();
    expect(repository.publish).not.toHaveBeenCalled();
    expect(f.sessions.every(session => session.destroy.mock.calls.length === 1)).toBe(true);
    expect((await service.executeStep('PR', scope, fence)).status).toBe('PUBLISHED');
    expect(parser).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8, 16, 24]);
    expect(readOriginal).toHaveBeenCalledTimes(loseReceipt ? 3 : 2);
    expect(openDocumentPdfSession).toHaveBeenCalledTimes(loseReceipt ? 3 : 2);
    expect(f.sessions.every(session => session.destroy.mock.calls.length === 1)).toBe(true);
    const reading = await service.read('DV', 'PR', scope);
    expect(reading.parser.name).toBe('OfficialPluginHybrid');
    expect(reading.original!.coverage.readPageIndexes).toHaveLength(25);
    expect(reading.original!.source.units.map(unit => unit.payload.text)).toEqual(Array.from({ length: 25 }, (_, index) => f.text(index)));
    expect(repository.recordStepFailure).toHaveBeenCalledTimes(loseReceipt ? 1 : 0);
    expect(compose).toHaveBeenCalledTimes(1);
    const previous = structuredClone(run);
    const oldManifest = Buffer.from(content.get('wiselink/parsed/DV/PR/original/manifest.json')!.bytes);
    repository.current.mockResolvedValue({ published: previous });
    Object.assign(run, { parseRunId: 'PR2', parseRevision: 2, expectedPublishedRevision: 1,
      status: 'RUNNING', artifactProgress: [], manifestArtifact: null });
    const nextFence = { ...fence, parseRunId: 'PR2' };
    for (let index = 0; index < 2; index++) await service.executeStep('PR2', scope, nextFence);
    expect(run.status).toBe('PUBLISHED');
    expect(parser).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(4);
    expect(openDocumentPdfSession).toHaveBeenCalledTimes(loseReceipt ? 3 : 2);
    expect(readOriginal).toHaveBeenCalledTimes(loseReceipt ? 5 : 4);
    expect(Buffer.from(content.get('wiselink/parsed/DV/PR/original/manifest.json')!.bytes)).toEqual(oldManifest);
    expect(content.has('wiselink/parsed/DV/PR2/raw/document.md')).toBe(true);
  });

  it('yields after the first saved group when the execution time budget is spent, then resumes', async () => {
    jest.useFakeTimers();
    const f = fixture();
    f.parser.mockImplementationOnce(async () => {
      jest.advanceTimersByTime(10_001);
      return { markdown: Array.from({ length: 25 }, (_, index) => f.text(index)).join('\n\n') };
    });
    const first = await f.service.executeStep('PR', f.scope, f.fence);
    expect(first.coverage.readPageIndexes).toHaveLength(8);
    expect(f.sessions[0].destroy).toHaveBeenCalledTimes(1);
    const second = await f.service.executeStep('PR', f.scope, f.fence);
    expect(second.coverage.readPageIndexes).toHaveLength(24);
    expect(f.parser).toHaveBeenCalledTimes(1);
    expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8, 16]);
    expect((await f.service.executeStep('PR', f.scope, f.fence)).status).toBe('PUBLISHED');
  });

  it('keeps large originals on a single group per execution', async () => {
    const f = fixture();
    const byteLength = 17 * 1024 * 1024;
    f.binding.byteLength = byteLength; f.source.source.byteLength = byteLength;
    f.readOriginal.mockResolvedValue({ bytes: new Uint8Array(byteLength), readbackVerified: true,
      sha256: f.binding.pdfSha256, byteLength, providerObjectId: 'original-object', providerVersionId: 'original-version' } as never);
    expect((await f.service.executeStep('PR', f.scope, f.fence)).coverage.readPageIndexes).toHaveLength(8);
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect(f.sessions[0].destroy).toHaveBeenCalledTimes(1);
  });

  it.each(['authorization', 'lease'])('rechecks %s between saved groups and releases PDF on rejection', async check => {
    const f = fixture();
    const control = check === 'authorization' ? f.authorize : f.checkLease;
    control.mockImplementation(async () => {
      if (f.run.artifactProgress.some((item: any) => item.relativePath === 'original/pages-0.json' && item.readback === 'VERIFIED'))
        throw new Error('REVOKED');
    });
    await expect(f.service.executeStep('PR', f.scope, f.fence)).rejects.toThrow('REVOKED');
    expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0]);
    expect(f.sessions[0].destroy).toHaveBeenCalledTimes(1);
    expect(f.repository.publish).not.toHaveBeenCalled();
    control.mockResolvedValue(undefined);
    expect((await f.service.executeStep('PR', f.scope, { ...f.fence, leaseGeneration: 2 })).coverage.readPageIndexes).toHaveLength(24);
    expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8, 16]);
    expect(f.readOriginal).toHaveBeenCalledTimes(2);
  });

  it('new execution revalidates source bytes/provider identity and rejects drift before opening PDF', async () => {
    const f = fixture();
    await f.service.executeStep('PR', f.scope, f.fence);
    f.source.source.providerObjectId = 'changed-object';
    await expect(f.service.executeStep('PR', f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_ORIGINAL_MISMATCH');
    expect(f.readOriginal).toHaveBeenCalledTimes(2);
    expect(f.sessions).toHaveLength(1);
    expect(f.repository.publish).not.toHaveBeenCalled();
  });

  it('releases PDF on extraction failure; committed earlier pages survive for the next execution', async () => {
    const f = fixture();
    const originalExtract = f.extract.getMockImplementation()!;
    f.extract.mockImplementation(async input => {
      if (input.pageStart === 8) throw new Error('PDF_EXTRACTION_FAILED');
      return originalExtract(input);
    });
    await expect(f.service.executeStep('PR', f.scope, f.fence)).rejects.toThrow('PDF_EXTRACTION_FAILED');
    expect(f.sessions[0].destroy).toHaveBeenCalledTimes(1);
    f.extract.mockImplementation(originalExtract);
    expect((await f.service.executeStep('PR', f.scope, f.fence)).coverage.readPageIndexes).toHaveLength(24);
    expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8, 8, 16]);
    expect(f.parser).toHaveBeenCalledTimes(1);
  });
});
