import { createHash } from 'node:crypto';

import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Injectable, Optional } from '@nestjs/common';

import type {
  CanonicalClassificationSelection,
  CanonicalDevelopmentWorkItemRunRequest,
  CanonicalOrdinaryWorkItemRunResponse,
  CanonicalPdfVerticalRunRequest,
} from '@shared/api.interface';
import { CanonicalHostVerticalService } from '../canonical-host/canonical-host-vertical.service';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from '../canonical-host/canonical-host.constants';
import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';
import type { CanonicalVerifiedDevelopmentCreateScope } from '../canonical-host/canonical-service-scope.authorization';
import type { CanonicalMiaodaFinalUserActorContext } from './canonical-object-access.port';
import {
  DocumentManagementHostedService,
  type HostedRequestContext,
} from '../document-management/src/hosted/nest';
import { MiaodaDocumentVersionSourceResolver } from './miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from './miaoda-work-item.repository';
import { assertProductionMiaodaBrowserIdentityAvailable } from './production-miaoda-browser-ingress';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import {
  createPhase5BoeingSbIngestRequest,
  PHASE5_737_34_3830_HANDOFF,
} from '../document-management/src/hosted/phase5BoeingSbHandoff.js';

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

export interface OrdinaryPdfParseInput {
  documentVersionId?: unknown;
  selection?: {
    bucketId?: unknown;
    filePath?: unknown;
  };
  query?: unknown;
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
    @Optional() private readonly fileService?: FileService,
  ) {}

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
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    if (
      sessionActor.identityProvenance !== 'FEISHU_OAUTH_USER_ACCESS_TOKEN' ||
      sessionActor.sessionProvenance !== 'SERVER_OPAQUE_SESSION' ||
      sessionActor.env !== 'preview' ||
      sessionActor.applicationScopeId !== CANONICAL_APP_ID
    ) {
      throw Object.assign(new Error('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE'), {
        code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
        statusCode: 503,
      });
    }
    const developmentRunToken = requiredDevelopmentRunToken(
      input.developmentRunToken,
    );
    const actor: CanonicalHostActor = {
      userId: sessionActor.canonicalSubject.id,
      tenantId: sessionActor.tenantId,
      appId: sessionActor.applicationScopeId,
      // This capability is server-derived from the verified OAuth session and
      // this preview-only route. It is never accepted from the request body.
      roles: [CANONICAL_DEVELOPMENT_ROLE_ID],
      env: sessionActor.env,
      objectAccessActor: sessionActor,
    };
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
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    const context: HostedRequestContext = {
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      roles: [...actor.roles],
      appId: actor.appId,
      env: actor.env,
    };
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
    const classification = classificationFor(resolved.family.documentFamily);
    const reservation = await this.repository.reserve({
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
    });
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
    const result = developmentScope
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
      actionAttemptId: reservation.attemptId,
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
    const baseRequest = {
      selection: { bucketId, filePath },
      sourceChannel: 'canonical_miaoda_document_selection',
      sourceRef: `miaoda-file-service:${bucketId}:${filePath}`,
      idempotencyKey: `ordinary-document-ingest:${key}`,
      descriptor: {},
    };
    let request = baseRequest;
    if (this.fileService) {
      const actual = await new MiaodaFileServiceArtifactStore(
        this.fileService,
      ).readSelection({ bucketId, filePath });
      const handoff = phase5Handoff();
      if (
        actual.sha256 === handoff.source.sha256 &&
        Number(actual.byteLength) === handoff.source.byteLength
      ) {
        request = createPhase5BoeingSbIngestRequest({
          selection: { bucketId, filePath },
          sourceRef: `miaoda-file-service:${bucketId}:${actual.providerObjectId}`,
          idempotencyKey: `ordinary-document-ingest:${key}`,
        });
      }
    }
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

function classificationFor(family: string): CanonicalClassificationSelection {
  if (family === 'FTD') return { ...FTD_CLASSIFICATION };
  if (family === 'OEM_REFERENCE') return { ...OEM_REFERENCE_CLASSIFICATION };
  if (family === 'SB') {
    return structuredClone(phase5Handoff().canonicalHostClassification);
  }
  throw Object.assign(
    new Error(`No activated hosted PDF producer profile for ${family}.`),
    { code: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE', statusCode: 409 },
  );
}

function phase5Handoff() {
  return PHASE5_737_34_3830_HANDOFF as {
    source: { sha256: string; byteLength: number };
    canonicalHostClassification: CanonicalClassificationSelection;
  };
}

function optionalQuery(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'applicability';
  }
  return requiredText(value, 'query', 200);
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
