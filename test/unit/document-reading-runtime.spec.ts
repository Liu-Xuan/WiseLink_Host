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
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue(loaded),
    readSourcePackage: jest.fn(), readAllSourceUnits: jest.fn(), inspectSourcePackage: jest.fn(),
    readStructuredSource: jest.fn(), readback: jest.fn(), persistAndReadback: jest.fn() };
  const semantics = { read: jest.fn().mockResolvedValue(map), ensure: jest.fn(), readReady: jest.fn().mockResolvedValue({ semanticRevision: 1 }) };
  const parsing = { status: jest.fn().mockResolvedValue({}), inspectPublishedIdentity: jest.fn().mockResolvedValue({ familyId: 'family-test', binding: original.binding }) };
  const runs = { begin: jest.fn().mockResolvedValue(row), readRun: jest.fn().mockResolvedValue(row),
    readSavedState: jest.fn().mockResolvedValue({ status: 'NOT_GENERATED', reading: null }),
    readRetraction: jest.fn().mockResolvedValue(null), retract: jest.fn(),
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

  it('does not re-expose a retracted saved result when the original BEGIN request is replayed', async () => {
    const f = fixture();
    f.runs.begin.mockResolvedValue({ ...f.row, status: 'SAVED', readingRevision: 1,
      result: { headline: '错误候选' } });
    f.runs.readRetraction.mockResolvedValue({ runRef: f.row.runRef, readingRevision: 1,
      requestId: 'review-1', reasonCode: 'SOURCE_SEMANTIC_CONTRADICTION',
      reviewReference: 'independent-review', retractedAt: '2026-09-24T00:00:00Z' });
    await expect(f.service.run({ action: 'READING_BEGIN', documentVersionId: f.scope.documentVersionId,
      parseRunId: f.row.parseRunId, semanticRevision: 1, requestId: f.row.requestId,
      expectedRevision: 0 })).resolves.toMatchObject({ status: 'RETRACTED', result: null,
        readingRevision: 1 });
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

  it('control actions never take the original-bytes path under any name', async () => {
    const f = fixture();
    const control = [
      { action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef },
      { action: 'READING_CANCEL', documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef },
      { action: 'READING_CLAIM', documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef, leaseOwner: 'other-producer' },
      { action: 'READING_HEARTBEAT', ...f.fence },
      { action: 'READING_FAIL', ...f.fence, errorCode: 'TEST_FAILURE' },
    ];
    for (const request of control) await f.service.run(request);
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    for (const method of [f.reader.readSourcePackage, f.reader.readAllSourceUnits, f.reader.inspectSourcePackage,
      f.reader.readStructuredSource, f.reader.readback, f.reader.persistAndReadback])
      expect(method).not.toHaveBeenCalled();
    expect(f.semantics.read).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
  });

  it('control actions keep their admission rules without content access or unwanted writes', async () => {
    const f1 = fixture();
    f1.authorization.authorizeDocumentWork.mockRejectedValueOnce(new Error('DOCUMENT_WORK_NOT_AUTHORIZED'));
    await expect(f1.service.run({ action: 'READING_CANCEL', documentVersionId: f1.scope.documentVersionId,
      runRef: f1.row.runRef })).rejects.toThrow('DOCUMENT_WORK_NOT_AUTHORIZED');
    expect(f1.runs.cancel).not.toHaveBeenCalled();
    const f2 = fixture();
    f2.authorization.authorizeDocumentWork.mockResolvedValueOnce({ ...f2.scope, documentVersionId: 'other' });
    await expect(f2.service.run({ action: 'READING_HEARTBEAT', ...f2.fence })).rejects.toThrow('AUTHORIZATION_SCOPE_MISMATCH');
    expect(f2.runs.renew).not.toHaveBeenCalled();
    const f3 = fixture();
    f3.runs.readRun.mockResolvedValueOnce(null);
    await expect(f3.service.run({ action: 'READING_STATUS', documentVersionId: f3.scope.documentVersionId,
      runRef: f3.row.runRef })).rejects.toThrow('DOCUMENT_READING_RUN_NOT_FOUND');
    expect(f3.reader.readDocumentOriginal).not.toHaveBeenCalled();
    const f4 = fixture();
    f4.runs.renew.mockResolvedValueOnce(false);
    await expect(f4.service.run({ action: 'READING_HEARTBEAT', ...f4.fence })).rejects.toThrow('DOCUMENT_READING_LEASE_REJECTED');
    const f5 = fixture();
    f5.runs.claim.mockRejectedValueOnce(new Error('DOCUMENT_READING_LEASE_REJECTED'));
    await expect(f5.service.run({ action: 'READING_CLAIM', documentVersionId: f5.scope.documentVersionId,
      runRef: f5.row.runRef, leaseOwner: 'other-producer' })).rejects.toThrow('DOCUMENT_READING_LEASE_REJECTED');
    expect(f5.runs.recordDelivery).not.toHaveBeenCalled();
    expect(f5.runs.save).not.toHaveBeenCalled();
  });

  it('control completions survive an unavailable file service while content paths surface the real error', async () => {
    const f = fixture();
    f.reader.readDocumentOriginal.mockRejectedValue(new Error('FILE_SERVICE_UNAVAILABLE'));
    await expect(f.service.run({ action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId,
      runRef: f.row.runRef })).resolves.toMatchObject({ status: 'RUNNING' });
    f.runs.readRun.mockResolvedValue({ ...f.row, status: 'CANCELLED' });
    await expect(f.service.run({ action: 'READING_CANCEL', documentVersionId: f.scope.documentVersionId,
      runRef: f.row.runRef })).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(f.service.run({ action: 'READING_FAIL', ...f.fence,
      errorCode: 'TEST_FAILURE' })).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(f.service.run({ action: 'READING_READ', ...f.fence, offset: 0, limit: 1 }))
      .rejects.toThrow('FILE_SERVICE_UNAVAILABLE');
    expect(f.runs.recordDelivery).not.toHaveBeenCalled();
    await expect(f.service.run({ action: 'READING_SAVE', ...f.fence, candidate: {},
      producer: { skillVersion: 'test', modelVersion: 'test' } }))
      .rejects.toThrow('FILE_SERVICE_UNAVAILABLE');
    expect(f.runs.save).not.toHaveBeenCalled();
  });

  it('content paths still detect semantic or binding drift on the exact registered version', async () => {
    const f = fixture();
    f.semantics.read.mockResolvedValueOnce(null);
    await expect(f.service.run({ action: 'READING_READ', ...f.fence, offset: 0, limit: 1 }))
      .rejects.toThrow('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    f.loaded.original.binding.parseRevision = f.original.binding.parseRevision + 1;
    await expect(f.service.run({ action: 'READING_READ', ...f.fence, offset: 0, limit: 1 }))
      .rejects.toThrow('DOCUMENT_READING_ORIGINAL_CHANGED');
    expect(f.runs.recordDelivery).not.toHaveBeenCalled();
    expect(f.runs.save).not.toHaveBeenCalled();
  });

  it('a newly published version does not rebind a historical run', async () => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ publishedRun: { parseRunId: 'PR-NEW', manifestSha256: 'd'.repeat(64) } });
    const status = await f.service.run({ action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId,
      runRef: f.row.runRef });
    expect(status).toMatchObject({ parseRunId: f.row.parseRunId });
    const delivery = await f.service.run({ action: 'READING_READ', ...f.fence, offset: 0, limit: 1 });
    if (!('anchors' in delivery)) throw new Error('expected source delivery');
    expect(f.reader.readDocumentOriginal.mock.calls.every(call => call[1] === f.row.parseRunId)).toBe(true);
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledTimes(1);
  });

  it('counts controlled full-text reads per action class', async () => {
    const f = fixture();
    await f.service.run({ action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef });
    await f.service.run({ action: 'READING_HEARTBEAT', ...f.fence });
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledTimes(0);
    expect(f.semantics.read).toHaveBeenCalledTimes(0);
    const delivery = await f.service.run({ action: 'READING_READ', ...f.fence, offset: 0, limit: 1 });
    if (!('anchors' in delivery)) throw new Error('expected source delivery');
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledTimes(1);
    expect(f.semantics.read).toHaveBeenCalledTimes(1);
    const anchor = delivery.anchors[0];
    const statement = { text: '控制动作计数验证。', quotes: [{ anchorId: anchor.anchorId,
      start: 0, end: anchor.sourceText.length, text: anchor.sourceText }] };
    const candidate = { schemaVersion: 'wiselink.document.reading.v1', headline: '计数验证', brief: statement,
      explanation: [statement], criticalConditions: [], limitations: ['部分阅读'] };
    await f.service.run({ action: 'READING_SAVE', ...f.fence, candidate,
      producer: { skillVersion: 'test', modelVersion: 'constructed-not-called' } });
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledTimes(2);
  });

  it('keeps browser reads pinned to semantic and reading revisions, with no production writes', async () => {
    const f = fixture();
    const request = { documentVersionId: f.scope.documentVersionId, parseRunId: f.row.parseRunId,
      semanticRevision: 1, readingRevision: 9 };
    await expect(f.service.readForBrowser(request, f.context)).resolves.toMatchObject({ reading: null });
    expect(f.runs.readSavedState).toHaveBeenCalledWith(f.context, f.row.parseRunId, 1, 9);
    f.runs.readSavedState.mockResolvedValueOnce({ status: 'RETRACTED', reading: null });
    await expect(f.service.readForBrowser(request, f.context)).resolves.toMatchObject({
      status: 'RETRACTED', reading: null,
    });
    expect(f.actors.withActorScope).not.toHaveBeenCalled();
    expect(f.runs.begin).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    f.semantics.readReady.mockResolvedValueOnce(null);
    await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('SOURCE_ACCESS_DENIED');
  });

  it('retracts only after source authorization and reports the effective state without serving the saved text', async () => {
    const f = fixture();
    const saved = { ...f.row, status: 'SAVED' as const, readingRevision: 1,
      result: { headline: '错误候选' } as DocumentReadingRun['result'] };
    const retraction = { runRef: saved.runRef, readingRevision: 1, requestId: 'review-1',
      reasonCode: 'SOURCE_SEMANTIC_CONTRADICTION', reviewReference: 'independent-review',
      retractedAt: '2026-09-24T00:00:00Z' };
    f.runs.readRun.mockResolvedValue(saved);
    f.runs.retract.mockResolvedValue(retraction);
    const request = { action: 'READING_RETRACT', documentVersionId: f.scope.documentVersionId,
      runRef: saved.runRef, expectedReadingRevision: 1, requestId: 'review-1',
      reasonCode: retraction.reasonCode, reviewReference: retraction.reviewReference };
    await expect(f.service.run(request)).resolves.toMatchObject({ status: 'RETRACTED', result: null,
      readingRevision: 1, retraction });
    expect(f.runs.retract).toHaveBeenCalledWith(f.scope, expect.objectContaining({ runRef: saved.runRef,
      expectedReadingRevision: 1 }));
    f.runs.readRetraction.mockResolvedValue(retraction);
    await expect(f.service.run({ action: 'READING_STATUS', documentVersionId: f.scope.documentVersionId,
      runRef: saved.runRef })).resolves.toMatchObject({ status: 'RETRACTED', result: null });
    await expect(f.service.run({ action: 'READING_SAVE', ...f.fence,
      candidate: {}, producer: { skillVersion: 'fixture', modelVersion: 'fixture' } }))
      .rejects.toThrow('DOCUMENT_READING_RETRACTED');
    expect(f.runs.save).not.toHaveBeenCalled();
    f.runs.readRetraction.mockResolvedValue(null);
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.run(request)).rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.runs.retract).toHaveBeenCalledTimes(1);
  });
});

it.each(['READING_CANCEL','READING_CLAIM','READING_HEARTBEAT','READING_FAIL'])('%s requires ordinary source authorization beyond the service allowlist', async action => {
 const f=fixture(); f.parsing.status.mockRejectedValue(new Error('SOURCE_REVOKED'));
 const base={ action, documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef };
 const input=action==='READING_HEARTBEAT' ? { ...base, ...f.fence }
  : action==='READING_FAIL' ? { ...base, ...f.fence, errorCode: 'TEST_FAILURE' }
  : action==='READING_CLAIM' ? { ...base, leaseOwner: f.fence.leaseOwner } : base;
 await expect(f.service.run(input)).rejects.toThrow('SOURCE_REVOKED');
 for (const method of ['cancel','claim','renew','fail','expire'] as const) expect(f.runs[method]).not.toHaveBeenCalled();
 expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
});

it('returns the complete saved browser result with fresh exact identities and zero content hydration', async () => {
 const f=fixture();
 f.reader.readDocumentOriginal.mockRejectedValue(new Error('STORAGE_UNAVAILABLE'));
 const result = { sourceBinding: { original: f.original.binding, semanticRevision: 1 },
  readingRevision: 9, explanation: [{ text: '完整已保存正文'.repeat(5000) }] };
 f.runs.readSavedState.mockResolvedValue({ status: 'AVAILABLE', reading: result } as never);
 const request = { documentVersionId: f.scope.documentVersionId, parseRunId: f.row.parseRunId, semanticRevision: 1, readingRevision: 9 };
 const response = await f.service.readForBrowser(request, f.context);
 expect(response.reading).toBe(result);
 expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled(); expect(f.semantics.read).not.toHaveBeenCalled();
 expect(f.parsing.inspectPublishedIdentity).toHaveBeenCalledWith(request.documentVersionId, request.parseRunId, f.context);
 expect(f.semantics.readReady).toHaveBeenCalledWith(f.context, request.parseRunId, 1);
 f.runs.readSavedState.mockResolvedValue({ status: 'AVAILABLE', reading: { ...result,
   sourceBinding: { ...result.sourceBinding, original: { ...f.original.binding, parseRunId: 'other' } } } } as never);
 await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('BINDING_MISMATCH');
 f.runs.readSavedState.mockResolvedValue({ status: 'AVAILABLE', reading: result } as never);
 f.semantics.readReady.mockResolvedValueOnce(null);
 await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('SEMANTIC_REVISION_NOT_FOUND');
 f.parsing.inspectPublishedIdentity.mockRejectedValueOnce(new Error('SOURCE_REVOKED'));
 await expect(f.service.readForBrowser(request, f.context)).rejects.toThrow('SOURCE_REVOKED');
});
