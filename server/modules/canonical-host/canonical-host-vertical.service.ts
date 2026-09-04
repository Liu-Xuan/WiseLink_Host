import { createHash } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import type {
  AilyParsedPackageQueryResponse,
  AilyWorkItemDeepLinkResponse,
  AilyWorkItemStatusResponse,
  CanonicalDocumentParsingPageResponse,
  CanonicalEntryQueryRequest,
  CanonicalEntryQueryResponse,
  CanonicalPdfVerticalRunRequest,
  CanonicalPdfVerticalRunResponse,
  CanonicalReferenceMentionPreviewItem,
  CanonicalReferenceTargetResolution,
  CanonicalRelatedContextPreviewResponse,
  CanonicalS1000dVerticalRunRequest,
  CanonicalS1000dVerticalRunResponse,
  CanonicalParsedPackageUsagePolicy,
  CanonicalStructuredContentPageResponse,
  CanonicalWorkItemProjection,
  CanonicalPdfPreviewProjection,
  CanonicalReaderProjection,
  UnifiedReaderQueryResult,
  UnifiedPackageSourceKind,
  UnifiedPackageReadbackResponse,
} from '@shared/api.interface';

import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { S1000dIngressService } from '../s1000d-ingress/s1000d-ingress.service';
import { DocumentManagementHostedService } from '../document-management/src/hosted/nest';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import type { PreparedS1000dIngressCandidate } from '../s1000d-ingress/s1000d-ingress.types';
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
  SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION,
  CANONICAL_TRANSLATION_OWNER_OBSERVATION,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import { buildCanonicalPageProjections } from './canonical-host-page-projections';
import {
  deriveCanonicalReferenceMentionPreview,
  type CanonicalReferenceMentionCandidate,
} from './canonical-reference-mention-preview';
import { buildCanonicalRelatedContextSnapshot } from './canonical-related-context-snapshot';
import {
  relatedContextAssessmentTarget,
  resolveCanonicalRelatedTargetApplicability,
  type CanonicalRelatedContextAssessmentTarget,
  type CanonicalRelatedTargetApplicabilityResolution,
} from './canonical-related-context-applicability';
import {
  projectCanonicalBrowserQueryResult,
  projectCanonicalStructuredContentUnit,
} from './canonical-structured-content-projection';
import { CanonicalEntryFacadeService } from './canonical-entry-facade.service';
import { projectConfigurationEvidenceReevaluationStatus } from './configuration-evidence/configuration-evidence-reevaluation.state';
import { CanonicalFailureRecordingService } from './canonical-failure-recording.service';
import {
  deriveTranslationConsumptionAxes,
  type CanonicalTranslationConsumptionBinding,
  type CanonicalTranslationOwnerObservation,
} from './canonical-reader-consumption';
import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActionContext,
  CanonicalHostActor,
  CanonicalPageInput,
  CanonicalPdfProducerPort,
  CanonicalPdfProducerResult,
  CanonicalPermissionSnapshotPort,
  CanonicalRelatedContextPreviewInput,
  CanonicalStatusInput,
  CanonicalStructuredContentBrowseInput,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import {
  assertScopedProfessionalArtifactCorrelation,
  type ScopedProfessionalArtifactCorrelationPort,
} from './scoped-professional-artifact-correlation.port';
import type { CanonicalTranslationOwnerObservationPort } from './canonical-translation-owner-observation.port';
import { parseBilingualTranslationArtifact } from './canonical-host-openclaw-translation.service';
import { CanonicalPdfPreviewService } from './canonical-pdf-preview.service';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
} from './canonical-translation-rule-set-v1.private';
import type {
  CanonicalVerifiedDevelopmentCreateScope,
  CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

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
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
    private readonly entryFacade: CanonicalEntryFacadeService,
    private readonly failureRecording: CanonicalFailureRecordingService,
    @Optional()
    @Inject(CANONICAL_TRANSLATION_OWNER_OBSERVATION)
    private readonly translationOwnerObservation: CanonicalTranslationOwnerObservationPort | null,
    @Optional()
    private readonly pdfPreviews?: CanonicalPdfPreviewService,
    @Optional()
    private readonly s1000dIngress?: S1000dIngressService,
    @Optional()
    @Inject(SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION)
    private readonly professionalCorrelations?: ScopedProfessionalArtifactCorrelationPort,
    @Optional()
    private readonly documentManagement?: DocumentManagementHostedService,
    @Optional()
    private readonly workItems?: MiaodaWorkItemRepository,
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
    return this.runPdfAuthorized(request, actionContext);
  }

  async runPdfWithDevelopmentScope(
    request: CanonicalPdfVerticalRunRequest,
    actor: CanonicalHostActor,
    scope: CanonicalVerifiedDevelopmentCreateScope,
  ): Promise<CanonicalPdfVerticalRunResponse> {
    validateRequest(request);
    return this.runPdfAuthorized(
      request,
      developmentActionContext(request, actor, scope),
    );
  }

  async runPdfWithExistingAuthorization(
    request: CanonicalPdfVerticalRunRequest,
    actionContext: CanonicalHostActionContext,
  ): Promise<CanonicalPdfVerticalRunResponse> {
    validateRequest(request);
    validateDecision(actionContext.decision, 'PARSE_PDF');
    return this.runPdfAuthorized(request, actionContext);
  }

  private async runPdfAuthorized(
    request: CanonicalPdfVerticalRunRequest,
    actionContext: CanonicalHostActionContext,
  ): Promise<CanonicalPdfVerticalRunResponse> {
    let projection: CanonicalWorkItemProjection =
      await this.registrar.loadOrCreate(seedProjection(request, actionContext));
    assertSameRequest(projection, request);
    assertSameAuthorization(projection, actionContext);
    if (projection.phase === 'CANDIDATE_READBACK_VERIFIED') {
      try {
        return await this.reuseCompleted(request, projection);
      } catch (error) {
        const failed: CanonicalWorkItemProjection =
          await this.recordUnexpectedFailure(request, projection, error);
        return failedResponse(failed, this.entryFacade.status(failed));
      }
    }
    if (projection.phase !== 'PARSE_REQUESTED') {
      throw new Error(`WORK_ITEM_NOT_RUNNABLE:${projection.phase}`);
    }
    const replacesCompletedPackage = projection.package !== null;
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
          ...(replacesCompletedPackage ? clearedDerivedCandidates() : {}),
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
      return failedResponse(failed, this.entryFacade.status(failed));
    }
  }

  /** Availability-only preflight used before the ordinary owner reserves. */
  assertS1000dAvailable(): void {
    if (!this.s1000dIngress) {
      throw serviceUnavailable('S1000D_INGRESS_UNCONFIGURED');
    }
    this.s1000dIngress.assertAvailable();
    if (
      !this.professionalCorrelations?.available ||
      typeof this.professionalCorrelations.readActualBytes !== 'function'
    ) {
      throw serviceUnavailable(
        'S1000D_PROFESSIONAL_ARTIFACT_CORRELATION_UNAVAILABLE',
      );
    }
  }

  async runS1000d(
    request: CanonicalS1000dVerticalRunRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalS1000dVerticalRunResponse> {
    validateS1000dRequest(request);
    if (!this.s1000dIngress) {
      throw serviceUnavailable('S1000D_INGRESS_UNCONFIGURED');
    }
    this.s1000dIngress.assertAvailable();
    if (
      !this.professionalCorrelations?.available ||
      typeof this.professionalCorrelations.readActualBytes !== 'function'
    ) {
      throw serviceUnavailable(
        'S1000D_PROFESSIONAL_ARTIFACT_CORRELATION_UNAVAILABLE',
      );
    }
    const actionContext = await this.authorizeAction({
      actor,
      action: 'PARSE_PDF',
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.source.documentVersionId,
    });
    let projection = await this.registrar.loadOrCreate(
      seedProjection(request, actionContext),
    );
    assertSameRequest(projection, request);
    assertSameAuthorization(projection, actionContext);
    if (projection.phase === 'CANDIDATE_READBACK_VERIFIED') {
      return this.reuseCompletedS1000d(request, projection);
    }
    if (projection.phase !== 'PARSE_REQUESTED') {
      throw new Error(`WORK_ITEM_NOT_RUNNABLE:${projection.phase}`);
    }
    const replacesCompletedPackage = projection.package !== null;
    projection = await this.registrar.compareAndSet({
      workItemId: request.workItemId,
      expectedRevision: projection.revision,
      next: { ...withoutRevision(projection), phase: 'PARSING' },
    });

    const prepared = await this.s1000dIngress.prepare(
      {
        workItemId: request.workItemId,
        requestId: request.requestId,
        documentVersionId: request.source.documentVersionId,
      },
      actor,
    );
    assertS1000dPreparedSourceMatchesRequest(request, prepared);
    await this.assertS1000dWorkItemCurrent(request, projection);

    const producedArtifact = candidatePackageArtifact(prepared.produced.bytes);
    const correlationRequest = {
      workItemId: request.workItemId,
      documentId: request.source.documentId,
      documentVersionId: request.source.documentVersionId,
      sourceArtifactId: request.source.sourceArtifactId,
      sourceSha256: prepared.source.sha256,
      sourceByteLength: prepared.source.byteLength,
      sourceProviderObjectId: prepared.source.providerObjectId,
      classification: request.classification,
    };
    const unresolvedCorrelation =
      await this.professionalCorrelations.persistAndCorrelate(
        correlationRequest,
        {
          packageId: prepared.produced.packageId,
          artifact: producedArtifact,
          bytes: prepared.produced.bytes,
          lineage: {
            producerDocumentId: prepared.source.documentId,
            producerDocumentVersionId: prepared.source.documentVersionId,
            documentCode: prepared.source.originalFilename,
            businessRevision: prepared.source.canonicalRevisionIdentity,
            packageRevisionLabel: prepared.source.revisionId,
          },
        },
      );
    if (!unresolvedCorrelation) {
      throw serviceUnavailable(
        'S1000D_PROFESSIONAL_ARTIFACT_CORRELATION_UNAVAILABLE',
      );
    }
    const actualReadback = await this.professionalCorrelations.readActualBytes!(
      unresolvedCorrelation,
    );
    assertScopedProfessionalArtifactCorrelation(
      correlationRequest,
      unresolvedCorrelation,
      actualReadback,
    );
    if (!sameBytes(actualReadback.bytes, prepared.produced.bytes)) {
      throw new Error('S1000D_PROFESSIONAL_ACTUAL_BYTE_MISMATCH');
    }

    const readback = await this.reader.persistAndReadback(
      actualReadback.bytes,
      {
        workItemId: request.workItemId,
        requestId: request.requestId,
        documentVersionId: request.source.documentVersionId,
        permissionSnapshotVersion: projection.permissionSnapshotVersion,
        packageId: prepared.produced.packageId,
        contractId: prepared.produced.contractId,
        contractRevision: prepared.produced.contractRevision,
        query: request.query,
      },
    );

    // A competing owner may advance the WorkItem while XML production or
    // actual-byte persistence runs. The immutable attempt artifact can remain,
    // but only the exact initial PARSING revision may publish current.
    await this.assertS1000dWorkItemCurrent(request, projection);
    projection = await this.registrar.compareAndSet({
      workItemId: request.workItemId,
      expectedRevision: projection.revision,
      next: {
        ...withoutRevision(projection),
        ...(replacesCompletedPackage ? clearedDerivedCandidates() : {}),
        phase: 'CANDIDATE_READBACK_VERIFIED',
        package: packageProjection(
          readback,
          s1000dUsagePolicy(prepared),
          undefined,
        ),
        failure: null,
        recordingFailure: null,
      },
    });
    projection = await this.freshRead(request);
    assertPublishedS1000dPackage(projection, prepared);
    return s1000dVerifiedResponse(prepared.summary);
  }

  private async reuseCompletedS1000d(
    request: CanonicalS1000dVerticalRunRequest,
    projection: CanonicalWorkItemProjection,
  ): Promise<CanonicalS1000dVerticalRunResponse> {
    if (!projection.package) {
      throw new Error('WORK_ITEM_CORRUPT:VERIFIED_WITHOUT_PACKAGE');
    }
    const bytes = await this.artifactStore.readActualBytes(
      projection.package.artifact,
    );
    const parsed = parseNativeS1000dPackage(bytes);
    await this.reader.readback({
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
    return s1000dVerifiedResponse({
      resultStatus: parsed.resultStatus,
      contentUnitCount: parsed.contentUnitCount,
      sourceRefCount: parsed.sourceRefCount,
      authorizedSourceArtifactCount: parsed.sourceArtifactIds.length,
    });
  }

  private async assertS1000dWorkItemCurrent(
    request: CanonicalS1000dVerticalRunRequest,
    expected: CanonicalWorkItemProjection,
  ): Promise<void> {
    const current = await this.registrar.getExact({
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.source.documentVersionId,
    });
    if (
      current.revision !== expected.revision ||
      current.phase !== 'PARSING' ||
      current.source.documentId !== expected.source.documentId ||
      current.source.documentVersionId !== expected.source.documentVersionId ||
      current.source.sourceArtifactId !== expected.source.sourceArtifactId ||
      current.source.sourceFileSha256 !== expected.source.sourceFileSha256 ||
      current.source.sourceByteLength !== expected.source.sourceByteLength ||
      current.source.driveFileToken !== expected.source.driveFileToken ||
      current.source.driveSourceVersion !==
        expected.source.driveSourceVersion ||
      current.classification.fingerprint !==
        expected.classification.fingerprint ||
      current.parseAuthorization.decisionHash !==
        expected.parseAuthorization.decisionHash ||
      current.permissionSnapshotVersion !== expected.permissionSnapshotVersion
    ) {
      throw Object.assign(new Error('S1000D_WORK_ITEM_DRIFT'), {
        code: 'S1000D_WORK_ITEM_DRIFT',
        statusCode: 409,
      });
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
    scope: CanonicalVerifiedServiceScope,
  ): Promise<AilyWorkItemStatusResponse> {
    const exactWorkItemId: string = requiredOpenApiText(
      workItemId,
      'workItemId',
      200,
    );
    const projection = await this.serviceScopedProjection(
      exactWorkItemId,
      scope,
    );
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
      integratedAssessmentSummary: projection.integratedAssessment ?? null,
      configurationEvidenceReevaluation:
        projectConfigurationEvidenceReevaluationStatus(projection),
    };
  }

  async openApiDeepLink(
    workItemId: string,
    scope: CanonicalVerifiedServiceScope,
  ): Promise<AilyWorkItemDeepLinkResponse> {
    const status: AilyWorkItemStatusResponse = await this.openApiStatus(
      workItemId,
      scope,
    );
    return {
      workItemId: status.entry.workItemId,
      deepLink: status.entry.deepLinkPath,
    };
  }

  async openApiQuery(
    input: {
      workItemId: string;
      query: string | undefined;
    },
    scope: CanonicalVerifiedServiceScope,
  ): Promise<AilyParsedPackageQueryResponse> {
    const exactWorkItemId: string = requiredOpenApiText(
      input.workItemId,
      'workItemId',
      200,
    );
    const projection = await this.serviceScopedProjection(
      exactWorkItemId,
      scope,
    );
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
    const actionContext: CanonicalHostActionContext =
      await this.authorizeAction({
        actor,
        action: 'READ_DOCUMENT_PARSING',
        workItemId: input.workItemId,
      });
    const projection: CanonicalWorkItemProjection =
      await this.registrar.getTenantScopedByWorkItemId({
        workItemId: input.workItemId,
        tenantId: actor.tenantId,
      });
    let queryResults: UnifiedPackageReadbackResponse['queryResults'] = [];
    let readerSourceKind: UnifiedPackageSourceKind | null = null;
    const query: string = optionalReaderQuery(input.query);
    const sourceRef: string = optionalReaderSourceRef(input.sourceRef);
    if (
      projection.phase === 'CANDIDATE_READBACK_VERIFIED' &&
      projection.package !== null
    ) {
      const inspection = await this.reader.inspectSourcePackage({
        artifact: projection.package.artifact,
        packageId: projection.package.packageId,
      });
      readerSourceKind = inspection.sourceKind;
      if (sourceRef !== '') {
        const sourceUnits: UnifiedReaderQueryResult[] =
          await this.reader.readAllSourceUnits({
            artifact: projection.package.artifact,
            packageId: projection.package.packageId,
          });
        queryResults = sourceUnits
          .filter((unit: UnifiedReaderQueryResult): boolean =>
            unit.sourceRefIds.includes(sourceRef),
          )
          .slice(0, 50)
          .map((result: UnifiedReaderQueryResult, index: number) =>
            projectCanonicalBrowserQueryResult(result, index + 1),
          )
          .filter((result) => result !== null);
      } else if (query !== '') {
        const readback: UnifiedPackageReadbackResponse = await this.readPackage(
          projection,
          actionContext.decision.permissionSnapshotVersion,
          query,
        );
        queryResults = readback.queryResults
          .map((result, index) =>
            projectCanonicalBrowserQueryResult(result, index + 1),
          )
          .filter((result) => result !== null);
      }
    }
    const translation = await this.readTranslationConsumptionAxes(projection);
    const pdfPreview: CanonicalPdfPreviewProjection =
      projection.package !== null &&
      readerSourceKind !== null &&
      this.pdfPreviews
        ? await this.pdfPreviews.issue(projection, actor)
        : {
            status: 'UNAVAILABLE',
            reason: 'PDF_PREVIEW_NOT_CONFIGURED',
            retryable: false,
          };
    return {
      schemaVersion: CANONICAL_HOST.documentParsingPageSchemaVersion,
      status: 'FRESH_READ',
      workItem: projection,
      entry: this.entryFacade.status(projection),
      queryResults,
      readerProjection: buildReaderProjection(
        projection,
        queryResults,
        query,
        readerSourceKind,
        translation,
        pdfPreview,
      ),
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

  async browseStructuredContent(
    input: CanonicalStructuredContentBrowseInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalStructuredContentPageResponse> {
    await this.authorizeAction({
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: input.workItemId,
    });
    const firstRead: CanonicalWorkItemProjection =
      await this.registrar.getTenantScopedByWorkItemId({
        workItemId: input.workItemId,
        tenantId: actor.tenantId,
      });
    assertStructuredContentReady(firstRead);

    await this.authorizeAction({
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: firstRead.workItemId,
      requestId: firstRead.requestId,
      documentVersionId: firstRead.source.documentVersionId,
    });
    const projection: CanonicalWorkItemProjection =
      await this.registrar.getTenantScopedByWorkItemId({
        workItemId: input.workItemId,
        tenantId: actor.tenantId,
      });
    assertStructuredContentReady(projection);
    if (
      projection.revision !== firstRead.revision ||
      projection.source.documentVersionId !== firstRead.source.documentVersionId
    ) {
      throw structuredContentConflict('STRUCTURED_CONTENT_REVISION_CHANGED');
    }
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== projection.revision
    ) {
      throw structuredContentConflict('STRUCTURED_CONTENT_REVISION_STALE');
    }
    if (input.cursor !== undefined && input.expectedRevision === undefined) {
      throw structuredContentBadRequest(
        'STRUCTURED_CONTENT_EXPECTED_REVISION_REQUIRED',
      );
    }

    const pkg = projection.package;
    if (pkg === null) {
      throw new Error('WORK_ITEM_CORRUPT:PACKAGE_REQUIRED');
    }
    const allUnits = await this.reader.readAllSourceUnits({
      artifact: pkg.artifact,
      packageId: pkg.packageId,
    });
    if (allUnits.length !== pkg.contentUnitCount) {
      throw new Error('STRUCTURED_CONTENT_COUNT_MISMATCH');
    }
    const browserUnits = allUnits
      .map((unit, index) =>
        projectCanonicalStructuredContentUnit(unit, index + 1),
      )
      .filter((unit) => unit !== null);
    const offset: number = structuredContentOffset(
      input.cursor,
      browserUnits.length,
    );
    const limit: number = structuredContentLimit(input.limit);
    const pageUnits = browserUnits.slice(offset, offset + limit);
    const nextOffset: number = offset + pageUnits.length;
    const hasMore: boolean = nextOffset < browserUnits.length;

    return {
      schemaVersion: 'wiselink.3_1.structured_content_page.v1',
      status: 'FRESH_READ',
      mode: 'BROWSE',
      revision: projection.revision,
      resultStatus: pkg.resultStatus,
      qualityStatus: pkg.usagePolicy?.qualityStatus ?? 'PASS',
      totalSourceUnitCount: allUnits.length,
      totalDisplayUnitCount: browserUnits.length,
      omittedUnitCount: allUnits.length - browserUnits.length,
      sourceRefCount: pkg.sourceRefCount,
      returnedUnitCount: pageUnits.length,
      cursor: offset === 0 ? null : String(offset),
      nextCursor: hasMore ? String(nextOffset) : null,
      hasMore,
      units: pageUnits,
    };
  }

  async explicitRelatedContextPreview(
    input: CanonicalRelatedContextPreviewInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalRelatedContextPreviewResponse> {
    await this.authorizeAction({
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: input.workItemId,
    });
    const firstRead: CanonicalWorkItemProjection =
      await this.registrar.getTenantScopedByWorkItemId({
        workItemId: input.workItemId,
        tenantId: actor.tenantId,
      });
    assertStructuredContentReady(firstRead);

    await this.authorizeAction({
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: firstRead.workItemId,
      requestId: firstRead.requestId,
      documentVersionId: firstRead.source.documentVersionId,
    });
    const projection: CanonicalWorkItemProjection =
      await this.registrar.getTenantScopedByWorkItemId({
        workItemId: input.workItemId,
        tenantId: actor.tenantId,
      });
    assertStructuredContentReady(projection);
    if (
      projection.revision !== firstRead.revision ||
      projection.source.documentVersionId !== firstRead.source.documentVersionId
    ) {
      throw structuredContentConflict('RELATED_CONTEXT_REVISION_CHANGED');
    }
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== projection.revision
    ) {
      throw structuredContentConflict('RELATED_CONTEXT_REVISION_STALE');
    }

    const pkg = projection.package;
    if (pkg === null) throw new Error('WORK_ITEM_CORRUPT:PACKAGE_REQUIRED');
    const allUnits = await this.reader.readAllSourceUnits({
      artifact: pkg.artifact,
      packageId: pkg.packageId,
    });
    const browserUnits = allUnits
      .map((unit, index) =>
        projectCanonicalStructuredContentUnit(unit, index + 1),
      )
      .filter((unit) => unit !== null);
    const mentionCandidates = deriveCanonicalReferenceMentionPreview(
      browserUnits,
      pkg.documentIdentity?.documentCode,
      allUnits,
    );
    const assessmentTarget = relatedContextAssessmentTarget(projection);
    const mentions = await this.resolveReferenceMentionTargets(
      mentionCandidates,
      actor,
      assessmentTarget,
    );
    const snapshotCandidate = buildCanonicalRelatedContextSnapshot({
      workItemId: projection.workItemId,
      inputRevision: projection.revision,
      primaryDocumentVersionId: projection.source.documentVersionId,
      assessmentTargetContextRef:
        assessmentTarget?.applicabilityContextRef ?? null,
      assessmentAsOf: assessmentTarget?.assessmentAsOf ?? null,
      mentions,
    });
    const snapshotArtifact = await this.artifactStore.persistAndReadback(
      snapshotCandidate.bytes,
    );

    return {
      schemaVersion: 'wiselink.3_1.related_context_preview.v1',
      status: 'FRESH_READ',
      mode: 'EXPLICIT_PREVIEW',
      revision: projection.revision,
      documentVersionId: projection.source.documentVersionId,
      totalMentionCount: mentions.length,
      mentions,
      snapshot: snapshotCandidate.snapshot,
      snapshotArtifact: snapshotArtifact.artifact,
      snapshotArtifactReused: snapshotArtifact.reused,
      authority: {
        candidateOnly: true,
        readOnly: true,
        includedInAssessmentInput: false,
      },
    };
  }

  private async resolveReferenceMentionTargets(
    mentions: CanonicalReferenceMentionCandidate[],
    actor: CanonicalHostActor,
    assessmentTarget: CanonicalRelatedContextAssessmentTarget | null,
  ): Promise<CanonicalReferenceMentionPreviewItem[]> {
    const targets = [...new Set(mentions.map((item) => item.normalizedTarget))];
    const catalogTargets = this.documentManagement
      ? await this.documentManagement.listCurrentReferenceTargets(targets, {
          actorUserId: actor.userId,
          tenantId: actor.tenantId,
          roles: [...actor.roles],
          appId: actor.appId,
          env: actor.env,
        })
      : [];
    const resolutions = new Map<string, ResolvedReferenceTarget>();
    await Promise.all(
      targets.map(async (target) => {
        resolutions.set(
          target,
          await this.resolveReferenceTarget(
            catalogTargets.filter(
              (match) =>
                canonicalReferenceLookupKey(match.canonicalDocumentNumber) ===
                canonicalReferenceLookupKey(target),
            ),
            actor,
            assessmentTarget,
          ),
        );
      }),
    );
    return mentions.map((mention) => {
      const resolved = resolutions.get(mention.normalizedTarget);
      return {
        ...mention,
        targetResolution: resolved?.resolution ?? {
          status: 'DOCUMENT_NOT_INGESTED',
        },
        targetApplicability: resolved?.targetApplicability ?? 'NOT_EVALUATED',
        ...(resolved?.applicabilityResultRef
          ? { applicabilityResultRef: resolved.applicabilityResultRef }
          : {}),
      };
    });
  }

  private async resolveReferenceTarget(
    matches: Array<{
      documentVersionId: string;
      canonicalDocumentNumber: string;
    }>,
    actor: CanonicalHostActor,
    assessmentTarget: CanonicalRelatedContextAssessmentTarget | null,
  ): Promise<ResolvedReferenceTarget> {
    if (!this.workItems) {
      return unresolvedReferenceTarget('DOCUMENT_NOT_INGESTED');
    }
    if (matches.length === 0) {
      return unresolvedReferenceTarget('DOCUMENT_NOT_INGESTED');
    }
    if (matches.length > 1) {
      return multipleReferenceTargets(matches.length);
    }

    const [match] = matches;
    const tenantBindings =
      await this.workItems.listTenantDocumentAuthorizationBindings({
        tenantId: actor.tenantId,
        documentVersionId: match.documentVersionId,
      });
    if (tenantBindings.length === 0) {
      return unresolvedReferenceTarget('DOCUMENT_NOT_INGESTED');
    }
    const authorized: typeof tenantBindings = [];
    for (const binding of tenantBindings) {
      if (binding.requestedByUserId !== actor.userId) continue;
      try {
        await this.authorizeAction({
          actor,
          action: 'READ_DOCUMENT_PARSING',
          workItemId: binding.workItemId,
          requestId: binding.requestId,
          documentVersionId: binding.documentVersionId,
        });
        authorized.push(binding);
      } catch {
        continue;
      }
    }
    if (authorized.length === 0) {
      return unresolvedReferenceTarget('ACCESS_DENIED');
    }
    if (authorized.length > 1) {
      return multipleReferenceTargets(authorized.length);
    }
    const [ownedBinding] = authorized;
    const loaded = await this.workItems.loadTenantScopedProjection(
      ownedBinding.workItemId,
      actor.tenantId,
    );
    if (
      !loaded?.projection ||
      loaded.row.requestedByUserId !== actor.userId ||
      loaded.projection.source.documentVersionId !== match.documentVersionId
    ) {
      return unresolvedReferenceTarget('ACCESS_DENIED');
    }
    const targetWorkItem = loaded.projection;
    return {
      resolution: {
        status: 'RESOLVED_EXACT',
        workItemId: ownedBinding.workItemId,
        documentVersionId: match.documentVersionId,
        canonicalDocumentNumber: match.canonicalDocumentNumber,
        businessRevision:
          targetWorkItem.package?.documentIdentity?.businessRevision ?? null,
      },
      ...resolveCanonicalRelatedTargetApplicability(
        assessmentTarget,
        targetWorkItem,
      ),
    };
  }

  /**
   * WL31 translation-reader candidate: derive the two independent
   * consumption axes from the owner observation (when configured) bound to
   * the exact current package lineage. Unconfigured or failing owner reads
   * fail closed to TRANSLATION_PROJECTION_NOT_AVAILABLE.
   */
  private async readTranslationConsumptionAxes(
    projection: CanonicalWorkItemProjection,
  ): Promise<CanonicalReaderProjection['translation']> {
    if (projection.package === null) {
      return {
        status: 'UNAVAILABLE',
        reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
      };
    }
    const binding: CanonicalTranslationConsumptionBinding | null =
      workItemTranslationBinding(projection);
    if (binding === null) {
      return {
        status: 'UNAVAILABLE',
        reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
      };
    }
    let hostArtifact: ReturnType<
      typeof parseBilingualTranslationArtifact
    > | null = null;
    if (projection.translation) {
      try {
        const bytes = await this.artifactStore.readActualBytes(
          projection.translation.artifact,
        );
        hostArtifact = parseBilingualTranslationArtifact(bytes);
        assertTranslationArtifactProjection(hostArtifact, projection);
      } catch {
        return {
          status: 'UNAVAILABLE',
          reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
        };
      }
    }
    let observation = workItemTranslationObservation(
      projection,
      hostArtifact?.units ?? null,
    );
    if (
      observation === null &&
      this.translationOwnerObservation?.configured === true
    ) {
      try {
        observation = await this.translationOwnerObservation.readObservation({
          documentId: binding.documentId,
          revisionId: binding.revisionId,
        });
      } catch {
        observation = null;
      }
    }
    const consumption = deriveTranslationConsumptionAxes({
      observation,
      binding,
    });
    if (
      consumption.status !== 'BILINGUAL_READING_AID_AVAILABLE' ||
      !projection.translation ||
      !hostArtifact
    ) {
      return consumption;
    }
    try {
      return {
        ...consumption,
        artifact: projection.translation.artifact,
        units: hostArtifact.units.map((unit) => ({
          ...unit,
          sourceRefIds: [...unit.sourceRefIds],
        })),
      };
    } catch {
      return {
        status: 'UNAVAILABLE',
        reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE',
      };
    }
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
      failureParameters: produced.parameters,
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
        package: running.package,
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
        packageAttempt:
          packageAttempt ??
          (running.package
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
          package: running.package,
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
            package: running.package,
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
    requestId?: string;
    documentVersionId?: string;
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
    if (
      fresh.permissionSnapshotVersion !== decision.permissionSnapshotVersion
    ) {
      throw new Error('AUTHORIZATION_STALE_PERMISSION_SNAPSHOT');
    }
    return { actor: input.actor, decision };
  }

  authorizeExistingWorkItem(input: {
    actor: CanonicalHostActor;
    action: CanonicalAuthorizationDecision['action'];
    workItemId: string;
    requestId?: string;
    documentVersionId?: string;
  }): Promise<CanonicalHostActionContext> {
    return this.authorizeAction(input);
  }

  private async serviceScopedProjection(
    workItemId: string,
    scope: CanonicalVerifiedServiceScope,
  ): Promise<CanonicalWorkItemProjection> {
    if (
      scope.workItemId !== workItemId ||
      scope.appId !== 'app_17bzc551rsg' ||
      !scope.principalId.trim() ||
      !scope.tenantId.trim() ||
      !scope.authorizationFingerprint.trim()
    ) {
      throw serviceScopedWorkItemNotFound();
    }
    try {
      return await this.registrar.getTenantScopedByWorkItemId({
        workItemId,
        tenantId: scope.tenantId,
      });
    } catch (error) {
      if (isExplicitWorkItemNotFound(error)) {
        throw serviceScopedWorkItemNotFound();
      }
      throw error;
    }
  }

  private freshRead(
    request: CanonicalVerticalRunRequest,
  ): Promise<CanonicalWorkItemProjection> {
    return this.registrar.getExact({
      workItemId: request.workItemId,
      requestId: request.requestId,
      documentVersionId: request.source.documentVersionId,
    });
  }
}

function developmentActionContext(
  request: CanonicalPdfVerticalRunRequest,
  actor: CanonicalHostActor,
  scope: CanonicalVerifiedDevelopmentCreateScope,
): CanonicalHostActionContext {
  if (
    scope.appId !== 'app_17bzc551rsg' ||
    scope.appId !== actor.appId ||
    scope.principalId !== actor.userId ||
    scope.tenantId !== actor.tenantId ||
    scope.documentVersionId !== request.source.documentVersionId ||
    actor.env !== scope.environment.toLowerCase() ||
    !scope.developmentRunToken.trim() ||
    !scope.authorizationFingerprint.trim()
  ) {
    throw serviceScopedWorkItemNotFound();
  }
  const seed = JSON.stringify({
    source: 'CONFIGURED_DEVELOPMENT_CREATE_SCOPE',
    appId: scope.appId,
    principalId: scope.principalId,
    tenantId: scope.tenantId,
    environment: scope.environment,
    documentVersionId: scope.documentVersionId,
    developmentRunToken: scope.developmentRunToken,
    workItemId: request.workItemId,
    requestId: request.requestId,
    authorizationFingerprint: scope.authorizationFingerprint,
  });
  const decisionHash = sha256(seed);
  const decision: CanonicalAuthorizationDecision = {
    action: 'PARSE_PDF',
    allowed: true,
    actorFingerprint: sha256(
      `${scope.appId}\n${scope.principalId}\n${scope.tenantId}`,
    ),
    decisionId: `decision-${decisionHash.slice(7, 39)}`,
    decisionHash,
    permissionSnapshotVersion: scope.authorizationFingerprint,
  };
  validateDecision(decision, 'PARSE_PDF');
  return { actor, decision };
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function serviceScopedWorkItemNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function isExplicitWorkItemNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown };
  return (
    value.code === 'WORK_ITEM_NOT_FOUND' ||
    value.code === 'CANONICAL_WORK_ITEM_NOT_FOUND' ||
    value.message === 'WORK_ITEM_NOT_FOUND'
  );
}

/**
 * Build the Host-side translation consumption binding from the current
 * WorkItem projection. The binding is never fabricated: SBD identity is the
 * current parsed package, and TCP lineage is null until Host projects one.
 */
function workItemTranslationBinding(
  workItem: CanonicalWorkItemProjection,
): CanonicalTranslationConsumptionBinding | null {
  const pkg = workItem.package;
  if (pkg === null) return null;
  return {
    documentId: workItem.source.documentId,
    revisionId: workItem.source.documentVersionId,
    sbdPackageId: pkg.packageId,
    sbdContentHash: pkg.contentHash,
    tcpPackageId: workItem.translation?.artifact.ref ?? null,
    tcpContentHash: workItem.translation?.artifact.sha256 ?? null,
  };
}

function workItemTranslationObservation(
  workItem: CanonicalWorkItemProjection,
  units: ReturnType<typeof parseBilingualTranslationArtifact>['units'] | null,
): CanonicalTranslationOwnerObservation | null {
  const translation = workItem.translation;
  const pkg = workItem.package;
  if (!translation || !pkg) return null;
  const current =
    translation.status === 'CANDIDATE_ONLY' &&
    translation.currentness === 'CURRENT' &&
    translation.staleReason === null &&
    translation.documentId === workItem.source.documentId &&
    translation.documentVersionId === workItem.source.documentVersionId &&
    translation.sourcePackageId === pkg.packageId &&
    translation.sourcePackageContentHash === pkg.contentHash &&
    translation.ruleSetId === CANONICAL_TRANSLATION_RULE_SET_V1_ID &&
    translation.ruleSetVersion === CANONICAL_TRANSLATION_RULE_SET_V1_VERSION;
  return {
    schemaVersion: 'wiselink.3_1.translation_owner_observation.v0.candidate',
    documentId: translation.documentId,
    revisionId: translation.documentVersionId,
    sourceTruth: 'StructuredBilingualDocument.units',
    currentConsumptionAllowed: current,
    currentnessGuardReason: current
      ? null
      : 'HOST_TRANSLATION_PROJECTION_STALE',
    productState:
      translation.pendingTranslationUnitCount === 0
        ? 'reading_aid_available'
        : 'translation_pending',
    translatedUnitCount: translation.translatedUnitCount,
    pendingTranslationUnitCount: translation.pendingTranslationUnitCount,
    translationRequiredUnitCount: translation.sourceUnitCount,
    units:
      units?.map((unit) => ({
        unitKey: unit.unitId,
        sourceUnitId: unit.unitId,
        sourceRef: unit.sourceRefIds[0] ?? '',
        sourceHash: translation.sourcePackageContentHash,
        sourceTextHash: sha256(unit.sourceText),
        targetLocale: translation.targetLocale,
        translatedTextState: 'translated' as const,
      })) ?? null,
    lineage: {
      documentId: translation.documentId,
      revisionId: translation.documentVersionId,
      sbdPackageId: translation.sourcePackageId,
      sbdContentHash: translation.sourcePackageContentHash,
      tcpPackageId: translation.artifact.ref,
      tcpContentHash: translation.artifact.sha256,
    },
  };
}

function assertTranslationArtifactProjection(
  artifact: ReturnType<typeof parseBilingualTranslationArtifact>,
  workItem: CanonicalWorkItemProjection,
): void {
  const translation = workItem.translation;
  if (
    !translation ||
    artifact.source.documentId !== translation.documentId ||
    artifact.source.revisionId !== translation.documentVersionId ||
    artifact.source.sbdPackageId !== translation.sourcePackageId ||
    artifact.source.sbdContentHash !== translation.sourcePackageContentHash ||
    artifact.ruleSet.ruleSetId !== translation.ruleSetId ||
    artifact.ruleSet.ruleSetVersion !== translation.ruleSetVersion ||
    translation.ruleSetId !== CANONICAL_TRANSLATION_RULE_SET_V1_ID ||
    translation.ruleSetVersion !== CANONICAL_TRANSLATION_RULE_SET_V1_VERSION ||
    artifact.units.length !== translation.translatedUnitCount ||
    artifact.execution.actionAttemptId !== translation.actionAttemptId
  ) {
    throw new Error('TRANSLATION_ARTIFACT_PROJECTION_MISMATCH');
  }
}

function buildReaderProjection(
  workItem: CanonicalWorkItemProjection,
  queryResults: UnifiedPackageReadbackResponse['queryResults'],
  query: string,
  sourceKind: UnifiedPackageSourceKind | null,
  translation: CanonicalReaderProjection['translation'],
  pdfPreview: CanonicalPdfPreviewProjection,
): CanonicalReaderProjection | null {
  if (!workItem.package || sourceKind === null) return null;
  return {
    sourceKind,
    structuredUnitCount: workItem.package.contentUnitCount,
    sourceRefCount: workItem.package.sourceRefCount,
    query,
    units: queryResults.map((result) => ({
      unitId: result.unitId,
      kind: result.kind,
      text: result.text,
      sourceRefIds: [...result.sourceRefIds],
      sourceLocators: (result.sourceLocators ?? []).map((locator) => ({
        ...locator,
        bbox: locator.bbox ? [...locator.bbox] : null,
      })),
    })),
    pdfPreview,
    translation,
  };
}

function optionalReaderQuery(value: string | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw structuredContentBadRequest('READER_QUERY_INVALID');
  }
  const normalized: string = value.trim().normalize('NFC');
  if (normalized.length > 200) {
    throw structuredContentBadRequest('READER_QUERY_INVALID');
  }
  return normalized;
}

function optionalReaderSourceRef(value: string | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw structuredContentBadRequest('READER_SOURCE_REF_INVALID');
  }
  const normalized: string = value.trim().normalize('NFC');
  if (normalized.length > 1_000) {
    throw structuredContentBadRequest('READER_SOURCE_REF_INVALID');
  }
  return normalized;
}

function assertStructuredContentReady(
  projection: CanonicalWorkItemProjection,
): void {
  if (
    projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    projection.package === null
  ) {
    throw structuredContentConflict(
      `STRUCTURED_CONTENT_NOT_READY:${projection.phase}`,
    );
  }
}

function structuredContentOffset(
  cursor: string | undefined,
  totalUnitCount: number,
): number {
  if (cursor === undefined || cursor === '') return 0;
  if (!/^(0|[1-9][0-9]*)$/u.test(cursor)) {
    throw structuredContentBadRequest('STRUCTURED_CONTENT_CURSOR_INVALID');
  }
  const offset: number = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= totalUnitCount) {
    throw structuredContentBadRequest('STRUCTURED_CONTENT_CURSOR_INVALID');
  }
  return offset;
}

function structuredContentLimit(limit: number | undefined): number {
  if (limit === undefined) return 24;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw structuredContentBadRequest('STRUCTURED_CONTENT_LIMIT_INVALID');
  }
  return limit;
}

function structuredContentBadRequest(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}

function structuredContentConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
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
  request: CanonicalVerticalRunRequest,
  actionContext: CanonicalHostActionContext,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  return {
    schemaVersion: CANONICAL_HOST.workItemSchemaVersion,
    workItemId: request.workItemId,
    requestId: request.requestId,
    phase: 'PARSE_REQUESTED',
    permissionSnapshotVersion: actionContext.decision.permissionSnapshotVersion,
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

function clearedDerivedCandidates(): Pick<
  CanonicalWorkItemProjection,
  | 'translation'
  | 'applicabilityControlledSelection'
  | 'applicabilityInput'
  | 'applicability'
  | 'assessment'
  | 'integratedAssessment'
  | 'aeo'
> {
  return {
    translation: null,
    applicabilityControlledSelection: null,
    applicabilityInput: null,
    applicability: null,
    assessment: null,
    integratedAssessment: null,
    aeo: null,
  };
}

function packageProjection(
  readback: UnifiedPackageReadbackResponse,
  usagePolicy: CanonicalParsedPackageUsagePolicy | undefined,
  documentIdentity:
    | { documentCode: string; businessRevision: string | null }
    | undefined,
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
      workItem.phase === 'RECORDING_FAILED' ? 'RECORDING_FAILED' : 'FAILED',
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

function validateS1000dRequest(
  request: CanonicalS1000dVerticalRunRequest,
): void {
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
        `CANONICAL_S1000D_VERTICAL_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:${forbiddenField}`,
      );
    }
  }
  if (
    request.schemaVersion !==
    'wiselink.3_1.canonical_s1000d_vertical_request.v1'
  ) {
    throw new Error('CANONICAL_S1000D_VERTICAL_REQUEST_INVALID:SCHEMA_VERSION');
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
    requiredText(value, 'canonicalS1000dVertical.request', 500);
  }
  if (
    !Number.isSafeInteger(request.source.sourceByteLength) ||
    request.source.sourceByteLength <= 0 ||
    !['CANDIDATE', 'CONFIRMED'].includes(request.classification.status) ||
    request.classification.normalizedFamily !== 'S1000D'
  ) {
    throw new Error('CANONICAL_S1000D_VERTICAL_REQUEST_INVALID:SOURCE_PROFILE');
  }
}

function validateDecision(
  decision: CanonicalAuthorizationDecision,
  expectedAction: CanonicalAuthorizationDecision['action'],
): void {
  if (!decision.allowed || decision.action !== expectedAction) {
    throw Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
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
  const message: string =
    error instanceof Error ? error.message : 'UNKNOWN_ERROR';
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
  request: CanonicalVerticalRunRequest,
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

function candidatePackageArtifact(bytes: Uint8Array) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return {
    storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref: `artifact://UnifiedArtifactStoreCandidate/unified-parsed-packages/sha256/${digest}`,
    sha256: digest,
    byteLength: bytes.byteLength,
    mediaType: 'application/json' as const,
  };
}

function s1000dUsagePolicy(
  prepared: PreparedS1000dIngressCandidate,
): CanonicalParsedPackageUsagePolicy {
  const parsed = parseNativeS1000dPackage(prepared.produced.bytes);
  return {
    presentationMode: 'REFERENCE_ONLY',
    qualityStatus: 'PASS',
    applicability: parsed.applicabilityCounts,
    assessmentAutoAdoptionAllowed: false,
    aeoAutoAdoptionAllowed: false,
    projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
  };
}

function parseNativeS1000dPackage(bytes: Uint8Array): {
  resultStatus: 'complete' | 'partial';
  contentUnitCount: number;
  sourceRefCount: number;
  sourceArtifactIds: string[];
  applicabilityCounts: {
    sourceExpressionCount: number;
    normalizedCandidateCount: number;
    assignmentCount: number;
  };
} {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('S1000D_CANONICAL_PACKAGE_ACTUAL_BYTES_INVALID');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('S1000D_CANONICAL_PACKAGE_ACTUAL_BYTES_INVALID');
  }
  const pkg = value as Record<string, any>;
  if (
    pkg.source?.kind !== 'native_s1000d' ||
    !['complete', 'partial'].includes(pkg.result?.status) ||
    !Array.isArray(pkg.contentUnits) ||
    !Array.isArray(pkg.sourceRefs) ||
    !Array.isArray(pkg.source?.artifactIds) ||
    pkg.source.artifactIds.some((item: unknown) => typeof item !== 'string') ||
    !Array.isArray(pkg.applicability?.sourceExpressions) ||
    !Array.isArray(pkg.applicability?.normalizedCandidates) ||
    !Array.isArray(pkg.applicability?.assignments)
  ) {
    throw new Error('S1000D_CANONICAL_PACKAGE_ACTUAL_BYTES_INVALID');
  }
  return {
    resultStatus: pkg.result.status,
    contentUnitCount: pkg.contentUnits.length,
    sourceRefCount: pkg.sourceRefs.length,
    sourceArtifactIds: [...pkg.source.artifactIds],
    applicabilityCounts: {
      sourceExpressionCount: pkg.applicability.sourceExpressions.length,
      normalizedCandidateCount: pkg.applicability.normalizedCandidates.length,
      assignmentCount: pkg.applicability.assignments.length,
    },
  };
}

function assertPublishedS1000dPackage(
  projection: CanonicalWorkItemProjection,
  prepared: PreparedS1000dIngressCandidate,
): void {
  if (
    projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    !projection.package ||
    projection.package.packageId !== prepared.produced.packageId ||
    projection.package.contentUnitCount !== prepared.summary.contentUnitCount ||
    projection.package.sourceRefCount !== prepared.summary.sourceRefCount
  ) {
    throw new Error('S1000D_CURRENT_PUBLICATION_READBACK_MISMATCH');
  }
}

function assertS1000dPreparedSourceMatchesRequest(
  request: CanonicalS1000dVerticalRunRequest,
  prepared: PreparedS1000dIngressCandidate,
): void {
  if (
    prepared.source.documentId !== request.source.documentId ||
    prepared.source.documentVersionId !== request.source.documentVersionId ||
    prepared.source.sourceArtifactId !== request.source.sourceArtifactId ||
    `sha256:${prepared.source.sha256}` !== request.source.sourceFileSha256 ||
    prepared.source.byteLength !== request.source.sourceByteLength ||
    prepared.source.providerObjectId !== request.source.driveFileToken ||
    prepared.source.providerVersionId !== request.source.driveSourceVersion
  ) {
    throw Object.assign(new Error('S1000D_REQUEST_SOURCE_DRIFT'), {
      code: 'S1000D_REQUEST_SOURCE_DRIFT',
      statusCode: 409,
    });
  }
}

function s1000dVerifiedResponse(
  summary: PreparedS1000dIngressCandidate['summary'],
): CanonicalS1000dVerticalRunResponse {
  return {
    schemaVersion: 'wiselink.3_1.canonical_s1000d_vertical_response.v1',
    status: 'CANDIDATE_VERTICAL_VERIFIED',
    sourceKind: 'native_s1000d',
    summary: { ...summary },
    boundary: {
      canonicalArtifactPersisted: true,
      professionalArtifactCorrelated: true,
      workItemCurrentPublished: true,
      readerProjectionCreated: true,
      actualSourceBytesExposed: false,
      internalIdentityExposed: false,
      applicabilityIsInstallationFact: false,
      publicationAuthorized: false,
      currentSelectionChanged: false,
    },
  };
}

type ResolvedReferenceTarget = CanonicalRelatedTargetApplicabilityResolution & {
  resolution: CanonicalReferenceTargetResolution;
};

function unresolvedReferenceTarget(
  status: 'DOCUMENT_NOT_INGESTED' | 'ACCESS_DENIED',
): ResolvedReferenceTarget {
  return {
    resolution: { status },
    targetApplicability: 'NOT_EVALUATED',
  };
}

function multipleReferenceTargets(
  candidateCount: number,
): ResolvedReferenceTarget {
  return {
    resolution: { status: 'RESOLVED_MULTIPLE', candidateCount },
    targetApplicability: 'NOT_EVALUATED',
  };
}

function canonicalReferenceLookupKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function serviceUnavailable(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}

type CanonicalVerticalRunRequest =
  | CanonicalPdfVerticalRunRequest
  | CanonicalS1000dVerticalRunRequest;
