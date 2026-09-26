import { reconcileMineruTextCoverage } from './document-mineru-text-coverage';
import { CanonicalDocumentParsingSettingsService } from '../../../../model-settings/canonical-document-parsing-settings.service';
import { enhanceMineruTitles } from '../../../../professional-input/mineru/mineru-title-enhancer';
import { readMineruArtifacts } from '../../../../professional-input/mineru/mineru-artifacts';
import { randomUUID } from 'node:crypto';
import { mintDocumentUploadAuthority } from './document-upload-authority';
import { readLocalMineruCandidate } from './document-mineru-local-candidate';
import { documentMineruOriginal } from './document-mineru-original-adapter';
import type { DocumentLocalMineruInput, DocumentParseSourceBinding } from '@server/database/document-parsing.schema';
import { sameParserInput } from './document-parsing.repository';
import { documentParseRecoveryPredecessor } from '@shared/document-parsing-recovery';
import { DocumentOriginalRecovery, saveOriginalRaw, checkCurrentRawProvenance } from './document-original-recovery';
import { compareDocumentOriginal, type DocumentOriginalChange } from './document-original-change';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import type { DocumentParsedReading, DocumentParsingStatus, DocumentParseRunSummary, StartDocumentParseRequest } from '@shared/document-parsing.interface';
import type { DocumentOriginalArtifact, DocumentOriginalBinding, DocumentOriginalStepResult } from '@shared/document-original.interface';
import { MineruArtifactStore } from '../../../../professional-input/mineru/mineru-artifact-store';
import { buildMineruReadingProjection } from '../../../../professional-input/mineru/mineru-reading-projection';
import { MiaodaFileServiceArtifactStore } from '../miaodaFileServiceArtifactStore.js';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER, type DocumentManagementIngestAuthorizer } from './document-management-hosted.tokens';
import { DocumentParsingRepository, documentParseError, type DocumentParseRow } from './document-parsing.repository';
import { decodeExtractedMetadataTitle } from './document-metadata-decode';
import { DocumentStepLeaseRepository, type DocumentStepFence } from './document-step-lease.repository';
import { DocumentOfficialPluginService } from './document-official-plugin.service';
import { DocumentOriginalStore, type DocumentOriginalBundle } from './document-original-store';
import { openDocumentPdfSession, type DocumentPdfSession, type DocumentPdfExtraction } from './document-original-pdf';
import { composeDocumentOriginal } from './document-original-compose';
import { documentOriginalStructuredSource, documentOriginalReadingCoverage } from './document-original-adapter';

type ReadScope = { actorUserId: string; tenantId: string; roles: string[]; appId?: string; env?: string };
const PAGE_GROUP_SIZE = 8;
const MAX_PAGE_GROUPS_PER_STEP = 2;
const STEP_CONTINUATION_BUDGET_MS = 10_000;
const MAX_CONTINUATION_SOURCE_BYTES = 16 * 1024 * 1024;

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
    @Optional() private readonly parsingSettings?: CanonicalDocumentParsingSettingsService,
  ) {
    this.store = new DocumentOriginalStore(files);
    this.legacyStore = new MineruArtifactStore(files);
    this.originals = new MiaodaFileServiceArtifactStore(files);
  }

  async status(documentVersionId: string, context: ReadScope): Promise<DocumentParsingStatus> {
    const source = await this.authorizedSource(documentVersionId, context);
    const state = await this.repository.current({ ...context, documentVersionId });
    const configured = this.plugins.configured() || state.latest?.sourceBinding.parserInput?.mode === 'LOCAL_MINERU_IMPORT';
    const officialPublished = state.published?.manifestArtifact?.relativePath === 'original/manifest.json';
    const extractedMetadata = source.metadata?.extractedMetadata;
    const documentTitle = extractedMetadata == null ? null
      : decodeExtractedMetadataTitle(extractedMetadata).observations
          .map((observation) => observation.value.trim()).filter(Boolean).join(' / ') || null;
    return { documentVersionId, familyId: source.family.familyId,
      documentCode: source.family.canonicalDocumentNumber, documentTitle,
      normalizedFamily: source.family.documentFamily, issuerAuthority: source.family.issuerAuthority,
      businessRevision: source.version.businessRevision, revisionDate: source.version.revisionDate,
      sourceGeneratedDate: source.version.sourceGeneratedDate,
      selectedVersionIsCurrent: source.family.currentDocumentVersionId === documentVersionId,
      originalFilename: source.version.originalFilename,
      latestRun: state.latest ? summary(state.latest) : null, publishedRun: state.published ? summary(state.published) : null,
      runtimeAvailable: configured, runtime: { state: !configured ? 'NOT_CONFIGURED' : state.latest?.errorCode ? 'FAILED' :
        officialPublished ? 'CALL_SUCCEEDED' : 'CONFIGURED_UNVERIFIED',
        errorCode: !configured ? 'DOCUMENT_PLUGIN_NOT_CONFIGURED' : state.latest?.errorCode ?? null,
        lastCompletedAt: officialPublished ? state.published!.completedAt?.toISOString() ?? null : null } };
  }

  /** Official parses use the durable consumer; explicit local imports complete under the same document lease. */
  async start(documentVersionId: string, request: unknown, context: ReadScope): Promise<DocumentParseRunSummary> {
    const input = startInput(request);
    const source = await this.authorizedSource(documentVersionId, context);
    const scope = { ...context, documentVersionId };
    const predecessorId = documentParseRecoveryPredecessor(input.requestId);
    const existing = await this.repository.readRequest(scope, input.requestId);
    const predecessor = predecessorId ? await this.repository.read(scope, predecessorId) : null;
    if (predecessorId && (!predecessor || predecessor.actorUserId !== context.actorUserId))
      throw documentParseError('DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH');
    const admitted = existing ?? predecessor;
    const pinned = admitted?.sourceBinding.parserInput;
    if (pinned && !pinned.settings) throw documentParseError('DOCUMENT_PARSING_SETTINGS_SNAPSHOT_REQUIRED');
    if (existing && !predecessorId && pinned && input.mode !== 'LOCAL_MINERU_IMPORT')
      throw documentParseError('DOCUMENT_PARSE_REQUEST_CONFLICT');
    if (admitted && input.mode === 'LOCAL_MINERU_IMPORT' && (!pinned ||
        input.selection.bucketId.trim() !== pinned.bucketId ||
        input.selection.filePath.trim().replace(/^\/+/, '') !== pinned.filePath)) {
      throw documentParseError(predecessorId ? 'DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH' : 'DOCUMENT_PARSE_REQUEST_CONFLICT');
    }
    const selection = admitted ? pinned : input.mode === 'LOCAL_MINERU_IMPORT' ? input.selection : undefined;
    let parserInput: DocumentLocalMineruInput | undefined;
    if (selection) {
      if ((!admitted && !this.authorizer.assertCanImportLocalCandidate) ||
          (admitted && !this.authorizer.assertCanReadLocalCandidate))
        throw documentParseError('DOCUMENT_LOCAL_MINERU_AUTHORIZATION_UNAVAILABLE', 503);
      const runtimeIngestAuthority = admitted ? undefined
        : mintDocumentUploadAuthority({ ...context, appId: context.appId ?? '', env: context.env ?? '' });
      const assertCandidate = async () => {
        if (admitted) await this.assertLocalCandidateRead(admitted, context);
        else await this.authorizer.assertCanImportLocalCandidate!({ ...context, documentVersionId, selection, runtimeIngestAuthority });
      };
      await assertCandidate();
      const selected = await this.originals.readSelection(selection);
      const candidate = readLocalMineruCandidate(selected.bytes);
      const original = await this.originals.readSelection({ bucketId: source.source.bucketId, filePath: source.source.filePath });
      if (!selected.readbackVerified || !original.readbackVerified || original.sha256 !== source.version.pdfSha256 || original.byteLength !== source.version.byteLength ||
          original.sha256 !== source.source.sha256 || original.byteLength !== source.source.byteLength ||
          original.providerObjectId !== source.source.providerObjectId || original.providerVersionId !== source.source.providerVersionId ||
          candidate.sourceSha256 !== original.sha256 || candidate.sourceByteLength !== original.byteLength)
        throw documentParseError('DOCUMENT_PARSE_ORIGINAL_MISMATCH');
      await this.assertRead(documentVersionId, context);
      await assertCandidate();
      parserInput = { mode: 'LOCAL_MINERU_IMPORT', bucketId: selected.bucketId, filePath: selected.filePath.replace(/^\/+/, ''),
        providerObjectId: selected.providerObjectId, sha256: selected.sha256, byteLength: selected.byteLength };

      const snapshot = pinned?.settings;
      if (snapshot) parserInput.settings = snapshot;
    }
    const sourceBinding: DocumentParseSourceBinding = { documentVersionId, documentId: source.version.documentId, familyId: source.version.familyId,
      sourceArtifactId: source.version.sourceArtifactId, pdfSha256: source.version.pdfSha256, byteLength: source.version.byteLength,
      ...(parserInput ? { parserInput } : {}) };
    if (predecessor && !sameParserInput(predecessor.sourceBinding, sourceBinding))
      throw documentParseError('DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH');
    if (existing && !predecessorId) {
      if (existing.expectedPublishedRevision !== input.expectedPublishedRevision || !sameParserInput(existing.sourceBinding, sourceBinding))
        throw documentParseError('DOCUMENT_PARSE_REQUEST_CONFLICT');
      if (parserInput && ['RUNNING', 'STAGING'].includes(existing.status)) await this.executeLocalImport(existing, context);
      return summary(await this.repository.read(scope, existing.parseRunId) ?? existing);
    }
    // Recovery continues the admitted attempt; only new admissions capture current settings.
    if (parserInput && !predecessorId) {
      if (!this.parsingSettings) throw documentParseError('DOCUMENT_PARSING_SETTINGS_UNAVAILABLE', 503);
      const settings = await this.parsingSettings.capture(context.tenantId);
      if (!settings.localMineruFallbackEnabled) throw documentParseError('DOCUMENT_LOCAL_MINERU_DISABLED', 409);
      parserInput.settings = settings;
    }
    if (!existing && !parserInput && !this.plugins.configured()) throw documentParseError('DOCUMENT_PLUGIN_NOT_CONFIGURED', 503);
    const reservation = await this.repository.reserve(scope, { requestId: input.requestId, expectedPublishedRevision: input.expectedPublishedRevision, bucketId: source.source.bucketId, sourceBinding });
    if (parserInput && ['RUNNING', 'STAGING'].includes(reservation.row.status)) await this.executeLocalImport(reservation.row, context);
    return summary(await this.repository.read(scope, reservation.row.parseRunId) ?? reservation.row);
  }

  async executeStep(parseRunId: string, context: ReadScope & { documentVersionId: string }, fence: DocumentStepFence): Promise<DocumentOriginalStepResult> {
    const executionStartedAt = performance.now();
    if (fence.parseRunId !== parseRunId) throw documentParseError('DOCUMENT_STEP_LEASE_REJECTED');
    const scope = { ...context };
    await this.leases.check(scope, fence);
    const run = await this.repository.read(scope, parseRunId);
    if (!run) throw documentParseError('DOCUMENT_PARSE_NOT_FOUND', 404);
    const assertActive = async () => {
      if (run.sourceBinding.parserInput) {
        if (!run.sourceBinding.parserInput.settings) throw documentParseError('DOCUMENT_PARSING_SETTINGS_SNAPSHOT_REQUIRED');
        await this.assertLocalCandidateRead(run, context);
      } else await this.assertRead(run.documentVersionId, context);
      await this.leases.check(scope, fence);
    };
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
      await assertActive();
      if (run.status === 'RUNNING') await this.repository.stage(scope, parseRunId, fence);
      const completed = await this.store.recover(storage, 'MANIFEST');
      if (completed) {
        const bundle = await this.store.load(storage, completed.artifact, binding);
        const localProducer = ['MINERU_LOCAL', 'MINERU_LOCAL_PDFJS'].includes(bundle.original.producer.kind);
        if (localProducer !== Boolean(run.sourceBinding.parserInput)) throw documentParseError('DOCUMENT_ORIGINAL_PRODUCER_MISMATCH');
        if (!localProducer) await checkCurrentRawProvenance(this.store, run, await this.store.read(storage, bundle.rawMarkdown), record);
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
      // A derived parse revision may reuse verified inputs from the same immutable PDF.
      // Descriptors are copied into this run's namespace; no previous history is overwritten.
      let reusable: { bundle: DocumentOriginalBundle; scope: ReturnType<typeof storageScope> } | null = null;
      if (run.expectedPublishedRevision > 0) {
        const previous = (await this.repository.current(scope)).published;
        if (previous && previous.parseRunId !== run.parseRunId && previous.parseRevision === run.expectedPublishedRevision &&
            previous.manifestArtifact?.relativePath === 'original/manifest.json' &&
            previous.sourceBinding.sourceArtifactId === run.sourceBinding.sourceArtifactId &&
            previous.sourceBinding.pdfSha256 === run.sourceBinding.pdfSha256 &&
            previous.sourceBinding.byteLength === run.sourceBinding.byteLength) {
          const priorScope = storageScope(previous);
          const priorBundle = await this.store.load(priorScope, originalArtifact(previous.manifestArtifact), originalBinding(previous));
          reusable = { scope: priorScope, bundle: priorBundle };
        }
      }
      const recovery = await DocumentOriginalRecovery.load(run, id => this.repository.read(scope, id), this.store, assertActive);
      if (run.sourceBinding.parserInput?.mode === 'LOCAL_MINERU_IMPORT') {
        const selected = await this.originals.readSelection(run.sourceBinding.parserInput);
        const pinned = run.sourceBinding.parserInput;
        if (!selected.readbackVerified || selected.providerObjectId !== pinned.providerObjectId || selected.sha256 !== pinned.sha256 || selected.byteLength !== pinned.byteLength)
          throw documentParseError('DOCUMENT_MINERU_CANDIDATE_CHANGED');
        const candidate = readLocalMineruCandidate(selected.bytes);
        if (candidate.sourceSha256 !== original.sha256 || candidate.sourceByteLength !== original.byteLength)
          throw documentParseError('DOCUMENT_PARSE_ORIGINAL_MISMATCH');
        let titleEnhancement: DocumentParsedReading['titleEnhancement'] = { status: 'DISABLED' };
        let validatedTitleLevels: Array<{ id: string; level: number }> | undefined;
        if (pinned.settings?.titleEnhancementEnabled) {
          const receipt = candidate.titleEnhancement;
          const rawDocument = readMineruArtifacts({ ...candidate.rawArtifacts, assetPaths: candidate.assets.map(asset => asset.path) });
          if (receipt?.status === 'APPLIED') {
            const enhanced = await enhanceMineruTitles({ document: rawDocument, assets: candidate.assets,
              contentListV2: candidate.rawArtifacts.contentListV2, middle: candidate.rawArtifacts.middle }, async () => ({ levels: receipt.levels }));
            titleEnhancement = enhanced.titleEnhancement;
            if (titleEnhancement.status === 'APPLIED') validatedTitleLevels = receipt.levels;
          } else if (receipt?.status === 'FAILED') titleEnhancement = receipt;
          else if (!rawDocument.blocks.some(block => block.type === 'title')) titleEnhancement = { status: 'NOT_APPLICABLE' };
          else titleEnhancement = { status: 'FAILED', code: 'TITLE_RESULT_MISSING' };
        }
        const mineruOriginal = documentMineruOriginal({ binding, documentVersion: run.sourceBinding, result: candidate, validatedTitleLevels });
        const checkpoint = await this.checkpointPdfPages(run, original, assertActive, record, executionStartedAt, reusable, recovery);
        if (checkpoint.status === 'STAGING') return stepResult(run, checkpoint.coverage, 'STAGING');
        const result = reconcileMineruTextCoverage({ original: mineruOriginal, extraction: checkpoint.extraction,
          rawMiddle: candidate.rawArtifacts.middle, rawContentListV2: candidate.rawArtifacts.contentListV2 });
        await assertActive();
        const rawMineruCandidate = await this.store.save(storage, 'MANIFEST', selected.bytes, record, 'raw/mineru-candidate.json');
        const rawMarkdown = await this.store.save(storage, 'RAW_MARKDOWN', Buffer.from(candidate.rawArtifacts.markdown), record);
        const change = await this.originalChange(run, result, context);
        const bundle: DocumentOriginalBundle = { schemaVersion: 'wiselink.document.bundle.v1', original: result,
          rawPdfArtifacts: checkpoint.pageArtifacts, rawMineruCandidate, rawMarkdown, change, titleEnhancement };
        const manifest = await this.store.save(storage, 'MANIFEST', Buffer.from(JSON.stringify(bundle)), record);
        await this.store.load(storage, manifest, binding);
        await assertActive();
        await this.repository.publish(scope, parseRunId, manifest, fence);
        return stepResult(run, result.coverage, 'PUBLISHED', change);
      }
      let raw = await this.store.recover(storage, 'RAW_MARKDOWN');
      const recoveredRaw = await recovery.read('RAW_MARKDOWN', 'raw/document.md');
      if (raw && recoveredRaw && !Buffer.from(raw.bytes).equals(Buffer.from(recoveredRaw)))
        throw documentParseError('DOCUMENT_PARSE_RECOVERY_COPY_MISMATCH');
      if (!raw && recoveredRaw) {
        const bytes = new Uint8Array(recoveredRaw);
        raw = { bytes, artifact: await saveOriginalRaw(this.store, run, bytes, record) };
      }
      if (!raw && reusable?.bundle.original.producer.kind === 'OFFICIAL_PLUGIN_HYBRID') {
        const bytes = new Uint8Array(await this.store.read(reusable.scope, reusable.bundle.rawMarkdown));
        raw = { bytes, artifact: await saveOriginalRaw(this.store, run, bytes, record) };
      }
      await checkCurrentRawProvenance(this.store, run, raw?.bytes ?? null, record);
      if (!raw) {
        const parsed = await this.plugins.parseOriginal({ assertActive,
          originalUrl: async () => this.files.from(source.source.bucketId).createSignedUrl(source.source.filePath, 600) });
        const bytes = Buffer.from(parsed.markdown);
        raw = { bytes, artifact: await saveOriginalRaw(this.store, run, bytes, record) };
      } else await record(raw.artifact);
      const checkpoint = await this.checkpointPdfPages(run, original, assertActive, record, executionStartedAt, reusable, recovery);
      if (checkpoint.status === 'STAGING') return stepResult(run, checkpoint.coverage, 'STAGING');
      const { pageArtifacts, extraction } = checkpoint;
      const markdown = Buffer.from(raw.bytes).toString('utf8');
      const result = composeDocumentOriginal({ binding, extraction, markdown,
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
      const bundle = await this.store.loadForReading(storageScope(run), artifact, originalBinding(run));
      let localAssets: Record<string, string> = {};
      if (bundle.rawMineruCandidate) {
        const candidate = readLocalMineruCandidate(await this.store.read(storageScope(run), bundle.rawMineruCandidate));
        localAssets = Object.fromEntries(candidate.assets.map(asset => [asset.path,
          `/api/document-management/document-versions/${encodeURIComponent(documentVersionId)}/parse-runs/${encodeURIComponent(run.parseRunId)}/asset?path=${encodeURIComponent(asset.path)}`]));
      }
      await this.assertRead(documentVersionId, context);
      return { documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision,
        originalFilename: source.version.originalFilename, parser: bundle.original.producer.kind === 'MINERU_LOCAL' || bundle.original.producer.kind === 'MINERU_LOCAL_PDFJS'
          ? { name: 'MinerU', version: bundle.original.producer.engine!.version, backend: bundle.original.producer.engine!.backend }
          : { name: 'OfficialPluginHybrid', version: bundle.original.producer.pluginVersion, backend: 'Host' },
        titleEnhancement: bundle.titleEnhancement ?? { status: 'DISABLED' }, markdown: bundle.original.markdown, assets: localAssets, original: { ...bundle.original, coverage: documentOriginalReadingCoverage(bundle.original) },
        projection: { documentVersionId, parseRunId: run.parseRunId, sources: [], notes: [], issues: [] } };
    }
    // Historical MinerU manifests remain readable alongside the current neutral-original bundles.
    const loaded = await this.legacyStore.loadReading({ scope: storageScope(run), documentVersion: run.sourceBinding, manifestArtifact: run.manifestArtifact! });
    await this.assertRead(documentVersionId, context);
    return { documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision,
      originalFilename: source.version.originalFilename, parser: loaded.manifest.parser, titleEnhancement: loaded.manifest.titleEnhancement,
      markdown: loaded.document.markdown, assets: Object.fromEntries(Object.keys(loaded.images).map(path => [path,
        `/api/document-management/document-versions/${encodeURIComponent(documentVersionId)}/parse-runs/${encodeURIComponent(run.parseRunId)}/asset?path=${encodeURIComponent(path)}`])),
      projection: buildMineruReadingProjection(loaded.document, { documentVersionId, parseRunId: run.parseRunId }) };
  }

  /** Read-side registry identity, not an object-store content-health check. */
  async inspectPublishedIdentity(documentVersionId: string, parseRunId: string, context: ReadScope) {
    const source = await this.authorizedSource(documentVersionId, context);
    const run = await this.publishedRun(documentVersionId, parseRunId, context);
    const binding = originalBinding(run);
    const manifest = run.manifestArtifact!;
    if (run.tenantId !== context.tenantId || run.documentVersionId !== documentVersionId || run.parseRunId !== parseRunId
      || manifest.relativePath !== 'original/manifest.json' || manifest.role !== 'MANIFEST' || manifest.readback !== 'VERIFIED'
      || !Number.isSafeInteger(binding.parseRevision) || binding.parseRevision < 1
      || source.version.documentVersionId !== documentVersionId || run.sourceBinding.documentVersionId !== documentVersionId
      || run.sourceBinding.documentId !== source.version.documentId || run.sourceBinding.familyId !== source.version.familyId
      || source.family.familyId !== source.version.familyId
      || binding.sourceArtifactId !== source.version.sourceArtifactId || binding.sourceArtifactId !== source.source.sourceArtifactId
      || binding.sourceSha256 !== source.version.pdfSha256 || binding.sourceSha256 !== source.source.sha256
      || binding.sourceByteLength !== source.version.byteLength || binding.sourceByteLength !== source.source.byteLength) {
      throw documentParseError('DOCUMENT_PARSE_SOURCE_CHANGED');
    }
    await this.assertRead(documentVersionId, context);
    return { familyId: source.family.familyId, binding };
  }

  async loadPublished(documentVersionId: string, parseRunId: string, context: ReadScope) {
    await this.authorizedSource(documentVersionId, context);
    const run = await this.publishedRun(documentVersionId, parseRunId, context);
    const loaded = await this.store.loadForReading(storageScope(run), originalArtifact(run.manifestArtifact!), originalBinding(run));
    await this.assertRead(documentVersionId, context);
    return { run, original: loaded.original, structuredSource: documentOriginalStructuredSource(loaded.original, originalBinding(run)) };
  }

  async asset(documentVersionId: string, parseRunId: string, path: unknown, context: ReadScope) {
    await this.authorizedSource(documentVersionId, context);
    const run = await this.publishedRun(documentVersionId, parseRunId, context);
    if (run.manifestArtifact?.relativePath === 'original/manifest.json' && run.sourceBinding.parserInput?.mode === 'LOCAL_MINERU_IMPORT') {
      const bundle = await this.store.loadForReading(storageScope(run), originalArtifact(run.manifestArtifact), originalBinding(run));
      if (!bundle.rawMineruCandidate || typeof path !== 'string') throw documentParseError('DOCUMENT_PARSE_ASSET_NOT_FOUND', 404);
      const candidate = readLocalMineruCandidate(await this.store.read(storageScope(run), bundle.rawMineruCandidate));
      const asset = candidate.assets.find(item => item.path === path);
      if (!asset) throw documentParseError('DOCUMENT_PARSE_ASSET_NOT_FOUND', 404);
      await this.assertRead(documentVersionId, context);
      return { bytes: asset.bytes, mediaType: asset.mediaType };
    }
    const matches = run.artifactProgress.filter(item => item.role === 'IMAGE' && item.relativePath === path && item.readback === 'VERIFIED');
    if (matches.length !== 1) throw documentParseError('DOCUMENT_PARSE_ASSET_NOT_FOUND', 404);
    const bytes = await this.legacyStore.read(storageScope(run), matches[0]);
    await this.assertRead(documentVersionId, context);
    return { bytes, mediaType: matches[0].mediaType };
  }
  private async checkpointPdfPages(run: DocumentParseRow, original: { bytes: Uint8Array; byteLength: number },
    assertActive: () => Promise<void>, record: (artifact: DocumentOriginalArtifact) => Promise<void>, executionStartedAt: number,
    reusable: { bundle: DocumentOriginalBundle; scope: ReturnType<typeof storageScope> } | null,
    recovery: DocumentOriginalRecovery,
  ): Promise<{ status: 'STAGING'; coverage: DocumentOriginalStepResult['coverage'] } |
    { status: 'COMPLETE'; extraction: DocumentPdfExtraction; pageArtifacts: DocumentOriginalArtifact[] }> {
    const storage = storageScope(run);
    let pdfSession: DocumentPdfSession | undefined;
    try {
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
      let groupsProcessed = 0;
      // Continue only a bounded amount of ready local work. Every group is saved
      // before another begins; no PDF/bytes survive this request or lease scope.
      while (pageCount === null || pageStart < pageCount) {
        await assertActive();
        const path = `original/pages-${pageStart}.json`;
        // Recover a lost upload/progress response at exactly the next path before extracting again.
        let recovered = await this.store.recover(storage, 'MANIFEST', path);
        const recoveredPage = await recovery.read('MANIFEST', path);
        if (recovered && recoveredPage && !Buffer.from(recovered.bytes).equals(Buffer.from(recoveredPage)))
          throw documentParseError('DOCUMENT_PARSE_RECOVERY_COPY_MISMATCH');
        if (!recovered && recoveredPage) {
          const bytes = new Uint8Array(recoveredPage);
          assertPageChunk(JSON.parse(Buffer.from(bytes).toString('utf8')), pageStart, pageCount);
          recovered = { bytes, artifact: await this.store.save(storage, 'MANIFEST', bytes, record, path) };
        }
        const reusablePage = reusable?.bundle.rawPdfArtifacts.find(item => item.relativePath === path);
        if (!recovered && reusable && reusablePage) {
          const bytes = new Uint8Array(await this.store.read(reusable.scope, reusablePage));
          recovered = { bytes, artifact: await this.store.save(storage, 'MANIFEST', bytes, record, path) };
        }
        if (!recovered && !pdfSession) pdfSession = await openDocumentPdfSession({ bytes: original.bytes, assertActive });
        const chunk: DocumentPdfExtraction = recovered
          ? JSON.parse(Buffer.from(recovered.bytes).toString('utf8'))
          : await pdfSession!.extract({ pageStart, pageCount: PAGE_GROUP_SIZE });
        assertPageChunk(chunk, pageStart, pageCount);
        const artifact = recovered ? recovered.artifact
          : await this.store.save(storage, 'MANIFEST', Buffer.from(JSON.stringify(chunk)), record, path);
        if (recovered) await record(artifact);
        currentPages.set(pageStart, chunk); pageArtifacts.push(artifact);
        pageCount = chunk.pageCount; pageStart += chunk.pages.length;
        groupsProcessed += 1;
        if (groupsProcessed >= MAX_PAGE_GROUPS_PER_STEP || original.byteLength > MAX_CONTINUATION_SOURCE_BYTES ||
            performance.now() - executionStartedAt >= STEP_CONTINUATION_BUDGET_MS) break;
      }
      // Drop the decoder before final assembly loads the remaining saved groups.
      if (pdfSession) { await pdfSession.destroy(); pdfSession = undefined; }
      if (pageStart < pageCount!) return { status: 'STAGING', coverage: {
        knownPageCount: pageCount,
        readPageIndexes: Array.from({ length: pageStart }, (_, index) => index),
        unresolvedRanges: [
          { reason: 'UNREAD', unitIds: [], pageIndexes: Array.from({ length: pageCount! - pageStart }, (_, index) => pageStart + index),
            message: 'These pages have not been extracted yet.' },
          { reason: 'STRUCTURE_UNCERTAIN', unitIds: [], pageIndexes: Array.from({ length: pageStart }, (_, index) => index),
            message: 'Page text is checkpointed; full document structure and figure coverage have not been assembled.' },
        ],
      } };
      // One final assembly reuses this tick's groups and loads each older group once.
      const pages: DocumentPdfExtraction['pages'] = [];
      for (const artifact of pageArtifacts) {
        await assertActive();
        const start = pageArtifactStart(artifact);
        const chunk = currentPages.get(start) ?? JSON.parse(Buffer.from(await this.store.read(storage, artifact)).toString('utf8')) as DocumentPdfExtraction;
        assertPageChunk(chunk, pages.length, pageCount);
        pages.push(...chunk.pages);
      }
      return { status: 'COMPLETE', extraction: { pageCount: pageCount!, pages }, pageArtifacts };
    } finally { await pdfSession?.destroy(); }
  }

  private async assertLocalCandidateRead(run: DocumentParseRow, context: ReadScope): Promise<void> {
    if (!this.authorizer.assertCanReadLocalCandidate)
      throw documentParseError('DOCUMENT_LOCAL_MINERU_AUTHORIZATION_UNAVAILABLE', 503);
    await this.authorizer.assertCanReadLocalCandidate({ ...context, documentVersionId: run.documentVersionId, parseRunId: run.parseRunId });
  }

  private async executeLocalImport(run: DocumentParseRow, context: ReadScope): Promise<void> {
    const scope = { ...context, documentVersionId: run.documentVersionId };
    const fence = await this.leases.claim(scope, run.parseRunId, `local-import:${randomUUID()}`, 120_000);
    if (!fence) return;
    try { await this.executeStep(run.parseRunId, scope, fence); }
    finally {
      try { await this.leases.release(scope, fence); }
      catch { this.logger.warn(`Document import ${run.parseRunId} lease release failed; lease expiry remains authoritative.`); }
    }
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
  const local = input.mode === 'LOCAL_MINERU_IMPORT';
  const keys = local ? ['requestId', 'expectedPublishedRevision', 'mode', 'selection'] : ['requestId', 'expectedPublishedRevision'];
  if (Object.keys(input).some(key => !keys.includes(key)) ||
      typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId) ||
      !Number.isSafeInteger(input.expectedPublishedRevision) || Number(input.expectedPublishedRevision) < 0) {
    throw documentParseError('DOCUMENT_PARSE_INPUT_INVALID', 400);
  }
  try { documentParseRecoveryPredecessor(input.requestId); }
  catch { throw documentParseError('DOCUMENT_PARSE_RECOVERY_REQUEST_INVALID', 400); }
  if (local) {
    const selection = input.selection;
    if (!selection || typeof selection !== 'object' || Array.isArray(selection) ||
        Object.keys(selection).some(key => !['bucketId', 'filePath'].includes(key))) throw documentParseError('DOCUMENT_PARSE_INPUT_INVALID', 400);
    const item = selection as Record<string, unknown>;
    if (typeof item.bucketId !== 'string' || !item.bucketId.trim() || typeof item.filePath !== 'string' || !item.filePath.trim())
      throw documentParseError('DOCUMENT_PARSE_INPUT_INVALID', 400);
    return { requestId: input.requestId, expectedPublishedRevision: Number(input.expectedPublishedRevision), mode: 'LOCAL_MINERU_IMPORT',
      selection: { bucketId: item.bucketId.trim(), filePath: item.filePath.trim() } };
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
