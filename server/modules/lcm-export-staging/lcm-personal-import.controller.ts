import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { miaodaHostedFinalUserActor, ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { LcmPersonalImportService } from './lcm-personal-import.service';
import { LcmPersonalSourceRepository } from './lcm-personal-source.repository';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/lcm-source')
// Registered only by LcmSourceReadingModule.forHost() with real database/FileService providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class LcmPersonalImportController {
  constructor(private readonly imports: LcmPersonalImportService, private readonly sources: LcmPersonalSourceRepository) {}

  @Get('personal-library')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  library(@Req() req: Request) {
    return this.sources.library(miaodaHostedFinalUserActor(req.userContext));
  }

  @Post('imports')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  importExcel(@Req() req: Request, @Body() input: unknown) {
    return this.imports.importExcel(miaodaHostedFinalUserActor(req.userContext), input);
  }

  @Post('uploads/resolve')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  resolveUpload(@Req() req: Request, @Body() input: unknown) {
    return this.imports.resolveUpload(miaodaHostedFinalUserActor(req.userContext), input);
  }

  @Get('snapshots/:id/original')
  async original(@Req() req: Request, @Param('id') snapshotId: string, @Res() response: Response) {
    const original = await this.imports.original(miaodaHostedFinalUserActor(req.userContext), snapshotId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie, Authorization');
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', original.byteLength);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(original.reference.originalFileName)}`);
    response.send(original.bytes);
  }
}
