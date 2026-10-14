import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { actionAttempt } from '../../database/schema';
import { derivedSummaryRevision } from '../../database/derived-summary.schema';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import type {
  DerivedSummaryRepository,
  SummaryAttempt,
} from './derived-summary.repository';
import type { SummaryActor } from './derived-summary-members.service';
import { retryWikiDemand } from './hierarchical-wiki-demand';
import {
  lockWikiBranch,
  storeWikiDemand,
  type WikiRow,
} from './hierarchical-wiki.persistence';
import { summaryError } from './derived-summary.validation';

const terminal: ReadonlySet<string> = new Set([
  'CANCELLED',
  'FAILED',
  'SUCCEEDED',
  'CONFLICT',
  'TIMED_OUT',
  'OBSOLETE',
]);

/** Metadata only: the request and delegated owner must match the registry. */
export async function readActiveWikiAttempt(
  database: PostgresJsDatabase,
  repository: DerivedSummaryRepository,
  row: WikiRow,
): Promise<SummaryAttempt | null> {
  const active: WikiRow['state']['active'] = row.state.active;
  if (!active) return null;
  const attempt: SummaryAttempt = await repository.attempt(
    row.summaryId,
    active.attemptRef,
    row.tenantId,
    database,
  );
  if (
    attempt.actorUserId !== row.actorUserId ||
    attempt.tenantId !== row.tenantId ||
    attempt.summaryId !== row.summaryId ||
    attempt.operationRef !== active.attemptRef ||
    attempt.triggerRequestId !== active.requestId ||
    attempt.delegatedPrincipalId !== row.principalId
  )
    throw summaryError('WIKI_ATTEMPT_BINDING_MISMATCH');
  return attempt;
}

export async function wikiRequestHasSavedRevision(
  database: PostgresJsDatabase,
  row: WikiRow,
  attempt: SummaryAttempt,
): Promise<boolean> {
  const saved: Array<{ ref: string }> = await database
    .select({ ref: derivedSummaryRevision.summaryRef })
    .from(derivedSummaryRevision)
    .where(
      and(
        eq(derivedSummaryRevision.tenantId, row.tenantId),
        eq(derivedSummaryRevision.actorUserId, row.actorUserId),
        eq(derivedSummaryRevision.summaryId, row.summaryId),
        eq(derivedSummaryRevision.requestId, attempt.triggerRequestId),
      ),
    )
    .limit(1);
  return saved.length > 0;
}

function expiredUnclaimed(attempt: SummaryAttempt, now: Date): boolean {
  return (
    attempt.status === 'QUEUED' &&
    attempt.deadlineAt !== null &&
    attempt.deadlineAt <= now &&
    attempt.claimCount === 0 &&
    attempt.retryCount === 0 &&
    attempt.leaseGeneration === 0 &&
    attempt.projectionApplied === false &&
    [
      attempt.startedAt,
      attempt.completedAt,
      attempt.lastHeartbeatAt,
      attempt.executorSessionKey,
      attempt.leaseOwner,
      attempt.leaseToken,
      attempt.leaseExpiresAt,
      attempt.leaseSlot,
      attempt.commitStartedAt,
      attempt.resultEnvelopeJson,
      attempt.resultContentHash,
      attempt.cancelRequestedAt,
    ].every((value: unknown) => value === null)
  );
}

export function wikiReservationNeedsReconciliation(attempt: SummaryAttempt, now: Date): boolean {
  return expiredUnclaimed(attempt, now) || terminal.has(attempt.status);
}

/** Called only inside the existing owner browser/runtime transaction. A RUNNING
 * provider is never terminalized here. Acquire every attempt lock before any
 * Wiki root lock, preserving the runtime attempt -> registry lock order. */
export async function reconcileWikiReservations(
  database: PostgresJsDatabase,
  repository: DerivedSummaryRepository,
  owner: SummaryActor,
  rows: WikiRow[],
  now: string,
): Promise<string[]> {
  if (owner.readScope === 'TENANT')
    throw summaryError('WIKI_OWNER_WRITE_SCOPE_REQUIRED');
  const time: Date = new Date(now);
  const closed: Array<{ row: WikiRow; attempt: SummaryAttempt }> = [];
  const errors: string[] = [];
  const owned: WikiRow[] = rows
    .filter(
      (row: WikiRow) =>
        row.tenantId === owner.tenantId &&
        row.actorUserId === owner.actorUserId &&
        row.state.active,
    )
    .sort((a: WikiRow, b: WikiRow) =>
      a.state.active!.attemptRef.localeCompare(b.state.active!.attemptRef),
    );
  for (const row of owned) {
    let attempt: SummaryAttempt | null;
    try {
      attempt = await readActiveWikiAttempt(database, repository, row);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE')
        throw error;
      errors.push(error.message);
      continue;
    }
    if (!attempt) continue;
    if (expiredUnclaimed(attempt, time)) {
      await database
        .select({ id: actionAttempt.attemptId })
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.attemptId, attempt.attemptId),
            eq(actionAttempt.tenantId, owner.tenantId),
            eq(actionAttempt.actorUserId, owner.actorUserId),
          ),
        )
        .for('update');
      // A concurrent CLAIM may have won before the row lock was acquired.
      try {
        attempt = await readActiveWikiAttempt(database, repository, row);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE')
          throw error;
        errors.push(error.message);
        continue;
      }
      if (!attempt || !expiredUnclaimed(attempt, time)) continue;
      if (await wikiRequestHasSavedRevision(database, row, attempt)) continue;
      const expired: boolean = await new ActionAttemptRepository(
        database,
      ).finishTerminal({
        attemptId: attempt.attemptId,
        fromStatus: 'QUEUED',
        status: 'TIMED_OUT',
        terminalReason:
          attempt.terminalReason ?? 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
        errorCode: attempt.errorCode ?? 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
        leaseGeneration: 0,
        now: time,
      });
      if (!expired) throw summaryError('WIKI_ATTEMPT_TIMEOUT_CAS_REJECTED');
      attempt = await readActiveWikiAttempt(database, repository, row);
    }
    // A persisted result owns its original save/finish recovery. Do not clear
    // that reservation or generate a replacement even if its attempt is terminal.
    if (
      attempt &&
      terminal.has(attempt.status) &&
      !(await wikiRequestHasSavedRevision(database, row, attempt))
    )
      closed.push({ row, attempt });
  }
  for (const item of closed) {
    const locked: WikiRow = await lockWikiBranch(database, item.row);
    if (
      locked.state.active?.attemptRef !== item.attempt.operationRef ||
      locked.state.active.requestId !== item.attempt.triggerRequestId
    )
      continue;
    await storeWikiDemand(
      database,
      locked,
      retryWikiDemand(
        locked.state,
        item.attempt.errorCode ??
          item.attempt.terminalReason ??
          'WIKI_ATTEMPT_FAILED',
        now,
      ),
    );
  }
  return [...new Set(errors)];
}
