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
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { object, strict, identifier } from './tdms-source.validation';
import { TdmsReceiverService } from './tdms-receiver.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/tdms-source-imports')
export class TdmsReceiverController {
  constructor(private readonly service: TdmsReceiverService) {}

  @Get('receiver/binding')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  binding(@Req() req: Request, @Query() query: unknown) {
    const q = object(query);
    strict(q, ['receiverId']);
    return this.service.binding(
      req,
      q.receiverId === undefined ? undefined : identifier(q.receiverId),
    );
  }

  @Post(':requestId/artifacts/:bindingId/selection/preflight')
  @Header('Cache-Control', 'private, no-store')
  preflight(
    @Req() req: Request,
    @Param('requestId') requestId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    strict(object(query), []);
    return this.service.preflight(req, requestId, bindingId, body);
  }

  @Post(':requestId/artifacts/:bindingId/selection')
  @Header('Cache-Control', 'private, no-store')
  stage(
    @Req() req: Request,
    @Param('requestId') requestId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    strict(object(query), []);
    return this.service.stage(req, requestId, bindingId, body);
  }

  @Get(':requestId/artifacts/:bindingId/selection')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  read(
    @Req() req: Request,
    @Param('requestId') requestId: string,
    @Param('bindingId') bindingId: string,
    @Query() query: unknown,
  ) {
    strict(object(query), []);
    return this.service.read(req, requestId, bindingId);
  }
}
