import {
  Controller,
  Get,
  Head,
  Headers,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';

import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import {
  CanonicalPdfPreviewService,
  type CanonicalPdfPreviewReadResult,
} from './canonical-pdf-preview.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host')
export class CanonicalPdfPreviewController {
  constructor(private readonly previews: CanonicalPdfPreviewService) {}

  @Head('work-items/:workItemId/pdf-preview/:opaqueLocator')
  head(
    @Param('workItemId') workItemId: string,
    @Param('opaqueLocator') opaqueLocator: string,
    @Headers('range') range: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.deliver({
      method: 'HEAD',
      workItemId,
      opaqueLocator,
      range,
      request,
      response,
    });
  }

  @Get('work-items/:workItemId/pdf-preview/:opaqueLocator')
  get(
    @Param('workItemId') workItemId: string,
    @Param('opaqueLocator') opaqueLocator: string,
    @Headers('range') range: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.deliver({
      method: 'GET',
      workItemId,
      opaqueLocator,
      range,
      request,
      response,
    });
  }

  private async deliver(input: {
    method: 'GET' | 'HEAD';
    workItemId: string;
    opaqueLocator: string;
    range: string | undefined;
    request: Request;
    response: Response;
  }): Promise<void> {
    let result: CanonicalPdfPreviewReadResult;
    try {
      result = await this.previews.read({
        actor: hostActor(input.request),
        workItemId: input.workItemId,
        opaqueLocator: input.opaqueLocator,
        method: input.method,
        range: input.range ?? null,
      });
    } catch (error) {
      setPrivatePreviewHeaders(input.response);
      throw error;
    }
    setPdfHeaders(input.response, result.byteLength);
    if (result.kind === 'RANGE_UNSUPPORTED') {
      input.response.setHeader('Content-Range', `bytes */${result.byteLength}`);
      input.response.status(416).end();
      return;
    }
    if (result.kind === 'HEAD') {
      input.response.status(200).end();
      return;
    }
    input.response.status(200).send(result.bytes);
  }
}

function setPdfHeaders(response: Response, byteLength: number): void {
  setPrivatePreviewHeaders(response);
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader(
    'Content-Disposition',
    'inline; filename="controlled-source.pdf"',
  );
  response.setHeader('Content-Length', String(byteLength));
  response.setHeader('Accept-Ranges', 'none');
}

function setPrivatePreviewHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
}
