import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import type { DerivedSummaryProducer, DerivedSummaryRevision } from '@shared/derived-summary.interface';
import { derivedSummary, derivedSummaryRevision } from '../../database/derived-summary.schema';
import { actionAttempt } from '../../database/schema';
import { ActionAttemptRepository, isLeaseSlotConflict } from '../action-attempt/action-attempt.repository';
import { canonicalJson, canonicalSha256 } from '../action-attempt/action-attempt-envelope';
import { ACTION_ATTEMPT_LEASE_MS, ACTION_ATTEMPT_MAX_PARALLEL } from '../action-attempt/action-attempt.types';
import { assertJobAidWorkFence } from './jobaid-work.repository';
import { DerivedSummaryMembersService, type SummaryActor } from './derived-summary-members.service';
import { DerivedSummaryRepository, type SummaryAttempt, type SummaryRuntimeTarget } from './derived-summary.repository';
import { checkedSummaryTask, DerivedSummaryService, summaryRequestStatus } from './derived-summary.service';
import { HierarchicalWikiCompletion } from './hierarchical-wiki-completion';
import { publicSummaryRevision, summaryContextStatus } from './derived-summary-current-context';
import { parseSummaryContent, summaryCitations, summaryError, summaryText } from './derived-summary.validation';

interface Fence { leaseToken: string; leaseGeneration: number }
interface FencedTarget extends SummaryRuntimeTarget, Fence {}
interface ReadSelection extends FencedTarget { evidenceRefs: string[]; purpose: string }
interface SaveInput extends FencedTarget {
  requestId: string; expectedSummaryRevision: number; contentJson: string; provenanceJson?: string;
}

@Injectable()
export class DerivedSummaryRuntimeService {
  constructor(
    private readonly repository: DerivedSummaryRepository,
    private readonly members: DerivedSummaryMembersService,
    private readonly summaries: DerivedSummaryService,
    @Optional() private readonly wikiCompletion?: HierarchicalWikiCompletion,
  ) {}

  claim(target: SummaryRuntimeTarget) { return this.contextOperation(target, () => this.claimCurrent(target)); }
  heartbeat(target: FencedTarget) { return this.contextOperation(target, () => this.heartbeatCurrent(target)); }
  readMemberWork(target: ReadSelection) { return this.contextOperation(target, () => this.readMemberWorkCurrent(target)); }
  readSources(target: ReadSelection) { return this.contextOperation(target, () => this.readSourcesCurrent(target)); }
  save(target: SaveInput) { return this.contextOperation(target, () => this.saveCurrent(target)); }

  private async contextOperation<T>(target: SummaryRuntimeTarget, operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (!(error instanceof Error) || !['DERIVED_SUMMARY_CONTEXT_CHANGED', 'DERIVED_SUMMARY_CONTEXT_BASIS_REQUIRED'].includes(error.message)) throw error;
      // Throwing inside the original transaction would roll the status back.
      // Finish the obsolete request separately, retaining its task and read ledger.
      await this.repository.runtime(target, async (database, owner, _head, attempt) => {
        await lockAttempt(attempt, database);
        const row = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
        const task = checkedSummaryTask(row);
        if (await this.savedForRequest(target.summaryId, task.requestId, owner, database)) return;
        if (!['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(row.status)) return;
        if (!(await new ActionAttemptRepository(database).finishTerminal({ attemptId: row.attemptId,
          fromStatus: row.status, status: 'CONFLICT', terminalReason: error.message, errorCode: error.message,
          now: new Date(), leaseToken: row.leaseToken ?? undefined, leaseGeneration: row.leaseGeneration })))
          throw summaryError('DERIVED_SUMMARY_CONTEXT_CONFLICT_NOT_RECORDED');
      });
      throw error;
    }
  }

  private async claimCurrent(target: SummaryRuntimeTarget) {
    const outcome = await this.repository.runtime(target, async (database, owner, head, attempt) => {
      await this.lockGenerationContext(attempt, owner, database);
      head = await this.repository.head(target.summaryId, owner, database);
      await lockAttempt(attempt, database);
      let row = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      const task = checkedSummaryTask(row);
      const saved = await this.savedForRequest(target.summaryId, task.requestId, owner, database);
      const recoveringSaved = saved?.attemptId === row.attemptId;
      await this.checkMembers(row, owner, database, !recoveringSaved);
      if (recoveringSaved) await this.summaries.checkRevision(saved.contentJson, owner, database);
      const queue = new ActionAttemptRepository(database);
      const now = new Date();
      if (row.status === 'RUNNING' && row.leaseExpiresAt && row.leaseExpiresAt <= now) {
        await queue.recoverExpiredRunning({ attemptId: row.attemptId, now });
        row = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      }
      if (row.deadlineAt && row.deadlineAt <= now && ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED'].includes(row.status)) {
        await queue.finishTerminal({ attemptId: row.attemptId, fromStatus: row.status, status: 'TIMED_OUT',
          terminalReason: 'DERIVED_SUMMARY_DEADLINE_EXCEEDED', now, leaseToken: row.leaseToken ?? undefined,
          leaseGeneration: row.leaseGeneration });
        return { error: 'DERIVED_SUMMARY_TIMED_OUT' };
      }
      if (row.status === 'RUNNING' && row.leaseOwner === target.scope.principalId && row.leaseExpiresAt && row.leaseExpiresAt > now)
        return runningClaim(target.summaryId, row);
      if (!['QUEUED', 'RETRY_SCHEDULED'].includes(row.status)) return { error: `DERIVED_SUMMARY_${row.status}` };
      if (head.currentRevision !== task.expectedSummaryRevision && saved?.attemptId !== row.attemptId) {
        await queue.finishTerminal({ attemptId: row.attemptId, fromStatus: row.status, status: 'CONFLICT',
          terminalReason: 'DERIVED_SUMMARY_REVISION_CHANGED_BEFORE_CLAIM', now });
        return { error: 'DERIVED_SUMMARY_REVISION_CONFLICT' };
      }
      for (let leaseSlot = 0; leaseSlot < ACTION_ATTEMPT_MAX_PARALLEL; leaseSlot++) {
        try {
          // Savepoints retain the same physical connection while recovering a shared slot collision.
          const claimed = await database.transaction(tx => new ActionAttemptRepository(tx).claimExact({
            attemptId: row.attemptId, expectedStatus: row.status as 'QUEUED' | 'RETRY_SCHEDULED',
            expectedClaimCount: row.claimCount, expectedLeaseGeneration: row.leaseGeneration,
            operationRef: target.attemptRef, startedAt: row.startedAt, leaseOwner: target.scope.principalId,
            leaseSlot, now, leaseMs: ACTION_ATTEMPT_LEASE_MS, propagateSlotConflict: true }));
          if (claimed) return runningClaim(target.summaryId,
            await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database));
        } catch (error) { if (!isLeaseSlotConflict(error)) throw error; }
      }
      return { error: 'DERIVED_SUMMARY_CLAIM_UNAVAILABLE' };
    });
    if ('error' in outcome) throw summaryError(outcome.error);
    if (outcome.task.modelInput.revisionContext) {
      // Prior content is delivered for the first time at CLAIM, including sources
      // removed from the current selection. Original IO cannot hold the DB pool.
      const initial = await this.repository.runtime(target, async (database, owner, _head, attempt) => {
        await this.lockGenerationContext(attempt, owner, database);
        await lockAttempt(attempt, database);
        const row = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
        assertFence(row, { ...target, ...fence(outcome) });
        const task = checkedSummaryTask(row);
        const saved = await this.savedForRequest(target.summaryId, task.requestId, owner, database);
        await this.checkMembers(row, owner, database, saved?.attemptId !== row.attemptId);
        return { owner, evidence: await this.summaries.taskEvidence(task, owner, database), hash: task.taskInputHash };
      });
      await this.members.verifyOriginalEvidence(initial.evidence, initial.owner);
      await this.repository.runtime(target, async (database, owner, _head, attempt) => {
        await this.lockGenerationContext(attempt, owner, database);
        await lockAttempt(attempt, database);
        const row = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
        assertFence(row, { ...target, ...fence(outcome) });
        const task = checkedSummaryTask(row);
        const saved = await this.savedForRequest(target.summaryId, task.requestId, owner, database);
        await this.checkMembers(row, owner, database, saved?.attemptId !== row.attemptId);
        if (task.taskInputHash !== initial.hash || task.taskInputHash !== outcome.task.taskInputHash)
          throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
      });
    }
    return outcome;
  }

  status(target: SummaryRuntimeTarget) {
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      await this.checkMembers(attempt, owner, database, false);
      return summaryRequestStatus(target.summaryId, attempt, database);
    });
  }

  private heartbeatCurrent(target: FencedTarget) {
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      await this.lockGenerationContext(attempt, owner, database);
      await lockAttempt(attempt, database);
      const locked = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      const task = checkedSummaryTask(locked);
      const saved = await this.savedForRequest(target.summaryId, task.requestId, owner, database);
      if (saved && saved.attemptId !== locked.attemptId) throw summaryError('DERIVED_SUMMARY_SAVE_REQUEST_ID_REUSED');
      await this.checkMembers(locked, owner, database, !saved);
      if (saved) await this.summaries.checkRevision(saved.contentJson, owner, database);
      assertFence(locked, target);
      if (!(await new ActionAttemptRepository(database).heartbeat({ attemptId: locked.attemptId,
        ...fence(target), now: new Date(), leaseMs: ACTION_ATTEMPT_LEASE_MS }))) throw summaryError('DERIVED_SUMMARY_LEASE_REJECTED');
      const current = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      return { summaryId: target.summaryId, attemptRef: target.attemptRef, status: current.status,
        leaseExpiresAt: current.leaseExpiresAt!.toISOString() };
    });
  }

  cancel(target: SummaryRuntimeTarget & { reason: string }) {
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      const cancelResult = await new ActionAttemptRepository(database).requestCancel({ attemptId: attempt.attemptId,
        reason: summaryText(target.reason), now: new Date() });
      const current = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      return { summaryId: target.summaryId, attemptRef: target.attemptRef, status: current.status, cancelResult };
    });
  }

  fail(target: FencedTarget & { code: string; message: string }) {
    return this.repository.runtime(target, async (database, _owner, _head, attempt) => {
      assertFence(attempt, target);
      const code = summaryText(target.code, 160);
      const message = summaryText(target.message);
      if (!(await new ActionAttemptRepository(database).finishTerminal({ attemptId: attempt.attemptId,
        fromStatus: 'RUNNING', status: 'FAILED', terminalReason: code, ...fence(target), now: new Date(),
        errorCode: code, errorMessage: message }))) throw summaryError('DERIVED_SUMMARY_LEASE_REJECTED');
      return { summaryId: target.summaryId, attemptRef: target.attemptRef, status: 'FAILED', errorCode: code };
    });
  }

  private readMemberWorkCurrent(target: ReadSelection) {
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      await this.lockGenerationContext(attempt, owner, database);
      await lockAttempt(attempt, database);
      const current = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      assertFence(current, target);
      const readings = await this.checkMembers(current, owner, database);
      const refs = selection(target);
      const selected = refs.map(ref => {
        const member = readings.find(item => item.evidenceRef === ref);
        if (!member) throw summaryError('DERIVED_SUMMARY_MEMBER_NOT_REGISTERED', 404);
        return member;
      });
      await record(current, { kind: 'DERIVED_SUMMARY_MEMBERS_READ', evidenceRefs: refs,
        purpose: target.purpose, observedAt: new Date().toISOString() }, database);
      return { members: selected };
    });
  }

  private async readSourcesCurrent(target: ReadSelection) {
    const initial = await this.repository.runtime(target, async (database, owner, _head, attempt) => {
      assertFence(attempt, target);
      await this.checkMembers(attempt, owner, database);
      const task = checkedSummaryTask(attempt);
      const refs = selection(target);
      const evidence = refs.map(ref => {
        const item = task.modelInput.evidence.find(item => item.evidenceRef === ref);
        if (!item) throw summaryError('DERIVED_SUMMARY_SOURCE_NOT_REGISTERED', 404);
        return item;
      });
      return { owner, evidence, originals: await this.summaries.taskEvidence(task, owner, database), hash: attempt.taskInputHash };
    });
    await this.members.verifyOriginalEvidence(initial.originals, initial.owner);
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      await this.lockGenerationContext(attempt, owner, database);
      await lockAttempt(attempt, database);
      const current = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      assertFence(current, target);
      await this.checkMembers(current, owner, database);
      if (current.taskInputHash !== initial.hash) throw summaryError('DERIVED_SUMMARY_SOURCE_IDENTITY_CHANGED');
      await record(current, { kind: 'DERIVED_SUMMARY_SOURCES_READ', evidenceRefs: target.evidenceRefs,
        purpose: target.purpose, observedAt: new Date().toISOString() }, database);
      return { evidence: initial.evidence };
    });
  }

  private async saveCurrent(target: SaveInput) {
    const content = parseSummaryContent(JSON.parse(target.contentJson));
    const initial = await this.repository.runtime(target, async (database, owner, _head, attempt) => {
      const task = checkedSummaryTask(attempt);
      if (target.requestId !== task.requestId || target.expectedSummaryRevision !== task.expectedSummaryRevision)
        throw summaryError('DERIVED_SUMMARY_SAVE_BINDING_INVALID');
      const saved = await this.savedForRequest(target.summaryId, target.requestId, owner, database);
      await this.checkMembers(attempt, owner, database, saved?.attemptId !== attempt.attemptId);
      return { owner, task, evidence: await this.summaries.taskEvidence(task, owner, database) };
    });
    // Revalidate exact original artifacts without retaining a DB connection. The
    // final transaction repeats all authorization, content identity and lease checks.
    await this.members.verifyOriginalEvidence(initial.evidence, initial.owner);
    const producer = parseProducer(target.provenanceJson, initial.task.executionModel.modelRef);
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      await this.lockGenerationContext(attempt, owner, database);
      const head = await this.repository.head(target.summaryId, owner, database, true);
      await lockAttempt(attempt, database);
      const current = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      const prior = await this.savedForRequest(target.summaryId, target.requestId, owner, database);
      const readings = await this.checkMembers(current, owner, database, prior?.attemptId !== current.attemptId);
      const task = checkedSummaryTask(current);
      if (task.taskInputHash !== initial.task.taskInputHash) throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
      const savedContent = { ...content, limitations: [...new Set([...task.modelInput.limitations, ...content.limitations])] };
      if (prior) {
        if (prior.attemptId !== current.attemptId || canonicalJson(prior.contentJson.content) !== canonicalJson(savedContent) ||
          canonicalJson(prior.contentJson.producer ?? null) !== canonicalJson(producer ?? null))
          throw summaryError('DERIVED_SUMMARY_SAVE_REQUEST_ID_REUSED');
        return { ...saveReceipt(prior.contentJson, true),
          contextStatus: await this.summaries.revisionContextStatus(prior.contentJson, owner, database) };
      }
      assertFence(current, target);
      if (head.currentRevision !== target.expectedSummaryRevision) throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
      const allowed = new Set([...task.modelInput.members.map(item => item.evidenceRef),
        ...task.modelInput.evidence.map(item => item.evidenceRef)]);
      const usedEvidenceRefs = summaryCitations(content, allowed);
      const bodyRefs = summaryCitations({ ...content, limitations: [] }, allowed);
      const events = JSON.parse(current.reviewActivityJson ?? '[]') as Array<{ kind: string; evidenceRefs?: string[] }>;
      const delivered = new Set(events.filter(item => item.kind === 'DERIVED_SUMMARY_MEMBERS_READ').flatMap(item => item.evidenceRefs ?? []));
      if (readings.some(item => !delivered.has(item.evidenceRef))) throw summaryError('DERIVED_SUMMARY_MEMBER_READ_REQUIRED');
      const summaryRef = `DSR-${randomUUID()}`;
      const revision: DerivedSummaryRevision = {
        summaryId: target.summaryId, summaryRef, revision: head.currentRevision + 1,
        scope: task.modelInput.scope, classificationStatus: 'CANDIDATE', members: readings,
        content: savedContent,
        evidence: task.modelInput.evidence, usedEvidenceRefs,
        coverage: readings.map(member => ({ member: member.member, evidenceRef: member.evidenceRef,
          delivered: delivered.has(member.evidenceRef), used: bodyRefs.includes(member.evidenceRef),
          rootRefs: member.rootRefs, limitation: bodyRefs.includes(member.evidenceRef)
            ? member.limitations.join('\n') : '成员已交付，但正文未直接引用；不能宣称已对该成员完成综合。' })),
        requestId: target.requestId, attemptRef: target.attemptRef, createdAt: new Date().toISOString(),
        candidateOnly: true, contextBasis: task.contextBasis, ...(producer ? { producer } : {}),
      };
      await database.insert(derivedSummaryRevision).values({ summaryId: target.summaryId, summaryRef, ...owner,
        revision: revision.revision, requestId: target.requestId, attemptId: current.attemptId, contentJson: revision });
      const updated = await database.update(derivedSummary).set({ currentRevision: revision.revision,
        currentSummaryRef: summaryRef, scopeJson: revision.scope, membersJson: readings.map(item => item.member), updatedAt: new Date() })
        .where(and(eq(derivedSummary.summaryId, target.summaryId), eq(derivedSummary.tenantId, owner.tenantId),
          eq(derivedSummary.actorUserId, owner.actorUserId), eq(derivedSummary.currentRevision, target.expectedSummaryRevision)))
        .returning({ id: derivedSummary.summaryId });
      if (updated.length !== 1) throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
      await this.wikiCompletion?.saved(database, owner, revision);
      await record(current, { kind: 'DERIVED_SUMMARY_SAVED', requestId: target.requestId, summaryRef,
        revision: revision.revision, observedAt: revision.createdAt }, database);
      return { ...saveReceipt(revision, false), contextStatus: summaryContextStatus(task.contextBasis, task.contextBasis) };
    });
  }

  readSaved(target: SummaryRuntimeTarget & { requestId: string }) {
    return this.repository.runtime(target, async (database, owner, _head, attempt) => {
      await this.checkMembers(attempt, owner, database, false);
      const saved = await this.savedForRequest(target.summaryId, target.requestId, owner, database);
      if (!saved || saved.attemptId !== attempt.attemptId) throw summaryError('DERIVED_SUMMARY_SAVE_NOT_FOUND', 404);
      await this.summaries.checkRevision(saved.contentJson, owner, database);
      return { receipt: saveReceipt(saved.contentJson, true), summary: publicSummaryRevision(saved.contentJson),
        contextStatus: await this.summaries.revisionContextStatus(saved.contentJson, owner, database) };
    });
  }

  finish(target: FencedTarget & { requestId: string }) {
    return this.repository.runtime(target, async (database, owner, head, attempt) => {
      await lockAttempt(attempt, database);
      const row = await this.repository.attempt(target.summaryId, target.attemptRef, owner.tenantId, database);
      await this.checkMembers(row, owner, database, false);
      const saved = await this.savedForRequest(target.summaryId, target.requestId, owner, database);
      if (!saved || saved.attemptId !== row.attemptId || row.triggerRequestId !== target.requestId)
        throw summaryError('DERIVED_SUMMARY_FINISH_REQUIRES_SAVED_REVISION');
      await this.summaries.checkRevision(saved.contentJson, owner, database);
      if (row.status === 'SUCCEEDED') return finished(target, saved.summaryRef);
      assertFence(row, target);
      if (head.currentSummaryRef !== saved.summaryRef || head.currentRevision !== saved.revision)
        throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
      const queue = new ActionAttemptRepository(database);
      if (!(await queue.finishTerminal({ attemptId: row.attemptId, fromStatus: 'RUNNING', status: 'SUCCEEDED',
        terminalReason: 'DERIVED_SUMMARY_DURABLY_SAVED', ...fence(target), now: new Date(), projectionApplied: true })))
        throw summaryError('DERIVED_SUMMARY_LEASE_REJECTED');
      await database.update(actionAttempt).set({ resultEnvelopeJson: canonicalJson({ summaryRef: saved.summaryRef,
        revision: saved.revision, requestId: target.requestId }), resultContentHash: canonicalSha256(saved.contentJson) })
        .where(eq(actionAttempt.attemptId, row.attemptId));
      return finished(target, saved.summaryRef);
    });
  }

  private async lockGenerationContext(attempt: SummaryAttempt, owner: SummaryActor, database: PostgresJsDatabase) {
    const task = checkedSummaryTask(attempt);
    if (task.contextBasis) await this.repository.lockContext(task.contextBasis, owner, database, task.subject.summaryId);
  }

  private async checkMembers(attempt: SummaryAttempt, owner: SummaryActor, database: PostgresJsDatabase,
    requireCurrentContext = true) {
    return this.summaries.checkTaskAccess(checkedSummaryTask(attempt), owner, database,
      { requireCurrentContext: requireCurrentContext && attempt.status !== 'SUCCEEDED' });
  }

  private async savedForRequest(summaryId: string, requestId: string, owner: SummaryActor, database: PostgresJsDatabase) {
    const [saved] = await database.select().from(derivedSummaryRevision).where(and(
      eq(derivedSummaryRevision.summaryId, summaryId), eq(derivedSummaryRevision.tenantId, owner.tenantId),
      eq(derivedSummaryRevision.actorUserId, owner.actorUserId), eq(derivedSummaryRevision.requestId, requestId))).limit(1);
    return saved ?? null;
  }
}

function assertFence(row: SummaryAttempt, target: FencedTarget) {
  assertJobAidWorkFence(row, { ...fence(target), principalId: target.scope.principalId });
}
function fence(input: Fence): Fence { return { leaseToken: input.leaseToken, leaseGeneration: input.leaseGeneration }; }
async function lockAttempt(row: SummaryAttempt, database: PostgresJsDatabase) {
  await database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
    .where(eq(actionAttempt.attemptId, row.attemptId)).for('update');
}
async function record(row: SummaryAttempt, event: unknown, database: PostgresJsDatabase) {
  await database.update(actionAttempt).set({ reviewActivityJson:
    sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${canonicalJson([event])}::jsonb)::text` })
    .where(eq(actionAttempt.attemptId, row.attemptId));
}
function selection(target: ReadSelection): string[] {
  summaryText(target.purpose);
  if (!target.evidenceRefs.length || new Set(target.evidenceRefs).size !== target.evidenceRefs.length)
    throw summaryError('DERIVED_SUMMARY_SOURCE_SELECTION_INVALID', 400);
  return target.evidenceRefs;
}
function runningClaim(summaryId: string, row: SummaryAttempt) {
  return { summaryId, attemptRef: row.operationRef!, status: row.status, leaseToken: row.leaseToken!,
    leaseGeneration: row.leaseGeneration, leaseExpiresAt: row.leaseExpiresAt!.toISOString(), task: checkedSummaryTask(row) };
}
function saveReceipt(summary: DerivedSummaryRevision, replay: boolean) {
  return { summaryId: summary.summaryId, summaryRef: summary.summaryRef, revision: summary.revision, replay };
}
function finished(target: SummaryRuntimeTarget, savedSummaryRef: string) {
  return { summaryId: target.summaryId, attemptRef: target.attemptRef, status: 'SUCCEEDED' as const, savedSummaryRef };
}
function parseProducer(value: string | undefined, modelRef: string): DerivedSummaryProducer | undefined {
  if (!value) return undefined;
  const input = JSON.parse(value) as Record<string, unknown>;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['configuredModelRef', 'actualModel', 'promptVersion', 'skillVersion', 'toolVersions'].includes(key)) ||
    input.configuredModelRef !== modelRef || !(input.actualModel === null || typeof input.actualModel === 'string') ||
    !input.toolVersions || typeof input.toolVersions !== 'object' || Array.isArray(input.toolVersions))
    throw summaryError('DERIVED_SUMMARY_PRODUCER_INVALID', 400);
  const toolVersions: Record<string, string> = {};
  for (const [tool, version] of Object.entries(input.toolVersions)) toolVersions[summaryText(tool, 128)] = summaryText(version, 255);
  return { configuredModelRef: modelRef, actualModel: input.actualModel as string | null,
    promptVersion: summaryText(input.promptVersion, 255), skillVersion: summaryText(input.skillVersion, 255), toolVersions };
}
