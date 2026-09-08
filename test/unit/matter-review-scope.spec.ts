import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  ReviewConversationReadModel,
  ReviewMatterWorkingUpdateReceipt,
  ReviewTurnReadModel,
} from '@shared/api.interface';
import {
  assertReviewConversationScope,
  reviewSourceBinding,
  sameReviewScope,
} from '../../client/src/features/review/review-scope';
import MatterWorkingReceipt from '../../client/src/features/review/MatterWorkingReceipt';

const scope = { kind: 'ENGINEERING_MATTER' as const, matterId: 'M-1' };
const turn: ReviewTurnReadModel = {
  reviewTurnId: 'turn-1',
  turnNo: 1,
  requestId: 'REQ-1',
  inputRevision: 4,
  userMessage: '核对构型条件',
  reviewScope: scope,
  engineerSuppliedInput: {
    engineerSuppliedInputId: 'input-1',
    inputType: 'ENGINEER_TEXT',
    adoptionStatus: 'CANDIDATE_UNADOPTED',
    text: '核对构型条件',
    attachmentRefs: [],
  },
  attachmentRefs: [],
  createdAt: '2026-09-08T03:00:00Z',
  assistantCandidate: {
    responseType: 'SOURCE_LINK',
    answer: '仅作解释。',
    sourceRefs: ['task-local-ref'],
    sourceBindings: [
      {
        sourceRefId: 'task-local-ref',
        workItemId: 'member-2',
        documentVersionId: 'DV-2',
        originalSourceRefId: 'source-original-2',
      },
    ],
    missingInputs: [],
    candidateEvidenceRefs: [],
    reviewActionDraft: null,
    affectedItemIds: [],
    warnings: [],
    actionAttemptRef: 'attempt-1',
    completedAt: '2026-09-08T03:01:00Z',
    provenance: {
      runtimeAppId: 'app_17c3zn24kv2',
      profileRef: 'wiselink-engineering',
      modelVersion: 'model-1',
      promptVersion: 'prompt-1',
      skillVersion: 'skill-1',
      toolVersions: {},
      resultContentHash: 'test-fixture',
    },
  },
};
function conversation(): ReviewConversationReadModel {
  return {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: 'conversation-1',
    workItemId: 'WI-1',
    reviewScope: scope,
    startedAtRevision: 4,
    lastSyncedRevision: 4,
    currentWorkItemRevision: 4,
    currentRevisionSynced: true,
    status: 'ACTIVE',
    createdAt: '2026-09-08T03:00:00Z',
    lastActiveAt: '2026-09-08T03:00:00Z',
    closedAt: null,
    turns: [turn],
  };
}

describe('matter review scope and honest save receipt', () => {
  it('requires all returned turns to belong to the requested matter', () => {
    expect(() =>
      assertReviewConversationScope(conversation(), 'WI-1', scope),
    ).not.toThrow();
    expect(() =>
      assertReviewConversationScope(conversation(), 'WI-OTHER', scope),
    ).toThrow('OBJECT_NOT_FOUND');
    expect(() =>
      assertReviewConversationScope(conversation(), 'WI-1', {
        kind: 'ENGINEERING_MATTER',
        matterId: 'M-2',
      }),
    ).toThrow('OBJECT_NOT_FOUND');
    const mixed = {
      ...conversation(),
      turns: [...conversation().turns, { ...turn, reviewScope: undefined }],
    };
    expect(() => assertReviewConversationScope(mixed, 'WI-1', scope)).toThrow(
      'OBJECT_NOT_FOUND',
    );
    expect(sameReviewScope(undefined, { kind: 'WORK_ITEM' })).toBe(true);
    expect(sameReviewScope(undefined, scope)).toBe(false);
  });
  it('uses the Host original source binding only when exactly one mapping exists', () => {
    const binding = reviewSourceBinding(turn, 'task-local-ref');
    expect(binding).toMatchObject({
      workItemId: 'member-2',
      documentVersionId: 'DV-2',
      originalSourceRefId: 'source-original-2',
    });
    expect(reviewSourceBinding(turn, 'unknown')).toBeNull();
    const candidate = turn.assistantCandidate!;
    expect(
      reviewSourceBinding(
        {
          ...turn,
          assistantCandidate: {
            ...candidate,
            sourceBindings: [
              ...candidate.sourceBindings!,
              ...candidate.sourceBindings!,
            ],
          },
        },
        'task-local-ref',
      ),
    ).toBeNull();
  });
  it.each([
    ['UNCHANGED', false, false, '本轮回复已保存，事项认识保持不变'],
    ['APPLIED', false, false, '工作记录已保存，综合判断保持不变'],
    ['APPLIED', false, true, '核查范围已更新，认识保持不变'],
    ['APPLIED', true, true, '本轮事项认识已更新'],
    ['BASIS_CHANGED', false, false, '本轮依据已变化，候选未替换当前认识'],
  ] as const)(
    'presents %s/result=%s/coverage=%s without claiming adoption',
    (status, resultChanged, coverageChanged, label) => {
      const receipt: ReviewMatterWorkingUpdateReceipt = {
        matterId: 'M-1',
        status,
        resultChanged,
        coverageChanged,
        workingRevision: 4,
        resultRef: 'result-1',
        resultRevision: 2,
        reasonCode: null,
      };
      const html = renderToStaticMarkup(
        createElement(MatterWorkingReceipt, { receipt }),
      );
      expect(html).toContain(label);
      expect(html).toContain('正式采用与成员文档评估状态不因此推进');
      expect(html).toContain('data-result-ref="result-1"');
      expect(html).toContain('data-working-revision="4"');
    },
  );
});
