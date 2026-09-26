import { Body, Controller, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { LocalMineruWorkerClaimResult, LocalMineruWorkerRenewResult, LocalMineruWorkerResult } from '@shared/api.interface';
import { LocalMineruWorkerService, localMineruWorkerIdentity } from './local-mineru-worker.service';
import { documentParseError } from '../document-management/src/hosted/nest/document-parsing.repository';

@Controller('openapi/wiselink/local-mineru')
export class LocalMineruWorkerOpenApiController {
  constructor(private readonly worker: LocalMineruWorkerService) {}

  @Post('claim')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  claimLocalMineru(@Body() body: unknown): Promise<LocalMineruWorkerClaimResult> { return this.worker.claim(body); }

  @Post('source')
  @HttpCode(200)
  async readLocalMineruSource(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const result = await this.worker.source(body);
    response.setHeader('Cache-Control', 'private, no-store');
    if ('bytes' in result) {
      response.setHeader('Content-Type', 'application/pdf');
      response.send(Buffer.from(result.bytes));
    } else response.json(result);
  }

  @Post('renew')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  renewLocalMineru(@Body() body: unknown): Promise<LocalMineruWorkerRenewResult> { return this.worker.renew(body); }

  @Post('result')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async acceptLocalMineruResult(@Req() request: Request): Promise<LocalMineruWorkerResult> {
    if (request.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream')
      throw documentParseError('LOCAL_MINERU_RESULT_MEDIA_TYPE_INVALID', 415);
    const generation = request.get('x-wiselink-lease-generation');
    if (!generation || !/^[1-9][0-9]*$/u.test(generation)) throw documentParseError('LOCAL_MINERU_LEASE_INPUT_INVALID', 400);
    const identity = localMineruWorkerIdentity({
      parseRunId: request.get('x-wiselink-parse-run-id'), documentVersionId: request.get('x-wiselink-document-version-id'),
      lease: { leaseOwner: request.get('x-wiselink-lease-owner'), leaseToken: request.get('x-wiselink-lease-token'),
        leaseGeneration: Number(generation) },
    });
    await this.worker.validateUpload(identity);
    const length = request.get('content-length');
    if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > 64 * 1024 * 1024))
      throw documentParseError('MINERU_CANDIDATE_TOO_LARGE', 413);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const data of request) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      size += chunk.length;
      if (size > 64 * 1024 * 1024) throw documentParseError('MINERU_CANDIDATE_TOO_LARGE', 413);
      chunks.push(chunk);
    }
    if (length !== undefined && size !== Number(length)) throw documentParseError('MINERU_CANDIDATE_LENGTH_MISMATCH', 400);
    return this.worker.result(identity, Buffer.concat(chunks, size));
  }
}
