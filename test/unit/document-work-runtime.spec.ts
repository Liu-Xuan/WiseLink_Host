import { documentOriginalReadingCoverage, documentOriginalStructuredSource } from '../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { DocumentWorkRuntimeService } from '../../server/modules/canonical-host/document-work-runtime.service';
import { buildDocumentSemanticMap } from '../../server/modules/document-management/src/hosted/nest/document-semantic-map';
import { GENERIC_SEMANTIC_PROFILE } from '../../server/modules/document-management/src/hosted/nest/document-semantic-profile';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { documentDeliveryRequestId } from '../../server/modules/canonical-host/document-delivery-ref';
import { DocumentReadingRuntimeService } from '../../server/modules/canonical-host/document-reading-runtime.service';
import { DocumentReadingRunRepository, type DocumentReadingRun } from '../../server/modules/canonical-host/document-reading-run.repository';

function uploadReadingReplayFixture(provideReadingRuns: boolean = true) {
  const input = { acquisitionId: 'ACQ-one', documentVersionId: 'DV', actorUserId: 'actor' };
  const deliveryRef = `acquisition:${input.acquisitionId}`;
  const scope = { tenantId: 'tenant', actorUserId: input.actorUserId, documentVersionId: input.documentVersionId };
  const original = originalFixture();
  Object.assign(original.binding, { documentVersionId: 'DV', parseRunId: 'parse-one', parseRevision: 1,
    sourceArtifactId: 'ART', sourceSha256: 'a'.repeat(64), sourceByteLength: 123 });
  const newer = { ...original, binding: { ...original.binding, parseRunId: 'parse-two', parseRevision: 2 } };
  const row: DocumentReadingRun = { runRef: 'DRR-one', requestId: documentDeliveryRequestId('reading', deliveryRef),
    documentVersionId: 'DV', parseRunId: 'parse-one', parseRevision: 1, semanticRevision: 1,
    manifestSha256: 'f'.repeat(64), expectedRevision: 0, readingRevision: 1, status: 'SAVED',
    deadline: '2030-01-01T00:00:00Z', deliveredRanges: [], saveCommand: null, errorCode: null,
    result: { schemaVersion: 'wiselink.document.reading.v1', readingRunRef: 'DRR-one', readingRevision: 1,
      candidateOnly: true, headline: 'Original accepted reading', brief: { text: 'Original reading', quotes: [] },
      explanation: [], criticalConditions: [], limitations: [],
      sourceBinding: { original: original.binding, semanticRevision: 1 },
      readCoverage: { status: 'PARTIAL_DELIVERY', deliveredUnitIds: [], totalUnitCount: original.source.units.length,
        sourceCoverage: documentOriginalReadingCoverage(original) }, sourceAnchors: [],
      producer: { skillVersion: 'test', modelVersion: 'stored-model' }, savedAt: '2026-10-17T00:00:00Z' } };
  const authorization = { authorizeDocumentWork: jest.fn().mockResolvedValue(scope) };
  const actors = { withActorScope: jest.fn(async (_actor: string, fn: () => Promise<unknown>) => fn()) };
  const loaded = (parseRunId: string) => {
    const source = parseRunId === row.parseRunId ? original : newer;
    return { original: source, structuredSource: source.source, run: { parseRunId, status: 'PUBLISHED',
      manifestArtifact: { relativePath: 'original/manifest.json', readback: 'VERIFIED',
        sha256: parseRunId === row.parseRunId ? row.manifestSha256 : 'b'.repeat(64), byteLength: 4321 } } };
  };
  const parsing = { status: jest.fn().mockResolvedValue({ documentVersionId: 'DV',
    latestRun: { parseRunId: 'parse-two', status: 'PUBLISHED', parseRevision: 2 } }),
    start: jest.fn(), loadPublished: jest.fn(async (_documentVersionId: string, parseRunId: string) => loaded(parseRunId)),
    inspectPublishedIdentity: jest.fn(async (_documentVersionId: string, parseRunId: string) => ({
      familyId: 'family', binding: loaded(parseRunId).original.binding })) };
  const reader = { readDocumentOriginal: parsing.loadPublished };
  const semantics = { ensure: jest.fn().mockResolvedValue({ semanticRevision: 1 }),
    read: jest.fn().mockResolvedValue({ semanticRevision: 1 }) };
  const deliveryCatalog = { readDocumentUploadDeliveryIntents: jest.fn().mockResolvedValue([
    { ...input, delivery: { reading: true, translation: 'NONE' } }]),
    readOwnedAcquisitionVersionBinding: jest.fn().mockResolvedValue(true),
    readOriginalRegistryIdentity: jest.fn().mockResolvedValue({
      version: { sourceArtifactId: 'ART' }, source: { sha256: 'a'.repeat(64), byteLength: 123 } }),
    markDocumentUploadDeliveryAdmitted: jest.fn() };
  // Exercise the real BEGIN conflict guard. Only database I/O is replaced:
  // its transaction finds the previously accepted request for parse-one.
  const transactionExecute = jest.fn().mockImplementation(async () => [row]);
  const database = { transaction: jest.fn(async (fn: (tx: { execute: typeof transactionExecute }) => Promise<unknown>) =>
    fn({ execute: transactionExecute })) };
  const runs = new DocumentReadingRunRepository(database as never);
  const readRequest = jest.spyOn(runs, 'readRequest').mockImplementation(async () => row);
  const begin = jest.spyOn(runs, 'begin');
  const readRun = jest.spyOn(runs, 'readRun').mockImplementation(async () => row);
  const currentRevision = jest.spyOn(runs, 'currentRevision').mockResolvedValue(0);
  const expire = jest.spyOn(runs, 'expire').mockResolvedValue(undefined);
  const readRetraction = jest.spyOn(runs, 'readRetraction').mockResolvedValue(null);
  const selection = { modelRef: 'minimax/MiniMax-M2.5', displayName: 'Stored selection',
    providerKind: 'BUILT_IN' as const, settingsRevision: 3, selectedAt: '2026-10-17T00:00:00Z' };
  row.executionModel = selection;
  const modelSettings = { captureForNewTask: jest.fn().mockResolvedValue(selection) };
  const readingRuntime = new DocumentReadingRuntimeService(authorization as never, actors as never,
    reader as never, semantics as never, parsing as never, runs, modelSettings as never);
  const readingRun = jest.spyOn(readingRuntime, 'run');
  const translationRuntime = { run: jest.fn().mockResolvedValue({ status: 'QUEUED' }) };
  const service = new DocumentWorkRuntimeService(authorization as never, actors as never,
    parsing as never, {} as never, reader as never, {} as never, semantics as never, {} as never,
    {} as never, deliveryCatalog as never, readingRuntime, translationRuntime as never, undefined,
    provideReadingRuns ? runs : undefined);
  return { service, input, deliveryRef, scope, row, original, newer, authorization, actors, parsing,
    reader, semantics, deliveryCatalog, runs, readRequest, begin, readRun, expire, readRetraction,
    readingRun, translationRuntime, database, transactionExecute, currentRevision, modelSettings };
}

describe('automatic upload reading admission replay', () => {
  it('resumes the accepted saved reading from parse-one after parse-two is published', async () => {
    const f = uploadReadingReplayFixture();
    await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toEqual({
      status: 'ADMITTED', documentVersionId: 'DV', parseRunId: 'parse-one' });
    expect(f.readingRun).toHaveBeenCalledTimes(1);
    expect(f.readingRun).toHaveBeenCalledWith({ action: 'READING_STATUS', documentVersionId: 'DV',
      runRef: f.row.runRef, deliveryRef: f.deliveryRef });
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.parsing.inspectPublishedIdentity).toHaveBeenCalledWith('DV', 'parse-one', { ...f.scope, roles: [] });
    expect(f.readRequest).toHaveBeenCalledWith({ ...f.scope, roles: [] }, f.row.requestId);
    expect(f.modelSettings.captureForNewTask).not.toHaveBeenCalled();
    expect(f.currentRevision).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).toHaveBeenCalledWith(f.input);
  });

  it.each(['QUEUED', 'RUNNING'] as const)('resumes an accepted %s reading without admitting another run', async status => {
    const f = uploadReadingReplayFixture();
    Object.assign(f.row, { status, readingRevision: null, result: null });
    await f.service.prepareAutomaticUpload(f.input);
    await f.service.prepareAutomaticUpload(f.input);
    expect(f.readingRun.mock.calls.map(([command]) => command)).toEqual([
      { action: 'READING_STATUS', documentVersionId: 'DV', runRef: 'DRR-one', deliveryRef: f.deliveryRef },
      { action: 'READING_STATUS', documentVersionId: 'DV', runRef: 'DRR-one', deliveryRef: f.deliveryRef }]);
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    expect(f.modelSettings.captureForNewTask).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).toHaveBeenCalledTimes(2);
  });

  it.each(['FAILED', 'CANCELLED', 'EXPIRED'] as const)('requires attention for an accepted %s reading', async status => {
    const f = uploadReadingReplayFixture();
    Object.assign(f.row, { status, readingRevision: null, result: null });
    await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toEqual({
      status: 'REQUIRES_ATTENTION', documentVersionId: 'DV', parseRunId: 'parse-one',
      errorCode: `DOCUMENT_READING_${status}` });
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.semantics.ensure).not.toHaveBeenCalled();
    expect(f.translationRuntime.run).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it('uses the live STATUS outcome when a running reading expires during replay', async () => {
    const f = uploadReadingReplayFixture();
    Object.assign(f.row, { status: 'RUNNING', readingRevision: null, result: null });
    f.expire.mockImplementationOnce(async () => {
      f.row.status = 'EXPIRED';
      f.row.errorCode = 'DOCUMENT_READING_DEADLINE_EXCEEDED';
    });
    await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toEqual({
      status: 'REQUIRES_ATTENTION', documentVersionId: 'DV', parseRunId: 'parse-one',
      errorCode: 'DOCUMENT_READING_DEADLINE_EXCEEDED' });
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it('requires attention for a retracted saved reading without admitting another reading', async () => {
    const f = uploadReadingReplayFixture();
    f.readRetraction.mockResolvedValue({ runRef: f.row.runRef, readingRevision: 1,
      requestId: 'review-one', reasonCode: 'SOURCE_ERROR', reviewReference: 'independent-review',
      retractedAt: '2026-10-18T00:00:00Z' });
    await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toEqual({
      status: 'REQUIRES_ATTENTION', documentVersionId: 'DV', parseRunId: 'parse-one',
      errorCode: 'DOCUMENT_READING_RETRACTED' });
    expect(await f.readingRun.mock.results[0].value).toMatchObject({ status: 'RETRACTED', result: null });
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.translationRuntime.run).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'CANCELLED', 'EXPIRED', 'RETRACTED'] as const)(
    'keeps independently selected translation admitted when the reading is %s', async status => {
      const f = uploadReadingReplayFixture();
      f.deliveryCatalog.readDocumentUploadDeliveryIntents.mockResolvedValue([
        { ...f.input, delivery: { reading: true, translation: 'ZH_FULL' } }]);
      if (status === 'RETRACTED') f.readRetraction.mockResolvedValue({ runRef: f.row.runRef,
        readingRevision: 1, requestId: 'review-one', reasonCode: 'SOURCE_ERROR',
        reviewReference: 'independent-review', retractedAt: '2026-10-18T00:00:00Z' });
      else Object.assign(f.row, { status, readingRevision: null, result: null });
      await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toEqual({
        status: 'ADMITTED', documentVersionId: 'DV', parseRunId: 'parse-one' });
      expect(await f.readingRun.mock.results[0].value).toMatchObject({ status });
      expect(f.translationRuntime.run).toHaveBeenCalledWith({ action: 'START', documentVersionId: 'DV',
        parseRunId: 'parse-one', deliveryRef: f.deliveryRef,
        requestId: documentDeliveryRequestId('translation', f.deliveryRef) });
      expect(f.begin).not.toHaveBeenCalled();
      expect(f.parsing.start).not.toHaveBeenCalled();
      expect(f.semantics.ensure).not.toHaveBeenCalled();
      expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).toHaveBeenCalledWith(f.input);
    });

  it('fails explicitly before BEGIN when selected reading has no request repository', async () => {
    const f = uploadReadingReplayFixture(false);
    await expect(f.service.prepareAutomaticUpload(f.input))
      .rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_READING_REPOSITORY_UNAVAILABLE');
    expect(f.readRequest).not.toHaveBeenCalled();
    expect(f.parsing.status).not.toHaveBeenCalled();
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.readingRun).not.toHaveBeenCalled();
    expect(f.translationRuntime.run).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it.each([{ documentVersionId: 'other' }, { requestId: 'other' }])(
    'rejects a request row outside the exact upload binding: %j', async change => {
      const f = uploadReadingReplayFixture();
      Object.assign(f.row, change);
      await expect(f.service.prepareAutomaticUpload(f.input))
        .rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_READING_SCOPE_MISMATCH');
      expect(f.parsing.inspectPublishedIdentity).not.toHaveBeenCalled();
      expect(f.readingRun).not.toHaveBeenCalled();
      expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    });

  it('rechecks SOURCE authority before reading a prior request and READING authority before status mutation', async () => {
    const f = uploadReadingReplayFixture();
    f.authorization.authorizeDocumentWork.mockRejectedValueOnce(new Error('SOURCE_ACCESS_DENIED'));
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('SOURCE_ACCESS_DENIED');
    expect(f.readRequest).not.toHaveBeenCalled();
    expect(f.authorization.authorizeDocumentWork).toHaveBeenCalledWith({
      documentVersionId: 'DV', deliveryRef: f.deliveryRef, purpose: 'SOURCE' });
    f.authorization.authorizeDocumentWork.mockResolvedValueOnce(f.scope)
      .mockRejectedValueOnce(new Error('READING_ACCESS_DENIED'));
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('READING_ACCESS_DENIED');
    expect(f.parsing.inspectPublishedIdentity).toHaveBeenCalledTimes(1);
    expect(f.expire).not.toHaveBeenCalled();
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it.each([{ actorUserId: 'other' }, { documentVersionId: 'other' }])(
    'rejects an authorization scope mismatch before reading a prior request: %j', async change => {
      const f = uploadReadingReplayFixture();
      f.authorization.authorizeDocumentWork.mockResolvedValueOnce({ ...f.scope, ...change });
      await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_SCOPE_MISMATCH');
      expect(f.readRequest).not.toHaveBeenCalled();
      expect(f.readingRun).not.toHaveBeenCalled();
    });

  it.each(['intent', 'owner'] as const)('requires the current upload %s before looking up a prior reading', async denial => {
    const f = uploadReadingReplayFixture();
    if (denial === 'intent') f.deliveryCatalog.readDocumentUploadDeliveryIntents.mockResolvedValue([
      { ...f.input, actorUserId: 'other', delivery: { reading: true, translation: 'NONE' } }]);
    else f.deliveryCatalog.readOwnedAcquisitionVersionBinding.mockResolvedValue(false);
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_SOURCE_DENIED');
    expect(f.readRequest).not.toHaveBeenCalled();
    expect(f.readingRun).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it.each(['artifact', 'sha256', 'byteLength', 'missing'] as const)(
    'rejects a changed current original registry identity: %s', async field => {
      const f = uploadReadingReplayFixture();
      f.deliveryCatalog.readOriginalRegistryIdentity.mockResolvedValue(field === 'missing' ? null : {
        version: { sourceArtifactId: field === 'artifact' ? 'other' : 'ART' },
        source: { sha256: (field === 'sha256' ? 'c' : 'a').repeat(64), byteLength: field === 'byteLength' ? 124 : 123 } });
      await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_SOURCE_CHANGED');
      expect(f.readingRun).not.toHaveBeenCalled();
      expect(f.begin).not.toHaveBeenCalled();
      expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    });

  it.each([{ documentVersionId: 'other' }, { parseRunId: 'other' }, { parseRevision: 2 }])(
    'rejects a changed prior published parse identity: %j', async change => {
      const f = uploadReadingReplayFixture();
      f.parsing.inspectPublishedIdentity.mockResolvedValueOnce({ familyId: 'family',
        binding: { ...f.original.binding, ...change } });
      await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_UPLOAD_DELIVERY_SOURCE_CHANGED');
      expect(f.readingRun).not.toHaveBeenCalled();
      expect(f.begin).not.toHaveBeenCalled();
      expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    });

  it('propagates a denied or no longer published prior parse without falling back to the latest parse', async () => {
    const f = uploadReadingReplayFixture();
    f.parsing.inspectPublishedIdentity.mockRejectedValueOnce(new Error('DOCUMENT_PARSE_SOURCE_CHANGED'));
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_PARSE_SOURCE_CHANGED');
    expect(f.parsing.status).not.toHaveBeenCalled();
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.readingRun).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it('preserves the real BEGIN revision guard when first admission races with another saved reading', async () => {
    const f = uploadReadingReplayFixture();
    f.readRequest.mockResolvedValue(null);
    f.transactionExecute.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: 1 }]);
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_READING_REVISION_CONFLICT');
    expect(f.begin).toHaveBeenCalledWith(f.scope, expect.objectContaining({ parseRunId: 'parse-two',
      parseRevision: 2, expectedRevision: 0, manifestSha256: 'b'.repeat(64) }));
    expect(f.readingRun).toHaveBeenCalledTimes(1);
    expect(f.readingRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'READING_BEGIN' }));
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });

  it('keeps a concurrent first-admission conflict visible and resumes the winner on a later retry', async () => {
    const f = uploadReadingReplayFixture();
    f.readRequest.mockResolvedValueOnce(null);
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_READING_REQUEST_CONFLICT');
    expect(f.readingRun).toHaveBeenCalledTimes(1);
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toMatchObject({
      status: 'ADMITTED', parseRunId: 'parse-one' });
    expect(f.readingRun).toHaveBeenLastCalledWith({ action: 'READING_STATUS', documentVersionId: 'DV',
      runRef: f.row.runRef, deliveryRef: f.deliveryRef });
    expect(f.begin).toHaveBeenCalledTimes(1);
  });

  it('retries selected translation with the original parse after first reading admission and translation failure', async () => {
    const f = uploadReadingReplayFixture();
    Object.assign(f.row, { status: 'QUEUED', readingRevision: null, result: null });
    f.deliveryCatalog.readDocumentUploadDeliveryIntents.mockResolvedValue([
      { ...f.input, delivery: { reading: true, translation: 'ZH_FULL' } }]);
    f.parsing.status.mockResolvedValueOnce({ latestRun: { parseRunId: 'parse-one', status: 'PUBLISHED' } });
    f.readRequest.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    f.transactionExecute.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ revision: 0 }]).mockResolvedValueOnce([f.row]);
    f.translationRuntime.run.mockRejectedValueOnce(new Error('TRANSLATION_ADMISSION_UNAVAILABLE'));
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('TRANSLATION_ADMISSION_UNAVAILABLE');
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    await expect(f.service.prepareAutomaticUpload(f.input)).resolves.toEqual({
      status: 'ADMITTED', documentVersionId: 'DV', parseRunId: 'parse-one' });
    const translation = { action: 'START', documentVersionId: 'DV', deliveryRef: f.deliveryRef,
      parseRunId: 'parse-one', requestId: documentDeliveryRequestId('translation', f.deliveryRef) };
    expect(f.translationRuntime.run.mock.calls).toEqual([[translation], [translation]]);
    expect(f.readingRun).toHaveBeenLastCalledWith({ action: 'READING_STATUS', documentVersionId: 'DV',
      runRef: f.row.runRef, deliveryRef: f.deliveryRef });
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.semantics.ensure).toHaveBeenCalledTimes(1);
    expect(f.modelSettings.captureForNewTask).toHaveBeenCalledTimes(1);
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).toHaveBeenCalledTimes(1);
  });

  it('preserves translation request conflicts without marking the upload admitted', async () => {
    const f = uploadReadingReplayFixture();
    f.deliveryCatalog.readDocumentUploadDeliveryIntents.mockResolvedValue([
      { ...f.input, delivery: { reading: true, translation: 'ZH_FULL' } }]);
    f.translationRuntime.run.mockRejectedValueOnce(new Error('DOCUMENT_TRANSLATION_REQUEST_CONFLICT'));
    await expect(f.service.prepareAutomaticUpload(f.input)).rejects.toThrow('DOCUMENT_TRANSLATION_REQUEST_CONFLICT');
    expect(f.translationRuntime.run).toHaveBeenCalledWith(expect.objectContaining({ parseRunId: 'parse-one' }));
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
  });
});

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
  const readingRuns = { readRequest: jest.fn().mockResolvedValue(null) };
  const translationRuntime = { run: jest.fn() };
  const service = new DocumentWorkRuntimeService(authorization as never, actors as never, parsing as never, leases as never, reader as never, {} as never, semantics as never, revisions as never,
    deliveryWorkItems as never, deliveryCatalog as never,
    readingRuntime as never, translationRuntime as never, undefined, readingRuns as never);
  return { service, authorization, actors, parsing, leases, fence, semantics, revisions, automaticScope,
    deliveryWorkItems, deliveryCatalog, readingRuntime, readingRuns, translationRuntime };
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

  it('distinguishes a running upload original from a terminal parse that needs attention', async () => {
    const f = fixture();
    const input = { acquisitionId: 'ACQ-one', documentVersionId: 'DV', actorUserId: 'actor' };
    f.deliveryCatalog.readDocumentUploadDeliveryIntents.mockResolvedValue([{
      ...input, delivery: { reading: true, translation: 'NONE' },
    }]);
    f.parsing.status.mockResolvedValueOnce({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'PRUN-FAILED', status: 'FAILED',
      errorCode: 'DOCUMENT_PARSE_QUOTA_EXCEEDED',
      deadlineAt: new Date(Date.now() - 60_000).toISOString(),
    } }).mockResolvedValueOnce({ documentVersionId: 'DV', latestRun: {
      parseRunId: 'PRUN-RUNNING', status: 'RUNNING', errorCode: null,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    } });
    await expect(f.service.prepareAutomaticUpload(input)).resolves.toEqual({
      status: 'REQUIRES_ATTENTION', documentVersionId: 'DV',
      parseRunId: 'PRUN-FAILED', errorCode: 'DOCUMENT_PARSE_QUOTA_EXCEEDED',
    });
    await expect(f.service.prepareAutomaticUpload(input)).resolves.toEqual({
      status: 'ORIGINAL_PREPARING', documentVersionId: 'DV', parseRunId: 'PRUN-RUNNING',
    });
    expect(f.parsing.start).not.toHaveBeenCalled();
    expect(f.deliveryCatalog.markDocumentUploadDeliveryAdmitted).not.toHaveBeenCalled();
    expect(f.readingRuntime.run).not.toHaveBeenCalled();
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
