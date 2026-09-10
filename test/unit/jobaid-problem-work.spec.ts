import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import {
  calculateJaAcRisk,
  materializeJobAidWork,
} from '../../server/modules/canonical-host/jobaid-problem-work';
import { expandJobAidSourceSelection } from '../../server/modules/canonical-host/jobaid-problem-task';
import { JOBAID_METHOD_EVIDENCE } from '../../server/modules/canonical-host/jobaid-method-pack';

const document: AssessmentEvidence = {
  evidenceRef: 'source:dv:sr1',
  kind: 'DOCUMENT_PASSAGE',
  title: 'Synthetic test source',
  versionLabel: 'R1',
  excerpt:
    'Do not replace unless the indication persists after 5 seconds. A normal inspection does not prove that the intermittent condition has disappeared.',
  workItemId: 'WI-test',
  documentVersionId: 'dv',
  sourceRefId: 'sr1',
  locator: 'page 1-1',
};
const engineer: AssessmentEvidence = {
  evidenceRef: 'engineer-input:2',
  kind: 'ENGINEER_STATEMENT',
  origin: 'REVIEW_CONVERSATION',
  title: '合成工程师测试输入',
  versionLabel: 'Review 2',
  excerpt: '本次检查未发现异常，尚未取得连续监测。',
  reviewConversationId: 'RC',
  reviewTurnId: 'RT-2',
  engineerSuppliedInputId: 'ESI-2',
  recordedAt: '2026-09-09T00:00:00.000Z',
};
const evidence = [document, engineer, ...JOBAID_METHOD_EVIDENCE];
const context = {
  workItemId: 'WI-test',
  previous: null,
  evidence,
  readSourceRefs: evidence.map((item) => item.evidenceRef),
  capabilities: [],
  history: {
    required: false,
    priorAssessmentRefs: [],
    engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED' as const,
    limitation: null,
  },
};
function issue(issueKey: string, statement = document.excerpt) {
  return {
    issueKey,
    question: `合成问题 ${issueKey}`,
    understanding: statement,
    statements: [
      {
        claimKey: 'condition',
        text: statement,
        basis: 'SOURCE_FACT',
        premises: [
          {
            evidenceRef: document.evidenceRef,
            role: 'SUPPORTS',
            explanation: '来自测试原文的完整条件。',
            limitation: null,
          },
        ],
      },
    ],
    riskScenarios: [],
    measures: [],
    otherClassifications: [],
    openQuestions: [
      {
        question: '实际连续状态是否明确？',
        affects: '当前措施价值',
        nextEvidence: '连续记录',
        reason: '单次检查不排除间歇故障。',
      },
    ],
    requirementHandling: [],
    sourceDependencies: [document.evidenceRef],
    premiseRefs: [],
  };
}
function update(issues = [issue('a'), issue('b')]) {
  return {
    schemaVersion: 'wiselink.jobaid-problem-work.v2',
    headline: '检查正常仍不能排除间歇状态',
    listBrief: '仅有单次检查；持续状态及措施价值仍需核查。',
    understanding: '当前只能在明确的条件下理解问题。',
    decisiveIssueKeys: ['a'],
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    completionReason: '已完成本轮来源分析，当前未知明确保留。',
    changeSummary: '形成当前问题认识。',
    unchangedExplanation: '未修改的完整问题继续保留。',
    issues,
    unchangedIssueKeys: [] as string[],
    retiredIssues: [] as Array<{ issueKey: string; reason: string }>,
  };
}

describe('JobAid problem work keeps method semantics, delivery and incremental substance', () => {
  test('calculates the sixteen original matrix cells, with five grades and no other matrix substitution', () => {
    const severities = ['轻微', '重要', '严重', '灾难'];
    const likelihoods = [
      '可能',
      '不大可能',
      '不可能（极少）',
      '极不可能（极端少）',
    ];
    const scores = [
      [30, 21, 15, 9],
      [50, 35, 25, 15],
      [70, 49, 35, 21],
      [100, 70, 50, 30],
    ];
    const grades = [
      [3, 2, 1, 1],
      [4, 3, 2, 1],
      [5, 4, 3, 2],
      [5, 5, 4, 3],
    ];
    severities.forEach((severity, i) =>
      likelihoods.forEach((likelihood, j) =>
        expect(calculateJaAcRisk(severity, likelihood)).toMatchObject({
          score: scores[i][j],
          riskGrade: grades[i][j],
        }),
      ),
    );
    expect(calculateJaAcRisk('严重', null)).toEqual({
      score: null,
      riskGrade: null,
      gradeMeaning: null,
    });
    expect(() => calculateJaAcRisk('SAE Category 3', '可能')).toThrow(
      'JOBAID_RISK_CLASSIFICATION_INVALID',
    );
  });

  test('preserves long source conditions and every unaffected issue through two Review corrections', () => {
    const long = `${document.excerpt} ${'完整条件不能按字节预算截断。'.repeat(80)}`;
    const first = materializeJobAidWork(
      update([issue('a'), issue('b', long)]),
      context,
    );
    const correction = issue('a', '单次检查未见异常，仍不能据此排除间歇状态。');
    correction.statements[0].basis = 'CONDITIONAL_INFERENCE';
    correction.statements[0].premises.push({
      evidenceRef: engineer.evidenceRef,
      role: 'LIMITS',
      explanation: '工程师只报告单次观察。',
      limitation: '尚无连续监测记录。',
    } as never);
    correction.premiseRefs = [engineer.evidenceRef] as never;
    const second = materializeJobAidWork(
      { ...update([correction]), unchangedIssueKeys: ['b'] },
      { ...context, previous: first },
    );
    const third = materializeJobAidWork(
      {
        ...update([
          issue('a', '新的检查信息仍未解决持续状态，原文条件继续有效。'),
        ]),
        unchangedIssueKeys: ['b'],
      },
      { ...context, previous: second },
    );
    expect(second.issues[0].issueRef).toBe(first.issues[0].issueRef);
    expect(third.issues[0].statements[0].claimId).toBe(
      first.issues[0].statements[0].claimId,
    );
    expect(third.issues[1]).toEqual(first.issues[1]);
    expect(third.issues[1].statements[0].text).toBe(long);
    const reading = jobAidReadingResult({
      workRevisionRef: 'JAWR-3',
      workRevision: 3,
      previousWorkRevisionRef: 'JAWR-2',
      workItemId: 'WI-test',
      requestId: 'review-3',
      actionAttemptId: 'ATT-3',
      basedOnWorkItemRevision: 1,
      documentVersionId: 'dv',
      createdAt: '2026-09-09T00:00:00.000Z',
      content: third,
    });
    expect(
      reading.content.claims.find((claim) =>
        claim.claimId.includes(':issue:b:'),
      )?.text,
    ).toBe(long);
    expect(reading.content.lead).toBe(third.understanding);
  });

  test('requires a complete explicit prior-issue partition, including any retirement reason', () => {
    const first = materializeJobAidWork(update(), context);
    expect(() =>
      materializeJobAidWork(update([issue('a')]), {
        ...context,
        previous: first,
      }),
    ).toThrow('JOBAID_PRIOR_ISSUE_OMITTED:b');
    expect(() =>
      materializeJobAidWork(
        {
          ...update([issue('a')]),
          retiredIssues: [{ issueKey: 'b', reason: '' }],
        },
        { ...context, previous: first },
      ),
    ).toThrow('JOBAID_RETIRE_REASON_INVALID');
    expect(() =>
      materializeJobAidWork(
        { ...update([issue('a')]), unchangedIssueKeys: ['a', 'b'] },
        { ...context, previous: first },
      ),
    ).toThrow('JOBAID_ISSUE_PARTITION_DUPLICATE');
  });

  test('rejects unregistered or unread premises and method-only source-fact claims', () => {
    expect(() =>
      materializeJobAidWork(update(), {
        ...context,
        readSourceRefs: ['method:scope'],
      }),
    ).toThrow('JOBAID_SOURCE_NOT_DELIVERED');
    const foreign = issue('a');
    foreign.statements[0].premises[0].evidenceRef = 'source:foreign:sr1';
    expect(() => materializeJobAidWork(update([foreign]), context)).toThrow(
      'JOBAID_SOURCE_NOT_DELIVERED',
    );
    const methodOnly = issue('a');
    methodOnly.statements[0].premises[0].evidenceRef = 'method:scope';
    methodOnly.sourceDependencies = ['method:scope'];
    expect(() => materializeJobAidWork(update([methodOnly]), context)).toThrow(
      'JOBAID_SOURCE_FACT_REQUIRES_DIRECT_SOURCE',
    );
    expect(() =>
      materializeJobAidWork(
        { ...update(), roundCompletion: 'COMPLETE' },
        context,
      ),
    ).toThrow('JOBAID_OPEN_QUESTIONS_REQUIRE_QUALIFIED_COMPLETION');
  });

  test('page expansion never crosses document identities even when original locators coincide', () => {
    const samePage: AssessmentEvidence = {
      ...document,
      evidenceRef: 'source:dv:sr2',
      sourceRefId: 'sr2',
      excerpt: 'Same-page limitation.',
    };
    const otherDocument: AssessmentEvidence = {
      ...document,
      evidenceRef: 'source:other:sr2',
      documentVersionId: 'other',
      workItemId: 'WI-other',
      sourceRefId: 'sr2',
    };
    expect(
      expandJobAidSourceSelection(
        [document, samePage, otherDocument],
        [document.evidenceRef],
        'PAGE',
      ).map((item) => item.evidenceRef),
    ).toEqual([document.evidenceRef, samePage.evidenceRef]);
    expect(() =>
      expandJobAidSourceSelection(
        evidence,
        ['https://unregistered.example/'],
        'PAGE',
      ),
    ).toThrow('JOBAID_SOURCE_NOT_REGISTERED');
  });
});

it('does not promote an Aily query answer to verified source fact', () => {
  const query: AssessmentEvidence = {
    evidenceRef: document.evidenceRef, kind: 'QUERY_RECEIPT', title: 'Unverified answer',
    versionLabel: null, excerpt: document.excerpt, receiptRef: 'receipt', checkedScope: 'query',
    queriedAt: '2026-09-10T00:00:00.000Z', coverage: 'PARTIAL',
    queryProvenance: { origin: 'AILY_RETRIEVAL', queryText: 'query', status: 'COMPLETED', originalDocumentsVerified: false },
  };
  expect(() => materializeJobAidWork(update(), { ...context, evidence: [query, engineer, ...JOBAID_METHOD_EVIDENCE] })).toThrow("JOBAID_SOURCE_FACT_REQUIRES_DIRECT_SOURCE");
});
