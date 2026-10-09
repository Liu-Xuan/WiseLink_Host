import { buildInitialAnalysisRequestInput, readInitialAnalysisRequestInput, assertPreparedInitialAnalysisInput } from '@server/modules/action-attempt/initial-analysis-request';
import { sealTaskEnvelope } from '@server/modules/action-attempt/action-attempt-envelope';
import type { OpenClawTaskEnvelope } from '@server/modules/action-attempt/action-attempt-envelope.types';

function native(regeneration = false) {
  return buildInitialAnalysisRequestInput({ taskType: 'OPENCLAW_OVERALL_SYNTHESIS', requestId: 'original-12',
    originalParseRunId: 'PARSE-synthetic', nativeOverallAdmission: { workRevisionRef: 'JAWR-synthetic-1', workRevision: 3,
      ...(regeneration ? { regenerationRequestId: 'REGEN-synthetic' } : {}) } });
}
function task(request = native()): OpenClawTaskEnvelope {
  return sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: 'ATT-synthetic',
    operationRef: 'OP-synthetic', taskType: request.taskType, priority: 10, tenantId: 'tenant-synthetic',
    workItemId: 'WI-synthetic', inputRevision: 12, baseRevision: 12, documentVersionId: 'DV-synthetic',
    sourceRefs: [{ ref: 'artifact://synthetic', sha256: 'a'.repeat(64) }], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: request, deadline: '2026-10-09T00:00:00Z', idempotencyKey: request.nativeOverallAdmission
      ? request.nativeOverallAdmission.regenerationRequestId
        ? 'openclaw-v1:overall:WI-synthetic:12:USER_REQUESTED_REGENERATION:REGEN-synthetic'
        : 'openclaw-v1:overall:WI-synthetic:12:problem-v2'
      : `openclaw-v2:${request.taskType === 'OPENCLAW_TRANSLATE' ? 'translate' : 'overall'}:WI-synthetic:DV-synthetic:${request.requestId}` });
}
function prepared() {
  return { schemaVersion: 'wiselink.jobaid-problem-task.v2', tdmsContext: { schemaVersion: 'wiselink.tdms-runtime-context.v1' },
    previousWork: { workRevisionRef: 'JAWR-synthetic-1', workRevision: 3 },
    modelInput: { documentOverview: { original: { binding: { parseRunId: 'PARSE-synthetic' } } } } };
}

describe('bounded native initial request decoder (intent only)', () => {
  it.each([false, true])('binds native ordinary/regeneration queue intent %s', regeneration => {
    const request = native(regeneration); expect(readInitialAnalysisRequestInput(task(request))).toEqual(request);
    expect(() => assertPreparedInitialAnalysisInput(request, prepared())).not.toThrow();
  });
  it('retains ordinary v2 and S1 non-translation v3 preparation', () => {
    const request = buildInitialAnalysisRequestInput({ taskType: 'OPENCLAW_OVERALL_SYNTHESIS', requestId: 'original-12', originalParseRunId: 'PARSE-synthetic' });
    expect(readInitialAnalysisRequestInput(task(request))).toEqual(request);
    for (const version of ['v2', 'v3']) expect(() => assertPreparedInitialAnalysisInput(request,
      { ...prepared(), schemaVersion: 'wiselink.jobaid-problem-task.' + version })).not.toThrow();
  });
  it('keeps translation v2 and rejects JobAid v3 for translation', () => {
    const request = buildInitialAnalysisRequestInput({ taskType: 'OPENCLAW_TRANSLATE', requestId: '123e4567-e89b-42d3-a456-426614174000' });
    expect(readInitialAnalysisRequestInput(task(request))).toEqual(request);
    expect(() => assertPreparedInitialAnalysisInput(request, { schemaVersion: 'wiselink.3_1.translation_task.v2' })).not.toThrow();
    expect(() => assertPreparedInitialAnalysisInput(request, { schemaVersion: 'wiselink.jobaid-problem-task.v3' })).toThrow('PREPARED_SCOPE_INVALID');
  });
  it.each([
    { workRevisionRef: 'unbounded-ref' }, { workRevision: 0 }, { workRevision: -1 }, { workRevision: 1.5 },
    { workRevision: NaN }, { extra: true }, { regenerationRequestId: '' }, { regenerationRequestId: 'x'.repeat(201) },
  ])('rejects malformed/unknown native tuple %p', change => {
    const request = native(); Object.assign(request.nativeOverallAdmission!, change);
    expect(() => buildInitialAnalysisRequestInput(request)).toThrow();
  });
  it('rejects native non-overall and missing original binding', () => {
    expect(() => buildInitialAnalysisRequestInput({ ...native(), taskType: 'OPENCLAW_DYNAMIC_EVALUATION' })).toThrow('JOBAID_TDMS_OVERALL_REQUEST_INVALID');
    const request = native(); delete request.originalParseRunId;
    expect(() => buildInitialAnalysisRequestInput(request)).toThrow('JOBAID_TDMS_OVERALL_REQUEST_INVALID');
  });
  it.each([
    { baseRevision: 13 }, { idempotencyKey: 'openclaw-v2:overall:WI-synthetic:DV-synthetic:original-12' },
    { idempotencyKey: 'openclaw-v1:overall:WI-synthetic:12:problem-v2-extra' },
    { taskType: 'OPENCLAW_DYNAMIC_EVALUATION' }, { allowedConnectors: ['unauthorized'] },
    { allowedConnectors: ['feishu-aily-user', 'extra'] }, { sourceRefs: [] },
    { sourceRefs: [{ ref: 'a', sha256: 'a'.repeat(64) }, { ref: 'b', sha256: 'b'.repeat(64) }] },
  ])('rejects request/envelope drift %p', change => {
    const value = task(); Object.assign(value, change); expect(() => readInitialAnalysisRequestInput(value)).toThrow();
  });
  it('accepts exactly one existing nontranslation connector and rejects wrong regeneration id', () => {
    const value = task(native(true)); value.allowedConnectors = ['feishu-aily-user'];
    expect(readInitialAnalysisRequestInput(value)).not.toBeNull();
    value.idempotencyKey = value.idempotencyKey.replace('REGEN-synthetic', 'other');
    expect(() => readInitialAnalysisRequestInput(value)).toThrow('BINDING_INVALID');
  });
  it.each([
    { previousWork: { workRevisionRef: 'JAWR-other', workRevision: 3 } },
    { previousWork: { workRevisionRef: 'JAWR-synthetic-1', workRevision: 4 } },
    { tdmsContext: undefined }, { tdmsContext: { schemaVersion: 'unknown' } },
    { modelInput: { documentOverview: { original: { binding: { parseRunId: 'other' } } } } },
    { schemaVersion: 'wiselink.jobaid-problem-task.v4' },
  ])('rejects prepared scope drift %p', change => {
    expect(() => assertPreparedInitialAnalysisInput(native(), { ...prepared(), ...change })).toThrow();
  });
});
