import { createHash } from 'node:crypto';
import type { FileService, FileMeta } from '@lark-apaas/fullstack-nestjs-core';
import { LcmFileOriginalStore } from '@server/modules/lcm-export-staging/lcm-file-original.store';
import { actor } from '../tdms-source/tdms-fixtures';

function fixture() {
  const bytes: Buffer = Buffer.from('local unit original bytes');
  const sha256: string = createHash('sha256').update(bytes).digest('hex');
  const owner = { userID: 123, avatar: '', status: 1, email: '', name: '', userType: '_employee' };
  const meta = (filePath: string): FileMeta => ({ id: 'immutable-provider-object', bucketID: 'bucket',
    filePath, name: 'local.xls', metadata: { contentLength: String(bytes.length), mimeType: 'application/octet-stream' },
    downloadURL: '', createdAt: '', updatedAt: '', createdBy: owner, updatedBy: owner });
  const metadata = jest.fn<Promise<FileMeta | null>, [string]>(async path => meta(path));
  const upload = jest.fn();
  const bucket = { getFileMetadata: metadata, upload,
    download: (path: string) => ({ asStream: async () => ({ content: bytes, metadata: meta(path) }) }) };
  const files = { getDefaultBucket: async () => 'bucket', from: () => bucket } as unknown as
    Pick<FileService, 'from' | 'getDefaultBucket'>;
  const store = new LcmFileOriginalStore(files);
  const input = { bytes, sha256, byteLength: bytes.length, reference: { kind: 'LCM_HOST_ORIGINAL' as const,
    bucketId: 'bucket', filePath: 'wiselink/lcm/uploads/unit/local.xls',
    providerObjectId: 'immutable-provider-object', originalFileName: 'local.xls' } };
  return { bytes, meta, metadata, upload, store, input };
}

describe('personal original identity and retry boundaries', () => {
  it('two concurrent imports read back one immutable original after a definite create conflict', async () => {
    const test = fixture();
    test.metadata.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    test.upload.mockImplementationOnce(async (_bytes: Buffer, options: { filePath: string }) => test.meta(options.filePath))
      .mockRejectedValueOnce(Object.assign(new Error('definite concurrent create'), { status: 409 }));
    const [retained, concurrent] = await Promise.all([
      test.store.retain(actor(), test.input), test.store.retain(actor(), test.input),
    ]);
    expect(retained.sha256).toBe(test.input.sha256);
    expect(retained.bytes.equals(test.bytes)).toBe(true);
    expect(retained.reference.providerObjectId).toBe('immutable-provider-object');
    expect(concurrent.reference).toEqual(retained.reference);
    expect(test.upload).toHaveBeenCalledTimes(2);
  });

  it.each([403, 'ECONNRESET'] as const)('keeps denied/unknown upload result %s as the original error', async status => {
    const test = fixture();
    test.metadata.mockResolvedValueOnce(null);
    const failure = Object.assign(new Error('original write result'), typeof status === 'number' ? { status } : { code: status });
    test.upload.mockRejectedValueOnce(failure);
    await expect(test.store.retain(actor(), test.input)).rejects.toBe(failure);
    expect(test.metadata).toHaveBeenCalledTimes(1);
  });

  it('never accepts an existing immutable path with different original bytes', async () => {
    const test = fixture();
    await expect(test.store.retain(actor(), { ...test.input, sha256: 'a'.repeat(64) }))
      .rejects.toMatchObject({ code: 'LCM_ORIGINAL_IDENTITY_CHANGED', statusCode: 409 });
  });

  it('resolves only actual metadata owned by the current native actor', async () => {
    const test = fixture(), path: string = test.input.reference.filePath;
    await expect(test.store.resolveUpload(actor(), path)).resolves.toEqual({ bucketId: 'bucket', filePath: path,
      expectedProviderObjectId: 'immutable-provider-object' });
    test.metadata.mockResolvedValueOnce(null);
    await expect(test.store.resolveUpload(actor(), path)).resolves.toBeNull();
    test.metadata.mockResolvedValueOnce({ ...test.meta(path), createdBy: { ...test.meta(path).createdBy, userID: 456 } });
    await expect(test.store.resolveUpload(actor(), path)).rejects.toMatchObject({ code: 'LCM_UPLOAD_SELECTION_FORBIDDEN' });
    test.metadata.mockResolvedValueOnce({ ...test.meta(path), createdBy: { ...test.meta(path).createdBy,
      userID: Number.MAX_SAFE_INTEGER + 1 } });
    await expect(test.store.resolveUpload(actor(), path)).rejects.toMatchObject({ code: 'LCM_UPLOAD_SELECTION_FORBIDDEN' });
    test.metadata.mockRejectedValueOnce(Object.assign(new Error('read failed'), { code: 'ECONNRESET' }));
    await expect(test.store.resolveUpload(actor(), path)).rejects.toMatchObject({ code: 'ECONNRESET' });
    await expect(test.store.resolveUpload(actor(), 'wiselink/lcm/uploads/../other.xls'))
      .rejects.toMatchObject({ code: 'LCM_UPLOAD_SELECTION_FORBIDDEN' });
  });
});
