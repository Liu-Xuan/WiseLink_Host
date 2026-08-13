import { Injectable } from '@nestjs/common';

import type { DocumentManagementIngestAuthorizer } from './document-management-hosted.tokens';

function unconfigured(action: 'DOCUMENT_INGEST' | 'DOCUMENT_READ'): never {
  throw Object.assign(
    new Error('Document Management hosted authorization is not configured.'),
    {
      code: 'DOCUMENT_MANAGEMENT_HOST_AUTHORITY_UNCONFIGURED',
      statusCode: 503,
      details: { action },
    },
  );
}

@Injectable()
// Registered through the host-owned provider passed to the DynamicModule.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class UnconfiguredDocumentManagementIngestAuthorizer
implements DocumentManagementIngestAuthorizer {
  async assertCanIngest(): Promise<void> {
    unconfigured('DOCUMENT_INGEST');
  }

  async assertCanRead(): Promise<void> {
    unconfigured('DOCUMENT_READ');
  }
}
