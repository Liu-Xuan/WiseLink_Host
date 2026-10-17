import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { DialogueBrowserScope } from '../../server/modules/canonical-host/dialogue-browser-scope.service';
import { DialogueContextService } from '../../server/modules/canonical-host/dialogue-context.service';
import { DialogueService } from '../../server/modules/canonical-host/dialogue.service';
import type {
  DialogueGenerationContext,
  DialogueMessageRow,
  DialogueRepository,
  DialogueScope,
  DialogueThreadRow,
} from '../../server/modules/canonical-host/dialogue.repository';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

interface SqlScope {
  kind: 'BROWSER' | 'SERVICE';
  actorId: string;
}

// Real request scopes, dialogue consumers and saved-work reader; database and
// storage are port doubles. No SQL, HTTP, Native or model operation runs here.
describe('dialogue context after a saved JobAid', () => {
  const threadRef = '11111111-1111-4111-8111-111111111111';
  const ownerId = 'native-owner';
  const tenantId = '63849986';
  const originalSandbox = process.env.SANDBOX_ID;
  const originalLocal = process.env.MIAODA_LOCAL_DEV;

  beforeAll(() => {
    process.env.SANDBOX_ID = 'dialogue-postsave-unit';
    delete process.env.MIAODA_LOCAL_DEV;
  });

  afterAll(() => {
    if (originalSandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = originalSandbox;
    if (originalLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
    else process.env.MIAODA_LOCAL_DEV = originalLocal;
  });

  function harness(actorId = ownerId, actorTenant = tenantId) {
    const sqlScope: AsyncLocalStorage<SqlScope> = new AsyncLocalStorage();
    const request: Request = {
      headers: {},
      userContext: {
        userId: actorId, tenantId: Number(actorTenant),
        appId: 'app_17bzc551rsg', env: 'preview', roles: [],
      },
    } as unknown as Request;
    const middleware = {
      use: (scoped: Request, _response: unknown, next: () => void) =>
        sqlScope.run({
          kind: scoped.userContext?.isSystemAccount ? 'SERVICE' : 'BROWSER',
          actorId: scoped.userContext?.userId ?? '',
        }, next),
    };
    const sessions: SessionResolver = new SessionResolver(
      {} as never, {} as never, middleware as never,
    );
    jest.spyOn(sessions, 'resolve').mockResolvedValue(null);
    const browser: DialogueBrowserScope = new DialogueBrowserScope(sessions);
    const saved: JobAidWorkRevision = jobAidReadingFixture().current!;
    let current: JobAidWorkRevision | null = saved;
    let sourceAllowed: boolean = true;
    const observedReads: SqlScope[] = [];
    const snapshot = jest.fn(async () => ({
      execution: null, current, savedActivity: [], latestAttempt: null,
    }));
    const sources = { loadAuthorizationBinding: jest.fn(async () => ({
      documentVersionId: saved.documentVersionId,
    })) };
    const database = { execute: jest.fn(async () => {
      const active: SqlScope | undefined = sqlScope.getStore();
      if (active) observedReads.push(active);
      return [{ allowed: sourceAllowed && active?.kind === 'BROWSER' &&
        active.actorId === actorId }];
    }) };
    const jobAid: CanonicalJobAidProblemService = new CanonicalJobAidProblemService(
      { getTenantScopedByWorkItemId: jest.fn(async () => ({
        workItemId: saved.workItemId, revision: saved.basedOnWorkItemRevision + 1,
        source: { documentVersionId: saved.documentVersionId },
        integratedAssessment: { baseRules: {
          schemaVersion: 'wiselink.jobaid-problem-result.v2',
          workRevisionRef: saved.workRevisionRef,
        } },
      })) } as never,
      {} as never, {} as never,
      { authorize: jest.fn(async () => ({ allowed: true,
        action: 'READ_DOCUMENT_PARSING', permissionSnapshotVersion: 'current' })) } as never,
      { freshRead: jest.fn(async () => ({ permissionSnapshotVersion: 'current' })) } as never,
      {} as never, sources as never, {} as never, {} as never,
      { readBrowserSnapshot: snapshot } as never,
      undefined, undefined, undefined, database as never,
    );
    const thread: DialogueThreadRow = {
      thread_ref: threadRef, tenant_id: tenantId, actor_id: ownerId,
      revision: 1, focus_json: JSON.stringify([saved.workItemId]), request_json: '{}',
    };
    const messages: DialogueMessageRow[] = [];
    const assertScope = (scope: DialogueScope) => {
      expect(sqlScope.getStore()).toEqual({
        kind: scope.browserRead ? 'BROWSER' : 'SERVICE', actorId,
      });
      if (scope.actorId !== thread.actor_id || scope.tenantId !== thread.tenant_id)
        throw new NotFoundException('DIALOGUE_NOT_FOUND');
    };
    const append = jest.fn(async (
      scope: DialogueScope, value: Parameters<DialogueRepository['append']>[1],
    ) => {
      assertScope(scope);
      const message: DialogueMessageRow = {
        message_ref: '22222222-2222-4222-8222-222222222222',
        thread_ref: threadRef, request_key: value.requestKey,
        thread_revision: ++thread.revision, user_text: value.userText,
        origin: value.origin, origin_json: JSON.stringify(value.originDetails),
        focus_json: JSON.stringify(value.focusIds),
        context_json: JSON.stringify(value.context), purpose: value.purpose,
        executor: 'NONE', _created_at: new Date(), query_ref: null,
        query_status: null, answer_text: null, error_code: null,
        remote_session_id: null, query_session_id: null,
      };
      messages.push(message);
      return { message, replayed: false };
    });
    const repository = {
      read: jest.fn(async (scope: DialogueScope) => {
        assertScope(scope);
        return { thread, messages, contributions: [], nextMessageCursor: null };
      }),
      findReplay: jest.fn(async (_scope: DialogueScope, _ref: string, key: string) =>
        messages.find((message: DialogueMessageRow) => message.request_key === key) ?? null),
      relevantContributions: jest.fn(async (scope: DialogueScope) => {
        assertScope(scope);
        return [];
      }),
      append,
    };
    const context: DialogueContextService = new DialogueContextService(
      { freshRead: jest.fn(async (input: { action: string }) => ({
        allowed: true, action: input.action, tenantId: actorTenant, actorUserId: actorId,
        workItemId: saved.workItemId, documentVersionId: saved.documentVersionId,
        workItemRevision: saved.basedOnWorkItemRevision + 1,
      })) } as never,
      jobAid, repository as never,
    );
    const aily = {
      availability: jest.fn(async () => ({
        available: false, reason: 'USER_REAUTHORIZATION_REQUIRED',
      })),
      startMessage: jest.fn(),
    };
    const service: DialogueService = new DialogueService(
      sessions, repository as never, context, aily as never,
    );
    const input = {
      requestId: 'same-contribution', expectedThreadRevision: 1,
      userText: '本次未补入新的执行记录。', workItemIds: [saved.workItemId],
      purpose: 'CONTRIBUTION_ONLY', origin: 'HOST',
    };
    return { service, browser, sessions, request, saved, input, append,
      aily, snapshot, database, observedReads, messages, thread, context,
      removeCurrent: () => { current = null; },
      revokeSource: () => { sourceAllowed = false; } };
  }

  it('reads the saved W0 as the native browser and restores service scope before its one insert', async () => {
    const h = harness();
    const before = await h.browser.runRead(h.request, () =>
      h.service.currentContext(threadRef, h.saved.workItemId, h.request));
    const result = await h.browser.run(h.request, () =>
      h.service.append(threadRef, h.input, h.request));
    const frozen: DialogueGenerationContext = JSON.parse(h.messages[0].context_json);
    expect(before[0].workingRef).toBe(h.saved.workRevisionRef);
    expect(frozen.focus[0]).toMatchObject({ workingRef: h.saved.workRevisionRef,
      workingRevision: h.saved.workRevision,
      workItemRevision: h.saved.basedOnWorkItemRevision + 1 });
    expect(h.observedReads).toEqual([
      { kind: 'BROWSER', actorId: ownerId }, { kind: 'BROWSER', actorId: ownerId },
    ]);
    expect(h.append).toHaveBeenCalledTimes(1);
    expect(result.messages[0]).toMatchObject({ executor: 'NONE', response: null });
    expect(h.aily.startMessage).not.toHaveBeenCalled();
    h.database.execute.mockClear();
    await h.browser.run(h.request, () => h.service.append(threadRef, h.input, h.request));
    expect(h.database.execute).not.toHaveBeenCalled();
    expect(h.append).toHaveBeenCalledTimes(1);
  });

  it('preserves an empty current workspace instead of manufacturing a saved W0', async () => {
    const h = harness();
    h.removeCurrent();
    await h.browser.run(h.request, () => h.service.append(threadRef, h.input, h.request));
    const frozen: DialogueGenerationContext = JSON.parse(h.messages[0].context_json);
    expect(frozen.focus[0].workingRef).toBeNull();
    expect(h.database.execute).not.toHaveBeenCalled();
    expect(h.aily.startMessage).not.toHaveBeenCalled();
  });

  it('keeps a revoked saved evidence read unavailable before any message insert', async () => {
    const h = harness();
    h.revokeSource();
    await expect(h.browser.run(h.request, () =>
      h.service.append(threadRef, h.input, h.request))).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
    });
    expect(h.append).not.toHaveBeenCalled();
    expect(h.thread.revision).toBe(1);
    expect(h.messages).toEqual([]);
    expect(h.aily.startMessage).not.toHaveBeenCalled();
  });

  it.each([['another-user', tenantId], [ownerId, '63849987']])(
    'retains private thread isolation for actor %s and tenant %s', async (actorId: string, actorTenant: string) => {
      const h = harness(actorId, actorTenant);
      await expect(h.browser.run(h.request, () =>
        h.service.append(threadRef, h.input, h.request))).rejects.toThrow('DIALOGUE_NOT_FOUND');
      expect(h.snapshot).not.toHaveBeenCalled();
      expect(h.append).not.toHaveBeenCalled();
      expect(h.aily.startMessage).not.toHaveBeenCalled();
    },
  );
});
