import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { dmDocumentParseRun } from '@server/database/document-parsing.schema';
import type { DocumentParseScope } from './document-parsing.repository';

export interface DocumentStepFence {
  parseRunId: string;
  leaseOwner: string;
  leaseToken: string;
  leaseGeneration: number;
}

/** Execution control on the existing parseRun, without a second task status. */
@Injectable()
// Registered in DocumentManagementHostedModule.register dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentStepLeaseRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async claim(scope: DocumentParseScope, parseRunId: string, leaseOwner: string, leaseMs = 120_000): Promise<DocumentStepFence | null> {
    if (!/^[A-Za-z0-9:_-]{1,160}$/u.test(leaseOwner) || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) {
      throw new Error('DOCUMENT_STEP_LEASE_ARGUMENT_INVALID');
    }
    const now = new Date();
    const [row] = await this.db.update(dmDocumentParseRun).set({
      leaseOwner, leaseToken: randomUUID(), leaseGeneration: sql`${dmDocumentParseRun.leaseGeneration} + 1`,
      leaseExpiresAt: sql`LEAST(${dmDocumentParseRun.deadlineAt}, ${new Date(now.getTime() + leaseMs).toISOString()}::timestamptz)`,
    }).where(and(owned(scope, parseRunId), active(now),
      or(isNull(dmDocumentParseRun.leaseExpiresAt), lte(dmDocumentParseRun.leaseExpiresAt, now))))
      .returning();
    return row ? { parseRunId, leaseOwner, leaseToken: row.leaseToken!, leaseGeneration: row.leaseGeneration } : null;
  }

  /** Call inside the publish/progress transaction before any authoritative write.
   * The row lock prevents cancellation/reclaim racing that transaction's CAS.
   */
  async assertValid(database: PostgresJsDatabase, scope: DocumentParseScope, fence: DocumentStepFence): Promise<void> {
    const [row] = await database.select({ id: dmDocumentParseRun.id }).from(dmDocumentParseRun)
      .where(and(owned(scope, fence.parseRunId), fenced(fence), active(new Date()),
        gt(dmDocumentParseRun.leaseExpiresAt, new Date()))).for('update');
    if (!row) throw new Error('DOCUMENT_STEP_LEASE_REJECTED');
  }

  /** External calls use this before starting another bounded batch. Final writes
   * must still use assertValid in their transaction, not this earlier read.
   */
  async check(scope: DocumentParseScope, fence: DocumentStepFence): Promise<void> {
    await this.db.transaction(tx => this.assertValid(tx, scope, fence));
  }

  async renew(scope: DocumentParseScope, fence: DocumentStepFence, leaseMs = 120_000): Promise<boolean> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) throw new Error('DOCUMENT_STEP_LEASE_ARGUMENT_INVALID');
    const now = new Date();
    const rows = await this.db.update(dmDocumentParseRun).set({
      leaseExpiresAt: sql`LEAST(${dmDocumentParseRun.deadlineAt}, ${new Date(now.getTime() + leaseMs).toISOString()}::timestamptz)`,
    }).where(and(owned(scope, fence.parseRunId), fenced(fence), active(now), gt(dmDocumentParseRun.leaseExpiresAt, now)))
      .returning({ id: dmDocumentParseRun.id });
    return rows.length === 1;
  }

  async release(scope: DocumentParseScope, fence: DocumentStepFence): Promise<void> {
    // A step can publish/fail before its finally block; terminal rows are immutable.
    await this.db.update(dmDocumentParseRun).set({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null })
      .where(and(owned(scope, fence.parseRunId), fenced(fence),
        inArray(dmDocumentParseRun.status, ['RUNNING', 'STAGING'])));
  }

  /** Caller must use the normal document write authorization before cancellation. */
  async cancel(scope: DocumentParseScope, parseRunId: string): Promise<void> {
    await this.db.update(dmDocumentParseRun).set({ cancelRequestedAt: new Date(),
      status: 'FAILED', errorCode: 'DOCUMENT_PARSE_CANCELLED', completedAt: new Date() })
      .where(and(owned(scope, parseRunId), inArray(dmDocumentParseRun.status, ['RUNNING', 'STAGING'])));
  }
}

function owned(scope: DocumentParseScope, parseRunId: string) {
  return and(eq(dmDocumentParseRun.tenantId, scope.tenantId), eq(dmDocumentParseRun.actorUserId, scope.actorUserId),
    eq(dmDocumentParseRun.documentVersionId, scope.documentVersionId), eq(dmDocumentParseRun.parseRunId, parseRunId));
}
function active(now: Date) {
  return and(inArray(dmDocumentParseRun.status, ['RUNNING', 'STAGING']), isNull(dmDocumentParseRun.cancelRequestedAt), gt(dmDocumentParseRun.deadlineAt, now));
}
function fenced(fence: DocumentStepFence) {
  return and(eq(dmDocumentParseRun.leaseOwner, fence.leaseOwner), eq(dmDocumentParseRun.leaseToken, fence.leaseToken),
    eq(dmDocumentParseRun.leaseGeneration, fence.leaseGeneration));
}
