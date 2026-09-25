import { Inject, Injectable } from '@nestjs/common';

import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION,
  type AutomaticWorkItemSourceAuthorizationPort,
} from './automatic-work-item-source-authorization.port';
import {
  type AutomaticWorkItemLeaseAuthorizationInput,
  type AutomaticWorkItemLeaseAuthorizationPort,
  type AuthorizedAutomaticWorkItemLease,
} from './automatic-work-item-lease-authorization.port';

@Injectable()
// Registered by CanonicalHostModule.forRoot(); the static lint rule cannot follow its dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaAutomaticWorkItemLeaseAuthorizationAdapter implements AutomaticWorkItemLeaseAuthorizationPort {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly sourceResolver: MiaodaDocumentVersionSourceResolver,
    @Inject(AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION)
    private readonly sourceAuthorization: AutomaticWorkItemSourceAuthorizationPort,
  ) {}

  async authorizeActiveLease(
    input: AutomaticWorkItemLeaseAuthorizationInput,
  ): Promise<AuthorizedAutomaticWorkItemLease> {
    assertInput(input);
    const now = new Date();
    const binding = await this.workItems.loadActiveAutoProcessingLease({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      leaseOwner: input.principalId,
      now,
    });
    if (!binding) throw workItemNotFound();

    const { authorization, workItem: row } = binding;
    if (
      authorization.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
      authorization.status !== 'LEASED' ||
      authorization.tenantId !== input.tenantId ||
      authorization.workItemId !== input.workItemId ||
      authorization.leaseOwner !== input.principalId ||
      !authorization.leaseToken ||
      !authorization.leaseExpiresAt ||
      authorization.leaseExpiresAt <= now ||
      (input.leaseToken !== undefined &&
        authorization.leaseToken !== input.leaseToken) ||
      (input.leaseGeneration !== undefined &&
        authorization.leaseGeneration !== input.leaseGeneration) ||
      row.tenantId !== authorization.tenantId ||
      row.workItemId !== authorization.workItemId ||
      row.requestId !== authorization.requestId ||
      row.requestedByUserId !== authorization.actorUserId ||
      row.documentId !== authorization.documentId ||
      row.documentVersionId !== authorization.documentVersionId ||
      row.sourceArtifactId !== authorization.sourceArtifactId ||
      row.sourceFileSha256 !== authorization.sourceFileSha256 ||
      Number(row.sourceByteLength) !== Number(authorization.sourceByteLength) ||
      row.actionType !== 'PARSE_PDF' ||
      row.status !== 'CANDIDATE_READBACK_VERIFIED' ||
      !row.packageId
    ) {
      throw workItemNotFound();
    }

    const owner = await this.workItems.loadAuthorizationBinding({
      workItemId: authorization.workItemId,
      tenantId: authorization.tenantId,
      actorUserId: authorization.actorUserId,
    });
    if (
      !owner ||
      owner.workItemId !== authorization.workItemId ||
      owner.tenantId !== authorization.tenantId ||
      owner.requestId !== authorization.requestId ||
      owner.documentId !== authorization.documentId ||
      owner.documentVersionId !== authorization.documentVersionId ||
      owner.requestedByUserId !== authorization.actorUserId
    ) {
      throw workItemNotFound();
    }

    const permission = await this.sourceAuthorization.authorizeSourceRead({
      tenantId: authorization.tenantId,
      actorUserId: authorization.actorUserId,
      workItemId: authorization.workItemId,
      requestId: authorization.requestId,
      documentId: authorization.documentId,
      documentVersionId: authorization.documentVersionId,
      sourceArtifactId: authorization.sourceArtifactId,
      sourceFileSha256: authorization.sourceFileSha256,
      sourceByteLength: Number(authorization.sourceByteLength),
    });
    if (
      !permission.allowed ||
      permission.action !== 'DOCUMENT_READ' ||
      permission.authorizationPolicy !== 'MIAODA_HOST_DOCUMENT_READ' ||
      permission.tenantId !== authorization.tenantId ||
      permission.actorUserId !== authorization.actorUserId ||
      permission.documentId !== authorization.documentId ||
      permission.documentVersionId !== authorization.documentVersionId ||
      permission.sourceArtifactId !== authorization.sourceArtifactId ||
      permission.sourceFileSha256 !== authorization.sourceFileSha256 ||
      permission.sourceByteLength !== Number(authorization.sourceByteLength)
    ) {
      throw workItemNotFound();
    }

    let source: Awaited<
      ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
    >;
    try {
      source = await this.sourceResolver.resolve(
        authorization.documentVersionId,
        {
          requireCurrent: true,
          expectedCreatorUserId: authorization.actorUserId,
        },
      );
    } catch (error) {
      if (isObjectLocalSourceFailure(error)) throw workItemNotFound();
      throw error;
    }
    if (
      source.version.documentId !== authorization.documentId ||
      source.version.documentVersionId !== authorization.documentVersionId ||
      source.version.sourceArtifactId !== authorization.sourceArtifactId ||
      source.artifact.sourceArtifactId !== authorization.sourceArtifactId ||
      source.version.pdfSha256 !== authorization.sourceFileSha256 ||
      source.artifact.sha256 !== authorization.sourceFileSha256 ||
      Number(source.version.byteLength) !==
        Number(authorization.sourceByteLength) ||
      Number(source.artifact.byteLength) !==
        Number(authorization.sourceByteLength)
    ) {
      throw workItemNotFound();
    }

    const current = await this.workItems.loadAutoProcessingProjection(
      authorization.workItemId,
      authorization.tenantId,
    );
    if (
      !current ||
      !current.projection ||
      current.row.workItemId !== authorization.workItemId ||
      current.row.requestedByUserId !== authorization.actorUserId ||
      current.row.revision !== row.revision ||
      current.row.packageId !== row.packageId ||
      current.projection.workItemId !== authorization.workItemId ||
      current.projection.requestId !== authorization.requestId ||
      current.projection.revision !== current.row.revision ||
      current.projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      current.projection.source.documentVersionId !==
        authorization.documentVersionId ||
      current.projection.package?.packageId !== row.packageId
    ) {
      throw workItemNotFound();
    }

    return {
      tenantId: authorization.tenantId,
      principalId: input.principalId,
      workItemId: authorization.workItemId,
      requestId: authorization.requestId,
      actorUserId: authorization.actorUserId,
      documentId: authorization.documentId,
      documentVersionId: authorization.documentVersionId,
      sourceArtifactId: authorization.sourceArtifactId,
      sourceFileSha256: authorization.sourceFileSha256,
      sourceByteLength: Number(authorization.sourceByteLength),
      leaseGeneration: authorization.leaseGeneration,
      leaseExpiresAt: authorization.leaseExpiresAt.toISOString(),
    };
  }
}

function assertInput(input: AutomaticWorkItemLeaseAuthorizationInput): void {
  if (
    !input.tenantId.trim() ||
    !input.workItemId.trim() ||
    !input.principalId.trim() ||
    (input.leaseToken === undefined) !==
      (input.leaseGeneration === undefined) ||
    (input.leaseToken !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.leaseToken,
      )) ||
    (input.leaseGeneration !== undefined &&
      (!Number.isSafeInteger(input.leaseGeneration) ||
        input.leaseGeneration < 1))
  ) {
    throw workItemNotFound();
  }
}

function isObjectLocalSourceFailure(error: unknown): boolean {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  return new Set([
    'DOCUMENT_VERSION_NOT_FOUND',
    'DOCUMENT_VERSION_NOT_CURRENT',
    'DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED',
    'DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID',
  ]).has(code);
}

function workItemNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
