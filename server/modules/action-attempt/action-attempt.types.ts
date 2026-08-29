import type {
  ActionAttemptStatus,
  OpenClawActionTaskType,
  OpenClawLeaseClaim,
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from './action-attempt-envelope.types';

export const ACTION_ATTEMPT_REQUEST_ORIGIN = 'OPENCLAW_MCP_V1';
export const ACTION_ATTEMPT_MAX_PARALLEL = 4;
export const ACTION_ATTEMPT_LEASE_MS = 30 * 60_000;
export const ACTION_ATTEMPT_DEFAULT_DEADLINE_MS = 60 * 60_000;
export const ACTION_ATTEMPT_COMMIT_RECOVERY_MS = 30_000;

export interface NewActionAttemptIdentity {
  attemptId: string;
  operationRef: string;
  triggerRequestId: string;
  attemptNo: number;
  createdAt: Date;
}

export interface ReserveActionAttemptInput {
  workItemId: string;
  taskType: OpenClawActionTaskType;
  tenantId: string;
  actorUserId: string;
  documentVersionId: string;
  inputRevision: number;
  baseRevision: number;
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
  deadlineAt?: Date;
  sourceRefs?: OpenClawTaskEnvelope['sourceRefs'];
  allowedConnectors?: string[];
  hostResolvedMissingInputs?: OpenClawTaskEnvelope['hostResolvedMissingInputs'];
  buildModelInput(
    identity: NewActionAttemptIdentity,
  ): Promise<Record<string, unknown>>;
}

export interface ReserveAndClaimInput extends ReserveActionAttemptInput {
  leaseOwner: string;
  /**
   * User-requested overall regeneration is queued before an external hosted
   * session is woken. Allow that session's first claim to atomically refresh
   * an elapsed default deadline when the attempt has never started.
   */
  allowExpiredUnclaimedDeadlineRefresh?: boolean;
}

export interface ReserveActionAttemptResult {
  row: ActionAttemptRow;
  task: OpenClawTaskEnvelope;
  created: boolean;
}

export type ReserveAndClaimResult = OpenClawLeaseClaim & {
  created: boolean;
  triggerRequestId: string;
};

export interface ActionAttemptFence {
  attemptRef: string;
  leaseToken: string;
  leaseGeneration: number;
}

export interface PreparedActionAttemptCommit {
  row: ActionAttemptRow;
  task: OpenClawTaskEnvelope;
  result: OpenClawResultEnvelope;
  recovery: boolean;
}

export interface ActionAttemptTerminalProjection {
  attemptRef: string;
  status: ActionAttemptStatus;
  projectionApplied: boolean;
  terminalReason: string | null;
}

export interface ActionAttemptWorkItemBinding {
  workItemId: string;
  tenantId: string;
  documentVersionId: string;
  revision: number;
  projectionJson: string;
}

export interface ActionAttemptRow {
  attemptId: string;
  operationRef: string | null;
  triggerRequestId: string;
  workItemId: string;
  actionType: string;
  attemptNo: number;
  status: string;
  requestOrigin: string;
  tenantId: string;
  actorUserId: string;
  priority: number;
  inputRevision: number | null;
  baseRevision: number | null;
  documentVersionId: string | null;
  taskEnvelopeJson: string | null;
  taskInputHash: string | null;
  resultEnvelopeJson: string | null;
  resultContentHash: string | null;
  idempotencyKey: string | null;
  claimCount: number;
  retryCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseGeneration: number;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  nextAttemptAt: Date | null;
  deadlineAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelReason: string | null;
  terminalReason: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  projectionApplied: boolean;
  executorSessionKey: string | null;
  commitStartedAt: Date | null;
  leaseSlot: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
