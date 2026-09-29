import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import { mintDocumentUploadAuthority } from '../../server/modules/document-management/src/hosted/nest/document-upload-authority';
import {
  mintSourceDelegationAuthority,
  mintSourceReceiptReadAuthority,
  parseSourceDelegationPolicy,
} from '../../server/modules/document-management/src/hosted/nest/source-intake-authority';
import { SourceIntakeRepository } from '../../server/modules/document-management/src/hosted/nest/source-intake.repository';

const POLICY = {
  tenantId: 'tenant-a', sourceKey: 'technical-library',
  rootToken: 'Q6uSfDwcDlBrUldWvZccoje8nXf', policyRevision: '1',
  responsibilityActorUserId: 'responsible-user', executorPrincipalId: 'host-app',
  enabled: true, documentDelivery: { reading: true, translation: 'NONE' },
  engineeringMode: 'DOCUMENT_ONLY',
} as const;
const OBSERVATION = {
  sourceKey: 'technical-library', rootToken: POLICY.rootToken,
  providerObjectId: 'file-1', providerVersionId: 'version-1',
  selectionBucketId: 'bucket-1', selectionFilePath: '/source.pdf',
};

describe('acquisition source intake', () => {
  const originalPolicy = process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON;
  const originalSandbox = process.env.SANDBOX_ID;
  const originalLocal = process.env.MIAODA_LOCAL_DEV;

  afterEach(() => {
    restoreEnv('WISELINK_SOURCE_INTAKE_POLICIES_JSON', originalPolicy);
    restoreEnv('SANDBOX_ID', originalSandbox);
    restoreEnv('MIAODA_LOCAL_DEV', originalLocal);
  });

  it('closes an unconfigured source and rejects a copied authority', async () => {
    delete process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON;
    expect(parseSourceDelegationPolicy(undefined)).toEqual([]);
    expect(() => mintSourceDelegationAuthority({
      tenantId: 'tenant-a', sourceKey: 'technical-library', observation: OBSERVATION,
    })).toThrow('SOURCE_DELEGATION_NOT_CONFIGURED');
    const fixture = fakeDatabase();
    const repo = new SourceIntakeRepository(fixture.db as never);
    await expect(repo.reserve({ ...sourceRequest(),
      authority: { kind: 'SOURCE_DELEGATION', policy: POLICY,
        observation: OBSERVATION } })).rejects.toThrow('SOURCE_INTAKE_AUTHORITY_REQUIRED');
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it('keeps equivalent policy field order valid and revokes stale authority', async () => {
    const fixture = fakeDatabase();
    const repo = new SourceIntakeRepository(fixture.db as never);
    const input = sourceRequest();
    process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = JSON.stringify([{
      engineeringMode: POLICY.engineeringMode,
      documentDelivery: { translation: 'NONE', reading: true },
      enabled: true, executorPrincipalId: POLICY.executorPrincipalId,
      responsibilityActorUserId: POLICY.responsibilityActorUserId,
      policyRevision: POLICY.policyRevision, rootToken: POLICY.rootToken,
      sourceKey: POLICY.sourceKey, tenantId: POLICY.tenantId,
    }]);
    await expect(repo.reserve(input)).resolves.toMatchObject({ created: true });
    delete process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON;
    await expect(repo.reserve(input)).rejects.toThrow('SOURCE_INTAKE_AUTHORITY_REQUIRED');
  });

  it('requires verified bytes and exact tenant, actor, and source binding', async () => {
    const fixture = fakeDatabase();
    const repo = new SourceIntakeRepository(fixture.db as never);
    const input = sourceRequest();
    await expect(repo.reserve({ ...input, tenantId: 'tenant-b' }))
      .rejects.toThrow('SOURCE_INTAKE_AUTHORITY_REQUIRED');
    await expect(repo.reserve({ ...input, actorUserId: 'other-user' }))
      .rejects.toThrow('SOURCE_INTAKE_AUTHORITY_REQUIRED');
    fixture.acquisition.acquiredBy = 'other-user';
    await expect(repo.reserve(input)).rejects.toThrow('SOURCE_INTAKE_ACQUISITION_MISMATCH');
    fixture.acquisition.acquiredBy = 'responsible-user';
    fixture.artifact.readbackVerified = false;
    // A claimed READY preflight does not replace verified source bytes.
    fixture.preflightStatus = 'READY';
    await expect(repo.reserve(input)).rejects.toThrow('SOURCE_INTAKE_ACQUISITION_MISMATCH');
    fixture.artifact.readbackVerified = true;
    fixture.acquisition.providerVersionId = 'different-version';
    await expect(repo.reserve(input)).rejects.toThrow('SOURCE_INTAKE_ACQUISITION_MISMATCH');
  });

  it('records once, compares replay parameters, and keeps unresolved identity queryable', async () => {
    const fixture = fakeDatabase();
    const repo = new SourceIntakeRepository(fixture.db as never);
    const input = sourceRequest();
    const first = await repo.reserve(input);
    expect(first).toMatchObject({ created: true, status: 'RECORDED',
      pendingReason: 'WAITING_IDENTITY' });
    const replay = await repo.reserve(input);
    expect(replay.attemptId).toBe(first.attemptId);
    expect(replay.created).toBe(false);
    expect(fixture.inserts).toBe(1);
    const reversedChoice = await repo.reserve({ ...input,
      documentDelivery: { translation: 'NONE', reading: true } });
    expect(reversedChoice.created).toBe(false);
    expect(reversedChoice.attemptId).toBe(first.attemptId);
    await expect(repo.reserve({ ...input,
      documentDelivery: { reading: false, translation: 'NONE' } }))
      .rejects.toThrow('SOURCE_INTAKE_DELEGATION_MISMATCH');
    const pending = await repo.read({ tenantId: input.tenantId,
      actorUserId: input.actorUserId, attemptId: first.attemptId,
      authority: mintSourceReceiptReadAuthority({ tenantId: input.tenantId,
        sourceKey: 'technical-library' }) });
    expect(pending?.pendingReason).toBe('WAITING_IDENTITY');
    process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = JSON.stringify([{
      ...POLICY, enabled: false,
      documentDelivery: { reading: false, translation: 'NONE' },
    }]);
    const pausedReader = mintSourceReceiptReadAuthority({ tenantId: input.tenantId,
      sourceKey: 'technical-library' });
    await expect(repo.reserve(input)).rejects.toThrow('SOURCE_INTAKE_AUTHORITY_REQUIRED');
    fixture.acquisition.documentVersionId = 'DV-1';
    expect((await repo.read({ tenantId: input.tenantId,
      actorUserId: input.actorUserId, attemptId: first.attemptId,
      authority: pausedReader }))?.pendingReason).toBe('READY_FOR_NEXT_STAGE');
    process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = JSON.stringify([{
      ...POLICY, enabled: false, executorPrincipalId: 'replacement-executor',
    }]);
    await expect(repo.read({ tenantId: input.tenantId,
      actorUserId: input.actorUserId, attemptId: first.attemptId,
      authority: pausedReader })).rejects.toThrow('SOURCE_RECEIPT_READ_AUTHORITY_REQUIRED');
    const newReader = mintSourceReceiptReadAuthority({ tenantId: input.tenantId,
      sourceKey: 'technical-library' });
    await expect(repo.read({ tenantId: input.tenantId,
      actorUserId: input.actorUserId, attemptId: first.attemptId,
      authority: newReader })).rejects.toThrow('SOURCE_INTAKE_ENVELOPE_MISMATCH');
  });

  it('does not grant an old NONE upload a new reading choice', async () => {
    process.env.SANDBOX_ID = 'test-sandbox';
    delete process.env.MIAODA_LOCAL_DEV;
    const authority = mintDocumentUploadAuthority({ actorUserId: 'responsible-user',
      tenantId: 'tenant-a', appId: CANONICAL_MIAODA_APP_ID, env: 'runtime' });
    const fixture = fakeDatabase();
    fixture.acquisition.sourceChannel = 'document_library_upload';
    fixture.acquisition.sourceDescriptorJson = JSON.stringify({
      documentDeliveryIntent: { reading: false, translation: 'NONE' },
    });
    const repo = new SourceIntakeRepository(fixture.db as never);
    await expect(repo.reserve({ ...sourceRequest(), authority,
      documentDelivery: { reading: true, translation: 'NONE' } }))
      .rejects.toThrow('SOURCE_INTAKE_UPLOAD_MISMATCH');
    expect(fixture.inserts).toBe(0);
  });
});

function sourceRequest() {
  process.env.WISELINK_SOURCE_INTAKE_POLICIES_JSON = JSON.stringify([POLICY]);
  const authority = mintSourceDelegationAuthority({
    tenantId: 'tenant-a', sourceKey: 'technical-library', observation: OBSERVATION,
  });
  return { acquisitionId: 'ACQ-1', tenantId: 'tenant-a',
    actorUserId: 'responsible-user',
    documentDelivery: { reading: true, translation: 'NONE' as const },
    engineeringMode: 'DOCUMENT_ONLY' as const, authority };
}

function fakeDatabase() {
  const acquisition = {
    acquisitionId: 'ACQ-1', sourceArtifactId: 'SOURCE-1', documentVersionId: null as string | null,
    sourceChannel: 'wiselink_drive_source', acquiredBy: 'responsible-user',
    idempotencyKey: 'tenant:tenant-a:request:source-1',
    selectionBucketId: 'bucket-1', selectionFilePath: '/source.pdf',
    providerObjectId: 'file-1', providerVersionId: 'version-1',
    sourceDescriptorJson: JSON.stringify({ sourceKey: 'technical-library',
      rootToken: POLICY.rootToken }),
  };
  const artifact = { sourceArtifactId: 'SOURCE-1', readbackVerified: true,
    bucketId: 'bucket-1', filePath: '/source.pdf', providerObjectId: 'file-1',
    providerVersionId: 'version-1' };
  let stored: Record<string, unknown> | null = null;
  let inserts = 0;
  const tx = {
    execute: jest.fn(async () => []),
    select: jest.fn((shape?: Record<string, unknown>) => ({
      from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () =>
        shape?.attempt ? stored ? [{ attempt: stored, acquisition }] : []
          : [{ acquisition, artifact }] }) }),
      where: () => ({ limit: async () => stored ? [stored] : [] }),
      }),
    })),
    insert: jest.fn(() => ({ values: (row: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({ returning: async () => {
        if (stored) return [];
        stored = row;
        inserts += 1;
        return [{ attemptId: row.attemptId }];
      } }),
    }) })),
  };
  const transaction = jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { db: { transaction }, transaction, acquisition, artifact,
    preflightStatus: null as string | null,
    get inserts() { return inserts; } };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
