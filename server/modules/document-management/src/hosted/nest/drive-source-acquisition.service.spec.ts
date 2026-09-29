import { DriveSourceAcquisitionService } from './drive-source-acquisition.service';
import type { DriveSourceCandidate } from '../drive-source-candidate';
import type { DrivePage } from '../drive-folder-scanner';

const ROOT = 'Q6uSfDwcDlBrUldWvZccoje8nXf';
const candidate: DriveSourceCandidate = {
  sourceKey: 'technical-library', providerObjectId: 'file1', providerVersionId: null,
  entryType: 'file', name: 'Manual.pdf', path: 'root/Manual.pdf', modifiedTime: '100',
  identity: 'technical-library:file:file1:unversioned',
  observedParentToken: ROOT, ancestorTokens: [ROOT],
};
const originalPolicy = process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON;
const originalApp = process.env.FEISHU_OAUTH_CLIENT_ID;
const policy = { tenantId: 'tenant1', sourceKey: 'technical-library', rootToken: ROOT,
  policyRevision: 'rev1', responsibilityActorUserId: 'actor1', executorPrincipalId: 'app1',
  enabled: true, documentDelivery: { reading: true, translation: 'NONE' },
  engineeringMode: 'DOCUMENT_ONLY' };

function fixture(pending: DriveSourceCandidate[] = [candidate]) {
  const checkpoints = { listPendingCandidates: jest.fn(async () => pending),
    acknowledgeCandidate: jest.fn(async (_tenant: string, _source: string, _observed: DriveSourceCandidate) => true),
    deferCandidate: jest.fn(async (_tenant: string, _source: string, _observed: DriveSourceCandidate) => true) };
  const fetcher = { list: jest.fn(async (_folder: string, _page?: string): Promise<DrivePage> => ({ files: [{ token: 'file1', type: 'file',
    name: 'Manual.pdf', modifiedTime: '100' }], hasMore: false })),
    metadata: jest.fn(async () => ({ token: 'file1', type: 'file', title: 'Manual.pdf', latestModifyTime: '100' })),
    downloadFile: jest.fn(async () => Buffer.from('%PDF-1.7\nsource body')) };
  const catalog = { recordAcquisition: jest.fn(async (input) => input) };
  const intake = { reserve: jest.fn(async ({ acquisitionId }) => ({ attemptId: 'ATT-1',
    acquisitionId, status: 'RECORDED', pendingReason: 'WAITING_IDENTITY', created: true })) };
  const actorScope = { withActorScope: jest.fn(async (_actor, operation) => operation()) };
  const artifactStore = { persistImmutableSource: jest.fn(async () => ({ bucketId: 'bucket',
    filePath: '/immutable.pdf', providerObjectId: 'host-object', providerVersionId: 'host-object',
    readbackVerified: true })) };
  const service = new DriveSourceAcquisitionService(checkpoints as never,
    fetcher as never, catalog as never, intake as never, actorScope as never,
    { from: () => ({}) } as never);
  (service as unknown as { store: unknown }).store = artifactStore;
  return { service, checkpoints, fetcher, catalog, intake, actorScope, artifactStore };
}

describe('DriveSourceAcquisitionService', () => {
  beforeEach(() => {
    process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = JSON.stringify([policy]);
    process.env.FEISHU_OAUTH_CLIENT_ID = 'app1';
  });
  afterAll(() => {
    if (originalPolicy === undefined) delete process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON;
    else process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = originalPolicy;
    if (originalApp === undefined) delete process.env.FEISHU_OAUTH_CLIENT_ID;
    else process.env.FEISHU_OAUTH_CLIENT_ID = originalApp;
  });

  it('defaults closed without a policy and touches no source or database', async () => {
    delete process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON;
    const f = fixture();
    expect(await f.service.processPending('tenant1')).toEqual({ status: 'DISABLED',
      attempted: 0, skippedUnsupported: 0, acquired: [], blocked: [] });
    expect(f.actorScope.withActorScope).not.toHaveBeenCalled();
    expect(f.fetcher.list).not.toHaveBeenCalled();
  });

  it('binds fresh root membership, downloaded bytes, immutable Host identity, intent and exact ACK', async () => {
    const f = fixture();
    const result = await f.service.processPending('tenant1');
    expect(result.blocked).toEqual([]);
    expect(result.acquired).toHaveLength(1);
    expect(f.actorScope.withActorScope).toHaveBeenCalledWith('actor1', expect.any(Function));
    expect(f.fetcher.list).toHaveBeenCalledWith(ROOT, undefined);
    expect(f.fetcher.metadata).toHaveBeenCalledTimes(2);
    expect(f.artifactStore.persistImmutableSource).toHaveBeenCalledWith(expect.objectContaining({
      byteLength: Buffer.byteLength('%PDF-1.7\nsource body'), mediaType: 'application/pdf',
    }));
    const acquisition = f.catalog.recordAcquisition.mock.calls[0]![0].acquisition;
    expect(acquisition).toEqual(expect.objectContaining({
      selectionBucketId: 'bucket', selectionFilePath: '/immutable.pdf',
      providerObjectId: 'host-object', providerVersionId: 'host-object',
      sourceDescriptor: expect.objectContaining({ driveFileToken: 'file1',
        driveRevision: null, observedParentToken: ROOT, ancestorTokens: [ROOT] }),
    }));
    expect(f.intake.reserve).toHaveBeenCalledWith(expect.objectContaining({
      acquisitionId: acquisition.acquisitionId, actorUserId: 'actor1',
    }));
    expect(f.checkpoints.acknowledgeCandidate).toHaveBeenCalledWith('tenant1',
      'technical-library', candidate);
    await f.service.processPending('tenant1');
    expect(f.catalog.recordAcquisition.mock.calls[1]![0].acquisition.acquisitionId)
      .toBe(acquisition.acquisitionId);
    expect(f.catalog.recordAcquisition.mock.calls[1]![0].acquisition.idempotencyKey)
      .toBe(acquisition.idempotencyKey);
  });

  it('keeps legacy and stale observations pending without download or ACK', async () => {
    const f = fixture([{ ...candidate, ancestorTokens: undefined, observedParentToken: undefined },
      { ...candidate, providerObjectId: 'file2' }]);
    const result = await f.service.processPending('tenant1');
    expect(result.blocked.map(item => item.code)).toEqual([
      'DRIVE_ROOT_MEMBERSHIP_UNPROVEN', 'DRIVE_OBSERVATION_STALE',
    ]);
    expect(f.fetcher.downloadFile).not.toHaveBeenCalled();
    expect(f.checkpoints.acknowledgeCandidate).not.toHaveBeenCalled();
  });

  it('refuses a different executor before reading pending', async () => {
    process.env.FEISHU_OAUTH_CLIENT_ID = 'other';
    const f = fixture();
    await expect(f.service.processPending('tenant1')).rejects.toThrow('SOURCE_EXECUTOR_PRINCIPAL_MISMATCH');
    expect(f.checkpoints.listPendingCandidates).not.toHaveBeenCalled();
  });

  it('does not ACK when metadata changes across bounded downloads', async () => {
    const f = fixture([{ ...candidate, modifiedTime: null }]);
    let call = 0;
    f.fetcher.metadata.mockImplementation(async () => ({ token: 'file1', type: 'file',
      title: 'Manual.pdf', latestModifyTime: String(++call) }));
    const result = await f.service.processPending('tenant1');
    expect(result.blocked[0]?.code).toBe('DRIVE_FILE_CHANGED_DURING_DOWNLOAD');
    expect(f.fetcher.downloadFile).toHaveBeenCalledTimes(2);
    expect(f.checkpoints.acknowledgeCandidate).not.toHaveBeenCalled();
  });

  it('stops before immutable persistence when policy is withdrawn during download', async () => {
    const f = fixture();
    f.fetcher.downloadFile.mockImplementation(async () => {
      process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = JSON.stringify([{ ...policy, enabled: false }]);
      return Buffer.from('%PDF-1.7\nsource body');
    });
    const result = await f.service.processPending('tenant1');
    expect(result.blocked[0]?.code).toBe('SOURCE_DELEGATION_CHANGED');
    expect(f.artifactStore.persistImmutableSource).not.toHaveBeenCalled();
    expect(f.catalog.recordAcquisition).not.toHaveBeenCalled();
    expect(f.checkpoints.acknowledgeCandidate).not.toHaveBeenCalled();
  });

  it('checks root membership again after Host readback and before Catalog write', async () => {
    const f = fixture();
    f.artifactStore.persistImmutableSource.mockImplementation(async () => {
      f.fetcher.list.mockImplementation(async () => ({ files: [], hasMore: false }));
      return { bucketId: 'bucket', filePath: '/immutable.pdf', providerObjectId: 'host-object',
        providerVersionId: 'host-object', readbackVerified: true };
    });
    const result = await f.service.processPending('tenant1');
    expect(result.blocked[0]?.code).toBe('DRIVE_OBSERVATION_STALE');
    expect(f.catalog.recordAcquisition).not.toHaveBeenCalled();
    expect(f.checkpoints.acknowledgeCandidate).not.toHaveBeenCalled();
  });

  it('gives a moved file a distinct acquisition identity', async () => {
    const f = fixture();
    await f.service.processPending('tenant1');
    const first = f.catalog.recordAcquisition.mock.calls[0]![0].acquisition.acquisitionId;
    const moved = { ...candidate, observedParentToken: 'child',
      ancestorTokens: [ROOT, 'child'] };
    f.checkpoints.listPendingCandidates.mockImplementation(async () => [moved]);
    f.fetcher.list.mockImplementation(async (folder: string): Promise<DrivePage> => ({
      files: folder === ROOT ? [{ token: 'child', type: 'folder', name: 'new-folder' }]
        : [{ token: 'file1', type: 'file', name: 'Manual.pdf', modifiedTime: '100' }],
      hasMore: false,
    }));
    await f.service.processPending('tenant1');
    const second = f.catalog.recordAcquisition.mock.calls[1]![0].acquisition.acquisitionId;
    expect(second).not.toBe(first);
  });

  it('keeps pending after a lost intake response, then replays the same acquisition before ACK', async () => {
    const f = fixture();
    f.intake.reserve.mockRejectedValueOnce(new Error('INTAKE_RESPONSE_LOST'));
    const first = await f.service.processPending('tenant1');
    expect(first.blocked[0]?.code).toBe('INTAKE_RESPONSE_LOST');
    expect(f.checkpoints.acknowledgeCandidate).not.toHaveBeenCalled();
    const replay = await f.service.processPending('tenant1');
    expect(replay.acquired).toHaveLength(1);
    expect(f.catalog.recordAcquisition.mock.calls[1]![0].acquisition.acquisitionId)
      .toBe(f.catalog.recordAcquisition.mock.calls[0]![0].acquisition.acquisitionId);
    expect(f.catalog.recordAcquisition.mock.calls[1]![0].acquisition.idempotencyKey)
      .toBe(f.catalog.recordAcquisition.mock.calls[0]![0].acquisition.idempotencyKey);
    expect(f.checkpoints.acknowledgeCandidate).toHaveBeenCalledTimes(1);
  });

  it('bounds each run and retries failed PDF rows behind their peers', async () => {
    const pending = Array.from({ length: 52 }, (_, index) => ({ ...candidate,
      providerObjectId: `file${index + 1}` }));
    pending.unshift({ ...candidate, providerObjectId: 'doc1', name: 'readme.txt' });
    const f = fixture(pending);
    f.checkpoints.deferCandidate.mockImplementation(async (_tenant, _source, observed) => {
      const index = pending.findIndex(item => item.providerObjectId === observed.providerObjectId);
      if (index >= 0) pending.push(...pending.splice(index, 1));
      return true;
    });
    f.checkpoints.acknowledgeCandidate.mockImplementation(async (_tenant, _source, observed) => {
      const index = pending.findIndex(item => item.providerObjectId === observed.providerObjectId);
      if (index >= 0) pending.splice(index, 1);
      return true;
    });
    const first = await f.service.processPending('tenant1');
    expect(first.attempted).toBe(50);
    expect(first.skippedUnsupported).toBe(1);
    expect(f.fetcher.downloadFile).toHaveBeenCalledTimes(1);
    expect(f.checkpoints.deferCandidate).toHaveBeenCalledTimes(49);
    expect(pending.slice(0, 2).map(item => item.providerObjectId)).toEqual(['doc1', 'file51']);
    const second = await f.service.processPending('tenant1');
    expect(second.attempted).toBe(50);
    expect(f.checkpoints.deferCandidate.mock.calls.some(([, , item]) =>
      item.providerObjectId === 'file51')).toBe(true);
  });
});
