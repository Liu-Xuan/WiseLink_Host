import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalApplicabilitySelectionReadModel,
  ConfigureCanonicalApplicabilitySelectionRequest,
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

  @Put(':workItemId/applicability-selection')
  configure(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CanonicalApplicabilitySelectionReadModel> {
    return this.selections.configure(
      requiredWorkItemId(workItemIdValue),
      selectionRequest(body),
      request,
    );
  }
}

function selectionRequest(
  value: unknown,
): ConfigureCanonicalApplicabilitySelectionRequest {
  const body = record(value, 'APPLICABILITY_SELECTION_BODY_INVALID');
  exactKeys(body, ['aircraftIdentifier', 'asOf']);
  return {
    aircraftIdentifier: requiredText(
      body.aircraftIdentifier,
      'APPLICABILITY_AIRCRAFT_IDENTIFIER_INVALID',
      64,
    ),
    asOf: requiredText(body.asOf, 'APPLICABILITY_AS_OF_INVALID', 10),
  };
}

function requiredWorkItemId(value: unknown): string {
  return requiredText(value, 'WORK_ITEM_ID_INVALID', MAX_WORK_ITEM_ID_LENGTH);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  const missingKey = allowed.find((key) => !(key in value));
  if (unknownKey) {
    throw badRequest(`APPLICABILITY_SELECTION_UNKNOWN_FIELD:${unknownKey}`);
  }
  if (missingKey) {
    throw badRequest(`APPLICABILITY_SELECTION_REQUIRED_FIELD:${missingKey}`);
  }
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(code);
  }
  return value as Record<string, unknown>;
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
