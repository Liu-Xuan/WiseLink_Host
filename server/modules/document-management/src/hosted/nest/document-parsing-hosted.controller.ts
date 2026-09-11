import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../../../../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from './document-management-hosted.controller';
import { DocumentParsingHostedService } from './document-parsing-hosted.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management/document-versions/:documentVersionId')
// Registered by DocumentManagementHostedModule.register(); its dynamic array is not visible to this static rule.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentParsingHostedController {
  constructor(private readonly service: DocumentParsingHostedService) {}

  @Get('parsing')
  @Header('Cache-Control', 'private, no-store')
  status(@Param('documentVersionId') version: string, @Req() request: Request) {
    return this.service.status(version, contextFromRequest(request));
  }

  @Post('parse-runs')
  @HttpCode(202)
  start(@Param('documentVersionId') version: string, @Body() body: unknown, @Req() request: Request) {
    return this.service.start(version, body, contextFromRequest(request));
  }

  @Get('reading')
  @Header('Cache-Control', 'private, no-store')
  read(@Param('documentVersionId') version: string, @Query('parseRunId') parseRunId: string | undefined, @Req() request: Request) {
    return this.service.read(version, parseRunId, contextFromRequest(request));
  }

  @Get('parse-runs/:parseRunId/asset')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async asset(@Param('documentVersionId') version: string, @Param('parseRunId') parseRunId: string,
    @Query('path') path: unknown, @Req() request: Request) {
    const asset = await this.service.asset(version, parseRunId, path, contextFromRequest(request));
    return new StreamableFile(asset.bytes, { type: asset.mediaType });
  }
}
