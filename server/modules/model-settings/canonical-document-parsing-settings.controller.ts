import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { UpdateDocumentParsingSettingsRequest } from '@shared/document-parsing-settings.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from '../canonical-host/canonical-host-request-actor';
import { CanonicalDocumentParsingSettingsService } from './canonical-document-parsing-settings.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/settings/document-parsing')
export class CanonicalDocumentParsingSettingsController {
  constructor(
    private readonly service: CanonicalDocumentParsingSettingsService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  read(@Req() request: Request) {
    return this.service.read(hostActor(request));
  }
  @Post()
  update(
    @Body() input: UpdateDocumentParsingSettingsRequest,
    @Req() request: Request,
  ) {
    return this.service.update(input, hostActor(request));
  }
}
