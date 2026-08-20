import { Inject, Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import { DocumentManagementHostedCore } from '../documentManagementHostedCore.js';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from './document-management-hosted.tokens';

export interface HostedRequestContext {
  actorUserId: string;
  tenantId: string;
  roles: string[];
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
    return this.core.ingestFileServiceSelection(request, context);
  }

  assertCanIngest(
    context: HostedRequestContext,
    selection: { bucketId: string; filePath: string },
  ): Promise<void> {
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
