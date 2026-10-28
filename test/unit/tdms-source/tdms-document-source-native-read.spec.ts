import type { Request } from 'express';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { SessionResolver } from '@server/modules/identity/session-resolver.service';
import { TdmsReceiverRepository } from '@server/modules/tdms-source/tdms-receiver.repository';
import { MiaodaTdmsSourceAuthorization } from '@server/modules/tdms-source/miaoda-tdms-source-authorization';
import { TdmsDocumentSourceReadAdapter } from '@server/modules/tdms-source/tdms-document-source-read.adapter';
import { contextFromRequest } from '@server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import { documentSourceReadRequest, type DocumentSourceReadInput } from '@server/modules/document-management/src/hosted/nest/document-source-read.port';
import type { TdmsDocumentUploadBinding } from '@server/modules/document-management/src/hosted/nest/document-upload-authority';
import { OrdinaryDocumentManagementAuthorizer } from '@server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { syntheticReceiverFixture } from './tdms-real-receiver.fixture';
import { actor } from './tdms-fixtures';

// Actual session/native-SQL/receiver/member adapters. SQL results remain explicit local doubles.
function setup() {
  const a = actor(), f = syntheticReceiverFixture();
  const request = { headers: {}, userContext: { userId: a.canonicalSubject.id,
    tenantId: a.tenantId, appId: a.applicationScopeId, env: a.env } } as unknown as Request;
  const owner = { recordKind: 'MANUFACTURER_FILE', sourceRecordId: 'OR:wt.doc.WTDocument:901' };
  const scope = { tenantId: a.tenantId, sourceKey: 'TDMS', sourceInstanceId: f.row.sourceInstanceId, scopeId: f.row.scopeId };
  const binding: TdmsDocumentUploadBinding = { schemaVersion: 'wiselink.tdms-formal-document-binding.v1',
    scope, applicationScopeId: a.applicationScopeId, actorSubjectId: a.canonicalSubject.id,
    requestId: 'synthetic-request', bindingId: 'synthetic-binding', payloadDigest: 'b'.repeat(64),
    receiverId: f.row.receiverId, receiverRevision: 1, grantRevision: 1, permissionRevision: 'synthetic',
    ownerSnapshotId: 'synthetic-snapshot', sourceRecordId: owner.sourceRecordId, number: '737-SL-31-093',
    sourceVersion: { rawRevision: 'A', rawIteration: '1', confirmation: 'SOURCE_DECLARED' },
    businessVersion: { rawRevision: 'ORIGINAL ISSUE', rawIteration: null, confirmation: 'SOURCE_DECLARED' },
    sourceAttachmentId: 'OR:wt.content.ApplicationData:901', sourceAttachmentVersion: null,
    filename: 'synthetic.pdf', mediaType: 'application/pdf', sha256: 'a'.repeat(64), byteLength: 100,
    selection: { bucketId: 'synthetic', filePath: 'tdms-source/uploads/synthetic', expectedProviderObjectId: 'synthetic' } };
  for (const action of Object.values(f.actions)) action.permittedMembers = { records: [owner],
    artifacts: [{ memberId: binding.bindingId, sourceAttachmentId: binding.sourceAttachmentId,
      sourceAttachmentVersion: null, owners: [owner] }], relationIds: [], relatedDocumentVersionIds: [] };
  const state = { sqlActor: a.canonicalSubject.id, sourceReads: 0, session: true,
    afterRead: undefined as (() => void) | undefined,
    afterCommit: undefined as (() => void) | undefined };
  const dialect = new PgDialect();
  const execute = jest.fn(async (query: SQL) => {
    const { sql } = dialect.sqlToQuery(query);
    if (sql.includes('current_schema()')) return [{ actorId: state.sqlActor,
      schemaName: 'workspace_aadkpkjef3slu', roleName: 'authenticated_workspace_aadkpkjef3slu' }];
    if (sql.includes('tdms_act_bound_identity')) return [{ bound: true }];
    if (sql.includes('pg_advisory_xact_lock_shared')) return [];
    if (sql.includes('SELECT r.receiver_id')) return [{ receiverId: f.row.receiverId }];
    const rows = [structuredClone(f.row)];
    state.sourceReads++;
    state.afterRead?.();
    return rows;
  });
  const database = { execute, transaction: async (run: (db: unknown) => Promise<unknown>) => {
    const result = await run(database);
    state.afterCommit?.();
    return result;
  } } as unknown as PostgresJsDatabase;
  const validate = jest.fn(async () => state.session ? { identity: {
    subjectMappingId: 'synthetic-mapping', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
    miaodaUserId: a.canonicalSubject.id, tenantId: a.tenantId, feishuUserId: null, feishuOpenId: 'synthetic-open',
    namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'synthetic-open', tenantKey: 'synthetic' },
    verifiedAt: new Date().toISOString(),
  }, sessionId: 'synthetic-session', revision: 1, expiresAt: new Date(Date.now() + 60_000) } : null);
  const sqlRequests: Request[] = [];
  const sessions = new SessionResolver({ validate } as never,
    { applicationScopeId: a.applicationScopeId, sessionEnvironment: a.env } as never,
    { use: (req: Request, _res: unknown, next: () => void) => { sqlRequests.push(req); next(); } } as never);
  const repository = new TdmsReceiverRepository(database, { current: () => ({ tenantId: a.tenantId, clientId: 'synthetic' }) });
  const adapter = new TdmsDocumentSourceReadAdapter(sessions, repository, new MiaodaTdmsSourceAuthorization(repository));
  const input: DocumentSourceReadInput = { actorUserId: a.canonicalSubject.id, tenantId: a.tenantId,
    documentVersionId: 'DV-exact', sourceReadContext: contextFromRequest(request).sourceReadContext,
    provenance: { documentVersionId: 'DV-exact', sourceArtifactId: 'SA-exact', sha256: binding.sha256,
      byteLength: binding.byteLength, independentOrdinary: false, sourceBindings: [binding] } };
  return { adapter, input, request, f, state, validate, sqlRequests };
}

describe('current TDMS document Source rights under native SSO', () => {
  afterEach(() => jest.restoreAllMocks());
  it('accepts the real server request with no OAuth cookie and uses the same native actor SQL', async () => {
    const f = setup();
    expect(documentSourceReadRequest(f.input.sourceReadContext)).toBe(f.request);
    await expect(f.adapter.assertCurrent(f.input)).resolves.toBeUndefined();
    expect(f.validate).not.toHaveBeenCalled();
    expect(f.sqlRequests).toEqual([f.request]);
    expect(f.sqlRequests[0].userContext?.isSystemAccount).not.toBe(true);
    expect(f.state.sourceReads).toBeGreaterThan(1);
  });
  it.each(['forged', 'copied'] as const)('rejects a %s request reference before Source/SQL IO', async (kind) => {
    const f = setup();
    const sourceReadContext = kind === 'copied' ? { ...f.input.sourceReadContext! }
      : { kind: 'SERVER_HTTP_DOCUMENT_SOURCE_READ' as const };
    await expect(f.adapter.assertCurrent({ ...f.input, sourceReadContext }))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
    expect(f.state.sourceReads).toBe(0);
  });
  it('rejects another native actor against the admitted document request', async () => {
    const f = setup();
    f.request.userContext!.userId = 'other-user';
    await expect(f.adapter.assertCurrent(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_IDENTITY_MISMATCH' });
    expect(f.state.sourceReads).toBe(0);
  });
  it('rejects a SQL actor mismatch even with a matching native request', async () => {
    const f = setup(); f.state.sqlActor = 'other-user';
    await expect(f.adapter.assertCurrent(f.input)).rejects.toMatchObject({ code: 'TDMS_RECEIVER_SQL_ACTOR_MISMATCH' });
    expect(f.state.sourceReads).toBe(0);
  });
  it('rechecks exact Source members after an in-flight revocation', async () => {
    const f = setup();
    f.state.afterRead = () => { f.f.actions.READ_RECORD.allowed = false; };
    await expect(f.adapter.assertCurrent(f.input)).rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND' });
  });
  it('keeps an existing OAuth session bound and refuses its disappearance during Source checks', async () => {
    const f = setup(); f.request.headers.cookie = 'wl_session=synthetic-token';
    f.state.afterRead = () => { f.state.session = false; };
    await expect(f.adapter.assertCurrent(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_SESSION_REQUIRED' });
  });
  it('refuses Source expiry after the transaction callback finishes but before its commit returns', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const f = setup();
    f.f.row.validUntil = new Date(now + 5_000).toISOString();
    f.state.afterCommit = () => clock.mockReturnValue(now + 5_001);
    await expect(f.adapter.assertCurrent(f.input)).rejects.toMatchObject({ code: 'TDMS_SOURCE_PERMISSION_CHANGED' });
    expect(f.state.sourceReads).toBeGreaterThan(1);
  });
  it('refuses an admitted OAuth session expiry during the commit return wait', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const f = setup(); f.request.headers.cookie = 'wl_session=synthetic-token';
    f.state.afterCommit = () => clock.mockReturnValue(now + 60_001);
    await expect(f.adapter.assertCurrent(f.input)).rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_SESSION_REQUIRED' });
    expect(f.state.sourceReads).toBeGreaterThan(1);
  });
  it('keeps ordinary acquisition reads available while un-delegated runtime strings cannot read Source-only documents', async () => {
    const f = setup();
    const catalog = { readDocumentSourceReadProvenance: jest.fn(async () => f.input.provenance),
      readOwnedAcquisitionVersionBinding: jest.fn(async () => true) };
    const authorizer = new OrdinaryDocumentManagementAuthorizer({ loadTenantDocumentAuthorizationBinding: async () => null } as never,
      {} as never, catalog as never, undefined, f.adapter);
    const input = { actorUserId: f.input.actorUserId, tenantId: f.input.tenantId, roles: [],
      action: 'DOCUMENT_READ' as const, documentVersionId: f.input.documentVersionId };
    await expect(authorizer.assertCanRead(input)).rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED' });
    f.input.provenance.independentOrdinary = true;
    await expect(authorizer.assertCanRead(input)).resolves.toBeUndefined();
    expect(catalog.readOwnedAcquisitionVersionBinding).toHaveBeenCalled();
  });
});
