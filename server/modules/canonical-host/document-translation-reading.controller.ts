import { BadRequestException, Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { DocumentTranslationReadingResponse } from '@shared/document-translation-reading.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from '../document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { CanonicalTranslationWorkspaceRepository } from './canonical-translation-workspace.repository';
import { buildTranslationWorkspaceReadingV2 } from './canonical-translation-v2-quality';
import { DocumentRevisionReadingService } from './document-revision-reading.service';
import { DocumentTranslationAttemptRepository } from '../action-attempt/document-translation-attempt.repository';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management/document-versions/:documentVersionId')
// Registered in CanonicalHostModule.forRoot dynamic controllers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationReadingController {
  constructor(private readonly reader: UnifiedReaderService, private readonly workspaces: CanonicalTranslationWorkspaceRepository,
    private readonly parsing: DocumentParsingHostedService, private readonly attempts: DocumentTranslationAttemptRepository,
    private readonly revisions: DocumentRevisionReadingService) {}

  @Get('semantic-reading')
  @Header('Cache-Control', 'private, no-store')
  async readSemantic(@Param('documentVersionId') documentVersionId: string,
    @Query('parseRunId') parseRunId: string, @Query('semanticRevision') semanticRevision: string | undefined,
    @Req() request: Request) {
    if (semanticRevision !== undefined && (typeof semanticRevision !== 'string' || !/^[1-9][0-9]*$/.test(semanticRevision)))
      throw new BadRequestException('DOCUMENT_SEMANTIC_IDENTITY_INVALID');
    return this.revisions.readSemanticForBrowser({ documentVersionId, parseRunId,
      ...(semanticRevision === undefined ? {} : { semanticRevision: Number(semanticRevision) }) }, contextFromRequest(request));
  }

  @Get('revision-reading')
  @Header('Cache-Control', 'private, no-store')
  async readRevision(@Param('documentVersionId') documentVersionId: string,
    @Query('parseRunId') parseRunId: string, @Query('semanticRevision') semanticRevision: string,
    @Query('beforeDocumentVersionId') beforeDocumentVersionId: string,
    @Query('beforeParseRunId') beforeParseRunId: string, @Query('beforeSemanticRevision') beforeSemanticRevision: string,
    @Query('roleKey') roleKey: string, @Req() request: Request) {
    if (![semanticRevision, beforeSemanticRevision].every(value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)))
      throw new BadRequestException('DOCUMENT_REVISION_IDENTITY_INVALID');
    return this.revisions.readForBrowser({ before: { documentVersionId: beforeDocumentVersionId, parseRunId: beforeParseRunId,
      semanticRevision: Number(beforeSemanticRevision) },
      after: { documentVersionId, parseRunId, semanticRevision: Number(semanticRevision) }, roleKey }, contextFromRequest(request));
  }

  @Get('translation-reading')
  @Header('Cache-Control', 'private, no-store')
  async read(@Param('documentVersionId') documentVersionId: string, @Query('parseRunId') parseRunId: string,
    @Req() request: Request): Promise<DocumentTranslationReadingResponse> {
    if (![documentVersionId,parseRunId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value)))
      throw new BadRequestException('DOCUMENT_TRANSLATION_READING_IDENTITY_INVALID');
    const context = contextFromRequest(request);
    const loaded = await this.reader.readDocumentOriginal(documentVersionId, parseRunId, context);
    const artifact = loaded.run.manifestArtifact;
    if (!artifact || loaded.original.binding.documentVersionId !== documentVersionId || loaded.original.binding.parseRunId !== parseRunId)
      throw new Error('DOCUMENT_TRANSLATION_READING_BINDING_MISMATCH');
    const workspace = await this.workspaces.readForSource({ tenantId: context.tenantId, workItemId: null, documentVersionId,
      parsedArtifactRef: `document-original://${encodeURIComponent(documentVersionId)}/${encodeURIComponent(parseRunId)}`,
      parsedArtifactSha256: artifact.sha256 });
    const result: DocumentTranslationReadingResponse = { documentVersionId, parseRunId,
      translation: { status: 'UNAVAILABLE', reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE' }, execution: null };
    if (workspace) {
      const snapshot = await this.workspaces.readSnapshot({ tenantId: context.tenantId, workItemId: null, documentVersionId, workspaceId: workspace.workspaceId });
      result.translation = { status: 'SEMANTIC_READING_AID_AVAILABLE', reading: buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions) };
    }
    const attempt = await this.attempts.latest({ ...context, documentVersionId });
    if (attempt?.producerRunId === parseRunId) result.execution = { status: attempt.status, errorCode: attempt.errorCode };
    // Recheck source access after storage reads; prior output never grants access.
    await this.parsing.status(documentVersionId, context);
    return result;
  }
}
