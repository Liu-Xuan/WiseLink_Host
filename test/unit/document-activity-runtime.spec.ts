import { DocumentActivityRuntimeService } from '../../server/modules/canonical-host/document-activity-runtime.service';
import type { DocumentActivityRun } from '../../server/modules/canonical-host/document-activity-run.repository';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

function fixture() {
  const original = originalFixture();
  original.source.units[0].kind = 'heading';
  original.source.units[0].payload = { text: 'Conditions and planned action', level: 1 };
  const map = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
  const artifact = { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'b'.repeat(64), byteLength: 4321 };
  const loaded = { original, structuredSource: original.source, run: { status: 'PUBLISHED', manifestArtifact: artifact, sourceBinding: { familyId: 'family-test' } } };
  const scope = { tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId: original.binding.documentVersionId };
  const row: DocumentActivityRun = { runRef: 'DAR-test', requestId: 'request-test', documentVersionId: scope.documentVersionId,
    parseRunId: original.binding.parseRunId, parseRevision: original.binding.parseRevision, semanticRevision: 1,
    manifestSha256: artifact.sha256, selection: { sectionIds: [map.sections[0].sectionId] }, expectedRevision: 0,
    candidateRevision: null, status: 'RUNNING', deadline: '2026-09-17T00:00:00Z', deliveredRanges: [], result: null, saveCommand: null, errorCode: null };
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
  const service = new DocumentActivityRuntimeService(authorization as never, actors as never, reader as never, semantics as never, parsing as never, runs as never);
  const context = { ...scope, roles: [] };
  return { original, map, loaded, row, scope, fence, authorization, actors, reader, semantics, parsing, runs, service, context };
}

describe('independent source activity runtime', () => {
  it('admits only explicit exact selections without creating semantic data or an assessment', async () => {
    const f = fixture();
    const request = { action: 'ACTIVITY_BEGIN', documentVersionId: f.scope.documentVersionId,
      parseRunId: f.row.parseRunId, semanticRevision: 1, requestId: 'request-test', expectedRevision: 0,
      sectionIds: f.row.selection.sectionIds };
    await expect(f.service.run(request)).resolves.toMatchObject({ runRef: f.row.runRef, expectedRevision: 0 });
    expect(f.runs.begin).toHaveBeenCalledWith(f.scope, expect.objectContaining({ semanticRevision: 1, manifestSha256: f.row.manifestSha256 }));
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    await expect(f.service.run({ ...request, sectionIds: ['missing'] })).rejects.toThrow();
    expect(f.runs.begin).toHaveBeenCalledTimes(1);
  });

  it('records actual delivered anchors and saves exact table quotations without another work object', async () => {
    const f = fixture();
    await f.service.run({ action: 'ACTIVITY_READ', ...f.fence, sectionId: f.row.selection.sectionIds[0], offset: 0, limit: 50 });
    const range = f.row.deliveredRanges[0];
    expect(range.unitIds).toContain('u2');
    expect(range.nextOffset).toBeNull();
    const delivery = await f.service.run({ action: 'ACTIVITY_READ', ...f.fence, sectionId: f.row.selection.sectionIds[0], offset: 0, limit: 50 });
    if (!('anchors' in delivery)) throw new Error('expected source delivery');
    const anchor = delivery.anchors.find(value => value.sourceText === '12 kPa')!;
    expect(anchor.payloadPath).toContain('cells');
    const candidate = { schemaVersion: 'wiselink.document.activity-candidate.v1', statements: [{ statementKey: 'pressure', label: 'Source condition',
      quotes: [{ anchorId: anchor.anchorId, start: 0, end: anchor.sourceText.length, text: anchor.sourceText }], time: null, statusRaw: null, limitations: ['Constructed source only.'] }] };
    const saved = await f.service.run({ action: 'ACTIVITY_SAVE', ...f.fence, candidate, producer: { skillVersion: 'test', modelVersion: 'constructed-not-called' } });
    expect(saved).toMatchObject({ runRef: f.row.runRef, candidateRevision: 1, candidateOnly: true,
      readCoverage: { status: 'DELIVERED_RANGES_ONLY' }, statements: [{ statementId: expect.stringMatching(/^DAS-/u) }] });
    expect(f.runs.save).toHaveBeenCalledTimes(1);
  });

  it('rejects saving without a Host read and never accepts model-provided source bindings', async () => {
    const f = fixture();
    const input = { action: 'ACTIVITY_SAVE', ...f.fence, candidate: { schemaVersion: 'wiselink.document.activity-candidate.v1', statements: [] },
      producer: { skillVersion: 'test', modelVersion: 'test' } };
    await expect(f.service.run(input)).rejects.toThrow('HOST_CONTEXT_INVALID');
    await f.service.run({ action: 'ACTIVITY_READ', ...f.fence, sectionId: f.row.selection.sectionIds[0], offset: 0, limit: 1 });
    await expect(f.service.run({ ...input, candidate: { ...input.candidate, sourceBinding: {} } })).rejects.toThrow('SHAPE_INVALID');
  });

  it('refuses out-of-range pages, source changes and revoked access before recording delivery', async () => {
    const f = fixture();
    const read = { action: 'ACTIVITY_READ', ...f.fence, sectionId: f.row.selection.sectionIds[0], offset: 999, limit: 1 };
    await expect(f.service.run(read)).rejects.toThrow('PAGE_INVALID');
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.run({ ...read, offset: 0 })).rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.runs.recordDelivery).not.toHaveBeenCalled();
    f.loaded.run.manifestArtifact.sha256 = 'c'.repeat(64);
    await expect(f.service.run({ ...read, offset: 0 })).rejects.toThrow('ORIGINAL_CHANGED');
  });

  it('keeps browser reads native, pinned and free of production writes', async () => {
    const f = fixture();
    await expect(f.service.readForBrowser({ documentVersionId: f.scope.documentVersionId, parseRunId: f.row.parseRunId, candidateRevision: 9 }, f.context))
      .resolves.toMatchObject({ familyId: 'family-test', candidate: null });
    expect(f.runs.readSaved).toHaveBeenCalledWith(f.context, f.row.parseRunId, 9);
    expect(f.actors.withActorScope).not.toHaveBeenCalled();
    expect(f.runs.begin).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.readForBrowser({ documentVersionId: f.scope.documentVersionId, parseRunId: f.row.parseRunId }, f.context))
      .rejects.toThrow('SOURCE_ACCESS_DENIED');
  });
});

const controls = ['ACTIVITY_STATUS', 'ACTIVITY_CANCEL', 'ACTIVITY_CLAIM', 'ACTIVITY_HEARTBEAT', 'ACTIVITY_FAIL'];
function controlInput(f: ReturnType<typeof fixture>, action: string) {
 const base = { action, documentVersionId: f.scope.documentVersionId, runRef: f.row.runRef };
 if (action === 'ACTIVITY_HEARTBEAT') return { ...base, ...f.fence };
 if (action === 'ACTIVITY_FAIL') return { ...base, ...f.fence, errorCode: 'TEST_FAILURE' };
 if (action === 'ACTIVITY_CLAIM') return { ...base, leaseOwner: f.fence.leaseOwner };
 return base;
}
it.each(controls)('%s authorizes ordinary source access without loading content, semantics or plans', async action => {
 const f=fixture();
 f.reader.readDocumentOriginal.mockRejectedValue(new Error('STORAGE_UNAVAILABLE'));
 await f.service.run(controlInput(f, action));
 expect(f.authorization.authorizeDocumentWork).toHaveBeenCalledTimes(1);
 expect(f.parsing.status).toHaveBeenCalledWith(f.scope.documentVersionId, f.context);
 expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
 expect(f.semantics.read).not.toHaveBeenCalled();
 expect(f.runs.recordDelivery).not.toHaveBeenCalled(); expect(f.runs.save).not.toHaveBeenCalled();
});
it.each(controls)('%s refuses revoked ordinary source access before control mutation', async action => {
 const f=fixture(); f.parsing.status.mockRejectedValue(new Error('SOURCE_REVOKED'));
 await expect(f.service.run(controlInput(f, action))).rejects.toThrow('SOURCE_REVOKED');
 for (const method of ['cancel','claim','renew','fail','expire'] as const) expect(f.runs[method]).not.toHaveBeenCalled();
 expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
});
it('STATUS reconciles deadline and returns fresh state without overwriting a concurrent saved result', async () => {
 const f=fixture();
 f.runs.readRun.mockResolvedValueOnce(f.row).mockResolvedValueOnce({ ...f.row, status: 'EXPIRED', errorCode: 'DOCUMENT_ACTIVITY_DEADLINE_EXCEEDED' });
 await expect(f.service.run(controlInput(f, 'ACTIVITY_STATUS'))).resolves.toMatchObject({ status: 'EXPIRED' });
 expect(f.runs.expire).toHaveBeenCalledWith(f.scope, f.row.runRef);
 f.runs.readRun.mockResolvedValueOnce(f.row).mockResolvedValueOnce({ ...f.row, status: 'SAVED', candidateRevision: 3 });
 await expect(f.service.run(controlInput(f, 'ACTIVITY_STATUS'))).resolves.toMatchObject({ status: 'SAVED', candidateRevision: 3 });
});
it('READ and SAVE still require the exact original bytes', async () => {
 const f=fixture(); f.reader.readDocumentOriginal.mockRejectedValue(new Error('STORAGE_UNAVAILABLE'));
 await expect(f.service.run({ action: 'ACTIVITY_READ', ...f.fence, sectionId: f.row.selection.sectionIds[0], offset: 0, limit: 1 })).rejects.toThrow('STORAGE_UNAVAILABLE');
 await expect(f.service.run({ action: 'ACTIVITY_SAVE', ...f.fence, candidate: {}, producer: { skillVersion: 'test', modelVersion: 'test' } })).rejects.toThrow('STORAGE_UNAVAILABLE');
 expect(f.runs.recordDelivery).not.toHaveBeenCalled(); expect(f.runs.save).not.toHaveBeenCalled();
});
