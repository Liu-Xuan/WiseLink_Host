import { MiaodaFileArtifactStoreAdapter } from '../../server/modules/unified-reader/miaoda-file-artifact-store.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

describe('MiaodaFileArtifactStoreAdapter', () => {
  it('persists once and verifies exact bytes through FileService download', async () => {
    const bytes: Uint8Array = new TextEncoder().encode('{"ok":true}\n');
    const digest: string = sha256Raw(bytes);
    const path: string = `unified-parsed-packages/sha256/${digest}.json`;
    const fileService = {
      getFileMetadata: jest.fn().mockResolvedValue(null),
      upload: jest.fn().mockResolvedValue({
        filePath: path,
        metadata: {
          contentLength: String(bytes.byteLength),
          mimeType: 'application/json',
        },
      }),
      download: jest.fn().mockResolvedValue({
        content: new Blob([bytes], { type: 'application/json' }),
        metadata: {
          filePath: path,
          metadata: {
            contentLength: String(bytes.byteLength),
            mimeType: 'application/json',
          },
        },
      }),
    };
    const adapter = new MiaodaFileArtifactStoreAdapter(fileService as never);

    const result = await adapter.persistAndReadback(bytes);

    expect(result).toMatchObject({
      reused: false,
      artifact: {
        ref:
          'artifact://UnifiedArtifactStoreCandidate/' +
          `unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
      },
    });
    expect(fileService.upload).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ filePath: path, upsert: false }),
    );
    expect(fileService.download).toHaveBeenCalledWith(path);
  });

  it('rejects a stored path whose bytes do not match the digest', async () => {
    const bytes: Uint8Array = new TextEncoder().encode('{"ok":true}\n');
    const digest: string = sha256Raw(bytes);
    const path: string = `unified-parsed-packages/sha256/${digest}.json`;
    const fileService = {
      getFileMetadata: jest.fn().mockResolvedValue({
        filePath: path,
        metadata: {
          contentLength: String(bytes.byteLength),
          mimeType: 'application/json',
        },
      }),
      upload: jest.fn(),
      download: jest.fn().mockResolvedValue({
        content: new Blob([new Uint8Array(bytes.byteLength)], {
          type: 'application/json',
        }),
        metadata: {
          filePath: path,
          metadata: {
            contentLength: String(bytes.byteLength),
            mimeType: 'application/json',
          },
        },
      }),
    };
    const adapter = new MiaodaFileArtifactStoreAdapter(fileService as never);

    await expect(adapter.persistAndReadback(bytes)).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH',
    );
    expect(fileService.upload).not.toHaveBeenCalled();
  });
});
