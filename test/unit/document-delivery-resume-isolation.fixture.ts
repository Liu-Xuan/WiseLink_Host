import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { AutomaticWorkItemDispatchService } from '@server/modules/canonical-host/automatic-work-item-dispatch.service';
import { DocumentWorkRuntimeService } from '@server/modules/canonical-host/document-work-runtime.service';
import { DocumentReadingRuntimeService } from '@server/modules/canonical-host/document-reading-runtime.service';
import {
  DocumentReadingRunRepository,
  type DocumentReadingRun,
} from '@server/modules/canonical-host/document-reading-run.repository';
import { documentDeliveryRequestId } from '@server/modules/canonical-host/document-delivery-ref';
import { documentOriginalReadingCoverage } from '@server/modules/document-management/src/hosted/nest/document-original-adapter';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

export const deliveryOwner = {
  tenantId: 'isolation-tenant', actorUserId: 'isolation-actor',
  principalId: 'service:openclaw-isolation', appId: 'app_17bzc551rsg',
};
export const deliveryIds = {
  a: { acquisitionId: 'ACQ-A', documentVersionId: 'DV-A', actorUserId: deliveryOwner.actorUserId },
  b: { acquisitionId: 'ACQ-B', documentVersionId: 'DV-B', actorUserId: deliveryOwner.actorUserId },
};
type Upload = typeof deliveryIds.a & { status: 'WAITING' | 'ADMITTED' };
type StoredReading = DocumentReadingRun & { tenantId: string; actorUserId: string };
type Statement = { sql: string; params: unknown[] };

/** Constructed storage/ACL/original ports only. The three production services,
 * all reading repository methods (including BEGIN), and their SQL run unchanged.
 * This deterministic SQL sink is not a PostgreSQL concurrency/RLS proof. */
export function deliveryIsolationFixture() {
  const uploads: Upload[] = Object.values(deliveryIds).map((item) => ({ ...item, status: 'WAITING' }));
  const originals = new Map<string, ReturnType<typeof originalFixture>>();
  for (const [key, item] of Object.entries(deliveryIds)) {
    for (const revision of key === 'a' ? [1, 2] : [1]) {
      const original = originalFixture();
      Object.assign(original.binding, { documentVersionId: item.documentVersionId,
        parseRunId: `PR-${key.toUpperCase()}-${revision}`, parseRevision: revision,
        sourceArtifactId: `ART-${key}`, sourceSha256: key.repeat(64), sourceByteLength: 1234 });
      originals.set(original.binding.parseRunId, original);
    }
  }
  const original = originals.get('PR-A-1')!;
  const executionModel = { modelRef: 'minimax/MiniMax-M2.5', displayName: 'Synthetic stored selection',
    providerKind: 'BUILT_IN' as const, settingsRevision: 1, selectedAt: '2026-10-17T00:00:00Z' };
  const a: StoredReading = { ...deliveryOwner, runRef: 'DRR-A-1',
    requestId: documentDeliveryRequestId('reading', 'acquisition:ACQ-A'),
    documentVersionId: 'DV-A', parseRunId: 'PR-A-1', parseRevision: 1, semanticRevision: 1,
    manifestSha256: '1'.repeat(64), expectedRevision: 0, readingRevision: 1, status: 'SAVED',
    deadline: '2030-01-01T00:00:00Z', deliveredRanges: [], saveCommand: null, errorCode: null,
    executionModel, result: { schemaVersion: 'wiselink.document.reading.v1', readingRunRef: 'DRR-A-1',
      readingRevision: 1, candidateOnly: true, headline: 'Constructed original accepted reading',
      brief: { text: 'Constructed original brief', quotes: [] },
      explanation: [{ text: 'Constructed explanation', quotes: [] }], criticalConditions: [], limitations: [],
      sourceBinding: { original: original.binding, semanticRevision: 1 },
      readCoverage: { status: 'PARTIAL_DELIVERY', deliveredUnitIds: [],
        totalUnitCount: original.source.units.length, sourceCoverage: documentOriginalReadingCoverage(original) },
      sourceAnchors: [], producer: { skillVersion: 'constructed-fixture', modelVersion: 'stored-not-invoked' },
      savedAt: '2026-10-17T00:00:00Z' } };
  const rows: StoredReading[] = [a];
  const calls: Statement[] = [];
  const faults: { database?: Error; identity?: Error; transaction?: Error; hideRequestReads: number } = { hideRequestReads: 0 };
  const dialect = new PgDialect();
  const manifest = (parseRunId: string): string => String(originals.get(parseRunId)!.binding.parseRevision).repeat(64);
  const latest = (documentVersionId: string) => [...originals.values()]
    .filter((item) => item.binding.documentVersionId === documentVersionId)
    .sort((left, right) => right.binding.parseRevision - left.binding.parseRevision)[0]!;
  const execute = jest.fn(async (statement: SQL): Promise<unknown[]> => {
    if (faults.database) throw faults.database;
    const query = dialect.sqlToQuery(statement);
    const compact = query.sql.replace(/\s+/gu, ' ').trim();
    const p = query.params;
    calls.push(query);
    if (compact.includes('FROM dm_document_reading_retraction')) return [];
    if (compact.startsWith('SELECT document_version_id FROM dm_document_version'))
      return [...originals.values()].some((item) => item.binding.documentVersionId === p[0])
        ? [{ document_version_id: p[0] }] : [];
    if (compact.startsWith('SELECT p.parse_run_id FROM dm_document_parse_run')) {
      const source = originals.get(String(p[2]));
      return source && p[0] === deliveryOwner.tenantId && source.binding.documentVersionId === p[1]
        && source.binding.parseRevision === p[3] && manifest(source.binding.parseRunId) === p[4]
        && p[5] === 1 && p[4] === p[6] ? [{ parse_run_id: p[2] }] : [];
    }
    if (compact.startsWith('SELECT COALESCE(MAX(reading_revision)')) {
      const saved = rows.filter((row) => row.tenantId === p[0] && row.documentVersionId === p[1]
        && row.parseRunId === p[2] && row.semanticRevision === p[3] && row.status === 'SAVED');
      return [{ revision: Math.max(0, ...saved.map((row) => row.readingRevision ?? 0)) }];
    }
    if (compact.startsWith('INSERT INTO "dm_document_reading_run"')) {
      const row: StoredReading = { runRef: String(p[0]), tenantId: String(p[1]), actorUserId: String(p[2]),
        requestId: String(p[3]), documentVersionId: String(p[4]), parseRunId: String(p[5]),
        parseRevision: Number(p[6]), semanticRevision: Number(p[7]), manifestSha256: String(p[8]),
        expectedRevision: Number(p[9]), executionModel: JSON.parse(String(p[10])).executionModel,
        status: 'QUEUED', readingRevision: null, deadline: '2030-01-01T00:00:00Z',
        deliveredRanges: [], result: null, saveCommand: null, errorCode: null };
      rows.push(row);
      return [row];
    }
    if (compact.startsWith('UPDATE "dm_document_reading_run" SET status=\'EXPIRED\'')) {
      // All constructed deadlines are future; this real control query changes no row.
      if (rows.some((row) => Date.parse(row.deadline) <= Date.now()))
        throw new Error('FIXTURE_REQUIRES_EXPLICIT_EXPIRED_DEADLINE');
      return [];
    }
    if (compact.startsWith('SELECT') && compact.includes('FROM "dm_document_reading_run"')) {
      let found = rows.filter((row) => row.tenantId === p[0] && row.actorUserId === p[1]);
      if (compact.includes('AND request_id=') && !compact.includes('status IN')) {
        if (faults.hideRequestReads > 0) { faults.hideRequestReads--; return []; }
        found = found.filter((row) => row.requestId === p[2]);
      } else if (compact.includes('status IN')) {
        found = found.filter((row) => row.documentVersionId === p[2]
          && (p[3] === null || row.requestId === p[3]) && ['QUEUED', 'RUNNING'].includes(row.status));
        return found.slice(0, 1).map((row) => ({ runRef: row.runRef }));
      } else found = found.filter((row) => row.documentVersionId === p[2] && row.runRef === p[3]);
      return found;
    }
    throw new Error(`UNEXPECTED_READING_STORAGE_QUERY: ${compact.slice(0, 120)}`);
  });
  const database = { execute, transaction: jest.fn(async <T>(operation: (tx: { execute: typeof execute }) => Promise<T>) => {
    if (faults.transaction) throw faults.transaction;
    return operation({ execute });
  }) };
  const runs = new DocumentReadingRunRepository(database as never);
  // Spies observe original methods; none replaces repository/runtime logic.
  const begin = jest.spyOn(runs, 'begin');
  const save = jest.spyOn(runs, 'save');
  const claim = jest.spyOn(runs, 'claim');
  const authorization = {
    authorizeOpenClawAutoWorkItemQueue: jest.fn(async () => ({ ...deliveryOwner,
      authorizationFingerprint: `sha256:${'c'.repeat(64)}` })),
    authorizeDocumentWork: jest.fn(async (input: { documentVersionId: string; purpose?: string }) => {
      if (faults.identity) throw faults.identity;
      return { ...deliveryOwner, documentVersionId: input.documentVersionId };
    }),
  };
  const actors = { withActorScope: jest.fn(async <T>(_actor: string, operation: () => Promise<T>) => operation()) };
  const parsing = {
    status: jest.fn(async (documentVersionId: string) => ({ documentVersionId, runtimeAvailable: true,
      latestRun: { ...latest(documentVersionId).binding, status: 'PUBLISHED' },
      publishedRun: { ...latest(documentVersionId).binding, status: 'PUBLISHED' } })),
    inspectPublishedIdentity: jest.fn(async (_documentVersionId: string, parseRunId: string) => ({
      familyId: 'F-A', binding: originals.get(parseRunId)!.binding })),
    start: jest.fn(async () => { throw new Error('UNEXPECTED_PARSE_START'); }),
    executeStep: jest.fn(async () => { throw new Error('UNEXPECTED_PARSE_EXECUTION'); }),
  };
  const reader = { readDocumentOriginal: jest.fn(async (_documentVersionId: string, parseRunId: string) => {
    const source = originals.get(parseRunId)!;
    return { original: source, structuredSource: source.source,
      run: { parseRunId, status: 'PUBLISHED', manifestArtifact: { relativePath: 'original/manifest.json',
        readback: 'VERIFIED', sha256: manifest(parseRunId), byteLength: 4321 } } };
  }) };
  const semantics = { ensure: jest.fn(async () => ({ semanticRevision: 1 })),
    read: jest.fn(async () => ({ semanticRevision: 1 })) };
  const catalog = {
    listDocumentUploadDeliveryCandidates: jest.fn(async ({ afterAcquisitionId }: { afterAcquisitionId?: string }) =>
      uploads.filter((item) => !afterAcquisitionId || item.acquisitionId > afterAcquisitionId)
        .map((item) => ({ ...item }))),
    readDocumentUploadDeliveryIntents: jest.fn(async ({ documentVersionId }: { documentVersionId: string }) =>
      uploads.filter((item) => item.documentVersionId === documentVersionId)
        .map((item) => ({ ...item, delivery: { reading: true, translation: 'NONE' } }))),
    readOwnedAcquisitionVersionBinding: jest.fn(async () => true),
    readOriginalRegistryIdentity: jest.fn(async (documentVersionId: string) => {
      const binding = latest(documentVersionId).binding;
      return { version: { sourceArtifactId: binding.sourceArtifactId },
        source: { sha256: binding.sourceSha256, byteLength: binding.sourceByteLength } };
    }),
    markDocumentUploadDeliveryAdmitted: jest.fn(async ({ acquisitionId }: { acquisitionId: string }) => {
      uploads.find((item) => item.acquisitionId === acquisitionId)!.status = 'ADMITTED';
    }),
  };
  const workItems = {
    listAutoProcessingCandidates: jest.fn(async () => []),
    listDocumentDeliveryCandidates: jest.fn(async () => []),
    readDocumentDeliveryIntents: jest.fn(async () => []),
    documentDeliveryDispatchState: jest.fn(async ({ readingRequestId }: { readingRequestId: string }) => ({
      pending: rows.some((row) => row.requestId === readingRequestId && ['QUEUED', 'RUNNING'].includes(row.status)),
      missing: false,
    })),
  };
  const modelSettings = { captureForNewTask: jest.fn(async () => executionModel) };
  const readingRuntime = new DocumentReadingRuntimeService(authorization as never, actors as never,
    reader as never, semantics as never, parsing as never, runs, modelSettings as never);
  const reading = jest.spyOn(readingRuntime, 'run');
  const projection = { nextPendingRun: jest.fn(async () => null),
    step: jest.fn(async (_scope: unknown, parseRunId: string) => ({ status: 'NO_PENDING',
      documentVersionId: originals.get(parseRunId)!.binding.documentVersionId, parseRunId })) };
  const translation = { run: jest.fn(async () => { throw new Error('UNSELECTED_TRANSLATION'); }) };
  const documentWork = new DocumentWorkRuntimeService(authorization as never, actors as never,
    parsing as never, {} as never, reader as never, projection as never, semantics as never, {} as never,
    workItems as never, catalog as never, readingRuntime, translation as never, undefined, runs);
  const prepare = jest.spyOn(documentWork, 'prepareAutomaticUpload');
  const work = jest.spyOn(documentWork, 'run');
  const dispatch = new AutomaticWorkItemDispatchService(workItems as never, {} as never,
    authorization as never, undefined, undefined, undefined, undefined, actors as never,
    undefined, catalog as never, documentWork);
  return { dispatch, documentWork, readingRuntime, runs, begin, save, claim, reading, prepare, work,
    uploads, rows, a, originals, calls, faults, execute, database, authorization, actors, parsing, reader,
    semantics, catalog, modelSettings, projection, translation };
}
