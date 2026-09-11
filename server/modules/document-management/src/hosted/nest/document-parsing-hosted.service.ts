import { Inject, Injectable, Logger } from '@nestjs/common';
import { CapabilityService, FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { DocumentParsedReading, DocumentParsingStatus, DocumentParseRunSummary, StartDocumentParseRequest } from '@shared/document-parsing.interface';
import { MineruArtifactStore, MineruPersistenceError, type MineruStoredArtifact } from '../../../../professional-input/mineru/mineru-artifact-store';
import { MineruExecutionError, MineruRunner } from '../../../../professional-input/mineru/mineru-runner';
import { MineruHostedRuntime } from '../../../../professional-input/mineru/mineru-hosted-runtime';
import { miaodaMineruTitleCall } from '../../../../professional-input/mineru/mineru-title-enhancer';
import { buildMineruReadingProjection } from '../../../../professional-input/mineru/mineru-reading-projection';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER, type DocumentManagementIngestAuthorizer } from './document-management-hosted.tokens';
import { DocumentParsingRepository, documentParseError, type DocumentParseRow, type DocumentParseScope } from './document-parsing.repository';

type ReadScope = { actorUserId: string; tenantId: string; roles: string[] };

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentParsingHostedService {
  private readonly logger = new Logger(DocumentParsingHostedService.name);
  private readonly store: MineruArtifactStore;
  private readonly originals: MiaodaFileServiceArtifactStore;
  private readonly runtime: MineruHostedRuntime;
  private runner: MineruRunner | null = null;
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    files: FileService,
    private readonly catalog: MiaodaHostedDocumentCatalog,
    private readonly repository: DocumentParsingRepository,
    private readonly capabilities: CapabilityService,
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER) private readonly authorizer: DocumentManagementIngestAuthorizer,
  ) {
    this.store = new MineruArtifactStore(files);
    this.originals = new MiaodaFileServiceArtifactStore(files);
    this.runtime = new MineruHostedRuntime(files);
  }

  async status(documentVersionId: string, context: ReadScope): Promise<DocumentParsingStatus> {
    const source = await this.authorizedSource(documentVersionId, context);
    const state = await this.repository.current({ ...context, documentVersionId });
    const runtime = this.runtime.observe();
    return { documentVersionId, originalFilename: source.version.originalFilename,
      latestRun: state.latest ? summary(state.latest) : null,
      publishedRun: state.published ? summary(state.published) : null,
      runtimeAvailable: runtime.state === 'READY', runtime,
    };
  }

  async start(documentVersionId: string, request: unknown, context: ReadScope): Promise<DocumentParseRunSummary> {
    const input = startInput(request);
    const source = await this.authorizedSource(documentVersionId, context);
    const scope = { ...context, documentVersionId };
    const existing = await this.repository.readRequest(scope, input.requestId);
    if (existing) {
      if (existing.expectedPublishedRevision !== input.expectedPublishedRevision) throw documentParseError('DOCUMENT_PARSE_REQUEST_CONFLICT');
      return summary(existing);
    }
    if (this.runtime.observe().state !== 'READY') throw documentParseError('DOCUMENT_PARSE_RUNTIME_UNAVAILABLE', 503);
    const reservation = await this.repository.reserve(scope, { ...input, bucketId: source.source.bucketId,
      sourceBinding: { documentVersionId, documentId: source.version.documentId, familyId: source.version.familyId,
        sourceArtifactId: source.version.sourceArtifactId, pdfSha256: source.version.pdfSha256, byteLength: source.version.byteLength },
    });
    if (reservation.created) {
      // The durable run is returned immediately; closing the browser does not abandon the work.
      // Replays observe that same row and never launch another process.
      const execution = this.execute(reservation.row, context).finally(() => this.running.delete(reservation.row.parseRunId));
      this.running.set(reservation.row.parseRunId, execution);
    }
    return summary(reservation.row);
  }

  async read(documentVersionId: string, parseRunId: string | undefined, context: ReadScope): Promise<DocumentParsedReading> {
    const { run, loaded, source } = await this.loadPublished(documentVersionId, parseRunId, context);
    const assets = Object.fromEntries(Object.keys(loaded.images).map(path => [path,
      `/api/document-management/document-versions/${encodeURIComponent(documentVersionId)}/parse-runs/${encodeURIComponent(run.parseRunId)}/asset?path=${encodeURIComponent(path)}`]));
    return { documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision,
      originalFilename: source.version.originalFilename, parser: loaded.manifest.parser, titleEnhancement: loaded.manifest.titleEnhancement,
      markdown: loaded.document.markdown, assets,
      projection: buildMineruReadingProjection(loaded.document, { documentVersionId, parseRunId: run.parseRunId }),
    };
  }

  async asset(documentVersionId: string, parseRunId: string, path: unknown, context: ReadScope) {
    if (typeof path !== 'string') throw documentParseError('DOCUMENT_PARSE_ASSET_NOT_FOUND', 404);
    await this.authorizedSource(documentVersionId, context);
    const run = await this.repository.read({ ...context, documentVersionId }, parseRunId);
    if (!run || run.status !== 'PUBLISHED' || !run.manifestArtifact) throw documentParseError('DOCUMENT_PARSE_NOT_PUBLISHED', 404);
    // Published descriptors are immutable and were verified before the publication CAS.
    // Fetching one image does not reload the complete Markdown and layout bundle.
    const matches = run.artifactProgress.filter(item => item.role === 'IMAGE' && item.relativePath === path && item.readback === 'VERIFIED');
    const descriptor = matches.length === 1 ? matches[0] : null;
    if (!descriptor) throw documentParseError('DOCUMENT_PARSE_ASSET_NOT_FOUND', 404);
    const bytes = await this.store.read(storageScope(run), descriptor);
    await this.assertRead(documentVersionId, context);
    return { bytes, mediaType: descriptor.mediaType };
  }

  /** Translation and assessment consumers use this exact published version; no parser rerun or temporary files. */
  async loadPublished(documentVersionId: string, parseRunId: string | undefined, context: ReadScope) {
    const source = await this.authorizedSource(documentVersionId, context);
    const scope = { ...context, documentVersionId };
    const run = parseRunId ? await this.repository.read(scope, parseRunId) : (await this.repository.current(scope)).published;
    if (!run || run.status !== 'PUBLISHED' || !run.manifestArtifact) throw documentParseError('DOCUMENT_PARSE_NOT_PUBLISHED', 404);
    const binding = { documentVersionId, documentId: source.version.documentId, familyId: source.version.familyId,
      sourceArtifactId: source.version.sourceArtifactId, pdfSha256: source.version.pdfSha256, byteLength: source.version.byteLength };
    const loaded = await this.store.loadReading({ scope: storageScope(run), documentVersion: binding, manifestArtifact: run.manifestArtifact });
    await this.assertRead(documentVersionId, context);
    return { run, loaded, source };
  }

  private async execute(run: DocumentParseRow, context: ReadScope) {
    const scope: DocumentParseScope = { ...context, documentVersionId: run.documentVersionId };
    try {
      const source = await this.authorizedSource(run.documentVersionId, context);
      const original = await this.originals.readSelection({ bucketId: source.source.bucketId, filePath: source.source.filePath });
      if (!original.readbackVerified || original.sha256 !== run.sourceBinding.pdfSha256 || original.byteLength !== run.sourceBinding.byteLength ||
          original.sha256 !== source.source.sha256 || original.byteLength !== source.source.byteLength ||
          original.providerObjectId !== source.source.providerObjectId || original.providerVersionId !== source.source.providerVersionId) {
        throw documentParseError('DOCUMENT_PARSE_ORIGINAL_MISMATCH');
      }
      this.runner ??= new MineruRunner({ ...this.runtime.options(),
        titleCall: miaodaMineruTitleCall(this.capabilities) });
      const result = await this.runner.parse(original.bytes);
      await this.assertRead(run.documentVersionId, context);
      await this.repository.stage(scope, run.parseRunId);
      const progress = new Map<string, MineruStoredArtifact>();
      const saved = await this.store.persist({ scope: storageScope(run), documentVersion: run.sourceBinding, result,
        onProgress: async artifact => {
          progress.set(artifact.relativePath, artifact);
          await this.repository.progress(scope, run.parseRunId, [...progress.values()]);
        },
      });
      await this.assertRead(run.documentVersionId, context);
      await this.repository.publish(scope, run.parseRunId, saved.manifestArtifact);
    } catch (error) {
      const code = safeErrorCode(error);
      this.logger.error(`Document parse ${run.parseRunId} failed: ${code}`);
      if (error instanceof MineruExecutionError) {
        // MinerU's Click CLI reports task failures over multiple stderr lines;
        // Python-exception-only filtering loses the actual task failure reason.
        // Keep a bounded diagnostic tail in Host logs, never model output/stdout.
        const stderr = error.stderr.replace(/\u001b\[[0-9;]*m/g, '')
          .replace(/https?:\/\/\S+/g, '[URL]').slice(-6000);
        this.logger.error(`MinerU process ${run.parseRunId}: ${JSON.stringify({ exit: error.message, stderr })}`);
      }
      try {
        await this.repository.fail(scope, run.parseRunId, { errorCode: code,
          ...(error instanceof MineruPersistenceError ? { progress: error.progress, pendingObject: error.pendingObject } : {}),
        });
      } catch {
        this.logger.error(`Document parse ${run.parseRunId} failure could not be recorded; its persisted deadline and request remain available for recovery.`);
      }
    }
  }

  private async assertRead(documentVersionId: string, context: ReadScope) {
    await this.authorizer.assertCanRead({ ...context, action: 'DOCUMENT_READ', documentVersionId });
  }

  private async authorizedSource(documentVersionId: string, context: ReadScope) {
    await this.assertRead(documentVersionId, context);
    const source = await this.catalog.readMetadataSource(documentVersionId, context.tenantId);
    if (!source) throw documentParseError('DOCUMENT_VERSION_NOT_FOUND', 404);
    return source;
  }
}

function summary(row: DocumentParseRow): DocumentParseRunSummary {
  return { parseRunId: row.parseRunId, documentVersionId: row.documentVersionId, parseRevision: row.parseRevision,
    status: row.status, verifiedArtifacts: row.artifactProgress.filter(item => item.readback === 'VERIFIED').length,
    errorCode: row.errorCode, startedAt: row.startedAt.toISOString(), deadlineAt: row.deadlineAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null };
}
function storageScope(row: DocumentParseRow) {
  return { documentVersionId: row.documentVersionId, parseRunId: row.parseRunId, bucketId: row.bucketId };
}
function startInput(value: unknown): StartDocumentParseRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw documentParseError('DOCUMENT_PARSE_INPUT_INVALID', 400);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['requestId', 'expectedPublishedRevision'].includes(key)) ||
      typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.expectedPublishedRevision) || Number(input.expectedPublishedRevision) < 0) {
    throw documentParseError('DOCUMENT_PARSE_INPUT_INVALID', 400);
  }
  return { requestId: input.requestId, expectedPublishedRevision: Number(input.expectedPublishedRevision) };
}
function safeErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  if (error instanceof MineruExecutionError && /^MINERU_PROCESS_FAILED:/.test(value)) return 'MINERU_PROCESS_FAILED';
  return /^[A-Z][A-Z0-9_]{1,159}$/.test(value) ? value : 'DOCUMENT_PARSE_FAILED';
}
