import { BadRequestException, Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from '../document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentReadingRuntimeService } from './document-reading-runtime.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management/document-versions/:documentVersionId')
// Registered in CanonicalHostModule.forRoot dynamic controllers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentReadingController {
  constructor(private readonly reading: DocumentReadingRuntimeService) {}

  @Get('document-reading')
  @Header('Cache-Control', 'private, no-store')
  async read(@Param('documentVersionId') documentVersionId: string, @Query('parseRunId') parseRunId: string,
    @Query('semanticRevision') semanticRevision: string, @Query('readingRevision') readingRevision: string | undefined,
    @Req() request: Request) {
    const positive = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value));
    if (!positive(semanticRevision) || (readingRevision !== undefined && !positive(readingRevision)))
      throw new BadRequestException('DOCUMENT_READING_REVISION_INVALID');
    return this.reading.readForBrowser({ documentVersionId, parseRunId, semanticRevision: Number(semanticRevision),
      ...(readingRevision === undefined ? {} : { readingRevision: Number(readingRevision) }) }, contextFromRequest(request));
  }
}
