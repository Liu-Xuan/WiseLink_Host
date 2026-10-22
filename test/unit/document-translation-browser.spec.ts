import { DocumentTranslationBrowserService } from '../../server/modules/canonical-host/document-translation-browser.service';
import { DocumentTranslationBrowserController } from '../../server/modules/canonical-host/document-translation-browser.controller';
import { browserTranslationDecision } from '../../server/modules/canonical-host/document-translation-browser-policy';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';
import { sealDocumentTranslationTaskEnvelope } from '../../server/modules/action-attempt/document-translation-task-envelope';
import { browserTranslationFixture } from './fixtures/document-translation-browser.fixture';

function setup() {
  const f = browserTranslationFixture();
  const rows = [f.row];
  const catalog = { readDocumentUploadDeliveryIntents: jest.fn().mockResolvedValue([f.intent]),
    readOwnedAcquisitionVersionBinding: jest.fn().mockResolvedValue(true) };
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue(f.original) };
  const parsing = { status: jest.fn().mockResolvedValue({ documentVersionId: f.documentVersionId,
    publishedRun: { parseRunId: f.parseRunId } }) };
  const attempts = { latest: jest.fn(async () => rows[rows.length - 1]),
    readAttempt: jest.fn(async (_scope, ref) => rows.find(row => row.operationRef === ref) ?? null),
    readRequest: jest.fn(async (_scope, requestId) => rows.find(row => row.triggerRequestId === requestId) ?? null) };
  const workspaces = { readSnapshot: jest.fn().mockResolvedValue(f.snapshot) };
  const authorization = { authorizeDocumentWork: jest.fn().mockResolvedValue({ ...f.actor, documentVersionId: f.documentVersionId }) };
  const runtime = { continueForBrowser: jest.fn(async (_input, _scope, assertAuthorized) => {
    await assertAuthorized();
    const { inputHash: _hash, ...source } = f.task;
    const task = sealDocumentTranslationTaskEnvelope({ ...source, actionAttemptId: 'DTA-next', operationRef: 'DTQ-next',
      knownFailureRecovery: { kind: 'SAVED_KNOWN_FAILURE', predecessorAttemptId: f.row.attemptId,
        predecessorAttemptRef: f.row.operationRef!, rootRequestId: f.root }, idempotencyKey: 'saved-next' });
    const next = { ...f.row, attemptId: task.actionAttemptId, operationRef: task.operationRef, attemptNo: 2,
      triggerRequestId: `${f.root}:resume-2`, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash,
      status: 'QUEUED' };
    rows.push(next);
    f.snapshot.workspace.activeAttemptId = next.attemptId;
    return { attemptRef: next.operationRef, status: next.status };
  }) };
  const sessions = { withNativeBrowserIdentity: jest.fn(async (_request, operation) => operation({ oauthSession: null })),
    withVerifiedNativeBrowserSql: jest.fn(async operation => operation()),
    withVerifiedNativeBrowserServiceSql: jest.fn(async operation => operation()) };
  const service = new DocumentTranslationBrowserService(catalog as never, reader as never, parsing as never,
    attempts as never, workspaces as never, runtime as never, authorization as never, sessions as never);
  const controller = new DocumentTranslationBrowserController(service, sessions as never);
  const request = { userContext: { userId: f.actor.actorUserId, tenantId: f.actor.tenantId,
    roles: [], appId: f.actor.appId, env: f.actor.env } } as never;
  const input = { parseRunId: f.parseRunId, expectedAttemptRef: f.row.operationRef!, action: 'RESUME_KNOWN_FAILURE' as const };
  return { ...f, rows, catalog, reader, parsing, attempts, workspaces, authorization, runtime, service,
    controller, request, sessions, input };
}

describe('owned-upload browser translation continuation', () => {
  it('GET uses the real browser actor and exact source; previews saved-candidate continuation without writes', async () => {
    const f = setup();
    const result = await f.controller.prepare(f.documentVersionId, f.parseRunId, f.request);
    expect(result).toMatchObject({ state: 'READY', action: 'RESUME_KNOWN_FAILURE',
      supportedScope: 'OWNED_UPLOAD_ZH_FULL', attempt: { attemptRef: f.row.operationRef } });
    expect(f.reader.readDocumentOriginal).toHaveBeenCalledWith(f.documentVersionId, f.parseRunId, f.actor);
    expect(f.catalog.readOwnedAcquisitionVersionBinding).toHaveBeenCalledWith({
      tenantId: f.actor.tenantId, actorUserId: f.actor.actorUserId, documentVersionId: f.documentVersionId,
      acquisitionId: f.acquisitionId });
    expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
    expect(f.sessions.withVerifiedNativeBrowserSql).toHaveBeenCalled();
    expect(f.sessions.withVerifiedNativeBrowserServiceSql).toHaveBeenCalledTimes(1);
    expect(f.snapshot.workspace.activeAttemptId).toBe(f.row.attemptId);
  });

  it.each(['another-actor', 'no-translation', 'no-upload'])(
    'does not promote read access to continuation authority: %s', async (reason) => {
      const f = setup();
      f.catalog.readDocumentUploadDeliveryIntents.mockResolvedValue(reason === 'no-upload' ? [] : [{ ...f.intent,
        actorUserId: reason === 'another-actor' ? 'other' : f.actor.actorUserId,
        delivery: { reading: true, translation: reason === 'no-translation' ? 'NONE' : 'ZH_FULL' } }]);
      await expect(f.controller.prepare(f.documentVersionId, f.parseRunId, f.request)).resolves.toMatchObject({
        state: 'UNSUPPORTED', action: null, attempt: null });
      await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('OWN_UPLOAD_REQUIRED');
      expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
    });

  it.each(['actorUserId', 'tenantId', 'documentVersionId'])(
    'rejects an internal service scope that differs from the browser %s', async (field) => {
      const f = setup();
      f.authorization.authorizeDocumentWork.mockResolvedValue({ ...f.actor, documentVersionId: f.documentVersionId,
        [field]: 'other' });
      await expect(f.controller.prepare(f.documentVersionId, f.parseRunId, f.request)).rejects.toThrow('BROWSER_SCOPE_MISMATCH');
      await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('BROWSER_SCOPE_MISMATCH');
      expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
    });

  it('rechecks source, upload authorization and published parse before POST, preserving saved blocks on denial', async () => {
    const f = setup();
    await f.controller.prepare(f.documentVersionId, f.parseRunId, f.request);
    const before = canonicalJson(f.snapshot);
    f.catalog.readOwnedAcquisitionVersionBinding.mockResolvedValue(false);
    await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('OWN_UPLOAD_REQUIRED');
    f.catalog.readOwnedAcquisitionVersionBinding.mockResolvedValue(true);
    f.parsing.status.mockResolvedValue({ documentVersionId: f.documentVersionId, publishedRun: { parseRunId: 'PR-new' } });
    await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('SOURCE_CHANGED');
    expect(canonicalJson(f.snapshot)).toBe(before);
    expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
  });

  it('fails closed if ownership disappears at the final recheck', async () => {
    const f = setup();
    f.catalog.readOwnedAcquisitionVersionBinding.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('OWN_UPLOAD_REQUIRED');
    expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
  });

  it.each(['COMMITTING', 'RUNNING', 'QUEUED', 'CANCELLED'])(
    'does not start a new task for an original %s execution', async (status) => {
      const f = setup(); f.row.status = status;
      const result = await f.controller.prepare(f.documentVersionId, f.parseRunId, f.request);
      expect(result.action).toBeNull();
      await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow();
      expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
    });

  it.each(['REGISTERED', 'UNKNOWN'])(
    'preserves unresolved generation %s and never retries it', async (kind) => {
      const f = setup();
      if (kind === 'REGISTERED') f.failed.status = 'REGISTERED';
      else f.failed.error = { origin: 'UPSTREAM', code: 'OUTCOME_UNKNOWN', outcome: 'GENERATION_UNKNOWN', retryable: false };
      await expect(f.controller.prepare(f.documentVersionId, f.parseRunId, f.request)).resolves.toMatchObject({
        action: null, state: 'REQUIRES_RECONCILIATION', reason: 'GENERATION_OUTCOME_UNKNOWN' });
      await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('GENERATION_OUTCOME_UNKNOWN');
      expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
    });

  it('reuses the exact direct successor when a POST receipt is lost', async () => {
    const f = setup();
    const first = await f.controller.continue(f.documentVersionId, f.input, f.request);
    const second = await f.controller.continue(f.documentVersionId, f.input, f.request);
    expect(first).toMatchObject({ attemptRef: 'DTQ-next', predecessorAttemptRef: 'DTQ-test', status: 'QUEUED', reused: false });
    expect(second).toEqual({ ...first, reused: true });
    expect(f.runtime.continueForBrowser).toHaveBeenCalledTimes(1);
    expect(f.runtime.continueForBrowser.mock.calls[0][0]).toEqual({ action: 'RESUME_KNOWN_FAILURE',
      documentVersionId: f.documentVersionId, parseRunId: f.parseRunId, attemptRef: 'DTQ-test',
      deliveryRef: `acquisition:${f.acquisitionId}` });
    expect(f.snapshot.revisions).toEqual([f.revision]);
  });

  it('rejects wrong-source attempts and unrecognized predecessor refs', async () => {
    const f = setup();
    await expect(f.controller.continue(f.documentVersionId, { ...f.input, expectedAttemptRef: 'DTQ-other' }, f.request))
      .rejects.toThrow('OWN_UPLOAD_REQUIRED');
    f.row.producerRunId = 'other-parse';
    await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('BINDING_MISMATCH');
    expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
  });

  it.each([{ action: 'START' }, { actorUserId: 'other' }, { deliveryRef: 'acquisition:other' },
    { leaseToken: 'token' }, { executionModel: { modelRef: 'other' } }])('rejects caller-selected authority/worker input %j', async extra => {
    const f = setup();
    await expect(f.controller.continue(f.documentVersionId, { ...f.input, ...extra }, f.request))
      .rejects.toThrow('BROWSER_REQUEST_INVALID');
    expect(f.runtime.continueForBrowser).not.toHaveBeenCalled();
  });

  it('requires native browser identity before both GET and POST', async () => {
    const f = setup();
    f.sessions.withNativeBrowserIdentity.mockRejectedValue(new Error('NATIVE_BROWSER_IDENTITY_REQUIRED'));
    await expect(f.controller.prepare(f.documentVersionId, f.parseRunId, f.request)).rejects.toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
    await expect(f.controller.continue(f.documentVersionId, f.input, f.request)).rejects.toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
  });

  it('offers unclaimed expiry recovery only when no generation/output exists', () => {
    const f = setup();
    Object.assign(f.row, { errorCode: 'DOCUMENT_TRANSLATION_DEADLINE_EXPIRED', claimCount: 0, startedAt: null });
    f.snapshot.workspace.generationRequests = []; f.snapshot.revisions = [];
    for (const coordinator of [null, 'DTA-older-terminal', f.row.attemptId]) {
      f.snapshot.workspace.activeAttemptId = coordinator;
      expect(browserTranslationDecision(f.row, f.task, f.snapshot, f.root)).toMatchObject({ action: 'RECOVER_EXPIRED' });
    }
    f.row.claimCount = 1;
    expect(browserTranslationDecision(f.row, f.task, f.snapshot, f.root).action).toBeNull();
  });
});
