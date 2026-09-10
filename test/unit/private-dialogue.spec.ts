import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DialogueThreadReadModel,
  DialogueMessageReadModel,
  DialogueContributionReadModel,
} from '@shared/dialogue.interface';
import {
  selectedDialogueText,
  dialogueSourceSelection,
  mergeDialogueRead,
  dialogueNeedsRefresh,
  dialogueResponseLabel,
} from '../../client/src/features/dialogue/dialogue-state';
import { DialogueMessages } from '../../client/src/features/dialogue/DialogueMessages';
import { DialogueRequests } from '../../client/src/features/dialogue/dialogue-requests';
import { dialogueAssessmentOperation } from '../../client/src/features/dialogue/dialogue-assessment-operation';
import { dialogueAssessmentSelectionValid } from '../../client/src/features/dialogue/dialogue-assessment-selection';
import {
  dialogueFocusOptions,
  restoreDialogueFocus,
} from '../../client/src/features/dialogue/dialogue-focus';
import {
  appendDialogue,
  readDialogue,
  readDialogueContext,
  requestDialogueAssessment,
  saveDialogueContribution,
} from '../../client/src/api/dialogues';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import {
  getCanonicalHostClientSessionGeneration,
  requireCanonicalHostClientAuthentication,
} from '../../client/src/api/canonical-host';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: jest.fn(),
}));
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: jest.fn(() => 1),
  requireCanonicalHostClientAuthentication: jest.fn(),
}));
const message = (revision = 1): DialogueMessageReadModel => ({
  messageRef: `message-${revision}`,
  threadRef: 'thread',
  userText: '输入',
  origin: 'HOST',
  provenance: 'HOST_USER_INPUT',
  originDetails: {},
  focus: [],
  purpose: 'CHAT',
  executor: 'AILY',
  receivedAt: '2026-09-10T00:00:00Z',
  threadRevision: revision,
  response: null,
});
const thread = (revision = 1): DialogueThreadReadModel => ({
  threadRef: 'thread',
  revision,
  audience: 'PRIVATE',
  focusWorkItemIds: [],
  messages: [message(revision)],
  contributions: [],
  aily: { available: true },
  nextMessageCursor: 'older',
});

describe('private dialogue text and read state', () => {
  it('requires every explicitly selected contribution to remain active at its selected revision', () => {
    const contribution: DialogueContributionReadModel = {
      contributionRef: 'c',
      threadRef: 'thread',
      messageRef: 'message-1',
      sourcePart: 'USER',
      selectedText: '前提',
      workItemId: 'target',
      kind: 'HYPOTHESIS',
      revision: 2,
      status: 'ACTIVE',
      supersedesRef: null,
      audience: 'PRIVATE',
      createdAt: '2026-09-10T00:00:00Z',
      usedBy: [],
    };
    const chosen = [{ contributionRef: 'c', expectedRevision: 2 }];
    expect(
      dialogueAssessmentSelectionValid(chosen, [contribution], 'target'),
    ).toBe(true);
    expect(
      dialogueAssessmentSelectionValid(
        chosen,
        [{ ...contribution, status: 'WITHDRAWN' }],
        'target',
      ),
    ).toBe(false);
    expect(
      dialogueAssessmentSelectionValid(
        chosen,
        [{ ...contribution, revision: 3 }],
        'target',
      ),
    ).toBe(false);
    expect(
      dialogueAssessmentSelectionValid(
        [...chosen, { contributionRef: 'missing', expectedRevision: 1 }],
        [contribution],
        'target',
      ),
    ).toBe(false);
    expect(
      dialogueAssessmentSelectionValid(chosen, [contribution], 'other'),
    ).toBe(false);
  });
  it('restores saved focus once, preserving a user switch or explicit empty selection before/after read', () => {
    expect(
      restoreDialogueFocus({ ids: [], initialized: false }, ['saved']),
    ).toEqual({ ids: ['saved'], initialized: true });
    expect(
      restoreDialogueFocus({ ids: ['draft-choice'], initialized: true }, [
        'saved',
      ]).ids,
    ).toEqual(['draft-choice']);
    expect(
      restoreDialogueFocus({ ids: [], initialized: true }, ['saved']).ids,
    ).toEqual([]);
  });
  it('keeps selected IDs when search changes without caching an old authorized label', () => {
    const ids = ['selected'];
    const next = dialogueFocusOptions(
      ids,
      [{ workItemId: 'search-result', label: '新结果' }],
      thread(),
    );
    expect(ids).toEqual(['selected']);
    expect(next.map((item) => item.workItemId)).toEqual([
      'search-result',
      'selected',
    ]);
    expect(next[1].label).toContain('名称暂不可用');
    expect(dialogueFocusOptions(ids, [], null)[0].label).toContain('可移除');
  });
  it('uses exact occurrence offsets, preserving whitespace', () => {
    expect(selectedDialogueText('same same ', 5, 10)).toBe('same ');
    expect(selectedDialogueText('abc', 2, 1)).toBeNull();
    expect(selectedDialogueText('  ', 0, 2)).toBeNull();
  });
  it('rejects split emoji and maps CRLF textarea offsets to saved source', () => {
    expect(selectedDialogueText('A😀B', 1, 2)).toBeNull();
    expect(selectedDialogueText('A😀B', 1, 3)).toBe('😀');
    const source = 'one\r\ntwo\r\n😀';
    const selection = dialogueSourceSelection(source, 4, 7);
    expect(selectedDialogueText(source, selection.start, selection.end)).toBe(
      'two',
    );
  });
  it('replaces authorized pages without retaining private old pages and ignores stale revision', () => {
    const current = thread(3);
    const next = {
      ...thread(4),
      messages: [{ ...message(3), userText: '更新' }, message(4)],
    };
    expect(mergeDialogueRead(current, next).messages).toHaveLength(2);
    expect(mergeDialogueRead(next, thread(2))).toBe(next);
    const older = {
      ...thread(4),
      messages: [message(1)],
      nextMessageCursor: null,
    };
    expect(
      mergeDialogueRead(next, older).messages.map(
        (item) => item.threadRevision,
      ),
    ).toEqual([1]);
    expect(mergeDialogueRead(next, older).nextMessageCursor).toBeNull();
    expect(
      mergeDialogueRead(older, next).messages.map(
        (item) => item.threadRevision,
      ),
    ).toEqual([3, 4]);
  });
  it('foreground requests interrupt background reads and old finally cannot unlock the new request', () => {
    const requests = new DialogueRequests();
    const background = requests.start(true)!;
    const foreground = requests.start(false)!;
    expect(background.signal.aborted).toBe(true);
    expect(requests.finish(background)).toBe(false);
    expect(requests.start(true)).toBeNull();
    expect(requests.start(false)).toBeNull();
    expect(requests.finish(foreground)).toBe(true);
    expect(requests.start(true)).not.toBeNull();
    requests.stop();
  });
  it('polls unfinished chats but never unknown or contribution-only execution', () => {
    expect(dialogueNeedsRefresh(thread())).toBe(true);
    const item = {
      ...message(),
      purpose: 'CONTRIBUTION_ONLY' as const,
      executor: 'NONE' as const,
    };
    expect(dialogueNeedsRefresh({ ...thread(), messages: [item] })).toBe(false);
    const unknown = {
      ...message(),
      response: {
        queryRef: 'query',
        status: 'UNKNOWN' as const,
        answer: '部分',
        error: null,
        incomplete: true,
      },
    };
    expect(dialogueNeedsRefresh({ ...thread(), messages: [unknown] })).toBe(
      false,
    );
    expect(dialogueResponseLabel(unknown)).toContain('完成情况未确认');
  });
  it('shows provenance and partial failure without claiming adoption or allowing UNKNOWN resend', () => {
    const item = {
      ...message(),
      origin: 'FEISHU_EXCERPT' as const,
      response: {
        queryRef: 'query',
        status: 'UNKNOWN' as const,
        answer: '<script>保留内容</script>',
        error: '服务不可用',
        incomplete: true,
      },
    };
    const html = renderToStaticMarkup(
      createElement(DialogueMessages, {
        thread: { ...thread(), messages: [item] },
        disabled: false,
        onSelect: () => undefined,
        onResume: () => undefined,
      }),
    );
    expect(html).toContain('未验证原始作者');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('服务不可用');
    expect(html).not.toContain('继续投递');
  });
});

describe('dialogue API boundaries', () => {
  it('retains accepted receipt after a failed GET and retries GET without another assessment POST', async () => {
    jest.mocked(getCanonicalHostClientSessionGeneration).mockReturnValue(1);
    const response = {
      workItemId: 'target',
      requestRef: 'request',
      reviewTurnId: 'turn',
      reviewConversationId: 'conversation',
      replayed: false,
    };
    jest
      .mocked(axiosForBackend)
      .mockResolvedValueOnce({ status: 200, data: response })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ status: 200, data: thread(2) });
    const operation = dialogueAssessmentOperation('thread', {
      requestId: 'request',
      workItemId: 'target',
      expectedWorkItemRevision: 1,
      expectedWorkingRef: null,
      contributions: [],
      userMessage: '更新',
    });
    await expect(operation.run(new AbortController().signal)).rejects.toThrow(
      '评估请求已受理',
    );
    expect(operation.receipt()).toEqual(response);
    await expect(operation.run(new AbortController().signal)).resolves.toEqual(
      thread(2),
    );
    expect(axiosForBackend).toHaveBeenCalledTimes(3);
    expect(axiosForBackend).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(axiosForBackend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(axiosForBackend).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ method: 'GET' }),
    );
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCanonicalHostClientSessionGeneration).mockReturnValue(1);
  });
  it('uses Host path and exact supplied idempotent payload on repeated attempts', async () => {
    jest
      .mocked(axiosForBackend)
      .mockResolvedValue({ status: 200, data: thread() });
    const input = {
      requestId: 'same-request',
      expectedThreadRevision: 1,
      userText: ' exact ',
      purpose: 'CONTRIBUTION_ONLY' as const,
    };
    await appendDialogue('thread', input);
    await appendDialogue('thread', input);
    for (const [config] of jest.mocked(axiosForBackend).mock.calls) {
      expect(config).toMatchObject({
        url: '/api/dialogues/thread/messages',
        method: 'POST',
        data: input,
      });
    }
  });
  it('rejects cross-thread readback', async () => {
    jest.mocked(axiosForBackend).mockResolvedValue({
      status: 200,
      data: { ...thread(), threadRef: 'other' },
    });
    await expect(readDialogue('thread')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it('passes an explicitly chosen predecessor on correction without rewriting the selection', async () => {
    jest
      .mocked(axiosForBackend)
      .mockResolvedValue({ status: 200, data: thread() });
    const input = {
      requestId: 'correct-once',
      expectedThreadRevision: 1,
      messageRef: 'message-1',
      sourcePart: 'USER' as const,
      selection: { start: 0, end: 2 },
      workItemId: 'target',
      kind: 'CORRECTION' as const,
      supersedesContributionRef: 'previous-contribution',
    };
    await saveDialogueContribution('thread', input);
    expect(axiosForBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/dialogues/thread/contributions',
        method: 'POST',
        data: input,
      }),
    );
  });
  it('invalidates authentication on 401', async () => {
    jest
      .mocked(axiosForBackend)
      .mockRejectedValue({ response: { status: 401 } });
    await expect(readDialogue('thread')).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(requireCanonicalHostClientAuthentication).toHaveBeenCalledWith(1);
  });
  it('rejects a late response from another login generation', async () => {
    jest
      .mocked(getCanonicalHostClientSessionGeneration)
      .mockReturnValueOnce(1)
      .mockReturnValue(2);
    jest
      .mocked(axiosForBackend)
      .mockResolvedValue({ status: 200, data: thread() });
    await expect(readDialogue('thread')).rejects.toThrow(
      '登录或页面状态已变化',
    );
  });
  it('does not silently accept another context target or another assessment target', async () => {
    jest
      .mocked(axiosForBackend)
      .mockResolvedValue({ status: 200, data: [{ workItemId: 'other' }] });
    await expect(readDialogueContext('thread', 'target')).rejects.toMatchObject(
      { statusCode: 403 },
    );
    jest.mocked(axiosForBackend).mockResolvedValue({
      status: 200,
      data: {
        workItemId: 'other',
        reviewTurnId: 'turn',
        reviewConversationId: 'conversation',
      },
    });
    await expect(
      requestDialogueAssessment('thread', {
        requestId: 'request',
        workItemId: 'target',
        expectedWorkItemRevision: 1,
        expectedWorkingRef: null,
        contributions: [],
        userMessage: '更新',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
