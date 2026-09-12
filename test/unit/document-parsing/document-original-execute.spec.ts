import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { MiaodaFileServiceArtifactStore } from '../../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { extractDocumentPdfPages } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';

jest.mock('../../../server/modules/document-management/src/hosted/nest/document-original-pdf', () => ({ extractDocumentPdfPages: jest.fn() }));

describe('bounded original execute and persisted Reader (isolated source and plugin)', () => {
  afterEach(() => jest.restoreAllMocks());
  it('resumes the next page group, reads published original, and never repeats the saved parser call', async () => {
    const binding = { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'ART', pdfSha256: 'a'.repeat(64), byteLength: 1 };
    const run = { parseRunId: 'PR', documentVersionId: 'DV', parseRevision: 1, status: 'RUNNING',
      sourceBinding: binding, bucketId: 'bucket', expectedPublishedRevision: 0, artifactProgress: [] as unknown[], manifestArtifact: null as unknown };
    const content = new Map<string, { bytes: Uint8Array; mediaType: string }>();
    const metadata = (path: string) => ({ id: `object:${path}`, bucketID: 'bucket', filePath: path,
      metadata: { contentLength: content.get(path)!.bytes.length, mimeType: content.get(path)!.mediaType } });
    const scoped = {
      getFileMetadata: async (path: string) => content.has(path) ? metadata(path) : null,
      download: async (path: string) => ({ metadata: metadata(path), content: new Blob([Buffer.from(content.get(path)!.bytes)]) }),
      upload: async (bytes: Uint8Array, options: { filePath: string; contentType: string }) => {
        if (content.has(options.filePath)) throw new Error('OVERWRITE');
        content.set(options.filePath, { bytes: new Uint8Array(bytes), mediaType: options.contentType }); return metadata(options.filePath);
      },
      createSignedUrl: jest.fn(async () => 'https://example.invalid/original'),
    };
    jest.spyOn(MiaodaFileServiceArtifactStore.prototype, 'readSelection').mockResolvedValue({
      bytes: new Uint8Array([1]), readbackVerified: true, sha256: binding.pdfSha256, byteLength: 1,
      providerObjectId: 'original-object', providerVersionId: 'original-version',
    } as never);
    const text = (index: number) => `Original statement on page ${index}.`;
    const parser = jest.fn(async () => ({ markdown: Array.from({ length: 9 }, (_, index) => text(index)).join('\n\n') }));
    jest.mocked(extractDocumentPdfPages).mockImplementation(async input => ({ pageCount: 9,
      pages: Array.from({ length: Math.min(8, 9 - input.pageStart) }, (_, offset) => ({
        pageIndex: input.pageStart + offset, text: text(input.pageStart + offset), items: [], width: 600, height: 800, rotation: 0,
      })) }));
    const repository = { read: async () => ({ ...run }), stage: async () => { run.status = 'STAGING'; },
      progress: async (_scope: unknown, _id: string, artifacts: unknown[]) => { run.artifactProgress = structuredClone(artifacts); },
      publish: jest.fn(async (_scope: unknown, _id: string, artifact: unknown) => { run.status = 'PUBLISHED'; run.manifestArtifact = artifact; }),
      recordStepFailure: jest.fn(),
    };
    const source = { version: { ...binding, originalFilename: 'constructed.pdf' }, source: { bucketId: 'bucket', filePath: 'original.pdf',
      sha256: binding.pdfSha256, byteLength: 1, providerObjectId: 'original-object', providerVersionId: 'original-version' } };
    const service = new DocumentParsingHostedService({ from: () => scoped } as never,
      { readMetadataSource: async () => source } as never, repository as never,
      { parseOriginal: parser, configured: () => true } as never, { check: async () => undefined } as never,
      { assertCanRead: async () => undefined } as never);
    const scope = { documentVersionId: 'DV', actorUserId: 'actor', tenantId: 'tenant', roles: [] };
    const fence = { parseRunId: 'PR', leaseOwner: 'consumer', leaseToken: 'token', leaseGeneration: 1 };
    expect((await service.executeStep('PR', scope, fence)).status).toBe('STAGING');
    expect(repository.publish).not.toHaveBeenCalled();
    expect((await service.executeStep('PR', scope, fence)).status).toBe('PUBLISHED');
    expect(parser).toHaveBeenCalledTimes(1);
    expect(jest.mocked(extractDocumentPdfPages).mock.calls.map(([input]) => input.pageStart)).toEqual([0, 8]);
    const reading = await service.read('DV', 'PR', scope);
    expect(reading.parser.name).toBe('OfficialPluginHybrid');
    expect(reading.original!.coverage.readPageIndexes).toHaveLength(9);
    expect(reading.original!.source.units.map(unit => unit.payload.text)).toEqual(Array.from({ length: 9 }, (_, index) => text(index)));
    expect(repository.recordStepFailure).not.toHaveBeenCalled();
  });
});
