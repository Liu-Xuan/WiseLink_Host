export const EXISTING_PDF_PAGE_SIZE = 24;

export interface ListedStorageObject {
  name: string;
  bucket_id: string;
  updated_at: string;
}

export interface ExistingStoragePdfOption {
  selection: {
    bucketId: string;
    filePath: string;
  };
  displayName: string;
  updatedLabel: string;
}

export interface ExistingStoragePdfPage {
  items: ExistingStoragePdfOption[];
  hasNextPage: boolean;
}

export interface ExistingStoragePdfVisibleText {
  name: string;
  updated: string;
}

export type ExistingStoragePdfListErrorCode =
  | 'AUTH_REQUIRED'
  | 'BUCKET_UNAVAILABLE'
  | 'LIST_FAILED';

export class ExistingStoragePdfListError extends Error {
  constructor(public readonly code: ExistingStoragePdfListErrorCode) {
    super(code);
    this.name = 'ExistingStoragePdfListError';
  }
}

export function normalizeExistingStoragePdfPage(
  listed: ListedStorageObject[],
): ExistingStoragePdfPage {
  return {
    items: listed.flatMap((file: ListedStorageObject) => {
      const filePath = file.name.trim();
      const resultBucketId = file.bucket_id.trim();
      if (
        !filePath ||
        !resultBucketId ||
        !displayPdfName(filePath).toLowerCase().endsWith('.pdf')
      ) {
        return [];
      }
      return [
        {
          selection: { bucketId: resultBucketId, filePath },
          displayName: displayPdfName(filePath),
          updatedLabel: formatStorageUpdatedAt(file.updated_at),
        },
      ];
    }),
    hasNextPage: listed.length === EXISTING_PDF_PAGE_SIZE,
  };
}

export function displayPdfName(filePath: string): string {
  const segments = filePath.split(/[\\/]/u).filter(Boolean);
  return segments.at(-1)?.trim() || '未命名 PDF';
}

export function existingStoragePdfVisibleText(
  option: ExistingStoragePdfOption,
): ExistingStoragePdfVisibleText {
  return {
    name: option.displayName,
    updated: option.updatedLabel,
  };
}

export function toExistingStoragePdfListError(
  reason: unknown,
): ExistingStoragePdfListError {
  const message =
    reason instanceof Error ? reason.message : String(reason ?? '');
  if (/401|unauthorized|login|oauth|session/iu.test(message)) {
    return new ExistingStoragePdfListError('AUTH_REQUIRED');
  }
  return new ExistingStoragePdfListError('LIST_FAILED');
}

function formatStorageUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '更新时间未知';
  return `更新于 ${new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))}`;
}
