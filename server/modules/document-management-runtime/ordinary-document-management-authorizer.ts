import { DocumentParsingRepository } from '../document-management/src/hosted/nest/document-parsing.repository';
import { isMintedDocumentUploadAuthority } from '../document-management/src/hosted/nest/document-upload-authority';
import { Injectable, Optional } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import type { DocumentManagementIngestAuthorizer } from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import {
  CANONICAL_DEVELOPMENT_ROLE_ID,
  CANONICAL_MIAODA_APP_ID,
} from '../canonical-host/canonical-host.constants';
import { MiaodaHostedDocumentCatalog } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';

@Injectable()
// Registered by DocumentManagementHostedModule.register(); the static lint
// rule cannot follow DynamicModule metadata.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryDocumentManagementAuthorizer implements DocumentManagementIngestAuthorizer {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly fileService: FileService,
    @Optional() private readonly catalog?: MiaodaHostedDocumentCatalog,
    @Optional() private readonly parsing?: DocumentParsingRepository,
  ) {}

  async assertCanIngest(
    input: Parameters<DocumentManagementIngestAuthorizer['assertCanIngest']>[0],
  ): Promise<void> {
    assertAuthenticated(input);
    const documentUpload = isMintedDocumentUploadAuthority(
      input.runtimeIngestAuthority,
      input,
    );
    const reviewAttachment: boolean = isReviewAttachmentIngest(input);
    const oauthDevelopmentSelection: boolean =
      isOauthSessionDevelopmentIngest(input);
    if (
      !reviewAttachment &&
      !documentUpload &&
      !input.roles.includes(CANONICAL_DEVELOPMENT_ROLE_ID)
    ) {
      throw documentActionForbidden();
    }
    const bucketId = input.selection.bucketId.trim();
    const filePath: string | null = reviewAttachment
      ? normalizedReviewAttachmentPath(input.selection.filePath)
      : oauthDevelopmentSelection || documentUpload
        ? normalizedOauthDevelopmentFilePath(input.selection.filePath)
        : normalizedDevelopmentFilePath(input.selection.filePath);
    if (!bucketId || !filePath) {
      throw documentActionForbidden();
    }
    const defaultBucketId = await readIngestStorage(
      'DOCUMENT_STORAGE_BUCKET_READ_FAILED',
      () => this.fileService.getDefaultBucket(),
    );
    if (bucketId !== defaultBucketId) throw documentActionForbidden();
    const metadata = await readIngestStorage(
      'DOCUMENT_STORAGE_METADATA_READ_FAILED',
      () => this.fileService.from(defaultBucketId).getFileMetadata(filePath),
    );
    if (!metadata) throw documentSelectionNotFound();
    if (
      metadata.bucketID !== defaultBucketId ||
      normalizedProviderPath(metadata.filePath) !== filePath ||
      !sameExactUserId(metadata.createdBy?.userID, input.actorUserId)
    ) {
      throw documentActionForbidden();
    }
  }

  async assertCanImportLocalCandidate(
    input: Parameters<NonNullable<DocumentManagementIngestAuthorizer['assertCanImportLocalCandidate']>>[0],
  ): Promise<void> {
    assertAuthenticated({ ...input, action: 'DOCUMENT_INGEST' });
    if (!isMintedDocumentUploadAuthority(input.runtimeIngestAuthority, input)) throw documentActionForbidden();
    await this.assertCanRead({ ...input, action: 'DOCUMENT_READ' });
    await this.assertLocalCandidateStorage(input, input.selection);
  }

  async assertCanReadLocalCandidate(
    input: Parameters<NonNullable<DocumentManagementIngestAuthorizer['assertCanReadLocalCandidate']>>[0],
  ): Promise<void> {
    assertAuthenticated({ ...input, action: 'DOCUMENT_READ' });
    if (!this.parsing) throw Object.assign(new Error('DOCUMENT_LOCAL_MINERU_AUTHORIZATION_UNAVAILABLE'),
      { code: 'DOCUMENT_LOCAL_MINERU_AUTHORIZATION_UNAVAILABLE', statusCode: 503 });
    const run = await this.parsing.read(input, input.parseRunId);
    const pinned = run?.sourceBinding.parserInput;
    const settings = pinned?.settings;
    if (!run || run.parseRunId !== input.parseRunId || run.actorUserId !== input.actorUserId ||
        run.tenantId !== input.tenantId || run.documentVersionId !== input.documentVersionId ||
        run.sourceBinding.documentVersionId !== input.documentVersionId || pinned?.mode !== 'LOCAL_MINERU_IMPORT' ||
        !settings || !Number.isSafeInteger(settings.revision) || settings.revision < 0 ||
        settings.localMineruFallbackEnabled !== true || typeof settings.titleEnhancementEnabled !== 'boolean' ||
        !pinned.providerObjectId?.trim() || !/^[a-f0-9]{64}$/u.test(pinned.sha256) ||
        !Number.isSafeInteger(pinned.byteLength) || pinned.byteLength < 1) throw documentActionForbidden();
    await this.assertCanRead({ ...input, action: 'DOCUMENT_READ' });
    await this.assertLocalCandidateStorage(input, pinned, pinned);
  }

  private async assertLocalCandidateStorage(
    actor: { actorUserId: string }, selection: { bucketId: string; filePath: string },
    pinned?: { providerObjectId: string; byteLength: number },
  ): Promise<void> {
    const filePath = normalizedLocalCandidatePath(selection.filePath);
    const bucketId = selection.bucketId.trim();
    if (!filePath || !bucketId) throw documentActionForbidden();
    const defaultBucketId = await readIngestStorage('DOCUMENT_STORAGE_BUCKET_READ_FAILED',
      () => this.fileService.getDefaultBucket());
    if (bucketId !== defaultBucketId) throw documentActionForbidden();
    const metadata = await readIngestStorage('DOCUMENT_STORAGE_METADATA_READ_FAILED',
      () => this.fileService.from(defaultBucketId).getFileMetadata(filePath));
    if (!metadata) throw documentSelectionNotFound();
    if (metadata.bucketID !== defaultBucketId || normalizedProviderPath(metadata.filePath) !== filePath ||
        !sameExactUserId(metadata.createdBy?.userID, actor.actorUserId) ||
        (pinned && (String(metadata.id) !== pinned.providerObjectId ||
          Number(metadata.metadata?.contentLength) !== pinned.byteLength))) throw documentActionForbidden();
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
    if (binding) return;
    const acquired = await this.catalog?.readOwnedAcquisitionVersionBinding({
      tenantId: input.tenantId,
      documentVersionId: input.documentVersionId,
      actorUserId: input.actorUserId,
    });
    if (!acquired) throw documentNotFound();
  }
}

async function readIngestStorage<T>(
  code: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (cause: unknown) {
    const value =
      typeof cause === 'object' && cause !== null
        ? (cause as {
            statusCode?: unknown;
            status?: unknown;
            response?: { status?: unknown };
          })
        : {};
    const status = value.statusCode ?? value.status ?? value.response?.status;
    const statusCode =
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500
        ? status
        : 503;
    // Only report a bounded operational error. Never use the supplied bucket
    // as a fallback or promote a failed read into an authorization decision.
    throw Object.assign(
      new Error('受控文件空间核验未完成；本次未取得受理授权。'),
      {
        code:
          statusCode === 401 || statusCode === 403
            ? 'DOCUMENT_ACTION_FORBIDDEN'
            : code,
        statusCode,
        cause,
      },
    );
  }
}

function isOauthSessionDevelopmentIngest(
  input: Parameters<DocumentManagementIngestAuthorizer['assertCanIngest']>[0],
): boolean {
  const authority = input.runtimeIngestAuthority;
  return Boolean(
    authority?.mode === 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN' &&
    authority.actorUserId === input.actorUserId &&
    authority.tenantId === input.tenantId &&
    authority.appId === CANONICAL_MIAODA_APP_ID &&
    authority.identityProvenance === 'FEISHU_OAUTH_USER_ACCESS_TOKEN' &&
    authority.sessionProvenance === 'SERVER_OPAQUE_SESSION',
  );
}

function isReviewAttachmentIngest(
  input: Parameters<DocumentManagementIngestAuthorizer['assertCanIngest']>[0],
): boolean {
  const authority = input.runtimeIngestAuthority;
  return Boolean(
    authority?.mode === 'HOSTED_OAUTH_SESSION_REVIEW_ATTACHMENT' &&
    authority.actorUserId === input.actorUserId &&
    authority.tenantId === input.tenantId &&
    authority.appId === CANONICAL_MIAODA_APP_ID &&
    authority.identityProvenance === 'FEISHU_OAUTH_USER_ACCESS_TOKEN' &&
    authority.sessionProvenance === 'SERVER_OPAQUE_SESSION' &&
    authority.workItemId?.trim() &&
    Number.isSafeInteger(authority.expectedRevision) &&
    Number(authority.expectedRevision) >= 0 &&
    /^sha256:[0-9a-f]{64}$/u.test(authority.authorizationFingerprint ?? ''),
  );
}

const DEVELOPMENT_FILE_PATH_PATTERN =
  /^wiselink\/dev-intake\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]{0,159}\.pdf$/u;

function normalizedDevelopmentFilePath(value: string): string | null {
  const normalized = normalizedProviderPath(value);
  if (!DEVELOPMENT_FILE_PATH_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizedOauthDevelopmentFilePath(value: string): string | null {
  const normalized = normalizedProviderPath(value);
  const pathSegments = normalized.split('/');
  if (
    !normalized ||
    normalized.length > 1024 ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    !normalized.toLowerCase().endsWith('.pdf') ||
    pathSegments.some(
      (segment) => !segment || segment === '.' || segment === '..',
    )
  ) {
    return null;
  }
  return normalized;
}

function normalizedLocalCandidatePath(value: string): string | null {
  const normalized = normalizedProviderPath(value);
  if (!normalized || normalized.length > 1024 || normalized.includes('\\') || normalized.includes('\0') ||
      !normalized.toLowerCase().endsWith('.json') ||
      normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null;
  return normalized;
}

function normalizedReviewAttachmentPath(value: string): string | null {
  const normalized: string = normalizedProviderPath(value);
  if (!normalized || normalized.length > 1024 || normalized.includes('\0')) {
    return null;
  }
  return normalized;
}

function normalizedProviderPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/+/, '');
}

function sameExactUserId(value: unknown, actorUserId: string): boolean {
  if (typeof value === 'string') return value === actorUserId;
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    String(value) === actorUserId
  );
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

function documentSelectionNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('FileService selection not found.'), {
    code: 'DOCUMENT_SELECTION_NOT_FOUND',
    statusCode: 404,
  });
}
