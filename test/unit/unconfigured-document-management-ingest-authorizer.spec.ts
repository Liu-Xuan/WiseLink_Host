import { UnconfiguredDocumentManagementIngestAuthorizer } from '../../server/modules/document-management/src/hosted/nest/unconfigured-document-management-ingest-authorizer';

describe('UnconfiguredDocumentManagementIngestAuthorizer', () => {
  it('fails closed for ingest and read before any platform I/O', async () => {
    const authorizer = new UnconfiguredDocumentManagementIngestAuthorizer();

    await expect(authorizer.assertCanIngest()).rejects.toMatchObject({
      code: 'DOCUMENT_MANAGEMENT_HOST_AUTHORITY_UNCONFIGURED',
      statusCode: 503,
      details: { action: 'DOCUMENT_INGEST' },
    });
    await expect(authorizer.assertCanRead()).rejects.toMatchObject({
      code: 'DOCUMENT_MANAGEMENT_HOST_AUTHORITY_UNCONFIGURED',
      statusCode: 503,
      details: { action: 'DOCUMENT_READ' },
    });
  });
});
