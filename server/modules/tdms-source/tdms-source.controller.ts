import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import {
  miaodaHostedFinalUserActor,
  ProductionMiaodaBrowserObjectIngressGuard,
} from '../work-item/production-miaoda-browser-ingress';
import { TdmsSourceService } from './tdms-source.service';
import {
  identifier,
  object,
  readContext,
  strict,
} from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/tdms-source')
export class TdmsSourceController {
  constructor(private readonly service: TdmsSourceService) {}
  @Get('records')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  catalogue(@Req() req: Request, @Query() query: Record<string, unknown>) {
    const q = object(query);
    strict(q, ['matterId', 'documentVersionId', 'after']);
    const { after, ...context } = q;
    return this.service.catalogue(
      miaodaHostedFinalUserActor(req.userContext),
      readContext(context),
      after === undefined ? undefined : identifier(after),
    );
  }
  @Get('records/:ref')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  record(
    @Req() req: Request,
    @Param('ref') ref: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.readRecord(
      miaodaHostedFinalUserActor(req.userContext),
      identifier(ref),
      browserContext(query),
    );
  }
  @Get('records/:ref/history')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  history(
    @Req() req: Request,
    @Param('ref') ref: string,
    @Query() query: Record<string, unknown>,
  ) {
    const q = object(query);
    strict(q, ['matterId', 'documentVersionId', 'after']);
    const { after, ...context } = q;
    return this.service.history(
      miaodaHostedFinalUserActor(req.userContext),
      identifier(ref),
      readContext(context),
      after === undefined ? undefined : identifier(after),
    );
  }
  @Get('records/:ref/relations')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  relations(
    @Req() req: Request,
    @Param('ref') ref: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.readRelations(
      miaodaHostedFinalUserActor(req.userContext),
      identifier(ref),
      browserContext(query),
    );
  }
  @Post('imports/file-service')
  importFileServicePackage(@Req() req: Request, @Body() body: unknown) {
    return this.service.importFileServicePackage(
      miaodaHostedFinalUserActor(req.userContext),
      body,
    );
  }
  @Post('imports')
  importPackage(@Req() req: Request, @Body() body: unknown) {
    const b = object(body);
    strict(b, ['sourceKey', 'sourceInstanceId', 'scopeId', 'package']);
    return this.service.importPackage(
      miaodaHostedFinalUserActor(req.userContext),
      {
        sourceKey: identifier(b.sourceKey),
        sourceInstanceId: identifier(b.sourceInstanceId),
        scopeId: identifier(b.scopeId),
      },
      b.package,
    );
  }
}
function browserContext(value: unknown) {
  const c = object(value);
  if (
    Object.keys(c).some((k) => !['matterId', 'documentVersionId'].includes(k))
  )
    throw tdmsError('TDMS_BROWSER_CONTEXT_INVALID');
  return readContext(c);
}
