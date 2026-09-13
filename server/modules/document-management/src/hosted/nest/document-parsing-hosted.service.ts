import { compareDocumentOriginal, type DocumentOriginalChange } from './document-original-change';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { DocumentParsedReading, DocumentParsingStatus, DocumentParseRunSummary, StartDocumentParseRequest } from '@shared/document-parsing.interface';
import type { DocumentOriginalArtifact, DocumentOriginalBinding, DocumentOriginalStepResult } from '@shared/document-original.interface';
import { MineruArtifactStore } from '../../../../professional-input/mineru/mineru-artifact-store';
import { buildMineruReadingProjection } from '../../../../professional-input/mineru/mineru-reading-projection';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER, type DocumentManagementIngestAuthorizer } from './document-management-hosted.tokens';
import { DocumentParsingRepository, documentParseError, type DocumentParseRow } from './document-parsing.repository';
import { DocumentStepLeaseRepository, type DocumentStepFence } from './document-step-lease.repository';
import { DocumentOfficialPluginService } from './document-official-plugin.service';
import { DocumentOriginalStore, type DocumentOriginalBundle } from './document-original-store';
import { extractDocumentPdfPages, type DocumentPdfExtraction } from './document-original-pdf';
import { composeDocumentOriginal } from './document-original-compose';
import { documentOriginalStructuredSource } from './document-original-adapter';

type ReadScope = { actorUserId: string; tenantId: string; roles: string[] };
const PAGE_GROUP_SIZE = 8;

@Injectable()
// Registered by DocumentManagementHostedModule.register().
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentParsingHostedService {
  private readonly logger = new Logger(DocumentParsingHostedService.name);
  private readonly store: DocumentOriginalStore;
  private readonly legacyStore: MineruArtifactStore;
  private readonly originals: MiaodaFileServiceArtifactStore;
  constructor(
    private readonly files: FileService,
    private readonly catalog: MiaodaHostedDocumentCatalog,
    private readonly repository: DocumentParsingRepository,
    private readonly plugins: DocumentOfficialPluginService,
    private readonly leases: DocumentStepLeaseRepository,
    @Inject(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER) private readonly authorizer: DocumentManagementIngestAuthorizer,
  ) {
    this.store = new DocumentOriginalStore(files);
    this.legacyStore = new MineruArtifactStore(files);
    this.originals = new MiaodaFileServiceArtifactStore(files);
  }

  async status(documentVersionId: string, context: ReadScope): Promise<DocumentParsingStatus> {
    const source = await this.authorizedSource(documentVersionId, context);
    const state = await this.repository.current({ ...context, documentVersionId });
    const configured = this.plugins.configured();
    const officialPublished = state.published?.manifestArtifact?.relativePath === 'original/manifest.json';
    return { documentVersionId, originalFilename: source.version.originalFilename,
      latestRun: state.latest ? summary(state.latest) : null, publishedRun: state.published ? summary(state.published) : null,
      runtimeAvailable: configured, runtime: { state: !configured ? 'NOT_CONFIGURED' : state.latest?.errorCode ? 'FAILED' :
        officialPublished ? 'CALL_SUCCEEDED' : 'CONFIGURED_UNVERIFIED',
        errorCode: !configured ? 'DOCUMENT_PLUGIN_NOT_CONFIGURED' : state.latest?.errorCode ?? null,
        lastCompletedAt: officialPublished ? state.published!.completedAt?.toISOString() ?? null : null } };
  }

  /** Reservation only. M's registered durable consumer owns claiming and continuation. */
  async start(documentVersionId: string, request: unknown, context: ReadScope): Promise<DocumentParseRunSummary> {
    const input = startInput(request);
    const source = await this.authorizedSource(documentVersionId, context);
    const scope = { ...context, documentVersionId };
    const existing = await this.repository.readRequest(scope, input.requestId);
    if (existing) {
      if (existing.expectedPublishedRevision !== input.expectedPublishedRevision) throw documentParseError('DOCUMENT_PARSE_REQUEST_CONFLICT');
      return summary(existing);
    }
    if (!this.plugins.configured()) throw documentParseError('DOCUMENT_PLUGIN_NOT_CONFIGURED', 503);
    const reservation = await this.repository.reserve(scope, { ...input, bucketId: source.source.bucketId,
      sourceBinding: { documentVersionId, documentId: source.version.documentId, familyId: source.version.familyId,
        sourceArtifactId: source.version.sourceArtifactId, pdfSha256: source.version.pdfSha256, byteLength: source.version.byteLength } });
    return summary(reservation.row);
  }

  async executeStep(parseRunId: string, context: ReadScope & { documentVersionId: string }, fence: DocumentStepFence): Promise<DocumentOriginalStepResult> {
    if (fence.parseRunId !== parseRunId) throw documentParseError('DOCUMENT_STEP_LEASE_REJECTED');
    const scope = { ...context };
    await this.leases.check(scope, fence);
    const run = await this.repository.read(scope, parseRunId);
    if (!run) throw documentParseError('DOCUMENT_PARSE_NOT_FOUND', 404);
    const assertActive = async () => { await this.assertRead(run.documentVersionId, context); await this.leases.check(scope, fence); };
    const binding = originalBinding(run);
    const storage = storageScope(run);
    const progress = [...run.artifactProgress];
    const record = async (artifact: DocumentOriginalArtifact) => {
      await assertActive();
      const index = progress.findIndex(item => item.relativePath === artifact.relativePath);
      if (index < 0) progress.push(artifact); else progress[index] = artifact;
      await this.repository.progress(scope, parseRunId, progress, fence);
    };
    try {
      if (run.status === 'RUNNING') await this.repository.stage(scope, parseRunId, fence);
      const completed = await this.store.recover(storage, 'MANIFEST');
      if (completed) {
        const bundle = await this.store.load(storage, completed.artifact, binding);
        const change = bundle.change ?? await this.originalChange(run, bundle.original, context);
        await record(completed.artifact);
        await assertActive();
        await this.repository.publish(scope, parseRunId, completed.artifact, fence);
        return stepResult(run, bundle.original.coverage, 'PUBLISHED', change);
      }
      const source = await this.authorizedSource(run.documentVersionId, context);
      const original = await this.originals.readSelection({ bucketId: source.source.bucketId, filePath: source.source.filePath });
      if (!original.readbackVerified || original.sha256 !== run.sourceBinding.pdfSha256 || original.byteLength !== run.sourceBinding.byteLength ||
          original.sha256 !== source.source.sha256 || original.byteLength !== source.source.byteLength ||
          original.providerObjectId !== source.source.providerObjectId || original.providerVersionId !== source.source.providerVersionId)
        throw documentParseError('DOCUMENT_PARSE_ORIGINAL_MISMATCH');
      let raw = await this.store.recover(storage, 'RAW_MARKDOWN');
      if (!raw) {
        const parsed = await this.plugins.parseOriginal({ assertActive,
          originalUrl: async () => this.files.from(source.source.bucketId).createSignedUrl(source.source.filePath, 600) });
        const bytes = Buffer.from(parsed.markdown);
        raw = { bytes, artifact: await this.store.save(storage, 'RAW_MARKDOWN', bytes, record) };
      } else await record(raw.artifact);
      // DB progress stores verified immutable descriptors. Normal continuation needs only
      // the last page group, not every preceding group or a recomposed prefix.
      const pageArtifacts = run.artifactProgress
        .filter(item => item.readback === 'VERIFIED' && item.role === 'MANIFEST' && /^original\/pages-[0-9]+\.json$/.test(item.relativePath))
        .map(originalArtifact)
        .sort((a, b) => pageArtifactStart(a) - pageArtifactStart(b));
      if (pageArtifacts.some((artifact, index) => pageArtifactStart(artifact) !== index * PAGE_GROUP_SIZE))
        throw documentParseError('DOCUMENT_ORIGINAL_PAGE_CHECKPOINT_INVALID');
      const currentPages = new Map<number, DocumentPdfExtraction>();
      let pageCount: number | null = null;
      let pageStart = 0;
      const last = pageArtifacts.at(-1);
      if (last) {
        const start = pageArtifactStart(last);
        const chunk: DocumentPdfExtraction = JSON.parse(Buffer.from(await this.store.read(storage, last)).toString('utf8'));
        assertPageChunk(chunk, start, null);
        currentPages.set(start, chunk); pageCount = chunk.pageCount; pageStart = start + chunk.pages.length;
      }
      if (pageCount === null || pageStart < pageCount) {
        const path = `original/pages-${pageStart}.json`;
        // Recover a lost upload/progress response at exactly the next path before extracting again.
        const recovered = await this.store.recover(storage, 'MANIFEST', path);
        const chunk: DocumentPdfExtraction = recovered
          ? JSON.parse(Buffer.from(recovered.bytes).toString('utf8'))
          : await extractDocumentPdfPages({ bytes: original.bytes, pageStart, pageCount: PAGE_GROUP_SIZE, assertActive });
        assertPageChunk(chunk, pageStart, pageCount);
        const artifact = recovered ? recovered.artifact
          : await this.store.save(storage, 'MANIFEST', Buffer.from(JSON.stringify(chunk)), record, path);
        if (recovered) await record(artifact);
        currentPages.set(pageStart, chunk); pageArtifacts.push(artifact);
        pageCount = chunk.pageCount; pageStart += chunk.pages.length;
      }
      if (pageStart < pageCount!) return stepResult(run, {
        knownPageCount: pageCount,
        readPageIndexes: Array.from({ length: pageStart }, (_, index) => index),
        unresolvedRanges: [
          { reason: 'UNREAD', unitIds: [], pageIndexes: Array.from({ length: pageCount! - pageStart }, (_, index) => pageStart + index),
            message: 'These pages have not been extracted yet.' },
          { reason: 'STRUCTURE_UNCERTAIN', unitIds: [], pageIndexes: Array.from({ length: pageStart }, (_, index) => index),
            message: 'Page text is checkpointed; full document structure and figure coverage have not been assembled.' },
        ],
      }, 'STAGING');
      // One final assembly reuses this tick's groups and loads each older group once.
      const pages: DocumentPdfExtraction['pages'] = [];
      for (const artifact of pageArtifacts) {
        await assertActive();
        const start = pageArtifactStart(artifact);
        const chunk = currentPages.get(start) ?? JSON.parse(Buffer.from(await this.store.read(storage, artifact)).toString('utf8')) as DocumentPdfExtraction;
        assertPageChunk(chunk, pages.length, pageCount);
        pages.push(...chunk.pages);
      }
      const markdown = Buffer.from(raw.bytes).toString('utf8');
      const result = composeDocumentOriginal({ binding, extraction: { pageCount: pageCount!, pages }, markdown,
        producer: { kind: 'OFFICIAL_PLUGIN_HYBRID', instanceId: 'wl-document-parser', pluginVersion: '1.0.16',
          actionKey: 'parseDocToMarkdown', concreteModel: null, extractedAt: null } });
      documentOriginalStructuredSource(result, binding);
      const change = await this.originalChange(run, result, context);
      const bundle: DocumentOriginalBundle = { change, schemaVersion: 'wiselink.document.bundle.v1', original: result,
        rawPdfArtifacts: pageArtifacts, rawMarkdown: raw.artifact };
      const manifest = await this.store.save(storage, 'MANIFEST', Buffer.from(JSON.stringify(bundle)), record);
      await this.store.load(storage, manifest, binding);
      await assertActive();
      await this.repository.publish(scope, parseRunId, manifest, fence);
      return stepResult(run, result.coverage, 'PUBLISHED', change);
    } catch (error) {
      const code = safeErrorCode(error);
      try { await this.repository.recordStepFailure(scope, fence, code); }
      catch { this.logger.error(`Document step ${parseRunId} failure record rejected; durable lease/deadline remains authoritative.`); }
      throw error;
    }
  }

  async read(documentVersionId: string, parseRunId: string | undefined, context: ReadScope): Promise<DocumentParsedReading> {
    const source = await this.authorizedSource(documentVersionId, context);
    const run = await this.publishedRun(documentVersionId, parseRunId, context);
    if (run.manifestArtifact!.relativePath === 'original/manifest.json') {
      const artifact = originalArtifact(run.manifestArtifact!);
      const bundle = await this.store.load(storageScope(run), artifact, originalBinding(run));
      await this.assertRead(documentVersionId, context);
      return { documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision,
        originalFilename: source.version.originalFilename, parser: { name: 'OfficialPluginHybrid', version: bundle.original.producer.pluginVersion, backend: 'Host' },
        titleEnhancement: { status: 'DISABLED' }, markdown: bundle.original.markdown, assets: {}, original: bundle.original,
        projection: { documentVersionId, parseRunId: run.parseRunId, sources: [], notes: [], issues: [] } };
    }
    // Historical published MinerU artifacts remain readable; no new MinerU producer.
    const loaded = await this.legacyStore.loadReading({ scope: storageScope(run), documentVersion: run.sourceBinding, manifestArtifact: run.manifestArtifact! });
    await this.assertRead(documentVersionId, context);
    return { documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision,
      originalFilename: source.version.originalFilename, parser: loaded.manifest.parser, titleEnhancement: loaded.manifest.titleEnhancement,
      markdown: loaded.document.markdown, assets: Object.fromEntries(Object.keys(loaded.images).map(path => [path,
        `/api/document-management/document-versions/${encodeURIComponent(documentVersionId)}/parse-runs/${encodeURIComponent(run.parseRunId)}/asset?path=${encodeURIComponent(path)}`])),
      projection: buildMineruReadingProjection(loaded.document, { documentVersionId, parseRunId: run.parseRunId }) };
  }

  async loadPublished(documentVersionId: string, parseRunId: string, context: ReadScope) {
    await this.authorizedSource(documentVersionId, context);
    const run = await this.publishedRun(documentVersionId, parseRunId, context);
    const loaded = await this.store.load(storageScope(run), originalArtifact(run.manifestArtifact!), originalBinding(run));
    await this.assertRead(documentVersionId, context);
    return { run, original: loaded.original, structuredSource: documentOriginalStructuredSource(loaded.original, originalBinding(run)) };
  }

  async asset(documentVersionId: string, parseRunId: string, path: unknown, context: ReadScope) {
    await this.authorizedSource(documentVersionId, context);
    const run = await this.publishedRun(documentVersionId, parseRunId, context);
    const matches = run.artifactProgress.filter(item => item.role === 'IMAGE' && item.relativePath === path && item.readback === 'VERIFIED');
    if (matches.length !== 1) throw documentParseError('DOCUMENT_PARSE_ASSET_NOT_FOUND', 404);
    const bytes = await this.legacyStore.read(storageScope(run), matches[0]);
    await this.assertRead(documentVersionId, context);
    return { bytes, mediaType: matches[0].mediaType };
  }
  private async originalChange(run: DocumentParseRow, original: DocumentOriginalBundle['original'], context: ReadScope) {
    if (run.expectedPublishedRevision === 0) return compareDocumentOriginal(null, original);
    const previous = (await this.repository.current({ ...context, documentVersionId: run.documentVersionId })).published;
    if (!previous || previous.parseRevision !== run.expectedPublishedRevision) throw documentParseError('DOCUMENT_PARSE_REVISION_CONFLICT');
    if (previous.manifestArtifact?.relativePath !== 'original/manifest.json') return {
      ...compareDocumentOriginal(null, original), kind: 'IMPACT_UNRESOLVED' as const, previousParseRunId: previous.parseRunId,
    };
    const loaded = await this.store.load(storageScope(previous), originalArtifact(previous.manifestArtifact), originalBinding(previous));
    await this.assertRead(run.documentVersionId, context);
    return compareDocumentOriginal(loaded.original, original);
  }

  private async publishedRun(documentVersionId: string, parseRunId: string | undefined, context: ReadScope) {
    const scope = { ...context, documentVersionId };
    const run = parseRunId ? await this.repository.read(scope, parseRunId) : (await this.repository.current(scope)).published;
    if (!run || run.status !== 'PUBLISHED' || !run.manifestArtifact) throw documentParseError('DOCUMENT_PARSE_NOT_PUBLISHED', 404);
    return run;
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
  if (/^MINERU_PROCESS_FAILED:/.test(value)) return 'MINERU_PROCESS_FAILED';
  return /^[A-Z][A-Z0-9_]{1,159}$/.test(value) ? value : 'DOCUMENT_PARSE_FAILED';
}

function originalBinding(run: DocumentParseRow): DocumentOriginalBinding {
  return { documentVersionId: run.documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision,
    sourceArtifactId: run.sourceBinding.sourceArtifactId, sourceSha256: run.sourceBinding.pdfSha256, sourceByteLength: run.sourceBinding.byteLength };
}
function originalArtifact(artifact: NonNullable<DocumentParseRow['manifestArtifact']>): DocumentOriginalArtifact {
  if (!['MANIFEST', 'RAW_MARKDOWN'].includes(artifact.role)) throw documentParseError('DOCUMENT_ORIGINAL_DESCRIPTOR_INVALID');
  return { ...artifact, role: artifact.role === 'MANIFEST' ? 'MANIFEST' : 'RAW_MARKDOWN' };
}
function pageArtifactStart(artifact: DocumentOriginalArtifact): number {
  const match = /^original\/pages-([0-9]+)\.json$/.exec(artifact.relativePath);
  const start = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(start) || start < 0) throw documentParseError('DOCUMENT_ORIGINAL_PAGE_CHECKPOINT_INVALID');
  return start;
}
function assertPageChunk(chunk: DocumentPdfExtraction, start: number, expectedCount: number | null) {
  if (!Number.isSafeInteger(chunk.pageCount) || chunk.pageCount < 1 ||
      (expectedCount !== null && chunk.pageCount !== expectedCount) || !Array.isArray(chunk.pages) ||
      chunk.pages.length < 1 || chunk.pages.length !== Math.min(PAGE_GROUP_SIZE, chunk.pageCount - start) ||
      chunk.pages.some((page, index) => page.pageIndex !== start + index || page.pageIndex >= chunk.pageCount || typeof page.text !== 'string'))
    throw documentParseError('DOCUMENT_ORIGINAL_PAGE_CHECKPOINT_INVALID');
}
function stepResult(run: DocumentParseRow, coverage: DocumentOriginalStepResult['coverage'], status: DocumentOriginalStepResult['status'], change?: DocumentOriginalChange): DocumentOriginalStepResult {
  return { parseRunId: run.parseRunId, parseRevision: run.parseRevision, status, coverage,
    changedUnitIds: change?.changedUnitIds ?? [], changedSourceRefIds: change?.changedSourceRefIds ?? [],
    previousParseRunId: change?.previousParseRunId ?? null,
    changeKind: change?.kind ?? (run.expectedPublishedRevision === 0 ? 'INITIAL' : 'IMPACT_UNRESOLVED') };
}
