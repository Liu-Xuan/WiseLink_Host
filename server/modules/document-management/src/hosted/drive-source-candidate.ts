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

export function encodeDriveSourceCandidates(candidates: readonly DriveSourceCandidate[]): string {
  return JSON.stringify(candidates.map(candidate => normalizeCandidate(candidate)));
}

export function decodeDriveSourceCandidates(value: string): DriveSourceCandidate[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('DRIVE_CANDIDATE_SNAPSHOT_INVALID'); }
  if (!Array.isArray(parsed)) throw new Error('DRIVE_CANDIDATE_SNAPSHOT_INVALID');
  return parsed.map(item => normalizeCandidate(item));
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

/** Compares provider identity/version only; a repeated event cannot trigger re-analysis. */
export function classifyDriveSourceCandidates(
  previous: readonly DriveSourceCandidate[],
  current: readonly DriveSourceCandidate[],
): DriveSourceCandidateChange[] {
  // Scope provider object IDs by source. Different shared roots can expose the
  // same token; they remain distinct business identities here.
  const prior = new Map(previous.map(candidate => [`${candidate.sourceKey}:${candidate.providerObjectId}`, candidate]));
  return current.map(candidate => {
    const before = prior.get(`${candidate.sourceKey}:${candidate.providerObjectId}`);
    const hasVersionSignal = before?.providerVersionId !== null && before?.providerVersionId !== undefined
      || candidate.providerVersionId !== null && candidate.providerVersionId !== undefined;
    const hasModifiedSignal = before?.modifiedTime !== null && before?.modifiedTime !== undefined
      || candidate.modifiedTime !== null && candidate.modifiedTime !== undefined;
    const unchanged = before && (hasVersionSignal
      ? before.providerVersionId === candidate.providerVersionId
      : hasModifiedSignal ? before.modifiedTime === candidate.modifiedTime : false);
    return { ...candidate, change: !before ? 'NEW' : unchanged ? 'UNCHANGED' : 'CHANGED' };
  });
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate ? candidate : null;
}

function normalizeCandidate(value: unknown): DriveSourceCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DRIVE_CANDIDATE_SNAPSHOT_INVALID');
  const item = value as Record<string, unknown>;
  const strings = ['sourceKey', 'providerObjectId', 'entryType', 'name', 'path', 'identity'];
  if (strings.some(key => typeof item[key] !== 'string' || !item[key])) throw new Error('DRIVE_CANDIDATE_SNAPSHOT_INVALID');
  if (item.providerVersionId !== null && typeof item.providerVersionId !== 'string') throw new Error('DRIVE_CANDIDATE_SNAPSHOT_INVALID');
  if (item.modifiedTime !== null && typeof item.modifiedTime !== 'string') throw new Error('DRIVE_CANDIDATE_SNAPSHOT_INVALID');
  return {
    sourceKey: item.sourceKey as string,
    providerObjectId: item.providerObjectId as string,
    providerVersionId: item.providerVersionId as string | null,
    entryType: item.entryType as string,
    name: item.name as string,
    path: item.path as string,
    modifiedTime: item.modifiedTime as string | null,
    identity: item.identity as string,
  };
}
