import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CreateEngineeringMatterRequest,
  LinkEngineeringMatterWorkItemRequest,
} from '@shared/api.interface';

import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { EngineeringMatterService } from './engineering-matter.service';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { EngineeringMatterDirectoryService } from './engineering-matter-directory.service';
import { parseMatterMaterial } from './matter-material';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/engineering-matters')
export class EngineeringMatterController {
  constructor(
    private readonly matters: EngineeringMatterService,
    private readonly working: EngineeringMatterWorkingService,
    private readonly directory: EngineeringMatterDirectoryService,
  ) {}

  @Get()
  list(
    @Query('search') search: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('workItemId') workItemId: string | undefined,
    @Req() request: Request,
  ) {
    return this.directory.list(
      {
        search,
        cursor,
        ...(limit === undefined ? {} : { limit: Number(limit) }),
        workItemId,
      },
      hostActor(request),
    );
  }

  @Get(':matterId/working')
  readWorking(@Param('matterId') matterId: string, @Req() request: Request) {
    return this.working.readWorking(
      requiredText(matterId, 'MATTER_ID', 96),
      hostActor(request),
    );
  }

  @Get(':matterId/materials')
  // Static suffix routes above the generic Matter read.
  readMaterials(@Param('matterId') matterId: string, @Req() request: Request) {
    return this.matters.readMaterials(
      requiredText(matterId, 'MATTER_ID', 96),
      hostActor(request),
    );
  }

  @Get(':matterId/working/:workRef')
  readWorkingRevision(
    @Param('matterId') matterId: string,
    @Param('workRef') workRef: string,
    @Req() request: Request,
  ) {
    return this.working.readWorkingRevision(
      requiredText(matterId, 'MATTER_ID', 96),
      requiredText(workRef, 'WORK_REF', 96),
      hostActor(request),
    );
  }

  @Post(':matterId/materials')
  reviseMaterials(
    @Param('matterId') matterId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const value = strictBody(body, [
      'requestId',
      'expectedMatterRevision',
      'changeSummary',
      'upserts',
    ]);
    if (
      !Number.isSafeInteger(value.expectedMatterRevision) ||
      Number(value.expectedMatterRevision) < 1 ||
      !Array.isArray(value.upserts) ||
      value.upserts.length < 1 ||
      value.upserts.length > 96
    )
      throw new BadRequestException('MATTER_MATERIAL_COMMAND_INVALID');
    return this.matters.reviseMaterials(
      requiredText(matterId, 'MATTER_ID', 96),
      {
        requestId: requiredText(value.requestId, 'REQUEST_ID', 96),
        expectedMatterRevision: Number(value.expectedMatterRevision),
        changeSummary: requiredText(
          value.changeSummary,
          'CHANGE_SUMMARY',
          1000,
        ),
        upserts: value.upserts.map(parseMatterMaterial),
      },
      hostActor(request),
    );
  }

  @Post()
  create(@Body() body: unknown, @Req() request: Request) {
    return this.matters.create(createBody(body), hostActor(request));
  }

  @Post(':matterId/work-items')
  linkWorkItem(
    @Param('matterId') matterId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.matters.linkWorkItem(
      requiredText(matterId, 'MATTER_ID', 96),
      linkBody(body),
      hostActor(request),
    );
  }

  @Get(':matterId')
  read(@Param('matterId') matterId: string, @Req() request: Request) {
    return this.matters.read(
      requiredText(matterId, 'MATTER_ID', 96),
      hostActor(request),
    );
  }
}

function createBody(body: unknown): CreateEngineeringMatterRequest {
  const value = strictBody(body, ['requestId', 'title', 'primaryWorkItemId']);
  return {
    requestId: requiredText(value.requestId, 'REQUEST_ID', 96),
    title: requiredText(value.title, 'TITLE', 240),
    primaryWorkItemId: requiredText(
      value.primaryWorkItemId,
      'PRIMARY_WORK_ITEM_ID',
      96,
    ),
  };
}

function linkBody(body: unknown): LinkEngineeringMatterWorkItemRequest {
  const value = strictBody(body, [
    'requestId',
    'expectedMatterRevision',
    'workItemId',
    'changeSummary',
  ]);
  return {
    requestId: requiredText(value.requestId, 'REQUEST_ID', 96),
    expectedMatterRevision: requiredRevision(value.expectedMatterRevision),
    workItemId: requiredText(value.workItemId, 'WORK_ITEM_ID', 96),
    ...(value.changeSummary === undefined
      ? {}
      : {
          changeSummary: requiredText(
            value.changeSummary,
            'CHANGE_SUMMARY',
            1000,
          ),
        }),
  };
}

function strictBody(
  body: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('ENGINEERING_MATTER_REQUEST_BODY_INVALID');
  }
  const value = body as Record<string, unknown>;
  const forbidden = [
    'actor',
    'authority',
    'tenantId',
    'createdByUserId',
    'permissionSnapshotVersion',
    'documentVersionId',
    'sourceRef',
    'artifactRef',
  ];
  for (const key of forbidden) {
    if (Object.hasOwn(value, key)) {
      throw badRequest(
        `ENGINEERING_MATTER_REQUEST_INVALID:SELF_REPORTED_AUTHORITY:${key}`,
      );
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw badRequest(`ENGINEERING_MATTER_REQUEST_UNKNOWN_FIELD:${key}`);
    }
  }
  return value;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`ENGINEERING_MATTER_${field}_REQUIRED`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw badRequest(`ENGINEERING_MATTER_${field}_TOO_LONG`);
  }
  return normalized;
}

function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw badRequest('ENGINEERING_MATTER_EXPECTED_REVISION_INVALID');
  }
  return Number(value);
}

function badRequest(code: string): BadRequestException {
  return new BadRequestException({ code, message: code });
}
