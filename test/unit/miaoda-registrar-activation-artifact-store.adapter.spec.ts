import { createHash } from 'node:crypto';

import { MiaodaRegistrarActivationArtifactStoreAdapter } from '../../server/modules/assessment-registrar/miaoda-registrar-activation-artifact-store.adapter';

const options = {
  storeId: 'master-platform-activation-store',
  bucketId: 'bucket-registrar-activation',
  adapterRevision: 'miaoda-fileservice-read.v1',
  artifactRefPrefix: 'artifact://master/',
  filePathPrefix: '/registrar/activation/',
};

describe('MiaodaRegistrarActivationArtifactStoreAdapter', () => {
  it('reads exact actual bytes and returns Registrar store identity without write methods', async () => {
    const bytes = new TextEncoder().encode('{"activation":"candidate"}\n');
    const metadata = fileMetadata(
      'registrar/activation/activation.json',
      bytes.byteLength,
    );
    const bucket = {
      getFileMetadata: jest.fn().mockResolvedValue(metadata),
      download: jest.fn().mockReturnValue(
        Promise.resolve({
          content: new Blob([bytes], { type: 'application/json' }),
          metadata,
        }),
      ),
    };
    const fileService = { from: jest.fn().mockReturnValue(bucket) };
    const adapter = new MiaodaRegistrarActivationArtifactStoreAdapter(
      fileService,
      options,
    );

    const result = await adapter.readActualBytes(
      'artifact://master/activation.json',
    );

    expect(result).toEqual({
      artifactRef: 'artifact://master/activation.json',
      artifactSha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      mediaType: 'application/json',
      storeId: options.storeId,
      bucketId: options.bucketId,
      adapterRevision: options.adapterRevision,
      bytes,
    });
    expect(fileService.from).toHaveBeenCalledWith(options.bucketId);
    expect(bucket.getFileMetadata).toHaveBeenCalledWith(
      'registrar/activation/activation.json',
    );
    expect(bucket.download).toHaveBeenCalledWith(
      'registrar/activation/activation.json',
    );
    expect('upload' in bucket).toBe(false);
    expect('remove' in bucket).toBe(false);
  });

  it('rejects a ref outside the configured store before FileService I/O', async () => {
    const fileService = { from: jest.fn() };
    const adapter = new MiaodaRegistrarActivationArtifactStoreAdapter(
      fileService,
      options,
    );

    await expect(
      adapter.readActualBytes('artifact://another-store/activation.json'),
    ).rejects.toThrow('REGISTRAR_ARTIFACT_REF_NOT_IN_CONFIGURED_STORE');
    expect(fileService.from).not.toHaveBeenCalled();
  });

  it('rejects provider-object drift between metadata and actual-byte download', async () => {
    const bytes = new TextEncoder().encode('{"activation":"candidate"}\n');
    const metadata = fileMetadata(
      'registrar/activation/activation.json',
      bytes.byteLength,
    );
    const bucket = {
      getFileMetadata: jest.fn().mockResolvedValue(metadata),
      download: jest.fn().mockReturnValue(
        Promise.resolve({
          content: new Blob([bytes], { type: 'application/json' }),
          metadata: { ...metadata, id: 'different-provider-object' },
        }),
      ),
    };
    const adapter = new MiaodaRegistrarActivationArtifactStoreAdapter(
      { from: jest.fn().mockReturnValue(bucket) },
      options,
    );

    await expect(
      adapter.readActualBytes('artifact://master/activation.json'),
    ).rejects.toThrow('REGISTRAR_ARTIFACT_OBJECT_ID_DRIFT');
  });
});

function fileMetadata(filePath: string, byteLength: number) {
  return {
    id: 'provider-object-activation',
    filePath,
    bucketID: options.bucketId,
    metadata: {
      contentLength: String(byteLength),
      mimeType: 'application/json',
    },
  };
}
