import { Controller, Get, Param, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type { CanonicalApplicabilitySelectionReadModel } from '@shared/api.interface';
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
