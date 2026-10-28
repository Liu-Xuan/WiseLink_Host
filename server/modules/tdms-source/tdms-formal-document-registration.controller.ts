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
import { TdmsFormalDocumentRegistrationService } from './tdms-formal-document-registration.service';
import { object, strict } from './tdms-source.validation';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/tdms-source-imports')
export class TdmsFormalDocumentRegistrationController {
  constructor(
    private readonly registration: TdmsFormalDocumentRegistrationService,
  ) {}

  @Post(':requestId/artifacts/:bindingId/registration')
  @Header('Cache-Control', 'private, no-store')
  register(
    @Req() request: Request,
    @Param('requestId') requestId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    strict(object(query), []);
    return this.registration.register(request, requestId, bindingId, body);
  }

  @Get(':requestId/artifacts/:bindingId/registration')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  read(
    @Req() request: Request,
    @Param('requestId') requestId: string,
    @Param('bindingId') bindingId: string,
    @Query() query: unknown,
  ) {
    strict(object(query), []);
    return this.registration.read(request, requestId, bindingId);
  }
}
