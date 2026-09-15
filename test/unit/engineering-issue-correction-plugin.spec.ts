import { CapabilityService } from '@lark-apaas/fullstack-nestjs-core';
import { Test } from '@nestjs/testing';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { EngineeringIssueCorrectionPluginService } from '../../server/modules/canonical-host/engineering-issue-correction-plugin.service';
import { buildMatterJobAidTask } from '../../server/modules/canonical-host/matter-jobaid-task';
import { buildEngineeringIssueCorrectionContext, summarizeEngineeringIssueCorrection } from '../../server/modules/canonical-host/engineering-issue-correction-context';

const INSTANCE_ID = 'wl-engineering-issue-correction';

function makeContext() {
  return {
    question: 'What is the torque limit for the fitting?',
    body: 'Current body citing [[EV1]].',
    correctionReason: 'Engineer flagged the torque unit as wrong.',
    evidence: [{
      evidenceRef: 'EV1', text: 'Torque limit is 45 Nm.', kind: 'DOCUMENT_PASSAGE' as const,
      title: 'AMM 12-31-00', versionLabel: 'R2', locator: '§3.2',
    }],
    relatedUnderstanding: 'Fitting installation work.',
    structuredContext: {
      riskScenarios: [], measures: [], otherClassifications: [], openQuestions: [], requirementHandling: [],
    },
    limitations: ['Method clause R1 link unconfirmed.'],
  };
}

describe('engineering issue correction plugin (isolated provider doubles)', () => {
  const call = jest.fn();
  const load = jest.fn(() => ({ call }));
  const getCapability = jest.fn(() => ({
    pluginKey: '@official-plugins/ai-text-to-json', pluginVersion: '1.0.26',
  }));
  let service: EngineeringIssueCorrectionPluginService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({ providers: [EngineeringIssueCorrectionPluginService,
      { provide: CapabilityService, useValue: { getCapability, load } }] }).compile();
    service = module.get(EngineeringIssueCorrectionPluginService);
  });
  const assertActive = jest.fn(async () => undefined);

  it('corrects only the overview and completion explanation through its bounded official instance', async () => {
    const source = makeContext();
    const context = { overview: 'Old overview [[EV1]].', completionReason: 'Open question remains.',
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS' as const, correctionReason: source.correctionReason,
      issues: [{ question: source.question, body: source.body, ...source.structuredContext,
        issueKey: 'private-issue-key' }], evidence: source.evidence, limitations: source.limitations,
      actorUserId: 'private-actor' };
    call.mockResolvedValue({ overview: 'Bounded overview [[EV1]].', completionReason: 'Still conditional.', changeSummary: 'Fix scope.' });
    const result = await service.generateOverview(context, assertActive);
    expect(load).toHaveBeenCalledWith('wl-engineering-overview-correction');
    expect(result.producer.instanceId).toBe('wl-engineering-overview-correction');
    expect(result.overview).toBe('Bounded overview [[EV1]].');
    const supplied = JSON.parse(call.mock.calls[0][1].correctionContextJson);
    expect(supplied.overview).toBe(context.overview);
    expect(supplied.issues[0].body).toBe(source.body);
    expect(JSON.stringify(supplied)).not.toContain('private-actor');
    expect(JSON.stringify(supplied)).not.toContain('private-issue-key');
    expect(assertActive).toHaveBeenCalledTimes(2);
    call.mockResolvedValueOnce({ overview: 'Bad [[UNREAD]].', completionReason: 'Unknown.', changeSummary: 's' });
    await expect(service.generateOverview(context, assertActive)).rejects.toThrow('ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED');
    call.mockResolvedValueOnce({ overview: 'Good [[EV1]].', completionReason: 'Unknown.', changeSummary: 's', roundCompletion: 'COMPLETE' });
    await expect(service.generateOverview(context, assertActive)).rejects.toThrow('ENGINEERING_CORRECTION_OUTPUT_INVALID');
  });

  it('delivers the validated body and changeSummary with OFFICIAL_PLUGIN provenance', async () => {
    call.mockResolvedValue({ requirementHandling: [], openQuestions: [], body: 'Corrected body [[EV1]].', changeSummary: 'Fixed torque unit.' });
    const result = await service.generate(makeContext(), assertActive);
    expect(result.body).toBe('Corrected body [[EV1]].');
    expect(result.changeSummary).toBe('Fixed torque unit.');
    expect(result.producer).toEqual({
      kind: 'OFFICIAL_PLUGIN', instanceId: INSTANCE_ID, pluginVersion: '1.0.26',
      actionKey: 'textToJson', concreteModel: null,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('textToJson', expect.objectContaining({ correctionContextJson: expect.any(String) }));
    expect(assertActive).toHaveBeenCalledTimes(2);
  });

  it('sends only the explicit projection to the plugin, not runtime identities', async () => {
    call.mockResolvedValue({ requirementHandling: [], openQuestions: [], body: 'b [[EV1]]', changeSummary: 's' });
    const context = { ...makeContext(), actor: 'runtime-actor-id', issueKey: 'ISS-9' } as never;
    await service.generate(context, assertActive);
    const payload = JSON.parse((call.mock.calls[0][1] as { correctionContextJson: string }).correctionContextJson);
    expect(Object.keys(payload).sort()).toEqual(
      ['body', 'correctionReason', 'evidence', 'limitations', 'question', 'relatedUnderstanding', 'structuredContext']);
    expect(Object.keys(payload.evidence[0]).sort()).toEqual(
      ['evidenceRef', 'kind', 'locator', 'text', 'title', 'versionLabel']);
    expect(JSON.stringify(payload)).not.toContain('runtime-actor-id');
    expect(JSON.stringify(payload)).not.toContain('ISS-9');
  });

  it('keeps a long changeSummary beyond 1000 characters intact', async () => {
    const long = `x`.repeat(1200);
    call.mockResolvedValue({ requirementHandling: [], openQuestions: [], body: 'b [[EV1]]', changeSummary: long });
    const result = await service.generate(makeContext(), assertActive);
    expect(result.changeSummary).toBe(long);
    expect(result.changeSummary.length).toBeGreaterThan(1000);
  });

  it('requires complete consistency collections and rejects references not delivered to this correction', async () => {
    const context = { ...makeContext(), evidence: [...makeContext().evidence,
      { ...makeContext().evidence[0], evidenceRef: 'METHOD1', kind: 'METHOD_CLAUSE' as const }] };
    const requirement = { methodRef: 'METHOD1', requirement: 'Dependency must be checked',
      conditions: ['Configuration unknown'], treatment: 'CONDITIONS_UNCONFIRMED',
      basisRefs: ['EV1'], explanation: 'Unknown is not proof of no effect.' };
    const question = { question: 'Which configuration?', affects: 'Applicability',
      nextEvidence: 'Configuration record', reason: 'Not provided' };
    call.mockResolvedValueOnce({ body: 'Conditional result [[EV1]]', changeSummary: 'Correct the assertion',
      requirementHandling: [requirement], openQuestions: [question] });
    const result = await service.generate(context, assertActive);
    expect(result.requirementHandling).toEqual([requirement]);
    expect(result.openQuestions).toEqual([question]);
    call.mockResolvedValueOnce({ body: 'Conditional result [[EV1]]', changeSummary: 's',
      requirementHandling: [{ ...requirement, basisRefs: ['EV-UNREAD'] }], openQuestions: [question] });
    await expect(service.generate(context, assertActive)).rejects.toThrow('ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED');
    call.mockResolvedValueOnce({ body: 'Conditional result [[EV1]]', changeSummary: 's' });
    await expect(service.generate(context, assertActive)).rejects.toThrow('ENGINEERING_CORRECTION_OUTPUT_INVALID');
    call.mockResolvedValueOnce({ body: 'Conditional result [[EV1]]', changeSummary: 's',
      requirementHandling: [{ ...requirement, treatment: 'APPROVED' }], openQuestions: [] });
    await expect(service.generate(context, assertActive)).rejects.toThrow('ENGINEERING_CORRECTION_OUTPUT_INVALID');
  });

  it('rejects an unconfigured or wrong-version plugin before any call', async () => {
    for (const config of [undefined,
      { pluginKey: '@other/plugin', pluginVersion: '1.0.26' },
      { pluginKey: '@official-plugins/ai-text-to-json', pluginVersion: '1.0.25' }]) {
      getCapability.mockReturnValueOnce(config);
      await expect(service.generate(makeContext(), assertActive))
        .rejects.toThrow('ENGINEERING_CORRECTION_PLUGIN_NOT_CONFIGURED');
    }
    expect(call).not.toHaveBeenCalled();
    expect(assertActive).not.toHaveBeenCalled();
  });

  it('rejects empty, duplicate or blank evidence contexts without calling', async () => {
    const cases = [
      { ...makeContext(), question: '   ' },
      { ...makeContext(), body: '' },
      { ...makeContext(), correctionReason: '' },
      { ...makeContext(), evidence: [] },
      { ...makeContext(), evidence: [{ ...makeContext().evidence[0], evidenceRef: ' ' }] },
      { ...makeContext(), evidence: [{ ...makeContext().evidence[0], text: '  ' }] },
      { ...makeContext(), evidence: [makeContext().evidence[0], { ...makeContext().evidence[0] }] },
    ];
    for (const context of cases) {
      await expect(service.generate(context, assertActive)).rejects.toThrow('ENGINEERING_CORRECTION_CONTEXT_INVALID');
    }
    expect(call).not.toHaveBeenCalled();
    expect(assertActive).not.toHaveBeenCalled();
  });

  it('rejects malformed [[... citations and unknown or approximate evidence refs', async () => {
    const malformed = [
      { body: 'Unclosed [[EV1 citation.', changeSummary: 's' },
      { body: 'Stray ]] bracket [[EV1]]', changeSummary: 's' },
    ];
    for (const output of malformed) {
      call.mockResolvedValueOnce({ requirementHandling: [], openQuestions: [], ...output });
      await expect(service.generate(makeContext(), assertActive))
        .rejects.toThrow('ENGINEERING_CORRECTION_CITATION_MALFORMED');
    }
    const notDelivered = [
      { body: 'Cites unknown [[EV2]].', changeSummary: 's' },
      { body: 'Approximate [[EV1 approximate]] ref.', changeSummary: 's' },
      { body: 'No citation at all.', changeSummary: 's' },
    ];
    for (const output of notDelivered) {
      call.mockResolvedValueOnce({ requirementHandling: [], openQuestions: [], ...output });
      await expect(service.generate(makeContext(), assertActive))
        .rejects.toThrow('ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED');
    }
  });

  it('rejects outputs with extra actor/issueKey fields, half JSON or blank fields', async () => {
    const invalidOutputs = [
      { body: 'b [[EV1]]', changeSummary: 's', actor: 'someone' },
      { body: 'b [[EV1]]', changeSummary: 's', issueKey: 'ISS-1' },
      '{"body": "trunc',
      { body: 'b [[EV1]]' },
      { body: '   ', changeSummary: 's' },
    ];
    for (const raw of invalidOutputs) {
      call.mockResolvedValueOnce(raw);
      await expect(service.generate(makeContext(), assertActive))
        .rejects.toThrow('ENGINEERING_CORRECTION_OUTPUT_INVALID');
    }
  });

  it('propagates an assertActive failure before the call without invoking the plugin', async () => {
    call.mockResolvedValue({ requirementHandling: [], openQuestions: [], body: 'b [[EV1]]', changeSummary: 's' });
    const failing = jest.fn(async () => { throw new Error('LEASE_LOST'); });
    await expect(service.generate(makeContext(), failing)).rejects.toThrow('LEASE_LOST');
    expect(call).not.toHaveBeenCalled();
  });

  it('propagates an assertActive failure after the call and returns no candidate', async () => {
    call.mockResolvedValue({ requirementHandling: [], openQuestions: [], body: 'b [[EV1]]', changeSummary: 's' });
    let checks = 0;
    const failing = jest.fn(async () => { if (++checks === 2) throw new Error('LEASE_LOST'); });
    await expect(service.generate(makeContext(), failing)).rejects.toThrow('LEASE_LOST');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('rethrows a transport error as-is exactly once without retry', async () => {
    const transport = new Error('UPSTREAM_TIMEOUT');
    call.mockRejectedValue(transport);
    await expect(service.generate(makeContext(), assertActive)).rejects.toBe(transport);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('buildEngineeringIssueCorrectionContext (host assembly)', () => {
  const evDocument: AssessmentEvidence = {
    evidenceRef: 'EV1', title: 'AMM 12-31-00', versionLabel: 'R2', excerpt: 'Torque limit is 45 Nm.',
    kind: 'DOCUMENT_PASSAGE', workItemId: null, documentVersionId: 'docv-1', sourceRefId: 'src-1', locator: '§3.2',
  };
  const evStatement: AssessmentEvidence = {
    evidenceRef: 'EV2', title: 'Engineer statement', versionLabel: null, excerpt: 'Unit was wrong.',
    kind: 'ENGINEER_STATEMENT', origin: 'REVIEW_CONVERSATION', reviewConversationId: 'rc-1',
    reviewTurnId: 'rt-1', engineerSuppliedInputId: 'esi-1', recordedAt: '2026-09-01T00:00:00.000Z',
  };
  const PRIVATE_OTHER_BODY = 'OTHER_ISSUE_BODY_PRIVATE_MARKER';
  function makeIssue(issueKey: string, body: string) {
    return {
      issueKey, issueRef: `ref-${issueKey}`, question: `question ${issueKey}`, body,
      riskScenarios: [], measures: [], otherClassifications: [], openQuestions: [],
      requirementHandling: [], sourceDependencies: [], premiseRefs: [],
    };
  }
  function makeRevision(overrides?: {
    issueKey?: string; issueBody?: string; overviewStatus?: 'NOT_AVAILABLE' | 'CURRENT' | 'STALE';
  }) {
    const issues = [
      makeIssue('ISS-1', `${PRIVATE_OTHER_BODY} [[EV1]]`),
      makeIssue('ISS-2', overrides?.issueBody ?? 'Target issue body [[EV2]] and [[EV1]].'),
    ];
    const work = {
      schemaVersion: 'wiselink.jobaid-problem-work.v3' as const,
      headline: 'headline', listBrief: 'brief', understanding: 'current understanding',
      decisiveIssueKeys: ['ISS-1'], overviewStatus: overrides?.overviewStatus ?? 'CURRENT',
      issues, roundCompletion: 'IN_PROGRESS' as const, completionReason: 'r', changeSummary: 's',
      unchangedExplanation: 'u',
      methodBinding: { packRef: 'pack-1', version: 'v1', sources: [],
        attachment5: 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED' as const },
      evidence: [], readSourceRefs: [], capabilities: [],
      historyReview: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED' as const, limitation: null },
    };
    return {
      matterWorkRevisionId: 'work-ref-1', matterId: 'matter-1', workingRevision: 3,
      basedOnMatterRevisionId: 'matter-rev-1', updateKind: 'CORRECTION' as const, changeSummary: 's',
      substantiveResultRef: null, substantiveResultRevision: null,
      state: {
        schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1' as const,
        focus: { question: 'matter focus', targetRefs: [] }, substantiveResult: null,
        openQuestions: [], reviewConditions: [], substantiveInputs: [], coverage: [], problemWork: work,
      },
      change: { changedBecause: null, addedClaimIds: [], replacedClaimIds: [], retiredClaims: [],
        explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] },
      source: null, createdAt: '2026-09-14T00:00:00.000Z',
    };
  }
  const baseInput = {
    expectedWorkRef: 'work-ref-1', expectedWorkRevision: 3, issueKey: 'ISS-2',
    correctionReason: 'Torque unit correction.',
    deliveredEvidence: [evDocument, evStatement],
    limitations: ['limit one'],
  };

  it.each(['CURRENT', 'STALE', 'NOT_AVAILABLE'] as const)('passes %s overview status with the exact prior work into the next Matter task', overviewStatus => {
    const previous = makeRevision({ overviewStatus });
    const task = buildMatterJobAidTask({ matterId: previous.matterId, matterRevisionId: 'matter-rev-2',
      actorUserId: 'actor-1', title: 'Recompute overview', inputs: [], previous,
      trigger: { kind: 'USER_REQUEST', requestId: 'request-1', instruction: '更新综合' } });
    expect(task.modelInput.previousWork).toMatchObject({ workRevisionRef: previous.matterWorkRevisionId,
      workRevision: previous.workingRevision, overviewStatus });
    expect(task.modelInput.previousWork?.content).toHaveProperty('overview');
    expect(task.modelInput.previousWork?.content).not.toHaveProperty('overviewStatus');
  });

  it('assembles the context from the bound work revision and delivered evidence', () => {
    const context = buildEngineeringIssueCorrectionContext({ current: makeRevision(), ...baseInput });
    expect(context.question).toBe('question ISS-2');
    expect(context.body).toBe('Target issue body [[EV2]] and [[EV1]].');
    expect(context.correctionReason).toBe('Torque unit correction.');
    expect(context.evidence).toEqual([
      { evidenceRef: 'EV1', text: 'Torque limit is 45 Nm.', kind: 'DOCUMENT_PASSAGE',
        title: 'AMM 12-31-00', versionLabel: 'R2', locator: '§3.2' },
      { evidenceRef: 'EV2', text: 'Unit was wrong.', kind: 'ENGINEER_STATEMENT',
        title: 'Engineer statement', versionLabel: null, locator: null },
    ]);
    expect(context.relatedUnderstanding).toBe('current understanding');
    expect(context.limitations).toEqual(['limit one']);
  });

  it('labels stale overview context instead of asking the correction to inherit it as current', () => {
    const context = buildEngineeringIssueCorrectionContext({
      current: makeRevision({ overviewStatus: 'STALE' }), ...baseInput });
    expect(context.relatedUnderstanding).not.toBeNull();
    expect(context.limitations).toContain('附带总体认识为旧综合，尚未覆盖当前问题工作；只供比较，不能当作已核实结论或要求本次与之保持一致。');
  });

  it('nulls relatedUnderstanding when the overview is not available', () => {
    const context = buildEngineeringIssueCorrectionContext({
      current: makeRevision({ overviewStatus: 'NOT_AVAILABLE' }), ...baseInput });
    expect(context.relatedUnderstanding).toBeNull();
  });

  it('deep-copies structured statements so the generator cannot mutate the saved work', () => {
    const revision = makeRevision();
    const work = revision.state.problemWork!;
    work.issues[1].riskScenarios.push({
      scenario: 'over-torque', conditions: [], method: 'JA_AC_R01',
      severity: { label: 'high', reason: 'r', basisRefs: ['EV1'] },
    likelihood: null, score: null, riskGrade: null, gradeMeaning: null,
    importantEvent: null, limitations: [], controlComparison: '',
    });
    const context = buildEngineeringIssueCorrectionContext({ current: revision, ...baseInput });
    expect(context.structuredContext.riskScenarios[0].severity?.basisRefs).toEqual(['EV1']);
    (context.structuredContext.riskScenarios as Array<{ severity: { basisRefs: string[] } | null }>)[0].severity!.basisRefs.push('MUTATED');
    expect(work.issues[1].riskScenarios[0].severity?.basisRefs).toEqual(['EV1']);
  });

  it('rejects a changed work binding before touching any issue body', () => {
    for (const overrides of [{ expectedWorkRef: 'work-ref-2' }, { expectedWorkRevision: 4 }]) {
      expect(() => buildEngineeringIssueCorrectionContext({ current: makeRevision(), ...baseInput, ...overrides }))
        .toThrow('ENGINEERING_CORRECTION_WORK_BINDING_CHANGED');
    }
  });

  it('rejects missing current body work and historical projections', () => {
    const noWork = makeRevision(); delete (noWork.state as { problemWork?: unknown }).problemWork;
    expect(() => buildEngineeringIssueCorrectionContext({ current: noWork, ...baseInput }))
      .toThrow('ENGINEERING_CORRECTION_CURRENT_BODY_REQUIRED');
    const historical = makeRevision();
    (historical.state.problemWork as { historicalSourceSchema?: string }).historicalSourceSchema = 'wiselink.jobaid-problem-work.v2';
    expect(() => buildEngineeringIssueCorrectionContext({ current: historical, ...baseInput }))
      .toThrow('ENGINEERING_CORRECTION_CURRENT_BODY_REQUIRED');
  });

  it('rejects an unknown issueKey without leaking other issue bodies', () => {
    expect(() => buildEngineeringIssueCorrectionContext({
      current: makeRevision(), ...baseInput, issueKey: 'ISS-404' }))
      .toThrow('ENGINEERING_CORRECTION_ISSUE_NOT_FOUND');
    try {
      buildEngineeringIssueCorrectionContext({ current: makeRevision(), ...baseInput, issueKey: 'ISS-404' });
    } catch (error) {
      expect((error as Error).message).not.toContain(PRIVATE_OTHER_BODY);
    }
  });

  it('rejects duplicate delivered evidence refs', () => {
    expect(() => buildEngineeringIssueCorrectionContext({
      current: makeRevision(), ...baseInput, deliveredEvidence: [evDocument, { ...evDocument }] }))
      .toThrow('ENGINEERING_CORRECTION_DUPLICATE_EVIDENCE');
  });

  it('rejects a target issue whose cited evidence was not delivered, without leaking other bodies', () => {
    try {
      buildEngineeringIssueCorrectionContext({
        current: makeRevision({ issueBody: 'Target cites missing [[EV3]].' }),
        ...baseInput, deliveredEvidence: [evDocument],
      });
      throw new Error('expected ENGINEERING_CORRECTION_TARGET_SOURCE_MISSING');
    } catch (error) {
      expect((error as Error).message).toBe('ENGINEERING_CORRECTION_TARGET_SOURCE_MISSING');
      expect((error as Error).message).not.toContain(PRIVATE_OTHER_BODY);
    }
  });
});


describe('Host correction difference summary', () => {
  it('does not turn a producer claim into an actual change', () => {
    const context = makeContext();
    const result = { body: context.body, ...structuredClone(context.structuredContext),
      changeSummary: 'Changed treatment to CONDITIONS_UNCONFIRMED.' };
    expect(summarizeEngineeringIssueCorrection(context, result)).toBe('目标问题的正文、要求处理及未决问题无变化。');
    result.body = 'Corrected interpretation [[EV1]].';
    expect(summarizeEngineeringIssueCorrection(context, result)).toBe('目标问题实际更新：正文。');
  });
  it('records removal of a resolved or unsupported question without claiming other fields changed', () => {
    const context = makeContext();
    context.structuredContext.openQuestions = [{ question: 'dependency?', affects: 'scope', nextEvidence: 'source', reason: 'check' }];
    expect(summarizeEngineeringIssueCorrection(context, { body: context.body,
      requirementHandling: context.structuredContext.requirementHandling, openQuestions: [] }))
      .toBe('目标问题实际更新：未决问题。');
  });
});
