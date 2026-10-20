import { MiaodaTdmsDocumentAccess } from '@server/modules/tdms-source/miaoda-tdms-document-access';
import { TdmsSourceController } from '@server/modules/tdms-source/tdms-source.controller';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import type { DocumentManagementIngestAuthorizer } from '@server/modules/document-management/src/hosted/nest/document-management-hosted.tokens';
import type { TdmsArtifactStore, TdmsDocumentCataloguePage, TdmsRepository,
  TdmsSourceAuthorization, TdmsSourceScope, TdmsStoredRevision, TdmsTransaction } from '@server/modules/tdms-source/tdms-source.types';
import { fixture } from './tdms-single-primary-formal-registration.fixture';

/** Local original bytes + actual DM Core/controllers/authorizer/Source adapter.
 * Catalog, FileService, source decisions and SQL persistence are explicit test ports. */
async function setup() {
  const f = fixture();
  await f.stage();
  const candidate = await f.dailyController.submit(f.request, f.env, {});
  const registration = await f.register();
  if (!registration.documentVersionId) throw new Error('FORMAL_TEST_REGISTRATION_REQUIRED');
  const authorizer = Reflect.get(f.documents, 'authorizer') as DocumentManagementIngestAuthorizer;
  const documents = new MiaodaTdmsDocumentAccess(authorizer, f.catalog as never);
  const pages: TdmsDocumentCataloguePage[] = [];
  const repository: TdmsRepository = { transaction: <T>(operation: (tx: TdmsTransaction) => Promise<T>) =>
    f.repository.transaction(tx => operation({ ...tx,
      documentVersionCatalogue: async (scope: TdmsSourceScope, page: TdmsDocumentCataloguePage) => {
        pages.push(page);
        return f.repository.state.revisions.filter((row: TdmsStoredRevision) => row.scope.scopeId === scope.scopeId &&
          (row.record.relatedDocumentVersionIds.includes(page.documentVersionId) ||
            page.sourceRevisionRefs?.includes(row.record.sourceRevisionRef)) &&
          (page.permittedRecords === undefined || page.permittedRecords.some(member =>
            member.recordKind === row.record.recordKind && member.sourceRecordId === row.record.sourceRecordId)) &&
          (!page.after || row.record.sourceRevisionRef > page.after))
          .sort((a: TdmsStoredRevision, b: TdmsStoredRevision) => a.record.sourceRevisionRef.localeCompare(b.record.sourceRevisionRef))
          .slice(0, page.limit);
      },
    })) };
  const service = new TdmsSourceService(repository,
    Reflect.get(f.service, 'authorization') as TdmsSourceAuthorization,
    Reflect.get(f.service, 'artifacts') as TdmsArtifactStore, documents, f.formal);
  return { ...f, candidate, registration, controller: new TdmsSourceController(service), pages };
}

describe('single PRIMARY existing registration lineage reaches the actual library source consumer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the exact retained original through DVI, catalogue, revision and history without rewriting capture or source', async () => {
    const f = await setup();
    const versionId = f.registration.documentVersionId!;
    const before = JSON.stringify({ captures: f.repository.state.captures, revisions: f.repository.state.revisions });
    const read = await f.controller.documentVersion(f.request, versionId, { limit: '1' });
    expect(read.sourceStatus).toBe('AVAILABLE');
    expect(read.records).toHaveLength(1);
    const record = read.records[0]!.record;
    expect(record.relatedDocumentVersionIds).toEqual([versionId]);
    expect(record.sourceVersion).toEqual(f.env.package.records[0]!.sourceVersion);
    expect(record.businessVersion).toEqual(f.env.package.records[0]!.businessVersion);
    expect(read.records[0]!.receipt).toMatchObject({ engineeringAdoption: 'NOT_CREATED', executionVerified: false });
    expect(f.pages[0]).toMatchObject({ documentVersionId: versionId, limit: 2,
      sourceRevisionRefs: [record.sourceRevisionRef] });
    const catalogue = await f.controller.catalogue(f.request, { documentVersionId: versionId });
    expect(catalogue.records[0]!.relatedDocumentVersionIds).toEqual([versionId]);
    const exact = await f.controller.record(f.request, record.sourceRevisionRef, { documentVersionId: versionId });
    expect(exact.record.relatedDocumentVersionIds).toEqual([versionId]);
    const history = await f.controller.history(f.request, record.sourceRevisionRef, { documentVersionId: versionId });
    expect(history.versions[0]!.relatedDocumentVersionIds).toEqual([versionId]);
    expect(JSON.stringify({ captures: f.repository.state.captures, revisions: f.repository.state.revisions })).toBe(before);
    expect(f.candidate.documentVersionMappings[0]!.documentVersionId).toBeNull();
    expect(f.catalog.commits).toBe(1);
  });

  it('current READ_RECORD works after IMPORT revocation and still refuses current source read revocation', async () => {
    const f = await setup();
    f.f.actions.IMPORT.allowed = false;
    f.f.row.grantRevision++; f.f.row.permissionRevision = 'synthetic-read-only-after-import-revocation';
    await expect(f.controller.documentVersion(f.request, f.registration.documentVersionId!, {}))
      .resolves.toMatchObject({ sourceStatus: 'AVAILABLE' });
    f.f.actions.READ_RECORD.allowed = false;
    await expect(f.controller.documentVersion(f.request, f.registration.documentVersionId!, {}))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
  });

  it('an independently authorized reader uses exact DM lineage without borrowing the importer association', async () => {
    const f = await setup();
    const currentReader = 'synthetic-independent-library-reader';
    const token = 'synthetic-independent-library-session';
    f.readSessionRecords.set(token, { ...f.readSession, actorUserId: currentReader,
      sessionId: 'synthetic-independent-library-session-id' });
    const request = { ...f.request, headers: { cookie: `wl_session=${token}` },
      userContext: { ...f.request.userContext!, userId: currentReader } };
    f.f.row.actorSubjectId = currentReader;
    f.f.row.grantRevision++; f.f.row.permissionRevision = 'synthetic-independent-reader-current';
    f.f.actions.IMPORT.allowed = false;
    await expect(f.controller.documentVersion(request as never, f.registration.documentVersionId!, {}))
      .resolves.toMatchObject({ sourceStatus: 'AVAILABLE', records: [expect.objectContaining({
        record: expect.objectContaining({ sourceRecordId: f.env.package.records[0]!.sourceRecordId }),
      })] });
    expect(f.catalog.commits).toBe(1);
  });

  it('an unknown DVI, missing HTTP session and mismatched capture lineage are separate failures', async () => {
    const f = await setup();
    await expect(f.controller.documentVersion(f.request, 'DV-not-the-registered-version', {}))
      .rejects.toMatchObject({ code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 });
    const cookie = f.request.headers.cookie;
    delete f.request.headers.cookie;
    await expect(f.controller.documentVersion(f.request, f.registration.documentVersionId!, {}))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_SESSION_REQUIRED', statusCode: 401 });
    f.request.headers.cookie = cookie;
    const capture = f.repository.state.captures[0]!;
    capture.packageHash = '0'.repeat(64);
    await expect(f.controller.documentVersion(f.request, f.registration.documentVersionId!, {}))
      .rejects.toMatchObject({ code: 'TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT', statusCode: 409 });
    expect(f.catalog.commits).toBe(1);
  });
});
