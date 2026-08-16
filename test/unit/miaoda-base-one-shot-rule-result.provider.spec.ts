import type { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import {
  BASE_ONE_SHOT_RESULT_CAPABILITY,
  BASE_ONE_SHOT_RESULT_RECORD_ID,
  MiaodaBaseOneShotRuleResultProvider,
} from '../../server/modules/canonical-host/miaoda-base-one-shot-rule-result.provider';

const PACKAGE_ID = 'PACKAGE-TEST';
const PACKAGE_SHA = `sha256:${'a'.repeat(64)}`;
const OUTPUT_FIELD = '综合评估草稿｜DeepSeek-V4｜DEV.输出结果';

describe('MiaodaBaseOneShotRuleResultProvider', () => {
  it('reads the exact record with getRecord only and returns validated N/N bytes', async () => {
    const capability = fakeCapability(record());
    const provider = new MiaodaBaseOneShotRuleResultProvider(
      capability as unknown as CapabilityService,
    );

    const result = await provider.readResult({
      workItem: workItem(),
      actionAttemptId: 'ATT-HOST-PERSIST-1',
      expectedRevision: 9,
    });

    expect(capability.calls).toEqual([
      {
        capabilityId: BASE_ONE_SHOT_RESULT_CAPABILITY,
        action: 'getRecord',
        input: { recordID: BASE_ONE_SHOT_RESULT_RECORD_ID },
      },
    ]);
    expect(result).toMatchObject({
      sourceResultId:
        'base://TWOVbMcJBaMvlDsvY5GceKibn7d/tblV8mJeyvVZcthC/' +
        'recvsrpBvPFAIC@TRANSPORT-TEST',
      workItemId: 'WI-TEST',
      documentVersionId: 'DV-TEST',
      packageId: PACKAGE_ID,
      packageArtifactSha256: PACKAGE_SHA,
      criterionSetId: 'CRITERION-SET-TEST',
      criterionCount: 2,
      evaluationItemCount: 2,
      unresolvedCount: 1,
      sourceBoundCandidateCount: 1,
    });
    expect(Buffer.from(result.artifactBytes).toString('utf8')).toBe(
      outputText(),
    );
  });

  it('fails explicitly when the official capability call fails', async () => {
    const capability = fakeCapability(record(), new Error('PLUGIN_DOWN'));
    const provider = new MiaodaBaseOneShotRuleResultProvider(
      capability as unknown as CapabilityService,
    );

    await expect(
      provider.readResult({
        workItem: workItem(),
        actionAttemptId: 'ATT-HOST-PERSIST-2',
        expectedRevision: 9,
      }),
    ).rejects.toThrow('BASE_ONE_SHOT_CAPABILITY_READ_FAILED');
    expect(capability.calls[0]?.action).toBe('getRecord');
  });

  it('rejects an empty AI output before an artifact can be returned', async () => {
    const value = record();
    value.record[OUTPUT_FIELD] = null;
    const provider = providerFor(value);

    await expect(read(provider)).rejects.toThrow('BASE_ONE_SHOT_OUTPUT_EMPTY');
  });

  it('rejects any Base transport state other than the owner-defined READY', async () => {
    const value = record();
    value.record['处理状态'] = 'SUCCEEDED';
    const provider = providerFor(value);

    await expect(read(provider)).rejects.toThrow(
      'BASE_ONE_SHOT_RESULT_NOT_READY',
    );
  });

  it('rejects packet drift before consuming the result', async () => {
    const value = record();
    const packet = packetValue() as Record<string, unknown>;
    packet.unexpected = true;
    value.record['LLM输入'] = { text: JSON.stringify(packet) };
    const provider = providerFor(value);

    await expect(read(provider)).rejects.toThrow(
      'BASE_ONE_SHOT_INPUT_PACKET_DRIFT',
    );
  });

  it('rejects extra output fields instead of accepting a loose summary', async () => {
    const value = record();
    const output = JSON.parse(outputText()) as Record<string, unknown>;
    output.unexpected = true;
    value.record[OUTPUT_FIELD] = { text: JSON.stringify(output) };
    const provider = providerFor(value);

    await expect(read(provider)).rejects.toThrow(
      'BASE_ONE_SHOT_OUTPUT_TOP_LEVEL_SHAPE_INVALID',
    );
  });
});

function providerFor(value: ReturnType<typeof record>) {
  return new MiaodaBaseOneShotRuleResultProvider(
    fakeCapability(value) as unknown as CapabilityService,
  );
}

function read(provider: MiaodaBaseOneShotRuleResultProvider) {
  return provider.readResult({
    workItem: workItem(),
    actionAttemptId: 'ATT-HOST-PERSIST',
    expectedRevision: 9,
  });
}

function fakeCapability(value: unknown, error?: Error) {
  const calls: Array<{
    capabilityId: string;
    action: string;
    input: unknown;
  }> = [];
  return {
    calls,
    load(capabilityId: string) {
      return {
        async call(action: string, input: unknown) {
          calls.push({ capabilityId, action, input });
          if (error) throw error;
          return value;
        },
      };
    },
  };
}

function record() {
  return {
    id: BASE_ONE_SHOT_RESULT_RECORD_ID,
    record: {
      LLM输入: { text: JSON.stringify(packetValue()) },
      [OUTPUT_FIELD]: { text: outputText() },
      处理状态: 'READY',
      ActionAttemptId: { text: 'ATT-BASE-TEST' },
      TransportId: { text: 'TRANSPORT-TEST' },
      WorkItemId: { text: 'WI-TEST' },
      ExpectedRevision: 9,
      CriterionCount: 2,
    } as Record<string, unknown>,
  };
}

function packetValue() {
  return {
    purpose: 'ONE_SHOT_JOB_AID_DYNAMIC_N_CANDIDATE',
    correlation: {
      transportId: 'TRANSPORT-TEST',
      workItemId: 'WI-TEST',
      actionAttemptId: 'ATT-BASE-TEST',
      expectedRevision: 9,
      documentVersionId: 'DV-TEST',
    },
    operatorInstruction: [],
    subjectContext: {
      unifiedParsedPackage: {
        documentVersionId: 'DV-TEST',
        packageId: PACKAGE_ID,
        artifactHash: PACKAGE_SHA,
      },
    },
    parsedSource: {},
    jobAidContext: {
      identity: {
        criterionSet: { criterionSetId: 'CRITERION-SET-TEST' },
      },
      currentAssessment: { applicabilityOverall: '待核实' },
      criterionTable: {
        columns: ['criterionId'],
        rows: [['RULE-1'], ['RULE-2']],
        rowCount: 2,
      },
    },
    expectedSelfCheck: {
      criterionCount: 2,
    },
    responseInstruction: {
      requiredSections: [
        'correlation',
        'authorityLevel',
        'engineeringConclusion',
        'applicabilityOverall',
        'ruleResults',
        'overallSelfCheck',
        'nextRoundChecklist',
        'completionSelfCheck',
      ],
      forbiddenSections: ['overallAssessment'],
      expectedRuleCount: 2,
      expectedRuleIds: ['RULE-1', 'RULE-2'],
      outputBudget: {
        maxUtf8Bytes: 90_000,
        maxNextRoundChecklistItems: 12,
        maxNextRoundChecklistItemUtf8Bytes: 400,
      },
      ruleResultsEncoding: {
        type: 'COLUMNAR_ROWS',
        columns: [
          'ruleId',
          'result',
          'factsConsidered',
          'ruleApplication',
          'analysisSummary',
          'conclusion',
          'sourceRefs',
          'missingInputs',
          'humanReviewRequired',
        ],
        maxRowUtf8Bytes: 540,
      },
      completionSelfCheck: {
        sourcePageCount: 1,
      },
    },
  };
}

function outputText(): string {
  return JSON.stringify({
    correlation: {
      transportId: 'TRANSPORT-TEST',
      workItemId: 'WI-TEST',
      actionAttemptId: 'ATT-BASE-TEST',
      expectedRevision: 9,
      documentVersionId: 'DV-TEST',
    },
    authorityLevel: 'candidate_only',
    engineeringConclusion: null,
    applicabilityOverall: '待核实',
    ruleResults: {
      columns: [
        'ruleId',
        'result',
        'factsConsidered',
        'ruleApplication',
        'analysisSummary',
        'conclusion',
        'sourceRefs',
        'missingInputs',
        'humanReviewRequired',
      ],
      rows: [
        [
          'RULE-1',
          'WAITING_INPUT',
          [],
          '缺少输入。',
          '保持待核实。',
          '待核实',
          [],
          ['INPUT-1'],
          true,
        ],
        [
          'RULE-2',
          'CANDIDATE_PASS',
          ['FACT-1'],
          '按规则处理。',
          '来源受控。',
          '候选通过',
          ['SOURCE-1'],
          [],
          false,
        ],
      ],
    },
    overallSelfCheck: {
      ruleResultCount: 2,
      rulesWithMissingInputs: 1,
      humanReviewRequiredCount: 1,
      overallOpinionProduced: false,
      holisticSynthesisDeferredToOpenClaw: true,
    },
    nextRoundChecklist: [],
    completionSelfCheck: {
      expectedRuleCount: 2,
      sourcePageCount: 1,
      allInputRulesReturned: true,
      returnedRuleIdsMatchInputOrder: true,
      returnedRuleIdsUnique: true,
    },
  });
}

function workItem(): CanonicalWorkItemProjection {
  return {
    workItemId: 'WI-TEST',
    revision: 9,
    source: { documentVersionId: 'DV-TEST' },
    package: {
      packageId: PACKAGE_ID,
      artifact: { sha256: PACKAGE_SHA },
    },
  } as CanonicalWorkItemProjection;
}
