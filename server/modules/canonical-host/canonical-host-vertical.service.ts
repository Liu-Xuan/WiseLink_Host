import { Inject, Injectable } from '@nestjs/common';

import type {
  AilyParsedPackageQueryResponse,
  AilyWorkItemDeepLinkResponse,
  AilyWorkItemStatusResponse,
  CanonicalDocumentParsingPageResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalPdfVerticalRunRequest,
  CanonicalPdfVerticalRunResponse,
  CanonicalWorkItemProjection,
  UnifiedPackageReadbackResponse,
} from '@shared/api.interface';

import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import {
  packageIdValue,
  requiredText,
} from '../unified-reader/unified-reader.utils';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_HOST,
  CANONICAL_PDF_PRODUCER,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import { buildCanonicalPageProjections } from './canonical-host-page-projections';
import { CanonicalEntryFacadeService } from './canonical-entry-facade.service';
import { CanonicalFailureRecordingService } from './canonical-failure-recording.service';
import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActionContext,
  CanonicalHostActor,
  CanonicalPageInput,
  CanonicalPdfProducerPort,
  CanonicalPdfProducerResult,
  CanonicalPermissionSnapshotPort,
  CanonicalStatusInput,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

@Injectable()
export class CanonicalHostVerticalService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_PDF_PRODUCER)
    private readonly producer: CanonicalPdfProducerPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly _artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
    private readonly entryFacade: CanonicalEntryFacadeService,
    private readonly failureRecording: CanonicalFailureRecordingService,
  ) {}

  async runPdf(
    request: CanonicalPdfVerticalRunRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalPdfVerticalRunResponse> {
    validateRequest(request);
    const actionContext: CanonicalHostActionContext =
      await this.authorizeAction({
        actor,
        action: 'PARSE_PDF',
        workItemId: request.workItemId,
        requestId: request.requestId,
        documentVersionId: request.source.documentVersionId,
      });
    let projection: CanonicalWorkItemProjection =
      await this.registrar.loadOrCreate(
        seedProjection(request, actionContext),
      );
    assertSameRequest(projection, request);
    assertSameAuthorization(projection, actionContext);
    if (projection.phase === 'CANDIDATE_READBACK_VERIFIED') {
      try {
        return await this.reuseCompleted(request, projection);
      } catch (error) {
        const failed: CanonicalWorkItemProjection =
          await this.recordUnexpectedFailure(request, projection, error);
        return failedResponse(
          failed,
          this.entryFacade.status(failed),
        );
      }
    }
    if (projection.phase !== 'PARSE_REQUESTED') {
      throw new Error(`WORK_ITEM_NOT_RUNNABLE:${projection.phase}`);
    }
    projection = await this.registrar.compareAndSet({
      workItemId: request.workItemId,
      expectedRevision: projection.revision,
      next: {
        ...withoutRevision(projection),
        phase: 'PARSING',
      },
    });
    let packageAttempt: {
      packageId: string;
      contractId: string;
      contractRevision: string;
    } | null = null;
    let executionRoute = 'canonical-host-pdf-vertical';
    try {
      const produced: CanonicalPdfProducerResult =
        await this.producer.producePdf(request);
      if (produced.kind === 'FAILURE_SIGNAL') {
        return this.completeFailure(request, projection, produced);
      }
      executionRoute = produced.executionRoute;
      packageAttempt = {
        packageId: produced.packageId,
        contractId: produced.contractId,
        contractRevision: produced.contractRevision,
      };
      if (!produced.strictReaderValidated) {
        throw new Error('PDF_PRODUCER_RESULT_INVALID:STRICT_READER_REQUIRED');
      }
      packageIdValue(produced.packageId, 'producer.packageId');
      const readback: UnifiedPackageReadbackResponse =
        await this.reader.persistAndReadback(produced.bytes, {
          workItemId: request.workItemId,
          requestId: request.requestId,
          documentVersionId: request.source.documentVersionId,
          permissionSnapshotVersion: projection.permissionSnapshotVersion,
          packageId: produced.packageId,
          contractId: produced.contractId,
          contractRevision: produced.contractRevision,
          query: request.query,
        });
      projection = await this.registrar.compareAndSet({
        workItemId: request.workItemId,
        expectedRevision: projection.revision,
        next: {
          ...withoutRevision(projection),
          phase: 'CANDIDATE_READBACK_VERIFIED',
          package: packageProjection(
            readback,
            produced.usagePolicy,
            produced.documentIdentity,
          ),
          failure: null,
          recordingFailure: null,
        },
      });
      projection = await this.freshRead(request);
      return verifiedResponse(
        projection,
        readback,
        this.entryFacade.status(projection),
      );
    } catch (error) {
      const failed: CanonicalWorkItemProjection =
        await this.recordUnexpectedFailure(
          request,
          projection,
          error,
          packageAttempt,
          executionRoute,
        );
      return failedResponse(
        failed,
        this.entryFacade.status(failed),
      );
    }
  }

  async status(input: CanonicalStatusInput, actor: CanonicalHostActor) {
    await this.authorizeAction({
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: input.workItemId,
      requestId: input.requestId,
      documentVersionId: input.documentVersionId,
    });
    const projection = await this.registrar.getExact(input);
    return this.entryFacade.status(projection);
  }

  async openApiStatus(
    workItemId: string,
  ): Promise<AilyWorkItemStatusResponse> {
    const exactWorkItemId: string = requiredOpenApiText(
      workItemId,
      'workItemId',
      200,
    );
    const projection: CanonicalWorkItemProjection =
      await this.registrar.getByWorkItemId(exactWorkItemId);
    return {
      entry: this.entryFacade.status(projection),
      packageSummary:
        projection.package === null
          ? null
          : {
              packageId: projection.package.packageId,
              contractId: projection.package.contractId,
              contractRevision: projection.package.contractRevision,
              artifactSha256: projection.package.artifact.sha256,
              resultStatus: projection.package.resultStatus,
              title: projection.package.title,
              contentUnitCount: projection.package.contentUnitCount,
              sourceRefCount: projection.package.sourceRefCount,
              readerReceiptId: projection.package.readerReceiptId,
              fullValidationStatus: 'FULL_STRICT_VALIDATOR_PASSED',
            },
      assessmentSummary: projection.assessment ?? null,
      integratedAssessmentSummary:
        projection.integratedAssessment ?? null,
    };
  }

  async openApiDeepLink(
    workItemId: string,
  ): Promise<AilyWorkItemDeepLinkResponse> {
    const status: AilyWorkItemStatusResponse =
      await this.openApiStatus(workItemId);
    return {
      workItemId: status.entry.workItemId,
      deepLink: status.entry.deepLinkPath,
    };
  }

  async openApiQuery(input: {
    workItemId: string;
    query: string | undefined;
  }): Promise<AilyParsedPackageQueryResponse> {
    const exactWorkItemId: string = requiredOpenApiText(
      input.workItemId,
      'workItemId',
      200,
    );
    const projection: CanonicalWorkItemProjection =
      await this.registrar.getByWorkItemId(exactWorkItemId);
    if (
      projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      projection.package === null
    ) {
      throw new Error(`WORK_ITEM_QUERY_NOT_READY:${projection.phase}`);
    }
    const query: string = requiredOpenApiText(input.query, 'query', 200);
    const readback: UnifiedPackageReadbackResponse = await this.readPackage(
      projection,
      projection.permissionSnapshotVersion,
      query,
    );
    return {
      workItemId: projection.workItemId,
      packageId: readback.package.packageId,
      query,
      resultCount: readback.queryResults.length,
      results: readback.queryResults,
    };
  }

  async page(
    input: CanonicalPageInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalDocumentParsingPageResponse> {
    const projection: CanonicalWorkItemProjection =
      await this.registrar.getByWorkItemId(input.workItemId);
    const actionContext: CanonicalHostActionContext =
      await this.authorizeAction({
        actor,
        action: 'READ_DOCUMENT_PARSING',
        workItemId: input.workItemId,
        requestId: projection.requestId,
        documentVersionId: projection.source.documentVersionId,
      });
    let queryResults: UnifiedPackageReadbackResponse['queryResults'] = [];
    if (
      projection.phase === 'CANDIDATE_READBACK_VERIFIED' &&
      projection.package !== null
    ) {
      const readback: UnifiedPackageReadbackResponse =
        await this.readPackage(
          projection,
          actionContext.decision.permissionSnapshotVersion,
          input.query,
        );
      queryResults = readback.queryResults;
    }
    return {
      schemaVersion: CANONICAL_HOST.documentParsingPageSchemaVersion,
      status: 'FRESH_READ',
      workItem: projection,
      entry: this.entryFacade.status(projection),
      queryResults,
      ...buildCanonicalPageProjections({
        workItem: projection,
        queryResults,
        engineerReviewContext: null,
      }),
      readAuthorization: {
        action: 'READ_DOCUMENT_PARSING',
        decisionId: actionContext.decision.decisionId,
        permissionSnapshotVersion:
          actionContext.decision.permissionSnapshotVersion,
      },
    };
  }

  async query(
    input: CanonicalEntryQueryRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalEntryQueryResponse> {
    const actionContext: CanonicalHostActionContext =
      await this.authorizeAction({
        actor,
        action: 'QUERY_PARSED_UNITS',
        workItemId: input.workItemId,
        requestId: input.requestId,
        documentVersionId: input.documentVersionId,
      });
    const projection = await this.registrar.getExact(input);
    if (
      projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      projection.package === null
    ) {
      throw new Error(`WORK_ITEM_QUERY_NOT_READY:${projection.phase}`);
    }
    const readback: UnifiedPackageReadbackResponse = await this.readPackage(
      projection,
      actionContext.decision.permissionSnapshotVersion,
      input.query,
    );
    return {
      schemaVersion: CANONICAL_HOST.entryQuerySchemaVersion,
      status: 'CANDIDATE_QUERY_VERIFIED',
      entry: this.entryFacade.status(projection),
      readback,
    };
  }

  private async reuseCompleted(
    request: CanonicalPdfVerticalRunRequest,
    projection: CanonicalWorkItemProjection,
  ): Promise<CanonicalPdfVerticalRunResponse> {
    if (projection.package === null) {
      throw new Error('WORK_ITEM_CORRUPT:VERIFIED_WITHOUT_PACKAGE');
    }
    const readback = await this.reader.readback({
      workItemId: projection.workItemId,
      requestId: projection.requestId,
      documentVersionId: projection.source.documentVersionId,
      permissionSnapshotVersion: projection.permissionSnapshotVersion,
      package: {
        packageId: projection.package.packageId,
        contractId: projection.package.contractId,
        contractRevision: projection.package.contractRevision,
        artifact: projection.package.artifact,
      },
      query: request.query,
    });
    return verifiedResponse(
      projection,
      readback,
      this.entryFacade.status(projection),
    );
  }

  private async completeFailure(
    request: CanonicalPdfVerticalRunRequest,
    running: CanonicalWorkItemProjection,
    produced: Extract<CanonicalPdfProducerResult, { kind: 'FAILURE_SIGNAL' }>,
  ): Promise<CanonicalPdfVerticalRunResponse> {
    const frozen = await this.failureRecording.record({
      request,
      error: new Error(produced.failureCode),
      permissionSnapshotVersion: running.permissionSnapshotVersion,
      executionRoute: produced.executionRoute,
      packageAttempt: null,
    });
    let failed = await this.registrar.compareAndSet({
      workItemId: request.workItemId,
      expectedRevision: running.revision,
      next: {
        ...withoutRevision(running),
        phase: 'FAILED',
        package: null,
        failure: {
          failureCode: frozen.receipt.taxonomy.stableErrorCode,
          message: frozen.report.message,
          artifact: frozen.persisted.artifact,
          adapterReceipt: frozen.receipt,
          validationWriteReceipt: frozen.writeReceipt,
        },
        recordingFailure: null,
      },
    });
    failed = await this.freshRead(request);
    return {
      schemaVersion: CANONICAL_HOST.responseSchemaVersion,
      status: 'FAILED',
      workItem: failed,
      readback: null,
      entry: this.entryFacade.status(failed),
      authority: candidateAuthority(),
    };
  }

  private async recordUnexpectedFailure(
    request: CanonicalPdfVerticalRunRequest,
    running: CanonicalWorkItemProjection,
    error: unknown,
    packageAttempt: {
      packageId: string;
      contractId: string;
      contractRevision: string;
    } | null = null,
    executionRoute = 'canonical-host-pdf-vertical',
  ): Promise<CanonicalWorkItemProjection> {
    const causeCode: string = stableCauseCode(error);
    try {
      const frozen = await this.failureRecording.record({
        request,
        error,
        permissionSnapshotVersion: running.permissionSnapshotVersion,
        executionRoute,
        packageAttempt: packageAttempt ?? (running.package
          ? {
              packageId: running.package.packageId,
              contractId: running.package.contractId,
              contractRevision: running.package.contractRevision,
            }
          : null),
      });
      await this.registrar.compareAndSet({
        workItemId: request.workItemId,
        expectedRevision: running.revision,
        next: {
          ...withoutRevision(running),
          phase: 'FAILED',
          package: null,
          failure: {
            failureCode: frozen.receipt.taxonomy.stableErrorCode,
            message: frozen.report.message,
            artifact: frozen.persisted.artifact,
            adapterReceipt: frozen.receipt,
            validationWriteReceipt: frozen.writeReceipt,
          },
          recordingFailure: null,
        },
      });
    } catch (recordError) {
      const recordingCode: string = stableCauseCode(recordError);
      try {
        await this.registrar.compareAndSet({
          workItemId: request.workItemId,
          expectedRevision: running.revision,
          next: {
            ...withoutRevision(running),
            phase: 'RECORDING_FAILED',
            package: null,
            failure: null,
            recordingFailure: {
              failureCode: 'FAILURE_REPORT_RECORDING_FAILED',
              originalFailureCode: causeCode,
              message: `FailureReport recording failed: ${recordingCode}`,
            },
          },
        });
      } catch (stateError) {
        throw new Error(
          `WORK_ITEM_RECORDING_FAILED_STATE_UNRECORDED:${stableCauseCode(stateError)}`,
        );
      }
      return this.freshRead(request);
    }
    return this.freshRead(request);
  }

  private readPackage(
    projection: CanonicalWorkItemProjection,
    permissionSnapshotVersion: string,
    query: string,
  ): Promise<UnifiedPackageReadbackResponse> {
    if (projection.package === null) {
      throw new Error('WORK_ITEM_CORRUPT:PACKAGE_REQUIRED');
    }
    return this.reader.readback({
      workItemId: projection.workItemId,
      requestId: projection.requestId,
      documentVersionId: projection.source.documentVersionId,
      permissionSnapshotVersion,
      package: {
        packageId: projection.package.packageId,
        contractId: projection.package.contractId,
        contractRevision: projection.package.contractRevision,
        artifact: projection.package.artifact,
      },
      query,
    });
  }

  private async authorizeAction(input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId: string;
    documentVersionId: string;
  }): Promise<CanonicalHostActionContext> {
    const decision: CanonicalAuthorizationDecision =
      await this.authorization.authorize(input);
    validateDecision(decision, input.action);
    const fresh = await this.permissionSnapshots.freshRead({
      actor: input.actor,
      decision,
      workItemId: input.workItemId,
      requestId: input.requestId,
      documentVersionId: input.documentVersionId,
    });
    if (fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion) {
      throw new Error('AUTHORIZATION_STALE_PERMISSION_SNAPSHOT');
    }
    return { actor: input.actor, decision };
  }

  private freshRead(
    request: CanonicalPdfVerticalRunRequest,
  ): Promise<CanonicalWorkItemProjection> {
    return this.registrar.getExact({
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.source.documentVersionId,
    });
  }
}

function requiredOpenApiText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw Object.assign(new Error(`${field} is required.`), {
      code: 'AILY_READ_INPUT_INVALID',
      statusCode: 400,
      details: { field },
    });
  }
  const normalized: string = value.trim().normalize('NFC');
  if (!normalized || normalized.length > maxLength) {
    throw Object.assign(new Error(`${field} is invalid.`), {
      code: 'AILY_READ_INPUT_INVALID',
      statusCode: 400,
      details: { field },
    });
  }
  return normalized;
}

function seedProjection(
  request: CanonicalPdfVerticalRunRequest,
  actionContext: CanonicalHostActionContext,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  return {
    schemaVersion: CANONICAL_HOST.workItemSchemaVersion,
    workItemId: request.workItemId,
    requestId: request.requestId,
    phase: 'PARSE_REQUESTED',
    permissionSnapshotVersion:
      actionContext.decision.permissionSnapshotVersion,
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: actionContext.decision.actorFingerprint,
      decisionId: actionContext.decision.decisionId,
      decisionHash: actionContext.decision.decisionHash,
      permissionSnapshotVersion:
        actionContext.decision.permissionSnapshotVersion,
    },
    source: { ...request.source },
    classification: { ...request.classification },
    package: null,
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}

function withoutRevision(
  value: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = value;
  return rest;
}

function packageProjection(
  readback: UnifiedPackageReadbackResponse,
  usagePolicy: Extract<CanonicalPdfProducerResult, { kind: 'PACKAGE' }>['usagePolicy'],
  documentIdentity: Extract<CanonicalPdfProducerResult, { kind: 'PACKAGE' }>['documentIdentity'],
): NonNullable<CanonicalWorkItemProjection['package']> {
  return {
    packageId: readback.package.packageId,
    contractId: 'techpub.parsed-package.v1',
    contractRevision: 'frozen.2',
    artifact: { ...readback.artifact },
    contentHash: readback.package.contentHash,
    semanticHash: readback.package.semanticHash,
    provenanceHash: readback.package.provenanceHash,
    coverageHash: readback.package.coverageHash,
    resultStatus: readback.package.resultStatus,
    title: readback.package.title,
    ...(documentIdentity
      ? { documentIdentity: structuredClone(documentIdentity) }
      : {}),
    contentUnitCount: readback.package.contentUnitCount,
    sourceRefCount: readback.package.sourceRefCount,
    readerReceiptId: readback.receipt.readerReceiptId,
    ...(usagePolicy ? { usagePolicy: structuredClone(usagePolicy) } : {}),
    fullValidatorProof: {
      validatorId: readback.fullValidatorProof.validatorId,
      validatorRevision: readback.fullValidatorProof.validatorRevision,
      contractCommit: readback.fullValidatorProof.contractCommit,
      artifactSha256: readback.fullValidatorProof.artifactSha256,
    },
  };
}

function verifiedResponse(
  workItem: CanonicalWorkItemProjection,
  readback: UnifiedPackageReadbackResponse,
  entry: ReturnType<CanonicalEntryFacadeService['status']>,
): CanonicalPdfVerticalRunResponse {
  return {
    schemaVersion: CANONICAL_HOST.responseSchemaVersion,
    status: 'CANDIDATE_VERTICAL_VERIFIED',
    workItem,
    readback,
    entry,
    authority: candidateAuthority(),
  };
}

function candidateAuthority() {
  return {
    canonicalRoleSelected: false as const,
    onlineWritePerformed: false as const,
    applicationPublished: false as const,
    currentSelectionChanged: false as const,
    engineeringConclusionCreated: false as const,
  };
}

function failedResponse(
  workItem: CanonicalWorkItemProjection,
  entry: ReturnType<CanonicalEntryFacadeService['status']>,
): CanonicalPdfVerticalRunResponse {
  return {
    schemaVersion: CANONICAL_HOST.responseSchemaVersion,
    status:
      workItem.phase === 'RECORDING_FAILED'
        ? 'RECORDING_FAILED'
        : 'FAILED',
    workItem,
    readback: null,
    entry,
    authority: candidateAuthority(),
  };
}

function validateRequest(request: CanonicalPdfVerticalRunRequest): void {
  const wireRequest = request as unknown as Record<string, unknown>;
  for (const forbiddenField of [
    'actor',
    'authority',
    'decision',
    'deepLinkPath',
    'permissionSnapshotVersion',
  ]) {
    if (Object.hasOwn(wireRequest, forbiddenField)) {
      throw new Error(
        `CANONICAL_VERTICAL_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:${forbiddenField}`,
      );
    }
  }
  if (request.schemaVersion !== CANONICAL_HOST.requestSchemaVersion) {
    throw new Error('CANONICAL_VERTICAL_REQUEST_INVALID:SCHEMA_VERSION');
  }
  for (const value of [
    request.workItemId,
    request.requestId,
    request.source.documentId,
    request.source.documentVersionId,
    request.source.parserRequestId,
    request.source.sourceArtifactId,
    request.source.sourceFileSha256,
    request.source.driveFileToken,
    request.source.driveSourceVersion,
    request.classification.normalizedFamily,
    request.classification.classifierReleaseId,
    request.classification.classifierReleaseHash,
    request.classification.parserProfileId,
    request.classification.parserProfileHash,
    request.classification.fingerprint,
    request.query,
  ]) {
    requiredText(value, 'canonicalVertical.request', 500);
  }
  if (
    !Number.isSafeInteger(request.source.sourceByteLength) ||
    request.source.sourceByteLength <= 0
  ) {
    throw new Error('CANONICAL_VERTICAL_REQUEST_INVALID:SOURCE_BYTE_LENGTH');
  }
  if (!['CANDIDATE', 'CONFIRMED'].includes(request.classification.status)) {
    throw new Error('CANONICAL_VERTICAL_REQUEST_INVALID:CLASSIFICATION_STATUS');
  }
  if (request.classification.normalizedFamily === 'GENERIC') {
    throw new Error('CANONICAL_VERTICAL_REQUEST_INVALID:GENERIC_FAMILY');
  }
}

function validateDecision(
  decision: CanonicalAuthorizationDecision,
  expectedAction: CanonicalAuthorizationDecision['action'],
): void {
  if (!decision.allowed || decision.action !== expectedAction) {
    throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
  }
  requiredText(decision.actorFingerprint, 'decision.actorFingerprint', 80);
  requiredText(decision.decisionId, 'decision.decisionId', 200);
  requiredText(decision.decisionHash, 'decision.decisionHash', 80);
  requiredText(
    decision.permissionSnapshotVersion,
    'decision.permissionSnapshotVersion',
    200,
  );
}

function assertSameAuthorization(
  projection: CanonicalWorkItemProjection,
  actionContext: CanonicalHostActionContext,
): void {
  if (
    projection.parseAuthorization.actorFingerprint !==
      actionContext.decision.actorFingerprint ||
    projection.parseAuthorization.decisionHash !==
      actionContext.decision.decisionHash ||
    projection.permissionSnapshotVersion !==
      actionContext.decision.permissionSnapshotVersion
  ) {
    throw new Error('WORK_ITEM_AUTHORIZATION_IDEMPOTENCY_COLLISION');
  }
}

function stableCauseCode(error: unknown): string {
  const message: string = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const [head = 'UNKNOWN_ERROR'] = message.split(':', 1);
  const normalized: string = head
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/gu, '_')
    .slice(0, 160);
  return normalized || 'UNKNOWN_ERROR';
}

function assertSameRequest(
  projection: CanonicalWorkItemProjection,
  request: CanonicalPdfVerticalRunRequest,
): void {
  if (
    projection.workItemId !== request.workItemId ||
    projection.requestId !== request.requestId ||
    projection.source.documentVersionId !== request.source.documentVersionId ||
    projection.source.sourceFileSha256 !== request.source.sourceFileSha256 ||
    projection.classification.fingerprint !== request.classification.fingerprint
  ) {
    throw new Error('WORK_ITEM_IDEMPOTENCY_COLLISION');
  }
}
