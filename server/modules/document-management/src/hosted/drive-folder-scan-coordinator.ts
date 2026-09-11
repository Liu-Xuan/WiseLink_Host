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
  const result = await scanDriveFolders(start, input.fetchPage, {
    maxPages: input.maxPages,
    maxEntries: input.maxEntries,
    onPage: persist,
  });
  await persist(result.continuation);
  return result;
}
