import { Inject, Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import { DocumentManagementHostedCore } from '../documentManagementHostedCore.js';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { assertProductionMiaodaBrowserIdentityAvailable } from '../../../../work-item/production-miaoda-browser-ingress';
import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from './document-management-hosted.tokens';

export interface HostedRequestContext {
  actorUserId: string;
  tenantId: string;
  roles: string[];
  appId: string;
  env: string;
}

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentManagementHostedService {
  private readonly core: DocumentManagementHostedCore;

  constructor(
    fileService: FileService,
    private readonly catalog: MiaodaHostedDocumentCatalog,
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)
    private readonly authorizer: DocumentManagementIngestAuthorizer,
  ) {
    this.core = new DocumentManagementHostedCore({
      artifactStore: new MiaodaFileServiceArtifactStore(fileService),
      catalog,
      authorizer,
    });
  }

  ingestFileServiceSelection(request: unknown, context: HostedRequestContext) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertDevelopmentHostedContext(context);
    return this.core.ingestFileServiceSelection(request, context);
  }

  assertCanIngest(
    context: HostedRequestContext,
    selection: { bucketId: string; filePath: string },
  ): Promise<void> {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertDevelopmentHostedContext(context);
    return this.authorizer.assertCanIngest({
      ...context,
      action: 'DOCUMENT_INGEST',
      selection,
    });
  }

  async getDocumentVersion(
    documentVersionId: string,
    context: HostedRequestContext,
  ) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    await this.authorizer.assertCanRead({
      ...context,
      action: 'DOCUMENT_READ',
      documentVersionId,
    });
    const version = await this.catalog.readDocumentVersion(documentVersionId);
    if (!version) {
      throw Object.assign(
        new Error(`DocumentVersion not found: ${documentVersionId}`),
        {
          code: 'DOCUMENT_VERSION_NOT_FOUND',
          statusCode: 404,
        },
      );
    }
    const family = await this.catalog.readFamily(version.familyId);
    return { version, family };
  }
}

function hostedIdentity(context: HostedRequestContext) {
  return {
    userId: context.actorUserId,
    tenantId: context.tenantId,
    appId: context.appId,
    env: context.env,
  };
}

function assertDevelopmentHostedContext(context: HostedRequestContext): void {
  if (!['preview', 'runtime'].includes(context.env)) {
    throw Object.assign(
      new Error('Document ingestion requires a hosted user environment.'),
      {
        code: 'DOCUMENT_INGEST_HOSTED_ENV_REQUIRED',
        statusCode: 403,
      },
    );
  }
}
