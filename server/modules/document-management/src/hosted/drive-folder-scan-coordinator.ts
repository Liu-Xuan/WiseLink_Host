import { decodeDriveFolderScanCheckpoint, encodeDriveFolderScanCheckpoint } from './drive-folder-scan-checkpoint';
import { scanDriveFolders, type DriveFolderScanResult, type DriveFolderScanState, type DrivePage } from './drive-folder-scanner';

export interface DriveFolderScanCheckpointStore {
  load(sourceKey: string): Promise<string | null>;
  save(sourceKey: string, checkpoint: string): Promise<void>;
  /** Optional durable identity snapshot; kept separate from scan frontier state. */
  loadCandidates?(sourceKey: string): Promise<string | null>;
  saveCandidates?(sourceKey: string, candidates: string): Promise<void>;
}

/** Runs one bounded scan using only an injected authorized fetcher and durable checkpoint store. */
export async function runDriveFolderScan(input: {
  sourceKey: string;
  roots: DriveFolderScanState[];
  fetchPage: (folderToken: string, pageToken?: string) => Promise<DrivePage>;
  checkpoints: DriveFolderScanCheckpointStore;
  maxPages?: number;
  maxEntries?: number;
}): Promise<DriveFolderScanResult> {
  const saved = await input.checkpoints.load(input.sourceKey);
  const checkpoint = saved ? decodeDriveFolderScanCheckpoint(saved) : null;
  const roots = checkpoint?.roots.length ? checkpoint.roots : input.roots;
  const start = checkpoint?.continuation.length ? checkpoint.continuation : roots;
  const persist = (continuation: DriveFolderScanState[]) => input.checkpoints.save(
    input.sourceKey,
    encodeDriveFolderScanCheckpoint(roots, continuation),
  );
  let result: DriveFolderScanResult;
  try {
    result = await scanDriveFolders(start, input.fetchPage, {
      maxPages: input.maxPages,
      maxEntries: input.maxEntries,
      onPage: persist,
    });
  } catch (error: unknown) {
    if (!isDriveAuthorizationDenied(error)) throw error;
    // Keep the exact prior frontier. A permission blocker must be visible and
    // retryable after access is granted, without pretending the folder is empty.
    return {
      entries: [], continuation: start, visitedPages: [],
      blockers: [{ folderToken: start[0]?.folderToken ?? input.roots[0]?.folderToken ?? 'unknown', code: 'DRIVE_AUTHORIZATION_DENIED' }],
    };
  }
  await persist(result.continuation);
  return result;
}

function isDriveAuthorizationDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  return value.status === 403 || value.statusCode === 403 || value.code === 1061004 ||
    (typeof value.message === 'string' && /permission_denied|lacks permission|forbidden/i.test(value.message));
}
