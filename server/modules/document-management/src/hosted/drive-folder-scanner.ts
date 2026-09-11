export interface DriveEntry {
  token: string;
  type: string;
  name: string;
  parentToken?: string;
  modifiedTime?: string;
  [key: string]: unknown;
}

export interface DrivePage {
  files: DriveEntry[];
  hasMore: boolean;
  nextPageToken?: string | null;
}

export interface DriveFolderScanState {
  folderToken: string;
  path: string;
  depth: number;
  pageToken?: string;
}

export interface DriveFolderScanResult {
  entries: Array<DriveEntry & { path: string; depth: number }>;
  continuation: DriveFolderScanState[];
  visitedPages: string[];
  blockers: Array<{ folderToken: string; pageToken?: string; code: string }>;
}

export interface DriveFolderScanOptions {
  maxPages?: number;
  maxEntries?: number;
  maxMissingPageTokenRetries?: number;
  /** Called after each fetched page so the caller can durably checkpoint the frontier. */
  onPage?: (continuation: DriveFolderScanState[]) => Promise<void> | void;
}

/**
 * Walks Drive folders without assuming that one page token belongs to another
 * folder. The fetcher is deliberately injected so Host can supply an
 * authorized application/委托 identity and persist state after each page.
 */
export async function scanDriveFolders(
  roots: DriveFolderScanState[],
  fetchPage: (folderToken: string, pageToken?: string) => Promise<DrivePage>,
  options: DriveFolderScanOptions = {},
): Promise<DriveFolderScanResult> {
  const maxPages = options.maxPages ?? 100;
  const maxEntries = options.maxEntries ?? 10_000;
  const maxRetries = options.maxMissingPageTokenRetries ?? 3;
  const queue = roots.map(root => ({ ...root }));
  const entries: Array<DriveEntry & { path: string; depth: number }> = [];
  const continuation: DriveFolderScanState[] = [];
  const blockers: DriveFolderScanResult['blockers'] = [];
  const visitedPages: string[] = [];
  const seen = new Set<string>();
  let pages = 0;
  while (queue.length > 0) {
    const folder = queue.shift()!;
    let pageToken = folder.pageToken;
    let missingTokenRetries = 0;
    while (true) {
      if (pages >= maxPages || entries.length >= maxEntries) {
        continuation.push({ ...folder, ...(pageToken ? { pageToken } : {}) });
        break;
      }
      const pageKey = `${folder.folderToken}:${pageToken ?? 'first'}`;
      if (visitedPages.includes(pageKey) && missingTokenRetries === 0) {
        blockers.push({ folderToken: folder.folderToken, ...(pageToken ? { pageToken } : {}), code: 'DRIVE_PAGE_TOKEN_REPEATED' });
        continuation.push({ ...folder, ...(pageToken ? { pageToken } : {}) }, ...queue);
        return { entries, continuation, visitedPages, blockers };
      }
      let page: DrivePage;
      try {
        page = await fetchPage(folder.folderToken, pageToken);
      } catch (error: unknown) {
        if (!isDriveAuthorizationDenied(error)) throw error;
        blockers.push({ folderToken: folder.folderToken, ...(pageToken ? { pageToken } : {}), code: 'DRIVE_AUTHORIZATION_DENIED' });
        continuation.push({ ...folder, ...(pageToken ? { pageToken } : {}) }, ...queue);
        return { entries, continuation, visitedPages, blockers };
      }
      pages += 1;
      visitedPages.push(pageKey);
      for (const entry of page.files) {
        const key = `${entry.type}:${entry.token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = folder.path ? `${folder.path}/${entry.name}` : entry.name;
        entries.push({ ...entry, path, depth: folder.depth });
        if (entry.type === 'folder') queue.push({ folderToken: entry.token, path, depth: folder.depth + 1 });
      }
      if (!page.hasMore) {
        await options.onPage?.([...queue]);
        break;
      }
      if (page.nextPageToken) {
        pageToken = page.nextPageToken; missingTokenRetries = 0;
        await options.onPage?.([{ ...folder, pageToken }, ...queue]);
        continue;
      }
      missingTokenRetries += 1;
      if (missingTokenRetries >= maxRetries) {
        blockers.push({ folderToken: folder.folderToken, ...(pageToken ? { pageToken } : {}), code: 'DRIVE_PAGE_TOKEN_MISSING' });
        await options.onPage?.([{ ...folder, ...(pageToken ? { pageToken } : {}) }, ...queue]);
        break;
      }
      await options.onPage?.([{ ...folder, ...(pageToken ? { pageToken } : {}) }, ...queue]);
    }
  }
  continuation.push(...queue);
  return { entries, continuation, visitedPages, blockers };
}

function isDriveAuthorizationDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; response?: unknown };
  const response = value.response && typeof value.response === 'object' ? value.response as { status?: unknown; data?: unknown } : undefined;
  const data = response?.data && typeof response.data === 'object' ? response.data as { code?: unknown; message?: unknown } : undefined;
  const messages = [value.message, data?.message].filter((item): item is string => typeof item === 'string');
  return value.status === 403 || value.statusCode === 403 || response?.status === 403 || value.code === 1061004 || data?.code === 1061004 ||
    messages.some(message => /permission_denied|lacks permission|forbidden/i.test(message));
}
