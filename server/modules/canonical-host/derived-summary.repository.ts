import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  derivedSummary, derivedSummaryAttemptBinding, derivedSummaryRevision,
} from '../../database/derived-summary.schema';
import { actionAttempt } from '../../database/schema';
import type { CanonicalVerifiedAutoWorkItemQueueScope } from './canonical-service-scope.authorization';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import type { CanonicalHostActor } from './canonical-host.types';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { summaryError } from './derived-summary.validation';
import { DerivedSummaryMembersService, type SummaryActor } from './derived-summary-members.service';

export type SummaryHead = typeof derivedSummary.$inferSelect;
export type SummaryAttempt = typeof actionAttempt.$inferSelect & typeof derivedSummaryAttemptBinding.$inferSelect;
export interface SummaryRuntimeTarget { summaryId: string; attemptRef: string; scope: CanonicalVerifiedAutoWorkItemQueueScope }
const summaryBinding = alias(derivedSummaryAttemptBinding, 'summary_binding');

@Injectable()
export class DerivedSummaryRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly transactions: EngineeringMatterWorkingRepository,
    private readonly members: DerivedSummaryMembersService,
  ) {}

  browser<T>(actor: CanonicalHostActor, operation: (database: PostgresJsDatabase, owner: SummaryActor) => Promise<T>) {
    const identity = actor.objectAccessActor;
    if (!identity || !isHostedCanonicalFinalUserActor(identity) || identity.tenantId !== actor.tenantId ||
      identity.canonicalSubject.id !== actor.userId || actor.appId !== 'app_17bzc551rsg')
      throw summaryError('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', 503);
    return this.transactions.withBrowserActorTransaction(actor.userId, async ({ database }) => {
      const owner = { tenantId: actor.tenantId, actorUserId: actor.userId };
      await this.members.authorizeActor(owner, database);
      return operation(database, owner);
    });
  }

  async runtime<T>(target: SummaryRuntimeTarget,
    operation: (database: PostgresJsDatabase, owner: SummaryActor, head: SummaryHead, attempt: SummaryAttempt) => Promise<T>) {
    if (target.scope.appId !== 'app_17bzc551rsg' || !target.scope.principalId || !target.scope.tenantId)
      throw summaryError('DERIVED_SUMMARY_SERVICE_SCOPE_UNAVAILABLE', 503);
    // The actor comes only from a browser-authorized durable request and its exact
    // delegated service principal. Never accept an actor/tenant from the tool payload.
    const [binding] = await this.db.execute<{ actorUserId: string | null }>(sql`SELECT
      derived_summary_runtime_actor(${target.scope.tenantId}, ${target.summaryId}, ${target.attemptRef},
        ${target.scope.principalId}) AS "actorUserId"`);
    if (!binding?.actorUserId) throw summaryError('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE', 404);
    return this.transactions.withActorTransaction(binding.actorUserId, async ({ database }) => {
      const owner = { tenantId: target.scope.tenantId, actorUserId: binding.actorUserId! };
      await this.members.authorizeActor(owner, database);
      const head = await this.head(target.summaryId, owner, database);
      const attempt = await this.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      if (attempt.actorUserId !== owner.actorUserId || attempt.delegatedPrincipalId !== target.scope.principalId)
        throw summaryError('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE', 404);
      return operation(database, owner, head, attempt);
    });
  }

  async head(summaryId: string, owner: SummaryActor, database: PostgresJsDatabase, lock = false): Promise<SummaryHead> {
    const query = database.select().from(derivedSummary).where(and(eq(derivedSummary.summaryId, summaryId),
      eq(derivedSummary.tenantId, owner.tenantId), eq(derivedSummary.actorUserId, owner.actorUserId))).limit(1);
    const [head] = await (lock ? query.for('update') : query);
    if (!head) throw summaryError('DERIVED_SUMMARY_UNAVAILABLE', 404);
    return head;
  }

  async attempt(summaryId: string, attemptRef: string, tenantId: string, database: PostgresJsDatabase): Promise<SummaryAttempt> {
    const [row] = await database.select().from(actionAttempt).innerJoin(summaryBinding,
      eq(actionAttempt.attemptId, summaryBinding.attemptId)).where(and(
      eq(actionAttempt.operationRef, attemptRef), eq(actionAttempt.tenantId, tenantId),
      eq(summaryBinding.summaryId, summaryId))).limit(1);
    if (!row || row.action_attempt.subjectKind !== 'DERIVED_SUMMARY' ||
      row.action_attempt.actionType !== 'OPENCLAW_DERIVED_SUMMARY' || row.action_attempt.workItemId !== null ||
      row.action_attempt.matterId !== null || row.action_attempt.documentVersionId !== null)
      throw summaryError('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE', 404);
    return { ...row.action_attempt, ...row.summary_binding };
  }

  async saved(summaryId: string, summaryRef: string, owner: SummaryActor, database: PostgresJsDatabase) {
    const [row] = await database.select().from(derivedSummaryRevision).where(and(
      eq(derivedSummaryRevision.summaryId, summaryId), eq(derivedSummaryRevision.summaryRef, summaryRef),
      eq(derivedSummaryRevision.tenantId, owner.tenantId), eq(derivedSummaryRevision.actorUserId, owner.actorUserId))).limit(1);
    if (!row) throw summaryError('DERIVED_SUMMARY_REVISION_UNAVAILABLE', 404);
    if (row.contentJson.summaryId !== summaryId || row.contentJson.summaryRef !== summaryRef || row.contentJson.revision !== row.revision)
      throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
    return row.contentJson;
  }
}
