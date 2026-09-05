import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';

import {
  continuousReviewControls,
  continuousReviewPresentation,
  reviewOperationErrorPresentation,
  reviewErrorRevokesReadback,
  reviewReadbackMessage,
  reviewSourceRefLabel,
  reviewTurnGroups,
  shouldAutoRefreshReviewTurn,
} from '../../client/src/features/review/continuous-review-state';

describe('continuous review client state', () => {
  it('allows draft editing during a read-only refresh while keeping writes serialized', () => {
    const view = continuousReviewPresentation(conversation('ACTIVE', true));

    expect(continuousReviewControls(view, false, true, false)).toEqual({
      editorDisabled: false,
      actionsDisabled: true,
    });
    expect(continuousReviewControls(view, false, false, false)).toEqual({
      editorDisabled: false,
      actionsDisabled: false,
    });
  });

  it.each([true, false])(
    'locks editing and duplicate actions during a real write (refreshing=%s)',
    (refreshing: boolean) => {
      const view = continuousReviewPresentation(conversation('ACTIVE', true));

      expect(continuousReviewControls(view, true, refreshing, false)).toEqual({
        editorDisabled: true,
        actionsDisabled: true,
      });
    },
  );

  it('does not turn refresh-time editing into a permission or revision bypass', () => {
    const active = continuousReviewPresentation(conversation('ACTIVE', true));
    expect(continuousReviewControls(active, false, false, true)).toEqual({
      editorDisabled: true,
      actionsDisabled: true,
    });
    const contexts: Array<ReviewConversationReadModel | null> = [
      null,
      conversation('CLOSED', true),
      conversation('STALE_CONTEXT', false),
      conversation('ACTIVE', false),
    ];
    for (const context of contexts) {
      expect(
        continuousReviewControls(
          continuousReviewPresentation(context),
          false,
          true,
          false,
        ).editorDisabled,
      ).toBe(true);
    }
  });

  it('keeps stale-read disclosure during failure and retry until a successful readback', () => {
    expect(reviewReadbackMessage(true, false)).toContain('上次读回的投影');
    expect(reviewReadbackMessage(false, true)).toContain('不代表最新执行状态');
    expect(reviewReadbackMessage(true, true)).toContain('仍显示旧投影');
    expect(reviewReadbackMessage(false, false)).toBeNull();
  });

  it('distinguishes a failed fresh-read from a failed submit without disguising authorization errors', () => {
    const failure = { statusCode: 500, code: 'INTERNAL_SERVER_ERROR' };
    expect(reviewOperationErrorPresentation(failure, 'refresh')).toMatchObject({
      title: '复核记录刷新失败',
      code: failure.code,
    });
    expect(reviewOperationErrorPresentation(failure).title).toBe(
      '复核操作未完成',
    );
    expect(
      reviewOperationErrorPresentation({ statusCode: 403 }, 'refresh').message,
    ).toContain('不可用');
    expect(
      reviewOperationErrorPresentation({ statusCode: 401 }, 'refresh').message,
    ).toContain('授权');
  });

  it('wires draft controls separately while preserving submission and revoked-access cleanup', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        '../../client/src/features/review/ContinuousReviewPanel.tsx',
      ),
      'utf8',
    );

    expect(source).toMatch(/<Textarea[\s\S]*?disabled=\{editorDisabled\}/u);
    expect(source).toContain('disabled: editorDisabled');
    expect(source).toContain("'aria-disabled': editorDisabled");
    expect(source).toContain(
      'busy || !presentation.composerEnabled || !message.trim()',
    );
    expect(source).toMatch(
      /async function appendTurn\(\)[\s\S]*?if \(\s*busy \|\|/u,
    );
    expect(source).toMatch(
      /reviewErrorRevokesReadback\(reason\)[\s\S]*?setConversation\(null\)[\s\S]*?setMessage\(''\)[\s\S]*?setFile\(null\)/u,
    );
    expect(source).toContain("captureError(reason, 'refresh')");
    expect(source).toContain('setReadFailed(true)');
    expect(source).toContain('reviewReadbackMessage(');
    expect(source).toContain('refreshing || workItemRefreshing');
    expect(source).toContain('[readCurrent, workItemRevision]');
  });

  it('clears inaccessible readback but preserves it on temporary refresh failure', () => {
    expect(reviewErrorRevokesReadback({ statusCode: 403 })).toBe(true);
    expect(
      reviewErrorRevokesReadback(
        new Error('REVIEW_CONVERSATION_LOGIN_REQUIRED'),
      ),
    ).toBe(true);
    expect(
      reviewErrorRevokesReadback({ code: 'CANONICAL_OBJECT_NOT_FOUND' }),
    ).toBe(true);
    expect(
      reviewErrorRevokesReadback({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      }),
    ).toBe(false);
    expect(
      reviewErrorRevokesReadback({
        statusCode: 409,
        code: 'REVISION_CONFLICT',
      }),
    ).toBe(false);
  });
  it('keeps a same-revision active conversation writable', () => {
    expect(continuousReviewPresentation(conversation('ACTIVE', true))).toEqual(
      expect.objectContaining({
        state: 'ACTIVE',
        stateLabel: '讨论进行中',
        composerEnabled: true,
        canStartOrSync: false,
      }),
    );
  });

  it('keeps stale turns read-only and exposes the legal synchronization action', () => {
    const view = continuousReviewPresentation(
      conversation('STALE_CONTEXT', false),
    );

    expect(view).toEqual(
      expect.objectContaining({
        state: 'STALE_CONTEXT',
        stateLabel: '上下文待同步',
        contextTitle: '事项已更新',
        composerEnabled: false,
        canStartOrSync: true,
      }),
    );
    expect(view.contextMessage).toContain('同步讨论上下文');
  });

  it('keeps a closed conversation ended without a synchronization action', () => {
    expect(continuousReviewPresentation(conversation('CLOSED', true))).toEqual(
      expect.objectContaining({
        state: 'CLOSED',
        stateLabel: '本轮已结束',
        contextTitle: '本轮复核已结束',
        composerEnabled: false,
        canStartOrSync: false,
      }),
    );
  });

  it('conservatively blocks an inconsistent unsynchronized ACTIVE projection', () => {
    expect(continuousReviewPresentation(conversation('ACTIVE', false))).toEqual(
      expect.objectContaining({
        state: 'STALE_CONTEXT',
        composerEnabled: false,
        canStartOrSync: true,
      }),
    );
  });

  it('remounts the panel at the WorkItem boundary so A state cannot leak into B', async () => {
    const source = await readFile(
      resolve(
        __dirname,
        '../../client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx',
      ),
      'utf8',
    );

    expect(source).toMatch(
      /<ContinuousReviewPanel\s+key=\{workItemId\}\s+workItemId=\{workItemId\}/u,
    );
  });

  it('forwards the Host-validated selected Criterion into the review turn request', async () => {
    const [pageSource, panelSource] = await Promise.all([
      readFile(
        resolve(
          __dirname,
          '../../client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx',
        ),
        'utf8',
      ),
      readFile(
        resolve(
          __dirname,
          '../../client/src/features/review/ContinuousReviewPanel.tsx',
        ),
        'utf8',
      ),
    ]);

    expect(pageSource).toContain(
      'selectedEvaluationItemId={selectedReviewCriterion || null}',
    );
    expect(pageSource).toContain(
      'selectedCriterionId={selectedReviewCriterion}',
    );
    expect(pageSource).toMatch(
      /const selectedReviewCriterion:\s*string\s*=\s*resolveAssessmentRuleSelection\(/u,
    );
    expect(panelSource).toMatch(
      /selectedEvaluationItemId:\s*string\s*\|\s*null;/u,
    );
    expect(panelSource).toMatch(
      /requestId,\s*userMessage,\s*selectedEvaluationItemId,/u,
    );
  });

  it('separates the newest Host turn from ordered history', () => {
    const groups = reviewTurnGroups([turn(3), turn(1), turn(2)]);

    expect(groups.current?.turnNo).toBe(3);
    expect(groups.history.map((item) => item.turnNo)).toEqual([1, 2]);
  });

  it('does not infer running state or polling from a missing candidate and a timer', () => {
    const pending = turn(1);
    const createdAt = new Date(pending.createdAt).getTime();

    expect(shouldAutoRefreshReviewTurn(pending, createdAt + 30_000)).toBe(
      false,
    );
    expect(shouldAutoRefreshReviewTurn(pending, createdAt + 6 * 60_000)).toBe(
      false,
    );
  });

  it('keeps SourceRef identity visible while abbreviating long locators', () => {
    expect(reviewSourceRefLabel('SRC-P9-EFFECTIVITY', 0)).toBe(
      'SRC-P9-EFFECTIVITY',
    );
    const label = reviewSourceRefLabel(
      'urn:techpub:source-ref:v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      1,
    );
    expect(label).toContain('urn:techpub:source-ref');
    expect(label).toContain('aaaaaaaaaaaa');
  });

  it('preserves stable Host error observability without exposing a stack', () => {
    const error = Object.assign(new Error('runtime failed'), {
      code: 'REVIEW_HOSTED_RUNTIME_FAILED',
      statusCode: 503,
      retryable: true,
      operatorAction: 'RELEASE_SUCCESSOR_ATTEMPT',
      stack: 'sensitive stack',
    });

    expect(reviewOperationErrorPresentation(error)).toEqual({
      title: '复核操作未完成',
      message: '本次复核操作未完成，当前输入仍保留。',
      code: 'REVIEW_HOSTED_RUNTIME_FAILED',
      retryable: true,
      operatorAction: 'RELEASE_SUCCESSOR_ATTEMPT',
    });
  });
});

function conversation(
  status: ReviewConversationReadModel['status'],
  currentRevisionSynced: boolean,
): ReviewConversationReadModel {
  return {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: 'conversation-browser-safe',
    workItemId: 'WI-CURRENT',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    currentWorkItemRevision: currentRevisionSynced ? 7 : 8,
    currentRevisionSynced,
    status,
    createdAt: '2026-08-30T00:00:00.000Z',
    lastActiveAt: '2026-08-30T00:00:00.000Z',
    closedAt: status === 'CLOSED' ? '2026-08-30T00:05:00.000Z' : null,
    turns: [],
  };
}

function turn(turnNo: number): ReviewTurnReadModel {
  return {
    reviewTurnId: `turn-${turnNo}`,
    turnNo,
    requestId: `request-${turnNo}`,
    inputRevision: 7,
    userMessage: `message-${turnNo}`,
    engineerSuppliedInput: {
      engineerSuppliedInputId: `input-${turnNo}`,
      inputType: 'ENGINEER_TEXT',
      adoptionStatus: 'CANDIDATE_UNADOPTED',
      text: `message-${turnNo}`,
      attachmentRefs: [],
    },
    attachmentRefs: [],
    assistantCandidate: null,
    createdAt: `2026-08-30T00:0${turnNo}:00.000Z`,
  };
}
