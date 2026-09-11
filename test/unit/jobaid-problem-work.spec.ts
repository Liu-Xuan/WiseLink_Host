import { materializeMatterJobAidCommand } from '../../server/modules/canonical-host/matter-jobaid-save';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import {
  calculateJaAcRisk,
  materializeJobAidWork,
} from '../../server/modules/canonical-host/jobaid-problem-work';
import { expandJobAidSourceSelection } from '../../server/modules/canonical-host/jobaid-problem-task';
import { JOBAID_METHOD_EVIDENCE } from '../../server/modules/canonical-host/jobaid-method-pack';
import { validateMatterProblemWork } from '../../server/modules/canonical-host/matter-problem-work';
import {
  materializeEngineeringMatterWorkingState,
  parseEngineeringMatterWorkingState,
} from '../../server/modules/canonical-host/engineering-matter-working-state';
import type { EngineeringMatterWorkingRevisionCommand } from '@shared/matter-working.interface';
import {
  matterWorkingCommand,
  type FrozenMatterReviewContext,
} from '../../server/modules/canonical-host/matter-review-candidate';

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
  test('Matter full-work proposal uses actual reads and Host-derived claim identities instead of a second summary', () => {
    const frozen: FrozenMatterReviewContext = {
      scope: {
        schemaVersion: 'wiselink.3_1.matter_review_scope.v1',
        kind: 'ENGINEERING_MATTER',
        matterId: 'MAT-test',
        basedOnMatterRevisionId: 'MR1',
        expectedWorkingRevision: 0,
        targetClaimId: null,
        inputs: [
          {
            inputId: 'WI-test',
            workItemId: 'WI-test',
            workItemRevision: 1,
            documentVersionId: 'dv',
            resultRef: null,
            resultRevision: null,
          },
        ],
      },
      title: '测试事项',
      workingState: null,
      readingEvidence: evidence,
      evidenceSources: [
        {
          evidenceRef: document.evidenceRef,
          sourceRefId: 'matter-source:1:1',
          inputId: 'WI-test',
        },
      ],
    };
    const proposal = {
      problemWork: update(),
      updateKind: 'INITIAL_SYNTHESIS' as const,
      changeSummary: '完整工作',
      nextFocus: { question: '间歇状态', targetRefs: ['target:1'] },
      claimDelta: null,
      readingPresentation: null,
      openQuestionDelta: null,
      reviewConditionDelta: null,
      coverageUpdates: [
        {
          inputRef: 'matter-input:1',
          checkedSourceRefIds: ['matter-source:1:1'],
          checkedScope: 'page 1',
          contribution: 'SUBSTANTIVE' as const,
          reason: '核对条件',
        },
      ],
    };
    const input = {
      context: frozen,
      proposal,
      requestId: 'R1',
      attemptRef: 'ATT1',
      resolvedSourceRefIds: new Set(['matter-source:1:1']),
    };
    const command = matterWorkingCommand(input);
    expect(command.nextProblemWork?.issues[0].issueRef).toBe(
      'MAT-test:issue:a',
    );
    expect(command.claimDelta?.additions[0].claimId).toBe(
      'MAT-test:issue:a:claim:condition',
    );
    expect(command.nextSubstantiveResult?.content.lead).toBe(
      command.nextProblemWork?.understanding,
    );
    expect(() =>
      matterWorkingCommand({ ...input, resolvedSourceRefIds: new Set() }),
    ).toThrow('JOBAID_SOURCE_NOT_DELIVERED');
    expect(() =>
      matterWorkingCommand({
        ...input,
        proposal: {
          ...proposal,
          readingPresentation: {
            headline: '伪摘要',
            listBrief: '伪摘要',
            lead: '伪摘要',
            decisiveClaimIds: [],
          },
        },
      }),
    ).toThrow('REVIEW_MATTER_PROBLEM_DUPLICATE_READING');
  });
  test('Matter saves complete issue work, preserves it on coverage-only updates and rejects a divergent reader', () => {
    const { workItemId: _workItemId, ...common } = context;
    const content = materializeJobAidWork(update(), {
      ...common,
      matterId: 'MAT-test',
    });
    const reading = jobAidReadingResult({
      workRevisionRef: 'MRESULT-1',
      workItemId: 'unused',
      workRevision: 1,
      previousWorkRevisionRef: null,
      requestId: 'R1',
      actionAttemptId: 'ATT1',
      basedOnWorkItemRevision: 1,
      documentVersionId: 'dv',
      createdAt: '',
      content,
    });
    reading.scope = { kind: 'ENGINEERING_MATTER', matterId: 'MAT-test' };
    reading.evidence = [document];
    const binding = {
      inputId: 'WI-test',
      workItemId: 'WI-test',
      workItemRevision: 1,
      documentVersionId: 'dv',
      resultRef: null,
      resultRevision: null,
    };
    const command: EngineeringMatterWorkingRevisionCommand = {
      requestId: 'R1',
      expectedWorkingRevision: 0,
      basedOnMatterRevisionId: 'MR1',
      updateKind: 'INITIAL_SYNTHESIS',
      changeSummary: '保存完整问题',
      nextFocus: { question: '间歇状态', targetRefs: ['target:1'] },
      claimDelta: {
        changedBecause: '已读原文',
        additions: reading.content.claims,
        replacements: [],
        retirements: [],
        explicitlyUnchangedClaimIds: [],
      },
      openQuestionDelta: null,
      reviewConditionDelta: null,
      nextSubstantiveResult: reading,
      nextProblemWork: content,
      substantiveInputs: [binding],
      coverageUpdates: [
        {
          binding,
          contribution: 'SUBSTANTIVE',
          checkedSourceRefIds: ['sr1'],
          checkedScope: 'page 1',
          reason: '条件限定',
        },
      ],
    };
    const first = materializeEngineeringMatterWorkingState({
      matterId: 'MAT-test',
      current: null,
      command,
    });
    expect(first.state.problemWork?.issues[0].issueRef).toBe(
      'MAT-test:issue:a',
    );
    expect(
      parseEngineeringMatterWorkingState(
        JSON.stringify(first.state),
        'MAT-test',
      ).problemWork,
    ).toEqual(content);
    const { nextProblemWork: _nextProblemWork, ...base } = command;
    const coverageOnly: EngineeringMatterWorkingRevisionCommand = {
      ...base,
      requestId: 'R2',
      expectedWorkingRevision: 1,
      updateKind: 'MATERIAL_INCORPORATION',
      nextFocus: null,
      claimDelta: null,
      nextSubstantiveResult: null,
      substantiveInputs: [],
      coverageUpdates: [
        {
          ...command.coverageUpdates[0],
          checkedScope: 'page 1 rechecked',
          reason: '本轮无实质变化',
        },
      ],
    };
    const second = materializeEngineeringMatterWorkingState({
      matterId: 'MAT-test',
      current: first.state,
      command: coverageOnly,
    });
    expect(second.state.problemWork).toEqual(content);
    expect(second.state.substantiveResult).toEqual(reading);
    expect(() =>
      materializeEngineeringMatterWorkingState({
        matterId: 'MAT-test',
        current: first.state,
        command: {
          ...coverageOnly,
          nextSubstantiveResult: {
            ...reading,
            resultRef: 'MRESULT-2',
            resultRevision: 2,
          },
          claimDelta: {
            changedBecause: '摘要单改',
            additions: [],
            replacements: [],
            retirements: [],
            explicitlyUnchangedClaimIds: reading.content.claims.map(
              (claim) => claim.claimId,
            ),
          },
        },
      }),
    ).toThrow('ENGINEERING_MATTER_PROBLEM_WORK_UPDATE_REQUIRED');
    const foreign = structuredClone(content);
    foreign.issues[0].issueRef = 'MAT-other:issue:a';
    expect(() =>
      validateMatterProblemWork(foreign, 'MAT-test', reading),
    ).toThrow('ENGINEERING_MATTER_PROBLEM_WORK_INVALID');
    expect(() =>
      validateMatterProblemWork(content, 'MAT-test', {
        ...reading,
        content: { ...reading.content, lead: '另一结论' },
      }),
    ).toThrow('ENGINEERING_MATTER_PROBLEM_READING_MISMATCH');
  });
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

  test('rejects unregistered or unread premises while retaining attributed method statements', () => {
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
    expect(materializeJobAidWork(update([methodOnly]), context).issues[0].statements[0])
      .toMatchObject({ basis: 'SOURCE_FACT', premises: [{ evidenceRef: 'method:scope' }] });
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

it('saves an attributed query statement without promoting its evidence or candidate status', () => {
  const query: AssessmentEvidence = {
    evidenceRef: document.evidenceRef,
    kind: 'QUERY_RECEIPT',
    title: 'Unverified answer',
    versionLabel: null,
    excerpt: document.excerpt,
    receiptRef: 'receipt',
    checkedScope: 'query',
    queriedAt: '2026-09-10T00:00:00.000Z',
    coverage: 'PARTIAL',
    queryProvenance: {
      origin: 'AILY_RETRIEVAL',
      queryText: 'query',
      status: 'COMPLETED',
      originalDocumentsVerified: false,
    },
  };
  const content = materializeJobAidWork(update(), {
    ...context,
    evidence: [query, engineer, ...JOBAID_METHOD_EVIDENCE],
  });
  const reading = jobAidReadingResult({
    workRevisionRef: 'JAWR-1', workRevision: 1, previousWorkRevisionRef: null,
    requestId: 'save-1', actionAttemptId: 'ATT-1', basedOnWorkItemRevision: 1, workItemId: 'WI-test',
    documentVersionId: 'dv', createdAt: '2026-09-11T00:00:00.000Z', content,
  });
  expect(reading.candidateOnly).toBe(true);
  expect(reading.evidence.find(item => item.evidenceRef === query.evidenceRef)).toEqual(query);
  expect(reading.content.claims[0].basis).toBe('SOURCE_FACT');
});

it('saves a new statement inside an existing issue while preserving full issue reading order', () => {
  const base = { matterId: 'MAT-order', matterRevisionId: 'MR-1', attemptRef: 'AQ-1',
    requestId: 'save-1', expectedWorkRevision: 0, previous: null,
    inputs: [{ inputId: 'WI-test', workItemId: 'WI-test', workItemRevision: 1, documentVersionId: 'dv', resultRef: null, resultRevision: null }],
    evidence, readSourceRefs: context.readSourceRefs, capabilities: context.capabilities, history: context.history };
  const command = materializeMatterJobAidCommand({ ...base, proposal: update() });
  const first = materializeEngineeringMatterWorkingState({ matterId: base.matterId, current: null, command });
  const expanded = update();
  expanded.issues[0].statements.push({ ...expanded.issues[0].statements[0], claimKey: 'added', text: '新增的局部判断仍保留条件。' });
  const second = materializeMatterJobAidCommand({ ...base, requestId: 'save-2', expectedWorkRevision: 1,
    previous: { matterWorkRevisionId: 'MWR-1', matterId: base.matterId, workingRevision: 1,
      basedOnMatterRevisionId: 'MR-1', updateKind: 'INITIAL_SYNTHESIS', changeSummary: command.changeSummary,
      substantiveResultRef: command.nextSubstantiveResult!.resultRef, substantiveResultRevision: 1,
      state: first.state, change: { changedBecause: null, addedClaimIds: [], replacedClaimIds: [], retiredClaims: [],
        explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] },
      source: null, createdAt: '2026-09-11T00:00:00Z' }, proposal: expanded });
  const saved = materializeEngineeringMatterWorkingState({ matterId: base.matterId, current: first.state, command: second });
  expect(saved.state.substantiveResult!.content.claims.map(claim => claim.claimId)).toEqual([
    'MAT-order:issue:a:claim:condition', 'MAT-order:issue:a:claim:added', 'MAT-order:issue:b:claim:condition',
  ]);
  const newerDocument = { ...document, documentVersionId: 'dv-new', evidenceRef: 'new-page', sourceRefId: 'new-source' };
  const previousRevision = { matterWorkRevisionId: 'MWR-current', matterId: base.matterId, workingRevision: 2,
    basedOnMatterRevisionId: 'MR-1', updateKind: 'CORRECTION' as const, changeSummary: second.changeSummary,
    substantiveResultRef: second.nextSubstantiveResult!.resultRef, substantiveResultRevision: 2,
    state: saved.state, change: { changedBecause: null, addedClaimIds: [], replacedClaimIds: [], retiredClaims: [],
      explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] },
    source: null, createdAt: '2026-09-11T00:00:00Z' };
  // Keep all earlier statements explicit while adding a new-version premise.
  const proposal = { ...expanded, issues: structuredClone(expanded.issues) };
  proposal.issues[0].statements[0].premises[0].evidenceRef = newerDocument.evidenceRef;
  proposal.issues[0].sourceDependencies.push(newerDocument.evidenceRef);
  const newerBase = { ...base, inputs: [{ ...base.inputs[0], documentVersionId: 'dv-new' }],
    evidence: [...evidence, newerDocument], readSourceRefs: [...context.readSourceRefs, newerDocument.evidenceRef] };
  const third = materializeMatterJobAidCommand({ ...newerBase, previous: previousRevision,
    requestId: 'save-new-version', expectedWorkRevision: 2, proposal });
  const thirdState = materializeEngineeringMatterWorkingState({ matterId: base.matterId, current: saved.state, command: third }).state;
  expect(thirdState.coverage[0].binding.documentVersionId).toBe('dv-new');
  expect(thirdState.problemWork!.evidence.some(item => item.evidenceRef === document.evidenceRef)).toBe(true);
  const fourth = materializeMatterJobAidCommand({ ...newerBase, previous: { ...previousRevision, state: thirdState, workingRevision: 3 },
    requestId: 'save-after-new-version', expectedWorkRevision: 3, proposal });
  expect(() => materializeEngineeringMatterWorkingState({ matterId: base.matterId, current: thirdState, command: fourth })).not.toThrow();
  const forged = structuredClone(fourth);
  forged.nextProblemWork!.evidence.find(item => item.evidenceRef === document.evidenceRef)!.excerpt = '伪造旧版内容';
  expect(() => materializeEngineeringMatterWorkingState({ matterId: base.matterId, current: thirdState, command: forged })).toThrow();

});


it('persists engineer-supported judgments, risk and reported measures while retaining source provenance', () => {
  const change = {
    ...issue('a', '根据现场报告评估，若报告属实则存在通讯中断风险。'),
    sourceDependencies: [engineer.evidenceRef],
    statements: [{ ...issue('a').statements[0], text: '工程师报告现场出现通讯中断。',
      premises: [{ evidenceRef: engineer.evidenceRef, role: 'SUPPORTS',
        explanation: '现场报告支持本轮条件性评估。', limitation: '尚未核对原始记录。' }] }],
    riskScenarios: [{ scenario: '通讯中断', conditions: ['现场报告属实'], method: 'JA_AC_R01',
      severity: { label: '严重', reason: '按报告的功能丧失评估。', basisRefs: [engineer.evidenceRef] },
      likelihood: { label: '不大可能', reason: '依据现场报告作定性判断，待记录核对。', basisRefs: [engineer.evidenceRef] },
      importantEvent: { event: '通讯中断', reason: '按现场报告评估情景。', basisRefs: [engineer.evidenceRef] },
      limitations: ['未取得连续监测记录'], controlComparison: '需要比较后续监测结果。' }],
    measures: [{ text: '完成检查', addresses: '核查通讯状态', limitations: ['效果待核对'],
      status: 'REPORTED_IMPLEMENTED', basisRefs: [engineer.evidenceRef] }],
  };
  const first = materializeJobAidWork({ ...update(), issues: [change] }, context);
  expect(first.issues[0].riskScenarios[0]).toMatchObject({ score: 49, riskGrade: 4 });
  expect(first.issues[0].measures[0].status).toBe('REPORTED_IMPLEMENTED');
  const next = materializeJobAidWork({ ...update(), issues: [], unchangedIssueKeys: ['a'] },
    { ...context, previous: first });
  expect(next.issues).toEqual(first.issues);
  const reading = jobAidReadingResult({ workRevisionRef: 'JAWR-2', workRevision: 2, previousWorkRevisionRef: 'JAWR-1',
    requestId: 'save-2', actionAttemptId: 'ATT-1', basedOnWorkItemRevision: 1,
    workItemId: 'WI-test', documentVersionId: 'dv', createdAt: '2026-09-11T00:00:00.000Z', content: next });
  expect(reading.candidateOnly).toBe(true);
  expect(reading.evidence.find(item => item.evidenceRef === engineer.evidenceRef)).toEqual(engineer);
  expect(() => materializeJobAidWork({ ...update(), issues: [change] },
    { ...context, readSourceRefs: [document.evidenceRef] })).toThrow('JOBAID_SOURCE_NOT_DELIVERED');
});
