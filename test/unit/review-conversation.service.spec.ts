import { ReviewConversationService } from '../../server/modules/review-persistence/review-conversation.service';
import { fixedModelSettings } from '../support/fixed-model-settings';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import * as executorScope from '../../server/modules/canonical-host/configured-development-service-scope.authorization';
import * as executorPolicy from '../../server/modules/canonical-host/canonical-host-executor-policy';

const actor = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'actor-1' },
  tenantId: 'tenant-1',
  sessionProvenance: 'SERVER_OPAQUE_SESSION',
};
const session = {
  actor,
  oauthSession: { actor, session: { id: 'session-1' } },
};
const grant = {
  allowed: true,
  action: 'RECORD_ENGINEER_REVIEW',
  workItemId: 'WI-1',
  workItemRevision: 7,
  tenantId: 'tenant-1',
  actorUserId: 'actor-1',
  ownerFact: { isOwner: true, ownerUserId: 'actor-1' },
};
const conversation = {
  reviewConversationId: 'RC-1',
  tenantId: 'tenant-1',
  actorId: 'actor-1',
  workItemId: 'WI-1',
  openClawAgentId: 'wiselink-engineering',
  openClawSessionKey: 'review:tenant-1:actor-1:WI-1:RC-1',
  startedAtRevision: 6,
  lastSyncedRevision: 7,
  status: 'ACTIVE',
  createdAt: new Date('2026-08-26T01:00:00.000Z'),
  lastActiveAt: new Date('2026-08-26T01:01:00.000Z'),
  closedAt: null,
};
const turn = {
  reviewTurnId: 'RT-1',
  reviewConversationId: 'RC-1',
  engineerSuppliedInputId: 'ESI-1',
  turnNo: 1,
  requestId: 'request-1',
  inputRevision: 7,
  userMessage: 'Engineer supplied context',
  inputType: 'ENGINEER_TEXT',
  adoptionStatus: 'CANDIDATE_UNADOPTED',
  candidateText: 'Engineer supplied context',
  attachmentBindings: [],
  assistantCandidate: null,
  createdAt: new Date('2026-08-26T01:02:00.000Z'),
};

describe('ReviewConversationService session and ACL boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads and records B-owned review text on A work without OAuth or a model dispatch', async () => {
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockReturnValue({
      actor, oauthSession: null,
    });
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => ({
      ...grant,
      action,
      ownerFact: { isOwner: false, ownerUserId: 'actor-A' },
    }));
    setup.conversations.loadCurrent.mockResolvedValue({
      conversation, turns: [],
    });
    const current = await setup.service.current('WI-1', {} as never);
    expect(current.conversation?.automaticExecutionAvailable).toBe(false);
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn, replayed: false,
    });
    await setup.service.appendTextTurn(
      'WI-1', 'RC-1',
      { requestId: 'native-text', userMessage: '仅记录内部复核意见' },
      {} as never,
    );
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        ailySessionId: undefined,
        executionRequested: false,
        conversation,
      }),
    );
  });

  it('requires separate external delegation before native review generation or attachment', async () => {
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockReturnValue({
      actor, oauthSession: null,
    });
    setup.objectAccess.freshRead.mockResolvedValue({
      ...grant,
      ownerFact: { isOwner: false, ownerUserId: 'actor-A' },
    });
    await expect(setup.service.appendTextTurn(
      'WI-1', 'RC-1',
      { requestId: 'native-auto', userMessage: '生成', executionMode: 'AUTOMATIC' },
      {} as never,
    )).rejects.toMatchObject({ code: 'REVIEW_EXTERNAL_DELEGATION_REQUIRED' });
    expect(setup.conversations.loadById).not.toHaveBeenCalled();
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    await expect(setup.service.appendTextTurn(
      'WI-1', 'RC-1',
      {
        requestId: 'native-attachment', userMessage: '读取附件',
        attachmentSelection: {
          bucketId: 'default-bucket', filePath: 'private/report.pdf',
        },
      },
      {} as never,
    )).rejects.toMatchObject({ code: 'REVIEW_EXTERNAL_DELEGATION_REQUIRED' });
    expect(setup.attachments.ingest).not.toHaveBeenCalled();
  });

  it('binds a new explicit update to the currently verified request session', async () => {
    jest
      .spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured')
      .mockReturnValue(true);
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn,
      replayed: false,
    });
    await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      {
        requestId: 'new-update',
        userMessage: '更新',
        purpose: 'UPDATE_ASSESSMENT',
        executionMode: 'AUTOMATIC',
        expectedInputRevision: 7,
        includedDiscussionTurnIds: [],
        targetIssueKeys: ['FTD-26002-NATURE'],
      },
      {} as never,
    );
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        ailySessionId: 'session-1',
        purpose: 'UPDATE_ASSESSMENT',
        targetIssueKeys: ['FTD-26002-NATURE'],
      }),
    );
  });

  it('projects and admits an explicit native WorkItem update without borrowing an OAuth session', async () => {
    jest.spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured').mockReturnValue(true);
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockReturnValue({ actor, oauthSession: null });
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => ({ ...grant, action }));
    setup.conversations.loadCurrent.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.appendTextTurn.mockResolvedValue({ turn, replayed: false });

    const current = await setup.service.current('WI-1', {} as never);
    expect(current.conversation?.automaticExecutionAvailable).toBe(true);
    expect(current.conversation?.overallExecutionAvailable).toBe(false);
    expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
      actor, action: 'RECORD_ENGINEER_REVIEW', accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
    await setup.service.appendTextTurn('WI-1', 'RC-1', {
      requestId: 'native-update', userMessage: '修订保存的评估',
      purpose: 'UPDATE_ASSESSMENT', executionMode: 'AUTOMATIC',
      expectedInputRevision: 7, includedDiscussionTurnIds: [],
    }, {} as never);
    expect(setup.conversations.hasActiveOfficialActorMapping).toHaveBeenCalledWith({
      tenantId: 'tenant-1', actorId: 'actor-1',
    });
    expect(setup.sessions.withVerifiedReviewBrowserSql).toHaveBeenCalled();
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(expect.objectContaining({
      ailySessionId: undefined, purpose: 'UPDATE_ASSESSMENT', executionRequested: true,
    }));
  });

  it('does not derive native update capability from a READ grant when RECORD is denied', async () => {
    jest.spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured').mockReturnValue(true);
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockReturnValue({ actor, oauthSession: null });
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => action === 'READ_WORK_ITEM'
      ? { ...grant, action }
      : { allowed: false, code: 'RECORD_DENIED', statusCode: 403 });
    setup.conversations.loadCurrent.mockResolvedValue({ conversation, turns: [] });
    expect((await setup.service.current('WI-1', {} as never)).conversation
      ?.automaticExecutionAvailable).toBe(false);
    await expect(setup.service.appendTextTurn('WI-1', 'RC-1', {
      requestId: 'denied-update', userMessage: '修订', purpose: 'UPDATE_ASSESSMENT',
      executionMode: 'AUTOMATIC', expectedInputRevision: 7,
    }, {} as never)).rejects.toMatchObject({ code: 'RECORD_DENIED' });
    expect(setup.conversations.hasActiveOfficialActorMapping).not.toHaveBeenCalled();
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('fails closed without the current official mapping and excludes other no-OAuth purposes and scopes', async () => {
    jest.spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured').mockReturnValue(true);
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockReturnValue({ actor, oauthSession: null });
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => ({ ...grant, action }));
    setup.conversations.loadCurrent.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.hasActiveOfficialActorMapping.mockResolvedValue(false);
    expect((await setup.service.current('WI-1', {} as never)).conversation
      ?.automaticExecutionAvailable).toBe(false);
    const update = {
      requestId: 'native-boundary', userMessage: '修订', purpose: 'UPDATE_ASSESSMENT' as const,
      executionMode: 'AUTOMATIC' as const, expectedInputRevision: 7,
    };
    await expect(setup.service.appendTextTurn('WI-1', 'RC-1', update, {} as never))
      .rejects.toMatchObject({ code: 'REVIEW_EXTERNAL_DELEGATION_REQUIRED' });
    setup.conversations.hasActiveOfficialActorMapping.mockResolvedValue(true);
    for (const input of [
      { ...update, purpose: undefined },
      { ...update, purpose: 'CHAT' as const },
      { ...update, overallRequested: true },
      { ...update, reviewScope: { kind: 'ENGINEERING_MATTER' as const,
        matterId: 'MAT-1', expectedWorkingRevision: 1 } },
      { ...update, attachmentSelection: { bucketId: 'private', filePath: 'source.pdf' } },
    ])
      await expect(setup.service.appendTextTurn('WI-1', 'RC-1', input, {} as never))
        .rejects.toMatchObject({ code: 'REVIEW_EXTERNAL_DELEGATION_REQUIRED' });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
    expect(setup.attachments.ingest).not.toHaveBeenCalled();
  });

  it('retains successor completion and revision checks for each new native update', async () => {
    jest.spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured').mockReturnValue(false);
    jest.spyOn(executorScope, 'isOpenClawSuccessorReviewConfigured').mockReturnValue(true);
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockReturnValue({ actor, oauthSession: null });
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => ({ ...grant, action }));
    setup.conversations.loadCurrent.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    expect((await setup.service.current('WI-1', {} as never)).conversation
      ?.automaticExecutionAvailable).toBe(false);
    setup.workItems.hasReadableAutoProcessingCompletion.mockResolvedValue(true);
    expect((await setup.service.current('WI-1', {} as never)).conversation
      ?.automaticExecutionAvailable).toBe(true);
    await expect(setup.service.appendTextTurn('WI-1', 'RC-1', {
      requestId: 'stale-native-update', userMessage: '修订', purpose: 'UPDATE_ASSESSMENT',
      executionMode: 'AUTOMATIC', expectedInputRevision: 6,
    }, {} as never)).rejects.toMatchObject({ code: 'REVIEW_UPDATE_REVISION_STALE' });
    expect(setup.workItems.hasReadableAutoProcessingCompletion).toHaveBeenLastCalledWith({
      tenantId: 'tenant-1', actorUserId: 'actor-1', workItemId: 'WI-1', revision: 7,
    });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('rejects an outdated explicit update and foreign or unanswered discussion before writing', async () => {
    jest
      .spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured')
      .mockReturnValue(true);
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [{ ...turn, purpose: 'CHAT' }],
    });
    const update = {
      requestId: 'update-1',
      userMessage: '更新评估',
      purpose: 'UPDATE_ASSESSMENT' as const,
      executionMode: 'AUTOMATIC' as const,
      expectedInputRevision: 7,
      includedDiscussionTurnIds: ['RT-1'],
    };
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        { ...update, expectedInputRevision: 6 },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_UPDATE_REVISION_STALE' });
    await expect(
      setup.service.appendTextTurn('WI-1', 'RC-1', update, {} as never),
    ).rejects.toMatchObject({ code: 'REVIEW_UPDATE_DISCUSSION_INVALID' });
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        { ...update, includedDiscussionTurnIds: ['RT-FOREIGN'] },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_UPDATE_DISCUSSION_INVALID' });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it.each([undefined, 'miaoda/minimax-m3', 'miaoda/glm-5.3'])(
    'inherits the last turn model unless a new request explicitly overrides it: %s',
    async (modelRef) => {
      const setup = makeService();
      const prior = {
        ...turn,
        requestedModel: taskModelSelection('dli/gpt-5.6-sol'),
      };
      const next = {
        ...turn,
        reviewTurnId: 'RT-2',
        requestId: 'request-2',
        turnNo: 2,
      };
      setup.conversations.loadById
        .mockResolvedValueOnce({ conversation, turns: [prior] })
        .mockResolvedValueOnce({ conversation, turns: [prior, next] });
      setup.conversations.appendTextTurn.mockResolvedValue({
        turn: next,
        replayed: false,
      });
      const capture = jest.spyOn(setup.models, 'captureForWorkItem');
      await setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: next.requestId,
          userMessage: next.userMessage,
          ...(modelRef ? { modelRef } : {}),
        },
        {} as never,
      );
      expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedModel: expect.objectContaining({
            modelRef: modelRef ?? 'dli/gpt-5.6-sol',
            providerKind: modelRef?.startsWith('miaoda/')
              ? 'BUILT_IN'
              : 'CUSTOM',
          }),
        }),
      );
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it('preserves a replayed turn model even after later turns and rejects an explicit change on the same request', async () => {
    const setup = makeService();
    const original = {
      ...turn,
      requestedModel: taskModelSelection('dli/gpt-5.6-sol'),
    };
    const later = {
      ...turn,
      requestId: 'request-2',
      turnNo: 2,
      requestedModel: taskModelSelection('miaoda/minimax-m3'),
    };
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [original, later],
    });
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn: original,
      replayed: true,
    });
    const capture = jest.spyOn(setup.models, 'captureForWorkItem');
    await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      { requestId: original.requestId, userMessage: original.userMessage },
      {} as never,
    );
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(
      expect.objectContaining({ requestedModel: original.requestedModel }),
    );
    expect(capture).not.toHaveBeenCalled();
    setup.conversations.appendTextTurn.mockClear();
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: original.requestId,
          userMessage: original.userMessage,
          modelRef: 'miaoda/minimax-m3',
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_TURN_IDEMPOTENCY_CONFLICT' });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'projects configured automatic execution availability: %s',
    async (available) => {
      jest
        .spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured')
        .mockReturnValue(available);
      const setup = makeService();
      setup.objectAccess.freshRead.mockResolvedValue({
        ...grant,
        action: 'READ_WORK_ITEM',
      });
      setup.conversations.loadCurrent.mockResolvedValue({
        conversation,
        turns: [],
      });
      const result = await setup.service.current('WI-1', {} as never);
      expect(result.conversation?.automaticExecutionAvailable).toBe(available);
      expect(
        executorScope.isOpenClawAutomaticReviewConfigured,
      ).toHaveBeenCalledWith(conversation);
    },
  );

  it('reports unsupported automatic execution before saving input or attachments', async () => {
    jest
      .spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured')
      .mockReturnValue(false);
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-auto',
          userMessage: 'Continue analysis',
          executionMode: 'AUTOMATIC',
        },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_AUTOMATIC_EXECUTION_UNAVAILABLE',
      statusCode: 503,
    });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
    expect(setup.attachments.ingest).not.toHaveBeenCalled();
  });

  it('persists an explicit automatic request in the supported executor scope', async () => {
    jest
      .spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured')
      .mockReturnValue(true);
    const setup = makeService();
    setup.conversations.loadById
      .mockResolvedValueOnce({ conversation, turns: [] })
      .mockResolvedValueOnce({ conversation, turns: [turn] });
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn,
      replayed: false,
    });
    const result = await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      {
        requestId: 'request-1',
        userMessage: turn.userMessage,
        executionMode: 'AUTOMATIC',
      },
      {} as never,
    );
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        executionRequested: true,
      }),
    );
    expect(result.conversation.automaticExecutionAvailable).toBe(true);
  });

  it('shows dynamic execution only for the current owner readable completion receipt', async () => {
    jest.spyOn(executorPolicy, 'canonicalCodexWorkItemScope').mockReturnValue(null);
    jest
      .spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured')
      .mockReturnValue(false);
    jest
      .spyOn(executorScope, 'isOpenClawSuccessorReviewConfigured')
      .mockReturnValue(true);
    const setup = makeService();
    setup.conversations.createOrResume.mockResolvedValue({
      aggregate: { conversation, turns: [] },
      created: true,
    });
    expect(
      (await setup.service.createOrResume('WI-1', {} as never)).conversation
        .automaticExecutionAvailable,
    ).toBe(false);
    setup.workItems.hasReadableAutoProcessingCompletion.mockResolvedValue(true);
    expect(
      (await setup.service.createOrResume('WI-1', {} as never)).conversation
        .automaticExecutionAvailable,
    ).toBe(true);
    expect(
      setup.workItems.hasReadableAutoProcessingCompletion,
    ).toHaveBeenLastCalledWith({
      tenantId: 'tenant-1',
      actorUserId: 'actor-1',
      workItemId: 'WI-1',
      revision: 7,
    });
    expect(setup.workItems.readReadableAutoProcessingCompletion).not.toHaveBeenCalled();
  });

  it.each([null, 'intake-A'])('rejects CODEX availability and append for intake %s instead of B', async (requestId: string | null) => {
    jest.spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured').mockReturnValue(false);
    jest.spyOn(executorScope, 'isOpenClawSuccessorReviewConfigured').mockReturnValue(true);
    jest.spyOn(executorPolicy, 'canonicalCodexWorkItemScope').mockReturnValue({
      workItemId: 'WI-1', requestId: 'intake-B',
    });
    const setup = makeService();
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => ({ ...grant, action }));
    setup.conversations.loadCurrent.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.loadById.mockResolvedValue({ conversation, turns: [] });
    setup.workItems.hasReadableAutoProcessingCompletion.mockResolvedValue(true);
    setup.workItems.readReadableAutoProcessingCompletion.mockResolvedValue(
      requestId === null ? null : { requestId },
    );
    expect((await setup.service.current('WI-1', {} as never)).conversation
      ?.automaticExecutionAvailable).toBe(false);
    await expect(setup.service.appendTextTurn('WI-1', 'RC-1', {
      requestId: 'review-request', userMessage: 'Update the candidate',
      purpose: 'UPDATE_ASSESSMENT', executionMode: 'AUTOMATIC', expectedInputRevision: 7,
    }, {} as never)).rejects.toMatchObject({
      code: 'REVIEW_AUTOMATIC_EXECUTION_UNAVAILABLE', statusCode: 503,
    });
    expect(setup.workItems.readReadableAutoProcessingCompletion).toHaveBeenLastCalledWith({
      tenantId: 'tenant-1', actorUserId: 'actor-1', workItemId: 'WI-1', revision: 7,
    });
    expect(setup.workItems.hasReadableAutoProcessingCompletion).not.toHaveBeenCalled();
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
    expect(setup.attachments.ingest).not.toHaveBeenCalled();
  });

  it('permits CODEX availability and a new automatic turn for the exact readable intake', async () => {
    jest.spyOn(executorScope, 'isOpenClawAutomaticReviewConfigured').mockReturnValue(false);
    jest.spyOn(executorScope, 'isOpenClawSuccessorReviewConfigured').mockReturnValue(true);
    jest.spyOn(executorPolicy, 'canonicalCodexWorkItemScope').mockReturnValue({
      workItemId: 'WI-1', requestId: 'intake-B',
    });
    const setup = makeService();
    setup.objectAccess.freshRead.mockImplementation(async ({ action }) => ({ ...grant, action }));
    setup.conversations.loadCurrent.mockResolvedValue({ conversation, turns: [] });
    setup.conversations.loadById
      .mockResolvedValueOnce({ conversation, turns: [] })
      .mockResolvedValueOnce({ conversation, turns: [turn] });
    setup.conversations.appendTextTurn.mockResolvedValue({ turn, replayed: false });
    setup.workItems.readReadableAutoProcessingCompletion.mockResolvedValue({ requestId: 'intake-B' });
    expect((await setup.service.current('WI-1', {} as never)).conversation
      ?.automaticExecutionAvailable).toBe(true);
    await setup.service.appendTextTurn('WI-1', 'RC-1', {
      requestId: 'request-1', userMessage: turn.userMessage,
      purpose: 'UPDATE_ASSESSMENT', executionMode: 'AUTOMATIC', expectedInputRevision: 7,
    }, {} as never);
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(expect.objectContaining({
      executionRequested: true,
    }));
    expect(setup.workItems.readReadableAutoProcessingCompletion).toHaveBeenLastCalledWith({
      tenantId: 'tenant-1', actorUserId: 'actor-1', workItemId: 'WI-1', revision: 7,
    });
    expect(setup.workItems.hasReadableAutoProcessingCompletion).not.toHaveBeenCalled();
  });

  it('derives tenant, actor and revision only from session + fresh ACL', async () => {
    const setup = makeService();
    setup.conversations.createOrResume.mockResolvedValue({
      aggregate: { conversation, turns: [] },
      created: true,
    });
    const result = await setup.service.createOrResume('WI-1', {
      body: { actorId: 'forged', tenantId: 'forged' },
    } as never);
    expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'RECORD_ENGINEER_REVIEW',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
    expect(setup.conversations.createOrResume).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      workItemId: 'WI-1',
      currentRevision: 7,
    });
    expect(result.resumed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('actor-1');
    expect(JSON.stringify(result)).not.toContain('openClawSessionKey');
  });

  it('fails before repository access without an OAuth session', async () => {
    const setup = makeService();
    setup.sessions.nativeBrowserIdentity.mockImplementation(() => {
      throw Object.assign(new Error('NATIVE_BROWSER_IDENTITY_REQUIRED'), {
        code: 'NATIVE_BROWSER_IDENTITY_REQUIRED', statusCode: 401,
      });
    });
    await expect(
      setup.service.current('WI-1', {} as never),
    ).rejects.toMatchObject({
      code: 'NATIVE_BROWSER_IDENTITY_REQUIRED', statusCode: 401,
    });
    expect(setup.objectAccess.freshRead).not.toHaveBeenCalled();
    expect(setup.conversations.loadCurrent).not.toHaveBeenCalled();
  });

  it('propagates fresh WorkItem ACL denial without reading conversation data', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead.mockResolvedValue({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    await expect(
      setup.service.current('WI-other', {} as never),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(setup.conversations.loadCurrent).not.toHaveBeenCalled();
  });

  it('uses read permission only for current conversation lookup', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead.mockResolvedValue({
      ...grant,
      action: 'READ_WORK_ITEM',
    });
    setup.conversations.loadCurrent.mockResolvedValue(null);

    await setup.service.current('WI-1', {} as never);

    expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
  });

  it('exposes an active conversation as STALE_CONTEXT when WorkItem revision advanced', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead.mockResolvedValue({
      ...grant,
      action: 'READ_WORK_ITEM',
      workItemRevision: 8,
    });
    setup.conversations.loadCurrent.mockResolvedValue({
      conversation,
      turns: [turn],
    });

    const result = await setup.service.current('WI-1', {} as never);

    expect(result.conversation).toMatchObject({
      status: 'STALE_CONTEXT',
      lastSyncedRevision: 7,
      currentWorkItemRevision: 8,
      currentRevisionSynced: false,
    });
  });

  it.each(['append', 'close'] as const)(
    'stops denied %s before all review repository I/O',
    async (operation) => {
      const setup = makeService();
      setup.objectAccess.freshRead.mockResolvedValue({
        allowed: false,
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });

      const result =
        operation === 'append'
          ? setup.service.appendTextTurn(
              'WI-other',
              'RC-1',
              { requestId: 'request-1', userMessage: 'text' },
              {} as never,
            )
          : setup.service.close('WI-other', 'RC-1', {} as never);

      await expect(result).rejects.toMatchObject({
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });
      expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
        actor,
        action: 'RECORD_ENGINEER_REVIEW',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI-other' },
      });
      expect(setup.conversations.loadById).not.toHaveBeenCalled();
      expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
      expect(setup.conversations.close).not.toHaveBeenCalled();
    },
  );

  it('fails closed when an authorized WorkItem has another actor conversation', async () => {
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({
      conversation: { ...conversation, actorId: 'actor-2' },
      turns: [],
    });
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        { requestId: 'request-1', userMessage: 'text' },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_CONVERSATION_NOT_FOUND',
      statusCode: 404,
    });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('appends at the fresh WorkItem revision and returns idempotent replay state', async () => {
    const setup = makeService();
    setup.conversations.loadById
      .mockResolvedValueOnce({ conversation, turns: [] })
      .mockResolvedValueOnce({
        conversation: { ...conversation, lastActiveAt: turn.createdAt },
        turns: [turn],
      });
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn,
      replayed: true,
    });
    const result = await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      { requestId: 'request-1', userMessage: 'Engineer supplied context' },
      {} as never,
    );
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith({
      conversation,
      requestId: 'request-1',
      userMessage: 'Engineer supplied context',
      selectedEvaluationItemId: null,
      executionRequested: false,
      requestedModel: expect.objectContaining({
        modelRef: 'miaoda/minimax-m3',
      }),
      currentRevision: 7,
      attachmentBindings: [],
      reviewScope: null,
    });
    expect(setup.sessions.nativeBrowserIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    );
    expect(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    ).toBeLessThan(setup.conversations.loadById.mock.invocationCallOrder[0]);
    expect(result.replayed).toBe(true);
    expect(result.turn).toMatchObject({
      turnNo: 1,
      inputRevision: 7,
      engineerSuppliedInput: {
        inputType: 'ENGINEER_TEXT',
        adoptionStatus: 'CANDIDATE_UNADOPTED',
      },
    });
    expect(JSON.stringify(result)).not.toContain('openClawSessionKey');
  });

  it.each([false, true])(
    'persists and returns the turn focus (replayed=%s)',
    async (replayed) => {
      const setup = makeService();
      const selectedTurn = { ...turn, selectedEvaluationItemId: 'GOV-008' };
      setup.conversations.loadById
        .mockResolvedValueOnce({
          conversation,
          turns: replayed ? [selectedTurn] : [],
        })
        .mockResolvedValueOnce({ conversation, turns: [selectedTurn] });
      setup.conversations.appendTextTurn.mockResolvedValue({
        turn: selectedTurn,
        replayed,
      });

      const result = await setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-1',
          userMessage: turn.userMessage,
          selectedEvaluationItemId: 'GOV-008',
        },
        {} as never,
      );

      expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith(
        expect.objectContaining({ selectedEvaluationItemId: 'GOV-008' }),
      );
      expect(result.turn.selectedEvaluationItemId).toBe('GOV-008');
      expect(result.conversation.turns[0].selectedEvaluationItemId).toBe(
        'GOV-008',
      );
      expect(result.replayed).toBe(replayed);
    },
  );

  it('authorizes, ingests and publicly redacts an official-selection attachment', async () => {
    const setup = makeService();
    const attachment = {
      attachmentRef: 'ATTACHMENT-1',
      documentVersionId: 'DV-ATT-1',
      fileName: 'engineering-note.pdf',
      mediaType: 'application/pdf',
      byteLength: 321,
      selectionKey: 'default-bucket\nofficial-selection/engineering-note.pdf',
      parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact-internal-ref',
        sha256: 'a'.repeat(64),
        byteLength: 100,
      },
    };
    const attachedTurn = { ...turn, attachmentBindings: [attachment] };
    setup.objectAccess.freshRead
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({
        ...grant,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      })
      .mockResolvedValueOnce(grant);
    setup.conversations.loadById
      .mockResolvedValueOnce({ conversation, turns: [] })
      .mockResolvedValueOnce({ conversation, turns: [attachedTurn] });
    setup.attachments.ingest.mockResolvedValue(attachment);
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn: attachedTurn,
      replayed: false,
    });

    const result = await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      {
        requestId: 'request-1',
        userMessage: 'Engineer supplied context',
        attachmentSelection: {
          bucketId: 'default-bucket',
          filePath: 'official-selection/engineering-note.pdf',
        },
      },
      {} as never,
    );

    expect(setup.objectAccess.freshRead).toHaveBeenNthCalledWith(2, {
      actor,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
      expectedWorkItemRevision: 7,
    });
    expect(setup.attachments.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        conversation,
        session: session.oauthSession,
      }),
    );
    expect(result.turn.attachmentRefs).toEqual(['ATTACHMENT-1']);
    expect(JSON.stringify(result)).not.toContain('official-selection');
    expect(JSON.stringify(result)).not.toContain('artifact-internal-ref');
  });

  it('keeps ReviewTurn and EngineerSuppliedInput at zero writes when DM attachment ingestion fails', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({
        ...grant,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      });
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [],
    });
    setup.attachments.ingest.mockRejectedValue(
      Object.assign(new Error('Document identity is unresolved.'), {
        code: 'DOCUMENT_IDENTITY_UNRESOLVED',
      }),
    );

    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-attachment-failed',
          userMessage: 'Must not persist without an immutable version.',
          attachmentSelection: {
            bucketId: 'default-bucket',
            filePath: 'official-selection/engineering-note.pdf',
          },
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_IDENTITY_UNRESOLVED' });

    expect(setup.attachments.ingest).toHaveBeenCalledTimes(1);
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('keeps ReviewTurn and EngineerSuppliedInput at zero writes when post-ingest ACL reauthorization is denied', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({
        ...grant,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      })
      .mockResolvedValueOnce({
        allowed: false,
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [],
    });
    setup.attachments.ingest.mockResolvedValue({
      attachmentRef: 'ATTACHMENT-POST-ACL',
      documentVersionId: 'DV-POST-ACL',
      fileName: 'engineering-note.pdf',
      mediaType: 'application/pdf',
      byteLength: 321,
      selectionKey: 'default-bucket\nofficial-selection/engineering-note.pdf',
      parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact-internal-ref',
        sha256: 'a'.repeat(64),
        byteLength: 100,
      },
    });

    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-post-ingest-denied',
          userMessage: 'Must reauthorize before persistence.',
          attachmentSelection: {
            bucketId: 'default-bucket',
            filePath: 'official-selection/engineering-note.pdf',
          },
        },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });

    expect(setup.attachments.ingest).toHaveBeenCalledTimes(1);
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('rejects append after close and performs no turn write', async () => {
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({
      conversation: {
        ...conversation,
        status: 'CLOSED',
        closedAt: new Date('2026-08-26T01:03:00.000Z'),
      },
      turns: [turn],
    });
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        { requestId: 'request-2', userMessage: 'too late' },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_CONVERSATION_CLOSED',
      statusCode: 409,
    });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('closes against fresh ACL revision without changing WorkItem state', async () => {
    const setup = makeService();
    const closedConversation = {
      ...conversation,
      status: 'CLOSED',
      closedAt: new Date('2026-08-26T01:03:00.000Z'),
    };
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [turn],
    });
    setup.conversations.close.mockResolvedValue({
      aggregate: { conversation: closedConversation, turns: [turn] },
      alreadyClosed: false,
    });
    const result = await setup.service.close('WI-1', 'RC-1', {} as never);
    expect(setup.conversations.close).toHaveBeenCalledWith({
      conversation,
      currentRevision: 7,
    });
    expect(setup.sessions.nativeBrowserIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    );
    expect(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    ).toBeLessThan(setup.conversations.loadById.mock.invocationCallOrder[0]);
    expect(result.conversation.status).toBe('CLOSED');
    expect(result.conversation.currentWorkItemRevision).toBe(7);
  });
});

function makeService() {
  const sessions = {
    nativeBrowserIdentity: jest.fn().mockReturnValue(session),
    withVerifiedReviewBrowserSql: jest.fn((operation: () => Promise<unknown>) => operation()),
  };
  const objectAccess = { freshRead: jest.fn().mockResolvedValue(grant) };
  const conversations = {
    hasActiveOfficialActorMapping: jest.fn().mockResolvedValue(true),
    createOrResume: jest.fn(),
    loadCurrent: jest.fn(),
    loadById: jest.fn(),
    appendTextTurn: jest.fn(),
    close: jest.fn(),
  };
  const attachments = { ingest: jest.fn() };
  const dispatch = {
    executionProjection: jest.fn().mockResolvedValue(null),
    readExecution: jest.fn().mockResolvedValue(null),
  };
  const models = fixedModelSettings();
  const workItems = {
    hasReadableAutoProcessingCompletion: jest.fn().mockResolvedValue(false),
    readReadableAutoProcessingCompletion: jest.fn().mockResolvedValue(null),
  };
  return {
    service: new ReviewConversationService(
      sessions as never,
      objectAccess as never,
      conversations as never,
      attachments as never,
      dispatch as never,
      models,
      undefined,
      workItems as never,
    ),
    sessions,
    objectAccess,
    conversations,
    attachments,
    dispatch,
    models,
    workItems,
  };
}
