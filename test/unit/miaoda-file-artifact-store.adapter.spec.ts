import { MiaodaFileArtifactStoreAdapter } from '../../server/modules/unified-reader/miaoda-file-artifact-store.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';
import type { UnifiedHostActivationExactBinding } from '../../server/modules/unified-reader/unified-reader.types';

const activationBinding: UnifiedHostActivationExactBinding = {
  canonicalMiaodaHostId: 'app_17bzc551rsg',
  tenantId: 'tenant-local-test',
  environment: 'local-test',
  roleResolutionRevision: 'local-test',
  roleResolutionFingerprint:
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  canonicalArtifactStoreId: 'file-service-local-test',
  soleRegistrarServicePrincipal: 'registrar-local-test',
  immutableReceiptOwnerId: 'receipt-owner-local-test',
  immutableReceiptOwnerAdapterRevision: 'local-test',
  immutableReceiptStoreId: 'receipt-store-local-test',
};

describe('MiaodaFileArtifactStoreAdapter', () => {
  it('blocks package persistence before FileService I/O without a validation-write receipt', async () => {
    const bytes: Uint8Array = new TextEncoder().encode('{"ok":true}\n');
    const fileService = {
      getFileMetadata: jest.fn(),
      upload: jest.fn(),
      download: jest.fn(),
    };
    const adapter = new MiaodaFileArtifactStoreAdapter(
      fileService as never,
      activationBinding,
    );

    await expect(adapter.persistAndReadback(bytes)).rejects.toThrow(
      'VALIDATION_WRITE_RECEIPT_REQUIRED:PACKAGE_ARTIFACT_PERSIST',
    );
    expect(fileService.getFileMetadata).not.toHaveBeenCalled();
    expect(fileService.upload).not.toHaveBeenCalled();
    expect(fileService.download).not.toHaveBeenCalled();
    expect(adapter.activationBinding).toEqual(activationBinding);
  });

  it('reads and verifies exact existing bytes through the official FileService', async () => {
    const bytes: Uint8Array = new TextEncoder().encode('{"ok":true}\n');
    const digest: string = sha256Raw(bytes);
    const path: string = `unified-parsed-packages/sha256/${digest}.json`;
    const fileService = {
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
    const adapter = new MiaodaFileArtifactStoreAdapter(
      fileService as never,
      activationBinding,
    );
    const artifact = {
      storeRole: 'UnifiedArtifactStoreCandidate' as const,
      ref:
        'artifact://UnifiedArtifactStoreCandidate/' +
        `unified-parsed-packages/sha256/${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
      mediaType: 'application/json' as const,
    };

    await expect(adapter.readActualBytes(artifact)).resolves.toEqual(bytes);
    expect(fileService.download).toHaveBeenCalledWith(path);
  });

  it('rejects existing bytes whose content does not match the descriptor', async () => {
    const bytes: Uint8Array = new TextEncoder().encode('{"ok":true}\n');
    const digest: string = sha256Raw(bytes);
    const path: string = `unified-parsed-packages/sha256/${digest}.json`;
    const fileService = {
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
    const adapter = new MiaodaFileArtifactStoreAdapter(
      fileService as never,
      activationBinding,
    );

    await expect(
      adapter.readActualBytes({
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref:
          'artifact://UnifiedArtifactStoreCandidate/' +
          `unified-parsed-packages/sha256/${digest}`,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: 'application/json',
      }),
    ).rejects.toThrow(
      'ARTIFACT_READBACK_MISMATCH',
    );
  });
});
