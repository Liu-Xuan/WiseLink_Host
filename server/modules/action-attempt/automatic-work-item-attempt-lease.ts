import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { workItem } from '../../database/schema';
import type { ActionAttemptRow } from './action-attempt.types';

/** Host-only snapshot of the existing queue grant; never model instructions. */
export interface AutomaticWorkItemTaskLease {
  requestId: string;
  leaseGeneration: number;
}

export function automaticWorkItemTaskLease(value: unknown): AutomaticWorkItemTaskLease | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'leaseGeneration,requestId' ||
      !('requestId' in value) || typeof value.requestId !== 'string' ||
      !value.requestId.trim() || value.requestId.length > 96 ||
      !('leaseGeneration' in value) || !Number.isSafeInteger(value.leaseGeneration) ||
      Number(value.leaseGeneration) < 1)
    throw new Error('AUTO_WORK_ITEM_TASK_LEASE_BINDING_INVALID');
  return { requestId: value.requestId, leaseGeneration: Number(value.leaseGeneration) };
}

export function taskAutomaticWorkItemLease(row: Pick<ActionAttemptRow, 'taskEnvelopeJson'>): AutomaticWorkItemTaskLease | undefined {
  if (!row.taskEnvelopeJson) return undefined;
  const task: { modelInput?: { automaticWorkItemLease?: unknown } } = JSON.parse(row.taskEnvelopeJson);
  return automaticWorkItemTaskLease(task.modelInput?.automaticWorkItemLease);
}

/** Caller holds a transaction. Lock order is source WorkItem(s), grant, attempt.
 * The grant remains locked until the actual write commits, including CAS. */
export async function assertAutomaticWorkItemAttemptLease(
  database: PostgresJsDatabase,
  row: ActionAttemptRow,
  principalId: string,
  required = false,
): Promise<void> {
  const bound = taskAutomaticWorkItemLease(row);
  if (!bound) {
    if (required) throw new Error('AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED');
    return;
  }
  const [owner] = await database.select().from(workItem).where(and(
    eq(workItem.tenantId, row.tenantId), eq(workItem.workItemId, row.workItemId),
  )).limit(1).for('update');
  const [grant] = await database.select().from(autoWorkItemAuthorization).where(and(
    eq(autoWorkItemAuthorization.tenantId, row.tenantId),
    eq(autoWorkItemAuthorization.workItemId, row.workItemId),
  )).limit(1).for('share');
  if (!owner || !grant || grant.status !== 'LEASED' ||
      grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
      grant.requestId !== bound.requestId || grant.leaseGeneration !== bound.leaseGeneration ||
      grant.leaseOwner !== principalId || !grant.leaseExpiresAt || grant.leaseExpiresAt <= new Date() ||
      grant.actorUserId !== owner.requestedByUserId || grant.requestId !== owner.requestId ||
      grant.documentId !== owner.documentId || grant.documentVersionId !== row.documentVersionId ||
      grant.documentVersionId !== owner.documentVersionId ||
      grant.sourceArtifactId !== owner.sourceArtifactId ||
      grant.sourceFileSha256 !== owner.sourceFileSha256 ||
      Number(grant.sourceByteLength) !== Number(owner.sourceByteLength))
    throw new Error('AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED');
}
