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
import { object, strict } from './tdms-source.validation';
import { dailyRequestId, dailySourceRef } from './tdms-daily-metadata.readback';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api')
export class TdmsDailyMetadataController {
  constructor(private readonly service: TdmsSourceService) {}
  @Post('tdms-source-imports')
  @Header('Cache-Control', 'private, no-store')
  submit(@Req() req: Request, @Body() body: unknown, @Query() query: unknown) {
    strict(object(query), []);
    return this.service.importDailyMetadata(
      miaodaHostedFinalUserActor(req.userContext),
      body,
    );
  }
  @Get('tdms-source-imports/:requestId')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  read(
    @Req() req: Request,
    @Param('requestId') requestId: string,
    @Query() query: unknown,
  ) {
    strict(object(query), []);
    return this.service.readDailyMetadataImport(
      miaodaHostedFinalUserActor(req.userContext),
      dailyRequestId(requestId),
    );
  }
  @Get('tdms-source-refs')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  sourceRef(@Req() req: Request, @Query() query: unknown) {
    const q = object(query);
    strict(q, ['sourceRef']);
    return this.service.readDailySourceRef(
      miaodaHostedFinalUserActor(req.userContext),
      dailySourceRef(q.sourceRef),
    );
  }
}
