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
  function harness() {
    const sessions = {
      withVerifiedBrowserSql: jest.fn(async (run) => run()),
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
        .mockResolvedValue([{ workItemRevision: 7, workingRef: 'work-4' }]),
    };
    const assessments = {
      find: jest.fn().mockResolvedValue(null),
      create: jest.fn(
        async (_scope, _threadRef, body, snapshot, text, conversationId) => ({
          request_ref: '44444444-4444-4444-8444-444444444444',
          request_json: canonicalJson(body),
          input_json: JSON.stringify(snapshot),
          user_message: text,
          review_conversation_id: conversationId,
        }),
      ),
      findTurn: jest.fn().mockResolvedValue(null),
      bind: jest.fn().mockResolvedValue(undefined),
    };
    const reviews = {
      createOrResume: jest
        .fn()
        .mockResolvedValue({ conversation: { reviewConversationId: 'RC-A' } }),
      appendTextTurn: jest
        .fn()
        .mockResolvedValue({ turn: { reviewTurnId: 'RT-A' }, replayed: false }),
    };
    const service = new DialogueAssessmentService(
      sessions as never,
      dialogues as never,
      context as never,
      assessments as never,
      reviews as never,
    );
    return { service, sessions, dialogues, context, assessments, reviews };
  }
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
    expect(h.sessions.withVerifiedBrowserSql).toHaveBeenCalledTimes(2);
  });
  it.each([
    { workItemRevision: 8, workingRef: 'work-4' },
    { workItemRevision: 7, workingRef: 'work-5' },
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
