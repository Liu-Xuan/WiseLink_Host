import {
  canonicalJson,
  parseResultEnvelope,
  parseStoredResultEnvelope,
  parseTaskEnvelope,
  sealResultEnvelope,
  sealTaskEnvelope,
  sealMatterTaskEnvelope,
  sealMatterResultEnvelope,
  parseMatterTaskEnvelope,
  parseMatterResultEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';

describe('OpenClaw ActionAttempt envelopes', () => {
  it('round-trips an immutable task and rejects a changed model input', () => {
    const task = taskEnvelope();
    expect(parseTaskEnvelope(canonicalJson(task))).toEqual(task);

    const corrupted = { ...task, modelInput: { prompt: 'changed' } };
    expect(() => parseTaskEnvelope(JSON.stringify(corrupted))).toThrow(
      'TASK_ENVELOPE_INPUT_HASH_MISMATCH',
    );
  });

  it('accepts a complete bound result and rejects any extra or missing field', () => {
    const task = taskEnvelope();
    const result = resultEnvelope(task);
    expect(parseResultEnvelope({ value: result, task })).toEqual(result);
    expect(
      parseStoredResultEnvelope({ value: canonicalJson(result), task }),
    ).toEqual(result);

    expect(() =>
      parseResultEnvelope({ value: { ...result, invented: {} }, task }),
    ).toThrow('RESULT_ENVELOPE_SCHEMA_INVALID');
    const { warnings: _warnings, ...missing } = result;
    expect(() => parseResultEnvelope({ value: missing, task })).toThrow(
      'RESULT_ENVELOPE_SCHEMA_INVALID',
    );
  });

  it('never converts corrupt stored JSON to an empty object', () => {
    const task = taskEnvelope();
    expect(() =>
      parseStoredResultEnvelope({ value: '{not-json', task }),
    ).toThrow('RESULT_ENVELOPE_JSON_INVALID');
    expect(() => parseStoredResultEnvelope({ value: '{}', task })).toThrow(
      'RESULT_ENVELOPE_SCHEMA_INVALID',
    );
  });

  it('rejects cross-attempt, stale-revision and unauthorized source replay', () => {
    const task = taskEnvelope();
    for (const changed of [
      sealResultEnvelope({
        ...withoutContentHash(resultEnvelope(task)),
        actionAttemptId: 'ATT-other',
      }),
      sealResultEnvelope({
        ...withoutContentHash(resultEnvelope(task)),
        baseRevision: task.baseRevision - 1,
      }),
      sealResultEnvelope({
        ...withoutContentHash(resultEnvelope(task)),
        sourceRefs: [{ ref: 'artifact://other', sha256: 'b'.repeat(64) }],
      }),
    ]) {
      expect(() => parseResultEnvelope({ value: changed, task })).toThrow();
    }
  });

  it('requires waiting-input and failure outcomes to remain non-candidates', () => {
    const task = taskEnvelope();
    const invalidWaiting = sealResultEnvelope({
      ...withoutContentHash(resultEnvelope(task)),
      status: 'WAITING_INPUT',
      businessOutcome: 'WAITING_INPUT',
      candidateStatus: 'WAITING_INPUT',
      modelOutput: '{}',
      missingInputs: [{ code: 'MISSING', message: 'Need controlled input.' }],
    });
    expect(() => parseResultEnvelope({ value: invalidWaiting, task })).toThrow(
      'RESULT_ENVELOPE_WAITING_INPUT_SEMANTICS_INVALID',
    );
  });

  it('round-trips the OPENCLAW_TRANSLATE task and its bound result', () => {
    const { inputHash: _inputHash, ...unsealedTask } = taskEnvelope();
    const translationTask = sealTaskEnvelope({
      ...unsealedTask,
      actionAttemptId: 'ATT-translation',
      operationRef: 'AQ-translation',
      taskType: 'OPENCLAW_TRANSLATE',
      idempotencyKey: 'openclaw-translate-v1:test',
    });
    const translationResult = resultEnvelope(translationTask);

    expect(parseTaskEnvelope(canonicalJson(translationTask))).toEqual(
      translationTask,
    );
    expect(
      parseResultEnvelope({ value: translationResult, task: translationTask }),
    ).toEqual(translationResult);
  });
});

describe('Matter ActionAttempt envelopes', () => {
  it('binds a real Matter without a WorkItem, document identity or ReviewTurn', () => {
    const task = matterTaskEnvelope();
    expect(parseMatterTaskEnvelope(canonicalJson(task))).toEqual(task);
    expect(task).not.toHaveProperty('workItemId');
    expect(task).not.toHaveProperty('documentVersionId');
    expect(() => parseTaskEnvelope(canonicalJson(task))).toThrow();
    for (const extra of [
      { workItemId: 'WI-anchor' },
      { reviewTurnId: 'TURN-fake' },
    ])
      expect(() =>
        parseMatterTaskEnvelope(canonicalJson({ ...task, ...extra })),
      ).toThrow('TASK_ENVELOPE_SCHEMA_INVALID');
  });

  it('rejects invalid triggers and mutation of the frozen input', () => {
    const task = matterTaskEnvelope();
    expect(() =>
      parseMatterTaskEnvelope(
        canonicalJson({
          ...task,
          subject: { ...task.subject, matterId: 'another' },
        }),
      ),
    ).toThrow('TASK_ENVELOPE_INPUT_HASH_MISMATCH');
    for (const trigger of [
      { kind: 'SOURCE_CHANGE', inputIds: [] },
      { kind: 'SOURCE_CHANGE', inputIds: ['a', 'a'] },
      { kind: 'REVISIT', workRef: 'work:1', conditionIds: [] },
      { kind: 'USER_REQUEST', requestId: 'r', instruction: '' },
      { kind: 'CHAT', reviewTurnId: 't' },
    ])
      expect(() =>
        parseMatterTaskEnvelope(canonicalJson({ ...task, trigger })),
      ).toThrow('TASK_ENVELOPE_TRIGGER_INVALID');
  });

  it('uses the same result semantics and exact-source checks for Matter results', () => {
    const task = matterTaskEnvelope();
    const {
      workItemId: _wi,
      contentHash: _hash,
      ...legacy
    } = resultEnvelope(taskEnvelope());
    const result = sealMatterResultEnvelope({
      ...legacy,
      schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v2',
      taskType: 'OPENCLAW_MATTER_ASSESSMENT',
      subject: task.subject,
      baseRevision: task.baseRevision,
    });
    expect(parseMatterResultEnvelope({ task, value: result })).toEqual(result);
    expect(() =>
      parseMatterResultEnvelope({
        task,
        value: sealMatterResultEnvelope({
          ...result,
          subject: { ...task.subject, matterRevisionId: 'other-revision' },
        }),
      }),
    ).toThrow('RESULT_ENVELOPE_SUBJECT_MISMATCH');
    expect(() =>
      parseMatterResultEnvelope({
        task,
        value: sealMatterResultEnvelope({
          ...result,
          sourceRefs: [
            { ref: 'artifact://not-authorized', sha256: 'a'.repeat(64) },
          ],
        }),
      }),
    ).toThrow('RESULT_ENVELOPE_SOURCE_REF_UNAUTHORIZED');
    expect(() =>
      parseMatterResultEnvelope({
        task,
        value: sealMatterResultEnvelope({
          ...result,
          status: 'WAITING_INPUT',
          modelOutput: null,
        }),
      }),
    ).toThrow('RESULT_ENVELOPE_WAITING_INPUT_SEMANTICS_INVALID');
  });
});

function matterTaskEnvelope() {
  const {
    workItemId: _wi,
    documentVersionId: _dv,
    inputHash: _hash,
    ...legacy
  } = taskEnvelope();
  return sealMatterTaskEnvelope({
    ...legacy,
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2',
    taskType: 'OPENCLAW_MATTER_ASSESSMENT',
    subject: {
      kind: 'ENGINEERING_MATTER',
      matterId: 'MATTER-test',
      matterRevisionId: 'MR-test',
    },
    trigger: { kind: 'SOURCE_CHANGE', inputIds: ['material-test'] },
    workingBasis: { inputs: [], priorWorkRef: null },
    inputRevision: 2,
    baseRevision: 0,
  });
}

function taskEnvelope() {
  return sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-test',
    operationRef: 'AQ-test',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-test',
    workItemId: 'WI-test',
    inputRevision: 7,
    baseRevision: 7,
    documentVersionId: 'DV-test',
    sourceRefs: [{ ref: 'artifact://source', sha256: 'a'.repeat(64) }],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: { prompt: 'controlled input' },
    deadline: '2026-08-24T12:00:00.000Z',
    idempotencyKey: 'openclaw-v1:test',
  });
}

function resultEnvelope(task: ReturnType<typeof taskEnvelope>) {
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: '{"candidate":true}',
    outputArtifactRefs: [],
    sourceRefs: [...task.sourceRefs],
    factsConsidered: ['controlled source'],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'openclaw-real',
    promptVersion: 'prompt-v1',
    skillVersion: 'skill-v1',
    toolVersions: { host: '006146b' },
    runMetrics: { durationMs: 10, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
  });
}

function withoutContentHash<T extends { contentHash: string }>(
  value: T,
): Omit<T, 'contentHash'> {
  const { contentHash: _contentHash, ...rest } = value;
  return rest;
}
