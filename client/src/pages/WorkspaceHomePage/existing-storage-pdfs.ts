import { getDataloom } from '@lark-apaas/client-toolkit/dataloom';
import { getDefaultBucketId } from '@lark-apaas/client-toolkit/tools/storage';

import {
  EXISTING_PDF_PAGE_SIZE,
  ExistingStoragePdfListError,
  type ExistingStoragePdfPage,
  type ListedStorageObject,
  normalizeExistingStoragePdfPage,
  toExistingStoragePdfListError,
} from './existing-storage-pdf-model';

export {
  EXISTING_PDF_PAGE_SIZE,
  ExistingStoragePdfListError,
  existingStoragePdfVisibleText,
  type ExistingStoragePdfOption,
} from './existing-storage-pdf-model';

export async function listExistingStoragePdfs(input: {
  search: string;
  offset: number;
  signal: AbortSignal;
}): Promise<ExistingStoragePdfPage> {
  const bucketId = String(getDefaultBucketId() ?? '').trim();
  if (!bucketId) {
    throw new ExistingStoragePdfListError('BUCKET_UNAVAILABLE');
  }

  try {
    const dataloom = await getDataloom();
    const bucket = dataloom.storage.from(bucketId);
    const search = input.search.trim();
    const result = await bucket.list(
      undefined,
      {
        limit: EXISTING_PDF_PAGE_SIZE,
        offset: Math.max(0, input.offset),
        sortBy: { column: 'updated_at', order: 'desc' },
        ...(search ? { search } : {}),
      },
      { signal: input.signal },
    );
    if (result.error || !result.data) {
      throw toExistingStoragePdfListError(result.error);
    }

    const listed: ListedStorageObject[] = result.data;
    return normalizeExistingStoragePdfPage(listed);
  } catch (reason) {
    if (isAbortError(reason) || reason instanceof ExistingStoragePdfListError) {
      throw reason;
    }
    throw toExistingStoragePdfListError(reason);
  }
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'AbortError';
}
