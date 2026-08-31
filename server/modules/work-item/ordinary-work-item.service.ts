import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';

import type {
  CanonicalClassificationSelection,
  CanonicalDevelopmentWorkItemRunRequest,
  CanonicalOrdinaryWorkItemRunResponse,
  CanonicalPdfVerticalRunRequest,
  CanonicalS1000dOrdinaryRunResponse,
  CanonicalS1000dVerticalRunRequest,
} from '@shared/api.interface';
import { CanonicalHostVerticalService } from '../canonical-host/canonical-host-vertical.service';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from '../canonical-host/canonical-host.constants';
import type {
  CanonicalHostActionContext,
  CanonicalHostActor,
} from '../canonical-host/canonical-host.types';
import type { CanonicalVerifiedDevelopmentCreateScope } from '../canonical-host/canonical-service-scope.authorization';
import {
  hostNativePdfAdapterIdFromDmPreflight,
  hostNativePdfClassificationFor,
} from '../canonical-host/host-native-pdf-profile.registry';
import type { CanonicalMiaodaFinalUserActorContext } from './canonical-object-access.port';
import {
  DocumentManagementHostedService,
  type HostedRequestContext,
} from '../document-management/src/hosted/nest';
import { MiaodaDocumentVersionSourceResolver } from './miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from './miaoda-work-item.repository';
import { assertProductionMiaodaBrowserIdentityAvailable } from './production-miaoda-browser-ingress';

const FTD_CLASSIFICATION: CanonicalClassificationSelection = {
  status: 'CANDIDATE',
  normalizedFamily: 'FTD',
  classifierReleaseId: 'intake-classifier-release:q1-native-migration@1.0.0',
  classifierReleaseHash:
    'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
  parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
  parserProfileHash:
    'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
  fingerprint:
    'sha256:95728aebf5e6ce6b2aa8078389ce551d9a121ca0476d469a19f3d2dc4693b1a4',
};

const OEM_REFERENCE_CLASSIFICATION: CanonicalClassificationSelection = {
  status: 'CANDIDATE',
  normalizedFamily: 'OEM_REFERENCE',
  classifierReleaseId: 'intake-classifier-release:q1-native-migration@1.0.0',
  classifierReleaseHash:
    'sha256:d374483eaa1c209912bf8ed0f830b582f8f0578e3149899de24633ad8e10587c',
  parserProfileId: 'parser-profile:generic.document@1.0.0',
  parserProfileHash:
    'sha256:0508c397ca2249dc38507b7de312547503208dad6ad7993659ec900713ed1dde',
  fingerprint:
    'sha256:9e0f6036c057009b18c19333f33a3945b06cb567c27b1859b2e6ba47979f42c5',
};

const S1000D_CLASSIFICATION: CanonicalClassificationSelection = {
  status: 'CONFIRMED',
  normalizedFamily: 'S1000D',
  classifierReleaseId: 'structured-source:s1000d-xml-v1.1',
  classifierReleaseHash: stableSha256('structured-source:s1000d-xml-v1.1'),
  parserProfileId: 'parser-profile:s1000d.native-xml.v1.1',
  parserProfileHash: stableSha256('parser-profile:s1000d.native-xml.v1.1'),
  fingerprint: stableSha256(
    'S1000D\nstructured-source:s1000d-xml-v1.1\nparser-profile:s1000d.native-xml.v1.1',
  ),
};

export interface OrdinaryPdfParseInput {
  documentVersionId?: unknown;
  selection?: {
    bucketId?: unknown;
    filePath?: unknown;
  };
  query?: unknown;
}

interface ExistingParseRunTarget {
  workItemId: string;
  requestId: string;
  mode: 'RETRY_FAILURE' | 'EXPLICIT_REPARSE';
  expectedRevision: number;
}

const DEVELOPMENT_RUN_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_APP_ID = 'app_17bzc551rsg';
@Injectable()
export class OrdinaryWorkItemService {
  constructor(
    private readonly documentManagement: DocumentManagementHostedService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly vertical: CanonicalHostVerticalService,
    private readonly fileService?: FileService,
  ) {}

  async listOauthSessionDevelopmentPdfs(
    input: { search?: unknown; offset?: unknown },
    sessionActor: CanonicalMiaodaFinalUserActorContext,
    gatewayActor: CanonicalMiaodaFinalUserActorContext,
  ) {
    assertOauthSessionDevelopmentActors(sessionActor, gatewayActor);
    if (!this.fileService) {
      throw Object.assign(new Error('Canonical FileService is unavailable.'), {
        code: 'CANONICAL_FILE_SERVICE_UNAVAILABLE',
        statusCode: 503,
      });
    }
    const actor = oauthSessionDevelopmentActor(sessionActor, gatewayActor);
    const bucketId = await this.fileService.getDefaultBucket();
    const listed = await this.fileService.from(bucketId).list('', {
      maxKeys: 200,
    });
    const search = String(input.search ?? '').trim().toLocaleLowerCase();
    const offset = boundedListOffset(input.offset);
    const ownedPdfs = listed.attachments.flatMap((metadata) => {
      const filePath = normalizedExistingPdfPath(metadata.filePath);
      const displayName = String(metadata.name ?? '').trim();
      if (
        !filePath ||
        !displayName.toLocaleLowerCase().endsWith('.pdf') ||
        !sameExactUserId(metadata.createdBy?.userID, actor.userId) ||
        (search && !displayName.toLocaleLowerCase().includes(search))
      ) {
        return [];
      }
      return [
        {
          selection: { bucketId, filePath },
          displayName,
          updatedAt: String(metadata.updatedAt ?? ''),
        },
      ];
    });
    ownedPdfs.sort((left, right) => {
      const updatedOrder =
        existingPdfUpdatedTimestamp(right.updatedAt) -
        existingPdfUpdatedTimestamp(left.updatedAt);
      if (updatedOrder !== 0) return updatedOrder;
      return `${left.displayName}\u0000${left.selection.filePath}`.localeCompare(
        `${right.displayName}\u0000${right.selection.filePath}`,
      );
    });
    const pageSize = 24;
    return {
      schemaVersion:
        'wiselink.3_1.oauth_session_existing_pdf_page.v1' as const,
      items: ownedPdfs.slice(offset, offset + pageSize),
      hasNextPage: ownedPdfs.length > offset + pageSize,
      sourceTruncated: listed.hasMore,
    };
  }

  async parsePdf(
    input: OrdinaryPdfParseInput,
    actor: CanonicalHostActor,
    origin: 'MIAODA' | 'AILY' = 'MIAODA',
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    assertProductionMiaodaBrowserIdentityAvailable(actor);
    if (input.selection !== undefined) {
      throw Object.assign(
        new Error('New FileService selections require the development route.'),
        {
          code: 'CANONICAL_DEVELOPMENT_RUN_REQUIRED',
          statusCode: 400,
        },
      );
    }
    return this.runPdf(input, actor, origin, 'canonical');
  }

  async parseS1000d(
    input: Pick<OrdinaryPdfParseInput, 'documentVersionId' | 'query'>,
    actor: CanonicalHostActor,
  ): Promise<CanonicalS1000dOrdinaryRunResponse> {
    assertProductionMiaodaBrowserIdentityAvailable(actor);
    const documentVersionId = requiredText(
      input.documentVersionId,
      'documentVersionId',
      96,
    );
    await this.assertCanResolveDocumentVersion({
      actor,
      documentVersionId,
      runKey: 'canonical',
      developmentCreate: false,
    });
    this.vertical.assertS1000dAvailable();
    const resolved = await this.resolver.resolve(documentVersionId, {
      requireCurrent: true,
    });
    const reservation = await this.repository.reserve({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      documentId: resolved.version.documentId,
      documentVersionId: resolved.version.documentVersionId,
      sourceArtifactId: resolved.version.sourceArtifactId,
      sourceFileSha256: resolved.version.pdfSha256,
      sourceByteLength: Number(resolved.version.byteLength),
      normalizedFamily: S1000D_CLASSIFICATION.normalizedFamily,
      requestOrigin: 'MIAODA',
      runKey: 'canonical',
    });
    const request: CanonicalS1000dVerticalRunRequest = {
      schemaVersion: 'wiselink.3_1.canonical_s1000d_vertical_request.v1',
      workItemId: reservation.workItemId,
      requestId: reservation.requestId,
      source: {
        documentId: resolved.version.documentId,
        documentVersionId: resolved.version.documentVersionId,
        parserRequestId: reservation.requestId,
        sourceArtifactId: resolved.version.sourceArtifactId,
        sourceFileSha256: `sha256:${resolved.version.pdfSha256}`,
        sourceByteLength: Number(resolved.version.byteLength),
        driveFileToken: resolved.artifact.providerObjectId,
        driveSourceVersion: resolved.artifact.providerVersionId,
      },
      classification: { ...S1000D_CLASSIFICATION },
      query: optionalQuery(input.query),
    };
    const result = await this.vertical.runS1000d(request, actor);
    return {
      schemaVersion: 'wiselink.3_1.ordinary_s1000d_work_item_run.v1',
      workItemCreated: reservation.created,
      workItemReused: !reservation.created,
      result,
    };
  }

  async createDevelopmentRun(
    input: CanonicalDevelopmentWorkItemRunRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    assertProductionMiaodaBrowserIdentityAvailable(actor);
    requireDevelopmentWorkItemRole(actor);
    return this.runDevelopment(input, actor);
  }

  async createDevelopmentAcceptanceRun(
    input: CanonicalDevelopmentWorkItemRunRequest,
    scope: CanonicalVerifiedDevelopmentCreateScope,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    assertDevelopmentCreateScope(input, scope);
    return this.runDevelopment(input, developmentServiceActor(scope), scope);
  }

  async createOauthSessionDevelopmentRun(
    input: CanonicalDevelopmentWorkItemRunRequest,
    sessionActor: CanonicalMiaodaFinalUserActorContext,
    gatewayActor: CanonicalMiaodaFinalUserActorContext,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    assertOauthSessionDevelopmentActors(sessionActor, gatewayActor);
    const developmentRunToken = requiredDevelopmentRunToken(
      input.developmentRunToken,
    );
    const actor = oauthSessionDevelopmentActor(sessionActor, gatewayActor);
    return this.runPdf(
      input.documentVersionId
        ? { documentVersionId: input.documentVersionId, query: input.query }
        : { selection: input.selection, query: input.query },
      actor,
      'MIAODA',
      `dev:${developmentRunToken}`,
      true,
      undefined,
      true,
    );
  }

  async retryOauthSessionDevelopmentRun(
    workItemIdValue: unknown,
    sessionActor: CanonicalMiaodaFinalUserActorContext,
    gatewayActor: CanonicalMiaodaFinalUserActorContext,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    assertOauthSessionDevelopmentActors(sessionActor, gatewayActor);
    const actor = oauthSessionDevelopmentActor(sessionActor, gatewayActor);
    const workItemId = requiredText(workItemIdValue, 'workItemId', 96);
    const binding = await this.repository.loadAuthorizationBinding({
      workItemId,
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
    });
    if (!binding || !binding.runKey.startsWith('dev:')) {
      throw canonicalWorkItemNotFound();
    }
    const actionContext = await this.vertical.authorizeExistingWorkItem({
      actor,
      action: 'PARSE_PDF',
      workItemId: binding.workItemId,
      requestId: binding.requestId,
      documentVersionId: binding.documentVersionId,
    });
    const fresh = await this.repository.loadTenantScopedProjection(
      binding.workItemId,
      actor.tenantId,
    );
    const retryableFailure =
      fresh?.projection?.phase === 'FAILED' &&
      fresh.projection.failure?.failureCode === 'SOURCE_BINDING_FAILED';
    const resumableRetry = fresh?.projection?.phase === 'PARSE_REQUESTED';
    const explicitReparse =
      fresh?.projection?.phase === 'CANDIDATE_READBACK_VERIFIED' &&
      fresh.projection.package !== null;
    if (!retryableFailure && !resumableRetry && !explicitReparse) {
      throw workItemRetryNotAvailable();
    }
    return this.runPdf(
      {
        documentVersionId: binding.documentVersionId,
        query: 'applicability',
      },
      actor,
      'MIAODA',
      binding.runKey,
      true,
      undefined,
      true,
      {
        workItemId: binding.workItemId,
        requestId: binding.requestId,
        mode: explicitReparse ? 'EXPLICIT_REPARSE' : 'RETRY_FAILURE',
        expectedRevision: fresh.projection.revision,
      },
      actionContext,
    );
  }

  private runDevelopment(
    input: CanonicalDevelopmentWorkItemRunRequest,
    actor: CanonicalHostActor,
    developmentScope?: CanonicalVerifiedDevelopmentCreateScope,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    const developmentRunToken = requiredDevelopmentRunToken(
      input.developmentRunToken,
    );
    return this.runPdf(
      input.documentVersionId
        ? { documentVersionId: input.documentVersionId, query: input.query }
        : { selection: input.selection, query: input.query },
      actor,
      'MIAODA',
      `dev:${developmentRunToken}`,
      true,
      developmentScope,
    );
  }

  private async runPdf(
    input: OrdinaryPdfParseInput,
    actor: CanonicalHostActor,
    origin: 'MIAODA' | 'AILY',
    runKey: string,
    requireCurrentDocumentVersion = false,
    developmentScope?: CanonicalVerifiedDevelopmentCreateScope,
    oauthSessionCreate = false,
    retryTarget?: ExistingParseRunTarget,
    existingAuthorization?: CanonicalHostActionContext,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    const context = hostedRequestContext(actor, oauthSessionCreate);
    const documentVersionId = input.documentVersionId
      ? requiredText(input.documentVersionId, 'documentVersionId', 96)
      : await this.ingestSelection(input.selection, context);
    if (input.documentVersionId) {
      if (developmentScope) {
        assertDevelopmentCreateScope(
          {
            documentVersionId,
            developmentRunToken: developmentScope.developmentRunToken,
          },
          developmentScope,
        );
      } else if (!oauthSessionCreate) {
        await this.assertCanResolveDocumentVersion({
          actor,
          documentVersionId,
          runKey,
          developmentCreate: requireCurrentDocumentVersion,
        });
      }
    }
    const resolved = await this.resolver.resolve(documentVersionId, {
      requireCurrent: requireCurrentDocumentVersion,
      expectedCreatorUserId: oauthSessionCreate ? actor.userId : undefined,
    });
    const classification = classificationFor(
      resolved.family.documentFamily,
      resolved.family.issuerAuthority,
      hostNativePdfAdapterIdFromDmPreflight(resolved.preflight),
    );
    const reservationInput = {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      documentId: resolved.version.documentId,
      documentVersionId: resolved.version.documentVersionId,
      sourceArtifactId: resolved.version.sourceArtifactId,
      sourceFileSha256: resolved.version.pdfSha256,
      sourceByteLength: Number(resolved.version.byteLength),
      normalizedFamily: classification.normalizedFamily,
      requestOrigin: origin,
      runKey,
    };
    const reservation = retryTarget
      ? {
          workItemId: retryTarget.workItemId,
          requestId: retryTarget.requestId,
          attemptId: '',
          created: false,
        }
      : await this.repository.reserve(reservationInput);
    let retryAuthorization = existingAuthorization;
    if (!reservation.created && !developmentScope && !retryAuthorization) {
      const retryState = await this.repository.loadTenantScopedProjection(
        reservation.workItemId,
        actor.tenantId,
      );
      if (
        retryState?.projection?.phase === 'FAILED' &&
        retryState.projection.failure?.failureCode === 'SOURCE_BINDING_FAILED'
      ) {
        retryAuthorization = await this.vertical.authorizeExistingWorkItem({
          actor,
          action: 'PARSE_PDF',
          workItemId: reservation.workItemId,
          requestId: reservation.requestId,
          documentVersionId: resolved.version.documentVersionId,
        });
      }
    }
    const retryAuthorizationProjection = retryAuthorization
      ? {
          action: 'PARSE_PDF' as const,
          actorFingerprint: retryAuthorization.decision.actorFingerprint,
          decisionId: retryAuthorization.decision.decisionId,
          decisionHash: retryAuthorization.decision.decisionHash,
          permissionSnapshotVersion:
            retryAuthorization.decision.permissionSnapshotVersion,
        }
      : undefined;
    const retry = reservation.created
      ? null
      : retryTarget?.mode === 'EXPLICIT_REPARSE'
        ? retryAuthorizationProjection
          ? await this.repository.reopenCompletedParse({
              ...reservationInput,
              workItemId: reservation.workItemId,
              requestId: reservation.requestId,
              expectedRevision: retryTarget.expectedRevision,
              authorization: retryAuthorizationProjection,
            })
          : null
        : await this.repository.reopenRetryableParseFailure({
            ...reservationInput,
            workItemId: reservation.workItemId,
            requestId: reservation.requestId,
            authorization: retryAuthorizationProjection,
          });
    if (retryTarget && !retry) throw workItemRetryNotAvailable();
    const request: CanonicalPdfVerticalRunRequest = {
      schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
      workItemId: reservation.workItemId,
      requestId: reservation.requestId,
      source: {
        documentId: resolved.version.documentId,
        documentVersionId: resolved.version.documentVersionId,
        parserRequestId: reservation.requestId,
        sourceArtifactId: resolved.version.sourceArtifactId,
        sourceFileSha256: `sha256:${resolved.version.pdfSha256}`,
        sourceByteLength: Number(resolved.version.byteLength),
        driveFileToken: resolved.artifact.providerObjectId,
        driveSourceVersion: resolved.artifact.providerVersionId,
      },
      classification,
      query: optionalQuery(input.query),
    };
    const result = retryAuthorization
      ? await this.vertical.runPdfWithExistingAuthorization(
          request,
          retryAuthorization,
        )
      : developmentScope
        ? await this.vertical.runPdfWithDevelopmentScope(
            request,
            actor,
            developmentScope,
          )
        : await this.vertical.runPdf(request, actor);
    return {
      schemaVersion: 'wiselink.3_1.ordinary_work_item_run.v1',
      workItemCreated: reservation.created,
      workItemReused: !reservation.created,
      actionAttemptId: retry?.attemptId ?? reservation.attemptId,
      result: {
        ...result,
        authority: {
          ...result.authority,
          onlineWritePerformed: !['local', 'test'].includes(actor.env),
        },
      },
    };
  }

  private async ingestSelection(
    selection: OrdinaryPdfParseInput['selection'],
    context: HostedRequestContext,
  ): Promise<string> {
    const bucketId = requiredText(
      selection?.bucketId,
      'selection.bucketId',
      255,
    );
    const filePath = requiredText(
      selection?.filePath,
      'selection.filePath',
      1024,
    );
    await this.documentManagement.assertCanIngest(context, {
      bucketId,
      filePath,
    });
    const key = createHash('sha256')
      .update(`${context.tenantId}\n${bucketId}\n${filePath}`)
      .digest('hex');
    const request = {
      selection: { bucketId, filePath },
      sourceChannel: 'canonical_miaoda_document_selection',
      sourceRef: `miaoda-file-service:${bucketId}:${filePath}`,
      idempotencyKey: `ordinary-document-ingest:${key}`,
      descriptor: {},
    };
    const result = await this.documentManagement.ingestFileServiceSelection(
      request,
      context,
    );
    return requiredText(
      (result as Record<string, unknown>).documentVersionId,
      'ingest.documentVersionId',
      96,
    );
  }

  private async assertCanResolveDocumentVersion(input: {
    actor: CanonicalHostActor;
    documentVersionId: string;
    runKey: string;
    developmentCreate: boolean;
  }): Promise<void> {
    const existing = await this.repository.loadTenantRunAuthorizationBinding({
      tenantId: input.actor.tenantId,
      documentVersionId: input.documentVersionId,
      runKey: input.runKey,
    });
    if (existing) {
      await this.vertical.authorizeExistingWorkItem({
        actor: input.actor,
        action: 'PARSE_PDF',
        workItemId: existing.workItemId,
        requestId: existing.requestId,
        documentVersionId: existing.documentVersionId,
      });
      return;
    }
    const ownedBinding =
      await this.repository.loadTenantDocumentAuthorizationBinding({
        tenantId: input.actor.tenantId,
        documentVersionId: input.documentVersionId,
        actorUserId: input.actor.userId,
      });
    if (ownedBinding) {
      await this.vertical.authorizeExistingWorkItem({
        actor: input.actor,
        action: 'PARSE_PDF',
        workItemId: ownedBinding.workItemId,
        requestId: ownedBinding.requestId,
        documentVersionId: ownedBinding.documentVersionId,
      });
      return;
    }
    throw Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  }
}

function hostedRequestContext(
  actor: CanonicalHostActor,
  oauthSessionCreate: boolean,
): HostedRequestContext {
  const context: HostedRequestContext = {
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    roles: [...actor.roles],
    appId: actor.appId,
    env: actor.env,
  };
  if (!oauthSessionCreate) return context;

  const finalUser = actor.objectAccessActor;
  if (
    finalUser?.identityProvenance !== 'FEISHU_OAUTH_USER_ACCESS_TOKEN' ||
    finalUser.sessionProvenance !== 'SERVER_OPAQUE_SESSION' ||
    finalUser.canonicalSubject.id !== actor.userId ||
    finalUser.tenantId !== actor.tenantId ||
    finalUser.applicationScopeId !== actor.appId
  ) {
    throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
  }
  return {
    ...context,
    runtimeIngestAuthority: {
      mode: 'HOSTED_OAUTH_SESSION_DEVELOPMENT_RUN',
      actorUserId: finalUser.canonicalSubject.id,
      tenantId: finalUser.tenantId,
      appId: finalUser.applicationScopeId,
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
    },
  };
}

function assertDevelopmentCreateScope(
  input: Pick<
    CanonicalDevelopmentWorkItemRunRequest,
    'documentVersionId' | 'developmentRunToken'
  >,
  scope: CanonicalVerifiedDevelopmentCreateScope,
): void {
  const documentVersionId = requiredText(
    input.documentVersionId,
    'documentVersionId',
    96,
  );
  const developmentRunToken = requiredDevelopmentRunToken(
    input.developmentRunToken,
  );
  if (
    scope.appId !== CANONICAL_APP_ID ||
    !scope.principalId.startsWith('service:') ||
    !scope.tenantId.trim() ||
    !['DEV', 'UAT'].includes(scope.environment) ||
    scope.documentVersionId !== documentVersionId ||
    scope.developmentRunToken !== developmentRunToken ||
    !/^sha256:[0-9a-f]{64}$/u.test(scope.authorizationFingerprint)
  ) {
    throw developmentScopeNotFound();
  }
}

function assertOauthSessionDevelopmentActors(
  sessionActor: CanonicalMiaodaFinalUserActorContext,
  gatewayActor: CanonicalMiaodaFinalUserActorContext,
): void {
  if (
    sessionActor.identityProvenance !== 'FEISHU_OAUTH_USER_ACCESS_TOKEN' ||
    sessionActor.sessionProvenance !== 'SERVER_OPAQUE_SESSION' ||
    sessionActor.env !== 'preview' ||
    sessionActor.applicationScopeId !== CANONICAL_APP_ID ||
    gatewayActor.identityProvenance !== 'MIAODA_GATEWAY_USER_CONTEXT' ||
    gatewayActor.applicationScopeId !== CANONICAL_APP_ID ||
    !['preview', 'runtime'].includes(gatewayActor.env) ||
    gatewayActor.canonicalSubject.id !== sessionActor.canonicalSubject.id ||
    gatewayActor.tenantId !== sessionActor.tenantId
  ) {
    throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
  }
  if (!gatewayActor.platformRoles.includes(CANONICAL_DEVELOPMENT_ROLE_ID)) {
    throw Object.assign(new Error('Development WorkItem role is required.'), {
      code: 'DEVELOPMENT_WORK_ITEM_ROLE_REQUIRED',
      statusCode: 403,
    });
  }
}

function oauthSessionDevelopmentActor(
  sessionActor: CanonicalMiaodaFinalUserActorContext,
  gatewayActor: CanonicalMiaodaFinalUserActorContext,
): CanonicalHostActor {
  return {
    userId: gatewayActor.canonicalSubject.id,
    tenantId: gatewayActor.tenantId,
    appId: gatewayActor.applicationScopeId,
    // DEV capability comes only from the native Miaoda gateway role. The
    // opaque OAuth session independently proves the same mapped user.
    roles: [...gatewayActor.platformRoles],
    env: gatewayActor.env,
    objectAccessActor: sessionActor,
  };
}

function canonicalWorkItemNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Canonical WorkItem not found.'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function workItemRetryNotAvailable(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('WorkItem retry is not available.'), {
    code: 'WORK_ITEM_RETRY_NOT_AVAILABLE',
    statusCode: 409,
  });
}

function developmentServiceActor(
  scope: CanonicalVerifiedDevelopmentCreateScope,
): CanonicalHostActor {
  return {
    userId: scope.principalId,
    tenantId: scope.tenantId,
    appId: scope.appId,
    roles: [],
    env: scope.environment.toLowerCase(),
  };
}

function developmentScopeNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Canonical development scope not found.'), {
    code: 'CANONICAL_DEVELOPMENT_SCOPE_NOT_FOUND',
    statusCode: 404,
  });
}

function requireDevelopmentWorkItemRole(actor: CanonicalHostActor): void {
  if (actor.env !== 'preview') {
    throw Object.assign(
      new Error('Development WorkItem creation is preview-only.'),
      {
        code: 'DEVELOPMENT_WORK_ITEM_PREVIEW_REQUIRED',
        statusCode: 403,
      },
    );
  }
  if (!actor.roles.includes(CANONICAL_DEVELOPMENT_ROLE_ID)) {
    throw Object.assign(new Error('Development WorkItem role is required.'), {
      code: 'DEVELOPMENT_WORK_ITEM_ROLE_REQUIRED',
      statusCode: 403,
    });
  }
}

function classificationFor(
  family: string,
  issuerAuthority: string,
  adapterId: string,
): CanonicalClassificationSelection {
  if (family === 'FTD') return { ...FTD_CLASSIFICATION };
  if (family === 'OEM_REFERENCE') return { ...OEM_REFERENCE_CLASSIFICATION };
  const classification = hostNativePdfClassificationFor({
    family,
    issuerAuthority,
    adapterId,
  });
  if (classification) return classification;
  throw Object.assign(
    new Error(`No activated hosted PDF producer profile for ${family}.`),
    { code: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE', statusCode: 409 },
  );
}

function optionalQuery(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'applicability';
  }
  return requiredText(value, 'query', 200);
}

function stableSha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw Object.assign(new Error(`${field} is required.`), {
      code: 'WORK_ITEM_INPUT_INVALID',
      statusCode: 400,
    });
  }
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > maxLength) {
    throw Object.assign(new Error(`${field} is invalid.`), {
      code: 'WORK_ITEM_INPUT_INVALID',
      statusCode: 400,
    });
  }
  return normalized;
}

function requiredDevelopmentRunToken(value: unknown): string {
  const normalized = requiredText(
    value,
    'developmentRunToken',
    36,
  ).toLowerCase();
  if (!DEVELOPMENT_RUN_TOKEN_PATTERN.test(normalized)) {
    throw Object.assign(new Error('developmentRunToken is invalid.'), {
      code: 'WORK_ITEM_DEVELOPMENT_RUN_TOKEN_INVALID',
      statusCode: 400,
    });
  }
  return normalized;
}

function boundedListOffset(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw Object.assign(new Error('offset is invalid.'), {
      code: 'WORK_ITEM_INPUT_INVALID',
      statusCode: 400,
    });
  }
  return parsed;
}

function normalizedExistingPdfPath(value: unknown): string | null {
  const normalized = String(value ?? '').trim().replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.length > 1024 ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    !normalized.toLocaleLowerCase().endsWith('.pdf') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return normalized;
}

function sameExactUserId(value: unknown, actorUserId: string): boolean {
  if (typeof value === 'string') return value === actorUserId;
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    String(value) === actorUserId
  );
}

function existingPdfUpdatedTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
