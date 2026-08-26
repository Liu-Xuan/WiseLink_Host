import type {
  ReviewActionDraftCandidate,
  ReviewTurnResponseType,
} from '@shared/api.interface';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import type { OpenClawResultEnvelope } from '../action-attempt/action-attempt-envelope.types';

export const REVIEW_RUNTIME_APP_ID = 'app_17c3zn24kv2' as const;
export const REVIEW_PROFILE_REF = 'wiselink-engineering' as const;
export const REVIEW_MODEL_POLICY_REF = 'GLM-5.1' as const;
export const REVIEW_SKILL_POLICY_REF =
  'wiselink-research-and-synthesize@r09.interactive-review.c2' as const;
export const REVIEW_TOOL_POLICY_REF =
  'wiselink-openclaw-engineering-assessment@1.1.0#interactive-review-c2' as const;
export const REVIEW_MCP_PACKAGE_VERSION = '1.1.0' as const;

export const REVIEW_ALLOWED_OPERATIONS = [
  'GET_WORKITEM_CONTEXT',
  'GET_EVALUATION_ITEM',
  'READ_SOURCE_REFS',
  'DRAFT_REVIEW_ACTION',
  'PREVIEW_AFFECTED_ITEMS',
  'GET_OPERATION_STATUS',
] as const;

export interface FrozenReviewSourceRef {
  sourceRefId: string;
  resourceArtifactRef: string;
  resourceArtifactSha256: string;
  value: Record<string, unknown>;
}

export interface ReviewTurnTaskContract {
  schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2';
  mode: 'INTERACTIVE_REVIEW';
  reviewConversationRef: string;
  reviewTurnRef: string;
  requestId: string;
  actorContextRef: string;
  inputRevision: number;
  selectedEvaluationItemId: string | null;
  userMessage: string;
  allowedOperations: string[];
  resourceRefs: FrozenReviewSourceRef[];
  allowedEvaluationItemIds: string[];
  allowedAdoptedInputRefs: string[];
  attachmentRefs: [];
  context: Record<string, unknown>;
  executionPolicy: {
    runtimeAppId: typeof REVIEW_RUNTIME_APP_ID;
    profileRef: typeof REVIEW_PROFILE_REF;
    modelPolicyRef: typeof REVIEW_MODEL_POLICY_REF;
    skillPolicyRef: typeof REVIEW_SKILL_POLICY_REF;
    toolPolicyRef: typeof REVIEW_TOOL_POLICY_REF;
  };
}

export interface ReviewTurnCandidateContract {
  schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c2';
  mode: 'INTERACTIVE_REVIEW';
  reviewConversationRef: string;
  reviewTurnRef: string;
  responseType: ReviewTurnResponseType;
  answer: string;
  sourceRefs: string[];
  missingInputs: string[];
  candidateEvidenceRefs: string[];
  reviewActionDraft: ReviewActionDraftCandidate | null;
  affectedItemIds: string[];
  warnings: string[];
  runtime: {
    runtimeAppId: typeof REVIEW_RUNTIME_APP_ID;
    profileRef: typeof REVIEW_PROFILE_REF;
  };
}

const RESPONSE_TYPES = new Set<ReviewTurnResponseType>([
  'ANSWER',
  'CLARIFYING_QUESTION',
  'SOURCE_LINK',
  'CANDIDATE_EVIDENCE',
  'REVIEW_ACTION_DRAFT',
  'INPUT_REQUEST',
  'AFFECTED_ITEMS_PREVIEW',
  'RESYNTHESIS_RESULT',
  'TASK_STATUS',
]);

export function parseReviewTurnTaskContract(
  value: unknown,
): ReviewTurnTaskContract {
  const record = requiredRecord(value, 'REVIEW_TASK_CONTRACT_INVALID');
  exactKeys(record, [
    'schemaVersion',
    'mode',
    'reviewConversationRef',
    'reviewTurnRef',
    'requestId',
    'actorContextRef',
    'inputRevision',
    'selectedEvaluationItemId',
    'userMessage',
    'allowedOperations',
    'resourceRefs',
    'allowedEvaluationItemIds',
    'allowedAdoptedInputRefs',
    'attachmentRefs',
    'context',
    'executionPolicy',
  ]);
  if (
    record.schemaVersion !== 'wiselink.3_1.review_turn_task.v1.c2' ||
    record.mode !== 'INTERACTIVE_REVIEW'
  ) {
    fail('REVIEW_TASK_CONTRACT_UNSUPPORTED');
  }
  requiredText(
    record.reviewConversationRef,
    'REVIEW_TASK_CONVERSATION_REQUIRED',
  );
  requiredText(record.reviewTurnRef, 'REVIEW_TASK_TURN_REQUIRED');
  requiredText(record.requestId, 'REVIEW_TASK_REQUEST_REQUIRED');
  requiredText(record.actorContextRef, 'REVIEW_TASK_ACTOR_CONTEXT_REQUIRED');
  requiredRevision(record.inputRevision, 'REVIEW_TASK_REVISION_INVALID');
  nullableText(
    record.selectedEvaluationItemId,
    'REVIEW_TASK_SELECTED_ITEM_INVALID',
  );
  requiredText(record.userMessage, 'REVIEW_TASK_USER_MESSAGE_REQUIRED');
  const allowedOperations = stringArray(
    record.allowedOperations,
    'REVIEW_TASK_ALLOWED_OPERATIONS_INVALID',
  );
  if (
    JSON.stringify(allowedOperations) !==
    JSON.stringify(REVIEW_ALLOWED_OPERATIONS)
  ) {
    fail('REVIEW_TASK_ALLOWED_OPERATIONS_INVALID');
  }
  const resourceRefs = requiredArray(
    record.resourceRefs,
    'REVIEW_TASK_RESOURCE_REFS_INVALID',
  ).map(parseFrozenSourceRef);
  assertUnique(
    resourceRefs.map((item) => item.sourceRefId),
    'REVIEW_TASK_RESOURCE_REFS_DUPLICATE',
  );
  const allowedEvaluationItemIds = stringArray(
    record.allowedEvaluationItemIds,
    'REVIEW_TASK_EVALUATION_ITEMS_INVALID',
  );
  assertUnique(
    allowedEvaluationItemIds,
    'REVIEW_TASK_EVALUATION_ITEMS_DUPLICATE',
  );
  const allowedAdoptedInputRefs = stringArray(
    record.allowedAdoptedInputRefs,
    'REVIEW_TASK_ADOPTED_INPUTS_INVALID',
  );
  assertUnique(allowedAdoptedInputRefs, 'REVIEW_TASK_ADOPTED_INPUTS_DUPLICATE');
  if (
    !Array.isArray(record.attachmentRefs) ||
    record.attachmentRefs.length !== 0
  ) {
    fail('REVIEW_TASK_ATTACHMENTS_OUT_OF_SCOPE');
  }
  requiredRecord(record.context, 'REVIEW_TASK_CONTEXT_INVALID');
  const executionPolicy = requiredRecord(
    record.executionPolicy,
    'REVIEW_TASK_EXECUTION_POLICY_INVALID',
  );
  exactKeys(executionPolicy, [
    'runtimeAppId',
    'profileRef',
    'modelPolicyRef',
    'skillPolicyRef',
    'toolPolicyRef',
  ]);
  if (
    executionPolicy.runtimeAppId !== REVIEW_RUNTIME_APP_ID ||
    executionPolicy.profileRef !== REVIEW_PROFILE_REF ||
    executionPolicy.modelPolicyRef !== REVIEW_MODEL_POLICY_REF ||
    executionPolicy.skillPolicyRef !== REVIEW_SKILL_POLICY_REF ||
    executionPolicy.toolPolicyRef !== REVIEW_TOOL_POLICY_REF
  ) {
    fail('REVIEW_TASK_EXECUTION_POLICY_INVALID');
  }
  return structuredClone(record) as unknown as ReviewTurnTaskContract;
}

export function parseReviewTurnCandidateContract(input: {
  result: OpenClawResultEnvelope;
  task: ReviewTurnTaskContract;
}): ReviewTurnCandidateContract {
  const { result, task } = input;
  if (
    result.status !== 'SUCCEEDED' ||
    result.businessOutcome !== 'CANDIDATE_READY' ||
    result.candidateStatus !== null ||
    result.errorCode !== null ||
    result.errorDetail !== null ||
    result.outputArtifactRefs.length !== 0 ||
    typeof result.modelOutput !== 'string' ||
    !result.modelOutput.trim()
  ) {
    fail('REVIEW_RESULT_OUTCOME_INVALID');
  }
  assertNoDuplicateJsonKeys(result.modelOutput);
  let raw: unknown;
  try {
    raw = JSON.parse(result.modelOutput) as unknown;
  } catch {
    fail('REVIEW_RESULT_MODEL_OUTPUT_JSON_INVALID');
  }
  const record = requiredRecord(raw, 'REVIEW_RESULT_CONTRACT_INVALID');
  exactKeys(record, [
    'schemaVersion',
    'mode',
    'reviewConversationRef',
    'reviewTurnRef',
    'responseType',
    'answer',
    'sourceRefs',
    'missingInputs',
    'candidateEvidenceRefs',
    'reviewActionDraft',
    'affectedItemIds',
    'warnings',
    'runtime',
  ]);
  if (
    record.schemaVersion !== 'wiselink.3_1.review_turn_candidate.v1.c2' ||
    record.mode !== 'INTERACTIVE_REVIEW' ||
    record.reviewConversationRef !== task.reviewConversationRef ||
    record.reviewTurnRef !== task.reviewTurnRef ||
    !RESPONSE_TYPES.has(record.responseType as ReviewTurnResponseType)
  ) {
    fail('REVIEW_RESULT_BINDING_INVALID');
  }
  requiredText(record.answer, 'REVIEW_RESULT_ANSWER_REQUIRED');
  const sourceRefs = stringArray(
    record.sourceRefs,
    'REVIEW_RESULT_SOURCE_REFS_INVALID',
  );
  const missingInputs = stringArray(
    record.missingInputs,
    'REVIEW_RESULT_MISSING_INPUTS_INVALID',
  );
  const candidateEvidenceRefs = stringArray(
    record.candidateEvidenceRefs,
    'REVIEW_RESULT_EVIDENCE_REFS_INVALID',
  );
  const affectedItemIds = stringArray(
    record.affectedItemIds,
    'REVIEW_RESULT_AFFECTED_ITEMS_INVALID',
  );
  const warnings = stringArray(
    record.warnings,
    'REVIEW_RESULT_WARNINGS_INVALID',
  );
  [
    sourceRefs,
    missingInputs,
    candidateEvidenceRefs,
    affectedItemIds,
    warnings,
  ].forEach((values) =>
    assertUnique(values, 'REVIEW_RESULT_DUPLICATES_INVALID'),
  );
  assertSubset(
    [...sourceRefs, ...candidateEvidenceRefs],
    task.resourceRefs.map((item) => item.sourceRefId),
    'REVIEW_RESULT_SOURCE_REF_NOT_ALLOWED',
  );
  const reviewActionDraft = parseReviewActionDraft(record.reviewActionDraft);
  if (reviewActionDraft) {
    if (reviewActionDraft.baseRevision !== task.inputRevision) {
      fail('REVIEW_RESULT_DRAFT_REVISION_MISMATCH');
    }
    assertSubset(
      [
        reviewActionDraft.evaluationItemId,
        ...reviewActionDraft.affectedItemIds,
      ],
      task.allowedEvaluationItemIds,
      'REVIEW_RESULT_DRAFT_ITEM_NOT_ALLOWED',
    );
    assertSubset(
      reviewActionDraft.sourceRefs,
      task.resourceRefs.map((item) => item.sourceRefId),
      'REVIEW_RESULT_DRAFT_SOURCE_REF_NOT_ALLOWED',
    );
    assertSubset(
      reviewActionDraft.adoptedInputRefs,
      task.allowedAdoptedInputRefs,
      'REVIEW_RESULT_DRAFT_ADOPTED_INPUT_NOT_ALLOWED',
    );
    if (
      !reviewActionDraft.affectedItemIds.includes(
        reviewActionDraft.evaluationItemId,
      ) ||
      JSON.stringify(reviewActionDraft.affectedItemIds) !==
        JSON.stringify(affectedItemIds)
    ) {
      fail('REVIEW_RESULT_DRAFT_AFFECTED_ITEMS_MISMATCH');
    }
  }
  assertSubset(
    affectedItemIds,
    task.allowedEvaluationItemIds,
    'REVIEW_RESULT_AFFECTED_ITEM_NOT_ALLOWED',
  );
  if (
    (record.responseType === 'REVIEW_ACTION_DRAFT') !==
    (reviewActionDraft !== null)
  ) {
    fail('REVIEW_RESULT_DRAFT_RESPONSE_MISMATCH');
  }
  const runtime = requiredRecord(
    record.runtime,
    'REVIEW_RESULT_RUNTIME_INVALID',
  );
  exactKeys(runtime, ['runtimeAppId', 'profileRef']);
  if (
    runtime.runtimeAppId !== REVIEW_RUNTIME_APP_ID ||
    runtime.profileRef !== REVIEW_PROFILE_REF ||
    result.modelVersion !== REVIEW_MODEL_POLICY_REF ||
    result.toolVersions['wiselink-openclaw-engineering-assessment'] !==
      REVIEW_MCP_PACKAGE_VERSION ||
    !result.promptVersion.trim() ||
    !result.skillVersion.trim()
  ) {
    fail('REVIEW_RESULT_PROVENANCE_INVALID');
  }
  return structuredClone({
    ...record,
    reviewActionDraft,
  }) as unknown as ReviewTurnCandidateContract;
}

function parseFrozenSourceRef(value: unknown): FrozenReviewSourceRef {
  const record = requiredRecord(value, 'REVIEW_TASK_RESOURCE_REF_INVALID');
  exactKeys(record, [
    'sourceRefId',
    'resourceArtifactRef',
    'resourceArtifactSha256',
    'value',
  ]);
  const sourceRefId = requiredText(
    record.sourceRefId,
    'REVIEW_TASK_RESOURCE_REF_ID_REQUIRED',
  );
  requiredText(
    record.resourceArtifactRef,
    'REVIEW_TASK_RESOURCE_ARTIFACT_REQUIRED',
  );
  const sha256 = requiredText(
    record.resourceArtifactSha256,
    'REVIEW_TASK_RESOURCE_HASH_REQUIRED',
  );
  if (!/^[0-9a-f]{64}$/u.test(sha256))
    fail('REVIEW_TASK_RESOURCE_HASH_INVALID');
  const frozen = requiredRecord(
    record.value,
    'REVIEW_TASK_RESOURCE_VALUE_INVALID',
  );
  if (frozen.sourceRefId !== sourceRefId)
    fail('REVIEW_TASK_RESOURCE_BINDING_INVALID');
  return structuredClone(record) as unknown as FrozenReviewSourceRef;
}

function parseReviewActionDraft(
  value: unknown,
): ReviewActionDraftCandidate | null {
  if (value === null) return null;
  const record = requiredRecord(value, 'REVIEW_RESULT_DRAFT_INVALID');
  exactKeys(record, [
    'baseRevision',
    'evaluationItemId',
    'proposedStatus',
    'adoptedInputRefs',
    'sourceRefs',
    'assumptions',
    'affectedItemIds',
    'overallImpact',
  ]);
  requiredRevision(record.baseRevision, 'REVIEW_RESULT_DRAFT_REVISION_INVALID');
  requiredText(record.evaluationItemId, 'REVIEW_RESULT_DRAFT_ITEM_REQUIRED');
  requiredText(record.proposedStatus, 'REVIEW_RESULT_DRAFT_STATUS_REQUIRED');
  ['adoptedInputRefs', 'sourceRefs', 'assumptions', 'affectedItemIds'].forEach(
    (key) =>
      assertUnique(
        stringArray(record[key], 'REVIEW_RESULT_DRAFT_INVALID'),
        'REVIEW_RESULT_DRAFT_DUPLICATE',
      ),
  );
  if (typeof record.overallImpact !== 'boolean') {
    fail('REVIEW_RESULT_DRAFT_OVERALL_IMPACT_INVALID');
  }
  return structuredClone(record) as unknown as ReviewActionDraftCandidate;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    fail('REVIEW_CONTRACT_EXACT_SHAPE_INVALID');
  }
}

function requiredRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(code);
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function stringArray(value: unknown, code: string): string[] {
  const values = requiredArray(value, code);
  if (values.some((item) => typeof item !== 'string' || !item.trim()))
    fail(code);
  return [...values] as string[];
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    fail(code);
  return value;
}

function nullableText(value: unknown, code: string): string | null {
  if (value === null) return null;
  return requiredText(value, code);
}

function requiredRevision(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code);
  return Number(value);
}

function assertUnique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}

function assertSubset(values: string[], allowed: string[], code: string): void {
  const allowlist = new Set(allowed);
  if (values.some((value) => !allowlist.has(value))) fail(code);
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code, statusCode: 400 });
}
