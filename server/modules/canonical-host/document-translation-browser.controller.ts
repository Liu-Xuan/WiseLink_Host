import { BadRequestException, Body, ConflictException, Controller, Get, Header, HttpException,
  Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { z } from 'zod/v4';
import { SessionResolver } from '../identity/session-resolver.service';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from '../document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentTranslationBrowserService } from './document-translation-browser.service';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/u);
const continuation = z.strictObject({ parseRunId: id, expectedAttemptRef: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  action: z.enum(['RESUME_KNOWN_FAILURE', 'RECOVER_KNOWN_FAILURE', 'CONTINUE_PARTIAL', 'RECOVER_EXPIRED']) });

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management/document-versions/:documentVersionId')
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationBrowserController {
  constructor(private readonly service: DocumentTranslationBrowserService, private readonly sessions: SessionResolver) {}

  @Get('translation-continuation')
  @Header('Cache-Control', 'private, no-store')
  prepare(@Param('documentVersionId') documentVersionId: string, @Query('parseRunId') parseRunId: string,
    @Req() request: Request) {
    return this.withBrowser(request, () => this.service.prepare(id.parse(documentVersionId), id.parse(parseRunId),
      contextFromRequest(request)));
  }

  @Post('translation-continuation')
  @Header('Cache-Control', 'private, no-store')
  continue(@Param('documentVersionId') documentVersionId: string, @Body() body: unknown, @Req() request: Request) {
    return this.withBrowser(request, () => this.service.continue(id.parse(documentVersionId), continuation.parse(body),
      contextFromRequest(request)));
  }

  private async withBrowser<T>(request: Request, operation: () => Promise<T>): Promise<T> {
    try {
      // Native gateway identity is sufficient; an optional OAuth session must match it.
      return await this.sessions.withNativeBrowserIdentity(request, operation);
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException('DOCUMENT_TRANSLATION_BROWSER_REQUEST_INVALID');
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && /^DOCUMENT_TRANSLATION_[A-Z_]+$/u.test(error.message))
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
