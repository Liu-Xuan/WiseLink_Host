import { Inject, Injectable } from '@nestjs/common';

import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import type {
  AutomaticWorkItemSourceAuthorizationInput,
  AutomaticWorkItemSourceAuthorizationPort,
  AutomaticWorkItemSourceAuthorizationResult,
} from './automatic-work-item-source-authorization.port';

@Injectable()
// Registered by CanonicalHostModule.forRoot(); the static lint rule cannot follow its dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaAutomaticWorkItemSourceAuthorizationAdapter implements AutomaticWorkItemSourceAuthorizationPort {
  constructor(
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)
    private readonly documentAuthorization: DocumentManagementIngestAuthorizer,
  ) {}

  async authorizeSourceRead(
    input: AutomaticWorkItemSourceAuthorizationInput,
  ): Promise<AutomaticWorkItemSourceAuthorizationResult> {
    try {
      await this.documentAuthorization.assertCanRead({
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        roles: [],
        action: 'DOCUMENT_READ',
        documentVersionId: input.documentVersionId,
      });
    } catch (error) {
      if (isHostReadPolicyDenial(error)) {
        return {
          allowed: false,
          code: 'AUTO_WORK_ITEM_SOURCE_ACL_DENIED',
        };
      }
      throw error;
    }

    return {
      allowed: true,
      action: 'DOCUMENT_READ',
      authorizationPolicy: 'MIAODA_HOST_DOCUMENT_READ',
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      sourceArtifactId: input.sourceArtifactId,
      sourceFileSha256: input.sourceFileSha256,
      sourceByteLength: input.sourceByteLength,
    };
  }
}

function isHostReadPolicyDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; statusCode?: unknown };
  return (
    value.statusCode === 403 ||
    value.statusCode === 404 ||
    value.code === 'DOCUMENT_ACTION_FORBIDDEN' ||
    value.code === 'DOCUMENT_VERSION_NOT_FOUND'
  );
}
