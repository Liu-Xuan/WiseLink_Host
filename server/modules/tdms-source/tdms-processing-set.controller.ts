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
import type {
  TdmsProcessingSetFromRetainedResponse,
  TdmsProcessingSetFrozenReadResponse,
  TdmsProcessingSetScope,
  TdmsProcessingSetSelectedReadResponse,
} from '@shared/tdms-processing-set.interface';
import {
  miaodaHostedFinalUserActor,
  ProductionMiaodaBrowserObjectIngressGuard,
} from '../work-item/production-miaoda-browser-ingress';
import { identifier, object, strict } from './tdms-source.validation';
import { TdmsProcessingSetProducerService } from './tdms-processing-set-producer.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/tdms-source/processing-sets')
export class TdmsProcessingSetController {
  constructor(private readonly producer: TdmsProcessingSetProducerService) {}
  @Post('from-retained')
  @Header('Cache-Control', 'private, no-store')
  fromRetained(
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<TdmsProcessingSetFromRetainedResponse> {
    return this.producer.fromRetained(request, body);
  }
  @Get('selected/:familyRef')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  selected(
    @Req() request: Request,
    @Param('familyRef') familyRef: string,
    @Query() query: unknown,
  ): Promise<TdmsProcessingSetSelectedReadResponse> {
    return this.producer.readSelected(request, {
      scope: queryScope(request, query),
      processingFamilyRef: identifier(familyRef),
    });
  }
  @Get(':ref')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  frozen(
    @Req() request: Request,
    @Param('ref') ref: string,
    @Query() query: unknown,
  ): Promise<TdmsProcessingSetFrozenReadResponse> {
    return this.producer.readFrozen(request, {
      scope: queryScope(request, query),
      setRevisionRef: identifier(ref),
    });
  }
}
function queryScope(request: Request, value: unknown): TdmsProcessingSetScope {
  const query = object(value);
  strict(query, ['sourceKey', 'sourceInstanceId', 'scopeId']);
  return {
    tenantId: miaodaHostedFinalUserActor(request.userContext).tenantId,
    sourceKey: identifier(query.sourceKey),
    sourceInstanceId: identifier(query.sourceInstanceId),
    scopeId: identifier(query.scopeId),
  };
}
