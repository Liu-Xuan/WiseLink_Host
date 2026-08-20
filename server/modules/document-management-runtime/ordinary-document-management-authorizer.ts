import { Injectable } from '@nestjs/common';

import type { DocumentManagementIngestAuthorizer } from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from '../canonical-host/canonical-host.constants';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';

@Injectable()
// Registered by DocumentManagementHostedModule.register(); the static lint
// rule cannot follow DynamicModule metadata.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryDocumentManagementAuthorizer implements DocumentManagementIngestAuthorizer {
  constructor(private readonly workItems: MiaodaWorkItemRepository) {}

  async assertCanIngest(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_INGEST';
    selection: { bucketId: string; filePath: string };
  }): Promise<void> {
    assertAuthenticated(input);
    if (!input.roles.includes(CANONICAL_DEVELOPMENT_ROLE_ID)) {
      throw documentActionForbidden();
    }
    if (!input.selection.bucketId.trim() || !input.selection.filePath.trim()) {
      throw documentActionForbidden();
    }
    throw Object.assign(
      new Error('A verified FileService selection scope is unavailable.'),
      {
        code: 'DOCUMENT_SELECTION_SCOPE_UNAVAILABLE',
        statusCode: 503,
      },
    );
  }

  async assertCanRead(input: {
    actorUserId: string;
    tenantId: string;
    roles: string[];
    action: 'DOCUMENT_READ';
    documentVersionId: string;
  }): Promise<void> {
    assertAuthenticated(input);
    const binding = await this.workItems.loadTenantDocumentAuthorizationBinding(
      {
        tenantId: input.tenantId,
        documentVersionId: input.documentVersionId,
        actorUserId: input.actorUserId,
      },
    );
    if (!binding) throw documentNotFound();
  }
}

function assertAuthenticated(input: {
  actorUserId: string;
  tenantId: string;
  action: string;
}): void {
  if (!input.actorUserId.trim() || !input.tenantId.trim()) {
    throw documentActionForbidden();
  }
}

function documentActionForbidden(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Document action is not available.'), {
    code: 'DOCUMENT_ACTION_FORBIDDEN',
    statusCode: 403,
  });
}

function documentNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('DocumentVersion not found.'), {
    code: 'DOCUMENT_VERSION_NOT_FOUND',
    statusCode: 404,
  });
}
