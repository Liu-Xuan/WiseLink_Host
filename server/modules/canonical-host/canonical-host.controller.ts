import { libraryGraphHttpRequest } from './canonical-library-graph';
import { currentChecklistDefinition } from './jobaid-checklist-reading';
import { libraryAircraftModelsQuery, LIBRARY_CATALOG_PAGED_QUERY_BUDGET } from '@shared/library-aircraft-mentions';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  ForbiddenException,
  Param,
  Post,
  Query,
  Req,
  Optional,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalEngineerReviewDecision,
  CanonicalEntryQueryRequest,
  ConfirmCanonicalOverallForAeoRequest,
} from '@shared/api.interface';

import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { CANONICAL_DEVELOPMENT_ROLE_ID } from './canonical-host.constants';
import { CanonicalHostAeoService } from './canonical-host-aeo.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import { CanonicalHostIntegratedAssessmentService } from './canonical-host-integrated-assessment.service';
import { buildCanonicalPageProjections } from './canonical-host-page-projections';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import { CanonicalHostLibraryIndexService } from './canonical-host-library-index.service';
import { CanonicalLibraryService } from './canonical-library.service';
import type { CanonicalHostActor } from './canonical-host.types';
import { hostActor } from './canonical-host-request-actor';
import { SessionResolver } from '../identity/session-resolver.service';
import { CanonicalInitialAttemptControlService } from './canonical-initial-attempt-control.service';
import { z } from 'zod/v4';

const ENGINEER_DECISIONS = new Set<CanonicalEngineerReviewDecision>([
  'confirmed_pass',
  'confirmed_fail',
  'returned_for_rework',
  'deferred',
]);

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host')
export class CanonicalHostController {
  constructor(
    private readonly service: CanonicalHostVerticalService,
    private readonly workItems: OrdinaryWorkItemService,
    private readonly integratedAssessments: CanonicalHostIntegratedAssessmentService,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
    private readonly aeo: CanonicalHostAeoService,
    @Optional()
    private readonly libraryIndex?: CanonicalHostLibraryIndexService,
    @Optional()
    private readonly libraryDocuments?: CanonicalLibraryService,
    @Optional() private readonly jobAid?: CanonicalJobAidProblemService,
    @Optional() private readonly sessions?: SessionResolver,
    @Optional() private readonly initialAttemptControl?: CanonicalInitialAttemptControlService,
  ) {}

  @Get('identity-context')
  identityContext(@Req() httpRequest: Request) {
    const actor = hostActor(httpRequest);
    return {
      userId: actor.userId,
      tenantId: actor.tenantId,
      developmentIntakeAvailable:
        ['preview', 'runtime'].includes(actor.env) &&
        actor.roles.includes(CANONICAL_DEVELOPMENT_ROLE_ID),
    };
  }

  /** Authenticated display of this Host release's authored definition; no activation or task creation. */
  @Get('checklist-definition')
  checklistDefinition(@Req() request: Request) {
    hostActor(request);
    return currentChecklistDefinition();
  }

  @Post('work-items/parse-pdf')
  async runPdf(@Body() request: unknown, @Req() httpRequest: Request) {
    const actor = hostActor(httpRequest);
    const session = await this.sessions?.resolve(httpRequest);
    if (
      session &&
      (session.actor.canonicalSubject.id !== actor.userId ||
        session.actor.tenantId !== actor.tenantId ||
        session.actor.applicationScopeId !== actor.appId)
    )
      throw new ForbiddenException(
        'INITIAL_KNOWLEDGE_BROWSER_IDENTITY_MISMATCH',
      );
    return this.workItems.parsePdf(
      request as Parameters<OrdinaryWorkItemService['parsePdf']>[0],
      actor,
      'MIAODA',
      session?.session.id,
    );
  }

  @Get('library/fleet-catalog')
  fleetCatalog(@Req() httpRequest: Request) {
    if (!this.libraryDocuments)
      throw new Error('CANONICAL_LIBRARY_SERVICE_UNCONFIGURED');
    return this.libraryDocuments.fleetCatalog(hostActor(httpRequest));
  }

  @Get('library/graph')
  libraryGraph(
    @Query() query: Record<string, unknown>,
    @Req() httpRequest: Request,
  ) {
    if (!this.libraryDocuments)
      throw new Error('CANONICAL_LIBRARY_SERVICE_UNCONFIGURED');
    return this.libraryDocuments.graph(
      libraryGraphHttpRequest(query),
      hostActor(httpRequest),
    );
  }

  @Get('library/documents')
  documents(
    @Query('search') search: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() httpRequest: Request,
    @Query('normalizedFamily') normalizedFamily?: string,
    @Query('ata') ata?: string,
    @Query('aircraftModel') aircraftModel?: string,
    @Query('fleetFamily') fleetFamily?: string,
    @Query('fleetModel') fleetModel?: string,
    @Query('ata2') ata2?: string,
    @Query('ata4') ata4?: string,
    @Query('aircraftModels') aircraftModels?: string,
  ) {
    if (!this.libraryDocuments)
      throw new Error('CANONICAL_LIBRARY_SERVICE_UNCONFIGURED');
    return this.libraryDocuments.list(
      {
        search,
        normalizedFamily,
        ata,
        ata2,
        ata4,
        aircraftModel,
        aircraftModels: libraryModelsParameter(aircraftModels, httpRequest.originalUrl),
        fleetFamily,
        fleetModel,
        cursor,
        ...(limit === undefined
          ? {}
          : { limit: optionalSafeInteger(limit, 'limit') }),
      },
      hostActor(httpRequest),
    );
  }

  @Get('library/directory')
  directory(
    @Req() httpRequest: Request,
    @Query('search') search?: string,
    @Query('normalizedFamily') normalizedFamily?: string,
    @Query('fleetFamily') fleetFamily?: string,
    @Query('fleetModel') fleetModel?: string,
    @Query('aircraftModel') aircraftModel?: string,
    @Query('ata2') ata2?: string,
    @Query('aircraftModels') aircraftModels?: string,
    @Query('layout') layout?: 'ATA',
  ) {
    if (!this.libraryDocuments)
      throw new Error('CANONICAL_LIBRARY_SERVICE_UNCONFIGURED');
    return this.libraryDocuments.directory(
      { search, normalizedFamily, fleetFamily, fleetModel, aircraftModel, ata2,
        aircraftModels: libraryModelsParameter(aircraftModels, httpRequest.originalUrl), layout },
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/quicklook')
  quicklook(
    @Param('workItemId') workItemId: string,
    @Req() httpRequest: Request,
  ) {
    if (!this.libraryDocuments)
      throw new Error('CANONICAL_LIBRARY_SERVICE_UNCONFIGURED');
    return this.libraryDocuments.quicklook(
      requiredText(workItemId, 'workItemId'),
      hostActor(httpRequest),
    );
  }

  @Get('library/tasks')
  libraryTasks(
    @Query('search') search: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('familyId') familyId: string | undefined,
    @Req() httpRequest: Request,
  ) {
    if (!this.libraryDocuments)
      throw new Error('CANONICAL_LIBRARY_SERVICE_UNCONFIGURED');
    return this.libraryDocuments.listTasks(
      {
        search,
        cursor,
        familyId,
        ...(limit === undefined
          ? {}
          : { limit: optionalSafeInteger(limit, 'limit') }),
      },
      hostActor(httpRequest),
    );
  }

  @Post('work-items/parse-s1000d')
  runS1000d(@Body() request: unknown, @Req() httpRequest: Request) {
    return this.workItems.parseS1000d(
      request as Parameters<OrdinaryWorkItemService['parseS1000d']>[0],
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/document-parsing')
  page(
    @Param('workItemId') workItemId: string,
    @Query('query') query: string | undefined,
    @Query('sourceRef') sourceRef: string | undefined,
    @Req() httpRequest: Request,
  ) {
    const operation = () => this.pageWithEngineerReviews(
      {
        workItemId,
        query,
        sourceRef,
      },
      hostActor(httpRequest),
    );
    return this.sessions
      ? this.sessions.withNativeBrowserIdentity(httpRequest, () =>
          this.sessions!.withVerifiedNativeBrowserSql(operation),
        )
      : operation();
  }

  @Get('work-items/:workItemId/assessment-work')
  assessmentWork(
    @Param('workItemId') workItemId: string,
    @Req() request: Request,
    @Query() query?: Record<string, unknown>,
  ) {
    if (query && Object.keys(query).length) {
      if (!this.initialAttemptControl || !this.sessions) throw new Error('INITIAL_ATTEMPT_CONTROL_UNAVAILABLE');
      return this.sessions.withNativeBrowserIdentity(request, () => this.sessions!.withVerifiedNativeBrowserSql(async () => {
        try { return await this.initialAttemptControl!.read(workItemId,query,hostActor(request)); }
        catch (error) {
          if (error instanceof z.ZodError) throw new BadRequestException('INITIAL_ATTEMPT_READ_INVALID');
          throw error;
        }
      }));
    }
    if (!this.jobAid) throw new Error('JOBAID_RUNTIME_UNAVAILABLE');
    return this.jobAid.readBrowser(workItemId, hostActor(request));
  }

  @Get('work-items/:workItemId/assessment-work/attempts/:attemptId/program-materials')
  programAssessmentMaterials(@Param('workItemId') workItemId: string,
    @Param('attemptId') attemptId: string, @Req() request: Request) {
    if (!this.jobAid || !this.sessions) throw new Error('JOBAID_RUNTIME_UNAVAILABLE');
    return this.sessions.withNativeBrowserIdentity(request, () => this.sessions!.withVerifiedNativeBrowserSql(() =>
      this.jobAid!.readBrowserProgramMaterials(workItemId, attemptId, hostActor(request))));
  }

  @Get('work-items/:workItemId/structured-content')
  structuredContent(
    @Param('workItemId') workItemId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitValue: string | undefined,
    @Query('expectedRevision') expectedRevisionValue: string | undefined,
    @Req() httpRequest: Request,
  ) {
    return this.service.browseStructuredContent(
      {
        workItemId: requiredText(workItemId, 'workItemId'),
        ...(cursor?.trim() ? { cursor: cursor.trim() } : {}),
        ...(limitValue === undefined
          ? {}
          : { limit: optionalSafeInteger(limitValue, 'limit') }),
        ...(expectedRevisionValue === undefined
          ? {}
          : {
              expectedRevision: optionalSafeInteger(
                expectedRevisionValue,
                'expectedRevision',
              ),
            }),
      },
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/related-context/explicit-preview')
  explicitRelatedContextPreview(
    @Param('workItemId') workItemId: string,
    @Query('expectedRevision') expectedRevisionValue: string | undefined,
    @Req() httpRequest: Request,
  ) {
    return this.service.explicitRelatedContextPreview(
      {
        workItemId: requiredText(workItemId, 'workItemId'),
        ...(expectedRevisionValue === undefined
          ? {}
          : {
              expectedRevision: optionalSafeInteger(
                expectedRevisionValue,
                'expectedRevision',
              ),
            }),
      },
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/library-index')
  library(
    @Param('workItemId') workItemId: string,
    @Req() httpRequest: Request,
  ) {
    if (!this.libraryIndex) {
      throw new Error('CANONICAL_LIBRARY_INDEX_SERVICE_UNCONFIGURED');
    }
    return this.libraryIndex.read({
      workItemId: requiredText(workItemId, 'workItemId'),
      actor: hostActor(httpRequest),
    });
  }

  @Get('work-items/:workItemId/initial-analysis')
  initialAnalysis(
    @Param('workItemId') workItemId: string,
    @Req() httpRequest: Request,
  ) {
    const operation = () => this.service.browserInitialAnalysisStatus(
      requiredText(workItemId, 'workItemId'),
      hostActor(httpRequest),
    );
    return this.sessions
      ? this.sessions.withNativeBrowserIdentity(httpRequest, () =>
          this.sessions!.withVerifiedNativeBrowserSql(operation),
        )
      : operation();
  }

  @Get('work-items/:workItemId/status')
  status(
    @Param('workItemId') workItemId: string,
    @Query('requestId') requestId: string,
    @Query('documentVersionId') documentVersionId: string,
    @Req() httpRequest: Request,
  ) {
    return this.service.status(
      {
        workItemId,
        requestId,
        documentVersionId,
      },
      hostActor(httpRequest),
    );
  }

  @Post('work-items/query-parsed-units')
  query(
    @Body() request: CanonicalEntryQueryRequest,
    @Req() httpRequest: Request,
  ) {
    return this.service.query(request, hostActor(httpRequest));
  }

  @Post('work-items/:workItemId/integrated-assessment/engineer-reviews')
  recordEngineerReview(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ) {
    const input = engineerReviewBody(body);
    return this.engineerReviews.recordReview(
      { workItemId: requiredText(workItemId, 'workItemId'), ...input },
      hostActor(httpRequest),
    );
  }

  @Post('work-items/:workItemId/integrated-assessment/confirm-for-aeo')
  confirmOpenClawOverallForAeo(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ) {
    const input = overallConfirmationBody(body);
    return this.integratedAssessments.confirmOpenClawOverallForAeo(
      requiredText(workItemId, 'workItemId'),
      input,
      hostActor(httpRequest),
    );
  }

  @Post('work-items/:workItemId/aeo/candidate')
  generateAeoCandidate(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ) {
    integratedAssessmentActionBody(body);
    return this.aeo.generateCandidate(
      requiredText(workItemId, 'workItemId'),
      hostActor(httpRequest),
    );
  }

  private async pageWithEngineerReviews(
    input: {
      workItemId: string;
      query?: string;
      sourceRef?: string;
    },
    actor: CanonicalHostActor,
  ) {
    const page = await this.service.page(input, actor);
    const engineerReviewContext = await this.engineerReviews.pageContext(
      page.workItem,
    );
    return {
      ...page,
      engineerReviewContext,
      ...buildCanonicalPageProjections({
        workItem: page.workItem,
        queryResults: page.queryResults,
        engineerReviewContext,
      }),
    };
  }
}

function libraryModelsParameter(value: string | undefined, originalUrl?: string): string[] | undefined {
  if (value !== undefined && originalUrl && Buffer.byteLength(originalUrl, 'utf8') > LIBRARY_CATALOG_PAGED_QUERY_BUDGET)
    throw new BadRequestException('LIBRARY_CATALOG_QUERY_TOO_LONG');
  try { return libraryAircraftModelsQuery(value); }
  catch (error: unknown) { throw new BadRequestException(error instanceof Error ? error.message : 'LIBRARY_AIRCRAFT_MODELS_INVALID'); }
}

function integratedAssessmentActionBody(body: unknown): void {
  ordinaryBody(body, []);
}

function overallConfirmationBody(body: unknown): ConfirmCanonicalOverallForAeoRequest {
  const value = ordinaryBody(body, [
    'expectedRevision', 'expectedOverallRevision', 'expectedOverallArtifactRef',
  ]);
  return {
    expectedRevision: requiredRevision(value.expectedRevision),
    expectedOverallRevision: requiredRevision(value.expectedOverallRevision),
    expectedOverallArtifactRef: requiredText(
      value.expectedOverallArtifactRef, 'expectedOverallArtifactRef',
    ),
  };
}

function engineerReviewBody(body: unknown): {
  expectedRevision: number;
  criterionId: string;
  decision: CanonicalEngineerReviewDecision;
  comment: string;
} {
  const value = ordinaryBody(body, [
    'expectedRevision',
    'criterionId',
    'decision',
    'comment',
  ]);
  const expectedRevision = requiredRevision(value.expectedRevision);
  const criterionId = requiredText(value.criterionId, 'criterionId');
  const decision = requiredText(
    value.decision,
    'decision',
  ) as CanonicalEngineerReviewDecision;
  const comment = requiredText(value.comment, 'comment');
  if (!ENGINEER_DECISIONS.has(decision)) {
    throw badRequest('ENGINEER_REVIEW_DECISION_INVALID');
  }
  return { expectedRevision, criterionId, decision, comment };
}

function ordinaryBody(
  body: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('ASSESSMENT_REQUEST_BODY_INVALID');
  }
  const value = body as Record<string, unknown>;
  const forbidden = [
    'actor',
    'authority',
    'decisionId',
    'permissionSnapshotVersion',
    'package',
    'packageRef',
    'reviewedExternalManifest',
    'externalDiscovery',
  ];
  for (const key of forbidden) {
    if (Object.hasOwn(value, key)) {
      throw badRequest(
        `ASSESSMENT_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:${key}`,
      );
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw badRequest(`ASSESSMENT_REQUEST_INVALID:UNKNOWN_FIELD:${key}`);
    }
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`ASSESSMENT_${field.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
}

function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw badRequest('ASSESSMENT_EXPECTEDREVISION_INVALID');
  }
  return Number(value);
}

function optionalSafeInteger(value: string, field: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw badRequest(`STRUCTURED_CONTENT_${field.toUpperCase()}_INVALID`);
  }
  const parsed: number = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw badRequest(`STRUCTURED_CONTENT_${field.toUpperCase()}_INVALID`);
  }
  return parsed;
}

function badRequest(code: string): BadRequestException {
  return new BadRequestException({ code, message: code });
}
