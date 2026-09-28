import { canAutomaticallyRecoverDocumentParse, documentParseRecoveryRequestId } from '@shared/document-parsing-recovery';
import type { DocumentRevisionReadingRequest } from '@shared/document-revision-reading.interface';
import { DocumentRevisionReadingService } from './document-revision-reading.service';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DocumentReadingRunRepository } from './document-reading-run.repository';
import { DocumentActivityRunRepository } from './document-activity-run.repository';
import { randomUUID } from 'node:crypto';
import { DocumentSourceProjectionService } from './document-source-projection.service';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { DocumentStepLeaseRepository } from '../document-management/src/hosted/nest/document-step-lease.repository';
import type { DocumentParseScope } from '../document-management/src/hosted/nest/document-parsing.repository';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { DocumentSemanticService } from './document-semantic.service';
import { DocumentReadingRuntimeService } from './document-reading-runtime.service';
import { DocumentTranslationRuntimeService } from './document-translation-runtime.service';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { MiaodaHostedDocumentCatalog } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { documentDeliveryRequestId } from './document-delivery-ref';
import { documentOriginalReadingCoverage } from '../document-management/src/hosted/nest/document-original-adapter';
import { selectDocumentSemanticSection } from '../document-management/src/hosted/nest/document-semantic-map';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';

@Injectable()
// CanonicalHostModule.forRoot dynamic registration.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentWorkRuntimeService {
  private readonly logger = new Logger(DocumentWorkRuntimeService.name);
  constructor(
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository,
    private readonly parsing: DocumentParsingHostedService,
    private readonly leases: DocumentStepLeaseRepository,
    private readonly reader: UnifiedReaderService,
    private readonly sourceProjection: DocumentSourceProjectionService,
    private readonly semantics: DocumentSemanticService,
    private readonly revisions: DocumentRevisionReadingService,
    private readonly deliveryWorkItems: MiaodaWorkItemRepository,
    private readonly deliveryCatalog: MiaodaHostedDocumentCatalog,
    private readonly readingRuntime: DocumentReadingRuntimeService,
    private readonly translationRuntime: DocumentTranslationRuntimeService,
    @Optional() private readonly activityRuns?: DocumentActivityRunRepository,
    @Optional() private readonly readingRuns?: DocumentReadingRunRepository,
  ) {}

  /** Admit only the exact persisted intake request after its original is published. */
  private async admitAutomaticWorkItemDelivery(input: {
    tenantId: string; actorUserId: string; workItemId: string;
    documentVersionId: string; parseRunId: string;
  }) {
    const intents = await this.deliveryWorkItems.readDocumentDeliveryIntents({
      tenantId: input.tenantId, documentVersionId: input.documentVersionId });
    const intent = intents.find((item) => item.workItemId === input.workItemId &&
      item.actorUserId === input.actorUserId);
    if (!intent || (!intent.delivery.reading && intent.delivery.translation !== 'ZH_FULL'))
      throw new Error('DOCUMENT_DELIVERY_SELECTION_NOT_FOUND');
    const context = { tenantId: input.tenantId, actorUserId: input.actorUserId,
      documentVersionId: input.documentVersionId, roles: [] as string[] };
    const loaded = await this.reader.readDocumentOriginal(
      input.documentVersionId, input.parseRunId, context);
    if (loaded.run.status !== 'PUBLISHED' ||
        loaded.original.binding.parseRunId !== input.parseRunId ||
        loaded.original.binding.documentVersionId !== input.documentVersionId ||
        loaded.original.binding.sourceArtifactId !== intent.sourceArtifactId ||
        loaded.original.binding.sourceSha256 !== intent.sourceFileSha256 ||
        loaded.original.binding.sourceByteLength !== intent.sourceByteLength)
      throw new Error('DOCUMENT_DELIVERY_EXACT_ORIGINAL_REQUIRED');
    const semantic = await this.semantics.ensure(context, loaded);
    const reading = intent.delivery.reading ? await this.readingRuntime.run({
      action: 'READING_BEGIN', documentVersionId: input.documentVersionId,
      deliveryRef: `work-item:${input.workItemId}`,
      parseRunId: input.parseRunId, semanticRevision: semantic.semanticRevision,
      requestId: documentDeliveryRequestId('reading', `work-item:${input.workItemId}`),
      expectedRevision: 0,
    }) : null;
    const translation = intent.delivery.translation === 'ZH_FULL'
      ? await this.translationRuntime.run({ action: 'START',
        deliveryRef: `work-item:${input.workItemId}`,
        documentVersionId: input.documentVersionId, parseRunId: input.parseRunId,
        requestId: documentDeliveryRequestId('translation', `work-item:${input.workItemId}`) }) : null;
    return { status: 'ADMITTED' as const, reading, translation };
  }

  /** C136 retries persisted WorkItem intent after original/JobAid completion. */
  async prepareAutomaticWorkItemDelivery(input: {
    workItemId: string; documentVersionId: string; actorUserId: string;
  }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const authorized = await this.authorization.authorizeDocumentWork({
      documentVersionId: input.documentVersionId,
      deliveryRef: `work-item:${input.workItemId}`, purpose: 'SOURCE' });
    if (authorized.documentVersionId !== input.documentVersionId ||
        authorized.actorUserId !== input.actorUserId)
      throw new Error('DOCUMENT_DELIVERY_SCOPE_MISMATCH');
    const scope = { tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
      documentVersionId: input.documentVersionId, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const state = await this.parsing.status(scope.documentVersionId, scope);
      const run = state.publishedRun ?? state.latestRun;
      if (!run || run.status !== 'PUBLISHED')
        return { status: 'ORIGINAL_PREPARING' as const, documentVersionId: scope.documentVersionId };
      return this.admitAutomaticWorkItemDelivery({
        ...input, tenantId: scope.tenantId, parseRunId: run.parseRunId });
    });
  }

  private async selectedDelivery(scope: { tenantId: string; actorUserId: string;
    documentVersionId: string }, deliveryRef?: string) {
    const [workItems, uploads] = await Promise.all([
      this.deliveryWorkItems.readDocumentDeliveryIntents(scope),
      this.deliveryCatalog.readDocumentUploadDeliveryIntents(scope),
    ]);
    const choices = [...workItems.filter((item) =>
      deliveryRef ? deliveryRef === `work-item:${item.workItemId}` : true),
      ...uploads.filter((item) =>
        deliveryRef ? deliveryRef === `acquisition:${item.acquisitionId}` : true)]
      .filter((item) => item.actorUserId === scope.actorUserId)
      .map((item) => item.delivery);
    if (!choices.length) {
      if (deliveryRef) throw new Error('DOCUMENT_DELIVERY_SELECTION_NOT_FOUND');
      return null;
    }
    return { reading: choices.some((item) => item.reading),
      translation: choices.some((item) => item.translation === 'ZH_FULL')
        ? 'ZH_FULL' as const : 'NONE' as const };
  }

  /** Resume the exact committed upload; repeated calls use stable Host request IDs. */
  async prepareAutomaticUpload(input: {
    acquisitionId: string; documentVersionId: string; actorUserId: string;
  }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const authorized = await this.authorization.authorizeDocumentWork({
      documentVersionId: input.documentVersionId,
      deliveryRef: `acquisition:${input.acquisitionId}`, purpose: 'SOURCE' });
    if (authorized.actorUserId !== input.actorUserId ||
        authorized.documentVersionId !== input.documentVersionId)
      throw new Error('DOCUMENT_UPLOAD_DELIVERY_SCOPE_MISMATCH');
    const scope = { tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
      documentVersionId: input.documentVersionId, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const intent = (await this.deliveryCatalog.readDocumentUploadDeliveryIntents(scope))
        .find((item) => item.acquisitionId === input.acquisitionId &&
          item.actorUserId === input.actorUserId);
      if (!intent || !await this.deliveryCatalog.readOwnedAcquisitionVersionBinding({
        ...scope, acquisitionId: input.acquisitionId }))
        throw new Error('DOCUMENT_UPLOAD_DELIVERY_SOURCE_DENIED');
      const state = await this.parsing.status(scope.documentVersionId, scope);
      let run = state.latestRun;
      if (!run) {
        run = await this.parsing.start(scope.documentVersionId, {
          requestId: `auto-upload-original-${input.acquisitionId}`,
          expectedPublishedRevision: 0,
        }, scope);
      } else if (canAutomaticallyRecoverDocumentParse(run)) {
        run = await this.parsing.start(scope.documentVersionId, {
          requestId: documentParseRecoveryRequestId(run.parseRunId),
          expectedPublishedRevision: state.publishedRun?.parseRevision ?? 0,
        }, scope);
      }
      if (run.status !== 'PUBLISHED') {
        if (run.status === 'FAILED' || run.errorCode || Date.parse(run.deadlineAt) <= Date.now())
          return { status: 'REQUIRES_ATTENTION' as const,
            documentVersionId: scope.documentVersionId, parseRunId: run.parseRunId,
            errorCode: run.errorCode ?? (run.status === 'FAILED'
              ? 'DOCUMENT_PARSE_FAILED' : 'DOCUMENT_PARSE_DEADLINE_EXCEEDED') };
        return { status: 'ORIGINAL_PREPARING' as const,
          documentVersionId: scope.documentVersionId, parseRunId: run.parseRunId };
      }
      const published = await this.parsing.inspectPublishedIdentity(
        scope.documentVersionId, run.parseRunId, scope);
      const source = await this.deliveryCatalog.readOriginalRegistryIdentity(
        scope.documentVersionId, scope.tenantId);
      if (!source || published.binding.sourceArtifactId !== source.version.sourceArtifactId ||
          published.binding.sourceSha256 !== source.source.sha256 ||
          published.binding.sourceByteLength !== source.source.byteLength)
        throw new Error('DOCUMENT_UPLOAD_DELIVERY_SOURCE_CHANGED');
      const loaded = await this.reader.readDocumentOriginal(
        scope.documentVersionId, run.parseRunId, scope);
      const semantic = await this.semantics.ensure(scope, loaded);
      if (intent.delivery.reading) await this.readingRuntime.run({
        action: 'READING_BEGIN', documentVersionId: scope.documentVersionId,
        deliveryRef: `acquisition:${input.acquisitionId}`,
        parseRunId: run.parseRunId, semanticRevision: semantic.semanticRevision,
        requestId: documentDeliveryRequestId('reading', `acquisition:${input.acquisitionId}`),
        expectedRevision: 0,
      });
      if (intent.delivery.translation === 'ZH_FULL') await this.translationRuntime.run({
        action: 'START', documentVersionId: scope.documentVersionId,
        deliveryRef: `acquisition:${input.acquisitionId}`,
        parseRunId: run.parseRunId,
        requestId: documentDeliveryRequestId('translation', `acquisition:${input.acquisitionId}`),
      });
      await this.deliveryCatalog.markDocumentUploadDeliveryAdmitted(input);
      return { status: 'ADMITTED' as const, documentVersionId: scope.documentVersionId,
        parseRunId: run.parseRunId };
    });
  }

  async readRevision(input: DocumentRevisionReadingRequest) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const before = await this.authorization.authorizeDocumentWork({ documentVersionId: input.before.documentVersionId,
      purpose: 'REVISION' });
    const after = await this.authorization.authorizeDocumentWork({ documentVersionId: input.after.documentVersionId,
      purpose: 'REVISION' });
    if (before.documentVersionId !== input.before.documentVersionId || after.documentVersionId !== input.after.documentVersionId ||
      before.tenantId !== after.tenantId || before.actorUserId !== after.actorUserId)
      throw new Error('DOCUMENT_REVISION_AUTHORIZATION_SCOPE_MISMATCH');
    return this.revisions.read(input, { tenantId: before.tenantId, actorUserId: before.actorUserId, roles: [] });
  }

  /** Bounded engineering input from one published original, never translation. */
  async readOriginal(input: { documentVersionId: string; parseRunId: string; deliveryRef?: string;
    offset?: number; limit?: number;
    semanticRevision?: number; sectionId?: string }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const authorized = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId,
      deliveryRef: input.deliveryRef, purpose: 'SOURCE' });
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error('DOCUMENT_ORIGINAL_PAGE_INVALID');
    const scope = { tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
      documentVersionId: authorized.documentVersionId, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const loaded = await this.reader.readDocumentOriginal(scope.documentVersionId, input.parseRunId, scope);
      const { original, structuredSource, run } = loaded;
      if (run.parseRunId !== input.parseRunId || original.binding.parseRunId !== input.parseRunId ||
          original.binding.documentVersionId !== scope.documentVersionId || !run.manifestArtifact ||
          run.manifestArtifact.relativePath !== 'original/manifest.json' || run.manifestArtifact.readback !== 'VERIFIED')
        throw new Error('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
      if (input.sectionId && input.semanticRevision === undefined)
        throw new Error('DOCUMENT_SEMANTIC_EXACT_REVISION_REQUIRED');
      const semanticMap = await this.semantics.read(scope, loaded, input.semanticRevision);
      const selection = input.sectionId && semanticMap
        ? selectDocumentSemanticSection(original, semanticMap, input.sectionId) : null;
      const selectedIds = selection ? new Set([...selection.unitIds, ...selection.contextUnitIds]) : null;
      const available = selectedIds ? structuredSource.units.filter(unit => selectedIds.has(unit.unitId)) : structuredSource.units;
      const units = available.slice(offset, offset + limit);
      // Keep unit-specific table/selector payloads intact; never truncate text.
      const refs = new Set<string>();
      const collectRefs = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(collectRefs); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'sourceRefIds' && Array.isArray(child)) {
            for (const ref of child) if (typeof ref === 'string') refs.add(ref);
          } else collectRefs(child);
        }
      };
      units.forEach(collectRefs);
      const coverage = documentOriginalReadingCoverage(original);
      return { binding: original.binding,
        semanticMap: semanticMap ? { ...semanticMap, unresolvedRanges: coverage.unresolvedRanges } : null, selection,
        artifact: { ref: `document-original://${encodeURIComponent(scope.documentVersionId)}/${encodeURIComponent(run.parseRunId)}`,
          sha256: run.manifestArtifact.sha256, byteLength: run.manifestArtifact.byteLength,
          mediaType: run.manifestArtifact.mediaType },
        units, sourceLocators: structuredSource.sourceLocators.filter(locator => refs.has(locator.sourceRefId)),
        locations: original.locations.filter(location => refs.has(location.sourceRefId)),
        coverage, findings: structuredSource.findings.filter(finding => finding.readingImpact !== 'DIAGNOSTIC'),
        producer: original.producer,
        totalUnits: available.length,
        nextOffset: offset + units.length < available.length ? offset + units.length : null };
    });
  }

  async run(input: { action: 'STATUS' | 'STEP' | 'CANCEL' | 'INDEX'; documentVersionId: string;
    deliveryRef?: string; parseRunId?: string }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const authorized = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId,
      deliveryRef: input.deliveryRef, purpose: input.action === 'CANCEL' ? 'CANCEL' : 'SOURCE' });
    const scope = { tenantId: authorized.tenantId, actorUserId: authorized.actorUserId,
      documentVersionId: authorized.documentVersionId, roles: [] as string[] };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      // Re-read normal source permission for every operation, including cancel.
      const state = await this.parsing.status(scope.documentVersionId, scope);
      if (input.action === 'STATUS') return { ...state,
        documentDelivery: await this.selectedDelivery(scope, input.deliveryRef),
        nextReadingRunRef: this.readingRuns ? await this.readingRuns.nextPending(scope,
          input.deliveryRef ? documentDeliveryRequestId('reading', input.deliveryRef) : undefined) : null,
        nextActivityRunRef: !input.deliveryRef && this.activityRuns
          ? await this.activityRuns.nextPending(scope) : null,
        nextSourceProjectionRunId: state.latestRun?.status === 'PUBLISHED' ? await this.sourceProjection.nextPendingRun(scope) : null };
      if (input.action === 'INDEX') {
        if (!input.parseRunId) throw new Error('DOCUMENT_ORIGINAL_RUN_REQUIRED');
        return this.sourceProjection.step(scope, input.parseRunId);
      }
      const run = state.latestRun;
      if (!run || run.parseRunId !== input.parseRunId) throw Object.assign(new Error('DOCUMENT_WORK_RUN_NOT_FOUND'), { statusCode: 404 });
      if (input.action === 'CANCEL') {
        await this.leases.cancel(scope, run.parseRunId);
        return this.parsing.status(scope.documentVersionId, scope);
      }
      if (!['RUNNING', 'STAGING'].includes(run.status)) return { status: run.status, parseRunId: run.parseRunId };
      return this.executeStep(scope, run.parseRunId);
    });
  }

  /** Only an already delegated queue item may prepare its exact original. */
  async prepareAutomaticOriginal(workItemId: string) {
    const authorized = await this.authorization.authorizeOpenClawWorkItem({ operation: 'BEGIN_DYNAMIC', workItemId });
    const lease = authorized.automaticWorkItemLease;
    if (!lease || authorized.workItemId !== workItemId || authorized.appId !== 'app_17bzc551rsg')
      throw new Error('DOCUMENT_AUTOMATIC_LEASE_REQUIRED');
    const scope: DocumentParseScope & { roles: string[] } = {
      tenantId: authorized.tenantId, actorUserId: lease.actorUserId,
      documentVersionId: lease.documentVersionId, roles: [],
      automaticWorkItem: { workItemId, requestId: lease.requestId, principalId: authorized.principalId,
        documentId: lease.documentId, sourceArtifactId: lease.sourceArtifactId,
        sourceFileSha256: lease.sourceFileSha256, sourceByteLength: lease.sourceByteLength,
        leaseGeneration: lease.leaseGeneration },
    };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const state = await this.parsing.status(scope.documentVersionId, scope);
      const identity = { documentVersionId: scope.documentVersionId };
      const ready = async (parseRunId: string) => {
        const published = await this.parsing.inspectPublishedIdentity(
          scope.documentVersionId, parseRunId, scope);
        if (published.binding.sourceArtifactId !== lease.sourceArtifactId ||
            published.binding.sourceSha256 !== lease.sourceFileSha256 ||
            published.binding.sourceByteLength !== lease.sourceByteLength)
          throw new Error('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
        return { ...identity, status: 'ORIGINAL_READY' as const, parseRunId };
      };
      if (state.documentVersionId !== scope.documentVersionId)
        throw new Error('DOCUMENT_ORIGINAL_EXACT_BINDING_MISMATCH');
      const run = state.latestRun;
      if (!run) {
        // A lost reservation response is recovered by the same durable request.
        const reserved = await this.parsing.start(scope.documentVersionId,
          { requestId: `auto-original-${lease.requestId}`, expectedPublishedRevision: 0 }, scope);
        return { ...identity, status: 'ORIGINAL_PREPARING', parseRunId: reserved.parseRunId, waitingForLocalWorker: reserved.waitingForLocalWorker };
      }
      if (run.status === 'PUBLISHED') {
        return ready(run.parseRunId);
      }
      if (canAutomaticallyRecoverDocumentParse(run)) {
        // One durable successor per interrupted attempt. The repository repeats
        // eligibility under its lock; a newly recorded quota error must stop here.
        const reserved = await this.parsing.start(scope.documentVersionId, {
          requestId: documentParseRecoveryRequestId(run.parseRunId),
          expectedPublishedRevision: state.publishedRun?.parseRevision ?? 0,
        }, scope);
        return { ...identity, status: 'ORIGINAL_PREPARING', parseRunId: reserved.parseRunId, waitingForLocalWorker: reserved.waitingForLocalWorker };
      }
      if (run.status === 'STAGING' && run.executionMode === 'LOCAL_MINERU_WORKER' &&
          run.errorCode === 'DOCUMENT_PARSE_FAILED' && !run.waitingForLocalWorker &&
          run.verifiedArtifacts > 0 && Date.parse(run.deadlineAt) > Date.now()) {
        // The worker candidate is durable. Reenter the same run once under a
        // fresh document lease; executeStep rechecks source and candidate bytes.
        const result = await this.executeStep(scope, run.parseRunId);
        if (result.status === 'PUBLISHED') return ready(run.parseRunId);
        return { ...identity, status: result.status === 'BUSY' ? 'BUSY' : 'ORIGINAL_PREPARING',
          parseRunId: run.parseRunId };
      }
      if (run.status === 'FAILED' || run.errorCode || Date.parse(run.deadlineAt) <= Date.now())
        return { ...identity, status: 'REQUIRES_ATTENTION', parseRunId: run.parseRunId,
          errorCode: run.errorCode ?? (run.status === 'FAILED' ? 'DOCUMENT_PARSE_FAILED' : 'DOCUMENT_PARSE_DEADLINE_EXCEEDED') };
      if (run.waitingForLocalWorker) return { ...identity, status: 'ORIGINAL_PREPARING', parseRunId: run.parseRunId, waitingForLocalWorker: true };
      const result = await this.executeStep(scope, run.parseRunId);
      if (result.status === 'PUBLISHED') return ready(run.parseRunId);
      return { ...identity, status: result.status === 'BUSY' ? 'BUSY' : 'ORIGINAL_PREPARING',
        parseRunId: run.parseRunId };
    });
  }

  private async executeStep(scope: DocumentParseScope & { roles: string[] }, parseRunId: string) {
      const fence = await this.leases.claim(scope, parseRunId, `document:${randomUUID()}`, 120_000);
      if (!fence) return { status: 'BUSY', parseRunId: parseRunId };
      let renewal: Promise<void> = Promise.resolve();
      let renewalFailed = false;
      const timer = setInterval(() => {
        renewal = renewal.then(async () => {
          if (!await this.leases.renew(scope, fence)) renewalFailed = true;
        }).catch(() => { renewalFailed = true; });
      }, 30_000);
      try {
        // The plugin execution is awaited. No database transaction spans the
        // external call; P locks and checks this fence in each persistence step.
        const result = await this.parsing.executeStep(parseRunId, scope, fence);
        if (renewalFailed && result.status !== 'PUBLISHED') throw new Error('DOCUMENT_STEP_RENEWAL_FAILED');
        return result;
      } finally {
        clearInterval(timer);
        await renewal;
        try { await this.leases.release(scope, fence); }
        catch { this.logger.warn(`Document step ${parseRunId} lease release failed; the recorded outcome is preserved and the lease expires normally.`); }
      }
  }
}
