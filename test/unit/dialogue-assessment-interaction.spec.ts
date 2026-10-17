import 'reflect-metadata';
import type { Request } from 'express';
import { DialogueAssessmentService } from '../../server/modules/canonical-host/dialogue-assessment.service';
import { canonicalJson } from '../../server/modules/action-attempt/action-attempt-envelope';

describe('explicit dialogue assessment submission', () => {
  const threadRef = '11111111-1111-4111-8111-111111111111';
  const contributionRef = '22222222-2222-4222-8222-222222222222';
  const messageRef = '33333333-3333-4333-8333-333333333333';
  const request = {} as Request;
  const input = {
    requestId: 'update',
    workItemId: 'WI-A',
    expectedWorkItemRevision: 7,
    expectedWorkingRef: 'work-4',
    contributions: [{ contributionRef, expectedRevision: 1 }],
    userMessage: '重新判断这个前提',
  };
  function harness(browserScope: 'LEGACY' | 'NATIVE' = 'LEGACY') {
    // Unit port double only: model the existing bridge contract without
    // constructing a Hosted identity, SQL middleware, or request ALS.
    let activeSqlScope: typeof browserScope | null = null;
    const reviewSqlScopes: string[] = [];
    const contextSqlScopes: string[] = [];
    const runBrowserSql = async (run: () => Promise<unknown>) => {
      const previous = activeSqlScope;
      activeSqlScope = browserScope;
      try {
        return await run();
      } finally {
        activeSqlScope = previous;
      }
    };
    const withVerifiedBrowserSql = jest.fn(
      async (run: () => Promise<unknown>) => {
        if (browserScope !== 'LEGACY')
          throw new Error('OFFICIAL_OAUTH_SESSION_REQUIRED');
        return runBrowserSql(run);
      },
    );
    const withVerifiedReviewBrowserSql = jest.fn(
      async (run: () => Promise<unknown>) =>
        browserScope === 'NATIVE'
          ? runBrowserSql(run)
          : withVerifiedBrowserSql(run),
    );
    const recordReviewSql = (operation: string) => {
      if (activeSqlScope !== browserScope)
        throw new Error('UNIT_REVIEW_BROWSER_SQL_REQUIRED');
      reviewSqlScopes.push(`${operation}:${activeSqlScope}`);
    };
    const sessions = {
      withVerifiedBrowserSql,
      withVerifiedReviewBrowserSql,
      resolve: jest.fn().mockResolvedValue({
        actor: { canonicalSubject: { id: 'actor' }, tenantId: 'tenant' },
      }),
    };
    const dialogues = {
      read: jest.fn().mockResolvedValue({}),
      relevantContributions: jest.fn().mockResolvedValue([
        {
          contribution_ref: contributionRef,
          revision: 1,
          message_ref: messageRef,
          selected_text: '是的',
          source_part: 'USER',
          kind: 'HYPOTHESIS',
        },
      ]),
      contributionContext: jest.fn().mockResolvedValue([
        {
          message_ref: 'prior',
          user_text: '适用吗',
          query_status: 'COMPLETED',
          answer_text: '这是 Win7 的前提吗？',
          focus_json: '["WI-B"]',
          context_json: '{"contextWorkItemIds":["WI-B"]}',
        },
        {
          message_ref: messageRef,
          user_text: '是的',
          origin: 'FEISHU_EXCERPT',
          focus_json: '["WI-A"]',
          context_json: '{"contextWorkItemIds":["WI-A","WI-B"]}',
        },
      ]),
    };
    const context = {
      authorize: jest.fn().mockResolvedValue([]),
      current: jest
        .fn()
        .mockImplementation(async () => {
          if (activeSqlScope !== browserScope)
            throw new Error('UNIT_CURRENT_BROWSER_SQL_REQUIRED');
          contextSqlScopes.push(browserScope);
          return [{ workItemRevision: 7, workingRef: 'work-4' }];
        }),
    };
    const assessments = {
      find: jest.fn().mockResolvedValue(null),
      create: jest.fn(
        async (_scope, _threadRef, body, snapshot, text, conversationId) => {
          expect(activeSqlScope).toBeNull();
          return {
            request_ref: '44444444-4444-4444-8444-444444444444',
            request_json: canonicalJson(body),
            input_json: JSON.stringify(snapshot),
            user_message: text,
            review_conversation_id: conversationId,
          };
        },
      ),
      findTurn: jest.fn().mockResolvedValue(null),
      bind: jest.fn(async () => {
        expect(activeSqlScope).toBeNull();
      }),
    };
    const reviews = {
      createOrResume: jest.fn().mockImplementation(async () => {
        recordReviewSql('createOrResume');
        return { conversation: { reviewConversationId: 'RC-A' } };
      }),
      appendTextTurn: jest.fn().mockImplementation(async () => {
        recordReviewSql('appendTextTurn');
        return { turn: { reviewTurnId: 'RT-A' }, replayed: false };
      }),
    };
    const service = new DialogueAssessmentService(
      sessions as never,
      dialogues as never,
      context as never,
      assessments as never,
      reviews as never,
    );
    return {
      service,
      sessions,
      dialogues,
      context,
      assessments,
      reviews,
      reviewSqlScopes,
      contextSqlScopes,
    };
  }

  function frozenRequest(h: ReturnType<typeof harness>) {
    const frozen = {
      request_ref: '44444444-4444-4444-8444-444444444444',
      request_json: canonicalJson(input),
      input_json: '{"contextWorkItemIds":["WI-A","WI-B"],"contributions":[]}',
      user_message: 'first exact selected input',
      review_conversation_id: 'RC-old',
    };
    h.assessments.find.mockResolvedValue(frozen);
    return frozen;
  }

  it('creates and dispatches a fresh request through the existing native browser bridge', async () => {
    const h = harness('NATIVE');
    await expect(h.service.request(threadRef, input, request)).resolves.toEqual(
      {
        requestRef: '44444444-4444-4444-8444-444444444444',
        workItemId: 'WI-A',
        reviewConversationId: 'RC-A',
        reviewTurnId: 'RT-A',
        replayed: false,
      },
    );
    expect(h.reviewSqlScopes).toEqual([
      'createOrResume:NATIVE',
      'appendTextTurn:NATIVE',
    ]);
    expect(h.contextSqlScopes).toEqual(['NATIVE']);
    expect(h.context.current).toHaveBeenCalledWith(
      expect.anything(), ['WI-A'], false, true,
    );
    expect(h.sessions.withVerifiedBrowserSql).not.toHaveBeenCalled();
    expect(h.reviews.createOrResume).toHaveBeenCalledWith('WI-A', request);
    expect(h.assessments.create.mock.calls[0].slice(0, 3)).toEqual([
      { actorId: 'actor', tenantId: 'tenant' },
      threadRef,
      input,
    ]);
    expect(h.reviews.appendTextTurn).toHaveBeenCalledWith(
      'WI-A',
      'RC-A',
      expect.objectContaining({
        requestId: 'dialogue-44444444-4444-4444-8444-444444444444',
        purpose: 'UPDATE_ASSESSMENT',
        expectedInputRevision: 7,
      }),
      request,
    );
    expect(h.assessments.bind).toHaveBeenCalledWith(
      { actorId: 'actor', tenantId: 'tenant' },
      expect.objectContaining({ review_conversation_id: 'RC-A' }),
      'RT-A',
    );
  });

  it('resumes a stored request with no turn through the native bridge using its original identity and input', async () => {
    const h = harness('NATIVE');
    const frozen = frozenRequest(h);
    await expect(
      h.service.request(threadRef, input, request),
    ).resolves.toMatchObject({
      reviewConversationId: 'RC-old',
      reviewTurnId: 'RT-A',
      replayed: true,
    });
    expect(h.reviewSqlScopes).toEqual(['appendTextTurn:NATIVE']);
    expect(h.sessions.withVerifiedBrowserSql).not.toHaveBeenCalled();
    expect(h.reviews.createOrResume).not.toHaveBeenCalled();
    expect(h.assessments.create).not.toHaveBeenCalled();
    expect(h.context.current).not.toHaveBeenCalled();
    expect(h.dialogues.relevantContributions).not.toHaveBeenCalled();
    expect(h.reviews.appendTextTurn).toHaveBeenCalledWith(
      'WI-A',
      'RC-old',
      expect.objectContaining({
        requestId: `dialogue-${frozen.request_ref}`,
        userMessage: frozen.user_message,
        expectedInputRevision: 7,
      }),
      request,
    );
    expect(h.assessments.bind).toHaveBeenCalledWith(
      { actorId: 'actor', tenantId: 'tenant' },
      frozen,
      'RT-A',
    );
  });

  it('rejects a missing opaque session before any read or review callback', async () => {
    const h = harness('NATIVE');
    h.sessions.resolve.mockResolvedValue(null);
    await expect(h.service.request(threadRef, input, request)).rejects.toThrow(
      'IDENTITY_SESSION_REQUIRED',
    );
    expect(h.dialogues.read).not.toHaveBeenCalled();
    expect(h.context.authorize).not.toHaveBeenCalled();
    expect(h.assessments.find).not.toHaveBeenCalled();
    expect(h.sessions.withVerifiedReviewBrowserSql).not.toHaveBeenCalled();
    expect(h.reviewSqlScopes).toEqual([]);
  });

  it.each(['fresh', 'stored'] as const)(
    'preserves the bridge rejection for a %s request without review writes or binding',
    async (kind) => {
      const h = harness('NATIVE');
      if (kind === 'stored') frozenRequest(h);
      const denial = new Error('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
      h.sessions.withVerifiedReviewBrowserSql.mockRejectedValue(denial);
      await expect(h.service.request(threadRef, input, request)).rejects.toBe(
        denial,
      );
      expect(h.reviews.createOrResume).not.toHaveBeenCalled();
      expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
      expect(h.assessments.create).not.toHaveBeenCalled();
      expect(h.assessments.bind).not.toHaveBeenCalled();
      expect(h.reviewSqlScopes).toEqual([]);
    },
  );

  it.each(['fresh', 'stored'] as const)(
    'rechecks inherited source access before bridging a %s request',
    async (kind) => {
      const h = harness('NATIVE');
      if (kind === 'stored') frozenRequest(h);
      const denial = new Error('OBJECT_ACCESS_DENIED');
      h.context.authorize
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(denial);
      await expect(h.service.request(threadRef, input, request)).rejects.toBe(
        denial,
      );
      expect(h.context.authorize).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        kind === 'fresh' ? ['WI-B', 'WI-A', 'WI-B'] : ['WI-A', 'WI-B'],
      );
      expect(h.sessions.withVerifiedReviewBrowserSql).toHaveBeenCalledTimes(
        kind === 'fresh' ? 1 : 0,
      );
      expect(h.reviews.createOrResume).not.toHaveBeenCalled();
      expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
      expect(h.assessments.bind).not.toHaveBeenCalled();
    },
  );

  it('recovers an existing native turn with fresh source access and no bridge or redispatch', async () => {
    const h = harness('NATIVE');
    const frozen = frozenRequest(h);
    h.assessments.findTurn.mockResolvedValue('RT-original');
    await expect(
      h.service.request(threadRef, input, request),
    ).resolves.toMatchObject({
      reviewConversationId: 'RC-old',
      reviewTurnId: 'RT-original',
      replayed: true,
    });
    expect(h.context.authorize).toHaveBeenNthCalledWith(2, expect.anything(), [
      'WI-A',
      'WI-B',
    ]);
    expect(h.assessments.bind).toHaveBeenCalledWith(
      { actorId: 'actor', tenantId: 'tenant' },
      frozen,
      'RT-original',
    );
    expect(h.sessions.withVerifiedReviewBrowserSql).not.toHaveBeenCalled();
    expect(h.sessions.withVerifiedBrowserSql).not.toHaveBeenCalled();
    expect(h.reviews.createOrResume).not.toHaveBeenCalled();
    expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
    expect(h.reviewSqlScopes).toEqual([]);
  });
  it('collects 21 pending contributions without truncation or expanding the explicit selection limit', async () => {
    const h = harness();
    const available = Array.from({ length: 21 }, (_, index) => ({
      contribution_ref: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
      revision: 1,
      message_ref: messageRef,
      selected_text: '补充原文'.repeat(500),
      source_part: 'USER',
      kind: 'CORRECTION',
    }));
    h.dialogues.relevantContributions.mockResolvedValue([
      ...available,
      {
        ...available[0],
        contribution_ref: contributionRef,
        consumed_working_ref: 'JAWR-saved',
      },
    ] as never);
    await h.service.request(
      threadRef,
      { ...input, contributions: [], collectionMode: 'ALL_PENDING' },
      request,
    );
    const snapshot = h.assessments.create.mock.calls[0][3];
    expect(snapshot.contributions).toHaveLength(21);
    expect(snapshot.contributions[20].selectedText).toBe(
      available[20].selected_text,
    );
    expect(snapshot.contextWorkItemIds).toEqual(['WI-A', 'WI-B']);
    expect(h.reviews.appendTextTurn.mock.calls[0][2].userMessage).toContain(
      '21',
    );
    expect(
      h.reviews.appendTextTurn.mock.calls[0][2].userMessage.length,
    ).toBeLessThan(20000);
    await expect(
      h.service.request(
        threadRef,
        {
          ...input,
          contributions: available.map((item) => ({
            contributionRef: item.contribution_ref,
            expectedRevision: 1,
          })),
        },
        request,
      ),
    ).rejects.toThrow('DIALOGUE_CONTRIBUTION_SELECTION_INVALID');
  });

  it('submits raw selected words with their preceding question and provenance to the actual review port', async () => {
    const h = harness();
    const result = await h.service.request(threadRef, input, request);
    const reviewInput = h.reviews.appendTextTurn.mock.calls[0][2];
    expect(reviewInput).toMatchObject({
      purpose: 'UPDATE_ASSESSMENT',
      executionMode: 'AUTOMATIC',
      expectedInputRevision: 7,
      includedDiscussionTurnIds: [],
    });
    expect(reviewInput.userMessage).toContain('是的');
    expect(reviewInput.userMessage).toContain('这是 Win7 的前提吗？');
    expect(reviewInput.userMessage).toContain('FEISHU_EXCERPT');
    expect(reviewInput.userMessage).toContain(contributionRef);
    expect(h.assessments.create.mock.calls[0][3].contextWorkItemIds).toEqual([
      'WI-A',
      'WI-B',
    ]);
    expect(result.reviewTurnId).toBe('RT-A');
    expect(h.sessions.withVerifiedBrowserSql).toHaveBeenCalledTimes(3);
  });
  it.each([
    { workItemRevision: 8, workingRef: 'work-4' },
    { workItemRevision: 7, workingRef: 'work-5' },
    { workItemRevision: 7, workingRef: null },
  ])(
    'rejects a changed assessment base before creating or dispatching',
    async (current) => {
      const h = harness();
      h.context.current.mockResolvedValue([current]);
      await expect(
        h.service.request(threadRef, input, request),
      ).rejects.toThrow('DIALOGUE_ASSESSMENT_BASE_CHANGED');
      expect(h.assessments.create).not.toHaveBeenCalled();
      expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
    },
  );
  it('keeps an empty ALL_PENDING request free of assessment writes and review dispatch', async () => {
    const h = harness('NATIVE');
    h.dialogues.relevantContributions.mockResolvedValue([]);
    await expect(h.service.request(threadRef, {
      ...input, contributions: [], collectionMode: 'ALL_PENDING',
    }, request)).rejects.toThrow('DIALOGUE_NO_PENDING_CONTRIBUTIONS');
    expect(h.contextSqlScopes).toEqual(['NATIVE']);
    expect(h.assessments.create).not.toHaveBeenCalled();
    expect(h.assessments.bind).not.toHaveBeenCalled();
    expect(h.reviews.createOrResume).not.toHaveBeenCalled();
    expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
  });
  it('rejects withdrawn contributions and denies stale inherited source access', async () => {
    const h = harness();
    h.dialogues.relevantContributions.mockResolvedValue([]);
    await expect(h.service.request(threadRef, input, request)).rejects.toThrow(
      'DIALOGUE_CONTRIBUTION_CHANGED',
    );
    expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
    const other = harness();
    other.context.authorize.mockImplementation(async (_session, ids) => {
      if (ids.includes('WI-B')) throw new Error('OBJECT_ACCESS_DENIED');
      return [];
    });
    await expect(
      other.service.request(threadRef, input, request),
    ).rejects.toThrow('OBJECT_ACCESS_DENIED');
    expect(other.reviews.appendTextTurn).not.toHaveBeenCalled();
  });
  it('recovers an inserted turn after the conversation closes without dispatching again', async () => {
    const h = harness();
    const frozen = {
      request_ref: '44444444-4444-4444-8444-444444444444',
      request_json: canonicalJson(input),
      input_json: '{"contextWorkItemIds":["WI-A","WI-B"],"contributions":[]}',
      user_message: 'first exact selected input',
      review_conversation_id: 'RC-closed',
      review_turn_id: null,
    };
    h.assessments.find.mockResolvedValue(frozen);
    h.assessments.findTurn.mockResolvedValue('RT-original');
    h.reviews.appendTextTurn.mockRejectedValue(
      new Error('REVIEW_CONVERSATION_CLOSED'),
    );
    await expect(
      h.service.request(threadRef, input, request),
    ).resolves.toMatchObject({
      reviewTurnId: 'RT-original',
      reviewConversationId: 'RC-closed',
      replayed: true,
    });
    expect(h.assessments.bind).toHaveBeenCalledWith(
      expect.anything(),
      frozen,
      'RT-original',
    );
    expect(h.reviews.appendTextTurn).not.toHaveBeenCalled();
    expect(h.context.current).not.toHaveBeenCalled();
    expect(h.context.authorize).toHaveBeenCalledWith(expect.anything(), [
      'WI-A',
      'WI-B',
    ]);
  });
  it('resumes a frozen request without rebuilding selected input or changing the review request identity', async () => {
    const h = harness();
    const frozen = {
      request_ref: '44444444-4444-4444-8444-444444444444',
      request_json: canonicalJson(input),
      input_json: '{"contextWorkItemIds":["WI-A","WI-B"],"contributions":[]}',
      user_message: 'first exact selected input',
      review_conversation_id: 'RC-old',
    };
    h.assessments.find.mockResolvedValue(frozen);
    const result = await h.service.request(threadRef, input, request);
    expect(result.replayed).toBe(true);
    expect(h.context.current).not.toHaveBeenCalled();
    expect(h.assessments.create).not.toHaveBeenCalled();
    expect(h.reviews.appendTextTurn).toHaveBeenCalledWith(
      'WI-A',
      'RC-old',
      expect.objectContaining({
        requestId: 'dialogue-44444444-4444-4444-8444-444444444444',
        userMessage: frozen.user_message,
      }),
      request,
    );
    await expect(
      h.service.request(
        threadRef,
        { ...input, userMessage: 'changed' },
        request,
      ),
    ).rejects.toThrow('DIALOGUE_REQUEST_REPLAY_CONFLICT');
  });
});
