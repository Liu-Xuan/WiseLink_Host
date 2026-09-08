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
  requestId: z.string().uuid(),
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
  if (
    task.taskType !== request.taskType ||
    task.sourceRefs.length !== 1 ||
    task.allowedConnectors.length !== 0 ||
    task.idempotencyKey !==
      `openclaw-v2:${operation}:${task.workItemId}:${task.documentVersionId}:${request.requestId}`
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
    modelInput.schemaVersion !== expectedSchema ||
    (request.taskType === 'OPENCLAW_TRANSLATE' &&
      JSON.stringify(modelInput.retranslateBlockIds ?? []) !==
        JSON.stringify(request.retranslateBlockIds ?? []))
  )
    throw new Error('ACTION_ATTEMPT_INITIAL_REQUEST_PREPARED_SCOPE_INVALID');
}
