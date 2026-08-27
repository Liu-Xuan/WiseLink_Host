import {
  parseResultEnvelope,
  parseStoredResultEnvelope,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';

export const CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY = {
  runtimeAppId: 'app_17c3zn24kv2',
  profileRef: 'wiselink-engineering',
  modelVersion: 'GLM-5.1',
  skillVersion: 'wiselink-research-and-synthesize@r09.c4',
  mcpServerName: 'wiselink-openclaw-engineering-assessment',
  mcpServerVersion: '1.2.0',
} as const;

export const CANONICAL_HOST_OPENCLAW_APPLICABILITY_PROMPT_VERSION =
  'wiselink-applicability-extraction@r09.c4' as const;

export interface CanonicalHostOpenClawResultPreflight {
  task: OpenClawTaskEnvelope;
  result: OpenClawResultEnvelope;
}

export function preflightCanonicalHostOpenClawResult(input: {
  row: ActionAttemptRow;
  result: unknown;
}): CanonicalHostOpenClawResultPreflight {
  const task = parseCanonicalHostOpenClawAttemptTask(input.row);
  const result = parseResultEnvelope({ value: input.result, task });
  assertCanonicalHostOpenClawRuntimePolicy(result, task);
  return { task, result };
}

export function parseCanonicalHostOpenClawStoredResult(input: {
  row: ActionAttemptRow;
  task: OpenClawTaskEnvelope;
}): OpenClawResultEnvelope {
  if (!input.row.resultEnvelopeJson) {
    throw policyError('OPENCLAW_RESULT_ENVELOPE_MISSING');
  }
  const result = parseStoredResultEnvelope({
    value: input.row.resultEnvelopeJson,
    task: input.task,
  });
  assertCanonicalHostOpenClawRuntimePolicy(result, input.task);
  if (input.row.resultContentHash !== result.contentHash) {
    throw policyError('OPENCLAW_RESULT_CONTENT_HASH_BINDING_MISMATCH');
  }
  return result;
}

export function parseCanonicalHostOpenClawAttemptTask(
  row: ActionAttemptRow,
): OpenClawTaskEnvelope {
  if (!row.taskEnvelopeJson) {
    throw policyError('OPENCLAW_TASK_ENVELOPE_MISSING');
  }
  const task = parseTaskEnvelope(row.taskEnvelopeJson);
  if (
    task.actionAttemptId !== row.attemptId ||
    task.operationRef !== row.operationRef ||
    task.taskType !== row.actionType ||
    task.tenantId !== row.tenantId ||
    task.workItemId !== row.workItemId ||
    task.inputRevision !== row.inputRevision ||
    task.baseRevision !== row.baseRevision ||
    task.documentVersionId !== row.documentVersionId ||
    task.idempotencyKey !== row.idempotencyKey ||
    task.inputHash !== row.taskInputHash
  ) {
    throw policyError('OPENCLAW_TASK_ENVELOPE_ROW_BINDING_MISMATCH');
  }
  return task;
}

export function assertCanonicalHostOpenClawRuntimePolicy(
  result: OpenClawResultEnvelope,
  task: OpenClawTaskEnvelope,
): void {
  const policy = CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY;
  if (
    result.modelVersion !== policy.modelVersion ||
    result.skillVersion !== policy.skillVersion ||
    result.toolVersions[policy.mcpServerName] !== policy.mcpServerVersion ||
    !result.promptVersion.trim()
  ) {
    throw policyError('OPENCLAW_RESULT_RUNTIME_POLICY_MISMATCH');
  }
  if (
    task.taskType === 'OPENCLAW_APPLICABILITY_EVALUATION' &&
    result.promptVersion !==
      CANONICAL_HOST_OPENCLAW_APPLICABILITY_PROMPT_VERSION
  ) {
    throw policyError('OPENCLAW_APPLICABILITY_PROMPT_POLICY_MISMATCH');
  }
}

export class CanonicalHostOpenClawRuntimePolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'CanonicalHostOpenClawRuntimePolicyError';
    this.code = code;
  }
}

function policyError(code: string): CanonicalHostOpenClawRuntimePolicyError {
  return new CanonicalHostOpenClawRuntimePolicyError(code);
}
