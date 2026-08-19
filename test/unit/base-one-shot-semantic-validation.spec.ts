import {
  consumeBaseOneShotAssessmentResult,
  type BaseOneShotAssessmentPacket,
} from '../../server/modules/assessment-workbench/base-one-shot-assessment.processor';

describe('dynamic candidate semantic validation', () => {
  it('rejects an all-row missing-input template when the input has usable candidates', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'BLOCKED_MISSING_INPUT', [], '按本条规则评估。', '受控事实不足。', 'UNKNOWN/WAITING_INPUT', [], [], true],
      ['RULE-2', 'BLOCKED_MISSING_INPUT', [], '按本条规则评估。', '受控事实不足。', 'UNKNOWN/WAITING_INPUT', [], [], true],
      ['RULE-3', 'BLOCKED_MISSING_INPUT', [], '按本条规则评估。', '受控事实不足。', 'UNKNOWN/WAITING_INPUT', [], [], true],
    ]);
    expect(() => consumeBaseOneShotAssessmentResult(packet, output)).toThrow(
      'BASE_ONE_SHOT_BLOCKED_WITHOUT_MISSING_INPUT',
    );
  });

  it('rejects a missing input that is not declared by the criterion', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN_MISSING_INPUT', [], '需要补证。', '当前无法确认。', 'conditional', [], ['not.allowed'], true],
      ['RULE-2', 'CANDIDATE_PASS', ['FACT-2'], '已读取来源。', '规则条件满足。', 'pass', ['SRC-2'], [], false],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);
    expect(() => consumeBaseOneShotAssessmentResult(packet, output)).toThrow(
      'BASE_ONE_SHOT_MISSING_INPUT_NOT_BOUND',
    );
  });
});

function packetWithSemantics(): BaseOneShotAssessmentPacket {
  return {
    purpose: 'ONE_SHOT_JOB_AID_DYNAMIC_N_CANDIDATE',
    correlation: {
      transportId: 'TRANSPORT-SEMANTIC',
      workItemId: 'WI-SEMANTIC',
      actionAttemptId: 'ATT-SEMANTIC',
      expectedRevision: 1,
      documentVersionId: 'DV-SEMANTIC',
    },
    operatorInstruction: [],
    subjectContext: {} as BaseOneShotAssessmentPacket['subjectContext'],
    jobAidContext: {
      identity: {},
      currentAssessment: { applicabilityOverall: '待核实' },
      structuredAssessmentContext: null,
      resourceSummary: {},
      criterionTable: {
        columns: [
          'criterionId',
          'predicateResult',
          'candidateConclusion',
          'missingPredicateKeys',
          'sourceEvidenceCandidateIds',
        ],
        rows: [
          ['RULE-1', 1, 1, ['fleet.fact'], 1],
          ['RULE-2', 0, 0, [], 2],
          ['RULE-3', 2, 3, [], 0],
        ],
        rowCount: 3,
        valueDictionaries: {
          predicateResult: ['TRUE', 'UNKNOWN', 'FALSE'],
          candidateConclusion: ['insufficient_data', 'conditional', 'pass', 'not_applicable'],
          sourceEvidenceCandidateIds: [[], ['SRC-1'], ['SRC-2']],
        },
      },
      missingInformationProjection: {
        sourceColumn: 'missingInformation',
        projectedColumn: 'missingPredicateKeys',
        fullDescriptionsOwnedByCanonicalHost: true,
        modelMayInventMissingInputs: false,
      },
      resourceTable: { columns: [], rows: [] },
      sourceEvidenceCatalog: {},
      auxiliaryContext: {},
      authorityBoundary: {},
    },
    expectedSelfCheck: {},
    responseInstruction: {
      forbiddenSections: [],
      outputBudget: {
        maxUtf8Bytes: 100000,
        maxNextRoundChecklistItems: 12,
        maxNextRoundChecklistItemUtf8Bytes: 400,
      },
      ruleResultsEncoding: {
        type: 'COLUMNAR_ROWS',
        columns: [
          'ruleId', 'result', 'factsConsidered', 'ruleApplication',
          'analysisSummary', 'conclusion', 'sourceRefs', 'missingInputs',
          'humanReviewRequired',
        ],
        maxRowUtf8Bytes: 1000,
      },
      completionSelfCheck: { sourcePageCount: 1 },
    },
  } as BaseOneShotAssessmentPacket;
}

function candidateOutput(
  packet: BaseOneShotAssessmentPacket,
  rows: unknown[][],
): string {
  return JSON.stringify({
    correlation: packet.correlation,
    authorityLevel: 'candidate_only',
    engineeringConclusion: null,
    applicabilityOverall: '待核实',
    ruleResults: {
      columns: [
        'ruleId', 'result', 'factsConsidered', 'ruleApplication',
        'analysisSummary', 'conclusion', 'sourceRefs', 'missingInputs',
        'humanReviewRequired',
      ],
      rows,
    },
    overallSelfCheck: {
      ruleResultCount: 3,
      rulesWithMissingInputs: rows.filter((row) => (row[7] as unknown[]).length > 0).length,
      humanReviewRequiredCount: rows.filter((row) => row[8] === true).length,
      overallOpinionProduced: false,
      holisticSynthesisDeferredToOpenClaw: true,
    },
    nextRoundChecklist: [],
    completionSelfCheck: {
      expectedRuleCount: 3,
      sourcePageCount: 1,
      allInputRulesReturned: true,
      returnedRuleIdsMatchInputOrder: true,
      returnedRuleIdsUnique: true,
    },
  });
}
