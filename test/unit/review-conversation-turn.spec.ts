import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }), {
  virtual: true,
});

import ReviewConversationTurn from '../../client/src/features/review/ReviewConversationTurn';

describe('ReviewConversationTurn candidate boundary', () => {
  it('renders a pending turn without implying adoption or revision progress', () => {
    const html = render(turn({ assistantCandidate: null }));

    expect(html).toContain('data-generation-state="pending"');
    expect(html).toContain('候选生成中');
    expect(html).toContain('事项 current 与 revision');
    expect(html).not.toContain('确认修改');
  });

  it('renders a completed candidate with clickable SourceRef and runtime provenance', () => {
    const sourceRef =
      'urn:techpub:source-ref:v1:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const html = render(
      turn({
        assistantCandidate: {
          responseType: 'SOURCE_LINK',
          answer: '仅依据列出的原文来源形成候选。',
          sourceRefs: [sourceRef],
          missingInputs: [],
          candidateEvidenceRefs: [],
          reviewActionDraft: null,
          affectedItemIds: [],
          warnings: ['candidate_only'],
          actionAttemptRef: 'attempt-review-001-long-reference',
          provenance: {
            runtimeAppId: 'app_17c3zn24kv2',
            profileRef: 'wiselink-engineering',
            modelVersion: 'model-1',
            promptVersion: 'prompt-1',
            skillVersion: 'skill-1',
            toolVersions: { host: 'tool-1' },
            resultContentHash: 'hash-1',
          },
          completedAt: '2026-09-04T08:00:00.000Z',
        },
      }),
    );

    expect(html).toContain('data-generation-state="completed"');
    expect(html).toContain('候选已生成 · 未采纳');
    expect(html).toContain(`title="${sourceRef}"`);
    expect(html).toContain('候选阶段没有采纳输入、修改 current 或推进事项版本');
    expect(html).toContain('Model model-1 · Skill skill-1');
  });

  it('requires a separate detail step before exposing draft confirmation', () => {
    const reviewTurn = turn({
      assistantCandidate: {
        responseType: 'REVIEW_ACTION_DRAFT',
        answer: '形成一份待确认草稿。',
        sourceRefs: ['SRC-P9'],
        missingInputs: [],
        candidateEvidenceRefs: [],
        reviewActionDraft: {
          reviewActionDraftRef: 'draft-1',
          baseRevision: 7,
          evaluationItemId: 'criterion-1',
          proposedStatus: 'PASS',
          resolvedGapRefs: [],
          adoptedInputRefs: [],
          sourceRefs: ['SRC-P9'],
          assumptions: [],
          affectedItemIds: ['criterion-1'],
          overallImpact: true,
          uncertaintyDispositions: [],
          decisionSnapshot: null,
        },
        affectedItemIds: ['criterion-1'],
        warnings: ['candidate_only'],
        actionAttemptRef: 'attempt-review-draft-1',
        provenance: {
          runtimeAppId: 'app_17c3zn24kv2',
          profileRef: 'wiselink-engineering',
          modelVersion: 'model-1',
          promptVersion: 'prompt-1',
          skillVersion: 'skill-1',
          toolVersions: { host: 'tool-1' },
          resultContentHash: 'hash-draft-1',
        },
        completedAt: '2026-09-04T08:00:00.000Z',
      },
    });

    const preview = render(reviewTurn);
    const explicitConfirmation = render(reviewTurn, true);

    expect(preview).toContain('查看详细差异');
    expect(preview).not.toContain('确认修改');
    expect(explicitConfirmation).toContain('确认修改');
    expect(explicitConfirmation).toContain('不会立即得到完成结果');
  });
});

function render(reviewTurn: ReviewTurnReadModel, confirming = false): string {
  return renderToStaticMarkup(
    createElement(ReviewConversationTurn, {
      turn: reviewTurn,
      conversation: conversation(reviewTurn),
      currentRevision: 7,
      isCurrent: true,
      busy: false,
      confirming,
      rejected: false,
      onBeginConfirm: () => undefined,
      onCancelConfirm: () => undefined,
      onRejectDraft: () => undefined,
      onConfirm: () => undefined,
      onLocateSourceRef: () => undefined,
    }),
  );
}

function conversation(
  reviewTurn: ReviewTurnReadModel,
): ReviewConversationReadModel {
  return {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: 'conversation-1',
    workItemId: 'WI-1',
    startedAtRevision: 7,
    lastSyncedRevision: 7,
    currentWorkItemRevision: 7,
    currentRevisionSynced: true,
    status: 'ACTIVE',
    createdAt: '2026-09-04T07:00:00.000Z',
    lastActiveAt: '2026-09-04T08:00:00.000Z',
    closedAt: null,
    turns: [reviewTurn],
  };
}

function turn(
  input: Pick<ReviewTurnReadModel, 'assistantCandidate'>,
): ReviewTurnReadModel {
  return {
    reviewTurnId: 'turn-1',
    turnNo: 1,
    requestId: 'request-1',
    inputRevision: 7,
    userMessage: '请核对当前来源。',
    engineerSuppliedInput: {
      engineerSuppliedInputId: 'input-1',
      inputType: 'ENGINEER_TEXT',
      adoptionStatus: 'CANDIDATE_UNADOPTED',
      text: '请核对当前来源。',
      attachmentRefs: [],
    },
    attachmentRefs: [],
    assistantCandidate: input.assistantCandidate,
    createdAt: '2026-09-04T07:30:00.000Z',
  };
}
