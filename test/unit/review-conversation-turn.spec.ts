import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { reviewUiTurn } from './fixtures/review-ui';

import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }), {
  virtual: true,
});

import ReviewConversationTurn from '../../client/src/features/review/ReviewConversationTurn';

describe('ReviewConversationTurn candidate boundary', () => {
  it('keeps an exact saved-work link inside a deployed application basename', () => {
    const reviewTurn = reviewUiTurn(1, true);
    reviewTurn.assistantCandidate!.jobAidWorkingUpdate = {
      status: 'APPLIED', workRevisionRef: 'work-exact/old?value', workRevision: 2, affectedIssueKeys: ['issue-exact'],
    };
    const base = '/app/synthetic-host';
    const html = renderToStaticMarkup(createElement(StaticRouter,
      { basename: base, location: `${base}/document-versions/DV-one` },
      createElement(ReviewConversationTurn, { turn: reviewTurn, conversation: conversation(reviewTurn),
        currentRevision: 7, isCurrent: true, readOnly: true })));
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html);
    try {
      const link = [...dom.window.document.querySelectorAll('a')]
        .find((item: HTMLAnchorElement) => item.textContent?.includes('独立读取本回合'));
      expect(link).toBeDefined();
      const target = new URL(link!.getAttribute('href')!, 'https://example.invalid');
      expect(target.pathname).toBe(`${base}/knowledge`);
      expect(Object.fromEntries(target.searchParams)).toEqual({ kind: 'works', subjectKind: 'WORK_ITEM',
        subjectId: 'WI-1', workRef: 'work-exact/old?value' });
    } finally { dom.window.close(); }
  });

  it('labels chat as discussion, not a pending assessment', () => {
    const html = render({
      ...turn({ assistantCandidate: null }),
      purpose: 'CHAT',
    });
    expect(html).toContain('讨论答复尚未读回');
    expect(html).toContain('此请求不更新评估');
    expect(html).not.toContain('候选尚未读回');
  });
  it('renders a missing candidate without inventing an execution state', () => {
    const html = render(turn({ assistantCandidate: null }));

    expect(html).toContain('data-generation-state="not-read-back"');
    expect(html).toContain('候选尚未读回');
    expect(html).toContain('未返回执行状态');
    expect(html).toContain('不能据此判断是否正在运行');
    expect(html).toContain('工程师输入已经记录，候选结果尚未返回');
    expect(html).not.toContain('候选生成中');
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

    expect(html).toContain('data-generation-state="candidate-ready"');
    expect(html).toContain('候选已生成 · 未采纳');
    expect(html).toContain(`title="${sourceRef}"`);
    expect(html).toContain('候选输入，尚未采纳');
    expect(html).not.toContain('确认修改');
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
    expect(explicitConfirmation).toContain('确认后保存工程师复核记录，并安排受影响项目更新综合');
    expect(explicitConfirmation).toContain('候选已生成 · 未采纳');
    const chat = render({ ...reviewTurn, purpose: 'CHAT' });
    expect(chat).toContain('讨论答复');
    expect(chat).not.toContain('查看详细差异');
    expect(chat).not.toContain('确认修改');
    const previousCandidate = renderToStaticMarkup(
      createElement(ReviewConversationTurn, {
        turn: reviewTurn,
        conversation: conversation(reviewTurn),
        currentRevision: 7,
        isCurrent: false,
        assessmentCurrent: true,
        busy: false,
        confirming: false,
        rejected: false,
        onBeginConfirm: () => undefined,
        onCancelConfirm: () => undefined,
        onRejectDraft: () => undefined,
        onConfirm: () => undefined,
        onLocateSourceRef: () => undefined,
      }),
    );
    expect(previousCandidate).toContain('查看详细差异');
  });
});

function render(reviewTurn: ReviewTurnReadModel, confirming = false): string {
  const context = conversation(reviewTurn);
  const original = structuredClone({ reviewTurn, context });
  const actions = { onBeginConfirm: jest.fn(), onCancelConfirm: jest.fn(),
    onRejectDraft: jest.fn(), onConfirm: jest.fn(), onLocateSourceRef: jest.fn() };
  const html = renderToStaticMarkup(
    createElement(ReviewConversationTurn, {
      turn: reviewTurn,
      conversation: context,
      currentRevision: 7,
      isCurrent: true,
      busy: false,
      confirming,
      rejected: false,
      ...actions,
    }),
  );
  // Rendering a candidate or its confirmation detail is not an adoption action.
  expect({ reviewTurn, context }).toEqual(original);
  for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  return html;
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
