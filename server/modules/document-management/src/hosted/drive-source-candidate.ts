import type { DriveEntry } from './drive-folder-scanner';

export interface DriveSourceCandidate {
  sourceKey: string;
  providerObjectId: string;
  providerVersionId: string | null;
  entryType: string;
  name: string;
  path: string;
  modifiedTime: string | null;
  identity: string;
}

export type DriveSourceCandidateChange = DriveSourceCandidate & {
  change: 'NEW' | 'CHANGED' | 'UNCHANGED';
};

/** Converts scan metadata into an identity-only candidate; it never treats a scan as analysis input. */
export function toDriveSourceCandidates(sourceKey: string, entries: readonly (DriveEntry & { path: string })[]): DriveSourceCandidate[] {
  return entries
    .filter(entry => entry.type !== 'folder')
    .map(entry => {
      const providerVersionId = readString(entry, 'version_id') ?? readString(entry, 'revision') ?? null;
      return {
        sourceKey,
        providerObjectId: entry.token,
        providerVersionId,
        entryType: entry.type,
        name: entry.name,
        path: entry.path,
        modifiedTime: entry.modifiedTime ?? readString(entry, 'modified_time') ?? null,
        identity: `${sourceKey}:${entry.type}:${entry.token}:${providerVersionId ?? 'unversioned'}`,
      };
    });
}

/** Compares provider identity/version only; a repeated event cannot trigger re-analysis. */
export function classifyDriveSourceCandidates(
  previous: readonly DriveSourceCandidate[],
  current: readonly DriveSourceCandidate[],
): DriveSourceCandidateChange[] {
  const prior = new Map(previous.map(candidate => [candidate.providerObjectId, candidate]));
  return current.map(candidate => {
    const before = prior.get(candidate.providerObjectId);
    return { ...candidate, change: !before ? 'NEW' : before.providerVersionId === candidate.providerVersionId ? 'UNCHANGED' : 'CHANGED' };
  });
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate ? candidate : null;
}
