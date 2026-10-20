import { Body, Controller, Get, Header, HttpCode, Inject, Optional, Param, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../../../../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from './document-management-hosted.controller';
import { DocumentParsingHostedService } from './document-parsing-hosted.service';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER, type DocumentManagementIngestAuthorizer } from './document-management-hosted.tokens';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management/document-versions/:documentVersionId')
// Registered by DocumentManagementHostedModule.register(); its dynamic array is not visible to this static rule.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentParsingHostedController {
  constructor(private readonly service: DocumentParsingHostedService,
    @Optional() @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER) private readonly authorizer?: DocumentManagementIngestAuthorizer) {}

  private async withCurrentRead<T>(version: string, request: Request,
    operation: (context: ReturnType<typeof contextFromRequest>) => Promise<T>): Promise<T> {
    const context = contextFromRequest(request);
    if (!this.authorizer) throw Object.assign(new Error('Document authorization is unavailable.'), {
      code: 'DOCUMENT_SOURCE_READ_UNAVAILABLE', statusCode: 503,
    });
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId: version });
    const result = await operation(context);
    // Status and cached/derived responses must be checked at return as well.
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId: version });
    return result;
  }

  @Get('parsing')
  @Header('Cache-Control', 'private, no-store')
  status(@Param('documentVersionId') version: string, @Req() request: Request) {
    return this.withCurrentRead(version, request, context => this.service.status(version, context));
  }

  @Post('parse-runs')
  @HttpCode(202)
  start(@Param('documentVersionId') version: string, @Body() body: unknown, @Req() request: Request) {
    return this.withCurrentRead(version, request, context => this.service.start(version, body, context));
  }

  @Get('reading')
  @Header('Cache-Control', 'private, no-store')
  read(@Param('documentVersionId') version: string, @Query('parseRunId') parseRunId: string | undefined, @Req() request: Request) {
    return this.withCurrentRead(version, request, context => this.service.read(version, parseRunId, context));
  }

  @Get('parse-runs/:parseRunId/asset')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async asset(@Param('documentVersionId') version: string, @Param('parseRunId') parseRunId: string,
    @Query('path') path: unknown, @Req() request: Request) {
    const asset = await this.withCurrentRead(version, request, context => this.service.asset(version, parseRunId, path, context));
    return new StreamableFile(asset.bytes, { type: asset.mediaType });
  }
}
