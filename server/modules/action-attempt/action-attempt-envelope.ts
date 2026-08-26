import { createHash } from 'node:crypto';

import type {
  ActionEnvelopeArtifactRef,
  ActionEnvelopeMissingInput,
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from './action-attempt-envelope.types';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const TASK_TYPES = new Set<OpenClawTaskEnvelope['taskType']>([
  'OPENCLAW_APPLICABILITY_EVALUATION',
  'OPENCLAW_DYNAMIC_EVALUATION',
  'OPENCLAW_INTERACTIVE_REVIEW',
  'OPENCLAW_OVERALL_SYNTHESIS',
  'OPENCLAW_TRANSLATE',
]);

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sealTaskEnvelope(
  envelope: Omit<OpenClawTaskEnvelope, 'inputHash'>,
): OpenClawTaskEnvelope {
  return { ...envelope, inputHash: canonicalSha256(envelope) };
}

export function sealResultEnvelope(
  envelope: Omit<OpenClawResultEnvelope, 'contentHash'>,
): OpenClawResultEnvelope {
  return { ...envelope, contentHash: canonicalSha256(envelope) };
}

export function parseTaskEnvelope(value: string): OpenClawTaskEnvelope {
  const record = parseRecord(value, 'TASK_ENVELOPE_JSON_INVALID');
  assertExactKeys(
    record,
    [
      'schemaVersion',
      'actionAttemptId',
      'operationRef',
      'taskType',
      'priority',
      'tenantId',
      'workItemId',
      'inputRevision',
      'baseRevision',
      'documentVersionId',
      'sourceRefs',
      'allowedConnectors',
      'hostResolvedMissingInputs',
      'modelInput',
      'deadline',
      'idempotencyKey',
      'inputHash',
    ],
    'TASK_ENVELOPE_SCHEMA_INVALID',
  );
  const envelope = record as unknown as OpenClawTaskEnvelope;
  if (envelope.schemaVersion !== 'wiselink.3_1.openclaw_task_envelope.v1') {
    fail('TASK_ENVELOPE_SCHEMA_UNSUPPORTED');
  }
  requiredText(envelope.actionAttemptId, 'TASK_ENVELOPE_ATTEMPT_REQUIRED');
  requiredText(envelope.operationRef, 'TASK_ENVELOPE_OPERATION_REF_REQUIRED');
  if (!TASK_TYPES.has(envelope.taskType))
    fail('TASK_ENVELOPE_TASK_TYPE_INVALID');
  if (
    !Number.isSafeInteger(envelope.priority) ||
    envelope.priority < 0 ||
    envelope.priority > 1000
  ) {
    fail('TASK_ENVELOPE_PRIORITY_INVALID');
  }
  requiredText(envelope.tenantId, 'TASK_ENVELOPE_TENANT_REQUIRED');
  requiredText(envelope.workItemId, 'TASK_ENVELOPE_WORK_ITEM_REQUIRED');
  requiredRevision(
    envelope.inputRevision,
    'TASK_ENVELOPE_INPUT_REVISION_INVALID',
  );
  requiredRevision(
    envelope.baseRevision,
    'TASK_ENVELOPE_BASE_REVISION_INVALID',
  );
  requiredText(
    envelope.documentVersionId,
    'TASK_ENVELOPE_DOCUMENT_VERSION_REQUIRED',
  );
  requiredArray(
    envelope.sourceRefs,
    'TASK_ENVELOPE_SOURCE_REFS_INVALID',
  ).forEach(assertRef);
  assertStringArray(
    envelope.allowedConnectors,
    'TASK_ENVELOPE_CONNECTORS_INVALID',
  );
  requiredArray(
    envelope.hostResolvedMissingInputs,
    'TASK_ENVELOPE_MISSING_INPUTS_INVALID',
  ).forEach(assertMissingInput);
  if (!isRecord(envelope.modelInput)) fail('TASK_ENVELOPE_MODEL_INPUT_INVALID');
  const deadline = requiredText(
    envelope.deadline,
    'TASK_ENVELOPE_DEADLINE_REQUIRED',
  );
  if (!Number.isFinite(Date.parse(deadline)))
    fail('TASK_ENVELOPE_DEADLINE_INVALID');
  requiredText(
    envelope.idempotencyKey,
    'TASK_ENVELOPE_IDEMPOTENCY_KEY_REQUIRED',
  );
  const { inputHash: _inputHash, ...unsealed } = envelope;
  if (
    !SHA256_PATTERN.test(envelope.inputHash) ||
    canonicalSha256(unsealed) !== envelope.inputHash
  ) {
    fail('TASK_ENVELOPE_INPUT_HASH_MISMATCH');
  }
  return envelope;
}

export function parseResultEnvelope(input: {
  value: unknown;
  task: OpenClawTaskEnvelope;
}): OpenClawResultEnvelope {
  if (!isRecord(input.value)) fail('RESULT_ENVELOPE_INVALID');
  const value = input.value;
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'actionAttemptId',
      'operationRef',
      'taskType',
      'workItemId',
      'baseRevision',
      'status',
      'businessOutcome',
      'candidateStatus',
      'modelOutput',
      'outputArtifactRefs',
      'sourceRefs',
      'factsConsidered',
      'missingInputs',
      'conflicts',
      'warnings',
      'modelVersion',
      'promptVersion',
      'skillVersion',
      'toolVersions',
      'runMetrics',
      'contentHash',
      'errorCode',
      'errorDetail',
    ],
    'RESULT_ENVELOPE_SCHEMA_INVALID',
  );
  const result = value as unknown as OpenClawResultEnvelope;
  if (result.schemaVersion !== 'wiselink.3_1.openclaw_result_envelope.v1') {
    fail('RESULT_ENVELOPE_SCHEMA_UNSUPPORTED');
  }
  if (result.actionAttemptId !== input.task.actionAttemptId) {
    fail('RESULT_ENVELOPE_ATTEMPT_MISMATCH');
  }
  if (result.operationRef !== input.task.operationRef) {
    fail('RESULT_ENVELOPE_OPERATION_REF_MISMATCH');
  }
  if (result.taskType !== input.task.taskType) {
    fail('RESULT_ENVELOPE_TASK_TYPE_MISMATCH');
  }
  if (result.workItemId !== input.task.workItemId) {
    fail('RESULT_ENVELOPE_WORK_ITEM_MISMATCH');
  }
  if (result.baseRevision !== input.task.baseRevision) {
    fail('RESULT_ENVELOPE_BASE_REVISION_MISMATCH');
  }
  if (!['SUCCEEDED', 'WAITING_INPUT', 'FAILED'].includes(result.status)) {
    fail('RESULT_ENVELOPE_STATUS_INVALID');
  }
  if (
    !['CANDIDATE_READY', 'UNKNOWN', 'WAITING_INPUT', 'NOT_PRODUCED'].includes(
      result.businessOutcome,
    )
  ) {
    fail('RESULT_ENVELOPE_BUSINESS_OUTCOME_INVALID');
  }
  if (
    result.candidateStatus !== null &&
    !['UNKNOWN', 'WAITING_INPUT'].includes(result.candidateStatus)
  ) {
    fail('RESULT_ENVELOPE_CANDIDATE_STATUS_INVALID');
  }
  if (result.modelOutput !== null && typeof result.modelOutput !== 'string') {
    fail('RESULT_ENVELOPE_MODEL_OUTPUT_INVALID');
  }
  requiredArray(
    result.outputArtifactRefs,
    'RESULT_ENVELOPE_OUTPUT_REFS_INVALID',
  ).forEach(assertRef);
  requiredArray(
    result.sourceRefs,
    'RESULT_ENVELOPE_SOURCE_REFS_INVALID',
  ).forEach(assertRef);
  assertStringArray(result.factsConsidered, 'RESULT_ENVELOPE_FACTS_INVALID');
  requiredArray(
    result.missingInputs,
    'RESULT_ENVELOPE_MISSING_INPUTS_INVALID',
  ).forEach(assertMissingInput);
  assertStringArray(result.conflicts, 'RESULT_ENVELOPE_CONFLICTS_INVALID');
  assertStringArray(result.warnings, 'RESULT_ENVELOPE_WARNINGS_INVALID');
  requiredText(result.modelVersion, 'RESULT_ENVELOPE_MODEL_VERSION_REQUIRED');
  requiredText(result.promptVersion, 'RESULT_ENVELOPE_PROMPT_VERSION_REQUIRED');
  requiredText(result.skillVersion, 'RESULT_ENVELOPE_SKILL_VERSION_REQUIRED');
  assertStringRecord(
    result.toolVersions,
    'RESULT_ENVELOPE_TOOL_VERSIONS_INVALID',
  );
  assertRunMetrics(result.runMetrics);
  assertNullableText(result.errorCode, 'RESULT_ENVELOPE_ERROR_CODE_INVALID');
  assertNullableText(
    result.errorDetail,
    'RESULT_ENVELOPE_ERROR_DETAIL_INVALID',
  );
  assertSourceRefsAllowed(result.sourceRefs, input.task);
  assertBusinessOutcome(result, input.task);
  const { contentHash: _contentHash, ...unsealed } = result;
  if (
    !SHA256_PATTERN.test(result.contentHash) ||
    canonicalSha256(unsealed) !== result.contentHash
  ) {
    fail('RESULT_ENVELOPE_CONTENT_HASH_MISMATCH');
  }
  return result;
}

export function parseStoredResultEnvelope(input: {
  value: string;
  task: OpenClawTaskEnvelope;
}): OpenClawResultEnvelope {
  const parsed = parseRecord(input.value, 'RESULT_ENVELOPE_JSON_INVALID');
  return parseResultEnvelope({ value: parsed, task: input.task });
}

function assertBusinessOutcome(
  result: OpenClawResultEnvelope,
  task: OpenClawTaskEnvelope,
): void {
  if (result.status === 'SUCCEEDED') {
    if (
      result.businessOutcome !== 'CANDIDATE_READY' ||
      result.candidateStatus !== null ||
      typeof result.modelOutput !== 'string' ||
      result.modelOutput.trim() === '' ||
      result.errorCode !== null ||
      result.errorDetail !== null
    ) {
      fail('RESULT_ENVELOPE_SUCCESS_SEMANTICS_INVALID');
    }
  } else if (result.status === 'WAITING_INPUT') {
    if (
      !['UNKNOWN', 'WAITING_INPUT'].includes(result.businessOutcome) ||
      !['UNKNOWN', 'WAITING_INPUT'].includes(result.candidateStatus ?? '') ||
      result.missingInputs.length === 0 ||
      result.modelOutput !== null ||
      result.outputArtifactRefs.length > 0 ||
      result.errorCode !== null ||
      result.errorDetail !== null
    ) {
      fail('RESULT_ENVELOPE_WAITING_INPUT_SEMANTICS_INVALID');
    }
  } else if (
    result.status !== 'FAILED' ||
    result.businessOutcome !== 'NOT_PRODUCED' ||
    result.modelOutput !== null ||
    !result.errorCode
  ) {
    fail('RESULT_ENVELOPE_FAILURE_SEMANTICS_INVALID');
  }
  const requiredMissingCodes = new Set(
    task.hostResolvedMissingInputs.map((item) => item.code),
  );
  if (requiredMissingCodes.size === 0) return;
  if (result.status !== 'WAITING_INPUT') {
    fail('RESULT_ENVELOPE_HOST_MISSING_INPUT_MUST_WAIT');
  }
  const returnedCodes = new Set(result.missingInputs.map((item) => item.code));
  for (const code of requiredMissingCodes) {
    if (!returnedCodes.has(code)) {
      fail('RESULT_ENVELOPE_HOST_MISSING_INPUT_DROPPED');
    }
  }
}

function assertSourceRefsAllowed(
  resultRefs: ActionEnvelopeArtifactRef[],
  task: OpenClawTaskEnvelope,
): void {
  const allowed = new Map(
    task.sourceRefs.map((item) => [item.ref, item.sha256]),
  );
  for (const resultRef of resultRefs) {
    if (allowed.get(resultRef.ref) !== resultRef.sha256) {
      fail('RESULT_ENVELOPE_SOURCE_REF_UNAUTHORIZED');
    }
  }
}

function parseRecord(value: string, code: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) fail(code);
    return parsed;
  } catch (cause) {
    if (cause instanceof ActionEnvelopeError) throw cause;
    fail(code);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    fail(code);
  }
}

function assertRef(value: unknown): void {
  if (!isRecord(value)) fail('ACTION_ENVELOPE_REF_INVALID');
  assertExactKeys(value, ['ref', 'sha256'], 'ACTION_ENVELOPE_REF_INVALID');
  if (
    typeof value.ref !== 'string' ||
    value.ref.trim() === '' ||
    typeof value.sha256 !== 'string' ||
    !SHA256_PATTERN.test(value.sha256)
  ) {
    fail('ACTION_ENVELOPE_REF_INVALID');
  }
}

function assertMissingInput(value: unknown): void {
  if (!isRecord(value)) fail('ACTION_ENVELOPE_MISSING_INPUT_INVALID');
  assertExactKeys(
    value,
    ['code', 'message'],
    'ACTION_ENVELOPE_MISSING_INPUT_INVALID',
  );
  if (
    typeof value.code !== 'string' ||
    value.code.trim() === '' ||
    typeof value.message !== 'string' ||
    value.message.trim() === ''
  ) {
    fail('ACTION_ENVELOPE_MISSING_INPUT_INVALID');
  }
}

function assertStringArray(value: unknown, code: string): void {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    fail(code);
  }
}

function assertStringRecord(value: unknown, code: string): void {
  if (!isRecord(value)) fail(code);
  for (const [key, item] of Object.entries(value)) {
    if (key.trim() === '' || typeof item !== 'string' || item.trim() === '')
      fail(code);
  }
}

function assertRunMetrics(value: unknown): void {
  if (!isRecord(value)) fail('RESULT_ENVELOPE_RUN_METRICS_INVALID');
  assertExactKeys(
    value,
    ['durationMs', 'inputUnits', 'outputUnits'],
    'RESULT_ENVELOPE_RUN_METRICS_INVALID',
  );
  for (const item of Object.values(value)) {
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) {
      fail('RESULT_ENVELOPE_RUN_METRICS_INVALID');
    }
  }
}

function assertNullableText(value: unknown, code: string): void {
  if (value !== null && (typeof value !== 'string' || value.trim() === ''))
    fail(code);
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(code);
  return value;
}

function requiredRevision(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code);
  return Number(value);
}

function requiredArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

export class ActionEnvelopeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ActionEnvelopeError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ActionEnvelopeError(code);
}
