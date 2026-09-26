import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { MiaodaFileServiceArtifactStore } from '../../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import * as composition from '../../../server/modules/document-management/src/hosted/nest/document-original-compose';
import { openDocumentPdfSession } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';

jest.mock('../../../server/modules/document-management/src/hosted/nest/document-original-pdf', () => ({ openDocumentPdfSession: jest.fn() }));

function fixture(loseReceipt = false) {
  const compose = jest.spyOn(composition, 'composeDocumentOriginal');
  let receiptLost = false;
  const binding = { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: 'a'.repeat(64), byteLength: 1 };
  const run = { requestId: 'initial', actorUserId: 'actor', tenantId: 'tenant', parseRunId: 'PR', documentVersionId: 'DV', parseRevision: 1, status: 'RUNNING',
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
  const predecessors = new Map<string, typeof run>();
  const repository = { current: jest.fn(async () => ({ published: null as typeof run | null })), read: async (_scope: unknown, id: string) => predecessors.get(id) ?? ({ ...run }), stage: async () => { run.status = 'STAGING'; },
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
  return { service, scope, fence, run, repository, predecessors, source, binding, content, scoped, compose, parser,
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

  function advance(f: ReturnType<typeof fixture>, suffix: number) {
    const predecessor = structuredClone(f.run);
    predecessor.status = 'FAILED';
    f.predecessors.set(predecessor.parseRunId, predecessor);
    const parseRunId = `PRUN-00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
    Object.assign(f.run, { parseRunId, requestId: `parse-resume-${predecessor.parseRunId}`,
      parseRevision: predecessor.parseRevision + 1, artifactProgress: [], status: 'RUNNING', manifestArtifact: null });
    f.fence.parseRunId = parseRunId;
    return predecessor;
  }
  function recoveryFixture() {
    const f = fixture();
    f.run.parseRunId = 'PRUN-00000000-0000-0000-0000-000000000001';
    f.fence.parseRunId = f.run.parseRunId;
    return f;
  }

  it('reuses ancestors beyond a partially copied predecessor and rebuilds the final manifest', async () => {
    jest.useFakeTimers();
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const first = advance(f, 2);
    const progress = f.repository.progress;
    f.repository.progress = async (...args) => {
      await progress(...args);
      if (args[2].some(item => item.relativePath === 'original/pages-0.json' && item.readback === 'VERIFIED'))
        jest.advanceTimersByTime(10_001);
    };
    expect((await f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).coverage.readPageIndexes).toHaveLength(8);
    f.repository.progress = progress;
    advance(f, 3);
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    expect((await f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).status).toBe('PUBLISHED');
    expect(f.parser).toHaveBeenCalledTimes(1);
    expect(f.extract.mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8, 16, 24]);
    expect(f.predecessors.get(first.parseRunId)?.artifactProgress).toEqual(first.artifactProgress);
    const reading = await f.service.read('DV', f.run.parseRunId, f.scope);
    expect(reading.original?.binding.parseRunId).toBe(f.run.parseRunId);
  });

  it('recovers raw-only output and a lost progress receipt without repeating the plugin', async () => {
    const f = recoveryFixture();
    const progress = f.repository.progress;
    f.repository.progress = async (...args) => {
      if (args[2].some(item => item.relativePath === 'raw/document.md')) throw new Error('LOST_RAW_RECEIPT');
      await progress(...args);
    };
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('LOST_RAW_RECEIPT');
    expect(f.run.artifactProgress.some((item: any) => item.relativePath === 'raw/document.md')).toBe(false);
    f.repository.progress = progress;
    advance(f, 2);
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    expect(f.parser).toHaveBeenCalledTimes(1);
  });

  it('blocks same-attempt repetition of an unpersisted output but permits a new recovery attempt', async () => {
    const f = recoveryFixture();
    const progress = f.repository.progress;
    f.repository.progress = async (...args) => {
      await progress(...args);
      if (args[2].some(item => item.relativePath === 'original/raw-provenance.json' && item.readback === 'VERIFIED'))
        throw new Error('INTERRUPTED_BEFORE_RAW');
    };
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('INTERRUPTED_BEFORE_RAW');
    f.repository.progress = progress;
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_RAW_NOT_PERSISTED');
    expect(f.parser).toHaveBeenCalledTimes(1);
    advance(f, 2);
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    expect(f.parser).toHaveBeenCalledTimes(2);
  });

  it.each(['actor', 'source', 'revision'])('rejects an invalid %s in the immutable recovery chain', async kind => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    if (kind === 'actor') previous.actorUserId = 'other';
    if (kind === 'source') previous.sourceBinding.pdfSha256 = 'b'.repeat(64);
    if (kind === 'revision') previous.parseRevision = f.run.parseRevision;
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_CHAIN_INVALID');
    expect(f.parser).toHaveBeenCalledTimes(1);
  });

  it('fails on damaged saved raw rather than falling back to another plugin call', async () => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    const path = `wiselink/parsed/DV/${previous.parseRunId}/raw/document.md`;
    f.content.get(path)!.bytes[0] ^= 1;
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_ORIGINAL_READBACK_DIGEST_MISMATCH');
    expect(f.parser).toHaveBeenCalledTimes(1);
  });

  it('does not identify an old raw-only MinerU checkpoint as official output', async () => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    previous.artifactProgress = previous.artifactProgress.filter((item: any) => item.relativePath === 'raw/document.md');
    for (const path of f.content.keys()) {
      if (path.startsWith(`wiselink/parsed/DV/${previous.parseRunId}/original/`)) f.content.delete(path);
    }
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_PROVENANCE_UNVERIFIED');
    expect(f.parser).toHaveBeenCalledTimes(1);
  });


  it('recovers the legacy official raw using verified page evidence without a provenance marker', async () => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    previous.artifactProgress = previous.artifactProgress.filter((item: any) => item.relativePath !== 'original/raw-provenance.json');
    f.content.delete(`wiselink/parsed/DV/${previous.parseRunId}/original/raw-provenance.json`);
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    expect(f.parser).toHaveBeenCalledTimes(1);
    expect(f.extract).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'duplicate'])('rejects %s ancestor page descriptors instead of filling the hole by extraction', async kind => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    const page = previous.artifactProgress.find((item: any) => item.relativePath === 'original/pages-0.json');
    if (kind === 'missing') previous.artifactProgress = previous.artifactProgress.filter(item => item !== page);
    else previous.artifactProgress.push(structuredClone(page));
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_CHECKPOINT_INVALID');
    expect(f.extract).toHaveBeenCalledTimes(2);
  });

  it('rejects an orphan target copy whose valid JSON differs from the selected ancestor', async () => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    const original = f.content.get(`wiselink/parsed/DV/${previous.parseRunId}/original/pages-0.json`)!;
    const chunk = JSON.parse(Buffer.from(original.bytes).toString('utf8'));
    chunk.pages[0].text = 'Unexpected target text';
    f.content.set(`wiselink/parsed/DV/${f.run.parseRunId}/original/pages-0.json`, {
      bytes: Buffer.from(JSON.stringify(chunk)), mediaType: original.mediaType,
    });
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_COPY_MISMATCH');
    expect(f.extract).toHaveBeenCalledTimes(2);
  });

  it('continues a lost target-copy receipt without overwriting or repeating original extraction', async () => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    advance(f, 2);
    const progress = f.repository.progress;
    f.repository.progress = async (...args) => {
      if (args[2].some(item => item.relativePath === 'original/pages-0.json')) throw new Error('LOST_COPY_RECEIPT');
      await progress(...args);
    };
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('LOST_COPY_RECEIPT');
    f.repository.progress = progress;
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    expect(f.extract).toHaveBeenCalledTimes(2);
    expect(f.parser).toHaveBeenCalledTimes(1);
  });


  it.each([false, true])('promotes current provenance receipt before publishing with completed manifest=%s', async completed => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    if (completed) {
      await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
      f.run.status = 'STAGING';
    }
    const marker = f.run.artifactProgress.find((item: any) => item.relativePath === 'original/raw-provenance.json') as { readback: string };
    marker.readback = 'UPLOADED';
    f.repository.publish.mockImplementation(async (_scope, _id, artifact) => {
      if (f.run.artifactProgress.some((item: any) => item.readback !== 'VERIFIED'))
        throw new Error('DOCUMENT_PARSE_READBACK_REQUIRED');
      f.run.status = 'PUBLISHED'; f.run.manifestArtifact = artifact;
    });
    expect((await f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).status).toBe('PUBLISHED');
    expect(f.run.artifactProgress.find((item: any) => item.relativePath === 'original/raw-provenance.json'))
      .toEqual(expect.objectContaining({ readback: 'VERIFIED' }));
    expect(f.parser).toHaveBeenCalledTimes(1);
  });

  it('rejects an explicit nonofficial manifest producer even when page and marker evidence exist', async () => {
    const f = recoveryFixture();
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    await f.service.executeStep(f.run.parseRunId, f.scope, f.fence);
    const previous = advance(f, 2);
    // Model an orphan manifest whose upload committed before its DB descriptor.
    previous.artifactProgress = previous.artifactProgress.filter((item: any) => item.relativePath !== 'original/manifest.json');
    const path = `wiselink/parsed/DV/${previous.parseRunId}/original/manifest.json`;
    const stored = f.content.get(path)!;
    const bundle = JSON.parse(Buffer.from(stored.bytes).toString('utf8'));
    bundle.original.producer.kind = 'MINERU_LOCAL_PDFJS';
    stored.bytes = Buffer.from(JSON.stringify(bundle));
    await expect(f.service.executeStep(f.run.parseRunId, f.scope, f.fence)).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_PROVENANCE_INVALID');
    expect(f.parser).toHaveBeenCalledTimes(1);
  });

});
