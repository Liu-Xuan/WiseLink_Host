import { z } from 'zod/v4';
import type { OpenClawTaskEnvelope } from './action-attempt-envelope.types';

export const INITIAL_ANALYSIS_REQUEST_SCHEMA =
  'wiselink.3_1.initial_analysis_request.v1';

const requestSchema = z.strictObject({
  schemaVersion: z.literal(INITIAL_ANALYSIS_REQUEST_SCHEMA),
  taskType: z.enum([
    'OPENCLAW_TRANSLATE',
    'OPENCLAW_DYNAMIC_EVALUATION',
    'OPENCLAW_OVERALL_SYNTHESIS',
  ]),
  requestId: z.union([z.string().uuid(), z.string().regex(/^original-[1-9][0-9]{0,15}$/), z.string().regex(/^[a-f0-9]{64}$/u)]),
  originalParseRunId: z.string().min(1).max(200).optional(),
  /** Browser queues exact intent; genuine runtime admission resolves native metadata. */
  nativeOverallAdmission: z.strictObject({
    workRevisionRef: z.string().regex(/^JAWR-[A-Za-z0-9-]{1,91}$/u),
    workRevision: z.number().int().positive(),
    regenerationRequestId: z.string().min(1).max(200).optional(),
  }).optional(),
  retranslateBlockIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(64)
    .optional(),
});

export type InitialAnalysisRequestInput = z.infer<typeof requestSchema>;

/** A browser reserves intent in the existing queue; Hosted prepares the input. */
export function buildInitialAnalysisRequestInput(
  input: Omit<InitialAnalysisRequestInput, 'schemaVersion'>,
): InitialAnalysisRequestInput {
  const request = requestSchema.parse({
    ...input,
    schemaVersion: INITIAL_ANALYSIS_REQUEST_SCHEMA,
  });
  if (request.nativeOverallAdmission &&
      (request.taskType !== 'OPENCLAW_OVERALL_SYNTHESIS' || !request.originalParseRunId))
    throw new Error('JOBAID_TDMS_OVERALL_REQUEST_INVALID');
  if ((request.requestId.startsWith('original-') || /^[a-f0-9]{64}$/u.test(request.requestId)) && !request.originalParseRunId)
    throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_ORIGINAL_SCOPE_INVALID');
  if (request.originalParseRunId && request.taskType === 'OPENCLAW_TRANSLATE')
    throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_ORIGINAL_SCOPE_INVALID');
  if (
    request.retranslateBlockIds &&
    (request.taskType !== 'OPENCLAW_TRANSLATE' ||
      new Set(request.retranslateBlockIds).size !==
        request.retranslateBlockIds.length)
  )
    throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_BLOCK_SCOPE_INVALID');
  return request;
}

export function readInitialAnalysisRequestInput(
  task: OpenClawTaskEnvelope,
): InitialAnalysisRequestInput | null {
  if (task.modelInput.schemaVersion !== INITIAL_ANALYSIS_REQUEST_SCHEMA)
    return null;
  const request = buildInitialAnalysisRequestInput(
    requestSchema.parse(task.modelInput),
  );
  const operation = {
    OPENCLAW_TRANSLATE: 'translate',
    OPENCLAW_DYNAMIC_EVALUATION: 'dynamic',
    OPENCLAW_OVERALL_SYNTHESIS: 'overall',
  }[request.taskType];
  // The browser reserves the connector scope used by the authorized Host
  // preparation. Translation never uses knowledge retrieval. Replay still
  // requires this exact connector list and preparation verifies the grant.
  const connectorsValid = task.allowedConnectors.length === 0 || (
    request.taskType !== 'OPENCLAW_TRANSLATE' &&
    task.allowedConnectors.length === 1 &&
    task.allowedConnectors[0] === 'feishu-aily-user'
  );
  const nativeAdmission = request.nativeOverallAdmission;
  const expectedIdempotency = nativeAdmission
    ? nativeAdmission.regenerationRequestId
      ? `openclaw-v1:overall:${task.workItemId}:${task.baseRevision}:USER_REQUESTED_REGENERATION:${nativeAdmission.regenerationRequestId}`
      : `openclaw-v1:overall:${task.workItemId}:${task.baseRevision}:problem-v2`
    : `openclaw-v2:${operation}:${task.workItemId}:${task.documentVersionId}:${request.requestId}`;
  if (nativeAdmission && request.requestId !== `original-${task.baseRevision}`)
    throw new Error('JOBAID_TDMS_OVERALL_REQUEST_INVALID');
  if (
    task.taskType !== request.taskType ||
    task.sourceRefs.length !== 1 ||
    !connectorsValid ||
    task.idempotencyKey !== expectedIdempotency
  )
    throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_BINDING_INVALID');
  return request;
}

export function assertPreparedInitialAnalysisInput(
  request: InitialAnalysisRequestInput,
  modelInput: Record<string, unknown>,
): void {
  const expectedSchema =
    request.taskType === 'OPENCLAW_TRANSLATE'
      ? 'wiselink.3_1.translation_task.v2'
      : 'wiselink.jobaid-problem-task.v2';
  if (
    (modelInput.schemaVersion !== expectedSchema && !(request.taskType !== 'OPENCLAW_TRANSLATE' && modelInput.schemaVersion === 'wiselink.jobaid-problem-task.v3')) ||
    (request.taskType === 'OPENCLAW_TRANSLATE' &&
      JSON.stringify(modelInput.retranslateBlockIds ?? []) !==
        JSON.stringify(request.retranslateBlockIds ?? []))
  )
    throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_PREPARED_SCOPE_INVALID');
  if (request.originalParseRunId) {
    const binding = z.object({ modelInput: z.object({ documentOverview: z.object({
      original: z.object({ binding: z.object({ parseRunId: z.literal(request.originalParseRunId) }) }),
    }) }) }).safeParse(modelInput);
    if (!binding.success) throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_ORIGINAL_CHANGED');
  }
  if (request.nativeOverallAdmission) {
    const binding = z.object({
      tdmsContext: z.object({ schemaVersion: z.literal('wiselink.tdms-runtime-context.v1') }),
      previousWork: z.object({
        workRevisionRef: z.literal(request.nativeOverallAdmission.workRevisionRef),
        workRevision: z.literal(request.nativeOverallAdmission.workRevision),
      }),
    }).safeParse(modelInput);
    if (!binding.success) throw new Error('JOBAID_TDMS_OVERALL_PREPARED_BINDING_INVALID');
  }
}
