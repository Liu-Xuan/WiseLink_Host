import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CurrentReviewConversationResponse,
  ReviewTurnReadModel,
} from '@shared/api.interface';
import { reviewUiTurn } from './fixtures/review-ui';
import {
  documentFailureAllowsReviewReadback,
  runSavedReviewReadback,
} from '../../client/src/pages/DocumentParsingPage/saved-review-readback';
import { runCanonicalDocumentParsingLoad } from '../../client/src/pages/DocumentParsingPage/document-parsing-load';

jest.mock('@client/src/api', () => ({ canonicalHost: {} }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock(
  '@client/src/features/review/continuous-review-panel.css',
  () => ({}),
);

import { SavedReviewReadbackView } from '../../client/src/pages/DocumentParsingPage/DocumentUnavailableReview';

const sourceFailure = { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' };

function readback(
  turns: ReviewTurnReadModel[] = [],
  workItemId = 'WI-SAVED',
): CurrentReviewConversationResponse {
  return {
    currentWorkItemRevision: 11,
    conversation: {
      schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
      reviewConversationId: 'CONV-SAVED',
      workItemId,
      startedAtRevision: 7,
      lastSyncedRevision: 11,
      currentWorkItemRevision: 11,
      currentRevisionSynced: true,
      status: 'ACTIVE',
      createdAt: '2026-09-05T03:00:00Z',
      lastActiveAt: '2026-09-05T06:00:00Z',
      closedAt: null,
      turns,
    },
  };
}

function render(
  response: CurrentReviewConversationResponse | null,
  error: unknown = null,
  reading = false,
): string {
  return renderToStaticMarkup(
    createElement(SavedReviewReadbackView, {
      readback: response,
      reading,
      error,
      onReload: jest.fn(),
      onRetryDocument: jest.fn(),
      onBack: jest.fn(),
    }),
  );
}

describe('saved review readback with unavailable source document', () => {
  it('cold-loads real saved FAILED readback after the document page fails, without making a page DTO', async () => {
    const failed = Object.assign(reviewUiTurn(17), {
      execution: {
        status: 'FAILED',
        attemptRef: 'ATT-SAVED',
        updatedAt: '2026-09-05T06:01:00Z',
        error: {
          code: 'SOURCE_PACKAGE_UNAVAILABLE',
          message: '原文包暂不可读',
        },
      },
    });
    const saved: CurrentReviewConversationResponse = readback([failed]);
    const onPageFresh = jest.fn();
    let eligible = false;
    await runCanonicalDocumentParsingLoad({
      isCurrent: () => true,
      readIdentity: async () => ({
        userId: 'ACTOR-SAVED',
        tenantId: 'TENANT-SAVED',
      }),
      readPage: async () => {
        throw sourceFailure;
      },
      onFresh: onPageFresh,
      onDenied: (_identity, cause) => {
        eligible = documentFailureAllowsReviewReadback(cause);
      },
      onIdentityError: jest.fn(),
      onSettled: jest.fn(),
    });
    const read = jest.fn().mockResolvedValue(saved);
    const onFresh = jest.fn();
    if (eligible) {
      await runSavedReviewReadback({
        workItemId: 'WI-SAVED',
        isCurrent: () => true,
        read,
        onFresh,
        onError: jest.fn(),
        onSettled: jest.fn(),
      });
    }

    expect(onPageFresh).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith('WI-SAVED');
    expect(onFresh).toHaveBeenCalledWith(saved);
    const html: string = render(saved);
    expect(html).toContain('原文暂时无法读取');
    expect(html).toContain('讨论接口读回的事项版本 11');
    expect(html).toContain('Turn 17');
    expect(html).toContain('执行失败');
    expect(html).toContain('<dd>FAILED</dd>');
    expect(html).toContain('SOURCE_PACKAGE_UNAVAILABLE');
    expect(html).not.toContain('请确认工作链接和访问权限');
    expect(html).not.toContain('FRESH_READ');
  });

  it.each([401, 403, 404])(
    'never enables fallback for document HTTP %s',
    (status: number) => {
      expect(documentFailureAllowsReviewReadback({ statusCode: status })).toBe(
        false,
      );
      expect(
        documentFailureAllowsReviewReadback({ response: { status } }),
      ).toBe(false);
    },
  );

  it('recognizes the SDK rejection shape but not identity errors or unknown failures', () => {
    expect(
      documentFailureAllowsReviewReadback({ response: { status: 500 } }),
    ).toBe(true);
    expect(
      documentFailureAllowsReviewReadback({
        ...sourceFailure,
        code: 'FORBIDDEN',
      }),
    ).toBe(false);
    expect(
      documentFailureAllowsReviewReadback(
        new Error('CANONICAL_PAGE_LOGIN_REQUIRED'),
      ),
    ).toBe(false);
    expect(
      documentFailureAllowsReviewReadback(new Error('unknown failure')),
    ).toBe(false);
  });

  it('does not start document or review reads when identity discovery fails', async () => {
    const readPage = jest.fn();
    const onDenied = jest.fn();
    await runCanonicalDocumentParsingLoad({
      isCurrent: () => true,
      readIdentity: async () => {
        throw sourceFailure;
      },
      readPage,
      onFresh: jest.fn(),
      onDenied,
      onIdentityError: jest.fn(),
      onSettled: jest.fn(),
    });
    expect(readPage).not.toHaveBeenCalled();
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('renders saved candidates and drafts without an operative confirmation or source button', () => {
    const turn: ReviewTurnReadModel = reviewUiTurn(14, true);
    turn.assistantCandidate!.reviewActionDraft = {
      reviewActionDraftRef: 'DRAFT-SAVED',
      baseRevision: 11,
      evaluationItemId: 'GOV-008',
      proposedStatus: 'PASS',
      resolvedGapRefs: [],
      adoptedInputRefs: [],
      sourceRefs: ['SRC-SAVED'],
      assumptions: [],
      affectedItemIds: ['GOV-008'],
      overallImpact: true,
      uncertaintyDispositions: [],
      decisionSnapshot: null,
    };
    const html: string = render(readback([turn]));
    expect(html).toContain('已保存候选 · 仅供追溯');
    expect(html).toContain('保留已有候选，等待核对。');
    expect(html).toContain('title="原文暂时无法读取 · SRC-1" disabled=""');
    expect(html).not.toContain('查看详细差异');
    expect(html).not.toContain('确认修改');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('发送并分析');
    expect(html).not.toContain('当前已采用');
  });

  it.each([401, 403, 404])(
    'hides all prior content when independent review read returns %s',
    (statusCode: number) => {
      const turn: ReviewTurnReadModel = reviewUiTurn(14, true);
      turn.engineerSuppliedInput.text = 'PRIVATE-SAVED-CONTENT';
      const html: string = render(readback([turn]), { statusCode });
      expect(html).toContain('当前事项不可访问');
      expect(html).not.toContain('PRIVATE-SAVED-CONTENT');
      expect(html).not.toContain('SRC-1');
      expect(html).not.toContain('保留已有候选');
      expect(html).not.toContain('事项版本 11');
    },
  );

  it('preserves a previously read projection on a temporary review failure and labels it as old', () => {
    const html: string = render(
      readback([reviewUiTurn(14, true)]),
      sourceFailure,
    );
    expect(html).toContain('保留已有候选，等待核对。');
    expect(html).toContain('不代表最新执行状态');
    expect(html).toContain('复核记录刷新失败');
  });

  it('keeps no-discussion and read-failure distinct without manufacturing a revision', () => {
    expect(
      render({ conversation: null, currentWorkItemRevision: 23 }),
    ).toContain('事项版本 23');
    expect(
      render({ conversation: null, currentWorkItemRevision: 23 }),
    ).toContain('独立接口未返回已保存讨论');
    const html: string = render(null, sourceFailure);
    expect(html).toContain('复核记录刷新失败');
    expect(html).not.toContain('事项版本 0');
    expect(html).not.toContain('独立接口未返回已保存讨论');
  });

  it('rejects another object even if the conversation read returned 200', async () => {
    const onFresh = jest.fn();
    const onError = jest.fn();
    await runSavedReviewReadback({
      workItemId: 'WI-SAVED',
      isCurrent: () => true,
      read: async () => readback([], 'WI-OTHER'),
      onFresh,
      onError,
      onSettled: jest.fn(),
    });
    expect(onFresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('ignores a delayed read after the route or login generation is invalidated', async () => {
    let complete!: (response: CurrentReviewConversationResponse) => void;
    const pending = new Promise<CurrentReviewConversationResponse>(
      (resolve) => {
        complete = resolve;
      },
    );
    let current = true;
    const onFresh = jest.fn();
    const onError = jest.fn();
    const onSettled = jest.fn();
    const loading = runSavedReviewReadback({
      workItemId: 'WI-SAVED',
      isCurrent: () => current,
      read: () => pending,
      onFresh,
      onError,
      onSettled,
    });
    current = false;
    complete(readback([reviewUiTurn(14, true)]));
    await loading;
    expect(onFresh).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
