import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import { DialogueAssessmentService } from '../../server/modules/canonical-host/dialogue-assessment.service';
import { DialogueBrowserScope } from '../../server/modules/canonical-host/dialogue-browser-scope.service';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import type { ValidatedSession } from '../../server/modules/identity/session.store';

describe('dialogue assessment with the native browser session scope', () => {
  const threadRef = '11111111-1111-4111-8111-111111111111';
  const contributionRef = '22222222-2222-4222-8222-222222222222';
  const messageRef = '33333333-3333-4333-8333-333333333333';
  const requestRef = '44444444-4444-4444-8444-444444444444';
  const previousSandbox = process.env.SANDBOX_ID;
  const previousLocal = process.env.MIAODA_LOCAL_DEV;

  beforeAll(() => {
    process.env.SANDBOX_ID = 'dialogue-session-scope-test';
    delete process.env.MIAODA_LOCAL_DEV;
  });
  afterAll(() => {
    if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = previousSandbox;
    if (previousLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
    else process.env.MIAODA_LOCAL_DEV = previousLocal;
  });

  function fixture(token: string | null = 'opaque') {
    const request = {
      headers: token ? { cookie: `wl_session=${token}` } : {},
      body: { sessionId: 'forged', actorId: 'forged' },
      userContext: {
        userId: 'owner-A', tenantId: 'tenant-A', appId: 'app_17bzc551rsg',
        env: 'runtime', roles: [], isSystemAccount: false,
      },
    } as unknown as Request;
    const sqlService = new AsyncLocalStorage<boolean>();
    let revoked = false;
    const validated: ValidatedSession = {
      sessionId: 'session-A', revision: 1,
      expiresAt: new Date(Date.now() + 60_000),
      identity: {
        subjectMappingId: 'mapping-A', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        miaodaUserId: 'owner-A', tenantId: 'tenant-A',
        feishuUserId: null, feishuOpenId: 'open-A',
        namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'open-A', tenantKey: 'tenant-key' },
        verifiedAt: new Date().toISOString(),
      },
    };
    // Model identity table RLS: session validation succeeds before the service
    // SQL switch, while a second service-role read cannot see the same row.
    const store = { validate: jest.fn(async (value: string, database?: unknown) =>
      value === 'opaque' && !revoked && (database !== undefined || !sqlService.getStore())
        ? validated : null) };
    const middleware = { use: (scoped: Request, _response: unknown, next: () => void) =>
      sqlService.run(Boolean(scoped.userContext?.isSystemAccount), next) };
    const config = {
      applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime',
    };
    const sessions = new SessionResolver(store as never, config as never, middleware as never);
    const browser = new DialogueBrowserScope(sessions);
    const input = {
      requestId: 'normal-update', workItemId: 'WI-A',
      expectedWorkItemRevision: 5, expectedWorkingRef: 'work-2',
      collectionMode: 'ALL_PENDING', contributions: [], userMessage: '更新当前判断',
    };
    const dialogues = {
      read: jest.fn(async () => ({})),
      relevantContributions: jest.fn(async () => [{
        contribution_ref: contributionRef, revision: 1, message_ref: messageRef,
        selected_text: '保留原来的工程补充。', source_part: 'USER', kind: 'CLARIFICATION',
      }]),
      contributionContext: jest.fn(async () => [{
        message_ref: messageRef, user_text: '保留原来的工程补充。', origin: 'HOST',
        focus_json: '["WI-A"]', context_json: '{"contextWorkItemIds":["WI-A"]}',
      }]),
    };
    const context = {
      authorize: jest.fn(async () => []),
      current: jest.fn(async () => {
        expect(sqlService.getStore()).toBe(false);
        return [{ workItemRevision: 5, workingRef: 'work-2' }];
      }),
    };
    const assessments = {
      find: jest.fn(async () => null),
      create: jest.fn(async (_scope, _thread, _input, snapshot, text, conversationId) => {
        expect(sqlService.getStore()).toBe(true);
        return { request_ref: requestRef, input_json: JSON.stringify(snapshot),
          user_message: text, review_conversation_id: conversationId };
      }),
      findTurn: jest.fn(async () => null),
      bind: jest.fn(async () => { expect(sqlService.getStore()).toBe(true); }),
    };
    const reviews = {
      createOrResume: jest.fn(async () => {
        expect(sqlService.getStore()).toBe(false);
        return { conversation: { reviewConversationId: 'RC-A' } };
      }),
      appendTextTurn: jest.fn(async () => {
        expect(sqlService.getStore()).toBe(false);
        expect(sessions.nativeBrowserIdentity(request).oauthSession?.session.id).toBe('session-A');
        return { turn: { reviewTurnId: 'RT-A' }, replayed: false };
      }),
    };
    const service = new DialogueAssessmentService(sessions, dialogues as never,
      context as never, assessments as never, reviews as never);
    return { request, input, sessions, browser, service, store, validated, config, sqlService,
      dialogues, context, assessments, reviews, revoke: () => { revoked = true; } };
  }

  it('accepts a fresh ALL_PENDING request using the session verified before service SQL', async () => {
    const h = fixture();
    await expect(h.browser.run(h.request, () =>
      h.service.request(threadRef, h.input, h.request))).resolves.toEqual({
      requestRef, workItemId: 'WI-A', reviewConversationId: 'RC-A',
      reviewTurnId: 'RT-A', replayed: false,
    });
    expect(h.store.validate).toHaveBeenCalledTimes(1);
    expect(h.assessments.create).toHaveBeenCalledTimes(1);
    expect(h.assessments.create.mock.calls[0][0]).toEqual({ actorId: 'owner-A', tenantId: 'tenant-A' });
    expect(h.reviews.appendTextTurn).toHaveBeenCalledWith('WI-A', 'RC-A',
      expect.objectContaining({ requestId: `dialogue-${requestRef}`, executionMode: 'AUTOMATIC' }), h.request);
    expect(h.request.userContext?.isSystemAccount).toBe(false);
    expect(h.sqlService.getStore()).toBeUndefined();
  });

  it.each([null, 'unknown', 'expired'])('rejects session %s before any assessment or review write', async token => {
    const h = fixture(token);
    await expect(h.browser.run(h.request, () =>
      h.service.request(threadRef, h.input, h.request))).rejects.toMatchObject({
      message: 'IDENTITY_SESSION_REQUIRED', status: 401,
    });
    expect(h.dialogues.read).not.toHaveBeenCalled();
    expect(h.context.authorize).not.toHaveBeenCalled();
    expect(h.assessments.find).not.toHaveBeenCalled();
    expect(h.assessments.create).not.toHaveBeenCalled();
    expect(h.reviews.createOrResume).not.toHaveBeenCalled();
    expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
  });

  it.each(['userId', 'tenantId', 'appId'] as const)('rejects mismatched native %s before SQL scope or callbacks', async field => {
    const h = fixture();
    const request = { ...h.request,
      userContext: { ...h.request.userContext, [field]: 'other' },
    } as Request;
    const operation = jest.fn();
    await expect(h.browser.run(request, operation)).rejects.toThrow(
      field === 'appId' ? 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE' : 'DIALOGUE_BROWSER_IDENTITY_MISMATCH',
    );
    expect(operation).not.toHaveBeenCalled();
    expect(h.assessments.create).not.toHaveBeenCalled();
  });

  it('rejects an OAuth session for another application before caching it', async () => {
    const h = fixture();
    h.config.applicationScopeId = 'other-app';
    const operation = jest.fn();
    await expect(h.browser.run(h.request, operation)).rejects.toThrow('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
    expect(operation).not.toHaveBeenCalled();
    expect(() => h.sessions.nativeBrowserIdentity(h.request)).toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
  });

  it('isolates verified sessions for concurrent actors across awaits', async () => {
    const h = fixture();
    h.store.validate.mockImplementation(async (token: string) =>
      h.sqlService.getStore() ? null : {
        ...h.validated, sessionId: `session-${token}`,
        identity: { ...h.validated.identity, miaodaUserId: token },
      });
    await Promise.all(['owner-A', 'owner-B'].map(async actorId => {
      const request = { ...h.request, headers: { cookie: `wl_session=${actorId}` },
        userContext: { ...h.request.userContext, userId: actorId },
      } as Request;
      await h.browser.run(request, async () => {
        await Promise.resolve();
        expect((await h.sessions.resolve(request))?.session.id).toBe(`session-${actorId}`);
        expect(h.sessions.nativeBrowserIdentity(request).actor.canonicalSubject.id).toBe(actorId);
      });
    }));
    expect(h.store.validate).toHaveBeenCalledTimes(2);
  });

  it('never reuses the verified session for another request or after leaving the request scope', async () => {
    const h = fixture();
    await h.browser.run(h.request, async () => {
      expect((await h.sessions.resolve(h.request))?.session.id).toBe('session-A');
      expect(await h.sessions.resolve({ ...h.request } as Request)).toBeNull();
      h.revoke();
    });
    expect(await h.sessions.resolve(h.request)).toBeNull();
    expect(() => h.sessions.nativeBrowserIdentity(h.request)).toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
    expect(h.store.validate).toHaveBeenCalledTimes(3);
  });

  it('rechecks expiry when a nested caller resolves the same verified request', async () => {
    const h = fixture();
    await h.browser.run(h.request, async () => {
      expect((await h.sessions.resolve(h.request))?.session.id).toBe('session-A');
      await Promise.resolve();
      h.validated.expiresAt.setTime(Date.now() - 1);
      await expect(h.service.request(threadRef, h.input, h.request)).rejects.toThrow('IDENTITY_SESSION_REQUIRED');
    });
    expect(h.assessments.create).not.toHaveBeenCalled();
    expect(h.store.validate).toHaveBeenCalledTimes(1);
  });

  it('still revalidates revocation against an explicitly supplied commit transaction', async () => {
    const h = fixture();
    const transaction = { name: 'commit-transaction' };
    await h.browser.run(h.request, async () => {
      h.revoke();
      expect((await h.sessions.resolve(h.request))?.session.id).toBe('session-A');
      expect(await h.sessions.resolve(h.request, transaction as never)).toBeNull();
    });
    expect(h.store.validate).toHaveBeenCalledTimes(2);
    expect(h.store.validate).toHaveBeenLastCalledWith('opaque', transaction);
  });
});
