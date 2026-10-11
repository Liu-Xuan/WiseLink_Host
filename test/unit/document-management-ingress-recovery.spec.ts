import { createHash } from 'node:crypto';
import { DocumentManagementHostedCore } from '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js';

const bytes = Buffer.from('%PDF-1.7 synthetic SB ingress');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const context = { actorUserId: 'owner', tenantId: 'tenant', roles: ['development'] };
const request = { idempotencyKey: 'same-request', sourceChannel: 'document_library_upload', sourceRef: 'same-source',
  selection: { bucketId: 'bucket', filePath: '/selected.pdf' } };
function fixture() {
  const selected = { bytes, sha256, byteLength: bytes.length, mediaType: 'application/pdf',
    bucketId: 'bucket', filePath: '/selected.pdf', providerObjectId: 'selected-object',
    providerVersionId: 'selected-version', fileName: 'synthetic.pdf' };
  const writes: string[] = [];
  const catalog = { findIngestionByIdempotency: jest.fn(async () => null),
    assertImmutableSourceReuseSafe: jest.fn(async () => { throw new Error('CATALOG_SAFE_SENTINEL'); }),
    recordAcquisition: jest.fn(), commitNewVersion: jest.fn() };
  const authorizer = { assertCanIngest: jest.fn(async () => {}) };
  const artifactStore = { readSelection: jest.fn(async () => ({ ...selected })),
    persistImmutableSource: jest.fn(async (input: { assertActive: () => Promise<void> }) => {
      await input.assertActive(); writes.push('first');
      await input.assertActive(); writes.push('second');
      return { bucketId: 'bucket', filePath: '/immutable.pdf', providerObjectId: 'object',
        providerVersionId: 'object', readbackVerified: true, reusedExisting: true };
    }) };
  const core = new DocumentManagementHostedCore({ catalog: catalog as never, artifactStore: artifactStore as never,
    authorizer, pdfLayoutExtractor: { extractLayout: () => ({ pageCount: 1, sourceSha256: `sha256:${sha256}`,
      sourceByteLength: bytes.length, textRuns: [{ page: 1, x: 10, y: 10,
        text: 'BOEING PROPRIETARY SERVICE BULLETIN Publication: B787-81205-SB310019-00 Issue 001, 24 Sep 2020' }] }) } });
  return { core, authorizer, artifactStore, catalog, selected, writes };
}

describe('ingress actor and exact selection guards', () => {
  it('rechecks the same server-bound authority and preserves Catalog admission after source recovery', async () => {
    const f = fixture();
    await expect(f.core.ingestFileServiceSelection(request, context)).rejects.toThrow('CATALOG_SAFE_SENTINEL');
    expect(f.authorizer.assertCanIngest).toHaveBeenCalledTimes(3);
    for (const [input] of f.authorizer.assertCanIngest.mock.calls as unknown as [unknown][]) {
      expect(input).toEqual({ ...context, selection: request.selection, action: 'DOCUMENT_INGEST' });
    }
    expect(f.artifactStore.readSelection).toHaveBeenCalledTimes(3);
    expect(f.writes).toEqual(['first', 'second']);
    expect(f.catalog.assertImmutableSourceReuseSafe).toHaveBeenCalledTimes(1);
    expect(f.catalog.recordAcquisition).not.toHaveBeenCalled();
  });
  it('stops an additional write when the existing authorizer revokes access', async () => {
    const f = fixture();
    f.authorizer.assertCanIngest.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DOCUMENT_ACTION_FORBIDDEN'));
    await expect(f.core.ingestFileServiceSelection(request, context)).rejects.toThrow('DOCUMENT_ACTION_FORBIDDEN');
    expect(f.writes).toEqual(['first']);
    expect(f.catalog.assertImmutableSourceReuseSafe).not.toHaveBeenCalled();
  });
  it.each(['providerObjectId', 'providerVersionId', 'sha256', 'bytes'])('rejects fresh selected-source %s drift before writing', async field => {
    const f = fixture();
    const fresh = { ...f.selected, [field]: field === 'bytes' ? Buffer.alloc(bytes.length) : 'changed' };
    f.artifactStore.readSelection.mockResolvedValueOnce(f.selected).mockResolvedValue(fresh);
    await expect(f.core.ingestFileServiceSelection(request, context)).rejects.toMatchObject({ code: 'INGESTION_SOURCE_CHANGED' });
    expect(f.writes).toEqual([]); expect(f.catalog.recordAcquisition).not.toHaveBeenCalled();
  });
});
