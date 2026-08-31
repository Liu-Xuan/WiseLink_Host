import { Inject, Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import { DocumentManagementHostedCore } from '../documentManagementHostedCore.js';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import {
  CANONICAL_DEVELOPMENT_ROLE_ID,
  CANONICAL_MIAODA_APP_ID,
} from '../../../../canonical-host/canonical-host.constants';
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
  runtimeIngestAuthority?: {
    mode:
      | 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN'
      | 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT';
    actorUserId: string;
    tenantId: string;
    appId: string;
    identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN';
    sessionProvenance: 'SERVER_OPAQUE_SESSION';
    workItemId?: string;
    expectedRevision?: number;
    authorizationFingerprint?: string;
  };
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
    assertDevelopmentIngestContext(context);
    return this.core.ingestFileServiceSelection(request, context);
  }

  ingestReviewAttachmentSelection(
    request: unknown,
    context: HostedRequestContext,
  ) {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertReviewAttachmentIngestContext(context);
    return this.core.ingestFileServiceSelection(request, context);
  }

  assertCanIngest(
    context: HostedRequestContext,
    selection: { bucketId: string; filePath: string },
  ): Promise<void> {
    assertProductionMiaodaBrowserIdentityAvailable(hostedIdentity(context));
    assertDevelopmentIngestContext(context);
    return this.authorizer.assertCanIngest({
      actorUserId: context.actorUserId,
      tenantId: context.tenantId,
      roles: [...context.roles],
      action: 'DOCUMENT_INGEST',
      selection,
      ...(context.runtimeIngestAuthority
        ? {
            runtimeIngestAuthority: structuredClone(
              context.runtimeIngestAuthority,
            ),
          }
        : {}),
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

function assertDevelopmentIngestContext(context: HostedRequestContext): void {
  // @lark-apaas/fullstack-nestjs-core derives env and roles from the hosted
  // gateway user context. Preview stays available for development. The real
  // online runtime additionally requires the server-only authority minted by
  // the OAuth-session development-run path after its dual-actor checks. The
  // authorizer then rechecks the owned default-bucket DEV path.
  if (
    context.env === 'preview' ||
    (context.env === 'runtime' &&
      context.appId === CANONICAL_MIAODA_APP_ID &&
      context.roles.includes(CANONICAL_DEVELOPMENT_ROLE_ID) &&
      hasOauthSessionDevelopmentRunAuthority(context))
  ) {
    return;
  }
  throw Object.assign(
    new Error('Document ingestion requires a hosted development context.'),
    {
      code: 'DOCUMENT_INGEST_PREVIEW_REQUIRED',
      statusCode: 403,
    },
  );
}

function assertReviewAttachmentIngestContext(
  context: HostedRequestContext,
): void {
  const authority = context.runtimeIngestAuthority;
  if (
    ['preview', 'runtime'].includes(context.env) &&
    context.appId === CANONICAL_MIAODA_APP_ID &&
    authority?.mode === 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT' &&
    authority.actorUserId === context.actorUserId &&
    authority.tenantId === context.tenantId &&
    authority.appId === context.appId &&
    authority.identityProvenance === 'FEISHU_OAUTH_USER_ACCESS_TOKEN' &&
    authority.sessionProvenance === 'SERVER_OPAQUE_SESSION' &&
    Boolean(authority.workItemId?.trim()) &&
    Number.isSafeInteger(authority.expectedRevision) &&
    Number(authority.expectedRevision) >= 0 &&
    Boolean(authority.authorizationFingerprint?.trim())
  ) {
    return;
  }
  throw Object.assign(
    new Error('Review attachment ingestion requires a verified OAuth session.'),
    {
      code: 'REVIEW_ATTACHMENT_INGEST_AUTHORITY_REQUIRED',
      statusCode: 403,
    },
  );
}

function hasOauthSessionDevelopmentRunAuthority(
  context: HostedRequestContext,
): boolean {
  const authority = context.runtimeIngestAuthority;
  return Boolean(
    authority &&
    authority.mode === 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN' &&
    authority.actorUserId === context.actorUserId &&
    authority.tenantId === context.tenantId &&
    authority.appId === context.appId &&
    authority.identityProvenance === 'FEISHU_OAUTH_USER_ACCESS_TOKEN' &&
    authority.sessionProvenance === 'SERVER_OPAQUE_SESSION',
  );
}
