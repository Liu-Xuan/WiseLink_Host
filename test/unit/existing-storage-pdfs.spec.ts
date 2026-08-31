import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  EXISTING_PDF_PAGE_SIZE,
  ExistingStoragePdfListError,
  existingStoragePdfVisibleText,
  formatStorageUpdatedAt,
  toExistingStoragePdfListError,
} from '../../client/src/pages/WorkspaceHomePage/existing-storage-pdf-model';

describe('official Storage PDF selection', () => {
  it('uses the Host-owned FileService list so list and ingest share one resolvable selection', async () => {
    const [source, intake] = await Promise.all([
      readFile(
        resolve(
          __dirname,
          '../../client/src/pages/WorkspaceHomePage/existing-storage-pdfs.ts',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          __dirname,
          '../../client/src/pages/WorkspaceHomePage/HostedDevelopmentIntake.tsx',
        ),
        'utf8',
      ),
    ]);

    expect(source).toContain('listDevelopmentExistingPdfs');
    expect(source).not.toContain('getDataloom');
    expect(source).not.toContain('getDefaultBucketId');
    expect(source).toContain('offset: Math.max(0, input.offset)');
    expect(source).toContain('signal: input.signal');
    expect(source).not.toContain('uploadFile');
    expect(source).not.toContain('download');
    expect(source).not.toContain('localStorage');
    expect(intake).toContain('{visible.name}');
    expect(intake).toContain('{visible.updated}');
    expect(intake).not.toContain('.owner');
    expect(intake).not.toContain('.metadata');
    expect(intake).not.toContain('777-34-0425.pdf');
  });

  it('exposes only the display name and formatted update time to the picker', () => {
    const option = {
      selection: {
        bucketId: 'private-bucket-id',
        filePath: 'private/work-items/flight-manual.pdf',
      },
      displayName: 'flight-manual.pdf',
      updatedLabel: formatStorageUpdatedAt('2026-08-31T08:30:00.000Z'),
    };
    expect(option.displayName).toBe('flight-manual.pdf');

    const visible = existingStoragePdfVisibleText(option);
    expect(visible.name).toBe('flight-manual.pdf');
    expect(visible.updated).toContain('更新于');
    expect(JSON.stringify(visible)).not.toContain('private/work-items');
    expect(JSON.stringify(visible)).not.toContain('private-bucket-id');
    expect(JSON.stringify(visible)).not.toContain('not-for-presentation');
  });

  it('keeps the visible page size bounded', () => {
    expect(EXISTING_PDF_PAGE_SIZE).toBe(24);
  });

  it('maps session expiry without exposing the raw SDK error', () => {
    const error = toExistingStoragePdfListError(
      new Error('401 unauthorized signed cookie payload'),
    );

    expect(error).toBeInstanceOf(ExistingStoragePdfListError);
    expect(error.code).toBe('AUTH_REQUIRED');
    expect(error.message).toBe('AUTH_REQUIRED');
    expect(error.message).not.toContain('signed cookie payload');
  });
});
