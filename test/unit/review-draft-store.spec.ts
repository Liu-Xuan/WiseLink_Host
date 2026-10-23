let mockSession: number = 1;
let mockAuthenticationRequired: boolean = false;
let mockSessionChange: () => void = () => undefined;

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalHostClientSessionAuthenticationRequired: () =>
    mockAuthenticationRequired,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockSessionChange = listener;
    return () => undefined;
  },
}));

import {
  readReviewDraft,
  subscribeReviewDraft,
  writeReviewDraft,
  readPendingReviewChat,
  writePendingReviewChat,
  readUnconfirmedReviewChats,
  retainUnconfirmedReviewChat,
} from '../../client/src/features/review/review-draft-store';

describe('unsubmitted Review draft retention', () => {
  beforeEach(() => {
    mockSession += 1;
    mockAuthenticationRequired = false;
    mockSessionChange();
  });

  it('retains text across component remount without mixing Matter or member drafts', () => {
    writeReviewDraft('matter:1', '尚未发送的构型问题', mockSession);
    writeReviewDraft('work-item:1', '单份材料的问题', mockSession);
    const unmount: () => void = subscribeReviewDraft(jest.fn());
    unmount();
    expect(readReviewDraft('matter:1')).toBe('尚未发送的构型问题');
    expect(readReviewDraft('work-item:1')).toBe('单份材料的问题');
    expect(readReviewDraft('matter:2')).toBe('');
  });

  it('clears retained text on identity change and rejects a late old-session write', () => {
    const oldSession: number = mockSession;
    writeReviewDraft('matter:1', '旧身份草稿', oldSession);
    const listener = jest.fn();
    const unsubscribe = subscribeReviewDraft(listener);
    mockSession += 1;
    mockSessionChange();
    writeReviewDraft('matter:1', '迟到旧草稿', oldSession);
    expect(readReviewDraft('matter:1')).toBe('');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not preserve or restore a draft after authentication is required', () => {
    writeReviewDraft('matter:1', '待清除的文字', mockSession);
    mockAuthenticationRequired = true;
    mockSessionChange();
    writeReviewDraft('matter:1', '不能恢复', mockSession);
    expect(readReviewDraft('matter:1')).toBe('');
    mockAuthenticationRequired = false;
    expect(readReviewDraft('matter:1')).toBe('');
  });

  it('clears only the submitted or revoked scope when its text is cleared', () => {
    writeReviewDraft('matter:1', '已提交文字', mockSession);
    writeReviewDraft('matter:2', '仍未发送', mockSession);
    writeReviewDraft('matter:1', '', mockSession);
    expect(readReviewDraft('matter:1')).toBe('');
    expect(readReviewDraft('matter:2')).toBe('仍未发送');
  });
});

it('retains the exact unconfirmed CHAT intent by scope and clears it across identity changes', () => {
  const request = {
    workItemId: 'WI-scoped',
    reviewConversationId: 'RC-scoped',
    request: {
      requestId: 'same-request',
      purpose: 'CHAT' as const,
      executionMode: 'AUTOMATIC' as const,
      userMessage: '未确认的发送',
    },
  };
  const session = mockSession;
  writePendingReviewChat('matter:pending', request, session);
  expect(readPendingReviewChat('matter:pending')).toBe(request);
  expect(readPendingReviewChat('matter:other')).toBeNull();
  mockSession += 1;
  mockSessionChange();
  expect(readPendingReviewChat('matter:pending')).toBeNull();
  writePendingReviewChat('matter:pending', request, session);
  expect(readPendingReviewChat('matter:pending')).toBeNull();
});

it('moves an unknown send only on explicit request, retaining its body and clearing it on session change', () => {
  const pending = {
    workItemId: 'WI-retained',
    reviewConversationId: 'RC-retained',
    request: {
      requestId: 'same-original',
      userMessage: '原问题',
      purpose: 'CHAT' as const,
      executionMode: 'AUTOMATIC' as const,
    },
  };
  writeReviewDraft('scope:retained', '原问题', mockSession);
  writeReviewDraft('scope:other', '其他范围草稿', mockSession);
  writePendingReviewChat('scope:retained', pending, mockSession);
  expect(readUnconfirmedReviewChats('scope:retained')).toHaveLength(0);
  retainUnconfirmedReviewChat('scope:retained', mockSession);
  expect(readPendingReviewChat('scope:retained')).toBeNull();
  expect(readUnconfirmedReviewChats('scope:retained')).toEqual([pending]);
  expect(readReviewDraft('scope:retained')).toBe('');
  expect(readReviewDraft('scope:other')).toBe('其他范围草稿');
  expect(readUnconfirmedReviewChats('scope:other')).toHaveLength(0);
  mockSession += 1;
  mockSessionChange();
  expect(readUnconfirmedReviewChats('scope:retained')).toHaveLength(0);
});
