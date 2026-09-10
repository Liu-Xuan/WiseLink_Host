import 'reflect-metadata';

import type { Request } from 'express';
import { DialogueService } from '../../server/modules/canonical-host/dialogue.service';
import type {
  DialogueRepository,
  DialogueMessageRow,
} from '../../server/modules/canonical-host/dialogue.repository';
import type { DialogueContextService } from '../../server/modules/canonical-host/dialogue-context.service';
import type { ReviewAilyService } from '../../server/modules/canonical-host/review-aily.service';
import type { SessionResolver } from '../../server/modules/identity/session-resolver.service';

describe('dialogue API interaction boundaries', () => {
  const threadRef = '11111111-1111-4111-8111-111111111111';
  const messageRef = '22222222-2222-4222-8222-222222222222';
  const queryRef = '33333333-3333-4333-8333-333333333333';
  const actor = {
    tenantId: 'tenant',
    actorId: 'alice',
    sessionId: 'current-login',
  };
  const request = {} as Request;
  const input = {
    requestId: 'send-1',
    expectedThreadRevision: 1,
    userText: '这只是前提，解释一下',
    workItemIds: [],
  };
  function harness() {
    const session = {
      actor: {
        tenantId: actor.tenantId,
        canonicalSubject: { id: actor.actorId },
      },
      session: { id: actor.sessionId },
    };
    const generation = {
      generationQuery: 'first immutable snapshot',
      focus: [],
      historyMessageRefs: [],
      earlierMessagesOmitted: false,
    };
    const state = {
      thread: { thread_ref: threadRef, revision: 1, focus_json: '[]' },
      messages: [] as DialogueMessageRow[],
      contributions: [],
      nextMessageCursor: null,
    };
    const repository = {
      list: jest.fn().mockResolvedValue([]),
      read: jest.fn(async () => state),
      findReplay: jest.fn(async () => state.messages[0] ?? null),
      readMessage: jest.fn(async () => state.messages[0]),
      append: jest.fn(async (_scope, value) => {
        const message = {
          message_ref: messageRef,
          thread_ref: threadRef,
          request_key: value.requestKey,
          user_text: value.userText,
          origin: value.origin,
          origin_json: JSON.stringify(value.originDetails),
          focus_json: JSON.stringify(value.focusIds),
          context_json: JSON.stringify(value.context),
          purpose: value.purpose,
          executor: value.purpose === 'CHAT' ? 'AILY' : 'NONE',
          thread_revision: 2,
          _created_at: new Date(),
          query_ref: null,
        } as DialogueMessageRow;
        state.messages.push(message);
        state.thread.revision = 2;
        return { message, replayed: false };
      }),
      saveContribution: jest.fn(),
    };
    const context = {
      authorize: jest.fn().mockResolvedValue([]),
      current: jest.fn().mockResolvedValue([]),
      generation: jest.fn(() => generation),
    };
    const aily = {
      availability: jest.fn().mockResolvedValue({ available: true }),
      startMessage: jest.fn(async () => {
        Object.assign(state.messages[0], {
          query_ref: queryRef,
          query_status: 'UNKNOWN',
          answer_text: '已保存部分',
          error_code: 'AILY_STREAM_INTERRUPTED',
        });
        return { queryRef, status: 'UNKNOWN' };
      }),
      resultMessage: jest.fn().mockResolvedValue({
        queryRef,
        status: 'UNKNOWN',
        answer: '已保存部分',
        incomplete: true,
        error: 'AILY_STREAM_RESULT_UNCONFIRMED',
      }),
    };
    const service = new DialogueService(
      {
        resolve: jest.fn().mockResolvedValue(session),
      } as unknown as SessionResolver,
      repository as unknown as DialogueRepository,
      context as unknown as DialogueContextService,
      aily as unknown as ReviewAilyService,
    );
    return { service, repository, context, aily, state, generation };
  }

  it('authorizes the current document before reading its existing conversations', async () => {
    const h = harness();
    await h.service.list(request, undefined, 'WI-current');
    expect(h.context.authorize).toHaveBeenCalledWith(expect.anything(), [
      'WI-current',
    ]);
    expect(h.repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'alice', tenantId: 'tenant' }),
      undefined,
      'WI-current',
    );
    h.repository.list.mockClear();
    h.context.authorize.mockRejectedValueOnce(new Error('denied'));
    await expect(
      h.service.list(request, undefined, 'WI-denied'),
    ).rejects.toThrow('denied');
    expect(h.repository.list).not.toHaveBeenCalled();
  });

  it('defaults a Feishu excerpt to saving, without generating another answer', async () => {
    const h = harness();
    const result = await h.service.append(
      threadRef,
      {
        ...input,
        origin: 'FEISHU_EXCERPT',
        originDetails: { label: '飞书私聊摘录' },
      },
      request,
    );
    expect(h.aily.startMessage).not.toHaveBeenCalled();
    expect(result.messages[0]).toMatchObject({
      origin: 'FEISHU_EXCERPT',
      purpose: 'CONTRIBUTION_ONLY',
      executor: 'NONE',
      provenance: 'USER_SUBMITTED_EXCERPT',
    });
  });

  it('keeps explicit excerpt-only saves separate from identity and verified event claims', async () => {
    const h = harness();
    const result = await h.service.append(
      threadRef,
      {
        ...input,
        origin: 'FEISHU_EXCERPT',
        purpose: 'CONTRIBUTION_ONLY',
        originDetails: {
          label: '用户摘录',
          sourceMessageId: 'claimed-id',
          actorId: 'bob',
          provenance: 'VERIFIED_EVENT',
        },
      },
      request,
    );
    expect(h.aily.startMessage).not.toHaveBeenCalled();
    expect(result.messages[0].provenance).toBe('USER_SUBMITTED_EXCERPT');
    expect(result.messages[0].originDetails).toEqual({
      label: '用户摘录',
      sourceMessageId: 'claimed-id',
    });
    expect(h.repository.append.mock.calls[0][0]).toEqual(actor);
  });

  it('dispatches once and replays the stored UNKNOWN reply without rebuilding its context', async () => {
    const h = harness();
    await h.service.append(threadRef, input, request);
    h.context.current.mockClear();
    h.context.generation.mockClear();
    const result = await h.service.append(threadRef, input, request);
    expect(h.repository.append).toHaveBeenCalledTimes(1);
    expect(h.aily.startMessage).toHaveBeenCalledTimes(1);
    expect(h.aily.startMessage).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        messageRef,
        query: 'first immutable snapshot',
      }),
    );
    expect(h.context.current).not.toHaveBeenCalled();
    expect(h.context.generation).not.toHaveBeenCalled();
    expect(result.messages[0].response).toMatchObject({
      status: 'UNKNOWN',
      answer: '已保存部分',
    });
  });

  it('refuses changed text under the same request id', async () => {
    const h = harness();
    await h.service.append(threadRef, input, request);
    await expect(
      h.service.append(
        threadRef,
        { ...input, userText: '改成真正更新评估' },
        request,
      ),
    ).rejects.toThrow('DIALOGUE_REQUEST_REPLAY_CONFLICT');
    expect(h.aily.startMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects caller-supplied identity before creating any message', async () => {
    const h = harness();
    await expect(
      h.service.append(threadRef, { ...input, actorId: 'bob' }, request),
    ).rejects.toThrow('DIALOGUE_INPUT_INVALID');
    expect(h.repository.append).not.toHaveBeenCalled();
    expect(h.aily.startMessage).not.toHaveBeenCalled();
  });

  it('checks inherited object permissions before returning an answer after the source left the history page', async () => {
    const h = harness();
    await h.service.append(threadRef, input, request);
    h.state.messages[0].context_json = JSON.stringify({
      ...h.generation,
      contextWorkItemIds: ['revoked-B'],
    });
    h.context.authorize.mockImplementation(async (_session, ids: string[]) => {
      if (ids.includes('revoked-B')) throw new Error('OBJECT_REVOKED');
      return [];
    });
    await expect(h.service.read(threadRef, request)).rejects.toThrow(
      'OBJECT_REVOKED',
    );
  });

  it('settles abandoned running state through the local result path while keeping its partial answer', async () => {
    const h = harness();
    await h.service.append(threadRef, input, request);
    h.aily.resultMessage.mockClear();
    Object.assign(h.state.messages[0], {
      query_status: 'RUNNING',
      _created_at: new Date(Date.now() - 400000),
    });
    const result = await h.service.read(threadRef, request);
    expect(h.aily.resultMessage).toHaveBeenCalledWith(
      actor,
      messageRef,
      queryRef,
    );
    expect(result.messages[0].response).toMatchObject({
      status: 'UNKNOWN',
      answer: '已保存部分',
    });
    expect(h.aily.startMessage).toHaveBeenCalledTimes(1);
  });

  it('resumes only the missing initial dispatch with the original saved input', async () => {
    const h = harness();
    h.aily.startMessage.mockRejectedValueOnce(
      new Error('AILY_USER_REAUTHORIZATION_REQUIRED'),
    );
    await expect(h.service.append(threadRef, input, request)).rejects.toThrow(
      'AILY_USER_REAUTHORIZATION_REQUIRED',
    );
    expect(h.state.messages[0].query_ref).toBeNull();
    h.context.current.mockClear();
    h.context.generation.mockClear();
    await h.service.resume(threadRef, messageRef, request);
    expect(h.aily.startMessage).toHaveBeenLastCalledWith(
      actor,
      expect.objectContaining({
        messageRef,
        requestKey: input.requestId,
        query: 'first immutable snapshot',
      }),
    );
    expect(h.context.current).not.toHaveBeenCalled();
    expect(h.context.generation).not.toHaveBeenCalled();
    expect(h.repository.append).toHaveBeenCalledTimes(1);
  });

  it.each(['UNKNOWN', 'FAILED', 'COMPLETED'])(
    'never regenerates an already registered %s message on resume',
    async (status) => {
      const h = harness();
      await h.service.append(threadRef, input, request);
      h.state.messages[0].query_status = status;
      await h.service.resume(threadRef, messageRef, request);
      expect(h.aily.startMessage).toHaveBeenCalledTimes(1);
    },
  );

  it('does not turn an excerpt-only message into a chat via the resume endpoint', async () => {
    const h = harness();
    await h.service.append(
      threadRef,
      { ...input, origin: 'FEISHU_EXCERPT' },
      request,
    );
    await expect(
      h.service.resume(threadRef, messageRef, request),
    ).rejects.toThrow('DIALOGUE_NOT_A_CHAT');
    expect(h.aily.startMessage).not.toHaveBeenCalled();
  });
});
