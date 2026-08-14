import { Injectable } from '@nestjs/common';

import type { DocumentManagementIngestAuthorizer } from '../document-management/src/hosted/nest/document-management-hosted.tokens';

@Injectable()
// Registered by DocumentManagementHostedModule.register(); the static lint
// rule cannot follow DynamicModule metadata.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryDocumentManagementAuthorizer
  implements DocumentManagementIngestAuthorizer
{
  async assertCanIngest(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_INGEST';
  }): Promise<void> {
    assertAuthenticated(input);
  }

  async assertCanRead(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_READ';
  }): Promise<void> {
    assertAuthenticated(input);
  }
}

function assertAuthenticated(input: {
  actorUserId: string;
  tenantId: string;
  action: string;
}): void {
  if (!input.actorUserId.trim() || !input.tenantId.trim()) {
    throw Object.assign(new Error('Authenticated user context is required.'), {
      code: 'DOCUMENT_ACTION_FORBIDDEN',
      statusCode: 403,
    });
  }
}
