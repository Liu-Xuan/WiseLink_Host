import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER } from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import { DocumentManagementHostedModule } from '../document-management/src/hosted/nest/document-management-hosted.module';
import type { AutomaticWorkItemSourceAuthorizationInput } from './automatic-work-item-source-authorization.port';
import { MiaodaAutomaticWorkItemSourceAuthorizationAdapter } from './miaoda-automatic-work-item-source-authorization.adapter';

const INPUT: AutomaticWorkItemSourceAuthorizationInput = {
  tenantId: 'tenant-01',
  actorUserId: 'user-01',
  workItemId: 'WI-01',
  requestId: 'REQ-01',
  documentId: 'DOC-01',
  documentVersionId: 'DV-01',
  sourceArtifactId: 'ART-01',
  sourceFileSha256: 'a'.repeat(64),
  sourceByteLength: 1024,
};

describe('MiaodaAutomaticWorkItemSourceAuthorizationAdapter', () => {
  it('asks the Host read policy for the exact persisted actor, tenant, and document version', async () => {
    const authorizer = {
      assertCanRead: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(
      authorizer as never,
    );

    await expect(adapter.authorizeSourceRead(INPUT)).resolves.toEqual({
      allowed: true,
      action: 'DOCUMENT_READ',
      authorizationPolicy: 'MIAODA_HOST_DOCUMENT_READ',
      tenantId: INPUT.tenantId,
      actorUserId: INPUT.actorUserId,
      documentId: INPUT.documentId,
      documentVersionId: INPUT.documentVersionId,
      sourceArtifactId: INPUT.sourceArtifactId,
      sourceFileSha256: INPUT.sourceFileSha256,
      sourceByteLength: INPUT.sourceByteLength,
    });
    expect(authorizer.assertCanRead).toHaveBeenCalledWith({
      actorUserId: INPUT.actorUserId,
      tenantId: INPUT.tenantId,
      roles: [],
      action: 'DOCUMENT_READ',
      documentVersionId: INPUT.documentVersionId,
    });
  });

  it('exports the configured Host read authorizer through the hosted dynamic module', () => {
    const hosted = DocumentManagementHostedModule.register({
      authorizerProvider: {
        provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        useValue: { assertCanRead: jest.fn() },
      },
    });

    expect(hosted.exports).toContain(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER);
  });

  it.each([
    ['actor', { actorUserId: 'different-user' }],
    ['tenant', { tenantId: 'different-tenant' }],
    ['document version', { documentVersionId: 'different-version' }],
  ] as const)(
    'checks the supplied %s against the Host read policy',
    async (_label, change) => {
      const input = { ...INPUT, ...change };
      const authorizer = {
        assertCanRead: jest.fn().mockResolvedValue(undefined),
      };
      const adapter = new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(
        authorizer as never,
      );

      await adapter.authorizeSourceRead(input);

      expect(authorizer.assertCanRead).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          documentVersionId: input.documentVersionId,
        }),
      );
    },
  );

  it.each([
    [403, 'DOCUMENT_ACTION_FORBIDDEN'],
    [404, 'DOCUMENT_VERSION_NOT_FOUND'],
  ])(
    'turns Host policy denial (%s) into an item-local denial',
    async (statusCode, code) => {
      const authorizer = {
        assertCanRead: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error(code), { statusCode, code }),
          ),
      };
      const adapter = new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(
        authorizer as never,
      );

      await expect(adapter.authorizeSourceRead(INPUT)).resolves.toEqual({
        allowed: false,
        code: 'AUTO_WORK_ITEM_SOURCE_ACL_DENIED',
      });
    },
  );

  it('does not swallow infrastructure failures', async () => {
    const failure = Object.assign(new Error('database unavailable'), {
      statusCode: 503,
    });
    const authorizer = {
      assertCanRead: jest.fn().mockRejectedValue(failure),
    };
    const adapter = new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(
      authorizer as never,
    );

    await expect(adapter.authorizeSourceRead(INPUT)).rejects.toBe(failure);
  });
});
