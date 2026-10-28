import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Optional,
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
import { TdmsReceiverService } from './tdms-receiver.service';
import { withDocumentSourceReadRequest } from '../document-management/src/hosted/nest/document-source-read.port';
import { expectedTdmsReceiver } from './tdms-receiver-expectation';
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
  constructor(private readonly service: TdmsSourceService,
    @Optional() private readonly receiver?: TdmsReceiverService) {}
  private withRequest<T>(req: Request, operation: () => Promise<T>, importing = false): Promise<T> {
    const expected = expectedTdmsReceiver(req);
    if (expected && !this.receiver) throw tdmsError('TDMS_RECEIVER_EXPECTATION_UNCONFIGURED', 503);
    return withDocumentSourceReadRequest(req, () => this.receiver && (importing || expected)
      ? this.receiver.withExpected(req, operation) : operation());
  }
  @Get('document-versions/:id')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  documentVersion(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const q = object(query);
    strict(q, ['after', 'limit']);
    const limit: number | undefined = q.limit === undefined
      ? undefined
      : typeof q.limit === 'string' && /^[1-9][0-9]*$/u.test(q.limit)
        ? Number(q.limit)
        : Number.NaN;
    return this.withRequest(req, () => this.service.readDocumentVersion(
      miaodaHostedFinalUserActor(req.userContext),
      {
        documentVersionId: identifier(id),
        ...(q.after === undefined ? {} : { after: identifier(q.after) }),
        ...(limit === undefined ? {} : { limit }),
      },
    ), false);
  }
  @Get('records')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  catalogue(@Req() req: Request, @Query() query: Record<string, unknown>) {
    const q = object(query);
    strict(q, ['matterId', 'documentVersionId', 'after']);
    const { after, ...context } = q;
    return this.withRequest(req, () => this.service.catalogue(
      miaodaHostedFinalUserActor(req.userContext),
      readContext(context),
      after === undefined ? undefined : identifier(after),
    ), false);
  }
  @Get('records/:ref')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  record(
    @Req() req: Request,
    @Param('ref') ref: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.withRequest(req, () => this.service.readRecord(
      miaodaHostedFinalUserActor(req.userContext),
      identifier(ref),
      browserContext(query),
    ), false);
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
    return this.withRequest(req, () => this.service.history(
      miaodaHostedFinalUserActor(req.userContext),
      identifier(ref),
      readContext(context),
      after === undefined ? undefined : identifier(after),
    ), false);
  }
  @Get('records/:ref/relations')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  relations(
    @Req() req: Request,
    @Param('ref') ref: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.withRequest(req, () => this.service.readRelations(
      miaodaHostedFinalUserActor(req.userContext),
      identifier(ref),
      browserContext(query),
    ), false);
  }
  @Post('imports/file-service')
  importFileServicePackage(@Req() req: Request, @Body() body: unknown) {
    return this.withRequest(req, () => this.service.importFileServicePackage(
      miaodaHostedFinalUserActor(req.userContext),
      body,
    ), true);
  }
  @Post('imports')
  importPackage(@Req() req: Request, @Body() body: unknown) {
    const b = object(body);
    strict(b, ['sourceKey', 'sourceInstanceId', 'scopeId', 'package']);
    return this.withRequest(req, () => this.service.importPackage(
      miaodaHostedFinalUserActor(req.userContext),
      {
        sourceKey: identifier(b.sourceKey),
        sourceInstanceId: identifier(b.sourceInstanceId),
        scopeId: identifier(b.scopeId),
      },
      b.package,
    ), true);
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
