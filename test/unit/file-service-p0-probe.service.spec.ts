import { FileServiceP0ProbeService } from '../../server/modules/runtime-probe/file-service-p0-probe.service';

const PROBE_BYTES = Buffer.from(
  '{"probe":"WISELINK_V31_FILESERVICE_P0","schemaVersion":"wiselink.3_1.fileservice_p0_probe.v1"}\n',
  'utf8',
);

function metadata(filePath: string, bytes: Buffer) {
  return {
    id: 'probe-object-1',
    bucketID: 'bucket-probe',
    filePath,
    name: 'probe.json',
    metadata: {
      contentLength: bytes.byteLength,
      mimeType: 'application/json',
    },
  };
}

describe('FileServiceP0ProbeService', () => {
  it('uploads one fixed provider-canonical object and verifies actual bytes', async () => {
    let stored: Buffer | null = null;
    let storedPath: string | null = null;
    const upload = jest.fn(async (bytes: Buffer, options: { filePath?: string }) => {
      stored = Buffer.from(bytes);
      storedPath = String(options.filePath);
      return metadata(storedPath, stored);
    });
    const getFileMetadata = jest.fn(async (filePath: string) =>
      stored ? metadata(filePath, stored) : null,
    );
    const scoped = {
      getFileMetadata,
      upload,
      download: jest.fn(() => ({
        asStream: jest.fn(async () => ({
          content: stored,
          metadata: stored ? metadata(String(storedPath), stored) : null,
        })),
      })),
    };
    const service = new FileServiceP0ProbeService({
      getDefaultBucket: jest.fn(async () => 'bucket-probe'),
      from: jest.fn(() => scoped),
    } as never);

    await expect(service.run()).resolves.toMatchObject({
      status: 'PASS',
      stage: 'ACTUAL_BYTE_READBACK_VERIFIED',
      artifact: {
        bucketId: 'bucket-probe',
        providerFilePath: expect.stringMatching(/^validation\/fileservice\/p0\/[a-f0-9]{64}\.json$/),
        byteLength: PROBE_BYTES.byteLength,
        readbackVerified: true,
        reusedExisting: false,
      },
      authority: {
        businessWritePerformed: false,
        databaseWritePerformed: false,
        workItemCreated: false,
      },
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(storedPath).not.toMatch(/^\//);
    expect(stored).toEqual(PROBE_BYTES);
  });

  it('closes without upload when the fixed artifact already exists', async () => {
    const upload = jest.fn();
    const service = new FileServiceP0ProbeService({
      getDefaultBucket: jest.fn(async () => 'bucket-probe'),
      from: jest.fn(() => ({
        getFileMetadata: jest.fn(async () => metadata('validation/existing.json', PROBE_BYTES)),
        upload,
      })),
    } as never);

    await expect(service.run()).rejects.toMatchObject({
      code: 'FILESERVICE_P0_PROBE_ALREADY_EXISTS',
      statusCode: 409,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports an upload transport failure without retrying', async () => {
    const upload = jest.fn(async () => {
      throw Object.assign(new Error('fetch failed'), { name: 'HttpError' });
    });
    const service = new FileServiceP0ProbeService({
      getDefaultBucket: jest.fn(async () => 'bucket-probe'),
      from: jest.fn(() => ({
        getFileMetadata: jest.fn(async () => null),
        upload,
      })),
    } as never);

    await expect(service.run()).rejects.toMatchObject({
      code: 'FILESERVICE_P0_PROBE_PROVIDER_FAILED',
      statusCode: 502,
      details: {
        stage: 'UPLOAD',
        sdkErrorName: 'HttpError',
        sdkErrorMessage: 'fetch failed',
        responseObserved: false,
        httpStatus: null,
      },
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
