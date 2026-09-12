import { toDriveSourceCandidates, type DriveSourceCandidate } from './drive-source-candidate';
import { decodeDriveFolderScanCheckpoint, encodeDriveFolderScanCheckpoint } from './drive-folder-scan-checkpoint';
import { scanDriveFolders, type DriveFolderScanResult, type DriveFolderScanState, type DrivePage } from './drive-folder-scanner';

export interface DriveFolderScanCheckpointStore {
  load(sourceKey: string): Promise<string | null>;
  savePage(sourceKey: string, checkpoint: string, candidates: DriveSourceCandidate[], expectedCheckpoint: string | null): Promise<void>;
  /** Optional durable identity snapshot; kept separate from scan frontier state. */
  loadCandidates?(sourceKey: string): Promise<string | null>;
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
  let expected = saved;
  const persist = async (continuation: DriveFolderScanState[], entries: DriveFolderScanResult['entries'], blockers: DriveFolderScanResult['blockers']) => {
    const next = encodeDriveFolderScanCheckpoint(roots, continuation, new Date().toISOString(), blockers);
    await input.checkpoints.savePage(input.sourceKey, next, toDriveSourceCandidates(input.sourceKey, entries), expected);
    expected = next;
  };
  const result: DriveFolderScanResult = await scanDriveFolders(start, input.fetchPage, {
    maxPages: input.maxPages,
    maxEntries: input.maxEntries,
    onPage: persist,
  });
  await persist(result.continuation, result.entries, result.blockers);
  return result;
}
