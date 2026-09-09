import type {
  AppendMatterReviewScope,
  ReviewConversationReadModel,
} from '@shared/api.interface';
import {
  automaticReviewAvailable,
  reviewSubmissionIntent,
  assessmentDiscussionTurns,
  assessmentUpdateRequest,
  latestAssessmentCandidateId,
} from '../../client/src/features/review/review-submission';
import { reviewOperationErrorPresentation } from '../../client/src/features/review/continuous-review-state';
import { reviewUiTurn } from './fixtures/review-ui';

describe('explicit assessment update scope', () => {
  it('selects only answered same-scope chats after the last explicit update', () => {
    const view = conversation(true);
    view.turns = [
      { ...reviewUiTurn(1, true), purpose: 'CHAT' },
      { ...reviewUiTurn(2, true), purpose: 'UPDATE_ASSESSMENT' },
      { ...reviewUiTurn(3, true), purpose: 'CHAT' },
      { ...reviewUiTurn(4), purpose: 'CHAT' },
      {
        ...reviewUiTurn(5, true),
        purpose: 'CHAT',
        reviewScope: { kind: 'ENGINEERING_MATTER', matterId: 'other' },
      },
      reviewUiTurn(6, true),
    ];
    expect(assessmentDiscussionTurns(view).map((turn) => turn.turnNo)).toEqual([
      3,
    ]);
    expect(latestAssessmentCandidateId(view.turns)).toBe('TURN-6');
    view.turns.push({ ...reviewUiTurn(7, true), purpose: 'CHAT' });
    expect(latestAssessmentCandidateId(view.turns)).toBe('TURN-6');
  });
  it('copies reviewed IDs, version, scope and model without consuming a draft', () => {
    const view = conversation(true);
    const ids = ['TURN-3'];
    const scope: AppendMatterReviewScope = {
      kind: 'ENGINEERING_MATTER',
      matterId: 'M',
      expectedWorkingRevision: 2,
    };
    const request = assessmentUpdateRequest(
      'REQ-U',
      view,
      ids,
      'model-a',
      scope,
      'criterion-a',
    );
    ids.push('TURN-4');
    scope.expectedWorkingRevision = 9;
    view.currentWorkItemRevision = 8;
    expect(request).toMatchObject({
      purpose: 'UPDATE_ASSESSMENT',
      executionMode: 'AUTOMATIC',
      includedDiscussionTurnIds: ['TURN-3'],
      expectedInputRevision: 7,
      modelRef: 'model-a',
      reviewScope: { expectedWorkingRevision: 2 },
      selectedEvaluationItemId: 'criterion-a',
    });
    expect(request.attachmentSelection).toBeUndefined();
    expect(
      assessmentUpdateRequest('REQ-E', view, []).includedDiscussionTurnIds,
    ).toEqual([]);
  });
});

describe('new review turn automatic execution opt-in', () => {
  it('copies the exact matter basis and target claim and preserves them through an uncertain retry', () => {
    const scope: AppendMatterReviewScope = {
      kind: 'ENGINEERING_MATTER',
      matterId: 'M-1',
      expectedWorkingRevision: 4,
      targetClaimId: 'claim-a',
    };
    const pending = reviewSubmissionIntent(
      null,
      'REQ-M',
      conversation(true),
      'model-a',
      scope,
    );
    scope.expectedWorkingRevision = 5;
    scope.targetClaimId = 'claim-b';
    expect(pending.reviewScope).toEqual({
      kind: 'ENGINEERING_MATTER',
      matterId: 'M-1',
      expectedWorkingRevision: 4,
      targetClaimId: 'claim-a',
    });
    expect(
      reviewSubmissionIntent(
        pending,
        'REQ-NEXT',
        conversation(false),
        'model-b',
        scope,
      ),
    ).toBe(pending);
    expect(
      reviewSubmissionIntent(
        null,
        'REQ-NEXT',
        conversation(true),
        'model-b',
        scope,
      ).reviewScope,
    ).toEqual(scope);
  });
  it('freezes the chosen model through an uncertain retry and allows a different model only for a new request', () => {
    const first = reviewSubmissionIntent(
      null,
      'REQ-1',
      conversation(true),
      'dli/gpt-5.6-sol',
    );
    expect(first.modelRef).toBe('dli/gpt-5.6-sol');
    expect(
      reviewSubmissionIntent(
        first,
        'REQ-2',
        conversation(true),
        'miaoda/minimax-m3',
      ),
    ).toBe(first);
    expect(
      reviewSubmissionIntent(
        null,
        'REQ-2',
        conversation(true),
        'miaoda/minimax-m3',
      ).modelRef,
    ).toBe('miaoda/minimax-m3');
  });
  it('reports a rejected automatic request without implying that it was saved or queued', () => {
    expect(
      reviewOperationErrorPresentation({
        code: 'REVIEW_AUTOMATIC_EXECUTION_UNAVAILABLE',
        statusCode: 503,
      }).message,
    ).toContain('输入仍保留在编辑框中');
  });
  it('only adds AUTOMATIC for a new request with explicit Host support', () => {
    expect(reviewSubmissionIntent(null, 'REQ-NEW', conversation(true))).toEqual(
      { requestId: 'REQ-NEW', executionMode: 'AUTOMATIC' },
    );
    expect(automaticReviewAvailable(null)).toBe(false);
  });

  it.each([undefined, false, 'true', 1])(
    'keeps %s capability as ordinary save',
    (available) => {
      expect(
        reviewSubmissionIntent(null, 'REQ-NEW', conversation(available)),
      ).toEqual({ requestId: 'REQ-NEW' });
    },
  );

  it('does not enable automatic execution for a closed conversation', () => {
    const closed = conversation(true);
    closed.status = 'CLOSED';
    expect(automaticReviewAvailable(closed)).toBe(false);
  });

  it('keeps a failed automatic request unchanged if availability later becomes false', () => {
    const original = reviewSubmissionIntent(null, 'REQ-1', conversation(true));
    expect(
      reviewSubmissionIntent(original, 'IGNORED', conversation(false)),
    ).toBe(original);
    expect(original).toEqual({
      requestId: 'REQ-1',
      executionMode: 'AUTOMATIC',
    });
  });

  it('never upgrades an uncertain ordinary save into automatic execution on retry', () => {
    const saved = reviewSubmissionIntent(
      null,
      'REQ-SAVED',
      conversation(false),
    );
    expect(reviewSubmissionIntent(saved, 'IGNORED', conversation(true))).toBe(
      saved,
    );
    expect(saved).toEqual({ requestId: 'REQ-SAVED' });
    expect(
      reviewSubmissionIntent(null, 'REQ-NEXT', conversation(true)),
    ).toEqual({ requestId: 'REQ-NEXT', executionMode: 'AUTOMATIC' });
  });
});

function conversation(available: unknown): ReviewConversationReadModel {
  const model: ReviewConversationReadModel = {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: 'CONV-1',
    workItemId: 'WI-1',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    currentWorkItemRevision: 7,
    currentRevisionSynced: true,
    status: 'ACTIVE',
    createdAt: '2026-09-05T03:00:00Z',
    lastActiveAt: '2026-09-05T03:00:00Z',
    closedAt: null,
    turns: [],
  };
  return available === undefined
    ? model
    : Object.assign(model, { automaticExecutionAvailable: available });
}
