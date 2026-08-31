import { listDevelopmentExistingPdfs } from '@client/src/api/canonical-host';

import {
  EXISTING_PDF_PAGE_SIZE,
  ExistingStoragePdfListError,
  type ExistingStoragePdfPage,
  formatStorageUpdatedAt,
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
  try {
    const page = await listDevelopmentExistingPdfs({
      search: input.search.trim(),
      offset: Math.max(0, input.offset),
      signal: input.signal,
    });
    return {
      items: page.items.map((item) => ({
        selection: item.selection,
        displayName: item.displayName,
        updatedLabel: formatStorageUpdatedAt(item.updatedAt),
      })),
      hasNextPage: page.hasNextPage,
    };
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
