import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalApplicabilitySelectionReadModel,
  CanonicalApplicabilitySelectionReviewAvailability,
  CanonicalApplicabilitySelectionReviewDraft,
  ConfirmCanonicalApplicabilitySelectionRequest,
  PreviewCanonicalApplicabilitySelectionRequest,
} from '@shared/api.interface';
import { CanonicalHostApplicabilitySelectionService } from './canonical-host-applicability-selection.service';

const MAX_WORK_ITEM_ID_LENGTH = 96;

@NeedLogin()
@Controller('api/work-items')
export class CanonicalHostApplicabilitySelectionController {
  constructor(
    private readonly selections: CanonicalHostApplicabilitySelectionService,
  ) {}

  @Get(':workItemId/applicability-selection')
  read(
    @Param('workItemId') workItemIdValue: string,
    @Req() request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    return this.selections.read(requiredWorkItemId(workItemIdValue), request);
  }

  @Get(':workItemId/applicability-selection/review-action')
  availability(
    @Param('workItemId') workItemIdValue: string,
    @Req() request: Request,
  ): Promise<CanonicalApplicabilitySelectionReviewAvailability> {
    return this.selections.reviewAvailability(requiredWorkItemId(workItemIdValue), request);
  }

  @Post(':workItemId/applicability-selection/review-action/preview')
  preview(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CanonicalApplicabilitySelectionReviewDraft> {
    return this.selections.previewReviewAction(
      requiredWorkItemId(workItemIdValue), previewBody(body), request,
    );
  }

  @Post(':workItemId/applicability-selection/review-action/confirm')
  confirm(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    return this.selections.confirmReviewAction(
      requiredWorkItemId(workItemIdValue), confirmBody(body), request,
    );
  }
}

function previewBody(body: unknown): PreviewCanonicalApplicabilitySelectionRequest {
  const value = exactObject(body,
    ['aircraftIdentifier', 'asOf', 'expectedWorkItemRevision']);
  return {
    aircraftIdentifier: requiredText(value.aircraftIdentifier,
      'APPLICABILITY_AIRCRAFT_IDENTIFIER_INVALID', 64),
    asOf: requiredText(value.asOf, 'APPLICABILITY_AS_OF_INVALID', 10),
    expectedWorkItemRevision: requiredRevision(value.expectedWorkItemRevision),
  };
}

function confirmBody(body: unknown): ConfirmCanonicalApplicabilitySelectionRequest {
  const value = exactObject(body, ['draft', 'confirmed']);
  if (value.confirmed !== true)
    throw badRequest('APPLICABILITY_SELECTION_CONFIRMATION_REQUIRED');
  const draft = exactObject(value.draft, [
    'schemaVersion', 'workItemId', 'documentVersionId',
    'expectedWorkItemRevision', 'aircraftIdentifier', 'asOf', 'fleetSource',
    'expiresAt', 'confirmationToken',
  ]);
  if (draft.schemaVersion !== 'wiselink.3_1.applicability_selection_review_draft.v1')
    throw badRequest('APPLICABILITY_SELECTION_REVIEW_DRAFT_INVALID');
  const source = exactObject(draft.fleetSource,
    ['snapshotId', 'sourceRevisionKey', 'authorityRevision', 'sourceAsOf']);
  return {
    confirmed: true,
    draft: {
      schemaVersion: draft.schemaVersion,
      workItemId: requiredWorkItemId(draft.workItemId),
      documentVersionId: requiredText(draft.documentVersionId,
        'DOCUMENT_VERSION_ID_INVALID', 160),
      expectedWorkItemRevision: requiredRevision(draft.expectedWorkItemRevision),
      aircraftIdentifier: requiredText(draft.aircraftIdentifier,
        'APPLICABILITY_AIRCRAFT_IDENTIFIER_INVALID', 64),
      asOf: requiredText(draft.asOf, 'APPLICABILITY_AS_OF_INVALID', 10),
      fleetSource: {
        snapshotId: requiredText(source.snapshotId, 'FLEET_SOURCE_INVALID', 160),
        sourceRevisionKey: requiredText(source.sourceRevisionKey, 'FLEET_SOURCE_INVALID', 160),
        authorityRevision: requiredText(source.authorityRevision, 'FLEET_SOURCE_INVALID', 160),
        sourceAsOf: requiredText(source.sourceAsOf, 'FLEET_SOURCE_INVALID', 10),
      },
      expiresAt: requiredText(draft.expiresAt,
        'APPLICABILITY_SELECTION_REVIEW_DRAFT_INVALID', 40),
      confirmationToken: requiredText(draft.confirmationToken,
        'APPLICABILITY_SELECTION_REVIEW_DRAFT_INVALID', 64),
    },
  };
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw badRequest('APPLICABILITY_SELECTION_REVIEW_BODY_INVALID');
  const result = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(result).sort()) !== JSON.stringify([...keys].sort()))
    throw badRequest('APPLICABILITY_SELECTION_REVIEW_BODY_INVALID');
  return result;
}

function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw badRequest('CANONICAL_WORK_ITEM_REVISION_INVALID');
  return value as number;
}

function requiredWorkItemId(value: unknown): string {
  return requiredText(value, 'WORK_ITEM_ID_INVALID', MAX_WORK_ITEM_ID_LENGTH);
}

function requiredText(value: unknown, code: string, max: number): string {
  if (typeof value !== 'string') throw badRequest(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw badRequest(code);
  return normalized;
}

function badRequest(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
