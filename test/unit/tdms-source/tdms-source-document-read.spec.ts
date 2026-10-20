import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { StreamableFile } from '@nestjs/common';
import { DocumentManagementHostedController } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentManagementHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { DocumentParsingHostedController } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.controller';
import { DocumentParsingHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-parsing-hosted.service';
import { OrdinaryDocumentManagementAuthorizer } from '../../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { TdmsFormalDocumentRegistrationService } from '../../../server/modules/tdms-source/tdms-formal-document-registration.service';
import { TdmsDocumentSourceReadAdapter } from '../../../server/modules/tdms-source/tdms-document-source-read.adapter';
import { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import type { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import { SessionResolver } from '../../../server/modules/identity/session-resolver.service';
import type { OAuthConfigPort } from '../../../server/modules/identity/oauth-config.port';
import type { VerifiedIdentity } from '../../../server/modules/identity/identity.types';
import type { DocumentSourceReadProvenance } from '../../../server/modules/document-management/src/hosted/nest/document-source-read.port';
import { currentDocumentSourceReadContext, mintDocumentSourceReadContext } from '../../../server/modules/document-management/src/hosted/nest/document-source-read.port';
import type { TdmsDocumentUploadBinding } from '../../../server/modules/document-management/src/hosted/nest/document-upload-authority';
import { MineruArtifactStore, type MineruParseResult } from '../../../server/modules/professional-input/mineru/mineru-artifact-store';
import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
import { fixture, copy } from './tdms-single-primary-formal-registration.fixture';
import { actor } from './tdms-fixtures';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const SOURCE_NOT_FOUND = { code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 };

/** Actual services/authorizer/adapter/session resolver; storage and registry are explicit memory ports.
 * The Catalog SQL/classification itself is tested in miaoda-hosted-document-catalog-acquisition.spec.
 * No network, PG/RLS, model, official parse invocation or real Source grant is exercised. */
async function sourceDocument() {
  const f = fixture();
  const current = actor();
  const state = { independentOrdinary: false, ordinaryAllowed: true, workItem: false,
    sessionValid: true, sessionActor: current.canonicalSubject.id, sessionTenant: current.tenantId,
    sessionRevision: 1, sqlDepth: 0, guardIo: false, sourceFailure: null as Error | null,
    beforeDownload: undefined as undefined | (() => void) };
  const request = { ...f.request, headers: { cookie: 'wl_session=synthetic-private-read-session' } } as Request;
  const receivers = Reflect.get(f.receiver, 'receivers') as TdmsReceiverRepository;
  const authorization = Reflect.get(f.service, 'authorization') as MiaodaTdmsSourceAuthorization;
  const originalTransaction = receivers.transaction.bind(receivers);
  const transaction = jest.spyOn(receivers, 'transaction').mockImplementation(async operation => {
    state.sqlDepth++;
    try { return await originalTransaction(operation); } finally { state.sqlDepth--; }
  });
  const memberRead = jest.spyOn(authorization, 'authorizeReadMembers');
  const originalAuthorities = receivers.authorities.bind(receivers);
  jest.spyOn(receivers, 'authorities').mockImplementation(async (...args) => {
    if (state.sourceFailure) throw state.sourceFailure;
    return originalAuthorities(...args);
  });
  const store = { validate: jest.fn(async (_token: string, _database?: unknown) => {
    if (!state.sessionValid) return null;
    const identity: VerifiedIdentity = { subjectMappingId: 'synthetic-mapping', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      miaodaUserId: state.sessionActor, tenantId: state.sessionTenant, feishuUserId: null, feishuOpenId: 'synthetic-open-id',
      namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'synthetic-open-id', tenantKey: 'synthetic-tenant-key' },
      verifiedAt: '2026-10-18T00:00:00.000Z' };
    return { identity, revision: state.sessionRevision, sessionId: 'synthetic-session-id', expiresAt: new Date(Date.now() + 60_000) };
  }) };
  const oauth: OAuthConfigPort = { clientId: 'synthetic-client', redirectUri: null, configured: true, tokenApiVersion: 'v3',
    mappingBootstrap: { kind: 'DISABLED' }, applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'preview' };
  const middleware = { use: jest.fn((_request: Request, _response: unknown, next: () => void) => next()) };
  const sessions = new SessionResolver(store as never, oauth, middleware as never);
  const sourceRead = new TdmsDocumentSourceReadAdapter(sessions, receivers, authorization);
  const provenanceRead = jest.fn(async (input: { documentVersionId: string; tenantId: string }): Promise<DocumentSourceReadProvenance | null> => {
    const version = f.catalog.versions.get(input.documentVersionId);
    const family = version && f.catalog.families.get(String(version.familyId));
    if (!version || !family || !String(family.canonicalIdentityKey).startsWith(`tenant:${encodeURIComponent(input.tenantId)}:family:`)) return null;
    const acquisitions = [...f.catalog.acquisitions.values()].filter(row => row.documentVersionId === input.documentVersionId &&
      row.sourceArtifactId === version.sourceArtifactId && ['COMMITTED_CANONICAL', 'LINKED_EXACT_DOCUMENT_VERSION'].includes(String(row.status)));
    return { documentVersionId: input.documentVersionId, sourceArtifactId: String(version.sourceArtifactId),
      sha256: String(version.pdfSha256), byteLength: Number(version.byteLength), independentOrdinary: state.independentOrdinary,
      sourceBindings: acquisitions.flatMap(row => {
        const descriptor = row.sourceDescriptor as { tdmsRegistration?: TdmsDocumentUploadBinding };
        return descriptor.tdmsRegistration ? [copy(descriptor.tdmsRegistration)] : [];
      }) };
  });
  const catalog = Object.assign(f.catalog, { readDocumentSourceReadProvenance: provenanceRead });
  const ordinary = jest.spyOn(catalog, 'readOwnedAcquisitionVersionBinding').mockImplementation(async input =>
    state.ordinaryAllowed && catalog.versions.has(input.documentVersionId));
  const workItems = { loadTenantDocumentAuthorizationBinding: jest.fn(async () => state.workItem ? { workItemId: 'synthetic-linked-wi' } : null) };
  const scoped = f.f.files.from();
  const download = jest.fn((filePath: string) => {
    const load = async () => {
      if (state.guardIo) expect(state.sqlDepth).toBe(0);
      state.beforeDownload?.();
      return scoped.download(filePath).asStream();
    };
    return { asStream: load, then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      load().then(value => ({ metadata: value.metadata, content: new Blob([Buffer.from(value.content)]) })).then(resolve, reject) };
  });
  const files = { ...f.f.files, from: () => ({ ...scoped, download }) };
  const authorizer = new OrdinaryDocumentManagementAuthorizer(workItems as never, files as never, catalog as never, undefined, sourceRead);
  const documents = new DocumentManagementHostedService(files as never, catalog as never, authorizer,
    { organizeDocumentIntake: async () => ({ matterId: 'synthetic-family-matter' }) } as never);
  const formal = new TdmsFormalDocumentRegistrationService(f.receiver, documents);
  await f.stage();
  const registration = await formal.register(request, f.env.requestId, f.observation.bindingId, { package: f.env.package });
  expect(registration).toMatchObject({ status: 'COMMITTED', readbackVerified: true, sha256: digest(f.bytes) });
  state.guardIo = true;
  memberRead.mockClear(); transaction.mockClear(); download.mockClear(); provenanceRead.mockClear(); ordinary.mockClear(); workItems.loadTenantDocumentAuthorizationBinding.mockClear();
  const controller = new DocumentManagementHostedController(documents, sessions);
  const revoke = () => { f.f.actions.READ_RECORD.allowed = false; f.f.row.grantRevision++; f.f.row.permissionRevision = 'synthetic-revoked-read'; };
  return { ...f, state, request, catalog, authorization, sourceRead, authorizer, documents, controller, registration,
    memberRead, transaction, download, provenanceRead, ordinary, workItems, sessions, store, files, revoke, receivers };
}

async function streamBytes(stream: StreamableFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream.getStream()) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function published(f: Awaited<ReturnType<typeof sourceDocument>>) {
  const version = f.catalog.versions.get(f.registration.documentVersionId)!;
  const binding = { documentVersionId: String(version.documentVersionId), documentId: String(version.documentId), familyId: String(version.familyId),
    sourceArtifactId: String(version.sourceArtifactId), pdfSha256: String(version.pdfSha256), byteLength: Number(version.byteLength) };
  const markdown = 'Persisted synthetic published text.\n\n![One](images/one.png)';
  const middle = { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: [{ page_idx: 0, page_size: [1000, 1000] }] };
  const contentListV2 = [[{ type: 'paragraph', bbox: [10, 10, 100, 100],
    content: { paragraph_content: [{ type: 'text', content: 'Persisted synthetic published text.' }] } }]];
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const result: MineruParseResult = { sourceSha256: binding.pdfSha256, sourceByteLength: binding.byteLength,
    rawArtifacts: { markdown, middle, contentListV2 }, middle, contentListV2,
    document: readMineruArtifacts({ markdown, middle, contentListV2, assetPaths: ['images/one.png'] }),
    assets: [{ path: 'images/one.png', mediaType: 'image/png', bytes: image, sha256: digest(image) }], titleEnhancement: { status: 'DISABLED' } };
  const saved = await new MineruArtifactStore(f.files as never).persist({ scope: { documentVersionId: binding.documentVersionId,
    parseRunId: 'synthetic-published', bucketId: f.selection.bucketId }, documentVersion: binding, result });
  const run = { documentVersionId: binding.documentVersionId, actorUserId: actor().canonicalSubject.id, tenantId: actor().tenantId,
    parseRunId: 'synthetic-published', requestId: 'synthetic-already-published', parseRevision: 1, status: 'PUBLISHED',
    sourceBinding: binding, bucketId: f.selection.bucketId, artifactProgress: saved.manifest.artifacts,
    manifestArtifact: saved.manifestArtifact, errorCode: null, startedAt: new Date(), deadlineAt: new Date(Date.now() + 60_000), completedAt: new Date() };
  const repository = { current: jest.fn(async () => ({ published: run, latest: run })), read: jest.fn(async () => run) };
  const service = new DocumentParsingHostedService(f.files as never, f.catalog as never, repository as never,
    { configured: () => false } as never, {} as never, f.authorizer);
  return { controller: new DocumentParsingHostedController(service, f.authorizer), repository, run, image, markdown };
}

// These tests deliberately require the same two explicit local paths as the existing formal-registration fixture.
// No skipped security checks or default synthetic grant are substituted when the input is absent.
describe('ordinary DVI Source read: real controllers/services with explicit external ports', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows current exact READ_RECORD for original, identity and requested PDF pages; IMPORT is independent', async () => {
    const f = await sourceDocument();
    f.f.actions.IMPORT.allowed = false;
    const identity = await f.controller.readDocumentOriginalIdentity(f.registration.documentVersionId, f.request);
    const original = await streamBytes(await f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request));
    const pages = await f.controller.readDocumentSourcePages(f.registration.documentVersionId, { pageStart: '1', pageEnd: '1' }, f.request);
    expect(identity).toMatchObject({ sha256: digest(f.bytes), byteLength: f.bytes.length });
    expect(digest(original)).toBe(digest(f.bytes));
    expect(pages).toMatchObject({ documentVersionId: f.registration.documentVersionId });
    expect(f.memberRead).toHaveBeenCalled();
    for (const call of f.memberRead.mock.calls) {
      expect(call[0].identityProvenance).toBe('MIAODA_GATEWAY_USER_CONTEXT');
      expect(call[2]).toBe('READ_RECORD');
      expect(call[3].records).toEqual([{ recordKind: 'MANUFACTURER_FILE', sourceRecordId: f.env.package.records[0]!.sourceRecordId }]);
      expect(call[3].artifacts).toEqual([{ memberId: f.observation.bindingId, sourceAttachmentId: f.observation.sourceAttachmentId,
        sourceAttachmentVersion: null, owners: call[3].records }]);
    }
    expect(f.state.sqlDepth).toBe(0);
  });

  it.each(['original', 'identity', 'pages'] as const)('revocation blocks %s before FileService bytes, even after a successful prior read', async route => {
    const f = await sourceDocument();
    await f.controller.readDocumentOriginalIdentity(f.registration.documentVersionId, f.request);
    f.revoke(); f.download.mockClear();
    const operation = route === 'original' ? f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)
      : route === 'identity' ? f.controller.readDocumentOriginalIdentity(f.registration.documentVersionId, f.request)
        : f.controller.readDocumentSourcePages(f.registration.documentVersionId, { pageStart: '1' }, f.request);
    await expect(operation).rejects.toMatchObject(SOURCE_NOT_FOUND);
    expect(f.download).not.toHaveBeenCalled();
  });

  it('same-tenant non-grantee and Source-only WorkItem binding do not acquire ordinary access', async () => {
    const f = await sourceDocument();
    f.state.workItem = true;
    f.request.userContext!.userId = 'synthetic-same-tenant-outsider'; f.state.sessionActor = 'synthetic-same-tenant-outsider';
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)).rejects.toMatchObject(SOURCE_NOT_FOUND);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.workItems.loadTenantDocumentAuthorizationBinding).not.toHaveBeenCalled();
  });

  it.each(['missing-cookie', 'revoked-session', 'session-actor', 'session-tenant', 'gateway-tenant'] as const)(
    '%s fails before any original bytes', async failure => {
      const f = await sourceDocument();
      if (failure === 'missing-cookie') f.request.headers.cookie = undefined;
      if (failure === 'revoked-session') f.state.sessionValid = false;
      if (failure === 'session-actor') f.state.sessionActor = 'synthetic-wrong-session-actor';
      if (failure === 'session-tenant') f.state.sessionTenant = 'synthetic-wrong-session-tenant';
      if (failure === 'gateway-tenant') f.request.userContext!.tenantId = 7654321;
      await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)).rejects.toBeDefined();
      expect(f.download).not.toHaveBeenCalled();
    },
  );

  it('does not accept a JSON copy of the opaque request carrier or an absent runtime delegation', async () => {
    const f = await sourceDocument();
    const context = { actorUserId: actor().canonicalSubject.id, tenantId: actor().tenantId, roles: [],
      appId: actor().applicationScopeId, env: actor().env, sourceReadContext: copy(mintDocumentSourceReadContext(f.request)) };
    await expect(f.documents.readDocumentOriginal(f.registration.documentVersionId, context))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
    await expect(f.documents.readDocumentSourcePagesForRuntime(f.registration.documentVersionId, { pageStart: '1' }, context))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
    expect(f.download).not.toHaveBeenCalled();
  });

  it('accepts a different independently current Source reader without requiring historical importer or grant revision', async () => {
    const f = await sourceDocument();
    f.request.userContext!.userId = 'synthetic-current-source-reader'; f.state.sessionActor = 'synthetic-current-source-reader';
    f.f.row.actorSubjectId = 'synthetic-current-source-reader'; f.f.row.grantRevision += 10;
    f.f.row.permissionRevision = 'synthetic-current-reader-permission';
    expect(digest(await streamBytes(await f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request))))
      .toBe(digest(f.bytes));
    expect(f.memberRead.mock.calls.every(call => call[0].canonicalSubject.id === 'synthetic-current-source-reader')).toBe(true);
  });

  it('metadata-only member permission cannot authorize full original bytes', async () => {
    const f = await sourceDocument();
    for (const member of f.f.actions.READ_RECORD.permittedMembers.artifacts) member.metadataOnly = true;
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)).rejects.toBeDefined();
    expect(f.download).not.toHaveBeenCalled();
  });

  it('checks current Source again after original I/O and drops already fetched bytes on revocation', async () => {
    const f = await sourceDocument();
    f.state.beforeDownload = f.revoke;
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)).rejects.toMatchObject(SOURCE_NOT_FOUND);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.state.sqlDepth).toBe(0);
  });

  it('a genuinely independent ordinary path still needs the current ordinary right and never needs a Source session', async () => {
    const f = await sourceDocument();
    f.state.independentOrdinary = true; f.state.sessionValid = false; f.revoke();
    expect(digest(await streamBytes(await f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request))))
      .toBe(digest(f.bytes));
    expect(f.memberRead).not.toHaveBeenCalled();
    f.state.ordinaryAllowed = false; f.download.mockClear();
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)).rejects.toMatchObject({ code: 'DOCUMENT_VERSION_NOT_FOUND' });
    expect(f.download).not.toHaveBeenCalled();
  });

  it('a Source storage failure is not converted into tenant, WorkItem or pending access', async () => {
    const f = await sourceDocument(); f.state.workItem = true;
    f.state.sourceFailure = Object.assign(new Error('synthetic Source registry failure'), { code: 'TDMS_RECEIVER_AUTHORITY_STORAGE_UNCONFIGURED', statusCode: 503 });
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request))
      .rejects.toMatchObject({ code: 'TDMS_RECEIVER_AUTHORITY_STORAGE_UNCONFIGURED', statusCode: 503 });
    expect(f.download).not.toHaveBeenCalled(); expect(f.workItems.loadTenantDocumentAuthorizationBinding).not.toHaveBeenCalled();
  });

  it('reads already-published text/assets through the real parse service and rechecks on a cached repeat', async () => {
    const f = await sourceDocument(); const p = await published(f);
    const reading = await p.controller.read(f.registration.documentVersionId, undefined, f.request);
    expect(reading.markdown).toBe(p.markdown);
    const image = await streamBytes(await p.controller.asset(f.registration.documentVersionId, p.run.parseRunId, 'images/one.png', f.request));
    expect(image).toEqual(p.image);
    f.revoke(); f.download.mockClear();
    await expect(p.controller.read(f.registration.documentVersionId, undefined, f.request)).rejects.toMatchObject(SOURCE_NOT_FOUND);
    await expect(p.controller.asset(f.registration.documentVersionId, p.run.parseRunId, 'images/one.png', f.request)).rejects.toMatchObject(SOURCE_NOT_FOUND);
    expect(f.download).not.toHaveBeenCalled();
  });

  it.each(['reading', 'asset'] as const)('drops %s derived output if permission is revoked during persisted artifact I/O', async kind => {
    const f = await sourceDocument(); const p = await published(f);
    f.state.beforeDownload = f.revoke;
    const operation = kind === 'reading' ? p.controller.read(f.registration.documentVersionId, undefined, f.request)
      : p.controller.asset(f.registration.documentVersionId, p.run.parseRunId, 'images/one.png', f.request);
    await expect(operation).rejects.toMatchObject(SOURCE_NOT_FOUND);
    expect(f.download).toHaveBeenCalled(); expect(f.state.sqlDepth).toBe(0);
  });

  it('rejects an OAuth session actor injected as Gateway; actual Source validator never accepts the swapped provenance', async () => {
    const f = await sourceDocument();
    const session = await f.sessions.resolve(f.request);
    expect(session?.actor.identityProvenance).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
    const claims = { records: [{ recordKind: 'MANUFACTURER_FILE', sourceRecordId: f.env.package.records[0]!.sourceRecordId }],
      artifacts: [{ memberId: f.observation.bindingId, sourceAttachmentId: f.observation.sourceAttachmentId,
        sourceAttachmentVersion: null, owners: [{ recordKind: 'MANUFACTURER_FILE', sourceRecordId: f.env.package.records[0]!.sourceRecordId }] }],
      relationIds: [] };
    await expect(f.authorization.authorizeReadMembers(session!.actor, {
      tenantId: actor().tenantId, sourceKey: 'TDMS', sourceInstanceId: f.f.row.sourceInstanceId, scopeId: f.f.row.scopeId,
    }, 'READ_RECORD', claims))
      .rejects.toMatchObject({ code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED', statusCode: 401 });
    jest.spyOn(f.sessions, 'withNativeBrowserIdentity').mockImplementation(async (_request, operation) =>
      operation({ actor: session!.actor, oauthSession: session }));
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request))
      .rejects.toMatchObject({ code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED', statusCode: 401 });
    expect(f.download).not.toHaveBeenCalled();
  });

  it('fresh session revocation inside the Source authorization transaction rejects before file I/O', async () => {
    const f = await sourceDocument();
    const actual = f.memberRead.getMockImplementation()!;
    f.memberRead.mockImplementation(async (...args) => {
      const admitted = await actual.apply(f.authorization, args);
      f.state.sessionValid = false;
      return admitted;
    });
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_SESSION_REQUIRED', statusCode: 401 });
    expect(f.download).not.toHaveBeenCalled(); expect(f.state.sqlDepth).toBe(0);
    expect(f.store.validate.mock.calls.some(call => call[1] !== undefined)).toBe(true);
  });

  it.each(['scope-not-found', 'exact-member-denied'] as const)('a second genuinely authorized Source path survives a first %s path', async denied => {
    const f = await sourceDocument();
    const provenance = await f.provenanceRead({ documentVersionId: f.registration.documentVersionId, tenantId: actor().tenantId });
    expect(provenance).not.toBeNull();
    const first = copy(provenance!.sourceBindings[0]);
    if (denied === 'scope-not-found') first.scope.sourceInstanceId = 'synthetic-other-source-instance';
    else first.bindingId = 'TDMSBIND-' + 'f'.repeat(64);
    f.provenanceRead.mockResolvedValue({ ...provenance!, sourceBindings: [first, ...provenance!.sourceBindings] });
    const bytes = await streamBytes(await f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request));
    expect(digest(bytes)).toBe(digest(f.bytes));
    expect(f.memberRead.mock.calls.length).toBeGreaterThanOrEqual(4); // both source paths at both I/O checkpoints
  });

  it.each([
    ['storage', 'TDMS_RECEIVER_AUTHORITY_STORAGE_UNCONFIGURED', 503],
    ['permission-drift', 'TDMS_SOURCE_PERMISSION_CHANGED', 409],
    ['forged-notfound-status', 'TDMS_SOURCE_NOT_FOUND', 503],
    ['forged-member-status', 'TDMS_RECEIVER_EXACT_MEMBER_DENIED', 503],
  ] as const)('a %s error stops Source alternatives and cannot fall through to another successful path', async (_label, code, statusCode) => {
    const f = await sourceDocument();
    const provenance = await f.provenanceRead({ documentVersionId: f.registration.documentVersionId, tenantId: actor().tenantId });
    f.provenanceRead.mockResolvedValue({ ...provenance!, sourceBindings: [...provenance!.sourceBindings, ...provenance!.sourceBindings] });
    const failure = Object.assign(new Error('injected exact Source failure'), { code, statusCode });
    f.memberRead.mockRejectedValueOnce(failure);
    await expect(f.controller.readDocumentOriginal(f.registration.documentVersionId, f.request)).rejects.toMatchObject({ code, statusCode });
    expect(f.memberRead).toHaveBeenCalledTimes(1);
    expect(f.download).not.toHaveBeenCalled(); expect(f.state.sqlDepth).toBe(0);
  });


  it.each(['version', 'metadata', 'enrich-cached', 'reextract-replay'] as const)(
    'rechecks Source at return from the %s cached/registry branch, with no file or parse work', async route => {
      const f = await sourceDocument();
      const field = { status: 'NOT_FOUND', observations: [] };
      const archived = { id: 'synthetic-metadata-cache', metadataRevision: 2, requestId: 'cached-source-read', extractedMetadata: {
        schemaVersion: 'wiselink.document_metadata.v1', source: 'ACTUAL_PDF_TEXT', sourceSha256: digest(f.bytes),
        sourceByteLength: f.bytes.length, pageCount: 2, inspectedPages: [1], extractedAt: '2026-10-18T15:00:00.000Z',
        title: field, documentType: field, issuer: field, ata: field, mentionedAircraftModels: field,
        aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY', applicabilityAssessment: 'NOT_EVALUATED',
      } };
      let revokeAfterRead = false;
      const originalSource = f.catalog.readMetadataSource.bind(f.catalog);
      jest.spyOn(f.catalog, 'readMetadataSource').mockImplementation(async id => {
        const row = await originalSource(id);
        if (revokeAfterRead && route !== 'reextract-replay') f.revoke();
        return row ? { ...row, metadata: archived } : null;
      });
      Object.assign(f.catalog, { readExtractedMetadata: jest.fn(async () => {
        if (revokeAfterRead) f.revoke();
        return archived;
      }) });
      const originalFamily = f.catalog.readFamily.bind(f.catalog);
      jest.spyOn(f.catalog, 'readFamily').mockImplementation(async id => {
        const row = await originalFamily(id);
        if (revokeAfterRead) f.revoke();
        return row;
      });
      const operation = () => route === 'version' ? f.controller.getDocumentVersion(f.registration.documentVersionId, f.request)
        : route === 'metadata' ? f.controller.readDocumentMetadata(f.registration.documentVersionId, {}, f.request)
          : route === 'enrich-cached' ? f.controller.enrichDocumentMetadata(f.registration.documentVersionId, f.request)
            : f.controller.reextractDocumentMetadata(f.registration.documentVersionId,
              { requestId: archived.requestId, expectedMetadataRevision: 1 }, f.request);
      await expect(operation()).resolves.toMatchObject(route === 'version' ? { version: { documentVersionId: f.registration.documentVersionId } }
        : { documentVersionId: f.registration.documentVersionId });
      revokeAfterRead = true;
      await expect(operation()).rejects.toMatchObject(SOURCE_NOT_FOUND);
      expect(f.download).not.toHaveBeenCalled(); expect(f.state.sqlDepth).toBe(0);
    },
  );

});


async function dailyHttpDocument() {
  const f = fixture();
  await f.stage();
  const first = await f.dailyController.submit(f.request, f.env, {});
  const registered = await f.register();
  expect(registered).toMatchObject({ status: 'COMMITTED', sha256: digest(f.bytes), readbackVerified: true });
  return { ...f, first, registered };
}

describe('daily HTTP current Request: actual Controller to SourceService to formal projection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('POST/replay/GET and all three SourceRefs share the exact persisted ten-field COMMITTED mapping', async () => {
    expect(currentDocumentSourceReadContext()).toBeUndefined();
    const f = await dailyHttpDocument();
    expect(f.first.documentVersionMappings.every(mapping => mapping.documentVersionId === null)).toBe(true);
    const captureBefore = JSON.stringify(f.repository.state.captures);
    const post = await f.dailyController.submit(f.request, f.env, {});
    const replay = await f.dailyController.submit(f.request, f.env, {});
    const get = await f.dailyController.read(f.request, f.env.requestId, {});
    expect(post.documentVersionMappings).toEqual(replay.documentVersionMappings);
    expect(post.documentVersionMappings).toEqual(get.receipt.documentVersionMappings);
    const mapping = post.documentVersionMappings[0];
    expect(Object.keys(mapping).sort()).toEqual(['requestId', 'bindingId', 'sourceRef', 'status', 'documentVersionId',
      'preflightId', 'sha256', 'byteLength', 'readbackVerified', 'mappedAt'].sort());
    expect(mapping).toMatchObject({ status: 'COMMITTED', documentVersionId: f.registered.documentVersionId,
      preflightId: f.registered.preflightId, sha256: digest(f.bytes), byteLength: f.bytes.length,
      readbackVerified: true, mappedAt: '2026-10-18T15:00:00.000Z' });
    expect(post.sourceRefs).toHaveLength(3);
    for (const sourceRef of post.sourceRefs) {
      const read = await f.dailyController.sourceRef(f.request, { sourceRef });
      expect(read.documentVersionMappings).toEqual(post.documentVersionMappings);
    }
    expect(JSON.stringify(f.repository.state.captures)).toBe(captureBefore);
    expect(f.catalog.commits).toBe(1);
    expect(currentDocumentSourceReadContext()).toBeUndefined();
  });

  it('does not synthesize a Request for raw service POST/GET/SourceRef, including after a successful HTTP read', async () => {
    const f = await dailyHttpDocument();
    await f.dailyController.read(f.request, f.env.requestId, {});
    expect(currentDocumentSourceReadContext()).toBeUndefined();
    const before = f.f.activity.downloads;
    await expect(f.service.importDailyMetadata(actor(), f.env))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
    await expect(f.service.readDailyMetadataImport(actor(), f.env.requestId))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
    for (const sourceRef of f.first.sourceRefs) {
      await expect(f.service.readDailySourceRef(actor(), sourceRef))
        .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
    }
    expect(f.f.activity.downloads).toBe(before);
  });

  it.each(['missing-cookie', 'expired-session', 'revoked-session', 'opaque-actor', 'opaque-tenant', 'gateway-tenant', 'gateway-app'] as const)(
    'daily projection refuses %s before any original bytes', async failure => {
      const f = await dailyHttpDocument();
      if (failure === 'missing-cookie') delete f.request.headers.cookie;
      if (failure === 'expired-session') f.readSession.expiresAt = new Date(Date.now() - 1);
      if (failure === 'revoked-session') f.readSession.valid = false;
      if (failure === 'opaque-actor') f.readSession.actorUserId = 'synthetic-foreign-session-actor';
      if (failure === 'opaque-tenant') f.readSession.tenantId = 'synthetic-foreign-session-tenant';
      if (failure === 'gateway-tenant') f.request.userContext!.tenantId = 7654321;
      if (failure === 'gateway-app') f.request.userContext!.appId = 'synthetic-foreign-host';
      const before = f.f.activity.downloads;
      const operation = (async () => { await f.dailyController.read(f.request, f.env.requestId, {}); })();
      if (failure === 'gateway-app') await expect(operation).rejects.toMatchObject({ code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', statusCode: 503 });
      else if (failure === 'gateway-tenant') await expect(operation).rejects.toMatchObject(SOURCE_NOT_FOUND);
      else if (failure === 'opaque-actor' || failure === 'opaque-tenant')
        await expect(operation).rejects.toMatchObject({ message: 'DIALOGUE_BROWSER_IDENTITY_MISMATCH', status: 403 });
      else await expect(operation).rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_SESSION_REQUIRED', statusCode: 401 });
      expect(f.f.activity.downloads).toBe(before);
      expect(currentDocumentSourceReadContext()).toBeUndefined();
    },
  );

  it('retained IMPORT does not authorize the formal DVI mapping after READ_RECORD is revoked', async () => {
    const f = await dailyHttpDocument();
    f.f.actions.READ_RECORD.allowed = false;
    f.f.row.grantRevision++; f.f.row.permissionRevision = 'synthetic-http-read-revoked';
    expect(f.f.actions.IMPORT.allowed).toBe(true);
    const before = f.f.activity.downloads;
    await expect(f.dailyController.submit(f.request, f.env, {})).rejects.toMatchObject(SOURCE_NOT_FOUND);
    await expect(f.dailyController.read(f.request, f.env.requestId, {})).rejects.toMatchObject(SOURCE_NOT_FOUND);
    for (const sourceRef of f.first.sourceRefs) {
      await expect(f.dailyController.sourceRef(f.request, { sourceRef })).rejects.toMatchObject(SOURCE_NOT_FOUND);
    }
    expect(f.f.activity.downloads).toBe(before);
  });

  it('same-tenant non-grantee obtains neither HTTP Source mapping nor original bytes', async () => {
    const f = await dailyHttpDocument();
    f.request.userContext!.userId = 'synthetic-http-non-grantee'; f.readSession.actorUserId = 'synthetic-http-non-grantee';
    const before = f.f.activity.downloads;
    await expect(f.dailyController.read(f.request, f.env.requestId, {})).rejects.toMatchObject(SOURCE_NOT_FOUND);
    for (const sourceRef of f.first.sourceRefs) {
      await expect(f.dailyController.sourceRef(f.request, { sourceRef })).rejects.toMatchObject(SOURCE_NOT_FOUND);
    }
    const documents = new DocumentManagementHostedController(f.documents, f.readSessions);
    await expect(documents.readDocumentOriginal(f.registered.documentVersionId, f.request)).rejects.toMatchObject(SOURCE_NOT_FOUND);
    expect(f.f.activity.downloads).toBe(before);
  });
});
