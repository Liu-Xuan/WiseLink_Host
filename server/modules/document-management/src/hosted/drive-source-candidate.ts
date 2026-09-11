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

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate ? candidate : null;
}
