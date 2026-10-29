import { z } from 'zod/v4';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

const chatId = z.string().regex(/^\d{1,64}$/u);
const sessionId = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/u);
const errorCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$/u);
const instant = z.iso.datetime();
const originalRequest = /^original-[1-9][0-9]{0,15}$/u;
export const ailyRequestIdSchema = z.union([z.string().uuid(), z.string().regex(originalRequest)]);
const pendingSchema = z.strictObject({
  candidateRef: z.string().uuid(), saveRequestId: z.string().regex(/^[A-Za-z0-9:_-]{1,96}$/u),
  phase: z.enum(['VALIDATED', 'SAVE_STARTED', 'SAVED', 'READ']), validatedAt: instant,
  workJson: z.string().min(2), expectedWorkRevision: z.number().int().nonnegative(),
  previousWorkRevisionRef: z.string().nullable(),
  workRevisionRef: z.string().regex(/^JAWR-[A-Za-z0-9-]{1,91}$/u).optional(),
  workRevision: z.number().int().positive().optional(), readObservedAt: instant.optional(),
}).superRefine((value, context) => {
  if (['SAVED', 'READ'].includes(value.phase) && (!value.workRevisionRef || !value.workRevision))
    context.addIssue({code: 'custom', message: 'Saved revision required'});
  if (value.phase === 'READ' && !value.readObservedAt)
    context.addIssue({code: 'custom', message: 'Independent read required'});
});
const postSchema = z.discriminatedUnion('state', [
  z.strictObject({state: z.literal('STARTED'), startedAt: instant, requestBody: z.string().min(1)}),
  z.strictObject({state: z.literal('ACCEPTED'), startedAt: instant, acceptedAt: instant,
    requestBody: z.string().min(1), chatId, remoteSessionId: sessionId.nullable()}),
  z.strictObject({state: z.literal('UNKNOWN'), startedAt: instant, observedAt: instant, requestBody: z.string().min(1), errorCode}),
]);

/** Private dispatch facts on the existing attempt, never a second business queue. */
export const ailyExecutorRunSchema = z.strictObject({
  schemaVersion: z.literal('wiselink.aily-executor-run.v1'),
  executor: z.literal('AILY_AGENT_V1'),
  requestId: ailyRequestIdSchema,
  agentId: z.string().regex(/^agent_[A-Za-z0-9_-]{1,59}$/u),
  publicationRef: z.string().min(1),
  configurationSource: z.string().min(1),
  scope: z.strictObject({tenantId: z.string().min(1), workItemId: z.string().min(1),
    intakeRequestId: z.string().min(1), principalId: z.string().startsWith('service:')}),
  modelEvidence: z.strictObject({selectedModelRef: z.enum(['aily/glm-5.3', 'aily/deepseek-v4-pro']), actualModelRef: z.null()}),
  hostSessionId: z.string().uuid().nullable(),
  invocation: z.strictObject({purpose: z.enum(['BROWSER', 'BACKGROUND']), identityRef: z.string().min(1).max(255),
    callerAppId: z.string().regex(/^cli_[A-Za-z0-9_-]+$/u),
    configurationSource: z.string().min(1).max(255)}).optional(),
  leaseGeneration: z.number().int().positive(),
  post: postSchema,
  pending: pendingSchema.optional(),
  observation: z.strictObject({checkedAt: instant, remoteStatus: z.string().min(1).max(96),
    remoteFinishReason: z.string().max(200).optional()}).optional(),
}).superRefine((value, context) => {
  if (value.invocation?.purpose === 'BACKGROUND' ? value.hostSessionId !== null :
      value.hostSessionId === null || originalRequest.test(value.requestId))
    context.addIssue({code: 'custom', message: 'Exact browser or background invocation required'});
});

export type AilyExecutorRun = z.infer<typeof ailyExecutorRunSchema>;
export interface AilyFinalCommitGuard {
  actorUserId: string;
  pending: NonNullable<AilyExecutorRun['pending']> & {
    phase: 'READ'; workRevisionRef: string; workRevision: number; readObservedAt: string;
  };
}

export function ailyFinalCommitGuard(run:AilyExecutorRun,workRevisionRef:string,actorUserId:string):AilyFinalCommitGuard {
  const pending=pendingSchema.parse(run.pending);
  if(pending.phase!=='READ'||pending.workRevisionRef!==workRevisionRef||!pending.workRevision||!pending.readObservedAt||
      pending.workRevision!==pending.expectedWorkRevision+1||!actorUserId.trim())throw new Error('AILY_FINAL_INDEPENDENT_READ_REQUIRED');
  return {actorUserId,pending:{...pending,phase:'READ',workRevisionRef,workRevision:pending.workRevision,readObservedAt:pending.readObservedAt}};
}

export function sameAilyPendingOperation(left:AilyExecutorRun['pending'],right:AilyExecutorRun['pending']):boolean {
  return !!left&&!!right&&left.candidateRef===right.candidateRef&&left.saveRequestId===right.saveRequestId&&
    left.workJson===right.workJson&&left.expectedWorkRevision===right.expectedWorkRevision&&
    left.previousWorkRevisionRef===right.previousWorkRevisionRef;
}

export function parseAilyExecutorRun(value: unknown): AilyExecutorRun | null {
  if (value === null || value === undefined) return null;
  try {
    return ailyExecutorRunSchema.parse(typeof value === 'string' ? JSON.parse(value) : value);
  } catch {
    throw new Error('AILY_EXECUTOR_RUN_INVALID');
  }
}

export function serializeAilyExecutorRun(value: AilyExecutorRun): string {
  return canonicalJson(ailyExecutorRunSchema.parse(value));
}

/** The existing original producer is the only non-browser request form admitted.
 * Both unprepared and fully sealed tasks keep the original parse identity.
 */
export function assertAilyRequestTaskBinding(requestId: string, task: {
  workItemId: string; documentVersionId: string; idempotencyKey: string; modelInput: Record<string, unknown>;
}): void {
  if (!ailyRequestIdSchema.safeParse(requestId).success ||
      task.idempotencyKey !== `openclaw-v2:dynamic:${task.workItemId}:${task.documentVersionId}:${requestId}`)
    throw new Error('AILY_REQUEST_TASK_BINDING_CHANGED');
  if (!originalRequest.test(requestId)) return;
  const revision = Number(requestId.slice('original-'.length));
  if (!Number.isSafeInteger(revision)) throw new Error('AILY_REQUEST_TASK_BINDING_CHANGED');
  const initial = z.object({requestId: z.literal(requestId), originalParseRunId: z.string().min(1)}).safeParse(task.modelInput);
  const prepared = z.object({modelInput: z.object({documentOverview: z.object({original: z.object({binding:
    z.object({parseRunId: z.string().min(1), parseRevision: z.literal(revision)})})})})}).safeParse(task.modelInput);
  if (!initial.success && !prepared.success) throw new Error('AILY_REQUEST_TASK_BINDING_CHANGED');
}

/** CLI wording in the unchanged RC1 definition is explicitly scoped to this executor. */
export const AILY_TASK_ROLE_MAPPING = Object.freeze({
  sourceRole: 'Codex CLI', currentExecutor: '企业智能体',
  instruction: '本轮由企业智能体承担任务内分析、调查、工具反馈与修订。检查单中Codex CLI角色措辞在本轮映射至企业智能体；定义原文、版本及hash保持原值。Host保有身份、授权、来源、版本、SAVE/CAS/READ、Overall及正式采用权。',
});
