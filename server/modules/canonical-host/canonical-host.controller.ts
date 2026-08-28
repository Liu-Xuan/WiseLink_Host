import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import type { CanonicalHostActor } from './canonical-host.types';
import { hostActor } from './canonical-host-request-actor';

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

  @Post('work-items/parse-pdf')
  runPdf(@Body() request: unknown, @Req() httpRequest: Request) {
    return this.workItems.parsePdf(
      request as Parameters<OrdinaryWorkItemService['parsePdf']>[0],
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/document-parsing')
  page(
    @Param('workItemId') workItemId: string,
    @Query('query') query: string | undefined,
    @Req() httpRequest: Request,
  ) {
    return this.pageWithEngineerReviews(
      {
        workItemId,
        query,
      },
      hostActor(httpRequest),
    );
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
    integratedAssessmentActionBody(body);
    return this.integratedAssessments.confirmOpenClawOverallForAeo(
      requiredText(workItemId, 'workItemId'),
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
    input: { workItemId: string; query: string },
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

function integratedAssessmentActionBody(body: unknown): void {
  ordinaryBody(body, []);
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
