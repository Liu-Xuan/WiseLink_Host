import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildJobAidChecklistBinding } from '@server/modules/canonical-host/jobaid-checklist-binding';
import 'reflect-metadata';
import { McpServer } from '@modelcontextprotocol/server';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { JobAidWorkValidationRequest, JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { CanonicalHostOpenClawMcpService } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.service';
import { materializeJobAidWork, type JobAidWorkValidationContext } from '../../server/modules/canonical-host/jobaid-problem-work';
import { JobAidSemanticValidationError } from '../../server/modules/canonical-host/jobaid-semantic-content';
import { JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } from '../../server/modules/canonical-host/jobaid-method-pack';
import { assertJobAidWorkFence, type JobAidWorkFence } from '../../server/modules/canonical-host/jobaid-work.repository';

const source: AssessmentEvidence = {
  evidenceRef: 'source:synthetic:condition', kind: 'DOCUMENT_PASSAGE', workItemId: 'WI-validation',
  documentVersionId: 'DV-validation', sourceRefId: 'condition', locator: 'page 1', title: 'Synthetic source',
  versionLabel: 'R1', excerpt: 'Do not replace until the indication persists after five seconds.',
};
const body = '五秒条件尚未确认。';
const context: JobAidWorkValidationContext = {
  workItemId: 'WI-validation', contentValidationVersion: 'jobaid-semantic.v1', methodBinding: JOBAID_METHOD_BINDING,
  previous: null, evidence: [source, ...JOBAID_METHOD_EVIDENCE],
  readSourceRefs: [source.evidenceRef, ...JOBAID_METHOD_EVIDENCE.map((item: AssessmentEvidence) => item.evidenceRef)],
  capabilities: [],
  history: { required: false, priorAssessmentRefs: [], engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED', limitation: null },
};
function candidate(bodyQuote = body) {
  return {
    schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '持续条件仍待核查', listBrief: body,
    overview: body, roundCompletion: 'COMPLETE', completionReason: '本轮调查完整，实施尚在后续阶段。',
    changeSummary: '保留条件和实施阶段。', issues: [{
      issueKey: 'condition', question: '何时满足条件？',
      body: body + ' [[' + source.evidenceRef + ']] [[method:risk]]',
      requirementHandling: [{ methodRef: 'method:risk', requirement: '核对条件', conditions: [],
        treatment: 'LATER_BUSINESS_STAGE', basisRefs: [], explanation: '后续实施时仍须核实。',
        bodyQuote }],
    }],
  };
}
function semanticError(value: unknown): JobAidSemanticValidationError {
  try { materializeJobAidWork(value, context); }
  catch (error) {
    if (error instanceof JobAidSemanticValidationError) return error;
    throw error;
  }
  throw new Error('TEST_EXPECTED_SEMANTIC_REJECTION');
}

describe('JobAid semantic feedback', () => {
  it('preserves SAVE first error and gives paths for each wrong quote without returning authored text', () => {
    const value = candidate('PRIVATE_UNMATCHED_QUOTE');
    value.issues.push({ ...value.issues[0], issueKey: 'second',
      requirementHandling: [{ ...value.issues[0].requirementHandling[0], bodyQuote: 'OTHER_PRIVATE_QUOTE' }] });
    const error = semanticError(value);
    expect(error.message).toBe('JOBAID_SEMANTIC_REQUIREMENT_BODY_LOCATION_REQUIRED');
    expect(error.violations.map(item => item.fieldPaths)).toEqual([
      ['work.issues[0].requirementHandling[0].bodyQuote', 'work.issues[0].body'],
      ['work.issues[1].requirementHandling[0].bodyQuote', 'work.issues[1].body'],
    ]);
    expect(JSON.stringify(error.violations)).not.toMatch(/PRIVATE_UNMATCHED_QUOTE|OTHER_PRIVATE_QUOTE/);
    expect(error.omittedViolationCount).toBe(0);
  });

  it('accepts layout whitespace only; a quote in another issue cannot repair its owner or remove negation', () => {
    expect(() => materializeJobAidWork(candidate('五秒条件\n尚未确认。'), context)).not.toThrow();
    const value = candidate('五秒条件已确认。');
    value.issues.push({ ...value.issues[0], issueKey: 'other',
      body: '五秒条件已确认。 [[' + source.evidenceRef + ']] [[method:risk]]' });
    expect(semanticError(value).violations).toHaveLength(1);
    expect(semanticError(value).violations[0].fieldPaths[0]).toBe('work.issues[0].requirementHandling[0].bodyQuote');
  });

  it('bounds all diagnostics without changing historical compatibility or truncating the decision', () => {
    const value = candidate('缺失原句');
    value.issues = Array.from({ length: 40 }, (_, index: number) => ({
      ...value.issues[0], issueKey: 'issue_' + index,
    }));
    const error = semanticError(value);
    expect(error.violations).toHaveLength(32);
    expect(error.omittedViolationCount).toBe(8);
    expect(() => materializeJobAidWork(value, { ...context, contentValidationVersion: undefined })).not.toThrow();
  });
});

/** Only the persistence/authority ports are constructed; validation and SAVE materialization are real. */
function validationFixture() {
  const row = {
    attemptId: 'ATT-validation', operationRef: 'AQ-validation', taskInputHash: 'a'.repeat(64),
    workItemId: 'WI-validation', tenantId: 'tenant-validation', documentVersionId: 'DV-validation',
    inputRevision: 4, baseRevision: 4, status: 'RUNNING', reviewActivityJson: '[]',
    leaseOwner: 'service-validation', leaseToken: '00000000-0000-4000-8000-000000000001',
    leaseGeneration: 1, leaseExpiresAt: new Date('2099-01-01'), deadlineAt: new Date('2099-01-02'),
    cancelRequestedAt: null as Date | null,
  };
  const scope = { principalId: row.leaseOwner, appId: 'app_17bzc551rsg', tenantId: row.tenantId,
    workItemId: row.workItemId, attemptRef: row.operationRef, authorizationFingerprint: 'permission-validation' };
  const task = { actionAttemptId: row.attemptId, operationRef: row.operationRef,
    tenantId: row.tenantId, workItemId: row.workItemId, inputHash: row.taskInputHash,
    documentVersionId: row.documentVersionId, inputRevision: row.inputRevision, baseRevision: row.baseRevision };
  const taskInput = {
    executionMode: 'PROGRAM_AGENT_V1', contentValidationVersion: 'jobaid-semantic.v1', actorUserId: 'owner-validation',
    previousWork: null as JobAidWorkRevision | null, sourceBindings: [], sourceCatalog: context.evidence,
    initiallyDeliveredRefs: [...context.readSourceRefs],
    modelInput: { executionMode: 'PROGRAM_AGENT_V1', expectedWorkRevision: 0,
      purpose: 'INITIAL_PROBLEM_ASSESSMENT', methodBinding: context.methodBinding,
      capabilities: context.capabilities, historyReview: context.history },
  };
  const authorizedAttempt = jest.fn(async () => ({
    row: structuredClone(row), scope: structuredClone(scope), task: structuredClone(task), taskInput: structuredClone(taskInput),
  }));
  const readValidationSnapshot = jest.fn(async (input: { fence: JobAidWorkFence }) => {
    assertJobAidWorkFence(row, input.fence);
    return { reviewActivityJson: row.reviewActivityJson, previous: structuredClone(taskInput.previousWork) };
  });
  const assertSourcesAuthorized = jest.fn(async () => undefined);
  const save = jest.fn();
  const recordSourceRead = jest.fn();
  const recordWorkRead = jest.fn();
  const recordProgramProgress = jest.fn();
  const knowledge = { saved: jest.fn(async (): Promise<AssessmentEvidence[]> => []) };
  const service: CanonicalJobAidProblemService = Object.create(CanonicalJobAidProblemService.prototype);
  Object.assign(service, { authorizedAttempt, assertSourcesAuthorized, knowledge,
    work: { readValidationSnapshot, save, recordSourceRead, recordWorkRead, recordProgramProgress } });
  const request: JobAidWorkValidationRequest = { attemptRef: row.operationRef, workItemId: row.workItemId,
    leaseToken: row.leaseToken, leaseGeneration: row.leaseGeneration, expectedWorkRevision: 0,
    workJson: JSON.stringify(candidate()) };
  return { service, row, scope, taskInput, request, authorizedAttempt, readValidationSnapshot,
    assertSourcesAuthorized, knowledge, save, recordSourceRead, recordWorkRead, recordProgramProgress };
}

describe('program candidate Host preview', () => {
  it('shares SAVE materialization, preserves all input and state, and never writes or renews', async () => {
    const h = validationFixture();
    const before = JSON.stringify({ row: h.row, taskInput: h.taskInput, request: h.request });
    const result = await h.service.validateWork(h.request);
    expect(result).toMatchObject({ status: 'VALID', violations: [], omittedViolationCount: 0,
      binding: { attemptRef: h.row.operationRef, workItemId: h.row.workItemId,
        expectedWorkRevision: 0, previousWorkRevisionRef: null } });
    expect(h.authorizedAttempt).toHaveBeenNthCalledWith(1, h.row.operationRef, 'SAVE_ASSESSMENT_WORK', h.row.workItemId);
    expect(h.authorizedAttempt).toHaveBeenCalledTimes(2);
    expect(h.readValidationSnapshot).toHaveBeenCalledTimes(2);
    expect(h.assertSourcesAuthorized).toHaveBeenCalledTimes(2);
    expect(JSON.stringify({ row: h.row, taskInput: h.taskInput, request: h.request })).toBe(before);
    for (const writer of [h.save, h.recordSourceRead, h.recordWorkRead, h.recordProgramProgress])
      expect(writer).not.toHaveBeenCalled();
    expect(() => materializeJobAidWork(JSON.parse(h.request.workJson), context)).not.toThrow();
  });

  it('returns typed semantic repair only and checks a changed final candidate again', async () => {
    const h = validationFixture();
    await expect(h.service.validateWork(h.request)).resolves.toMatchObject({ status: 'VALID' });
    const changed = { ...h.request, workJson: JSON.stringify(candidate('五秒条件已确认。')) };
    await expect(h.service.validateWork(changed)).resolves.toMatchObject({
      status: 'REPAIR_REQUIRED', violations: [{ code: 'JOBAID_SEMANTIC_REQUIREMENT_BODY_LOCATION_REQUIRED',
        fieldPaths: ['work.issues[0].requirementHandling[0].bodyQuote', 'work.issues[0].body'] }],
    });
    expect(() => materializeJobAidWork(JSON.parse(changed.workJson), context))
      .toThrow('JOBAID_SEMANTIC_REQUIREMENT_BODY_LOCATION_REQUIRED');
  });

  it('catalog membership is not a read receipt; only Host-delivered context can satisfy citation checks', async () => {
    const h = validationFixture();
    h.taskInput.initiallyDeliveredRefs = h.taskInput.initiallyDeliveredRefs.filter(ref => ref !== source.evidenceRef);
    await expect(h.service.validateWork(h.request)).rejects.toThrow('JOBAID_SOURCE_NOT_DELIVERED');
    h.row.reviewActivityJson = JSON.stringify([{ kind: 'ASSESSMENT_SOURCES_READ', sourceRefs: [source.evidenceRef] }]);
    await expect(h.service.validateWork(h.request)).resolves.toMatchObject({ status: 'VALID' });
    expect(h.recordSourceRead).not.toHaveBeenCalled();
  });

  it.each(['mode', 'version', 'revision', 'lease', 'cancelled', 'deadline', 'terminal'])(
    'rejects invalid %s without writing', async reason => {
      const h = validationFixture();
      if (reason === 'mode') h.taskInput.executionMode = 'PROGRAM_CONTROLLED_V1';
      if (reason === 'version') h.taskInput.contentValidationVersion = 'unsupported';
      if (reason === 'revision') h.request.expectedWorkRevision = 1;
      if (reason === 'lease') h.request.leaseGeneration = 2;
      if (reason === 'cancelled') h.row.cancelRequestedAt = new Date();
      if (reason === 'deadline') h.row.deadlineAt = new Date(0);
      if (reason === 'terminal') h.row.status = 'SUCCEEDED';
      await expect(h.service.validateWork(h.request)).rejects.toThrow();
      expect(h.save).not.toHaveBeenCalled();
    },
  );

  it.each(['authorization', 'source-revocation', 'cas', 'technical'])(
    'never converts %s failure to VALID or repair feedback', async reason => {
      const h = validationFixture();
      h.request.workJson = JSON.stringify(candidate('不存在的原句'));
      if (reason === 'authorization') h.authorizedAttempt.mockRejectedValueOnce(new Error('SYNTHETIC_ACL_REVOKED'));
      if (reason === 'source-revocation') h.assertSourcesAuthorized
        .mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'));
      if (reason === 'cas') h.readValidationSnapshot
        .mockResolvedValueOnce({ reviewActivityJson: '[]', previous: null })
        .mockRejectedValueOnce(new Error('JOBAID_WORK_REVISION_CONFLICT'));
      if (reason === 'technical') h.knowledge.saved.mockRejectedValueOnce(new Error('JOBAID_STORAGE_UNAVAILABLE'));
      await expect(h.service.validateWork(h.request)).rejects.toThrow();
      expect(h.save).not.toHaveBeenCalled();
    },
  );

  it('rejects a delivery receipt removed while validation is in flight', async () => {
    const h = validationFixture();
    h.taskInput.initiallyDeliveredRefs = h.taskInput.initiallyDeliveredRefs.filter(ref => ref !== source.evidenceRef);
    h.row.reviewActivityJson = JSON.stringify([{ kind: 'ASSESSMENT_SOURCES_READ', sourceRefs: [source.evidenceRef] }]);
    h.readValidationSnapshot.mockResolvedValueOnce({ reviewActivityJson: h.row.reviewActivityJson, previous: null })
      .mockResolvedValueOnce({ reviewActivityJson: '[]', previous: null });
    await expect(h.service.validateWork(h.request)).rejects.toThrow('JOBAID_VALIDATION_DELIVERY_CHANGED');
    expect(h.save).not.toHaveBeenCalled();
  });
});

it('registers a strictly scoped read-only MCP preview with no model-supplied authority fields', () => {
  type Definition = { inputSchema: { safeParse(value: unknown): { success: boolean } };
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } };
  const registered = new Map<string, Definition>();
  const register = jest.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (
    name: string, definition: unknown,
  ) {
    registered.set(name, definition as Definition);
    return { remove: jest.fn(), enable: jest.fn(), disable: jest.fn(), update: jest.fn() } as never;
  });
  try {
    const mcp = new CanonicalHostOpenClawMcpService({} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    (mcp as unknown as { createServer(executor: 'CODEX'): McpServer }).createServer('CODEX');
    const definition = registered.get('validate_assessment_work');
    expect(definition?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    const h = validationFixture();
    expect(definition?.inputSchema.safeParse(h.request).success).toBe(true);
    for (const field of ['tenantId', 'actorUserId', 'sourceCatalog', 'deliveredSourceRefs', 'requestId'])
      expect(definition?.inputSchema.safeParse({ ...h.request, [field]: 'untrusted' }).success).toBe(false);
    expect(definition?.inputSchema.safeParse({ ...h.request, workItemId: undefined }).success).toBe(false);
    const review = registered.get('validate_review_turn_candidate')!;
    const saved = registered.get('read_review_saved_work')!;
    expect(review.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(saved.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    const preview = { attemptRef: 'AQ-review', workItemId: 'WI-review', leaseToken: h.request.leaseToken,
      leaseGeneration: 1, candidateJson: ' {} ' };
    expect(review.inputSchema.safeParse(preview).success).toBe(true);
    expect(review.inputSchema.safeParse({ ...preview, workJson: '{}' }).success).toBe(false);
    expect(review.inputSchema.safeParse({ ...preview, actorUserId: 'actor-forged' }).success).toBe(false);
    expect(review.inputSchema.safeParse({ ...preview, leaseGeneration: 0 }).success).toBe(false);
    const exact = { attemptRef: 'AQ-review', workItemId: 'WI-review', workRevisionRef: 'AWR-exact' };
    expect(saved.inputSchema.safeParse(exact).success).toBe(true);
    expect(saved.inputSchema.safeParse({ ...exact, leaseToken: h.request.leaseToken }).success).toBe(false);
    expect(saved.inputSchema.safeParse({ ...exact, workRevisionRef: undefined }).success).toBe(false);

  } finally { register.mockRestore(); }
});


describe('RC1 uses the existing Host preview and error path', () => {
  it('returns the exact production feedback fixture and binds a changed final candidate again', async () => {
    const h = validationFixture();
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/jobaid-rc1-precheck-repair.fixture.json'), 'utf8'));
    const binding = buildJobAidChecklistBinding({workItemId:h.row.workItemId,
      documentVersionId:h.row.documentVersionId,basedOnWorkItemRevision:h.row.inputRevision});
    Object.assign(h.taskInput, {checklistBinding:binding});
    Object.assign(h.taskInput.modelInput, {checklistBinding:structuredClone(binding)});
    const before = JSON.stringify({row:h.row, task:h.taskInput});
    const result = await h.service.validateWork(fixture.request);
    expect(result).toEqual(fixture.result);
    expect(JSON.stringify({row:h.row, task:h.taskInput})).toBe(before);
    for (const writer of [h.save,h.recordSourceRead,h.recordWorkRead,h.recordProgramProgress]) expect(writer).not.toHaveBeenCalled();
    const command = JSON.parse(fixture.request.workJson);
    command.checklistResults[2].basisRefs = [source.evidenceRef];
    const changed = {...fixture.request, workJson:JSON.stringify(command)};
    const valid = await h.service.validateWork(changed);
    expect(valid.status).toBe('VALID');
    expect(valid.feedback!.candidateBinding.candidateDigest).not.toBe(result.feedback!.candidateBinding.candidateDigest);
    expect(valid.feedback!.findings.every(item => item.assessment === 'NOT_MACHINE_ASSESSED')).toBe(true);
    expect(() => materializeJobAidWork(command, {...context,checklistBinding:binding})).not.toThrow();
    command.checklistResults[2].resultRefs[0].issueKey = 'missing';
    const final = await h.service.validateWork({...changed,workJson:JSON.stringify(command)});
    expect(final.status).toBe('REPAIR_REQUIRED');
    expect(final.violations[0].fieldPath).toBe('/checklistResults/2/resultRefs/0');
  });
});
