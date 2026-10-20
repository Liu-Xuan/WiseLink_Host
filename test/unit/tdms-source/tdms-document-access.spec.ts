import type { DocumentManagementIngestAuthorizer } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.tokens';
import { MiaodaTdmsDocumentAccess } from '../../../server/modules/tdms-source/miaoda-tdms-document-access';
import type { TdmsPublicActor } from '../../../server/modules/tdms-source/tdms-source.types';
import { actor } from './tdms-fixtures';

function setup() {
  const authorization: jest.Mocked<DocumentManagementIngestAuthorizer> = {
    assertCanRead: jest.fn().mockResolvedValue(undefined),
    assertCanIngest: jest.fn(),
  };
  return {
    authorization,
    documents: new MiaodaTdmsDocumentAccess(authorization, {} as never),
  };
}

describe('TDMS exact document access through the existing DM authorizer', () => {
  const previousSandboxId: string | undefined = process.env.SANDBOX_ID;
  afterAll(() => {
    if (previousSandboxId === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = previousSandboxId;
  });

  it('keeps the exact version and verified native actor without granting ingest', async () => {
    const { authorization, documents } = setup();
    const nativeActor: TdmsPublicActor = actor();
    nativeActor.platformRoles = Object.freeze(['synthetic-platform-role']);
    await documents.assertRead(nativeActor, 'DV-owned@revision-2');

    expect(authorization.assertCanRead).toHaveBeenCalledTimes(1);
    expect(authorization.assertCanRead).toHaveBeenCalledWith({
      actorUserId: '123',
      tenantId: 'tenant-a',
      roles: ['synthetic-platform-role'],
      action: 'DOCUMENT_READ',
      documentVersionId: 'DV-owned@revision-2',
    });
    expect(authorization.assertCanRead.mock.calls[0]![0].roles).not.toBe(
      nativeActor.platformRoles,
    );
    expect(authorization.assertCanIngest).not.toHaveBeenCalled();
  });

  it.each(['', ' DV-owned', 'DV-owned ', 'DV-\u0000-owned', 'v'.repeat(256)])(
    'rejects invalid exact identifiers before consulting policy: %p',
    async (documentVersionId: string) => {
      const { authorization, documents } = setup();
      await expect(
        documents.assertRead(actor(), documentVersionId),
      ).rejects.toMatchObject({ code: 'TDMS_IDENTIFIER_INVALID' });
      expect(authorization.assertCanRead).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: 'OAuth identity instead of native gateway actor',
      change: (nativeActor: TdmsPublicActor): void => {
        nativeActor.identityProvenance = 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
      },
    },
    {
      label: 'tenant differs from the native subject decision',
      change: (nativeActor: TdmsPublicActor): void => {
        nativeActor.tenantId = 'tenant-b';
      },
    },
    {
      label: 'application differs from the native subject decision',
      change: (nativeActor: TdmsPublicActor): void => {
        nativeActor.applicationScopeId = 'another-application';
      },
    },
    {
      label: 'service subject',
      change: (nativeActor: TdmsPublicActor): void => {
        nativeActor.canonicalSubject.id = 'service:tdms';
      },
    },
  ])('rejects $label before policy', async ({ change }) => {
    const { authorization, documents } = setup();
    const nativeActor: TdmsPublicActor = actor();
    change(nativeActor);
    await expect(
      documents.assertRead(nativeActor, 'DV-owned@revision-2'),
    ).rejects.toMatchObject({ code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED' });
    expect(authorization.assertCanRead).not.toHaveBeenCalled();
  });

  it('passes the actual tenant to policy and preserves a cross-tenant denial', async () => {
    const { authorization, documents } = setup();
    const nativeActor: TdmsPublicActor = actor();
    nativeActor.tenantId = 'tenant-b';
    nativeActor.subjectDecision.tenantId = 'tenant-b';
    const denied: Error = Object.assign(new Error('DOCUMENT_VERSION_NOT_FOUND'), {
      code: 'DOCUMENT_VERSION_NOT_FOUND',
      statusCode: 404,
    });
    authorization.assertCanRead.mockRejectedValueOnce(denied);

    await expect(
      documents.assertRead(nativeActor, 'DV-owned@revision-2'),
    ).rejects.toBe(denied);
    expect(authorization.assertCanRead).toHaveBeenCalledWith({
      actorUserId: '123',
      tenantId: 'tenant-b',
      roles: [],
      action: 'DOCUMENT_READ',
      documentVersionId: 'DV-owned@revision-2',
    });
  });

  it.each([
    { code: 'DOCUMENT_ACTION_FORBIDDEN', statusCode: 403 },
    { code: 'DOCUMENT_VERSION_NOT_FOUND', statusCode: 404 },
    { code: 'SYNTHETIC_DOCUMENT_POLICY_UNAVAILABLE', statusCode: 503 },
  ])('propagates $code without fallback', async (failure) => {
    const { authorization, documents } = setup();
    const denied: Error = Object.assign(new Error(failure.code), failure);
    authorization.assertCanRead.mockRejectedValueOnce(denied);
    await expect(
      documents.assertRead(actor(), 'DV-owned@revision-2'),
    ).rejects.toBe(denied);
    expect(authorization.assertCanRead).toHaveBeenCalledTimes(1);
    expect(authorization.assertCanIngest).not.toHaveBeenCalled();
  });

  it('checks current policy again after an earlier successful read', async () => {
    const { authorization, documents } = setup();
    const nativeActor: TdmsPublicActor = actor();
    const revoked: Error = Object.assign(new Error('DOCUMENT_ACTION_FORBIDDEN'), {
      code: 'DOCUMENT_ACTION_FORBIDDEN',
      statusCode: 403,
    });
    authorization.assertCanRead
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(revoked);

    await documents.assertRead(nativeActor, 'DV-owned@revision-2');
    await expect(
      documents.assertRead(nativeActor, 'DV-owned@revision-2'),
    ).rejects.toBe(revoked);
    expect(authorization.assertCanRead).toHaveBeenCalledTimes(2);
  });
});
