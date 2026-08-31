import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  EXISTING_PDF_PAGE_SIZE,
  ExistingStoragePdfListError,
  existingStoragePdfVisibleText,
  normalizeExistingStoragePdfPage,
  toExistingStoragePdfListError,
} from '../../client/src/pages/WorkspaceHomePage/existing-storage-pdf-model';

describe('official Storage PDF selection', () => {
  it('keeps the official SDK call bounded, searchable, pageable and abortable', async () => {
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

    expect(source).toContain(
      "getDataloom } from '@lark-apaas/client-toolkit/dataloom'",
    );
    expect(source).toContain('getDefaultBucketId');
    expect(source).toContain('dataloom.storage.from(bucketId)');
    expect(source).toContain('limit: EXISTING_PDF_PAGE_SIZE');
    expect(source).toContain('offset: Math.max(0, input.offset)');
    expect(source).toContain("sortBy: { column: 'updated_at', order: 'desc' }");
    expect(source).toContain('...(search ? { search } : {})');
    expect(source).toContain('{ signal: input.signal }');
    expect(source).not.toContain('uploadFile');
    expect(source).not.toContain('download');
    expect(source).not.toContain('localStorage');
    expect(intake).toContain('{visible.name}');
    expect(intake).toContain('{visible.updated}');
    expect(intake).not.toContain('.owner');
    expect(intake).not.toContain('.metadata');
    expect(intake).not.toContain('777-34-0425.pdf');
  });

  it('filters non-PDF objects and exposes only basename plus update time', () => {
    const page = normalizeExistingStoragePdfPage([
      storageObject({
        name: 'private/work-items/flight-manual.pdf',
        bucket_id: 'private-bucket-id',
        updated_at: '2026-08-31T08:30:00.000Z',
      }),
      storageObject({
        name: 'private/work-items/notes.txt',
        bucket_id: 'private-bucket-id',
        updated_at: '2026-08-30T08:30:00.000Z',
      }),
    ]);

    expect(page.items).toHaveLength(1);
    const option = page.items[0];
    if (!option) throw new Error('EXPECTED_PDF_OPTION');
    expect(option.displayName).toBe('flight-manual.pdf');
    expect(page.hasNextPage).toBe(false);

    const visible = existingStoragePdfVisibleText(option);
    expect(visible.name).toBe('flight-manual.pdf');
    expect(visible.updated).toContain('更新于');
    expect(JSON.stringify(visible)).not.toContain('private/work-items');
    expect(JSON.stringify(visible)).not.toContain('private-bucket-id');
    expect(JSON.stringify(visible)).not.toContain('not-for-presentation');
  });

  it('uses raw SDK page length only for bounded next-page availability', () => {
    const listed = Array.from({ length: EXISTING_PDF_PAGE_SIZE }, (_, index) =>
      storageObject({
        name: `folder/${index}.pdf`,
        bucket_id: 'private-bucket-id',
        updated_at: '2026-08-31T08:30:00.000Z',
      }),
    );

    expect(normalizeExistingStoragePdfPage(listed).hasNextPage).toBe(true);
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

function storageObject(input: {
  name: string;
  bucket_id: string;
  updated_at: string;
}): {
  name: string;
  bucket_id: string;
  updated_at: string;
} {
  return input;
}
