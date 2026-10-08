import {
  createSharedFoundationTdmsSourceAuthorization,
  type TdmsCurrentPermission,
  type TdmsSharedFoundationDecision,
  type TdmsSharedFoundationMembers,
  type TdmsSharedIdentity,
} from '../../../server/modules/tdms-source/tdms-shared-foundation.authorization';
import { UnconfiguredTdmsDocumentAccess } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { UnconfiguredTdmsArtifactStore } from '../../../server/modules/tdms-source/unconfigured-tdms-artifact-store';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import type { TdmsImportMemberClaims } from '../../../server/modules/tdms-source/tdms-source.types';
import { actor, fixture } from './tdms-fixtures';
import { MemoryTdmsRepository, nativeScope } from './tdms-memory-double';

const target = {
  sourceKey: 'TDMS',
  sourceInstanceId: 'instance',
  scopeId: 'narrow',
};
const permission = (
  authorityRef: string,
  allowed = true,
  permissionRevision = 'r1',
): TdmsCurrentPermission => ({
  status: allowed ? 'ALLOWED' : 'DENIED',
  authorityRef,
  permissionRevision,
});
const subject = (id: string) => {
  const a = actor();
  a.canonicalSubject.id = id;
  return a;
};
const identity = (id = '123'): TdmsSharedIdentity => ({
  tenantId: 'tenant-a',
  applicationScopeId: actor().applicationScopeId,
  namespace: 'MIAODA_USER_ID',
  subjectId: id,
});
const decision = (id = '123'): TdmsSharedFoundationDecision => ({
  identity: identity(id),
  applicationAdmission: permission('synthetic-current-app-admission'),
  scopes: [
    {
      scope: { ...nativeScope },
      sharedRead: permission('synthetic-shared-scope'),
      importCapability: permission('synthetic-import-capability', id === '123'),
    },
  ],
});
const members = (): TdmsSharedFoundationMembers => ({
  scope: { ...nativeScope },
  authorityRef: 'synthetic-current-source-members',
  permissionRevision: 'members-r1',
  captureRetentionAllowed: true,
  nativeProjectionAllowed: true,
  records: [
    { recordKind: 'ENGINEERING_FILE', sourceRecordId: 'AEO-1' },
    { recordKind: 'ENGINEERING_FILE', sourceRecordId: 'AEO-2' },
  ],
});
const claims = (): TdmsImportMemberClaims => ({
  records: [{ recordKind: 'ENGINEERING_FILE', sourceRecordId: 'AEO-1' }],
  artifacts: [],
  relationIds: [],
  relatedDocumentVersionIds: [],
});
function setup() {
  const admitted = new Set(['123', '456']);
  let sourceAllowed = true;
  let appRevision = 'app-r1';
  let memberDecision: unknown = members();
  let currentOverride: unknown;
  let hasOverride = false;
  const readCurrentDecision = jest.fn(
    async (identity: TdmsSharedIdentity): Promise<unknown> => {
      if (hasOverride) return currentOverride;
      const d = decision(identity.subjectId);
      d.applicationAdmission = permission(
        'synthetic-current-app-admission',
        admitted.has(identity.subjectId),
        appRevision,
      );
      d.scopes[0]!.sharedRead = permission(
        'synthetic-shared-scope',
        sourceAllowed,
      );
      return d;
    },
  );
  const readCurrentImportMembers = jest.fn(async () => memberDecision);
  const authorization = createSharedFoundationTdmsSourceAuthorization({
    readCurrentDecision,
    readCurrentImportMembers,
  });
  const db = new MemoryTdmsRepository();
  const artifacts = new UnconfiguredTdmsArtifactStore();
  const documents = new UnconfiguredTdmsDocumentAccess();
  const acquire = jest.spyOn(artifacts, 'acquire');
  const transaction = jest.spyOn(db, 'transaction');
  const service = new TdmsSourceService(
    db,
    authorization,
    artifacts,
    documents,
  );
  return {
    admitted,
    readCurrentDecision,
    readCurrentImportMembers,
    authorization,
    db,
    acquire,
    transaction,
    service,
    revokeSource: () => {
      sourceAllowed = false;
    },
    reviseApplication: () => {
      appRevision = 'app-r2';
    },
    setDecision: (value: unknown) => {
      currentOverride = value;
      hasOverride = true;
    },
    setMembers: (value: unknown) => {
      memberDecision = value;
    },
  };
}

describe('inactive shared-foundation current Host decision seam', () => {
  it('has no available provider or catalogue when unbound', async () => {
    const auth = createSharedFoundationTdmsSourceAuthorization();
    expect(auth.available).toBe(false);
    expect(await auth.catalogue(actor(), {})).toEqual([]);
    await expect(
      auth.authorizeImport(actor(), nativeScope, claims()),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
  });
  it('gives B the same source scope without any importer identity in the read decision', async () => {
    const s = setup();
    const a = await s.authorization.authorize(
      actor(),
      nativeScope,
      'READ_RECORD',
      {},
    );
    const b = await s.authorization.authorize(
      subject('456'),
      nativeScope,
      'READ_RECORD',
      {},
    );
    expect(a.scope).toEqual(b.scope);
    expect(a.permissionRevision).not.toBe(b.permissionRevision);
    expect(s.readCurrentDecision.mock.calls[1]).toEqual([identity('456')]);
    expect(s.readCurrentImportMembers).not.toHaveBeenCalled();
  });
  it('requires independent import capability before member lookup or any database/artifact write', async () => {
    const s = setup();
    await expect(
      s.service.importPackage(subject('456'), target, fixture()),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(s.readCurrentImportMembers).not.toHaveBeenCalled();
    expect(s.transaction).not.toHaveBeenCalled();
    expect(s.acquire).not.toHaveBeenCalled();
  });
  it('requires a separate import-member reader even if a decision grants IMPORT', async () => {
    const auth = createSharedFoundationTdmsSourceAuthorization({
      readCurrentDecision: async () => decision(),
    });
    await expect(
      auth.authorizeImport(actor(), nativeScope, claims()),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_ADMISSION_UNCONFIGURED',
    });
    await expect(
      auth.authorize(actor(), nativeScope, 'READ_RECORD', {}),
    ).resolves.toMatchObject({ scope: nativeScope });
  });
  it.each([
    'CATALOGUE',
    'READ_RECORD',
    'READ_RELATIONS',
    'READ_HISTORY',
  ] as const)('denies a logged-in outsider on %s', async (action) => {
    const s = setup();
    const outsider = subject('789');
    await expect(
      s.authorization.authorize(outsider, nativeScope, action, {}),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(await s.authorization.catalogue(outsider, {})).toEqual([]);
  });
  it.each(['anonymous', 'service', 'unverified'] as const)(
    'rejects %s before reading current decisions',
    async (mode) => {
      const s = setup();
      const a = actor();
      if (mode === 'anonymous') a.canonicalSubject.id = '-1';
      if (mode === 'service') a.canonicalSubject.id = 'service:worker';
      if (mode === 'unverified')
        (a as unknown as { transport: string }).transport = 'UNTRUSTED';
      await expect(s.authorization.catalogue(a, {})).rejects.toMatchObject({
        code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED',
      });
      expect(s.readCurrentDecision).not.toHaveBeenCalled();
    },
  );
  it.each(['tenantId', 'applicationScopeId', 'subjectId'] as const)(
    'rejects mismatched decision identity %s',
    async (field) => {
      const s = setup();
      const d = decision();
      d.identity[field] = 'foreign';
      s.setDecision(d);
      expect(await s.authorization.catalogue(actor(), {})).toEqual([]);
    },
  );
  it.each(['tenantId', 'sourceKey', 'sourceInstanceId', 'scopeId'] as const)(
    'rejects foreign requested scope %s',
    async (field) => {
      const s = setup();
      await expect(
        s.authorization.authorize(
          actor(),
          { ...nativeScope, [field]: 'foreign' },
          'READ_RECORD',
          {},
        ),
      ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    },
  );
  it.each([null, undefined])(
    'fails closed for an unavailable authority: %s',
    async (value) => {
      const s = setup();
      s.setDecision(value);
      expect(await s.authorization.catalogue(actor(), {})).toEqual([]);
    },
  );
  it('does not fall back when the current authority throws', async () => {
    const auth = createSharedFoundationTdmsSourceAuthorization({
      readCurrentDecision: async () => {
        throw new Error('authority offline');
      },
    });
    await expect(auth.catalogue(actor(), {})).rejects.toThrow(
      'authority offline',
    );
  });
  it.each(['identity', 'applicationAdmission', 'scopes'])(
    'rejects a missing required decision field: %s',
    async (field) => {
      const s = setup();
      const d = decision() as unknown as Record<string, unknown>;
      delete d[field];
      s.setDecision(d);
      await expect(
        s.authorization.catalogue(actor(), {}),
      ).rejects.toMatchObject({ code: 'TDMS_SHARED_DECISION_INVALID' });
    },
  );
  it.each([
    'roles',
    'duplicate-scope',
    'empty-revision',
    'sparse-scopes',
    'invalid-status',
  ])('rejects malformed decision: %s', async (mode) => {
    const s = setup();
    const d = decision();
    if (mode === 'roles') Object.assign(d, { roles: ['admin'] });
    if (mode === 'duplicate-scope') d.scopes.push(d.scopes[0]!);
    if (mode === 'empty-revision')
      d.applicationAdmission.permissionRevision = '';
    if (mode === 'sparse-scopes') d.scopes = new Array(1);
    if (mode === 'invalid-status')
      (d.applicationAdmission as unknown as { status: string }).status =
        'ACTIVE';
    s.setDecision(d);
    await expect(s.authorization.catalogue(actor(), {})).rejects.toMatchObject({
      code: 'TDMS_SHARED_DECISION_INVALID',
    });
  });
  it('keeps import revisions independent of READ and makes authoritative member changes observable', async () => {
    const s = setup();
    const read = await s.authorization.authorize(
      actor(),
      nativeScope,
      'READ_RECORD',
      {},
    );
    const before = await s.authorization.authorizeImport(
      actor(),
      nativeScope,
      claims(),
    );
    s.setMembers({ ...members(), permissionRevision: 'members-r2' });
    const after = await s.authorization.authorizeImport(
      actor(),
      nativeScope,
      claims(),
    );
    expect(after.permissionRevision).not.toEqual(before.permissionRevision);
    expect(
      await s.authorization.authorize(actor(), nativeScope, 'READ_RECORD', {}),
    ).toEqual(read);
    expect(after.permittedMembers.records).toEqual(members().records);
    expect(s.readCurrentImportMembers.mock.calls[0]).toEqual([
      { identity: identity(), scope: nativeScope },
    ]);
  });
  it('denies forged source members without echoing the claims into approved members', async () => {
    const s = setup();
    const c = claims();
    c.records[0]!.sourceRecordId = 'forged';
    await expect(
      s.authorization.authorizeImport(actor(), nativeScope, c),
    ).rejects.toMatchObject({
      code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',
    });
  });
  it.each(['artifacts', 'relationIds', 'relatedDocumentVersionIds'] as const)(
    'honestly rejects unsupported first-slice %s imports',
    async (field) => {
      const s = setup();
      const c = claims();
      Object.assign(c, { [field]: ['not-in-this-slice'] });
      await expect(
        s.authorization.authorizeImport(actor(), nativeScope, c),
      ).rejects.toMatchObject({
        code: 'TDMS_SHARED_FIRST_SLICE_MEMBERS_UNSUPPORTED',
      });
    },
  );
  it('fails nonempty context closed without affecting the valid empty-context native library', async () => {
    const s = setup();
    await expect(
      s.authorization.authorize(actor(), nativeScope, 'READ_RECORD', {
        matterId: 'private-matter',
      }),
    ).rejects.toMatchObject({
      code: 'TDMS_SHARED_CONTEXT_AUTHORIZATION_UNCONFIGURED',
    });
    await expect(
      s.authorization.authorize(actor(), nativeScope, 'READ_RECORD', {}),
    ).resolves.toMatchObject({ scope: nativeScope });
  });
  it('binds nonempty context to a fresh exact identity, context and ACL revision', async () => {
    let revision = 'context-r1';
    let allowed = true;
    let wrongContext = false;
    const context = {
      documentVersionId: 'exact-version',
    };
    const check = jest.fn(async () => ({
      identity: identity(),
      context: wrongContext ? { matterId: 'other-matter' } : context,
      permission: permission(
        'synthetic-selected-object-acl',
        allowed,
        revision,
      ),
    }));
    const auth = createSharedFoundationTdmsSourceAuthorization({
      readCurrentDecision: async () => decision(),
      readCurrentContextDecision: check,
    });
    const first = await auth.authorize(
      actor(),
      nativeScope,
      'READ_RECORD',
      context,
    );
    revision = 'context-r2';
    expect(
      (await auth.authorize(actor(), nativeScope, 'READ_RECORD', context))
        .permissionRevision,
    ).not.toBe(first.permissionRevision);
    allowed = false;
    await expect(
      auth.authorize(actor(), nativeScope, 'READ_RECORD', context),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    allowed = true;
    wrongContext = true;
    await expect(
      auth.authorize(actor(), nativeScope, 'READ_RECORD', context),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(check).toHaveBeenCalledTimes(4);
  });
});

describe('shared service synthetic cross-user and revocation acceptance', () => {
  it('B reads A capture with a B receipt; A departure does not erase provenance or shared data', async () => {
    const s = setup();
    const imported = await s.service.importPackage(actor(), target, fixture());
    const ref = imported.recordRevisionRefs[0]!;
    s.admitted.delete('123');
    const b = subject('456');
    expect(
      (await s.service.catalogue(b)).records.map(
        (record) => record.sourceRevisionRef,
      ),
    ).toEqual([ref]);
    expect((await s.service.readRecord(b, ref)).record.sourceRevisionRef).toBe(
      ref,
    );
    expect(s.db.state.receipts.at(-1)?.actorId).toBe('456');
    expect(s.db.state.captures[0]!.actorId).toBe('123');
    await expect(
      s.service.importPackage(actor(), target, fixture()),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(s.acquire).not.toHaveBeenCalled();
  });
  it.each(['member', 'source'] as const)(
    'revoking current %s invalidates old exact ref and receipt',
    async (mode) => {
      const s = setup();
      const imported = await s.service.importPackage(
        actor(),
        target,
        fixture(),
      );
      const ref = imported.recordRevisionRefs[0]!;
      const b = subject('456');
      await s.service.readRecord(b, ref);
      if (mode === 'member') s.admitted.delete('456');
      else s.revokeSource();
      expect((await s.service.catalogue(b)).records).toEqual([]);
      await expect(s.service.readRecord(b, ref)).rejects.toMatchObject({
        code: 'TDMS_SOURCE_NOT_FOUND',
      });
      await expect(s.service.readRelations(b, ref)).rejects.toMatchObject({
        code: 'TDMS_SOURCE_NOT_FOUND',
      });
      expect(s.db.state.receipts).toHaveLength(1);
    },
  );
  it('rolls back the read receipt when current membership changes before final transaction recheck', async () => {
    const s = setup();
    const imported = await s.service.importPackage(actor(), target, fixture());
    s.db.beforeReceipt = () => s.admitted.delete('456');
    await expect(
      s.service.readRecord(subject('456'), imported.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(s.db.state.receipts).toEqual([]);
  });
  it('detects changed authoritative revision even when membership remains allowed', async () => {
    const s = setup();
    const imported = await s.service.importPackage(actor(), target, fixture());
    s.db.beforeReceipt = s.reviseApplication;
    await expect(
      s.service.readRecord(subject('456'), imported.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED' });
    expect(s.db.state.receipts).toEqual([]);
  });
  it('rechecks after commit without pretending a physical rollback or atomic revocation guarantee', async () => {
    const s = setup();
    const imported = await s.service.importPackage(actor(), target, fixture());
    s.db.beforeCommit = () => s.admitted.delete('456');
    await expect(
      s.service.readRecord(subject('456'), imported.recordRevisionRefs[0]!),
    ).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
    expect(s.db.state.receipts).toHaveLength(1); // Memory commit happened; no response body escaped.
  });
  it('retains package actor idempotency independently from cross-user READ', async () => {
    const s = setup();
    const p = fixture();
    const a = await s.service.importPackage(actor(), target, p);
    expect(await s.service.importPackage(actor(), target, p)).toEqual({
      ...a,
      created: false,
    });
    const d = decision('456');
    d.scopes[0]!.importCapability.status = 'ALLOWED';
    s.setDecision(d);
    await expect(
      s.service.importPackage(subject('456'), target, p),
    ).rejects.toMatchObject({ code: 'TDMS_PACKAGE_IDEMPOTENCY_CONFLICT' });
    expect(
      (await s.service.readRecord(subject('456'), a.recordRevisionRefs[0]!))
        .record.sourceRevisionRef,
    ).toBe(a.recordRevisionRefs[0]);
    expect(s.db.state.captures).toHaveLength(1);
  });
});
