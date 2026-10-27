import { canonicalHostExecutor } from './canonical-host-executor-policy';
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
  modelPolicyRef: 'official-hosted-profile-config',
  skillCompatibilityRef: 'wiselink-research-and-synthesize@r09',
  minimumCompatibleSkillVersion: 'wiselink-research-and-synthesize@r09.c10',
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
  if (!isSavedWorkReconciliationResult(result) &&
      (result.toolVersions['model-executor'] ?? 'HOSTED') !== canonicalHostExecutor())
    throw policyError('CANONICAL_RESULT_EXECUTOR_MISMATCH');
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
  if (task.taskType === 'OPENCLAW_INTERACTIVE_REVIEW') {
    const executionPolicy = task.modelInput.executionPolicy as { schemaVersion?: unknown; executor?: unknown } | undefined;
    const executor = executionPolicy?.schemaVersion === 'wiselink.3_1.review_execution.v1' ? 'CODEX' : 'HOSTED';
    if ((result.toolVersions['model-executor'] ?? 'HOSTED') !== executor)
      throw policyError('CANONICAL_RESULT_EXECUTOR_MISMATCH');
  }

  if (isSavedWorkReconciliationResult(result)) {
    const marker = task.modelInput.savedWorkReconciliation as { executionKind?: unknown; modelRequests?: unknown; workRevisionRef?: unknown } | undefined;
    let output: unknown;
    try { output = JSON.parse(result.modelOutput ?? 'null'); } catch { output = null; }
    if (task.taskType !== 'OPENCLAW_DYNAMIC_EVALUATION' || !marker ||
        marker.executionKind !== 'HOST_SAVED_WORK_RECONCILIATION' || marker.modelRequests !== 0 ||
        result.status !== 'SUCCEEDED' || result.businessOutcome !== 'CANDIDATE_READY' ||
        result.toolVersions['host-saved-work-reconciliation'] !== '1' ||
        result.runMetrics.inputUnits !== 0 || result.runMetrics.outputUnits !== 0 ||
        !output || typeof output !== 'object' || !('workRevisionRef' in output) ||
        output.workRevisionRef !== marker.workRevisionRef)
      throw policyError('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
  } else if (result.toolVersions['host-saved-work-reconciliation'] !== undefined) {
    throw policyError('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
  }
  if (
    (!isSavedWorkReconciliationResult(result) && !hasReadableActualModelProvenance(result.modelVersion)) ||
    !isCanonicalHostOpenClawSkillVersionCompatible(result.skillVersion) ||
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
  if (
    task.modelInput.schemaVersion === 'wiselink.3_1.translation_task.v2' &&
    (![
      'wiselink-translation-block@r09.c44',
      'wiselink-translation-block@r09.c45',
      'wiselink-translation-block@r09.c46',
      'wiselink-translation-block@r09.c47',
      'wiselink-translation-block@r09.c48',
      'wiselink-translation-block@r09.c49',
      'wiselink-translation-block@r09.c205',
      'wiselink-translation-block@r09.c207',
    ].includes(result.promptVersion) ||
      (parseCompatibleSkillRevision(
        result.skillVersion,
        policy.skillCompatibilityRef,
      ) ?? -1) < 44)
  ) {
    throw policyError('OPENCLAW_TRANSLATION_V2_RUNTIME_POLICY_MISMATCH');
  }
}

export function isCanonicalHostOpenClawSkillVersionCompatible(
  value: string,
): boolean {
  const policy = CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY;
  const minimumRevision = parseCompatibleSkillRevision(
    policy.minimumCompatibleSkillVersion,
    policy.skillCompatibilityRef,
  );
  const actualRevision = parseCompatibleSkillRevision(
    value,
    policy.skillCompatibilityRef,
  );
  return (
    minimumRevision !== null &&
    actualRevision !== null &&
    actualRevision >= minimumRevision
  );
}

function parseCompatibleSkillRevision(
  value: string,
  compatibilityRef: string,
): number | null {
  const prefix = `${compatibilityRef}.c`;
  if (!value.startsWith(prefix)) return null;
  const revision = value.slice(prefix.length);
  if (!/^(?:0|[1-9]\d*)$/u.test(revision)) return null;
  const parsed = Number(revision);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function hasReadableActualModelProvenance(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized !== '' &&
    normalized !== 'fallback' &&
    normalized !== 'unknown' &&
    normalized !== CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY.modelPolicyRef
  );
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

function isSavedWorkReconciliationResult(result: OpenClawResultEnvelope): result is import('../action-attempt/action-attempt-envelope.types').OpenClawSavedWorkReconciliationResultEnvelope {
  return result.executionKind === 'HOST_SAVED_WORK_RECONCILIATION';
}
