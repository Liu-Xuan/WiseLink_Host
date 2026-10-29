import { z } from 'zod/v4';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import type { OpenClawTaskEnvelope } from '../action-attempt/action-attempt-envelope.types';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { JobAidProblemTaskInput } from './jobaid-problem-task';
import type { CanonicalVerifiedOpenClawAttemptScope } from './canonical-service-scope.authorization';
import type { AilyExecutorRun } from './aily-executor-run';
import type { SQL } from 'drizzle-orm';

const taskContextRef = z.string().min(1).max(128);
export const ailySourceCommand = z.strictObject({taskContextRef,
  sourceRefs: z.array(z.string().min(1).max(512)).min(1).max(96), purpose: z.string().trim().min(1).max(2000),
  context: z.enum(['EXACT', 'PAGE']).default('PAGE')});
export const ailyValidateCommand = z.strictObject({taskContextRef, workJson: z.string().min(2)});
export const ailySaveCommand = z.strictObject({taskContextRef, candidateRef: z.string().uuid()});
export const ailyReadCommand = z.strictObject({taskContextRef,
  saveRequestId: z.string().min(1).max(96).optional(), workRevisionRef: z.string().regex(/^JAWR-[A-Za-z0-9-]{1,91}$/u).optional()});
export const ailyStageCommand = z.strictObject({taskContextRef, workRevisionRef: z.string().regex(/^JAWR-[A-Za-z0-9-]{1,91}$/u)});
export const ailyFinishCommand = ailyStageCommand;

export interface AilyTaskDomainSnapshot {
  row: ActionAttemptRow;
  task: OpenClawTaskEnvelope;
  /** Full private input parsed from the immutable task, never supplied by a model. */
  sealedInput: JobAidProblemTaskInput;
  run: AilyExecutorRun;
  scope: CanonicalVerifiedOpenClawAttemptScope;
  baseline: JobAidWorkRevision | null;
  /** Current identity and original execution/outer fence, never supplied as JSON. */
  writePredicate: SQL;
}

const trusted = new WeakSet<object>();
/** Internal capability created only after the facade's current authorization. */
export class AilyTrustedTaskContext {
  private constructor(readonly snapshot: AilyTaskDomainSnapshot,
    readonly revalidate: () => Promise<AilyTaskDomainSnapshot>) {trusted.add(this);}

  static authorized(snapshot: AilyTaskDomainSnapshot, revalidate: () => Promise<AilyTaskDomainSnapshot>): AilyTrustedTaskContext {
    return new AilyTrustedTaskContext(snapshot, revalidate);
  }
}
export function assertAilyTrustedTaskContext(value: AilyTrustedTaskContext): void {
  if (!trusted.has(value)) throw new Error('AILY_DOMAIN_TRUSTED_CONTEXT_REQUIRED');
}
