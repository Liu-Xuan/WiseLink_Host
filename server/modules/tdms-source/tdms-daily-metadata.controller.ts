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
import { object, strict } from './tdms-source.validation';
import { dailyRequestId, dailySourceRef } from './tdms-daily-metadata.readback';
import { TdmsReceiverService } from './tdms-receiver.service';
import { expectedTdmsReceiver } from './tdms-receiver-expectation';
import { tdmsError } from './tdms-source.types';
import { withDocumentSourceReadRequest } from '../document-management/src/hosted/nest/document-source-read.port';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api')
export class TdmsDailyMetadataController {
  constructor(
    private readonly service: TdmsSourceService,
    @Optional() private readonly receiver?: TdmsReceiverService,
  ) {}
  @Post('tdms-source-imports')
  @Header('Cache-Control', 'private, no-store')
  submit(@Req() req: Request, @Body() body: unknown, @Query() query: unknown) {
    strict(object(query), []);
    return this.withExpected(req, () =>
      this.service.importDailyMetadata(
        miaodaHostedFinalUserActor(req.userContext),
        body,
      ),
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
    return this.withExpected(req, () =>
      this.service.readDailyMetadataImport(
        miaodaHostedFinalUserActor(req.userContext),
        dailyRequestId(requestId),
      ),
    );
  }
  @Get('tdms-source-refs')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  sourceRef(@Req() req: Request, @Query() query: unknown) {
    const q = object(query);
    strict(q, ['sourceRef']);
    return this.withExpected(req, () =>
      this.service.readDailySourceRef(
        miaodaHostedFinalUserActor(req.userContext),
        dailySourceRef(q.sourceRef),
      ),
    );
  }

  private withExpected<T>(req: Request, operation: () => T): T | Promise<T> {
    return withDocumentSourceReadRequest(req, () => {
      if (expectedTdmsReceiver(req) === null) return operation();
      if (!this.receiver)
        throw tdmsError('TDMS_RECEIVER_EXPECTATION_UNCONFIGURED', 503);
      return this.receiver.withExpected(req, operation);
    });
  }
}
