import { DocumentReadingRuntimeService } from '../../server/modules/canonical-host/document-reading-runtime.service';
import type { DocumentReadingRun } from '../../server/modules/canonical-host/document-reading-run.repository';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  const map = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
  const artifact = { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 4321 };
  const loaded = { original, structuredSource: original.source, run: { status: 'PUBLISHED', manifestArtifact: artifact, sourceBinding: { familyId: 'family-test' } } };
  const scope = { tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId: original.binding.documentVersionId };
  const row: DocumentReadingRun = { runRef: 'DRR-test', requestId: 'request-test', documentVersionId: scope.documentVersionId,
    parseRunId: original.binding.parseRunId, parseRevision: original.binding.parseRevision, semanticRevision: 1,
    manifestSha256: artifact.sha256, expectedRevision: 0,
    readingRevision: null, status: 'RUNNING', deadline: '2026-09-17T00:00:00Z', deliveredRanges: [], result: null, saveCommand: null, errorCode: null };
  const fence = { documentVersionId: scope.documentVersionId, runRef: row.runRef, leaseOwner: 'test-producer',
    leaseToken: '0f23e82b-2b1e-46ba-b62b-9e9a2ec62ca0', leaseGeneration: 1 };
  const authorization = { authorizeDocumentWork: jest.fn().mockResolvedValue(scope) };
  const actors = { withActorScope: jest.fn(async (_actor, fn) => fn()) };
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue(loaded) };
  const semantics = { read: jest.fn().mockResolvedValue(map), ensure: jest.fn() };
  const parsing = { status: jest.fn().mockResolvedValue({}) };
  const runs = { begin: jest.fn().mockResolvedValue(row), readRun: jest.fn().mockResolvedValue(row), readSaved: jest.fn().mockResolvedValue(null),
    recordDelivery: jest.fn(async (_scope, _fence, range) => { row.deliveredRanges.push(range); }),
    save: jest.fn(async (_scope, _fence, _command, materialize) => materialize(row, 1)),
    renew: jest.fn().mockResolvedValue(true), claim: jest.fn().mockResolvedValue(fence), cancel: jest.fn(), fail: jest.fn(), expire: jest.fn() };
  const service = new DocumentReadingRuntimeService(authorization as never, actors as never, reader as never, semantics as never, parsing as never, runs as never);
  const context = { ...scope, roles: [] };
  return { original, map, loaded, row, scope, fence, authorization, actors, reader, semantics, parsing, runs, service, context };
}

describe('independent file reading runtime', () => {
  it('admits an exact source without parsing, translation, semantic writes or an activity request', async () => {
    const f = fixture();
    const request = { action: 'READING_BEGIN', documentVersionId: f.scope.documentVersionId,
      parseRunId: f.row.parseRunId, semanticRevision: 1, requestId: 'request-test', expectedRevision: 0 };
    await f.service.run(request);
    expect(f.runs.begin).toHaveBeenCalledWith(f.scope, expect.objectContaining({ semanticRevision: 1, manifestSha256: f.row.manifestSha256 }));
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    f.authorization.authorizeDocumentWork.mockResolvedValueOnce({ ...f.scope, documentVersionId: 'other' });
    await expect(f.service.run(request)).rejects.toThrow('AUTHORIZATION_SCOPE_MISMATCH');
    expect(f.runs.begin).toHaveBeenCalledTimes(1);
  });

  it('reads units outside semantic sections, then saves concise and complete text in one revision', async () => {
    const f = fixture();
    expect(f.map.unassignedUnitIds).toContain('u1');
    const delivery = await f.service.run({ action: 'READING_READ', ...f.fence, offset: 0, limit: 1 });
    if (!('anchors' in delivery)) throw new Error('expected source delivery');
    expect(delivery.range.unitIds).toEqual(['u1']);
    const anchor = delivery.anchors[0];
    const statement = { text: '仅解读已取得的首段，其他部分尚未覆盖。', quotes: [{ anchorId: anchor.anchorId,
      start: 0, end: anchor.sourceText.length, text: anchor.sourceText }] };
    const candidate = { schemaVersion: 'wiselink.document.reading.v1', headline: '原文首段说明', brief: statement,
      explanation: [statement], criticalConditions: [], limitations: ['部分阅读'] };
    const saved = await f.service.run({ action: 'READING_SAVE', ...f.fence, candidate,
      producer: { skillVersion: 'test', modelVersion: 'constructed-not-called' } });
    expect(saved).toMatchObject({ readingRunRef: f.row.runRef, readingRevision: 1,
      brief: statement, readCoverage: { status: 'PARTIAL_DELIVERY', deliveredUnitIds: ['u1'] } });
    expect(saved).not.toHaveProperty('statements');
    expect(f.runs.save).toHaveBeenCalledTimes(1);
  });

  it('rejects changed source and revoked access before recording any delivery', async () => {
    const f = fixture();
    const read = { action: 'READING_READ', ...f.fence, offset: 0, limit: 1 };
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.run(read)).rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.runs.recordDelivery).not.toHaveBeenCalled();
    f.loaded.run.manifestArtifact.sha256 = 'c'.repeat(64);
    await expect(f.service.run(read)).rejects.toThrow('ORIGINAL_CHANGED');
    expect(f.runs.recordDelivery).not.toHaveBeenCalled();
  });

  it('reconciles expired STATUS after source authorization and returns the fresh persisted state', async () => {
    const f = fixture();
    f.runs.readRun.mockResolvedValueOnce(f.row).mockResolvedValueOnce({ ...f.row,
      status: 'EXPIRED', errorCode: 'DOCUMENT_READING_DEADLINE_EXCEEDED' });
    await expect(f.service.run({ action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId,
      runRef: f.row.runRef })).resolves.toMatchObject({ status: 'EXPIRED', errorCode: 'DOCUMENT_READING_DEADLINE_EXCEEDED' });
    expect(f.runs.expire).toHaveBeenCalledWith(f.scope, f.row.runRef);
    expect(f.runs.claim).not.toHaveBeenCalled();
    expect(f.runs.save).not.toHaveBeenCalled();
  });

  it('STATUS preserves a concurrent saved outcome and does not mutate after revoked source access', async () => {
    const f = fixture();
    f.runs.readRun.mockResolvedValueOnce(f.row).mockResolvedValueOnce({ ...f.row, status: 'SAVED', readingRevision: 1 });
    const request = { action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef };
    await expect(f.service.run(request)).resolves.toMatchObject({ status: 'SAVED', readingRevision: 1 });
    f.runs.expire.mockClear();
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.run(request)).rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.runs.expire).not.toHaveBeenCalled();
  });

  it('keeps browser reads pinned to semantic and reading revisions, with no production writes', async () => {
    const f = fixture();
    const request = { documentVersionId: f.scope.documentVersionId, parseRunId: f.row.parseRunId,
      semanticRevision: 1, readingRevision: 9 };
    await expect(f.service.readForBrowser(request, f.context)).resolves.toMatchObject({ reading: null });
    expect(f.runs.readSaved).toHaveBeenCalledWith(f.context, f.row.parseRunId, 1, 9);
    expect(f.actors.withActorScope).not.toHaveBeenCalled();
    expect(f.runs.begin).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    f.semantics.read.mockResolvedValueOnce(null);
    await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('SOURCE_ACCESS_DENIED');
  });
});
