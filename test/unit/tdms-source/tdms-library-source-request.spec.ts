import type { Request } from 'express';
import { OrdinaryDocumentManagementAuthorizer } from '@server/modules/document-management-runtime/ordinary-document-management-authorizer';
import {
  currentDocumentSourceReadContext,
  documentSourceReadRequest,
  type DocumentSourceReadInput,
} from '@server/modules/document-management/src/hosted/nest/document-source-read.port';
import { MiaodaTdmsDocumentAccess } from '@server/modules/tdms-source/miaoda-tdms-document-access';
import { TdmsSourceController } from '@server/modules/tdms-source/tdms-source.controller';
import { TdmsSourceService } from '@server/modules/tdms-source/tdms-source.service';
import type { TdmsRepository, TdmsSourceAuthorization, TdmsSourceScope, TdmsTransaction } from '@server/modules/tdms-source/tdms-source.types';
import { MemoryTdmsRepository } from './tdms-memory-double';
import { actor } from './tdms-fixtures';

/** Real Controller -> source service -> document access -> DM authorizer.
 * Source registry, catalog and SQL are explicit synthetic ports, not real grants. */
describe('library TDMS source requests preserve the actual request for current document policy', () => {
  const oldSandbox: string | undefined = process.env.SANDBOX_ID;
  afterAll(() => {
    if (oldSandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = oldSandbox;
  });

  function setup() {
    const native = actor();
    const request: Request = { headers: { cookie: 'wl_session=synthetic-explicit-test-session' },
      userContext: { userId: native.canonicalSubject.id, tenantId: native.tenantId,
        appId: native.applicationScopeId, env: native.env } } as unknown as Request;
    const scope: TdmsSourceScope = { tenantId: native.tenantId, sourceKey: 'TDMS',
      sourceInstanceId: 'synthetic-instance', scopeId: 'synthetic-scope' };
    const state = { allowed: true };
    const sourceRead = { assertCurrent: jest.fn(async (input: DocumentSourceReadInput) => {
      if (documentSourceReadRequest(input.sourceReadContext) !== request)
        throw Object.assign(new Error('DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED'),
          { code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
      if (!state.allowed) throw Object.assign(new Error('TDMS_SOURCE_NOT_FOUND'),
        { code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    }) };
    const catalog = {
      readDocumentSourceReadProvenance: jest.fn(async () => ({ documentVersionId: 'DV-tdms-source',
        sourceArtifactId: 'SRC-synthetic', sha256: 'a'.repeat(64), byteLength: 1,
        independentOrdinary: false, sourceBindings: [{ scope: { ...scope, scopeId: 'synthetic-other-scope' } }] })),
      readOwnedAcquisitionVersionBinding: jest.fn(async () => true),
    };
    const workItems = { loadTenantDocumentAuthorizationBinding: jest.fn(async () => null) };
    const authorizer = new OrdinaryDocumentManagementAuthorizer(workItems as never, {} as never,
      catalog as never, undefined, sourceRead);
    const documents = new MiaodaTdmsDocumentAccess(authorizer, catalog as never);
    const authorization: TdmsSourceAuthorization = {
      available: true,
      catalogue: async () => [{ scope, permissionRevision: 'synthetic-current-1' }],
      authorize: async () => ({ scope, permissionRevision: 'synthetic-current-1' }),
      authorizeImport: async () => { throw new Error('UNEXPECTED_IMPORT'); },
    };
    const memory = new MemoryTdmsRepository();
    const repository: TdmsRepository = { transaction: <T>(operation: (tx: TdmsTransaction) => Promise<T>) => memory.transaction(tx => operation({ ...tx,
      documentVersionCatalogue: async () => [],
    })) };
    const service = new TdmsSourceService(repository, authorization, {} as never, documents);
    return { request, state, sourceRead, service, controller: new TdmsSourceController(service), catalog };
  }

  it('reads an exact version through current Source policy and does not retain its Request after completion', async () => {
    const s = setup();
    await expect(s.controller.documentVersion(s.request, 'DV-tdms-source', {}))
      .resolves.toMatchObject({ documentVersionId: 'DV-tdms-source', sourceStatus: 'NO_BOUND_RECORDS' });
    expect(s.sourceRead.assertCurrent).toHaveBeenCalledTimes(4);
    expect(currentDocumentSourceReadContext()).toBeUndefined();
    await expect(s.service.readDocumentVersion(actor(), { documentVersionId: 'DV-tdms-source' }))
      .rejects.toMatchObject({ code: 'DOCUMENT_SOURCE_READ_CONTEXT_REQUIRED', statusCode: 403 });
  });

  it('a revoked current Source read remains denied after a successful earlier browser request', async () => {
    const s = setup();
    await s.controller.documentVersion(s.request, 'DV-tdms-source', {});
    s.state.allowed = false;
    await expect(s.controller.documentVersion(s.request, 'DV-tdms-source', {}))
      .rejects.toMatchObject({ code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
    expect(currentDocumentSourceReadContext()).toBeUndefined();
  });
});
