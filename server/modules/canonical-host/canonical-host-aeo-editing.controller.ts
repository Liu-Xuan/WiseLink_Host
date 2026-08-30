import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalAeoEditingDraftCreateRequest,
  CanonicalAeoEditingDraftFeedbackRequest,
} from '@shared/api.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { CanonicalHostAeoEditingService } from './canonical-host-aeo-editing.service';
import { hostActor } from './canonical-host-request-actor';

const DECISIONS = new Set<string>(['ACCEPT', 'MODIFY', 'REJECT']);
const REASON_CODES = new Set<string>([
  'SOURCE_MISMATCH',
  'APPLICABILITY',
  'COMPANY_PROCESS',
  'EXECUTABILITY',
  'SAFETY',
  'DUPLICATE',
  'SUPERSEDED',
  'TERMINOLOGY',
  'LAYOUT',
  'ROLE',
  'TEST_OR_ACCEPTANCE',
  'RESTORATION',
  'OTHER',
]);
const LEARNING_DISPOSITIONS = new Set<string>([
  'THIS_DRAFT_ONLY',
  'SERIES_PATTERN_CANDIDATE',
  'CATEGORY_PATTERN_CANDIDATE',
  'DO_NOT_LEARN',
]);
const SEMANTIC_FIELDS = new Set<string>([
  'SUGGESTION',
  'BODY',
  'SOURCE_BINDING',
]);

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/work-items/:workItemId/aeo/editing-draft')
export class CanonicalHostAeoEditingController {
  constructor(private readonly service: CanonicalHostAeoEditingService) {}

  @Post()
  create(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.service.createDraft(
      requiredText(workItemId, 'workItemId'),
      createBody(body),
      hostActor(request),
    );
  }

  @Get()
  read(@Param('workItemId') workItemId: string, @Req() request: Request) {
    return this.service.readDraft(
      requiredText(workItemId, 'workItemId'),
      hostActor(request),
    );
  }

  @Post('feedback')
  feedback(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.service.recordFeedback(
      requiredText(workItemId, 'workItemId'),
      feedbackBody(body),
      hostActor(request),
    );
  }
}

function createBody(body: unknown): CanonicalAeoEditingDraftCreateRequest {
  const value = exactBody(body, ['expectedRevision']);
  return {
    expectedRevision: safeInteger(value.expectedRevision),
  };
}

function stringArray(input: unknown, field: string): string[] {
  if (!Array.isArray(input)) invalid(field);
  const values = input.map((value, index) =>
    requiredText(value, `${field}[${index}]`),
  );
  if (new Set(values).size !== values.length) invalid(field);
  return values;
}

function feedbackBody(body: unknown): CanonicalAeoEditingDraftFeedbackRequest {
  const allowed = [
    'expectedRevision',
    'feedbackRef',
    'suggestionRef',
    'expectedGenerationRevision',
    'decision',
    'note',
    'revisedBodyZh',
    'revisedBodyEn',
    'revisionSourceRefs',
    'semanticField',
    'reasonCode',
    'learningDisposition',
  ];
  const value = exactBody(body, allowed);
  const decision = requiredText(value.decision, 'decision');
  const reasonCode = requiredText(value.reasonCode, 'reasonCode');
  const learningDisposition = requiredText(
    value.learningDisposition,
    'learningDisposition',
  );
  if (!DECISIONS.has(decision)) invalid('decision');
  if (!REASON_CODES.has(reasonCode)) invalid('reasonCode');
  if (!LEARNING_DISPOSITIONS.has(learningDisposition)) {
    invalid('learningDisposition');
  }
  const semanticField = requiredText(value.semanticField, 'semanticField');
  if (!SEMANTIC_FIELDS.has(semanticField)) invalid('semanticField');
  return {
    expectedRevision: safeInteger(value.expectedRevision),
    feedbackRef: requiredText(value.feedbackRef, 'feedbackRef'),
    suggestionRef: requiredText(value.suggestionRef, 'suggestionRef'),
    expectedGenerationRevision: safeInteger(value.expectedGenerationRevision),
    decision: decision as CanonicalAeoEditingDraftFeedbackRequest['decision'],
    note: requiredText(value.note, 'note'),
    ...(value.revisedBodyZh === undefined
      ? {}
      : { revisedBodyZh: nullableText(value.revisedBodyZh, 'revisedBodyZh') }),
    ...(value.revisedBodyEn === undefined
      ? {}
      : { revisedBodyEn: nullableText(value.revisedBodyEn, 'revisedBodyEn') }),
    ...(value.revisionSourceRefs === undefined
      ? {}
      : {
          revisionSourceRefs: stringArray(
            value.revisionSourceRefs,
            'revisionSourceRefs',
          ),
        }),
    semanticField:
      semanticField as CanonicalAeoEditingDraftFeedbackRequest['semanticField'],
    reasonCode:
      reasonCode as CanonicalAeoEditingDraftFeedbackRequest['reasonCode'],
    learningDisposition:
      learningDisposition as CanonicalAeoEditingDraftFeedbackRequest['learningDisposition'],
  };
}

function exactBody(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('body');
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid('unexpectedField');
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(field);
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredText(value, field);
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid('integer');
  }
  return Number(value);
}

function invalid(field: string): never {
  throw new BadRequestException(`AEO_EDITING_REQUEST_INVALID:${field}`);
}
