import { assertAilyRequestTaskBinding, parseAilyExecutorRun, serializeAilyExecutorRun, type AilyExecutorRun } from '../../server/modules/canonical-host/aily-executor-run';

function run(): AilyExecutorRun {
  return {schemaVersion: 'wiselink.aily-executor-run.v1', executor: 'AILY_AGENT_V1',
    requestId: '00000000-0000-4000-8000-000000000101', agentId: 'agent_synthetic',
    publicationRef: 'synthetic-publication', configurationSource: 'synthetic-approved-fixture',
    scope: {tenantId: 'tenant-test', workItemId: 'WI-test', intakeRequestId: 'original-intake', principalId: 'service:aily-test'},
    modelEvidence: {selectedModelRef: 'aily/deepseek-v4-pro', actualModelRef: null},
    hostSessionId: '00000000-0000-4000-8000-000000000102', leaseGeneration: 1,
    post: {state: 'STARTED', startedAt: '2026-10-29T00:00:00.000Z', requestBody: '{"stream":false}'}};
}

describe('private Aily executor run', () => {
  it('preserves old browser rows and binds background origin without a pretend browser session', () => {
    const old = run(); expect(parseAilyExecutorRun(old)).toEqual(old);
    expect(parseAilyExecutorRun({...old,invocation:{purpose:'BROWSER',identityRef:'synthetic-caller',
      callerAppId:'cli_synthetic',configurationSource:'synthetic-proof'}})?.hostSessionId).toBe(old.hostSessionId);
    const background = {...old, requestId: 'original-2', hostSessionId: null,
      invocation: {purpose: 'BACKGROUND' as const, identityRef: 'synthetic-caller', callerAppId: 'cli_synthetic', configurationSource: 'synthetic-proof'}};
    expect(parseAilyExecutorRun(background)).toEqual(background);
    expect(() => parseAilyExecutorRun({...old, hostSessionId: null})).toThrow('AILY_EXECUTOR_RUN_INVALID');
    expect(() => parseAilyExecutorRun({...background, hostSessionId: old.hostSessionId})).toThrow('AILY_EXECUTOR_RUN_INVALID');
    expect(() => parseAilyExecutorRun({...old, requestId: 'original-2'})).toThrow('AILY_EXECUTOR_RUN_INVALID');
  });

  it('records native application browser provenance without inventing an OAuth session',()=>{
    const value:AilyExecutorRun={...run(),hostSessionId:null,invocation:{purpose:'BROWSER',identityRef:'synthetic-caller',
      callerAppId:'cli_synthetic',configurationSource:'synthetic-proof'}};
    expect(parseAilyExecutorRun(serializeAilyExecutorRun(value))).toEqual(value);
    expect(()=>parseAilyExecutorRun({...value,invocation:undefined})).toThrow('AILY_EXECUTOR_RUN_INVALID');
    expect(()=>parseAilyExecutorRun({...value,invocation:{...value.invocation,callerAppId:undefined}})).toThrow('AILY_EXECUTOR_RUN_INVALID');
    expect(()=>parseAilyExecutorRun({...value,requestId:'original-2'})).toThrow('AILY_EXECUTOR_RUN_INVALID');
  });

  it('requires the original producer request and sealed parse identity, never arbitrary strings or takeover hashes', () => {
    const task = {workItemId: 'WI', documentVersionId: 'DV', idempotencyKey: 'openclaw-v2:dynamic:WI:DV:original-2',
      modelInput: {requestId: 'original-2', originalParseRunId: 'PR-2'}};
    expect(() => assertAilyRequestTaskBinding('original-2', task)).not.toThrow();
    const prepared = {...task, modelInput: {modelInput: {documentOverview: {original: {binding: {parseRunId: 'PR-2', parseRevision: 2}}}}}};
    expect(() => assertAilyRequestTaskBinding('original-2', prepared)).not.toThrow();
    expect(() => assertAilyRequestTaskBinding('original-3', prepared)).toThrow('AILY_REQUEST_TASK_BINDING_CHANGED');
    expect(() => assertAilyRequestTaskBinding('original-2', {...task, modelInput: {requestId: 'original-2'}})).toThrow();
    expect(() => assertAilyRequestTaskBinding('a'.repeat(64), {...task, idempotencyKey: `openclaw-v2:dynamic:WI:DV:${'a'.repeat(64)}`})).toThrow();
  });
  it('round trips exact original request bytes and keeps actual model unknown', () => {
    const value = run(); value.post.requestBody = '{"user_message":"完整任务\\n原字节","stream":false}';
    expect(parseAilyExecutorRun(serializeAilyExecutorRun(value))).toEqual(value);
    expect(parseAilyExecutorRun(null)).toBeNull();
  });

  it.each([1, 31, 64])('retains the exact %s-digit original chat without truncation', length => {
    const value = run();
    value.post = {...value.post, state: 'ACCEPTED', acceptedAt: value.post.startedAt,
      chatId: '9'.repeat(length), remoteSessionId: 'original-session'};
    expect(parseAilyExecutorRun(value)).toEqual(value);
  });

  it.each([
    (value: Record<string, unknown>) => { value.leaseToken = 'must-not-be-duplicated'; },
    (value: Record<string, unknown>) => { value.status = 'SUCCEEDED'; },
    (value: Record<string, unknown>) => { value.modelEvidence = {selectedModelRef: 'aily/deepseek-v4-pro', actualModelRef: 'invented'}; },
    (value: Record<string, unknown>) => { value.post = {state: 'ACCEPTED', startedAt: '2026-10-29T00:00:00.000Z',
      acceptedAt: '2026-10-29T00:00:00.000Z', requestBody: '{}', chatId: '1'.repeat(65), remoteSessionId: null}; },
  ])('rejects unapproved fields or guessed receipts', mutate => {
    const value = structuredClone(run()) as unknown as Record<string, unknown>; mutate(value);
    expect(() => parseAilyExecutorRun(value)).toThrow('AILY_EXECUTOR_RUN_INVALID');
  });
});
