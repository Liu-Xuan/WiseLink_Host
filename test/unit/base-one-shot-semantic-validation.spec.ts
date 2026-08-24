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
      'BASE_ONE_SHOT_KNOWN_CANDIDATE_DOWNGRADED',
    );
  });

  it('replaces model missing inputs with Host-declared predicate keys', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN_MISSING_INPUT', ['FACT-1'], '需要补证。', '当前无法确认。', 'conditional', ['SRC-1'], ['not.allowed'], true],
      ['RULE-2', 'CANDIDATE_PASS', ['FACT-2'], '已读取来源。', '规则条件满足。', 'pass', ['SRC-2'], [], false],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);

    const result = consumeBaseOneShotAssessmentResult(packet, output);

    expect(result.ruleResults[0].missingInputs).toEqual(['fleet.fact']);
  });

  it('does not allow a TRUE predicate to remain blocked', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN/WAITING_INPUT', ['FACT-1'], '需要补证。', '仍待机队事实。', 'conditional', ['SRC-1'], ['fleet.fact'], true],
      ['RULE-2', 'BLOCKED_MISSING_INPUT', [], '规则需要补证。', '不应在 TRUE 谓词下阻断。', 'UNKNOWN/WAITING_INPUT', [], [], false],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);
    expect(() => consumeBaseOneShotAssessmentResult(packet, output)).toThrow(
      'BASE_ONE_SHOT_TRUE_PREDICATE_BLOCKED',
    );
  });

  it('clears model-invented predicate gaps from a non-blocked TRUE row', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN/WAITING_INPUT', ['FACT-1'], '需要补证。', '仍待机队事实。', 'conditional', ['SRC-1'], ['fleet.fact'], true],
      ['RULE-2', 'WAITING_INPUT', ['FACT-2'], '已读取来源。', '工程结论仍待复核。', 'conditional', ['SRC-2'], ['model.invented'], true],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);

    const result = consumeBaseOneShotAssessmentResult(packet, output);

    expect(result.ruleResults[1]).toMatchObject({
      result: 'WAITING_INPUT',
      sourceRefs: ['SRC-2'],
      missingInputs: [],
      humanReviewRequired: true,
    });
  });

  it('forces UNKNOWN rows to request engineer review', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN/WAITING_INPUT', ['FACT-1'], '需要补证。', '仍待机队事实。', 'UNKNOWN/WAITING_INPUT', ['SRC-1'], ['fleet.fact'], false],
      ['RULE-2', 'CANDIDATE_PASS', ['FACT-2'], '已读取来源。', '规则条件满足。', 'pass', ['SRC-2'], [], false],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);
    const result = consumeBaseOneShotAssessmentResult(packet, output);

    expect(result.ruleResults[0]).toMatchObject({
      result: 'UNKNOWN/WAITING_INPUT',
      missingInputs: ['fleet.fact'],
      humanReviewRequired: true,
    });
  });

  it('rejects source references that are not bound to the criterion', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN/WAITING_INPUT', ['FACT-1'], '需要补证。', '仍待机队事实。', 'UNKNOWN/WAITING_INPUT', ['SRC-1'], ['fleet.fact'], true],
      ['RULE-2', 'CANDIDATE_PASS', ['FACT-2'], '已读取来源。', '规则条件满足。', 'pass', ['SRC-NOT-BOUND'], [], false],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);
    expect(() => consumeBaseOneShotAssessmentResult(packet, output)).toThrow(
      'BASE_ONE_SHOT_SOURCE_REF_NOT_BOUND',
    );
  });

  it('rebinds one result-cell value copied into a Host-owned ruleId cell', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-1', 'UNKNOWN/WAITING_INPUT', ['FACT-1'], '需要补证。', '仍待机队事实。', 'conditional', ['SRC-1'], ['fleet.fact'], true],
      ['RULE-2', 'CANDIDATE_PASS', ['FACT-2'], '已读取来源。', '规则条件满足。', 'pass', ['SRC-2'], [], false],
      ['NOT_APPLICABLE', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);

    const result = consumeBaseOneShotAssessmentResult(packet, output);

    expect(result.ruleResults[2]).toMatchObject({
      ruleId: 'RULE-3',
      result: 'NOT_APPLICABLE',
    });
  });

  it('still rejects a swap between valid Host-owned ruleIds', () => {
    const packet = packetWithSemantics();
    const output = candidateOutput(packet, [
      ['RULE-2', 'UNKNOWN/WAITING_INPUT', ['FACT-1'], '需要补证。', '仍待机队事实。', 'conditional', ['SRC-1'], ['fleet.fact'], true],
      ['RULE-1', 'CANDIDATE_PASS', ['FACT-2'], '已读取来源。', '规则条件满足。', 'pass', ['SRC-2'], [], false],
      ['RULE-3', 'NOT_APPLICABLE', [], '谓词为 FALSE。', '该规则不适用。', 'not_applicable', [], [], false],
    ]);

    expect(() => consumeBaseOneShotAssessmentResult(packet, output)).toThrow(
      'BASE_ONE_SHOT_RULE_MEMBERSHIP_OR_ORDER_MISMATCH',
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
