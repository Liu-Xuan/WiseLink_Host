jest.mock(
  '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  () => ({ DocumentManagementHostedCore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);
import { DocumentManagementHostedCore } from '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { OrdinaryDocumentManagementAuthorizer } from '../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { mintDocumentUploadAuthority } from '../../server/modules/document-management/src/hosted/nest/document-upload-authority';

const context = {
  actorUserId: 'u1',
  tenantId: 't1',
  appId: 'app_17bzc551rsg',
  env: 'runtime',
  roles: [],
};
const request = {
  requestId: 'ordinary-123',
  selection: { bucketId: 'default', filePath: '1875002688986330.pdf' },
};
const receipt = {
  disposition: 'INGEST_NEW_FAMILY',
  decision: 'INGEST_NEW_FAMILY',
  preflightId: 'pf',
  documentVersionId: 'v1',
  familyId: 'f1',
  newDocumentVersionCreated: true,
  currentnessChanged: true,
  identityReadback: {
    documentNumber: '787-34-001',
    documentFamily: 'SB',
    businessRevision: 'R1',
    revisionDate: '2026-01-01',
    issuerAuthority: 'BOEING',
  },
};

describe('ordinary document library upload', () => {
  const sandbox = process.env.SANDBOX_ID;
  beforeAll(() => {
    process.env.SANDBOX_ID = 'unit-hosted';
  });
  afterAll(() => {
    if (sandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = sandbox;
  });
  function service() {
    const ingest = jest.fn().mockResolvedValue(receipt);
    const organizeDocumentIntake = jest
      .fn()
      .mockResolvedValue({ matterId: 'MAT-family', created: true });
    jest
      .mocked(DocumentManagementHostedCore)
      .mockImplementation(
        () => ({ ingestFileServiceSelection: ingest }) as never,
      );
    return {
      service: new DocumentManagementHostedService(
        {} as never,
        {} as never,
        {} as never,
        { organizeDocumentIntake } as never,
      ),
      ingest,
      organizeDocumentIntake,
    };
  }
  it('returns a bounded 409 for the known exact-identity conflict without stack or internal details', async () => {
    const f = service();
    f.ingest.mockRejectedValue(
      Object.assign(new Error('private original diagnostic'), {
        code: 'CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT',
        details: { sourcePath: '/private/source.pdf' },
      }),
    );
    try {
      await f.service.ingestDocumentLibraryUpload(request, context);
      throw new Error('expected rejection');
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: 'CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT',
        status: 409,
      });
      const response = (error as { getResponse(): unknown }).getResponse();
      expect(response).toEqual({
        code: 'CATALOG_EXACT_DOCUMENT_IDENTITY_CONFLICT',
        message: '文件与已有版本的出版身份记录不一致，请核对已有文档。',
      });
      expect(JSON.stringify(response)).not.toContain('private');
    }
  });
  it('keeps unknown ingest failures observable instead of reporting success or an invented input conflict', async () => {
    const f = service();
    const failure = new Error('unexpected internal failure');
    f.ingest.mockRejectedValue(failure);
    await expect(
      f.service.ingestDocumentLibraryUpload(request, context),
    ).rejects.toBe(failure);
  });
  it('reports saved-source organization failure and resumes with the original upload identity', async () => {
    const target = service();
    target.organizeDocumentIntake.mockRejectedValueOnce(new Error('temporary organization interruption'));
    await expect(target.service.ingestDocumentLibraryUpload(request, context)).rejects.toMatchObject({
      status: 503, response: { code: 'DOCUMENT_SAVED_MATTER_PENDING' },
    });
    await expect(target.service.ingestDocumentLibraryUpload(request, context)).resolves.toMatchObject({
      documentVersionId: 'v1', matterId: 'MAT-family',
    });
    expect(target.ingest.mock.calls[0][0].idempotencyKey).toBe(target.ingest.mock.calls[1][0].idempotencyKey);
  });
  it('binds production user authority and source server-side without a development role or WorkItem', async () => {
    const target = service();
    const result = await target.service.ingestDocumentLibraryUpload(
      request,
      context,
    );
    expect(result).toMatchObject({
      status: 'COMMITTED',
      matterId: 'MAT-family',
      documentVersionId: 'v1',
      identity: { documentNumber: '787-34-001', businessRevision: 'R1' },
    });
    expect(target.organizeDocumentIntake).toHaveBeenCalledWith({
      tenantId: 't1',
      actorUserId: 'u1',
      documentVersionId: 'v1',
    });
    const [actual, scope] = target.ingest.mock.calls[0];
    expect(actual).toMatchObject({
      sourceChannel: 'document_library_upload',
      sourceRef: 'DOCUMENT_UPLOAD:u1:ordinary-123',
      idempotencyKey: 'document-upload:u1:ordinary-123',
      descriptor: {},
    });
    expect(scope.runtimeIngestAuthority).toMatchObject({
      mode: 'HOSTED_MIAODA_DOCUMENT_UPLOAD',
      identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    });
  });
  it.each([
    'actorUserId',
    'tenantId',
    'roles',
    'sourceChannel',
    'runtimeIngestAuthority',
    'descriptor',
  ])('rejects client supplied %s before core I/O', async (field) => {
    const target = service();
    await expect(
      target.service.ingestDocumentLibraryUpload(
        { ...request, [field]: 'spoof' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_UPLOAD_INPUT_INVALID' });
    expect(target.ingest).not.toHaveBeenCalled();
  });
  it('requires a minted capability plus exact FileService creator and default bucket', async () => {
    const metadata = {
      bucketID: 'default',
      filePath: request.selection.filePath,
      createdBy: { userID: 'u1' },
    };
    const fileService = {
      getDefaultBucket: jest.fn().mockResolvedValue('default'),
      from: jest.fn().mockReturnValue({
        getFileMetadata: jest.fn().mockResolvedValue(metadata),
      }),
    };
    const authorizer = new OrdinaryDocumentManagementAuthorizer(
      {} as never,
      fileService as never,
    );
    const authority = mintDocumentUploadAuthority(context);
    const input = {
      ...context,
      action: 'DOCUMENT_INGEST' as const,
      selection: request.selection,
      runtimeIngestAuthority: authority,
    };
    await expect(authorizer.assertCanIngest(input)).resolves.toBeUndefined();
    await expect(
      authorizer.assertCanIngest({
        ...input,
        runtimeIngestAuthority: { ...authority },
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
    await expect(
      authorizer.assertCanIngest({ ...input, actorUserId: 'u2' }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
    await expect(
      authorizer.assertCanIngest({ ...input, tenantId: 't2' }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ACTION_FORBIDDEN' });
    metadata.createdBy.userID = 'u2';
    await expect(authorizer.assertCanIngest(input)).rejects.toMatchObject({
      code: 'DOCUMENT_ACTION_FORBIDDEN',
    });
  });
  it('keeps the existing development entry closed for ordinary runtime users', () => {
    const target = service();
    expect(() =>
      target.service.ingestFileServiceSelection(request, context),
    ).toThrow('development context');
    expect(target.ingest).not.toHaveBeenCalled();
  });
});
