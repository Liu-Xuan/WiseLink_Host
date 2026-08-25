import { Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import type { DocumentManagementIngestAuthorizer } from '../document-management/src/hosted/nest/document-management-hosted.tokens';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from '../canonical-host/canonical-host.constants';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';

@Injectable()
// Registered by DocumentManagementHostedModule.register(); the static lint
// rule cannot follow DynamicModule metadata.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class OrdinaryDocumentManagementAuthorizer implements DocumentManagementIngestAuthorizer {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly fileService: FileService,
  ) {}

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
    const bucketId = input.selection.bucketId.trim();
    const filePath = normalizedDevelopmentFilePath(input.selection.filePath);
    if (!bucketId || !filePath) {
      throw documentActionForbidden();
    }
    const defaultBucketId = await this.fileService.getDefaultBucket();
    if (bucketId !== defaultBucketId) throw documentActionForbidden();
    const metadata = await this.fileService
      .from(defaultBucketId)
      .getFileMetadata(filePath);
    if (!metadata) throw documentSelectionNotFound();
    if (
      metadata.bucketID !== defaultBucketId ||
      normalizedProviderPath(metadata.filePath) !== filePath ||
      !sameExactUserId(metadata.createdBy?.userID, input.actorUserId)
    ) {
      throw documentActionForbidden();
    }
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

const DEVELOPMENT_FILE_PATH_PATTERN =
  /^wiselink\/dev-intake\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]{0,159}\.pdf$/u;

function normalizedDevelopmentFilePath(value: string): string | null {
  const normalized = normalizedProviderPath(value);
  if (!DEVELOPMENT_FILE_PATH_PATTERN.test(normalized)) {
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
