import {
  Body,
  Controller,
  Get,
  Header,
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
import { LcmSourceReadingService } from './lcm-source-reading.service';
import { LcmNativeMatrixReadingService } from './lcm-native-matrix-reading.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/lcm-source')
export class LcmSourceReadingController {
  constructor(
    private readonly service: LcmSourceReadingService,
    private readonly native: LcmNativeMatrixReadingService,
  ) {}

  @Post('matrix/native')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  nativeMatrix(@Req() req: Request, @Body() request: unknown) {
    return this.native.read(
      miaodaHostedFinalUserActor(req.userContext),
      request,
    );
  }

  @Post('matrix/native/authorize')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  nativeAuthorize(@Req() req: Request, @Body() request: unknown) {
    return this.native.authorize(
      miaodaHostedFinalUserActor(req.userContext),
      request,
    );
  }

  @Post('matrix/native/details')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  nativeDetails(@Req() req: Request, @Body() request: unknown) {
    return this.native.details(
      miaodaHostedFinalUserActor(req.userContext),
      request,
    );
  }

  @Get('snapshots')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  catalogue(@Req() req: Request, @Query() query: Record<string, unknown>) {
    return this.service.catalogue(
      miaodaHostedFinalUserActor(req.userContext),
      query,
    );
  }
}
