// Pre-authored example snapshots. No business state or model execution.
export const exampleUnderstanding = {
  initial:
    '当前资料支持把条件 X 与标准 A 的描述范围联系起来。所述措施针对条件 X，但对象记录能否证明满足具体子集和实施前提仍待核实。条件 Y 的触发与可能机理应独立分析，不能因为共同提到 FMC 而归为同一问题。',
  revised:
    '本轮核对明确：位置 P1 的记录支持软件标准 A，但不等于整项措施已经完成。修订新增的子集尚无对象记录证明。条件 X 的措施针对性仍成立，适用前提仍受限制；条件 Y 保持独立分析。需补充子集识别和措施执行记录，才能进一步判断对象状态。',
};

import fixture from './data/example.json';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
import type {
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';
export function exampleReading(revised: boolean): AssessmentReadingResult {
  return {
    resultRef: `EXAMPLE:mf-a:${revised ? 'revised' : 'initial'}`,
    resultRevision: revised ? 2 : 1,
    scope: { kind: 'ENGINEERING_MATTER', matterId: 'EXAMPLE:mf-a' },
    candidateOnly: true,
    content: {
      schemaVersion: 'wiselink.3_1.assessment_reading.v1',
      headline: revised
        ? '标准记录得到澄清，措施完成仍待核'
        : '围绕条件 X 形成有边界的初始认识',
      listBrief: revised
        ? exampleUnderstanding.revised
        : exampleUnderstanding.initial,
      lead: revised
        ? exampleUnderstanding.revised
        : exampleUnderstanding.initial,
      claims: [
        {
          claimId: 'scope',
          text: '条件 X 与 Y 保持独立分析，共同背景不能证明同一机理或同一措施范围。',
          basis: 'CONDITIONAL_INFERENCE',
          premises: [
            {
              evidenceRef: 'EXAMPLE:background',
              role: 'LIMITS',
              explanation: '调查背景保留两种条件的区别。',
              limitation: '未证明条件 Y 已解决。',
            },
          ],
        },
        {
          claimId: 'execution',
          text: revised
            ? 'P1 记录反映标准 A；子集身份和措施执行情况仍未核实。'
            : '具体子集、对象构型与执行记录尚待取得。',
          basis: 'CONDITIONAL_INFERENCE',
          premises: revised
            ? [
                {
                  evidenceRef: 'EXAMPLE:engineer',
                  role: 'SUPPORTS',
                  explanation: '本轮工程师提供标准字段。',
                  limitation: '标准字段不等于整项措施完成。',
                },
              ]
            : [],
        },
      ],
      decisiveClaimIds: ['scope', 'execution'],
    },
    evidence: [
      {
        evidenceRef: 'EXAMPLE:background',
        title: 'FTD R3 调查背景 · 预置样例',
        versionLabel: 'R3',
        excerpt: fixture.sources['ftd-r3-s2'].text,
        kind: 'DOCUMENT_PASSAGE',
        workItemId: 'EXAMPLE:ftd-r3',
        documentVersionId: 'EXAMPLE:ftd-r3',
        sourceRefId: 'ftd-r3-s2',
        locator: fixture.sources['ftd-r3-s2'].section,
      },
      ...(revised
        ? [
            {
              evidenceRef: 'EXAMPLE:engineer',
              title: '工程师补充 · 预置样例',
              versionLabel: null,
              excerpt: '位置 P1 记录反映标准 A。',
              kind: 'ENGINEER_STATEMENT' as const,
              origin: 'REVIEW_CONVERSATION' as const,
              reviewConversationId: 'EXAMPLE:review',
              reviewTurnId: 'EXAMPLE:turn1',
              engineerSuppliedInputId: 'EXAMPLE:input1',
              recordedAt: '2026-09-10T00:00:00Z',
            },
          ]
        : []),
    ],
  };
}
export const exampleReviewTurn: ReviewTurnReadModel = {
  reviewTurnId: 'EXAMPLE:turn1',
  turnNo: 1,
  requestId: 'EXAMPLE:no-request',
  inputRevision: 1,
  purpose: 'CHAT',
  userMessage:
    '这个位置已经换过计算机，记录上是标准 A，是否就可以认为改进已经完成？',
  engineerSuppliedInput: {
    engineerSuppliedInputId: 'EXAMPLE:input1',
    inputType: 'ENGINEER_TEXT',
    adoptionStatus: 'CANDIDATE_UNADOPTED',
    text: '这个位置已经换过计算机，记录上是标准 A，是否就可以认为改进已经完成？',
    attachmentRefs: [],
  },
  attachmentRefs: [],
  createdAt: '2026-09-10T00:00:00Z',
  assistantCandidate: {
    responseType: 'ANSWER',
    answer:
      '记录支持软件标准 A；整项措施完成还需要执行证据。新修订增加的子集条件仍待核实。条件 Y 不因此自动得到解释。',
    sourceRefs: [],
    missingInputs: ['子集身份', '措施执行记录', '条件 Y 的独立调查依据'],
    candidateEvidenceRefs: [],
    reviewActionDraft: null,
    affectedItemIds: [],
    warnings: [],
    actionAttemptRef: 'EXAMPLE:NOT_EXECUTED',
    completedAt: '2026-09-10T00:00:00Z',
    provenance: {
      runtimeAppId: 'app_17c3zn24kv2',
      profileRef: 'wiselink-engineering',
      modelVersion: 'EXAMPLE_NOT_EXECUTED',
      promptVersion: 'PREAUTHORED',
      skillVersion: 'PREAUTHORED',
      toolVersions: {},
      resultContentHash: 'EXAMPLE_NOT_EXECUTED',
    },
  },
};
export const exampleReviewConversation: ReviewConversationReadModel = {
  schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
  reviewConversationId: 'EXAMPLE:review',
  workItemId: 'EXAMPLE:sb-r1',
  startedAtRevision: 1,
  lastSyncedRevision: 1,
  currentWorkItemRevision: 1,
  currentRevisionSynced: true,
  status: 'CLOSED',
  createdAt: '2026-09-10T00:00:00Z',
  lastActiveAt: '2026-09-10T00:00:00Z',
  closedAt: '2026-09-10T00:00:00Z',
  turns: [exampleReviewTurn],
};
