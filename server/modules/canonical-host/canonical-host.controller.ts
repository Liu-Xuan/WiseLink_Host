import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalEntryQueryRequest,
} from '@shared/api.interface';
import type {
  EngineerActionDecision,
  EvaluationItemBaseStatus,
} from '@shared/assessment-host.interface';

import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostAeoService } from './canonical-host-aeo.service';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import type { CanonicalHostActor } from './canonical-host.types';

const ENGINEER_DECISIONS = new Set<EngineerActionDecision>([
  'confirmed_pass',
  'confirmed_fail',
  'returned_for_rework',
  'deferred',
]);

@NeedLogin()
@Controller('api/canonical-host')
export class CanonicalHostController {
  constructor(
    private readonly service: CanonicalHostVerticalService,
    private readonly workItems: OrdinaryWorkItemService,
    private readonly assessments: CanonicalHostAssessmentService,
    private readonly aeo: CanonicalHostAeoService,
  ) {}

  @Post('work-items/parse-pdf')
  runPdf(
    @Body() request: unknown,
    @Req() httpRequest: Request,
  ) {
    return this.workItems.parsePdf(
      request as Parameters<OrdinaryWorkItemService['parsePdf']>[0],
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/document-parsing')
  page(
    @Param('workItemId') workItemId: string,
    @Query('query') query: string,
    @Req() httpRequest: Request,
  ) {
    return this.service.page(
      {
        workItemId,
        query,
      },
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/status')
  status(
    @Param('workItemId') workItemId: string,
    @Query('requestId') requestId: string,
    @Query('documentVersionId') documentVersionId: string,
    @Req() httpRequest: Request,
  ) {
    return this.service.status({
      workItemId,
      requestId,
      documentVersionId,
    }, hostActor(httpRequest));
  }

  @Post('work-items/query-parsed-units')
  query(
    @Body() request: CanonicalEntryQueryRequest,
    @Req() httpRequest: Request,
  ) {
    return this.service.query(request, hostActor(httpRequest));
  }

  @Post('work-items/:workItemId/assessment/evaluate')
  evaluateAssessment(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ) {
    assessmentEvaluateBody(body);
    const now = new Date().toISOString();
    return this.assessments.evaluateCandidate(
      {
        workItemId: requiredText(workItemId, 'workItemId'),
        assessmentAsOf: now,
        generatedAt: now,
      },
      hostActor(httpRequest),
    );
  }

  @Post('work-items/:workItemId/assessment/resynthesize')
  resynthesizeAssessment(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ) {
    const input = assessmentResynthesisBody(body);
    const actor = hostActor(httpRequest);
    return this.assessments.resynthesizeAfterEngineerChange(
      {
        workItemId: requiredText(workItemId, 'workItemId'),
        expectedRevision: input.expectedRevision,
        criterionId: input.criterionId,
        review: {
          baseRecordId: `ENGINEER-REVIEW:${workItemId}:${input.criterionId}`,
          decision: input.decision,
          comment: input.comment,
          reviewingEngineerUserIds: [actor.userId],
          status: input.status,
          updatedAt: new Date().toISOString(),
        },
      },
      actor,
    );
  }

  @Post('validation/phase10-aeo-candidate-loop')
  runPhase10AeoCandidateLoop(
    @Body() body: unknown,
    @Req() httpRequest: Request,
  ) {
    phase10AeoBody(body);
    return this.aeo.runPhase10CandidateLoop(hostActor(httpRequest));
  }
}

export function hostActor(request: Request): CanonicalHostActor {
  const context = request.userContext;
  if (!context?.userId || !context.tenantId || !context.appId || !context.env) {
    throw new UnauthorizedException('CANONICAL_HOST_ACTOR_CONTEXT_REQUIRED');
  }
  return {
    userId: context.userId,
    tenantId: String(context.tenantId),
    appId: context.appId,
    roles: [...(context.roles ?? [])],
    env: context.env,
  };
}

function assessmentEvaluateBody(body: unknown): void {
  ordinaryBody(body, []);
}

function phase10AeoBody(body: unknown): void {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body as Record<string, unknown>).length !== 0
  ) {
    throw badRequest('AEO_PHASE10_REQUEST_BODY_MUST_BE_EMPTY');
  }
}

function assessmentResynthesisBody(body: unknown): {
  expectedRevision: number;
  criterionId: string;
  decision: EngineerActionDecision;
  comment: string;
  status: EvaluationItemBaseStatus;
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
  ) as EngineerActionDecision;
  const comment = requiredText(value.comment, 'comment');
  if (!ENGINEER_DECISIONS.has(decision)) {
    throw badRequest('ASSESSMENT_ENGINEER_DECISION_INVALID');
  }
  const status: EvaluationItemBaseStatus =
    decision === 'confirmed_pass' || decision === 'confirmed_fail'
      ? 'ENGINEER_CONFIRMED'
      : 'NEEDS_REVIEW';
  return { expectedRevision, criterionId, decision, comment, status };
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

function badRequest(code: string): BadRequestException {
  return new BadRequestException({ code, message: code });
}
