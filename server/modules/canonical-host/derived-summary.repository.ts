import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';
import { alias } from 'drizzle-orm/pg-core';
import {
  derivedSummary, derivedSummaryAttemptBinding, derivedSummaryRevision,
} from '../../database/derived-summary.schema';
import { actionAttempt, assessmentWorkRevision, dmDocumentVersion, dmPublicationFamily, engineeringMatter,
  engineeringMatterWorkRevision, workItem } from '../../database/schema';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { DerivedSummaryContextBasis, DerivedSummaryMember, DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import { contextMemberNotices, contextWorkNotices } from './derived-summary-current-context';
import type { CanonicalVerifiedAutoWorkItemQueueScope } from './canonical-service-scope.authorization';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import type { CanonicalHostActor } from './canonical-host.types';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { summaryError } from './derived-summary.validation';
import { DerivedSummaryMembersService, mergeSummaryEvidence, type SummaryActor } from './derived-summary-members.service';

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

  /** All callers already authorized exact member bodies. Capture only Host-owned
   * mutable identities, never infer a publisher's latest/effective version. */
  async contextBasis(readings: DerivedSummaryMemberReading[], owner: SummaryActor,
    database: PostgresJsDatabase): Promise<DerivedSummaryContextBasis> {
    const allReadings = [...readings];
    const selected: DerivedSummaryMember[] = [...readings.flatMap(item => [item.member, ...item.leaves])];
    const summaries: DerivedSummaryContextBasis['summaries'] = [];
    const visited = new Set<string>();
    for (let index = 0; index < selected.length; index++) {
      const member = selected[index]!;
      if (member.kind !== 'DERIVED_SUMMARY' || visited.has(member.summaryRef)) continue;
      visited.add(member.summaryRef);
      const head = await this.head(member.summaryId, owner, database);
      summaries.push({ summaryId: head.summaryId, currentSummaryRef: head.currentSummaryRef, currentRevision: head.currentRevision });
      const saved = await this.saved(member.summaryId, member.summaryRef, owner, database);
      selected.push(...saved.members.map(item => item.member));
      if (saved.contextBasis) {
        const retained = await this.members.readAll(saved.contextBasis.memberNotices.map(item => item.member),
          owner, database, new Set([member.summaryId]));
        allReadings.push(...retained);
        selected.push(...retained.flatMap(item => [item.member, ...item.leaves]));
      }
    }
    const evidence = mergeSummaryEvidence(allReadings.flatMap(item => item.evidence));
    const documentIds = new Set(evidence.flatMap(item => item.kind === 'DOCUMENT_PASSAGE' ||
      item.kind === 'ENGINEER_ATTACHMENT' ? [item.documentVersionId] :
      item.kind === 'PRIOR_RESULT' && item.sourceStatement ? [item.sourceStatement.sourceBinding.original.documentVersionId] : []));
    const workIds = new Set(evidence.flatMap(item => 'workItemId' in item && item.workItemId ? [item.workItemId] : []));
    const matterRefs = new Map<string, Set<string>>();
    const addMatter = (id: string, ref: string) => matterRefs.set(id, new Set([...(matterRefs.get(id) ?? []), ref]));
    for (const member of selected) {
      if (member.kind === 'WORK_ITEM_WORK') { workIds.add(member.workItemId); documentIds.add(member.documentVersionId); }
      if (member.kind === 'MATTER_WORK') addMatter(member.matterId, member.workRef);
    }
    for (const item of evidence) if (item.kind === 'PRIOR_RESULT' && item.sourceWork)
      addMatter(item.sourceWork.subjectId, item.sourceWork.workRef);
    const sources: DerivedSummaryContextBasis['sources'] = [];
    for (const documentVersionId of [...documentIds].sort()) {
      const [row] = await database.select({ familyId: dmPublicationFamily.familyId,
        selectedHead: dmPublicationFamily.currentDocumentVersionId, currentGeneration: dmPublicationFamily.currentGeneration,
        status: dmPublicationFamily.status }).from(dmDocumentVersion)
        .innerJoin(dmPublicationFamily, eq(dmPublicationFamily.familyId, dmDocumentVersion.familyId))
        .where(eq(dmDocumentVersion.documentVersionId, documentVersionId)).limit(1);
      if (!row) throw summaryError('DERIVED_SUMMARY_SOURCE_VERSION_UNAVAILABLE', 404);
      // Match DocumentParsingRepository.current/publish: the highest PUBLISHED
      // revision, regardless of newer active/failed runs or the initiating actor.
      const [publishedParse] = await database.select({ parseRunId: dmDocumentParseRun.parseRunId,
        parseRevision: dmDocumentParseRun.parseRevision }).from(dmDocumentParseRun).where(and(
        eq(dmDocumentParseRun.tenantId, owner.tenantId), eq(dmDocumentParseRun.documentVersionId, documentVersionId),
        eq(dmDocumentParseRun.status, 'PUBLISHED'))).orderBy(desc(dmDocumentParseRun.parseRevision)).limit(1);
      const semanticRevisions = await database.execute<{
        parseRunId: string; parseRevision: number; semanticRevision: number;
      }>(sql`SELECT parse_run_id AS "parseRunId", parse_revision AS "parseRevision",
        max(semantic_revision)::integer AS "semanticRevision" FROM dm_document_semantic_revision
        WHERE tenant_id=${owner.tenantId} AND document_version_id=${documentVersionId}
        GROUP BY parse_run_id,parse_revision ORDER BY parse_run_id,parse_revision`);
      sources.push({ documentVersionId, ...row, publishedParse: publishedParse ?? null, semanticRevisions: [...semanticRevisions] });
    }
    const workItems: DerivedSummaryContextBasis['workItems'] = [];
    for (const workItemId of [...workIds].sort()) {
      const [row] = await database.select().from(workItem).where(and(eq(workItem.tenantId, owner.tenantId),
        eq(workItem.requestedByUserId, owner.actorUserId), eq(workItem.workItemId, workItemId))).limit(1);
      if (!row?.projectionJson) throw summaryError('DERIVED_SUMMARY_MEMBER_UNAVAILABLE', 404);
      const projection = JSON.parse(row.projectionJson) as CanonicalWorkItemProjection;
      const [latest] = await database.select({ ref: assessmentWorkRevision.assessmentWorkRevisionId,
        revision: assessmentWorkRevision.workRevision }).from(assessmentWorkRevision)
        .where(and(eq(assessmentWorkRevision.tenantId, owner.tenantId), eq(assessmentWorkRevision.workItemId, workItemId)))
        .orderBy(desc(assessmentWorkRevision.workRevision)).limit(1);
      const integrated = projection.integratedAssessment; const base = integrated?.baseRules; const overall = integrated?.overallSynthesis;
      workItems.push({ workItemId, documentVersionId: row.documentVersionId, revision: row.revision,
        currentWorkRef: latest?.ref ?? null, currentWorkRevision: latest?.revision ?? null,
        resultState: { integratedStatus: integrated?.status ?? null, baseResultRef: base?.sourceResultId ?? null,
          baseRevision: base?.revision ?? null, baseArtifactSha256: base?.artifact.sha256 ?? null,
          overallResultRef: overall?.sourceResultId ?? null, overallRevision: overall?.revision ?? null,
          overallArtifactSha256: overall?.artifact.sha256 ?? null, overallStatus: overall?.status ?? null,
          staleReason: overall?.staleReason ?? null, basedOnWorkRef: overall?.basedOnJobAidWorkRevisionRef ?? null,
          reviewRevision: integrated?.engineerReviews?.revision ?? null } });
    }
    const matters: DerivedSummaryContextBasis['matters'] = [];
    for (const matterId of [...matterRefs.keys()].sort()) {
      const [head] = await database.select({ currentMatterRevisionId: engineeringMatter.currentMatterRevisionId })
        .from(engineeringMatter).where(and(eq(engineeringMatter.tenantId, owner.tenantId),
          eq(engineeringMatter.createdByUserId, owner.actorUserId), eq(engineeringMatter.matterId, matterId))).limit(1);
      if (!head) throw summaryError('DERIVED_SUMMARY_MEMBER_UNAVAILABLE', 404);
      const [latest] = await database.select({ ref: engineeringMatterWorkRevision.matterWorkRevisionId,
        revision: engineeringMatterWorkRevision.workingRevision }).from(engineeringMatterWorkRevision)
        .where(and(eq(engineeringMatterWorkRevision.tenantId, owner.tenantId), eq(engineeringMatterWorkRevision.matterId, matterId)))
        .orderBy(desc(engineeringMatterWorkRevision.workingRevision)).limit(1);
      const selectedWork: DerivedSummaryContextBasis['matters'][number]['selectedWork'] = [];
      for (const workRef of [...matterRefs.get(matterId)!].sort()) {
        const saved = await this.transactions.readByRef({ tenantId: owner.tenantId, matterId, workRef }, database);
        if (!saved) throw summaryError('DERIVED_SUMMARY_MEMBER_UNAVAILABLE', 404);
        selectedWork.push({ workRef, basedOnMatterRevisionId: saved.basedOnMatterRevisionId,
          substantiveResultRef: saved.substantiveResultRef, substantiveResultRevision: saved.substantiveResultRevision,
          overviewStatus: saved.state.problemWork?.overviewStatus ?? 'NOT_AVAILABLE',
          ...contextWorkNotices(saved) });
      }
      matters.push({ matterId, ...head, currentWorkRef: latest?.ref ?? null, currentWorkRevision: latest?.revision ?? null, selectedWork });
    }
    return { schemaVersion: 'wiselink.derived-summary-context.v1', memberNotices: contextMemberNotices(allReadings), sources, workItems, matters,
      summaries: [...new Map(summaries.map(item => [item.summaryId, item])).values()].sort((a, b) =>
        a.summaryId < b.summaryId ? -1 : a.summaryId > b.summaryId ? 1 : 0),
      uncoordinatedDependencies: sources.length ? ['DOCUMENT_LIFECYCLE_NOT_FENCED'] : [] };
  }

  /** These row locks conflict with the existing actual head writers. Re-read
   * the whole vector after this method and retain the locks until summary CAS.
   * Matter-head locks fence new correction reservations; existing notice attempts
   * are then locked because their status/receipts can change without a head lock.
   * This does not claim atomicity for external source authority. */
  async lockContext(basis: DerivedSummaryContextBasis, owner: SummaryActor, database: PostgresJsDatabase,
    targetSummaryId?: string): Promise<void> {
    // Target and dependency heads participate in one global order. Locking the
    // target first deadlocks valid A→B-old and B→A-old reservations.
    const summaryIds = new Set([...basis.summaries.map(item => item.summaryId), ...(targetSummaryId ? [targetSummaryId] : [])]);
    for (const summaryId of [...summaryIds].sort())
      await database.select({ id: derivedSummary.summaryId }).from(derivedSummary).where(and(
        eq(derivedSummary.tenantId, owner.tenantId), eq(derivedSummary.actorUserId, owner.actorUserId),
        eq(derivedSummary.summaryId, summaryId))).for(summaryId === targetSummaryId ? 'update' : 'share');
    // Match document intake (family → matter), semantic append (document →
    // parse), and working commits (matter → work/attempt). Retain the existing
    // global summary-head order, then acquire source keys before owned heads.
    for (const familyId of [...new Set(basis.sources.map(item => item.familyId))].sort())
      await database.select({ id: dmPublicationFamily.familyId }).from(dmPublicationFamily)
        .where(eq(dmPublicationFamily.familyId, familyId)).for('share');
    // Parse publish and semantic append take UPDATE on this existing document
    // key before their authoritative writes. Keep family → document order;
    // re-read both observations after these locks and retain through SAVE CAS.
    for (const documentVersionId of [...new Set(basis.sources.map(item => item.documentVersionId))].sort())
      await database.select({ id: dmDocumentVersion.documentVersionId }).from(dmDocumentVersion)
        .where(eq(dmDocumentVersion.documentVersionId, documentVersionId)).for('share');
    for (const item of [...basis.matters].sort((a, b) => a.matterId < b.matterId ? -1 : 1))
      await database.select({ id: engineeringMatter.matterId }).from(engineeringMatter).where(and(
        eq(engineeringMatter.tenantId, owner.tenantId), eq(engineeringMatter.createdByUserId, owner.actorUserId),
        eq(engineeringMatter.matterId, item.matterId))).for('share');
    for (const item of [...basis.workItems].sort((a, b) => a.workItemId.localeCompare(b.workItemId)))
      await database.select({ id: workItem.workItemId }).from(workItem).where(and(
        eq(workItem.tenantId, owner.tenantId), eq(workItem.requestedByUserId, owner.actorUserId),
        eq(workItem.workItemId, item.workItemId))).for('share');
    const noticeRefs = new Set(basis.matters.flatMap(item => item.selectedWork.flatMap(work => [
      ...work.correctionNotices, ...work.overviewCorrectionNotices,
      ...work.referenceWorkNotices.flatMap(notice => [...notice.correctionNotices, ...(notice.overviewCorrectionNotices ?? [])]),
    ].map(notice => notice.attemptRef))));
    if (noticeRefs.size) await database.select({ id: actionAttempt.attemptId }).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, owner.tenantId), eq(actionAttempt.actorUserId, owner.actorUserId),
      inArray(actionAttempt.operationRef, [...noticeRefs]))).orderBy(asc(actionAttempt.attemptId)).for('share');
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
