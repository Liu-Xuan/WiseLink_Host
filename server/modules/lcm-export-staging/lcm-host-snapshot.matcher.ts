import type {
  LcmCandidateRecord, LcmHostSnapshot, LcmMatch, LcmRecordMapping,
} from '../../../shared/lcm-export-staging.interface';
import { canonicalJson, LcmStagingError } from './lcm-export.helpers';

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Host snapshot entries must be objects.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Host identities must be explicit nonempty exact strings.');
  }
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Host snapshot collections must be arrays.');
  return value as unknown[];
}

export function parseHostSnapshot(bytes: Buffer): LcmHostSnapshot {
  if (bytes.length > 20 * 1024 * 1024) throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Host snapshot is too large.');
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')) as unknown; }
  catch { throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Host snapshot must be JSON.'); }
  const root: Record<string, unknown> = object(value);
  if (root.schemaVersion !== 'wiselink.lcm.host_snapshot.v1') {
    throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Unsupported Host snapshot schema.');
  }
  const capturedAt: string = text(root.capturedAt);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(capturedAt) || !Number.isFinite(Date.parse(capturedAt))) {
    throw new LcmStagingError('HOST_SNAPSHOT_INVALID', 'Host snapshot capturedAt must be an explicit zoned timestamp.');
  }
  const snapshot: LcmHostSnapshot = {
    schemaVersion: 'wiselink.lcm.host_snapshot.v1', snapshotId: text(root.snapshotId), capturedAt,
    aircraft: array(root.aircraft).map((entry: unknown) => {
      const item: Record<string, unknown> = object(entry);
      return { assetId: text(item.assetId), tailNumber: text(item.tailNumber), aircraftModel: text(item.aircraftModel) };
    }),
    software: array(root.software).map((entry: unknown) => {
      const item: Record<string, unknown> = object(entry);
      return { softwareId: text(item.softwareId), partNumber: text(item.partNumber) };
    }),
    documentBindings: array(root.documentBindings).map((entry: unknown) => {
      const item: Record<string, unknown> = object(entry);
      return { sourceEoValue: text(item.sourceEoValue), documentId: text(item.documentId),
        documentVersionId: text(item.documentVersionId), version: item.version === null ? null : text(item.version) };
    }),
  };
  function requireConsistentIdentity<T>(items: T[], key: (item: T) => string, attributes: (item: T) => unknown): void {
    const identities: Map<string, string> = new Map();
    items.forEach((item: T) => {
      const identity: string = key(item);
      const content: string = canonicalJson(attributes(item));
      const prior: string | undefined = identities.get(identity);
      if (prior !== undefined && prior !== content) {
        throw new LcmStagingError('HOST_SNAPSHOT_IDENTITY_CONFLICT', 'One Host object identity has conflicting attributes.');
      }
      identities.set(identity, content);
    });
  }
  requireConsistentIdentity(snapshot.aircraft, (item: LcmHostSnapshot['aircraft'][number]) => item.assetId,
    (item: LcmHostSnapshot['aircraft'][number]) => [item.tailNumber, item.aircraftModel]);
  requireConsistentIdentity(snapshot.software, (item: LcmHostSnapshot['software'][number]) => item.softwareId,
    (item: LcmHostSnapshot['software'][number]) => item.partNumber);
  requireConsistentIdentity(snapshot.documentBindings, (item: LcmHostSnapshot['documentBindings'][number]) =>
    item.documentVersionId,
    (item: LcmHostSnapshot['documentBindings'][number]) => [item.documentId, item.version]);
  return snapshot;
}

function exactMatch(refs: string[], missingReason: string): LcmMatch {
  const unique: string[] = [...new Set(refs)].sort();
  if (unique.length === 0) return { status: 'unresolved', refs: [], reason: missingReason };
  if (unique.length > 1) return { status: 'conflict', refs: unique, reason: 'Multiple exact identities in supplied snapshot.' };
  return { status: 'exact-snapshot-candidate', refs: unique, reason: 'Exact key in supplied read-only snapshot; live Host unverified.' };
}

export function matchLcmRecords(records: LcmCandidateRecord[], host: LcmHostSnapshot | null): LcmRecordMapping[] {
  return records.map((record: LcmCandidateRecord) => {
    const documentBindings: LcmHostSnapshot['documentBindings'] = host?.documentBindings.filter(
      (binding: LcmHostSnapshot['documentBindings'][number]) => binding.sourceEoValue === record.originalEo) ?? [];
    const documentMatch: LcmMatch = exactMatch(documentBindings.map(
      (binding: LcmHostSnapshot['documentBindings'][number]) => canonicalJson([binding.documentId, binding.documentVersionId])),
    record.originalEo === null ? 'No original EO observed.' : 'No exact EO-to-version binding available.');
    return {
      recordId: record.recordId,
      aircraft: exactMatch(host?.aircraft.filter((aircraft: LcmHostSnapshot['aircraft'][number]) =>
        aircraft.tailNumber === record.tailNumber && aircraft.aircraftModel === record.aircraftModel)
        .map((aircraft: LcmHostSnapshot['aircraft'][number]) => aircraft.assetId) ?? [],
      host === null ? 'No Host snapshot supplied.' : 'No exact tail/model match.'),
      software: exactMatch(host?.software.filter((software: LcmHostSnapshot['software'][number]) =>
        record.partNumber !== null && software.partNumber === record.partNumber)
        .map((software: LcmHostSnapshot['software'][number]) => software.softwareId) ?? [],
      record.partNumber === null ? 'Part number missing; names cannot establish identity.' : 'No exact part number match.'),
      originalEo: documentMatch,
      documentVersionRefs: documentMatch.status === 'exact-snapshot-candidate'
        ? [documentBindings[0]].map((binding: LcmHostSnapshot['documentBindings'][number]) => ({
          documentId: binding.documentId, documentVersionId: binding.documentVersionId, version: binding.version,
        })) : [],
      liveHostVerified: false,
    };
  });
}
