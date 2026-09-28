import { documentOriginalReadingCoverage, documentOriginalStructuredSource } from '../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { DocumentWorkRuntimeService } from '../../server/modules/canonical-host/document-work-runtime.service';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { documentDeliveryRequestId } from '../../server/modules/canonical-host/document-delivery-ref';

function fixture() {
  const automaticScope = { workItemId: 'WI', appId: 'app_17bzc551rsg', tenantId: 'tenant', principalId: 'service',
    automaticWorkItemLease: { requestId: 'REQ-one', actorUserId: 'actor', documentId: 'DOC', documentVersionId: 'DV',
      sourceArtifactId: 'ART', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 123, leaseGeneration: 3 } };
  const authorization = { authorizeOpenClawWorkItem: jest.fn().mockResolvedValue(automaticScope), authorizeDocumentWork: jest.fn().mockResolvedValue({
    tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'DV',
  }) };
  const actors = { withActorScope: jest.fn(async (_actor, fn) => fn()) };
  const parsing = {
    status: jest.fn().mockResolvedValue({ latestRun: { parseRunId: 'run', status: 'STAGING' } }),
    executeStep: jest.fn().mockResolvedValue({ parseRunId: 'run', status: 'STAGING' }),
    loadPublished: jest.fn(),
    start: jest.fn().mockResolvedValue({ parseRunId: 'run' }),
    inspectPublishedIdentity: jest.fn().mockResolvedValue({ binding: { sourceArtifactId: 'ART',
      sourceSha256: 'a'.repeat(64), sourceByteLength: 123 } }),
  };
  const fence = { parseRunId: 'run', leaseOwner: 'worker', leaseToken: 'token', leaseGeneration: 2 };
  const leases = { claim: jest.fn().mockResolvedValue(fence), renew: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(true), cancel: jest.fn().mockResolvedValue(true) };
  const reader = { readDocumentOriginal: parsing.loadPublished };
  const semantics = { read: jest.fn().mockResolvedValue(null),
    ensure: jest.fn().mockResolvedValue({ semanticRevision: 1 }) };
  const revisions = { read: jest.fn().mockResolvedValue({}) };
  const deliveryWorkItems = { readDocumentDeliveryIntents: jest.fn().mockResolvedValue([]) };
  const deliveryCatalog = { readDocumentUploadDeliveryIntents: jest.fn().mockResolvedValue([]),
    readOwnedAcquisitionVersionBinding: jest.fn().mockResolvedValue(true),
    readOriginalRegistryIdentity: jest.fn().mockResolvedValue({
      version: { sourceArtifactId: 'ART' }, source: { sha256: 'a'.repeat(64), byteLength: 123 },
    }),
    markDocumentUploadDeliveryAdmitted: jest.fn() };
  const readingRuntime = { run: jest.fn() };
  const translationRuntime = { run: jest.fn() };
  const service = new DocumentWorkRuntimeService(authorization as never, actors as never, parsing as never, leases as never, reader as never, {} as never, semantics as never, revisions as never,
    deliveryWorkItems as never, deliveryCatalog as never,
    readingRuntime as never, translationRuntime as never);
  return { service, authorization, actors, parsing, leases, fence, semantics, revisions, automaticScope,
    deliveryWorkItems, deliveryCatalog, readingRuntime, translationRuntime };
}

describe('authorized document step runtime', () => {
  afterEach(() => jest.useRealTimers());

  it('authorizes both revision sources under one actual actor before delegating the read', async () => {
    const f = fixture();
    const input = { before: { documentVersionId: 'old', parseRunId: 'old-run', semanticRevision: 1 },
      after: { documentVersionId: 'new', parseRunId: 'new-run', semanticRevision: 2 }, roleKey: 'ftd.status' };
    f.authorization.authorizeDocumentWork.mockImplementation(async ({ documentVersionId }) => ({
      tenantId: 'tenant', actorUserId: 'actor', documentVersionId }));
    await f.service.readRevision(input);
    expect(f.authorization.authorizeDocumentWork.mock.calls.map(call => call[0])).toEqual([
      { documentVersionId: 'old', purpose: 'REVISION' },
      { documentVersionId: 'new', purpose: 'REVISION' }]);
    expect(f.revisions.read).toHaveBeenCalledWith(input, { tenantId: 'tenant', actorUserId: 'actor', roles: [] });
    f.authorization.authorizeDocumentWork.mockImplementation(async ({ documentVersionId }) => ({
      tenantId: 'tenant', actorUserId: documentVersionId, documentVersionId }));
    await expect(f.service.readRevision(input)).rejects.toThrow('AUTHORIZATION_SCOPE_MISMATCH');
    expect(f.revisions.read).toHaveBeenCalledTimes(1);
  });

  it('admits a selected upload only after exact acquisition/source readback', async () => {
    const f = fixture();
    const input = { acquisitionId: 'ACQ-one', documentVersionId: 'DV', actorUserId: 'actor' };
    f.deliveryCatalog.readDocumentUploadDeliveryIntents.mockResolvedValue([{
      ...input, delivery: { reading: true, translation: 'NONE' },
    }]);
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'run', status: 'PUBLISHED',
    } });
    f.parsing.loadPublished.mockResolvedValue({ run: { status: 'PUBLISHED' },
      original: { binding: { documentVersionId: 'DV', parseRunId: 'run' } } });
    await expect(f.service.prepareAutomaticUpload(input)).resolves.toMatchObject({
      status: 'ADMITTED', documentVersionId: 'DV', parseRunId: 'run',
    });
    expect(f.deliveryCatalog.readOwnedAcquisitionVersionBinding).toHaveBeenCalledWith(
      expect.objectContaining({ ...input, tenantId: 'tenant' }));
    expect(f.readingRuntime.run).toHaveBeenCalledWith(expect.objectContaining({
      action: 'READING_BEGIN', deliveryRef: 'acquisition:ACQ-one',
      requestId: documentDeliveryRequestId('reading', 'acquisition:ACQ-one'),
    }));
    expect(f.translationRuntime.run).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).toHaveBeenCalledWith(input);
    await f.service.prepareAutomaticUpload(input);
    expect(f.readingRuntime.run.mock.calls[0][0].requestId)
      .toBe(f.readingRuntime.run.mock.calls[1][0].requestId);
    f.deliveryCatalog.readOwnedAcquisitionVersionBinding.mockResolvedValue(false);
    await expect(f.service.prepareAutomaticUpload(input))
      .rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_SOURCE_DENIED');
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).toHaveBeenCalledTimes(2);
  });

  it('asks for separate cancellation authority before touching a document run', async () => {
    const f = fixture();
    f.authorization.authorizeDocumentWork.mockRejectedValue(new Error('DYNAMIC_CANCEL_DENIED'));
    await expect(f.service.run({ action: 'CANCEL', documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('DYNAMIC_CANCEL_DENIED');
    expect(f.authorization.authorizeDocumentWork).toHaveBeenCalledWith({
      documentVersionId: 'DV', deliveryRef: undefined, purpose: 'CANCEL',
    });
    expect(f.parsing.status).not.toHaveBeenCalled();
    expect(f.leases.cancel).not.toHaveBeenCalled();
  });

  it('reads exact published original units with coverage and refuses identity drift', async () => {
    const f = fixture();
    const original = originalFixture();
    original.binding.documentVersionId = 'DV';
    original.binding.parseRunId = 'run';
    const loaded = { original, structuredSource: original.source, run: { parseRunId: 'run',
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'a'.repeat(64),
        byteLength: 1234, mediaType: 'application/json' } } };
    f.parsing.loadPublished.mockResolvedValue(loaded);
    const result = await f.service.readOriginal({ documentVersionId: 'DV', parseRunId: 'run', limit: 1 });
    expect(result.units).toEqual(original.source.units.slice(0, 1));
    expect(result.coverage).toEqual(documentOriginalReadingCoverage(original));
    expect(result.artifact).toEqual({ ref: 'document-original://DV/run', sha256: 'a'.repeat(64), byteLength: 1234, mediaType: 'application/json' });
    expect(f.parsing.loadPublished).toHaveBeenCalledWith('DV', 'run', expect.objectContaining({ actorUserId: 'actor', tenantId: 'tenant' }));
    original.binding.parseRunId = 'new-run';
    await expect(f.service.readOriginal({ documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
  });

  it('requires an exact semantic revision for chapter reads and keeps pagination inside its context', async () => {
    const f = fixture();
    const original = originalFixture();
    Object.assign(original.binding, { documentVersionId: 'DV', parseRunId: 'run' });
    original.source.units[0].kind = 'heading';
    original.source.units[0].payload = { text: 'Conditions', level: 1 };
    const map = buildDocumentSemanticMap({ original, semanticRevision: 2, profile: GENERIC_SEMANTIC_PROFILE });
    const loaded = { original, structuredSource: original.source, run: { parseRunId: 'run',
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'a'.repeat(64), byteLength: 10 } } };
    f.parsing.loadPublished.mockResolvedValue(loaded);
    f.semantics.read.mockResolvedValue(map);
    const input = { documentVersionId: 'DV', parseRunId: 'run', sectionId: map.sections[0].sectionId, limit: 1 };
    await expect(f.service.readOriginal(input)).rejects.toThrow('DOCUMENT_SEMANTIC_EXACT_REVISION_REQUIRED');
    expect(f.semantics.read).not.toHaveBeenCalled();
    const first = await f.service.readOriginal({ ...input, semanticRevision: 2 });
    expect(f.semantics.read).toHaveBeenCalledWith(expect.any(Object), loaded, 2);
    expect(first.semanticMap?.semanticRevision).toBe(2);
    expect(first.nextOffset).toBe(1);
    const second = await f.service.readOriginal({ ...input, semanticRevision: 2, offset: 1 });
    expect(second.units[0].unitId).toBe('u2');
    expect(second.nextOffset).toBeNull();
    expect(second.coverage).toEqual(documentOriginalReadingCoverage(original));
    f.semantics.read.mockRejectedValueOnce(new Error('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND'));
    await expect(f.service.readOriginal({ ...input, semanticRevision: 99 })).rejects.toThrow('DOCUMENT_SEMANTIC_REVISION_NOT_FOUND');
  });

  it('projects actual reading limitations without treating parser diagnostics as unread content', async () => {
    const f = fixture();
    const original = originalFixture();
    Object.assign(original.binding, { documentVersionId: 'DV', parseRunId: 'run' });
    original.coverage.unresolvedRanges.push({ pageIndexes: [0], unitIds: ['u1'], reason: 'STRUCTURE_UNCERTAIN',
      readingImpact: 'DIAGNOSTIC', message: 'Candidate alignment observation; text remains readable.' });
    const map = buildDocumentSemanticMap({ original, semanticRevision: 2, profile: GENERIC_SEMANTIC_PROFILE });
    const loaded = { original, structuredSource: documentOriginalStructuredSource(original, original.binding),
      run: { parseRunId: 'run', manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED',
        sha256: 'a'.repeat(64), byteLength: 10 } } };
    const before = structuredClone(original);
    f.parsing.loadPublished.mockResolvedValue(loaded);
    f.semantics.read.mockResolvedValue(map);
    const reading = await f.service.readOriginal({ documentVersionId: 'DV', parseRunId: 'run' });
    expect(reading.units).toEqual(original.source.units);
    expect(reading.coverage.unresolvedRanges).toHaveLength(2);
    expect(reading.coverage.unresolvedRanges.map(range => range.reason)).toEqual(['STRUCTURE_UNCERTAIN', 'UNREAD']);
    expect(reading.semanticMap?.unresolvedRanges).toEqual(reading.coverage.unresolvedRanges);
    expect(reading.findings.every(finding => finding.readingImpact === 'LIMITATION')).toBe(true);
    expect(JSON.stringify({ coverage: reading.coverage, findings: reading.findings })).not.toContain('Candidate alignment');
    expect(original).toEqual(before);
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
  });

  it('rechecks source permission before leasing and rejects stale run identities', async () => {
    const f = fixture();
    await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'old' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(f.leases.claim).not.toHaveBeenCalled();
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.run({ action: 'CANCEL', documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.leases.cancel).not.toHaveBeenCalled();
    expect(f.actors.withActorScope).toHaveBeenCalledWith('actor', expect.any(Function));
  });

  it('does not execute an already leased step and always releases a failed execution', async () => {
    const f = fixture();
    f.leases.claim.mockResolvedValueOnce(null);
    await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' }))
      .resolves.toEqual({ status: 'BUSY', parseRunId: 'run' });
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
    f.parsing.executeStep.mockRejectedValueOnce(new Error('PLUGIN_FAILED'));
    await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' }))
      .rejects.toThrow('PLUGIN_FAILED');
    expect(f.leases.release).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'actor' }), f.fence);
  });

  it('renews an awaited long step and stops the timer after completion', async () => {
    jest.useFakeTimers();
    const f = fixture();
    let finish!: (result: { parseRunId: string; status: string }) => void;
    f.parsing.executeStep.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const running = f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(f.leases.renew).toHaveBeenCalledTimes(2);
    finish({ parseRunId: 'run', status: 'PUBLISHED' });
    await expect(running).resolves.toMatchObject({ status: 'PUBLISHED' });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(f.leases.renew).toHaveBeenCalledTimes(2);
    expect(f.leases.release).toHaveBeenCalledTimes(1);
  });
});


describe('automatic WorkItem original preparation', () => {
  it('publishes exact original independently, then admits selected work through C136', async () => {
    const f = fixture();
    const original = originalFixture();
    Object.assign(original.binding, { documentVersionId: 'DV', parseRunId: 'run',
      sourceArtifactId: 'ART', sourceSha256: 'a'.repeat(64), sourceByteLength: 123 });
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'run', status: 'PUBLISHED' } });
    f.parsing.loadPublished.mockResolvedValue({ original,
      run: { parseRunId: 'run', status: 'PUBLISHED' } });
    f.deliveryWorkItems.readDocumentDeliveryIntents.mockResolvedValue([{
      workItemId: 'WI', requestId: 'REQ-one', actorUserId: 'actor',
      documentVersionId: 'DV', sourceArtifactId: 'ART', sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 123, delivery: { reading: true, translation: 'NONE' },
    }]);
    f.readingRuntime.run.mockResolvedValue({ runRef: 'DRR-one', status: 'QUEUED' });

    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({ status: 'ORIGINAL_READY' });
    expect(f.readingRuntime.run).not.toHaveBeenCalled();
    await expect(f.service.prepareAutomaticWorkItemDelivery({ workItemId: 'WI', documentVersionId: 'DV',
      actorUserId: 'actor' })).resolves.toMatchObject({ status: 'ADMITTED',
      reading: { runRef: 'DRR-one' }, translation: null });
    expect(f.readingRuntime.run).toHaveBeenCalledWith({ action: 'READING_BEGIN',
      documentVersionId: 'DV', deliveryRef: 'work-item:WI', parseRunId: 'run', semanticRevision: 1,
      requestId: documentDeliveryRequestId('reading', 'work-item:WI'), expectedRevision: 0 });
    expect(f.translationRuntime.run).not.toHaveBeenCalled();
  });

  it('keeps the published JobAid path ready when admission fails, and retries the durable request', async () => {
    const f = fixture();
    const original = originalFixture();
    Object.assign(original.binding, { documentVersionId: 'DV', parseRunId: 'run',
      sourceArtifactId: 'ART', sourceSha256: 'a'.repeat(64), sourceByteLength: 123 });
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'run', status: 'PUBLISHED' } });
    f.parsing.loadPublished.mockResolvedValue({ original,
      run: { parseRunId: 'run', status: 'PUBLISHED' } });
    f.deliveryWorkItems.readDocumentDeliveryIntents.mockResolvedValue([{
      workItemId: 'WI', requestId: 'REQ-one', actorUserId: 'actor', documentVersionId: 'DV',
      sourceArtifactId: 'ART', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 123,
      delivery: { reading: true, translation: 'ZH_FULL' },
    }]);
    f.readingRuntime.run.mockResolvedValue({ runRef: 'DRR-one', status: 'QUEUED' });
    f.translationRuntime.run.mockRejectedValueOnce(new Error('ADMISSION_STORAGE_UNAVAILABLE'))
      .mockResolvedValue({ status: 'QUEUED' });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({ status: 'ORIGINAL_READY' });
    await expect(f.service.prepareAutomaticWorkItemDelivery({ workItemId: 'WI', documentVersionId: 'DV',
      actorUserId: 'actor' })).rejects.toThrow('ADMISSION_STORAGE_UNAVAILABLE');
    await expect(f.service.prepareAutomaticWorkItemDelivery({ workItemId: 'WI', documentVersionId: 'DV',
      actorUserId: 'actor' })).resolves.toMatchObject({ status: 'ADMITTED' });
    expect(f.readingRuntime.run.mock.calls[0][0].requestId)
      .toBe(f.readingRuntime.run.mock.calls[1][0].requestId);
    expect(f.translationRuntime.run.mock.calls[0][0].requestId)
      .toBe(f.translationRuntime.run.mock.calls[1][0].requestId);
  });

  it('reserves one stable parse request under the queue owner and source fence', async () => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: null });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toEqual({
      status: 'ORIGINAL_PREPARING', documentVersionId: 'DV', parseRunId: 'run' });
    expect(f.parsing.start).toHaveBeenCalledWith('DV', { requestId: 'auto-original-REQ-one', expectedPublishedRevision: 0 },
      expect.objectContaining({ actorUserId: 'actor', tenantId: 'tenant', automaticWorkItem: {
        workItemId: 'WI', requestId: 'REQ-one', principalId: 'service', documentId: 'DOC', sourceArtifactId: 'ART',
        sourceFileSha256: 'a'.repeat(64), sourceByteLength: 123, leaseGeneration: 3 } }));
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
    expect(f.authorization.authorizeDocumentWork).not.toHaveBeenCalled();
  });

  it('continues the same checkpoint with the new queue generation and bounded document lease', async () => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'run', status: 'STAGING', deadlineAt: new Date(Date.now() + 60_000).toISOString(), errorCode: null } });
    f.parsing.executeStep.mockResolvedValue({ parseRunId: 'run', status: 'PUBLISHED' });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({ status: 'ORIGINAL_READY', parseRunId: 'run' });
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.parsing.executeStep).toHaveBeenCalledTimes(1);
    expect(f.parsing.executeStep).toHaveBeenCalledWith('run', expect.objectContaining({
      automaticWorkItem: expect.objectContaining({ leaseGeneration: 3 }) }), f.fence);
  });

  it('reenters one verified local worker candidate after a transient parse storage failure', async () => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'run', status: 'STAGING', executionMode: 'LOCAL_MINERU_WORKER',
      errorCode: 'DOCUMENT_PARSE_FAILED', verifiedArtifacts: 1, waitingForLocalWorker: false,
      deadlineAt: new Date(Date.now() + 60_000).toISOString() } });
    f.parsing.executeStep.mockResolvedValue({ parseRunId: 'run', status: 'PUBLISHED' });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({
      status: 'ORIGINAL_READY', parseRunId: 'run' });
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.parsing.executeStep).toHaveBeenCalledTimes(1);
  });

  it.each([
    { executionMode: 'OFFICIAL_PLUGIN', verifiedArtifacts: 1, waitingForLocalWorker: false },
    { executionMode: 'LOCAL_MINERU_WORKER', verifiedArtifacts: 0, waitingForLocalWorker: true },
  ])('does not retry an unverified or non-worker parse failure: %j', async fields => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'run', status: 'STAGING', errorCode: 'DOCUMENT_PARSE_FAILED',
      deadlineAt: new Date(Date.now() + 60_000).toISOString(), ...fields } });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({ status: 'REQUIRES_ATTENTION' });
    expect(f.leases.claim).not.toHaveBeenCalled();
  });

  it('reuses exact published original without parsing and rejects mismatched source', async () => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: { parseRunId: 'run', status: 'PUBLISHED' } });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({ status: 'ORIGINAL_READY' });
    f.parsing.inspectPublishedIdentity.mockResolvedValue({ binding: { sourceArtifactId: 'wrong' } });
    await expect(f.service.prepareAutomaticOriginal('WI')).rejects.toThrow('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'FAILED', errorCode: 'DOCUMENT_PARSE_INTERRUPTED', deadlineAt: '2030-01-01T00:00:00Z' },
    { status: 'STAGING', errorCode: 'PLUGIN_TIMEOUT' },
    { status: 'STAGING', errorCode: 'HOSTED_MODEL_QUOTA_EXHAUSTED', deadlineAt: '2000-01-01T00:00:00Z' },
    { status: 'STAGING', errorCode: 'DOCUMENT_PARSE_FAILED', deadlineAt: '2000-01-01T00:00:00Z' },
  ])('preserves failed or interrupted results without creating a replacement: %j', async run => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: { parseRunId: 'run', ...run } });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({ status: 'REQUIRES_ATTENTION', parseRunId: 'run' });
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.leases.claim).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'STAGING', errorCode: null },
    { status: 'FAILED', errorCode: 'DOCUMENT_PARSE_INTERRUPTED' },
  ])('reserves a stable successor for an expired interrupted attempt: %j', async run => {
    const f = fixture();
    const predecessor = 'PRUN-00000000-0000-0000-0000-000000000001';
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', publishedRun: { parseRevision: 2 },
      latestRun: { parseRunId: predecessor, deadlineAt: '2000-01-01T00:00:00Z', ...run } });
    f.parsing.start.mockResolvedValue({ parseRunId: 'successor' });
    await expect(f.service.prepareAutomaticOriginal('WI')).resolves.toMatchObject({
      status: 'ORIGINAL_PREPARING', parseRunId: 'successor' });
    await f.service.prepareAutomaticOriginal('WI');
    expect(f.parsing.start).toHaveBeenCalledTimes(2);
    expect(f.parsing.start).toHaveBeenLastCalledWith('DV', {
      requestId: `parse-resume-${predecessor}`, expectedPublishedRevision: 2,
    }, expect.objectContaining({ automaticWorkItem: expect.objectContaining({ leaseGeneration: 3 }) }));
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
    expect(f.leases.claim).not.toHaveBeenCalled();
  });

  it('preserves a locked recovery rejection without executing the old attempt', async () => {
    const f = fixture();
    f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'PRUN-00000000-0000-0000-0000-000000000002', status: 'STAGING',
      deadlineAt: '2000-01-01T00:00:00Z', errorCode: null } });
    f.parsing.start.mockRejectedValue(new Error('DOCUMENT_PARSE_RECOVERY_NOT_ELIGIBLE'));
    await expect(f.service.prepareAutomaticOriginal('WI')).rejects.toThrow('DOCUMENT_PARSE_RECOVERY_NOT_ELIGIBLE');
    expect(f.parsing.executeStep).not.toHaveBeenCalled();
  });

  it('rejects static scope, a different WorkItem and revoked authorization before writes', async () => {
    const f = fixture();
    f.authorization.authorizeOpenClawWorkItem.mockResolvedValueOnce({ ...f.automaticScope, automaticWorkItemLease: undefined });
    await expect(f.service.prepareAutomaticOriginal('WI')).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REQUIRED');
    await expect(f.service.prepareAutomaticOriginal('OTHER')).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REQUIRED');
    f.authorization.authorizeOpenClawWorkItem.mockRejectedValueOnce(new Error('SOURCE_REVOKED'));
    await expect(f.service.prepareAutomaticOriginal('WI')).rejects.toThrow('SOURCE_REVOKED');
    expect(f.parsing.status).not.toHaveBeenCalled();
    expect(f.parsing.start).not.toHaveBeenCalled();
  });
});


it('preserves both a published result and the original step failure if lease cleanup fails', async () => {
  const f = fixture();
  f.leases.release.mockRejectedValue(new Error('CLEANUP_FAILED'));
  f.parsing.executeStep.mockResolvedValueOnce({ status: 'PUBLISHED', parseRunId: 'run' });
  await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' }))
    .resolves.toMatchObject({ status: 'PUBLISHED' });
  f.parsing.executeStep.mockRejectedValueOnce(new Error('ORIGINAL_PLUGIN_FAILURE'));
  await expect(f.service.run({ action: 'STEP', documentVersionId: 'DV', parseRunId: 'run' }))
    .rejects.toThrow('ORIGINAL_PLUGIN_FAILURE');
});


it('automatic preparation leaves a waiting local worker run available for its dedicated claim', async () => {
  const f = fixture();
  f.parsing.status.mockResolvedValue({ documentVersionId: 'DV', latestRun: { parseRunId: 'run', status: 'STAGING',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(), waitingForLocalWorker: true } });
  expect(await f.service.prepareAutomaticOriginal('WI')).toMatchObject({ status: 'ORIGINAL_PREPARING', waitingForLocalWorker: true });
  expect(f.leases.claim).not.toHaveBeenCalled(); expect(f.parsing.executeStep).not.toHaveBeenCalled();
});
