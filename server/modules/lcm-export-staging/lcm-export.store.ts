import { randomUUID } from 'node:crypto';
import {
  chmod, link, lstat, mkdir, open, readFile, readdir, rename, rm,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type {
  LcmCandidateRecord, LcmCandidateSnapshot, LcmHostSnapshot, LcmParsedExport, LcmCollectionContext, LcmLocalObservation,
  LcmRecordMapping, LcmStageOptions, LcmStageResult,
} from '../../../shared/lcm-export-staging.interface';
import { canonicalJson, LcmStagingError, sha256 } from './lcm-export.helpers';
import { parseLcmExport } from './lcm-export.parser';
import { matchLcmRecords, parseHostSnapshot } from './lcm-host-snapshot.matcher';
import { collectionScope, parseCollectionContext } from './lcm-collection-context';

function errorCode(error: unknown): string | null {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : null;
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stats: Awaited<ReturnType<typeof lstat>> = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LcmStagingError('STAGING_PATH_INVALID', 'Staging directories must be ordinary local directories.');
  }
  await chmod(path, 0o700);
}

/** Hard-link an fsynced temporary file; existing bytes are never overwritten. */
async function immutableFile(path: string, bytes: Buffer, pendingDirectory: string): Promise<void> {
  const tempPath: string = join(pendingDirectory, randomUUID());
  const handle: Awaited<ReturnType<typeof open>> = await open(tempPath, 'wx', 0o400);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  try {
    try { await link(tempPath, path); }
    catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const stats: Awaited<ReturnType<typeof lstat>> = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink() || !(await readFile(path)).equals(bytes)) {
        throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'An immutable staging artifact differs from its expected bytes.');
      }
    }
  } finally { await rm(tempPath, { force: true }); }
}

async function readSnapshots(path: string, root: string): Promise<LcmCandidateSnapshot[]> {
  const names: string[] = (await readdir(path)).sort();
  const snapshots: LcmCandidateSnapshot[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}$/u.test(name)) {
      throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'Unexpected entry in snapshot storage.');
    }
    const snapshotPath: string = join(path, name, 'snapshot.json');
    const bytes: Buffer = await readFile(snapshotPath);
    let snapshot: LcmCandidateSnapshot;
    try { snapshot = JSON.parse(bytes.toString('utf8')) as LcmCandidateSnapshot; }
    catch { throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'Stored snapshot JSON is unreadable.'); }
    if (snapshot.schemaVersion !== 'wiselink.lcm.local_candidate_snapshot.v1' ||
        snapshot.snapshotId !== name || !Array.isArray(snapshot.parsed?.records) ||
        snapshotIdFor(snapshot.scopeKey, snapshot.parsed.contentDigest, snapshot.hostSnapshot?.sha256 ?? null,
          snapshot.previousSnapshotId) !== name) {
      throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'Stored snapshot identity cannot be verified.');
    }
    if (!/^[a-f0-9]{64}$/u.test(snapshot.source.rawSha256)) {
      throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'Stored raw artifact identity is invalid.');
    }
    const raw: Buffer = await readFile(join(root, 'artifacts', `${snapshot.source.rawSha256}.bin`));
    if (sha256(raw) !== snapshot.source.rawSha256 || raw.length !== snapshot.source.rawByteLength ||
        canonicalJson(parseLcmExport(raw, snapshot.parsed.metadata.aircraftModel)) !== canonicalJson(snapshot.parsed)) {
      throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'Stored candidate does not match its immutable workbook.');
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

function snapshotIdFor(scopeKey: string, contentDigest: string, hostSha: string | null, previousSnapshotId: string | null): string {
  return sha256(canonicalJson({ scopeKey, contentDigest, hostSha, previousSnapshotId }));
}

function latestSnapshot(snapshots: LcmCandidateSnapshot[], scopeKey: string): LcmCandidateSnapshot | null {
  const scoped: LcmCandidateSnapshot[] = snapshots.filter((snapshot: LcmCandidateSnapshot) => snapshot.scopeKey === scopeKey);
  const predecessors: Set<string | null> = new Set(scoped.map((snapshot: LcmCandidateSnapshot) => snapshot.previousSnapshotId));
  const heads: LcmCandidateSnapshot[] = scoped.filter((snapshot: LcmCandidateSnapshot) => !predecessors.has(snapshot.snapshotId));
  if (heads.length > 1 || (scoped.length > 0 && heads.length !== 1)) {
    throw new LcmStagingError('STAGING_HISTORY_CONFLICT', 'Scope history has multiple heads or a cycle.');
  }
  return heads[0] ?? null;
}

function changesFrom(previous: LcmCandidateSnapshot | null, parsed: LcmParsedExport): LcmCandidateSnapshot['changes'] {
  const oldRecords: LcmCandidateRecord[] = previous?.parsed.records ?? [];
  const oldIds: Set<string> = new Set(oldRecords.map((record: LcmCandidateRecord) => record.recordId));
  const newIds: Set<string> = new Set(parsed.records.map((record: LcmCandidateRecord) => record.recordId));
  const currentIdentities: Map<string, string[]> = new Map();
  parsed.records.forEach((record: LcmCandidateRecord) => {
    currentIdentities.set(record.identityKey, [...(currentIdentities.get(record.identityKey) ?? []), record.recordId]);
  });
  return {
    addedRecordIds: parsed.records.filter((record: LcmCandidateRecord) => !oldIds.has(record.recordId))
      .map((record: LcmCandidateRecord) => record.recordId),
    changedIdentityKeys: [...new Set(oldRecords.filter((record: LcmCandidateRecord) =>
      currentIdentities.has(record.identityKey) && !newIds.has(record.recordId))
      .map((record: LcmCandidateRecord) => record.identityKey))].sort(),
    unobservedPreviousRecordIds: oldRecords.filter((record: LcmCandidateRecord) => !newIds.has(record.recordId))
      .map((record: LcmCandidateRecord) => record.recordId),
    previousRecordsRetained: true, withdrawalStatus: 'unknown',
  };
}

async function readableFile(path: string): Promise<Buffer> {
  const stats: Awaited<ReturnType<typeof lstat>> = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new LcmStagingError('INPUT_PATH_INVALID', 'Input must be an ordinary local file.');
  }
  if (stats.size > 50 * 1024 * 1024) throw new LcmStagingError('INPUT_TOO_LARGE', 'Input exceeds the local file limit.');
  return readFile(path);
}

export async function stageLcmExport(options: LcmStageOptions): Promise<LcmStageResult> {
  if (/\.(?:crdownload|part|download)$/iu.test(options.inputPath)) {
    throw new LcmStagingError('INPUT_INCOMPLETE', 'A partial browser download cannot be staged.');
  }
  const inputBytes: Buffer = await readableFile(options.inputPath);
  const parsed: LcmParsedExport = parseLcmExport(inputBytes, options.aircraftModel);
  const context: LcmCollectionContext | null = options.collectionContextPath
    ? parseCollectionContext(await readableFile(options.collectionContextPath)) : null;
  const scopeKey: string = collectionScope(parsed, context);
  const localSourcePath: string = resolve(options.inputPath);
  const hostBytes: Buffer | null = options.hostSnapshotPath ? await readableFile(options.hostSnapshotPath) : null;
  const host: LcmHostSnapshot | null = hostBytes ? parseHostSnapshot(hostBytes) : null;
  const mappings: LcmRecordMapping[] = matchLcmRecords(parsed.records, host);
  const root: string = resolve(options.stagingDirectory);
  await privateDirectory(root);
  const lockPath: string = join(root, '.run-once.lock');
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error: unknown) {
    if (errorCode(error) === 'EEXIST') throw new LcmStagingError('STAGING_LOCKED', 'Another run or an interrupted run holds the local lock.');
    throw error;
  }
  try {
    const pending: string = join(root, '.pending');
    const artifacts: string = join(root, 'artifacts');
    const snapshotsPath: string = join(root, 'snapshots');
    const observations: string = join(root, 'observations');
    for (const directory of [pending, artifacts, snapshotsPath, observations]) await privateDirectory(directory);
    const rawSha: string = sha256(inputBytes);
    const hostSha: string | null = hostBytes ? sha256(hostBytes) : null;
    const artifactRef: string = `artifacts/${rawSha}.bin`;
    await immutableFile(join(root, artifactRef), inputBytes, pending);
    if (hostBytes && hostSha) await immutableFile(join(artifacts, `${hostSha}.json`), hostBytes, pending);
    const snapshots: LcmCandidateSnapshot[] = await readSnapshots(snapshotsPath, root);
    const previous: LcmCandidateSnapshot | null = latestSnapshot(snapshots, scopeKey);
    const now: string = (options.now?.() ?? new Date()).toISOString();
    // A source path is provenance; moving the workbook does not create a new collection.
    const collectionObservationId: string | null = context
      ? sha256(canonicalJson({ scopeKey, collectionId: context.collectionId })) : null;
    if (collectionObservationId !== null) {
      const previousObservationPath: string = join(observations, `${collectionObservationId}.json`);
      let previousObservationBytes: Buffer | null = null;
      try { previousObservationBytes = await readFile(previousObservationPath); }
      catch (error: unknown) { if (errorCode(error) !== 'ENOENT') throw error; }
      if (previousObservationBytes !== null) {
        const observed: LcmLocalObservation = JSON.parse(previousObservationBytes.toString('utf8')) as LcmLocalObservation;
        if (observed.rawSha256 !== rawSha || observed.hostSha256 !== hostSha ||
            canonicalJson(observed.collectionContext) !== canonicalJson(context) ||
            canonicalJson(observed.parsed) !== canonicalJson(parsed)) {
          throw new LcmStagingError('COLLECTION_REPLAY_CONFLICT', 'A collection ID was reused with different input.');
        }
        const recorded: LcmCandidateSnapshot | undefined = snapshots.find(
          (snapshot: LcmCandidateSnapshot) => snapshot.snapshotId === observed.snapshotId);
        if (!recorded) throw new LcmStagingError('STAGING_INTEGRITY_CONFLICT', 'Collection snapshot is missing.');
        return stageResult('unchanged', recorded.snapshotId, join(snapshotsPath, recorded.snapshotId, 'snapshot.json'),
          previousObservationPath, rawSha, parsed, mappings);
      }
    }
    const unchanged: boolean = previous?.parsed.contentDigest === parsed.contentDigest &&
      (previous?.hostSnapshot?.sha256 ?? null) === hostSha;
    const snapshotId: string = unchanged && previous ? previous.snapshotId
      : snapshotIdFor(scopeKey, parsed.contentDigest, hostSha, previous?.snapshotId ?? null);
    const snapshotPath: string = join(snapshotsPath, snapshotId, 'snapshot.json');
    if (!unchanged) {
      const snapshot: LcmCandidateSnapshot = {
        schemaVersion: 'wiselink.lcm.local_candidate_snapshot.v1', snapshotId,
        previousSnapshotId: previous?.snapshotId ?? null, createdAt: now, scopeKey,
        source: { sourceAuthority: 'unverified/local', originalFileName: basename(options.inputPath),
          rawSha256: rawSha, rawByteLength: inputBytes.length, artifactRef,
          sourceObservedAt: context?.observedAt ?? null, ingestedAt: now, localSourcePath, collectionContext: context },
        parsed, hostSnapshot: host && hostSha ? { sha256: hostSha, snapshotId: host.snapshotId,
          artifactRef: `artifacts/${hostSha}.json` } : null,
        mappings, changes: changesFrom(previous, parsed),
        authority: { candidateOnly: true, writesHost: false, formallyAdopted: false, createsInstallationEvents: false },
      };
      const transactionPath: string = join(pending, randomUUID());
      await mkdir(transactionPath, { mode: 0o700 });
      try {
        await immutableFile(join(transactionPath, 'snapshot.json'),
          Buffer.from(JSON.stringify(snapshot, null, 2)), pending);
        await rename(transactionPath, join(snapshotsPath, snapshotId));
      } finally { await rm(transactionPath, { recursive: true, force: true }); }
    }
    const observationId: string = collectionObservationId ?? sha256(canonicalJson({ rawSha, snapshotId,
      localSourcePath, aircraftModelOrigin: parsed.metadata.aircraftModelOrigin }));
    const observationPath: string = join(observations, `${observationId}.json`);
    let observationExists: boolean = false;
    try { await lstat(observationPath); observationExists = true; }
    catch (error: unknown) { if (errorCode(error) !== 'ENOENT') throw error; }
    const observation: LcmLocalObservation = {
      schemaVersion: 'wiselink.lcm.local_observation.v1', snapshotId, rawSha256: rawSha,
      artifactRef, originalFileName: basename(options.inputPath), localSourcePath,
      collectionContext: context, hostSha256: hostSha, ingestedAt: now, parsed,
    };
    if (!observationExists) await immutableFile(observationPath, Buffer.from(JSON.stringify(observation, null, 2)), pending);
    return stageResult(unchanged ? 'unchanged' : 'appended', snapshotId, snapshotPath, observationPath, rawSha, parsed, mappings);
  } finally { await rm(lockPath, { recursive: true, force: true }); }
}

function stageResult(status: LcmStageResult['status'], snapshotId: string, snapshotPath: string,
  observationPath: string, rawSha: string, parsed: LcmParsedExport, mappings: LcmRecordMapping[]): LcmStageResult {
    return {
      status, snapshotId, snapshotPath, observationPath,
      rawSha256: rawSha, recordCount: parsed.records.length,
      coordinateCount: parsed.records.reduce((total: number, record: LcmCandidateRecord) => total + record.sourceRows.length, 0),
      unresolvedCount: mappings.filter((mapping: LcmRecordMapping) =>
        [mapping.aircraft, mapping.software, mapping.originalEo].some((match: LcmRecordMapping['aircraft']) =>
          match.status === 'unresolved')).length,
      conflictCount: mappings.filter((mapping: LcmRecordMapping) =>
        [mapping.aircraft, mapping.software, mapping.originalEo].some((match: LcmRecordMapping['aircraft']) =>
          match.status === 'conflict')).length + parsed.diagnostics.filter(
        (diagnostic: LcmParsedExport['diagnostics'][number]) => diagnostic.code === 'IDENTITY_CONFLICT').length,
      sourceAuthority: 'unverified/local', liveHostVerified: false,
    };
}
