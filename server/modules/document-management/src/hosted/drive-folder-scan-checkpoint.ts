import type { DriveFolderScanState } from './drive-folder-scanner';

/** Durable JSON checkpoint for a bounded Drive scan. It contains no user token or file body. */
export interface DriveFolderScanCheckpoint {
  version: 1;
  roots: DriveFolderScanState[];
  continuation: DriveFolderScanState[];
  updatedAt: string;
  blockers?: Array<{ folderToken: string; pageToken?: string; code: string }>;
}

export function encodeDriveFolderScanCheckpoint(
  roots: readonly DriveFolderScanState[],
  continuation: readonly DriveFolderScanState[],
  updatedAt = new Date().toISOString(),
  blockers?: DriveFolderScanCheckpoint['blockers'],
): string {
  const checkpoint: DriveFolderScanCheckpoint = {
    version: 1,
    roots: roots.map(normalizeState),
    continuation: continuation.map(normalizeState),
    updatedAt,
    ...(blockers?.length ? { blockers } : {}),
  };
  return JSON.stringify(checkpoint);
}

export function decodeDriveFolderScanCheckpoint(value: string): DriveFolderScanCheckpoint {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('DRIVE_SCAN_CHECKPOINT_INVALID'); }
  if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.updatedAt !== 'string' ||
      !Array.isArray(parsed.roots) || !Array.isArray(parsed.continuation)) {
    throw new Error('DRIVE_SCAN_CHECKPOINT_INVALID');
  }
  return {
    version: 1,
    roots: parsed.roots.map(readState),
    continuation: parsed.continuation.map(readState),
    updatedAt: parsed.updatedAt,
    ...(Array.isArray(parsed.blockers) ? { blockers: parsed.blockers.map(readBlocker) } : {}),
  };
}

function readBlocker(value: unknown): { folderToken: string; pageToken?: string; code: string } {
  if (!isRecord(value) || typeof value.folderToken !== 'string' || !value.folderToken || typeof value.code !== 'string' || !value.code ||
      (value.pageToken !== undefined && typeof value.pageToken !== 'string')) throw new Error('DRIVE_SCAN_CHECKPOINT_INVALID');
  const pageToken = typeof value.pageToken === 'string' && value.pageToken ? value.pageToken : undefined;
  return { folderToken: value.folderToken, code: value.code, ...(pageToken ? { pageToken } : {}) };
}

function normalizeState(state: DriveFolderScanState): DriveFolderScanState {
  if (!state.folderToken || !state.path || !Number.isInteger(state.depth) || state.depth < 0)
    throw new Error('DRIVE_SCAN_CHECKPOINT_INVALID');
  return { folderToken: state.folderToken, path: state.path, depth: state.depth, ...(state.pageToken ? { pageToken: state.pageToken } : {}) };
}

function readState(value: unknown): DriveFolderScanState {
  if (!isRecord(value) || typeof value.folderToken !== 'string' || !value.folderToken || typeof value.path !== 'string' || !value.path ||
      !Number.isInteger(value.depth) || Number(value.depth) < 0 ||
      (value.pageToken !== undefined && typeof value.pageToken !== 'string'))
    throw new Error('DRIVE_SCAN_CHECKPOINT_INVALID');
  const pageToken = typeof value.pageToken === 'string' && value.pageToken ? value.pageToken : undefined;
  return { folderToken: value.folderToken, path: value.path, depth: Number(value.depth), ...(pageToken ? { pageToken } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
