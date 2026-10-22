import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  ContinueDocumentTranslationRequest, ContinueDocumentTranslationResponse,
  DocumentTranslationContinuationPreparation,
} from '@shared/document-translation-browser.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { isDocumentTranslationModel } from '../action-attempt/document-translation-model';
import { DocumentTranslationAttemptRepository } from '../action-attempt/document-translation-attempt.repository';
import { parseDocumentTranslationTaskEnvelope } from '../action-attempt/document-translation-task-envelope';
import { MiaodaHostedDocumentCatalog } from '../document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { SessionResolver } from '../identity/session-resolver.service';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import { CanonicalTranslationWorkspaceRepository } from './canonical-translation-workspace.repository';
import { documentDeliveryRequestId } from './document-delivery-ref';
import { DocumentTranslationRuntimeService } from './document-translation-runtime.service';
import { browserTranslationDecision, translationRequestBelongsToDelivery,
  type BrowserTranslationAttempt } from './document-translation-browser-policy';

export interface DocumentTranslationBrowserActor {
  tenantId: string;
  actorUserId: string;
  roles: string[];
  appId: string;
  env: string;
}

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationBrowserService {
  constructor(private readonly catalog: MiaodaHostedDocumentCatalog,
    private readonly reader: UnifiedReaderService, private readonly parsing: DocumentParsingHostedService,
    private readonly attempts: DocumentTranslationAttemptRepository,
    private readonly workspaces: CanonicalTranslationWorkspaceRepository,
    private readonly runtime: DocumentTranslationRuntimeService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly sessions: SessionResolver) {}

  async prepare(documentVersionId: string, parseRunId: string, actor: DocumentTranslationBrowserActor):
    Promise<DocumentTranslationContinuationPreparation> {
    return this.withBrowserDocument(documentVersionId, parseRunId, actor, async original => {
      const loaded = await this.load(documentVersionId, parseRunId, actor, original);
      const base = { documentVersionId, parseRunId, supportedScope: 'OWNED_UPLOAD_ZH_FULL' as const };
      if (!loaded) return { ...base, state: 'UNSUPPORTED', reason: 'OWN_UPLOAD_TRANSLATION_REQUIRED',
        attempt: null, action: null };
      const { row, task, snapshot, root } = loaded;
      const decision = browserTranslationDecision(row, task, snapshot, root);
      await loaded.assertAuthorized();
      return { ...base, ...decision, attempt: { attemptRef: row.operationRef!, status: row.status } };
    });
  }

  async continue(documentVersionId: string, input: ContinueDocumentTranslationRequest,
    actor: DocumentTranslationBrowserActor): Promise<ContinueDocumentTranslationResponse> {
    return this.withBrowserDocument(documentVersionId, input.parseRunId, actor, async original => {
      const loaded = await this.load(documentVersionId, input.parseRunId, actor, original, input.expectedAttemptRef);
      if (!loaded) throw new ForbiddenException('DOCUMENT_TRANSLATION_OWN_UPLOAD_REQUIRED');
      const { row, task, snapshot, root, scope, deliveryRef, assertAuthorized } = loaded;
      const receipt = await this.existingSuccessor(loaded, input);
      if (receipt) {
        await assertAuthorized();
        return { documentVersionId, parseRunId: input.parseRunId, predecessorAttemptRef: input.expectedAttemptRef,
          attemptRef: receipt.operationRef!, status: receipt.status, reused: true };
      }
      const latest = await this.attempts.latest(scope, root);
      if (!latest || latest.attemptId !== row.attemptId)
        throw new ConflictException('DOCUMENT_TRANSLATION_CONTINUATION_CHANGED');
      const decision = browserTranslationDecision(row, task, snapshot, root);
      if (decision.action !== input.action)
        throw new ConflictException(`DOCUMENT_TRANSLATION_${decision.reason}`);
      await assertAuthorized();
      const result = await this.runtime.continueForBrowser({ action: input.action, documentVersionId,
        parseRunId: input.parseRunId, attemptRef: row.operationRef!, deliveryRef }, scope, assertAuthorized);
      if (!('attemptRef' in result) || !result.attemptRef || result.attemptRef === row.operationRef)
        throw new ConflictException('DOCUMENT_TRANSLATION_RECONCILIATION_REQUIRED');
      await assertAuthorized();
      return { documentVersionId, parseRunId: input.parseRunId, predecessorAttemptRef: input.expectedAttemptRef,
        attemptRef: result.attemptRef, status: result.status, reused: false };
    });
  }

  private async withBrowserDocument<T>(documentVersionId: string, parseRunId: string,
    actor: DocumentTranslationBrowserActor,
    operation: (original: Awaited<ReturnType<UnifiedReaderService['readDocumentOriginal']>>) => Promise<T>): Promise<T> {
    if (!actor.tenantId || !actor.actorUserId || !actor.appId)
      throw new ForbiddenException('DOCUMENT_TRANSLATION_BROWSER_IDENTITY_REQUIRED');
    // Authorize source access with the native browser role before entering the
    // service-only delivery/attempt tables. The bridge retains the verified actor.
    const original = await this.sessions.withVerifiedNativeBrowserSql(() =>
      this.reader.readDocumentOriginal(documentVersionId, parseRunId, actor));
    const artifact = original.run.manifestArtifact;
    if (original.original.binding.documentVersionId !== documentVersionId ||
        original.original.binding.parseRunId !== parseRunId || artifact?.relativePath !== 'original/manifest.json' ||
        artifact.readback !== 'VERIFIED')
      throw new ConflictException('DOCUMENT_TRANSLATION_READING_BINDING_MISMATCH');
    return this.sessions.withVerifiedNativeBrowserServiceSql(() => operation(original));
  }

  private async load(documentVersionId: string, parseRunId: string, actor: DocumentTranslationBrowserActor,
    original: Awaited<ReturnType<UnifiedReaderService['readDocumentOriginal']>>, expectedAttemptRef?: string) {
    const artifact = original.run.manifestArtifact!;
    const scope = { tenantId: actor.tenantId, actorUserId: actor.actorUserId, documentVersionId };
    const intents = (await this.catalog.readDocumentUploadDeliveryIntents(scope))
      .filter(item => item.actorUserId === actor.actorUserId && item.documentVersionId === documentVersionId &&
        item.delivery.translation === 'ZH_FULL');
    const expected = expectedAttemptRef ? await this.attempts.readAttempt(scope, expectedAttemptRef) : null;
    if (expectedAttemptRef && !expected) return null;
    const candidates: Array<{ acquisitionId: string; root: string; row: BrowserTranslationAttempt }> = [];
    for (const intent of intents) {
      const root = documentDeliveryRequestId('translation', `acquisition:${intent.acquisitionId}`);
      const row = expected ?? await this.attempts.latest(scope, root);
      if (row && translationRequestBelongsToDelivery(row, root))
        candidates.push({ acquisitionId: intent.acquisitionId, root, row });
    }
    candidates.sort((a, b) => b.row.attemptNo - a.row.attemptNo);
    const selected = candidates[0];
    if (!selected) return null;
    const { row, root, acquisitionId } = selected;
    const deliveryRef = `acquisition:${acquisitionId}`;
    const assertAuthorized = async () => {
      const currentIntents = await this.catalog.readDocumentUploadDeliveryIntents(scope);
      if (!currentIntents.some(item => item.acquisitionId === acquisitionId && item.actorUserId === actor.actorUserId &&
          item.documentVersionId === documentVersionId && item.delivery.translation === 'ZH_FULL') ||
          !await this.catalog.readOwnedAcquisitionVersionBinding({ ...scope, acquisitionId }))
        throw new ForbiddenException('DOCUMENT_TRANSLATION_OWN_UPLOAD_REQUIRED');
      // Service RLS must not replace the requesting browser's current source ACL.
      const status = await this.sessions.withVerifiedNativeBrowserSql(() =>
        this.parsing.status(documentVersionId, actor));
      if (status.documentVersionId !== documentVersionId || status.publishedRun?.parseRunId !== parseRunId)
        throw new ConflictException('DOCUMENT_TRANSLATION_RECOVERY_SOURCE_CHANGED');
      if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
      const auth = await this.authorization.authorizeDocumentWork({ documentVersionId, deliveryRef, purpose: 'TRANSLATION' });
      if (auth.tenantId !== actor.tenantId || auth.actorUserId !== actor.actorUserId ||
          auth.documentVersionId !== documentVersionId)
        throw new ForbiddenException('DOCUMENT_TRANSLATION_BROWSER_SCOPE_MISMATCH');
    };
    await assertAuthorized();
    const task = parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '');
    if (row.actorUserId !== actor.actorUserId || row.tenantId !== actor.tenantId ||
        row.documentVersionId !== documentVersionId || row.subjectKind !== 'DOCUMENT_VERSION' ||
        row.workItemId !== null || row.actionType !== 'DOCUMENT_TRANSLATE' || row.requestOrigin !== 'HOST_DOCUMENT' ||
        row.producerRunId !== parseRunId || row.inputRevision !== task.parseRevision ||
        row.attemptId !== task.actionAttemptId || row.operationRef !== task.operationRef || row.taskInputHash !== task.inputHash ||
        task.tenantId !== actor.tenantId || task.documentVersionId !== documentVersionId || task.parseRunId !== parseRunId ||
        task.modelInput.documentProducer !== 'HOSTED_M3' || !isDocumentTranslationModel(readStoredExecutionModel(row.executionModelJson)) ||
        canonicalJson(task.modelInput.source.originalBinding) !== canonicalJson(original.original.binding) ||
        task.modelInput.source.parsedArtifact.sha256 !== artifact.sha256 ||
        task.modelInput.source.parsedArtifact.byteLength !== artifact.byteLength)
      throw new ConflictException('DOCUMENT_TRANSLATION_CONTINUATION_BINDING_MISMATCH');
    const snapshot = await this.workspaces.readSnapshot({ ...scope, workItemId: null, workspaceId: task.workspaceId });
    if (canonicalJson(snapshot.workspace.plan.source) !== canonicalJson(task.modelInput.source) ||
        snapshot.workspace.plan.planRevision !== task.modelInput.planRevision ||
        snapshot.workspace.plan.documentContext.revision !== task.modelInput.contextRevision ||
        snapshot.workspace.methodVersion !== task.modelInput.methodVersion)
      throw new ConflictException('DOCUMENT_TRANSLATION_RECOVERY_PLAN_CHANGED');
    return { row, task, snapshot, root, scope, deliveryRef, assertAuthorized };
  }

  /** Lost HTTP receipts reuse only a server-derived, exact direct successor. No START fallback. */
  private async existingSuccessor(loaded: NonNullable<Awaited<ReturnType<DocumentTranslationBrowserService['load']>>>,
    input: ContinueDocumentTranslationRequest): Promise<BrowserTranslationAttempt | null> {
    const { row, root, scope, task } = loaded;
    const suffix = { RESUME_KNOWN_FAILURE: `resume-${row.attemptNo + 1}`,
      RECOVER_KNOWN_FAILURE: 'known-failure', CONTINUE_PARTIAL: 'partial-repair', RECOVER_EXPIRED: 'expired-resume' }[input.action];
    const successor = await this.attempts.readRequest(scope, `${root}:${suffix}`);
    if (!successor) return null;
    const next = parseDocumentTranslationTaskEnvelope(successor.taskEnvelopeJson ?? '');
    const sameSource = next.tenantId === scope.tenantId && next.documentVersionId === scope.documentVersionId &&
      next.parseRunId === task.parseRunId && next.parseRevision === task.parseRevision && next.workspaceId === task.workspaceId &&
      next.modelInput.planRevision === task.modelInput.planRevision && next.modelInput.contextRevision === task.modelInput.contextRevision &&
      next.modelInput.methodVersion === task.modelInput.methodVersion &&
      canonicalJson(next.modelInput.source) === canonicalJson(task.modelInput.source);
    const lineage = input.action === 'RECOVER_EXPIRED' ? next.expiredRecovery : next.knownFailureRecovery;
    const exact = input.action === 'CONTINUE_PARTIAL'
      ? row.status === 'SUCCEEDED' && row.terminalReason === 'REMAINING_LIMITATIONS' &&
        next.idempotencyKey === `document-translation:${scope.documentVersionId}:${root}:partial-repair`
      : lineage?.predecessorAttemptId === row.attemptId && lineage.predecessorAttemptRef === row.operationRef &&
        (lineage.rootRequestId === root || (input.action === 'RECOVER_KNOWN_FAILURE' && lineage.rootRequestId === undefined)) && (input.action === 'RECOVER_EXPIRED' ||
          next.knownFailureRecovery?.kind === (input.action === 'RESUME_KNOWN_FAILURE' ? 'SAVED_KNOWN_FAILURE' : 'KNOWN_FAILURE'));
    if (!sameSource || !exact || successor.attemptNo !== row.attemptNo + 1 ||
        successor.actorUserId !== scope.actorUserId || successor.tenantId !== scope.tenantId ||
        successor.documentVersionId !== scope.documentVersionId || successor.subjectKind !== 'DOCUMENT_VERSION' ||
        successor.workItemId !== null || successor.actionType !== 'DOCUMENT_TRANSLATE' ||
        successor.requestOrigin !== 'HOST_DOCUMENT' || successor.taskInputHash !== next.inputHash ||
        successor.operationRef !== next.operationRef || successor.attemptId !== next.actionAttemptId)
      throw new ConflictException('DOCUMENT_TRANSLATION_CONTINUATION_CHANGED');
    return successor;
  }
}
