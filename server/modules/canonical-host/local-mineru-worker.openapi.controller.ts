import { Body, Controller, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { LocalMineruWorkerClaimResult, LocalMineruWorkerRenewResult, LocalMineruWorkerResult } from '@shared/api.interface';
import { LocalMineruWorkerService, localMineruWorkerIdentity } from './local-mineru-worker.service';
import { documentParseError } from '../document-management/src/hosted/nest/document-parsing.repository';
import { decodeLocalMineruResult, localMineruResultTransport, LOCAL_MINERU_CANDIDATE_LIMIT,
  LOCAL_MINERU_RESULT_BODY_LIMIT } from '../professional-input/mineru/local-mineru-result-transport';

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
    if (request.get('content-encoding') !== undefined)
      throw documentParseError('LOCAL_MINERU_RESULT_HTTP_ENCODING_INVALID', 415);
    const transport = localMineruResultTransport(request.get('x-wiselink-candidate-transport'),
      request.get('x-wiselink-candidate-raw-byte-length'), request.get('x-wiselink-candidate-raw-sha256'));
    const bodyLimit = transport ? LOCAL_MINERU_RESULT_BODY_LIMIT : LOCAL_MINERU_CANDIDATE_LIMIT;
    const generation = request.get('x-wiselink-lease-generation');
    if (!generation || !/^[1-9][0-9]*$/u.test(generation)) throw documentParseError('LOCAL_MINERU_LEASE_INPUT_INVALID', 400);
    const identity = localMineruWorkerIdentity({
      parseRunId: request.get('x-wiselink-parse-run-id'), documentVersionId: request.get('x-wiselink-document-version-id'),
      lease: { leaseOwner: request.get('x-wiselink-lease-owner'), leaseToken: request.get('x-wiselink-lease-token'),
        leaseGeneration: Number(generation) },
    });
    await this.worker.validateUpload(identity);
    const length = request.get('content-length');
    if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > bodyLimit))
      throw documentParseError('MINERU_CANDIDATE_TOO_LARGE', 413);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const data of request) {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      size += chunk.length;
      if (size > bodyLimit) throw documentParseError('MINERU_CANDIDATE_TOO_LARGE', 413);
      chunks.push(chunk);
    }
    if (length !== undefined && size !== Number(length)) throw documentParseError('MINERU_CANDIDATE_LENGTH_MISMATCH', 400);
    return this.worker.result(identity, decodeLocalMineruResult(Buffer.concat(chunks, size), transport));
  }
}
