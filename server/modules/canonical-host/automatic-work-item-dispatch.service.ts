import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import type {
  AcknowledgeAutomaticWorkItemRequest,
  AcknowledgeAutomaticWorkItemResponse,
  AutomaticWorkItemClaimResult,
} from '@shared/api.interface';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import {
  MiaodaWorkItemRepository,
  type AutoWorkItemAuthorizationBinding,
  type AutoWorkItemQueueCandidate,
  type AutoWorkItemQueueWorkItem,
} from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedAutoWorkItemQueueScope,
} from './canonical-service-scope.authorization';
import {
  AUTOMATIC_WORK_ITEM_LEASE_AUTHORIZATION,
  type AutomaticWorkItemLeaseAuthorizationPort,
} from './automatic-work-item-lease-authorization.port';
import {
  AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION,
  type AutomaticWorkItemSourceAuthorizationPort,
} from './automatic-work-item-source-authorization.port';

const CANONICAL_APP_ID = 'app_17bzc551rsg';
const OPENCLAW_QUEUE_PRINCIPAL_ID = 'service:openclaw-main';
const AUTO_WORK_ITEM_LEASE_MILLISECONDS = 60 * 60 * 1000;

export type NextAutoWorkItemResult = AutomaticWorkItemClaimResult;

@Injectable()
export class AutomaticWorkItemDispatchService {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly sources: MiaodaDocumentVersionSourceResolver,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
    @Optional()
    @Inject(AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION)
    private readonly sourceAuthorization?: AutomaticWorkItemSourceAuthorizationPort,
    @Optional()
    @Inject(AUTOMATIC_WORK_ITEM_LEASE_AUTHORIZATION)
    private readonly leaseAuthorization?: AutomaticWorkItemLeaseAuthorizationPort,
  ) {}

  async nextWorkItem(): Promise<NextAutoWorkItemResult> {
    const scope = await this.serviceScope.authorizeOpenClawAutoWorkItemQueue();
    assertQueueScope(scope);
    const now = new Date();
    const candidates = await this.workItems.listAutoProcessingCandidates({
      tenantId: scope.tenantId,
      now,
      limit: 100,
    });

    for (const candidate of candidates) {
      const reason = await this.validateCandidate(candidate, scope);
      if (reason) {
        await this.workItems.blockAutoProcessingCandidate({
          tenantId: candidate.authorization.tenantId,
          workItemId: candidate.authorization.workItemId,
          requestId: candidate.authorization.requestId,
          actorUserId: candidate.authorization.actorUserId,
          blockedCode: reason,
          now,
        });
        continue;
      }

      const authorization = candidate.authorization;
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + AUTO_WORK_ITEM_LEASE_MILLISECONDS,
      );
      const lease = await this.workItems.claimAutoProcessingCandidate({
        tenantId: authorization.tenantId,
        workItemId: authorization.workItemId,
        requestId: authorization.requestId,
        actorUserId: authorization.actorUserId,
        documentId: authorization.documentId,
        documentVersionId: authorization.documentVersionId,
        sourceArtifactId: authorization.sourceArtifactId,
        sourceFileSha256: authorization.sourceFileSha256,
        sourceByteLength: Number(authorization.sourceByteLength),
        expectedWorkItemRevision: candidate.workItem.revision,
        leaseOwner: scope.principalId,
        leaseToken,
        now,
        leaseExpiresAt,
      });
      if (!lease) continue;

      return {
        status: 'CLAIMED',
        workItemId: authorization.workItemId,
        requestId: authorization.requestId,
        documentVersionId: authorization.documentVersionId,
        workItemRevision: candidate.workItem.revision,
        leaseToken: lease.leaseToken,
        leaseGeneration: lease.leaseGeneration,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      };
    }

    return { status: 'IDLE' };
  }

  async acknowledgeWorkItem(
    input: AcknowledgeAutomaticWorkItemRequest,
  ): Promise<AcknowledgeAutomaticWorkItemResponse> {
    const scope = await this.serviceScope.authorizeOpenClawAutoWorkItemQueue();
    assertQueueScope(scope);
    assertAcknowledgementInput(input);
    if (!this.leaseAuthorization) throw sourceAuthorizationUnavailable();

    const leaseIdentity = {
      tenantId: scope.tenantId,
      workItemId: input.workItemId,
    };
    const leaseInput = {
      ...leaseIdentity,
      principalId: scope.principalId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
    };
    try {
      await this.leaseAuthorization.authorizeActiveLease(leaseInput);
    } catch (error) {
      if (!isWorkItemNotFound(error)) throw error;
      const replay = await this.workItems.acknowledgeAutoProcessingLease({
        ...leaseIdentity,
        leaseOwner: scope.principalId,
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        now: new Date(),
      });
      if (replay?.replayed)
        return acknowledgementResponse(input.workItemId, replay);
      throw error;
    }

    const acknowledged = await this.workItems.acknowledgeAutoProcessingLease({
      ...leaseIdentity,
      leaseOwner: scope.principalId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      now: new Date(),
    });
    if (!acknowledged) throw autoWorkItemLeaseConflict();
    return acknowledgementResponse(input.workItemId, acknowledged);
  }

  private async validateCandidate(
    candidate: AutoWorkItemQueueCandidate,
    scope: CanonicalVerifiedAutoWorkItemQueueScope,
  ): Promise<string | null> {
    const { authorization, workItem: row } = candidate;
    const rowMismatch = automaticAuthorizationBindingMismatch(
      authorization,
      row,
      scope.tenantId,
    );
    if (rowMismatch) return rowMismatch;

    // This is the current Host ACL: the WorkItem owner relation is reread
    // using the actor id persisted by authenticated intake, never the worker.
    const owner = await this.workItems.loadAuthorizationBinding({
      workItemId: authorization.workItemId,
      tenantId: scope.tenantId,
      actorUserId: authorization.actorUserId,
    });
    if (
      !owner ||
      owner.workItemId !== authorization.workItemId ||
      owner.requestId !== authorization.requestId ||
      owner.documentId !== authorization.documentId ||
      owner.documentVersionId !== authorization.documentVersionId ||
      owner.requestedByUserId !== authorization.actorUserId
    ) {
      return 'AUTO_WORK_ITEM_OWNER_BINDING_INVALID';
    }

    if (!this.sourceAuthorization) {
      throw sourceAuthorizationUnavailable();
    }
    const sourcePermission = await this.sourceAuthorization.authorizeSourceRead(
      {
        tenantId: scope.tenantId,
        actorUserId: authorization.actorUserId,
        workItemId: authorization.workItemId,
        requestId: authorization.requestId,
        documentId: authorization.documentId,
        documentVersionId: authorization.documentVersionId,
        sourceArtifactId: authorization.sourceArtifactId,
        sourceFileSha256: authorization.sourceFileSha256,
        sourceByteLength: Number(authorization.sourceByteLength),
      },
    );
    if (sourcePermission.allowed === false) {
      return normalizeSourceAclDenyCode(sourcePermission.code);
    }
    if (
      sourcePermission.action !== 'DOCUMENT_READ' ||
      sourcePermission.authorizationPolicy !== 'MIAODA_HOST_DOCUMENT_READ' ||
      sourcePermission.tenantId !== scope.tenantId ||
      sourcePermission.actorUserId !== authorization.actorUserId ||
      sourcePermission.documentId !== authorization.documentId ||
      sourcePermission.documentVersionId !== authorization.documentVersionId ||
      sourcePermission.sourceArtifactId !== authorization.sourceArtifactId ||
      sourcePermission.sourceFileSha256 !== authorization.sourceFileSha256 ||
      sourcePermission.sourceByteLength !==
        Number(authorization.sourceByteLength)
    ) {
      return 'AUTO_WORK_ITEM_SOURCE_ACL_BINDING_INVALID';
    }

    let source: Awaited<
      ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
    >;
    try {
      source = await this.sources.resolve(authorization.documentVersionId, {
        requireCurrent: true,
        expectedCreatorUserId: authorization.actorUserId,
      });
    } catch (error) {
      const code = knownSourceAuthorizationFailure(error);
      if (code) return code;
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
      return 'AUTO_WORK_ITEM_SOURCE_BINDING_CHANGED';
    }

    const current = await this.workItems.loadAutoProcessingProjection(
      authorization.workItemId,
      scope.tenantId,
    );
    if (
      !current ||
      !current.projection ||
      current.row.revision !== row.revision ||
      current.row.requestedByUserId !== authorization.actorUserId ||
      current.projection.workItemId !== authorization.workItemId ||
      current.projection.requestId !== authorization.requestId ||
      current.projection.revision !== current.row.revision ||
      current.projection.source.documentVersionId !==
        authorization.documentVersionId ||
      current.projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      current.projection.package === null ||
      current.row.packageId !== current.projection.package.packageId
    ) {
      return 'AUTO_WORK_ITEM_PROJECTION_BINDING_INVALID';
    }
    return null;
  }
}

export function automaticAuthorizationBindingMismatch(
  authorization: AutoWorkItemAuthorizationBinding,
  row: AutoWorkItemQueueWorkItem,
  serviceTenantId: string,
): string | null {
  if (authorization.status !== 'WAITING' && authorization.status !== 'LEASED') {
    return 'AUTO_WORK_ITEM_AUTHORIZATION_STATUS_INVALID';
  }
  if (
    authorization.tenantId !== serviceTenantId ||
    row.tenantId !== serviceTenantId ||
    authorization.workItemId !== row.workItemId ||
    authorization.requestId !== row.requestId ||
    authorization.actorUserId !== row.requestedByUserId ||
    authorization.documentId !== row.documentId ||
    authorization.documentVersionId !== row.documentVersionId ||
    authorization.sourceArtifactId !== row.sourceArtifactId ||
    authorization.sourceFileSha256 !== row.sourceFileSha256 ||
    Number(authorization.sourceByteLength) !== Number(row.sourceByteLength) ||
    authorization.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
    row.actionType !== 'PARSE_PDF' ||
    row.runKey !== 'canonical' ||
    row.status !== 'CANDIDATE_READBACK_VERIFIED' ||
    row.packageId === null
  ) {
    return 'AUTO_WORK_ITEM_AUTHORIZATION_BINDING_INVALID';
  }
  return null;
}

function assertQueueScope(
  scope: CanonicalVerifiedAutoWorkItemQueueScope,
): void {
  if (
    scope.principalId !== OPENCLAW_QUEUE_PRINCIPAL_ID ||
    scope.appId !== CANONICAL_APP_ID ||
    !scope.tenantId.trim() ||
    !/^sha256:[0-9a-f]{64}$/u.test(scope.authorizationFingerprint)
  ) {
    throw Object.assign(new Error('CANONICAL_SERVICE_SCOPE_UNAVAILABLE'), {
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
  }
}

function knownSourceAuthorizationFailure(error: unknown): string | null {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  const known = new Set([
    'DOCUMENT_VERSION_NOT_FOUND',
    'DOCUMENT_VERSION_NOT_CURRENT',
    'DOCUMENT_VERSION_CURRENTNESS_UNVERIFIED',
    'DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID',
  ]);
  return known.has(code) ? code : null;
}

function sourceAuthorizationUnavailable(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Fresh source read authorization is not configured.'),
    {
      code: 'AUTO_WORK_ITEM_SOURCE_ACL_UNAVAILABLE',
      statusCode: 503,
    },
  );
}

function normalizeSourceAclDenyCode(value: string): string {
  return /^AUTO_WORK_ITEM_SOURCE_ACL_[A-Z0-9_]{1,96}$/u.test(value)
    ? value
    : 'AUTO_WORK_ITEM_SOURCE_READ_FORBIDDEN';
}

function assertAcknowledgementInput(
  input: AcknowledgeAutomaticWorkItemRequest,
): void {
  if (
    !/^WI-[A-Za-z0-9_-]{1,93}$/u.test(input.workItemId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.leaseToken,
    ) ||
    !Number.isSafeInteger(input.leaseGeneration) ||
    input.leaseGeneration < 1
  ) {
    throw Object.assign(new Error('AUTO_WORK_ITEM_ACK_INPUT_INVALID'), {
      code: 'AUTO_WORK_ITEM_ACK_INPUT_INVALID',
      statusCode: 400,
    });
  }
}

function isWorkItemNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'CANONICAL_WORK_ITEM_NOT_FOUND' &&
    'statusCode' in error &&
    error.statusCode === 404
  );
}

function acknowledgementResponse(
  workItemId: string,
  acknowledgement: { acknowledgedAt: Date; replayed: boolean },
): AcknowledgeAutomaticWorkItemResponse {
  return {
    status: 'ACKNOWLEDGED',
    workItemId,
    replayed: acknowledgement.replayed,
    acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
  };
}

function autoWorkItemLeaseConflict(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('AUTO_WORK_ITEM_LEASE_LOST'), {
    code: 'AUTO_WORK_ITEM_LEASE_LOST',
    statusCode: 409,
  });
}
