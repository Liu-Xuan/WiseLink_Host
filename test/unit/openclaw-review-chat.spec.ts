import { assessmentDom } from './fixtures/document-assessment-dom';

let mockSession = 1;
let mockAuthenticationRequired = false;
const mockSessionListeners = new Set<() => void>();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalHostClientSessionAuthenticationRequired: () =>
    mockAuthenticationRequired,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockSessionListeners.add(listener);
    return () => mockSessionListeners.delete(listener);
  },
}));
jest.mock('@client/src/api', () => ({
  canonicalHost: {
    reloadReviewConversation: jest.fn(),
    createOrResumeReviewConversation: jest.fn(),
    appendReviewTextTurn: jest.fn(),
    confirmReviewActionDraft: jest.fn(),
    closeReviewConversation: jest.fn(),
  },
}));
jest.mock('@client/src/api/runtime-probe', () => ({
  getHostedRuntimeFingerprint: async () => ({}),
}));
jest.mock('@client/src/config/runtime-build', () => ({
  runtimeBuildFingerprint: { sourceCommit: 'synthetic' },
}));
jest.mock('@client/src/components/OfficialOauthLink', () => ({
  OfficialOauthLink: ({ children }: { children: React.ReactNode }) =>
    require('react').createElement(
      'a',
      { href: '/client/oauth/callback' },
      children,
    ),
}));
jest.mock('../../client/src/features/review/TaskModelPicker', () => ({
  __esModule: true,
  default: () => null,
  useTaskModelOptions: () => ({ ready: true, data: { options: [] } }),
}));
jest.mock(
  '../../client/src/features/review/continuous-review-panel.css',
  () => ({}),
);
jest.mock('../../client/src/features/review/review-materials.css', () => ({}));

import { act, createElement, type ComponentProps } from 'react';
import type { Root } from 'react-dom/client';
import { canonicalHost } from '@client/src/api';
import type {
  AppendReviewTextTurnRequest,
  AppendReviewTextTurnResponse,
  ReviewConversationReadModel,
  ReviewScopeSelection,
} from '@shared/api.interface';
import ContinuousReviewPanel from '../../client/src/features/review/ContinuousReviewPanel';
import RetainedWorkbenchPanel from '../../client/src/features/workbench/RetainedWorkbenchPanel';
import {
  readPendingReviewChat,
  readUnconfirmedReviewChats,
  readReviewDraft,
} from '../../client/src/features/review/review-draft-store';
import { reviewUiTurn } from './fixtures/review-ui';

const reload = jest.mocked(canonicalHost.reloadReviewConversation);
const start = jest.mocked(canonicalHost.createOrResumeReviewConversation);
const append = jest.mocked(canonicalHost.appendReviewTextTurn);
const confirm = jest.mocked(canonicalHost.confirmReviewActionDraft);
const close = jest.mocked(canonicalHost.closeReviewConversation);
let root: Root;
let container: HTMLDivElement;
let views: Map<string, ReviewConversationReadModel | null>;
const workingRefresh = jest.fn(async () => undefined);
const workItemRefresh = jest.fn(async () => undefined);
const locate = jest.fn();
const receipt = jest.fn();

function key(workItemId: string, scope?: ReviewScopeSelection | null): string {
  return JSON.stringify([
    workItemId,
    scope?.kind === 'ENGINEERING_MATTER' ? scope.matterId : null,
  ]);
}
function view(
  workItemId = 'WI-1',
  scope?: ReviewScopeSelection,
): ReviewConversationReadModel {
  return {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: `RC-${workItemId}-${scope?.kind === 'ENGINEERING_MATTER' ? scope.matterId : 'work'}`,
    workItemId,
    reviewScope: scope,
    status: 'ACTIVE',
    currentRevisionSynced: true,
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    currentWorkItemRevision: 7,
    automaticExecutionAvailable: true,
    turns: [],
    closedAt: null,
    createdAt: '2026-10-23T00:00:00Z',
    lastActiveAt: '2026-10-23T00:00:00Z',
  };
}
function responseFor(
  workItemId: string,
  input: AppendReviewTextTurnRequest,
): AppendReviewTextTurnResponse {
  const prior = views.get(key(workItemId, input.reviewScope));
  if (!prior) throw new Error('Missing synthetic conversation');
  const turn = {
    ...reviewUiTurn(prior.turns.length + 1),
    requestId: input.requestId,
    purpose: 'CHAT' as const,
    userMessage: input.userMessage,
    reviewScope: input.reviewScope,
    execution: {
      status: 'QUEUED' as const,
      attemptRef: 'synthetic-attempt',
      requestedAt: null,
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      error: null,
    },
  };
  turn.engineerSuppliedInput = {
    ...turn.engineerSuppliedInput,
    text: input.userMessage,
  };
  return {
    conversation: { ...prior, turns: [...prior.turns, turn] },
    turn,
    replayed: false,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}
type Props = ComponentProps<typeof ContinuousReviewPanel>;
async function mount(props: Partial<Props> = {}, active = true) {
  await act(async () =>
    root.render(
      createElement(RetainedWorkbenchPanel, {
        active,
        children: createElement(ContinuousReviewPanel, {
          workItemId: 'WI-1',
          workItemRevision: 7,
          selectedEvaluationItemId: null,
          confirmationReceipt: null,
          onConfirmationReceipt: receipt,
          onLocateSourceRef: locate,
          onLocateSourceBinding: locate,
          onWorkingRefresh: workingRefresh,
          onWorkItemRefresh: workItemRefresh,
          ...props,
        }),
      }),
    ),
  );
}
function button(text: string): HTMLButtonElement {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error('Missing button: ' + text);
  return found;
}
function editor(): HTMLTextAreaElement {
  const found = container.querySelector<HTMLTextAreaElement>(
    '[aria-label="对话消息"]',
  );
  if (!found) throw new Error('Missing CHAT editor');
  return found;
}
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      assessmentDom.window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(editor(), text);
    editor().dispatchEvent(
      new assessmentDom.window.Event('input', { bubbles: true }),
    );
  });
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function setView(value: ReviewConversationReadModel) {
  views.set(key(value.workItemId, value.reviewScope), value);
}

beforeEach(() => {
  mockSession += 1;
  mockAuthenticationRequired = false;
  mockSessionListeners.forEach((listener) => listener());
  jest.clearAllMocks();
  reload.mockReset();
  start.mockReset();
  append.mockReset();
  views = new Map();
  setView(view());
  reload.mockImplementation(async (workItemId, scope) => ({
    conversation: views.get(key(workItemId, scope)) ?? null,
    currentWorkItemRevision: 7,
  }));
  start.mockImplementation(async (workItemId, scope) => {
    const next = view(workItemId, scope);
    setView(next);
    return { conversation: next, resumed: false };
  });
  append.mockImplementation(async (workItemId, _conversationId, input) => {
    const response = responseFor(workItemId, input);
    setView(response.conversation);
    return response;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = (
    require('react-dom/client') as typeof import('react-dom/client')
  ).createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});
afterAll(() => assessmentDom.window.close());

it('starts explicitly and sends exactly one CHAT/AUTOMATIC request with no assessment action', async () => {
  const scope = {
    kind: 'ENGINEERING_MATTER' as const,
    matterId: 'M-1',
    expectedWorkingRevision: 3,
  };
  views.set(key('WI-1', scope), null);
  await mount({ reviewScope: scope });
  expect(start).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
  expect(container.querySelector('iframe')).toBeNull();
  await click('开始对话');
  expect(start).toHaveBeenCalledWith('WI-1', {
    kind: 'ENGINEERING_MATTER',
    matterId: 'M-1',
  });
  await type('核对原文条件');
  const delayed = deferred<AppendReviewTextTurnResponse>();
  append.mockImplementationOnce(() => delayed.promise);
  await act(async () => {
    button('发送消息').click();
    button('发送消息').click();
  });
  expect(append).toHaveBeenCalledTimes(1);
  const input = append.mock.calls[0][2];
  expect(input).toEqual({
    requestId: expect.any(String),
    userMessage: '核对原文条件',
    purpose: 'CHAT',
    executionMode: 'AUTOMATIC',
    reviewScope: scope,
  });
  expect(editor().disabled).toBe(true);
  const response = responseFor('WI-1', input);
  setView(response.conversation);
  await act(async () => delayed.resolve(response));
  expect(editor().value).toBe('');
  expect(container.textContent).toContain('讨论 · 排队等待');
  expect(button('发送消息').disabled).toBe(true);
  expect(workingRefresh).not.toHaveBeenCalled();
  expect(workItemRefresh).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('polls active CHAT only while visible and locates the exact returned SourceRef', async () => {
  await mount();
  await type('核对来源');
  await click('发送消息');
  const queued = views.get(key('WI-1'))!;
  const completed = {
    ...queued.turns[0],
    ...reviewUiTurn(1, true),
    purpose: 'CHAT' as const,
    requestId: queued.turns[0].requestId,
    execution: { ...queued.turns[0].execution!, status: 'SUCCEEDED' as const },
  };
  completed.assistantCandidate!.answer = '合成答复：条件待核实';
  completed.assistantCandidate!.sourceBindings = [
    {
      sourceRefId: 'SRC-1',
      workItemId: 'WI-source',
      documentVersionId: 'DV-exact',
      originalSourceRefId: 'original-exact',
    },
  ];
  setView({ ...queued, turns: [completed] });
  jest.useFakeTimers();
  await mount({}, false);
  const count = reload.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(8000);
  });
  expect(reload).toHaveBeenCalledTimes(count);
  await mount({}, true);
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  expect(reload).toHaveBeenCalledTimes(count + 1);
  expect(container.textContent).toContain('合成答复：条件待核实');
  await click('SRC-1');
  expect(locate).toHaveBeenCalledWith(
    completed.assistantCandidate!.sourceBindings[0],
  );
  expect(workingRefresh).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

it('recovers a saved send after a lost response by readback without resending', async () => {
  await mount();
  await type('已保存但回包丢失');
  append.mockImplementationOnce(async (workItemId, _id, input) => {
    setView(responseFor(workItemId, input).conversation);
    throw new Error('Synthetic response lost');
  });
  await click('发送消息');
  const input = append.mock.calls[0][2];
  expect(readPendingReviewChat('work-item:WI-1')?.request.requestId).toBe(
    input.requestId,
  );
  expect(button('原样重试发送').disabled).toBe(false);
  await click('重新读取');
  expect(append).toHaveBeenCalledTimes(1);
  expect(readPendingReviewChat('work-item:WI-1')).toBeNull();
  expect(editor().value).toBe('');
  expect(container.textContent).toContain('已保存但回包丢失');
});

it('keeps the original request and Matter scope through a read and explicit retry', async () => {
  const scope = {
    kind: 'ENGINEERING_MATTER' as const,
    matterId: 'M-1',
    expectedWorkingRevision: 3,
  };
  setView(view('WI-1', scope));
  await mount({ reviewScope: scope });
  await type('冻结这次消息');
  append.mockRejectedValueOnce(new Error('Synthetic unknown result'));
  await click('发送消息');
  const original = structuredClone(append.mock.calls[0][2]);
  await mount({ reviewScope: { ...scope, expectedWorkingRevision: 4 } });
  await click('重新读取');
  await click('原样重试发送');
  expect(append).toHaveBeenCalledTimes(2);
  expect(append.mock.calls[1][2]).toEqual(original);
  expect(append.mock.calls[1][2].purpose).toBe('CHAT');
  expect(workingRefresh).not.toHaveBeenCalled();
});

it.each(['WorkItem', 'Matter'] as const)(
  'ignores a late send after a %s switch and reconciles its intent when returning',
  async (kind) => {
    const scopeA =
      kind === 'Matter'
        ? {
            kind: 'ENGINEERING_MATTER' as const,
            matterId: 'M-A',
            expectedWorkingRevision: 3,
          }
        : undefined;
    const scopeB =
      kind === 'Matter' ? { ...scopeA!, matterId: 'M-B' } : undefined;
    const workB = kind === 'WorkItem' ? 'WI-2' : 'WI-1';
    setView(view('WI-1', scopeA));
    setView(view(workB, scopeB));
    await mount({ reviewScope: scopeA });
    await type('旧范围的发送');
    const delayed = deferred<AppendReviewTextTurnResponse>();
    append.mockImplementationOnce(() => delayed.promise);
    await click('发送消息');
    const response = responseFor('WI-1', append.mock.calls[0][2]);
    await mount({ workItemId: workB, reviewScope: scopeB });
    await type('新范围未发草稿');
    setView(response.conversation);
    await act(async () => delayed.resolve(response));
    expect(editor().value).toBe('新范围未发草稿');
    expect(container.querySelector('[aria-label="对话记录"]')).toBeNull();
    await mount({ reviewScope: scopeA });
    expect(editor().value).toBe('');
    expect(container.textContent).toContain('旧范围的发送');
    expect(append).toHaveBeenCalledTimes(1);
    await mount({ workItemId: workB, reviewScope: scopeB });
    expect(editor().value).toBe('新范围未发草稿');
  },
);

it.each(['resolve', 'reject'] as const)(
  'clears old-session drafts and ignores a late send %s after identity changes',
  async (settlement) => {
    await mount();
    await type('旧用户消息');
    const delayed = deferred<AppendReviewTextTurnResponse>();
    append.mockImplementationOnce(() => delayed.promise);
    await click('发送消息');
    const response = responseFor('WI-1', append.mock.calls[0][2]);
    setView(view());
    await act(async () => {
      mockSession += 1;
      mockSessionListeners.forEach((listener) => listener());
    });
    await type('新用户草稿');
    await act(async () =>
      settlement === 'resolve'
        ? delayed.resolve(response)
        : delayed.reject(new Error('Late old error')),
    );
    expect(editor().value).toBe('新用户草稿');
    expect(container.textContent).not.toContain('旧用户消息');
    expect(container.querySelector('.continuous-review-error')).toBeNull();
    expect(readPendingReviewChat('work-item:WI-1')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(workingRefresh).not.toHaveBeenCalled();
  },
);

it('requires Host capability and preserves a draft while read-only refresh is pending', async () => {
  setView({ ...view(), automaticExecutionAvailable: false });
  await mount();
  await type('仍未发送的文字');
  expect(button('发送消息').disabled).toBe(true);
  expect(container.textContent).toContain('当前事项暂不能自动回复');
  const delayed =
    deferred<
      Awaited<ReturnType<typeof canonicalHost.reloadReviewConversation>>
    >();
  reload.mockImplementationOnce(() => delayed.promise);
  await click('重新读取');
  await type('刷新中继续输入');
  expect(editor().value).toBe('刷新中继续输入');
  expect(append).not.toHaveBeenCalled();
  await act(async () =>
    delayed.resolve({ conversation: view(), currentWorkItemRevision: 7 }),
  );
  expect(editor().value).toBe('刷新中继续输入');
  expect(button('发送消息').disabled).toBe(false);
});

it('withholds revoked content, clears its intent, and keeps the existing OAuth recovery entry', async () => {
  await mount();
  await type('待清除的内容');
  append.mockRejectedValueOnce(new Error('Synthetic unknown result'));
  await click('发送消息');
  reload.mockRejectedValueOnce(
    Object.assign(new Error('OAuth required'), {
      statusCode: 401,
      code: 'OFFICIAL_OAUTH_SESSION_REQUIRED',
    }),
  );
  await click('重新读取');
  expect(container.querySelector('[aria-label="对话消息"]')).toBeNull();
  expect(
    container.querySelector('a[href="/client/oauth/callback"]'),
  ).not.toBeNull();
  expect(readReviewDraft('work-item:WI-1')).toBe('');
  expect(readPendingReviewChat('work-item:WI-1')).toBeNull();
  expect(append).toHaveBeenCalledTimes(1);
});

it('refuses a mixed-scope response instead of displaying its history', async () => {
  const other = view('WI-other');
  other.turns = [{ ...reviewUiTurn(1, true), purpose: 'CHAT' }];
  other.turns[0].assistantCandidate!.answer = '必须隐藏的其他对象内容';
  reload.mockResolvedValueOnce({
    conversation: other,
    currentWorkItemRevision: 7,
  });
  await mount();
  expect(container.textContent).not.toContain('必须隐藏的其他对象内容');
  expect(container.querySelector('[aria-label="对话消息"]')).toBeNull();
  expect(append).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it('distinguishes automatic-execution denial from revoked read access without changing the send', async () => {
  const previous = { ...reviewUiTurn(1, true), purpose: 'CHAT' as const };
  previous.assistantCandidate!.answer = '已获权的旧答复';
  setView({ ...view(), turns: [previous] });
  await mount();
  await type('负责人授权变化后的发送');
  append.mockRejectedValueOnce(
    Object.assign(new Error('Execution not authorized'), {
      statusCode: 403,
      code: 'REVIEW_EXTERNAL_DELEGATION_REQUIRED',
    }),
  );
  await click('发送消息');
  const requestId = append.mock.calls[0][2].requestId;
  expect(container.textContent).toContain('已获权的旧答复');
  expect(container.textContent).toContain('负责人身份和有效的飞书来源授权');
  expect(editor().value).toBe('负责人授权变化后的发送');
  expect(readPendingReviewChat('work-item:WI-1')?.request.requestId).toBe(
    requestId,
  );
  setView({ ...view(), turns: [previous], automaticExecutionAvailable: false });
  await click('重新读取');
  expect(button('原样重试发送').disabled).toBe(true);
  expect(append).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(workingRefresh).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'ignores an old read %s after switching WorkItems without altering the new draft',
  async (settlement) => {
    const oldRead =
      deferred<
        Awaited<ReturnType<typeof canonicalHost.reloadReviewConversation>>
      >();
    reload.mockImplementationOnce(() => oldRead.promise);
    await mount();
    setView(view('WI-new'));
    await mount({ workItemId: 'WI-new' });
    await type('新对象草稿');
    const old = view();
    old.turns = [{ ...reviewUiTurn(1, true), purpose: 'CHAT' }];
    old.turns[0].assistantCandidate!.answer = '迟到旧对象答复';
    await act(async () =>
      settlement === 'resolve'
        ? oldRead.resolve({ conversation: old, currentWorkItemRevision: 7 })
        : oldRead.reject(new Error('Late old read error')),
    );
    expect(editor().value).toBe('新对象草稿');
    expect(container.textContent).not.toContain('迟到旧对象答复');
    expect(container.querySelector('.continuous-review-error')).toBeNull();
  },
);

it('keeps the latest assessment and its independent controls after a CHAT without refreshing work', async () => {
  const assessment = {
    ...reviewUiTurn(1, true),
    purpose: 'UPDATE_ASSESSMENT' as const,
  };
  assessment.assistantCandidate!.answer = '已有评估候选';
  assessment.assistantCandidate!.jobAidWorkingUpdate = {
    status: 'APPLIED',
    workRevisionRef: 'saved-work',
    workRevision: 3,
    affectedIssueKeys: ['issue-1'],
  };
  assessment.assistantCandidate!.reviewActionDraft = {
    reviewActionDraftRef: 'draft-existing',
    baseRevision: 7,
    evaluationItemId: 'criterion-1',
    proposedStatus: 'PASS',
    resolvedGapRefs: [],
    adoptedInputRefs: [],
    sourceRefs: ['SRC-1'],
    assumptions: [],
    affectedItemIds: ['criterion-1'],
    overallImpact: false,
    uncertaintyDispositions: [],
    decisionSnapshot: null,
  };
  setView({ ...view(), turns: [assessment] });
  await mount();
  expect(workingRefresh).toHaveBeenCalledTimes(1);
  workingRefresh.mockClear();
  await type('只讨论，不修改评估');
  await click('发送消息');
  const chat = container.querySelector('[aria-label="资料对话"]')!;
  const record = container.querySelector('[aria-label="评估复核记录"]')!;
  expect(chat.textContent).not.toContain('已有评估候选');
  expect(chat.textContent).not.toContain('查看详细差异');
  expect(record.textContent).toContain('已有评估候选');
  expect(record.textContent).toContain('查看详细差异');
  expect(container.textContent).toContain('评估记录与更新');
  expect(workingRefresh).not.toHaveBeenCalled();
  expect(workItemRefresh).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(receipt).not.toHaveBeenCalled();
});

it.each(['WorkItem', 'Matter'] as const)(
  'reconciles an unknown send in a stale %s using its original request before syncing',
  async (kind) => {
    const scope =
      kind === 'Matter'
        ? {
            kind: 'ENGINEERING_MATTER' as const,
            matterId: 'M-stale',
            expectedWorkingRevision: 3,
          }
        : undefined;
    setView(view('WI-1', scope));
    await mount({ reviewScope: scope });
    await type('原问题不可换号重发');
    append.mockRejectedValueOnce(new Error('Unknown first response'));
    await click('发送消息');
    const original = structuredClone(append.mock.calls[0][2]);
    const stale = {
      ...view('WI-1', scope),
      status: 'STALE_CONTEXT' as const,
      currentRevisionSynced: false,
      currentWorkItemRevision: 8,
    };
    setView(stale);
    await click('重新读取');
    expect(button('同步到最新版本').disabled).toBe(true);
    expect(button('原样重试发送').disabled).toBe(false);
    expect(start).not.toHaveBeenCalled();
    await click('原样重试发送');
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1][2]).toEqual(original);
    const scopeKey = scope ? 'work-item:WI-1:matter:M-stale' : 'work-item:WI-1';
    expect(readPendingReviewChat(scopeKey)).toBeNull();
    expect(button('同步到最新版本').disabled).toBe(false);
    await click('同步到最新版本');
    expect(start).toHaveBeenCalledTimes(1);
    expect(editor().value).toBe('');
    expect(workingRefresh).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  },
);

it('keeps a rejected original-scope retry unknown and requires an explicit action to retain it', async () => {
  const scope = {
    kind: 'ENGINEERING_MATTER' as const,
    matterId: 'M-stale',
    expectedWorkingRevision: 3,
  };
  setView(view('WI-1', scope));
  await mount({ reviewScope: scope });
  await type('旧事项范围的原问题');
  append.mockRejectedValueOnce(new Error('Unknown first response'));
  await click('发送消息');
  const original = structuredClone(append.mock.calls[0][2]);
  setView({
    ...view('WI-1', scope),
    status: 'STALE_CONTEXT',
    currentRevisionSynced: false,
    currentWorkItemRevision: 8,
  });
  await mount({ reviewScope: { ...scope, expectedWorkingRevision: 4 } });
  await click('重新读取');
  append.mockRejectedValueOnce(
    Object.assign(new Error('Frozen basis changed'), {
      statusCode: 409,
      code: 'REVIEW_MATTER_WORKING_REVISION_CHANGED',
      retryable: false,
    }),
  );
  await click('原样重试发送');
  const scopeKey = 'work-item:WI-1:matter:M-stale';
  expect(append.mock.calls[1][2]).toEqual(original);
  expect(readPendingReviewChat(scopeKey)?.request).toEqual(original);
  expect(readUnconfirmedReviewChats(scopeKey)).toHaveLength(0);
  expect(container.textContent).toContain('上次发送结果未知');
  await click('保留待核对记录，继续当前对话');
  expect(readPendingReviewChat(scopeKey)).toBeNull();
  expect(readUnconfirmedReviewChats(scopeKey)[0].request).toEqual(original);
  expect(readReviewDraft(scopeKey)).toBe('');
  expect(start).not.toHaveBeenCalled();
  expect(append).toHaveBeenCalledTimes(2);
  expect(button('同步到最新版本').disabled).toBe(false);
});

it.each([
  'CLOSED',
  'no active conversation',
  'replacement conversation',
] as const)(
  'retains an unknown original send after %s and continues only by explicit user action',
  async (state) => {
    await mount();
    await type('只能保留为未知的原问题');
    append.mockRejectedValueOnce(new Error('Unknown first response'));
    await click('发送消息');
    const original = structuredClone(append.mock.calls[0][2]);
    const originalConversation = append.mock.calls[0][1];
    if (state === 'CLOSED') {
      setView({
        ...view(),
        status: 'CLOSED',
        automaticExecutionAvailable: false,
      });
    } else if (state === 'no active conversation') {
      views.set(key('WI-1'), null);
    } else {
      setView({ ...view(), reviewConversationId: 'RC-new-active' });
    }
    await click('重新读取');
    expect(append).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(readPendingReviewChat('work-item:WI-1')?.request).toEqual(original);
    await click('保留待核对记录，继续当前对话');
    expect(readPendingReviewChat('work-item:WI-1')).toBeNull();
    const retained = readUnconfirmedReviewChats('work-item:WI-1');
    expect(retained).toHaveLength(1);
    expect(retained[0].request).toEqual(original);
    expect(retained[0].reviewConversationId).toBe(originalConversation);
    expect(readReviewDraft('work-item:WI-1')).toBe('');
    const record = container.querySelector('[aria-label="待核对发送记录"]')!;
    expect(record.textContent).toContain('结果未知');
    expect(record.textContent).toContain('只能保留为未知的原问题');
    expect(record.textContent).toContain(original.requestId);
    expect(record.textContent).toContain(originalConversation);
    expect(append).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    if (state !== 'replacement conversation') {
      start.mockResolvedValueOnce({
        conversation: { ...view(), reviewConversationId: 'RC-new-explicit' },
        resumed: false,
      });
      await click(state === 'CLOSED' ? '开始新对话' : '开始对话');
      expect(start).toHaveBeenCalledTimes(1);
      expect(editor().value).toBe('');
      expect(append).toHaveBeenCalledTimes(1);
    } else {
      expect(editor().value).toBe('');
      expect(button('发送消息').disabled).toBe(true);
      await type('用户另行提出的新问题');
      await click('发送消息');
      expect(append).toHaveBeenCalledTimes(2);
      expect(append.mock.calls[1][2].requestId).not.toBe(original.requestId);
      expect(append.mock.calls[1][2].userMessage).toBe('用户另行提出的新问题');
      expect(readUnconfirmedReviewChats('work-item:WI-1')[0].request).toEqual(
        original,
      );
    }
    expect(record.textContent).toContain('结果未知');
    expect(workingRefresh).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  },
);
