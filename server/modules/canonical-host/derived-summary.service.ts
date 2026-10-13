import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  CreateDerivedSummaryRequest, DerivedSummaryMetadata, DerivedSummaryReadModel, DerivedSummaryRequestReceipt,
  DerivedSummaryRequestStatus, DerivedSummaryRevision, DerivedSummaryRevisionReadModel, DerivedSummaryTask, RequestDerivedSummaryUpdate,
  DerivedSummaryRevisionContext,
} from '@shared/derived-summary.interface';
import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { derivedSummary, derivedSummaryRevision } from '../../database/derived-summary.schema';
import { actionAttempt } from '../../database/schema';
import { canonicalJson, canonicalSha256 } from '../action-attempt/action-attempt-envelope';
import { ACTION_ATTEMPT_DEFAULT_DEADLINE_MS, ACTION_ATTEMPT_REQUEST_ORIGIN } from '../action-attempt/action-attempt.types';
import { taskModelSelection } from '../model-settings/canonical-model-catalog';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import type { CanonicalHostActor } from './canonical-host.types';
import { DerivedSummaryRepository, type SummaryAttempt, type SummaryHead } from './derived-summary.repository';
import { assertMemberSnapshot, DerivedSummaryMembersService, mergeSummaryEvidence, type SummaryActor } from './derived-summary-members.service';
import { assertSummaryContextBasis, assertSummaryContextUnchanged, publicSummaryRevision, summaryContextStatus } from './derived-summary-current-context';
import { assertSummaryReplay, parseSummaryRequest, summaryError } from './derived-summary.validation';
import { assertPreviousSummarySnapshot, buildSummaryRevisionContext } from './derived-summary-revision-context';
import { HierarchicalWikiCompletion } from './hierarchical-wiki-completion';

export interface DerivedSummaryRuntimeTask extends DerivedSummaryTask {
  actionAttemptId: string;
  operationRef: string;
  deadlineAt: string;
  executionModel: CanonicalExecutionModelSelection;
  taskInputHash: string;
}

@Injectable()
export class DerivedSummaryService {
  constructor(
    private readonly repository: DerivedSummaryRepository,
    private readonly members: DerivedSummaryMembersService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    @Optional() private readonly wiki?: HierarchicalWikiCompletion,
  ) {}

  create(input: CreateDerivedSummaryRequest, actor: CanonicalHostActor): Promise<DerivedSummaryRequestReceipt> {
    return this.repository.browser(actor, async (database, owner) => {
      const proposedId = `DS-${randomUUID()}`;
      const [created] = await database.insert(derivedSummary).values({ summaryId: proposedId, ...owner,
        createRequestId: input.requestId, scopeJson: input.scope, membersJson: input.members })
        .onConflictDoNothing({ target: [derivedSummary.tenantId, derivedSummary.actorUserId, derivedSummary.createRequestId] }).returning();
      const [existing] = created ? [created] : await database.select().from(derivedSummary).where(and(
        eq(derivedSummary.tenantId, owner.tenantId), eq(derivedSummary.actorUserId, owner.actorUserId),
        eq(derivedSummary.createRequestId, input.requestId))).limit(1);
      if (!existing) throw summaryError('DERIVED_SUMMARY_RESERVATION_FAILED');
      const head = await this.repository.head(existing.summaryId, owner, database);
      return this.reserve({ ...input, expectedSummaryRevision: 0 }, owner, head, database);
    });
  }

  request(summaryId: string, input: RequestDerivedSummaryUpdate, actor: CanonicalHostActor): Promise<DerivedSummaryRequestReceipt> {
    return this.repository.browser(actor, async (database, owner) => {
      const head = await this.repository.head(summaryId, owner, database);
      if ((await this.wiki?.metadata(summaryId, database))?.automaticWiki)
        throw summaryError('WIKI_MANAGED_UPDATE_REQUIRED');
      return this.reserve(input, owner, head, database);
    });
  }

  /** Internal caller already holds a real browser or durable service delegation. */
  async reserve(input: RequestDerivedSummaryUpdate, owner: SummaryActor, head: SummaryHead,
    database: PostgresJsDatabase): Promise<DerivedSummaryRequestReceipt> {
    const idempotencyKey = `derived-summary:${head.summaryId}:${input.requestId}`;
    const [prior] = await database.select({ attemptRef: actionAttempt.operationRef }).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, owner.tenantId), eq(actionAttempt.actorUserId, owner.actorUserId),
      eq(actionAttempt.idempotencyKey, idempotencyKey))).limit(1);
    if (prior?.attemptRef) {
      const saved = await this.repository.attempt(head.summaryId, prior.attemptRef, owner.tenantId, database);
      assertSummaryReplay(JSON.parse(saved.requestCommandJson!), input);
      await this.checkTaskAccess(checkedSummaryTask(saved), owner, database);
      return receipt(head.summaryId, saved, false);
    }
    if (head.currentRevision !== input.expectedSummaryRevision) throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
    const [active] = await database.select({ ref: actionAttempt.operationRef }).from(actionAttempt)
      .where(and(eq(actionAttempt.tenantId, owner.tenantId), sql`action_attempt.summary_id = ${head.summaryId}`,
        inArray(actionAttempt.status, ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING']))).limit(1);
    if (active) throw summaryError('DERIVED_SUMMARY_REQUEST_ACTIVE');
    const priorContext = input.purpose === 'REVISE_SAVED_SUMMARY'
      ? await this.revisionPrior(head, input.expectedSummaryRevision, owner, database) : null;
    let readings = await this.members.readAll(input.members, owner, database, new Set([head.summaryId]));
    if (input.members.some(member => member.kind === 'DERIVED_SUMMARY' && member.summaryId === head.summaryId))
      throw summaryError('DERIVED_SUMMARY_SELF_MEMBER', 400);
    const contextReadings = [...readings, ...(priorContext?.fresh ?? [])];
    const contextBasis = await this.repository.contextBasis(contextReadings, owner, database);
    await this.repository.lockContext(contextBasis, owner, database, head.summaryId);
    head = await this.repository.head(head.summaryId, owner, database);
    // Concurrent reservation can commit while the dependency locks are awaited.
    // Replay and active/CAS checks must therefore run again under the target lock.
    const [serializedPrior] = await database.select({ attemptRef: actionAttempt.operationRef }).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, owner.tenantId), eq(actionAttempt.actorUserId, owner.actorUserId),
      eq(actionAttempt.idempotencyKey, idempotencyKey))).limit(1);
    if (serializedPrior?.attemptRef) {
      const saved = await this.repository.attempt(head.summaryId, serializedPrior.attemptRef, owner.tenantId, database);
      assertSummaryReplay(JSON.parse(saved.requestCommandJson!), input);
      await this.checkTaskAccess(checkedSummaryTask(saved), owner, database);
      return receipt(head.summaryId, saved, false);
    }
    if (head.currentRevision !== input.expectedSummaryRevision) throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
    const [serializedActive] = await database.select({ ref: actionAttempt.operationRef }).from(actionAttempt)
      .where(and(eq(actionAttempt.tenantId, owner.tenantId), sql`action_attempt.summary_id = ${head.summaryId}`,
        inArray(actionAttempt.status, ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING']))).limit(1);
    if (serializedActive) throw summaryError('DERIVED_SUMMARY_REQUEST_ACTIVE');
    // A pre-lock read is never a coherent seal. Repeat exact ACL/body and all
    // mutable observations after the supported head locks have been acquired.
    const locked = await this.members.readAll(contextBasis.memberNotices.map(item => item.member), owner, database, new Set([head.summaryId]));
    for (const item of contextReadings) {
      const fresh = locked.find(value => canonicalJson(value.member) === canonicalJson(item.member));
      if (!fresh) throw summaryError('DERIVED_SUMMARY_CONTEXT_CHANGED');
      assertMemberSnapshot(item, fresh);
    }
    assertSummaryContextUnchanged(contextBasis, await this.repository.contextBasis(locked, owner, database));
    readings = readings.map(item => locked.find(value => canonicalJson(value.member) === canonicalJson(item.member))!);
    const lockedPrior = priorContext ? await this.revisionPrior(head, input.expectedSummaryRevision, owner, database) : null;
    if (priorContext && canonicalJson(priorContext.saved) !== canonicalJson(lockedPrior!.saved))
      throw summaryError('DERIVED_SUMMARY_PRIOR_CONTENT_CHANGED');
    assertSummaryContextUnchanged(contextBasis, await this.repository.contextBasis(
      [...readings, ...(lockedPrior?.fresh ?? [])], owner, database));
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    if (scope.appId !== 'app_17bzc551rsg' || scope.tenantId !== owner.tenantId || !scope.principalId)
      throw summaryError('DERIVED_SUMMARY_EXECUTOR_UNAVAILABLE', 503);
    const now = new Date();
    const attemptId = `ATT-${randomUUID()}`;
    const attemptRef = `AQ-${randomUUID().replaceAll('-', '')}`;
    const deadline = new Date(now.getTime() + ACTION_ATTEMPT_DEFAULT_DEADLINE_MS);
    const evidence = mergeSummaryEvidence(readings.flatMap(member => member.evidence));
    const limitations = ['仅覆盖显式选取的精确保存成员；未选成员、其他ATA和其他机型均未覆盖。',
      ...readings.flatMap(member => member.limitations)];
    const revisionContext = lockedPrior ? buildSummaryRevisionContext(input, lockedPrior.saved,
      lockedPrior.fresh, readings, now.toISOString()) : undefined;
    const taskBasis = { schemaVersion: 'wiselink.derived-summary-task.v1' as const,
      taskType: 'OPENCLAW_DERIVED_SUMMARY' as const, subject: { kind: 'DERIVED_SUMMARY' as const, summaryId: head.summaryId },
      expectedSummaryRevision: input.expectedSummaryRevision, requestId: input.requestId,
      actionAttemptId: attemptId, operationRef: attemptRef, deadlineAt: deadline.toISOString(),
      executionModel: taskModelSelection(input.modelRef, now), contextBasis,
      modelInput: { scope: input.scope, classificationStatus: 'CANDIDATE' as const,
        instruction: input.instruction, ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        ...(revisionContext ? { revisionContext } : {}), members: readings, evidence, limitations } };
    const task: DerivedSummaryRuntimeTask = { ...taskBasis, taskInputHash: canonicalSha256(taskBasis) };
    // All new subject columns are inserted together: the DB identity constraint is immediate.
    await database.execute(sql`INSERT INTO action_attempt (
      attempt_id, operation_ref, subject_kind, summary_id, action_type, attempt_no,
      trigger_request_id, request_origin, status, actor_user_id, tenant_id, input_revision, base_revision,
      task_envelope_json, task_input_hash, execution_model_json, idempotency_key, deadline_at,
      summary_request_command_json, summary_delegated_principal_id, created_at, updated_at
    ) VALUES (${attemptId}, ${attemptRef}, 'DERIVED_SUMMARY', ${head.summaryId}, 'OPENCLAW_DERIVED_SUMMARY',
      (SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM action_attempt WHERE tenant_id = ${owner.tenantId}
        AND summary_id = ${head.summaryId} AND subject_kind = 'DERIVED_SUMMARY'),
      ${input.requestId}, ${ACTION_ATTEMPT_REQUEST_ORIGIN}, 'QUEUED', ${owner.actorUserId}, ${owner.tenantId},
      ${input.expectedSummaryRevision}, ${input.expectedSummaryRevision}, ${canonicalJson(task)}, ${task.taskInputHash},
      ${canonicalJson(task.executionModel)}, ${idempotencyKey}, ${deadline.toISOString()}, ${canonicalJson(input)},
      ${scope.principalId}, ${now.toISOString()}, ${now.toISOString()})`);
    return receipt(head.summaryId, await this.repository.attempt(head.summaryId, attemptRef, owner.tenantId, database), true);
  }

  list(actor: CanonicalHostActor): Promise<DerivedSummaryMetadata[]> {
    return this.repository.readBrowser(actor, async (database, owner) => {
      const heads = await database.select().from(derivedSummary).where(and(eq(derivedSummary.tenantId, owner.tenantId),
        ...(owner.readScope === 'TENANT' ? [] : [eq(derivedSummary.actorUserId, owner.actorUserId)])))
        .orderBy(desc(derivedSummary.updatedAt));
      return Promise.all(heads.map(async head => ({ ...headMetadata(head), ...await this.wiki?.metadata(head.summaryId, database) })));
    });
  }

  read(summaryId: string, actor: CanonicalHostActor): Promise<DerivedSummaryReadModel> {
    return this.repository.readBrowser(actor, async (database, owner) =>
      this.readHead(await this.repository.head(summaryId, owner, database), owner, database));
  }

  readRevision(summaryId: string, summaryRef: string, actor: CanonicalHostActor): Promise<DerivedSummaryRevisionReadModel> {
    return this.repository.readBrowser(actor, async (database, owner) => {
      const head = await this.repository.head(summaryId, owner, database);
      const saved = await this.repository.saved(summaryId, summaryRef, owner, database);
      const selected = await this.checkRevision(saved, owner, database);
      return { summaryId, currentSummaryRef: head.currentSummaryRef, currentRevision: head.currentRevision,
        revision: publicSummaryRevision(saved), memberNotices: selected.map(memberNotice),
        contextStatus: await this.revisionContextStatus(saved, owner, database), ...await this.wiki?.metadata(summaryId, database) };
    });
  }

  status(summaryId: string, attemptRef: string, actor: CanonicalHostActor): Promise<DerivedSummaryRequestStatus> {
    return this.repository.readBrowser(actor, async (database, owner) => {
      const head = await this.repository.head(summaryId, owner, database);
      const attempt = await this.repository.attempt(summaryId, attemptRef, owner.tenantId, database);
      if (attempt.actorUserId !== head.actorUserId || attempt.summaryId !== head.summaryId)
        throw summaryError('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE', 404);
      await this.checkTaskAccess(checkedSummaryTask(attempt), owner, database);
      return summaryRequestStatus(summaryId, attempt, database);
    });
  }

  /** Current exact work is reauthorized; a generation fence is not a read permission cache. */
  async checkTaskAccess(task: DerivedSummaryRuntimeTask, owner: SummaryActor, database: PostgresJsDatabase,
    options: { requireCurrentContext?: boolean } = {}) {
    if (options.requireCurrentContext && task.contextBasis)
      await this.repository.lockContext(task.contextBasis, owner, database);
    const current = await this.members.readAll(task.modelInput.members.map(item => item.member), owner, database,
      new Set([task.subject.summaryId]));
    if (current.length !== task.modelInput.members.length) throw summaryError('DERIVED_SUMMARY_MEMBER_CONTENT_CHANGED');
    for (let i = 0; i < current.length; i++) assertMemberSnapshot(task.modelInput.members[i]!, current[i]!);
    const currentEvidence = mergeSummaryEvidence(current.flatMap(item => item.evidence));
    const ordered = (items: typeof currentEvidence) => [...items].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef));
    if (canonicalJson(ordered(task.modelInput.evidence)) !== canonicalJson(ordered(currentEvidence)))
      throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
    const previous = task.modelInput.revisionContext?.previousSummary;
    const prior = previous ? await this.repository.savedRevision(task.subject.summaryId,
      task.expectedSummaryRevision, owner, database) : null;
    const priorReadings = prior ? await this.checkRevision(prior, owner, database) : [];
    if (previous && prior) {
      assertPreviousSummarySnapshot(previous, prior, priorReadings);
      const expected = buildSummaryRevisionContext({ requestId: task.requestId, expectedSummaryRevision: task.expectedSummaryRevision,
        purpose: 'REVISE_SAVED_SUMMARY', scope: task.modelInput.scope, instruction: task.modelInput.instruction,
        modelRef: task.executionModel.modelRef, members: current.map(item => item.member) }, prior, priorReadings, current,
      previous.noticesObservedAt);
      // Historical observations may age, but selection/source/scope deltas and
      // the saved notice half must remain bound to authoritative saved material.
      if (canonicalJson(revisionMaterial(expected)) !== canonicalJson(revisionMaterial(task.modelInput.revisionContext!)))
        throw summaryError('DERIVED_SUMMARY_PRIOR_CONTENT_CHANGED');
    }
    if (options.requireCurrentContext) {
      if (!task.contextBasis) throw summaryError('DERIVED_SUMMARY_CONTEXT_BASIS_REQUIRED');
      assertSummaryContextUnchanged(task.contextBasis, await this.repository.contextBasis([...current, ...priorReadings], owner, database));
    }
    return current;
  }

  private async revisionPrior(head: SummaryHead, expected: number, owner: SummaryActor, database: PostgresJsDatabase) {
    if (expected < 1 || !head.currentSummaryRef) throw summaryError('DERIVED_SUMMARY_PRIOR_REQUIRED', 400);
    const saved = await this.repository.savedRevision(head.summaryId, expected, owner, database);
    if (saved.summaryRef !== head.currentSummaryRef || saved.revision !== head.currentRevision)
      throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
    return { saved, fresh: await this.checkRevision(saved, owner, database) };
  }

  /** Full authorization/IO carriers, distinct from the current eligible registry.
   * Native receipts sharing one body remain separate exact authorization inputs. */
  async taskEvidence(task: DerivedSummaryRuntimeTask, owner: SummaryActor, database: PostgresJsDatabase) {
    const current = await this.checkTaskAccess(task, owner, database);
    const previous = task.modelInput.revisionContext?.previousSummary;
    const prior = previous ? await this.repository.savedRevision(task.subject.summaryId,
      task.expectedSummaryRevision, owner, database) : null;
    const priorReadings = prior ? await this.checkRevision(prior, owner, database) : [];
    if (previous && prior) assertPreviousSummarySnapshot(previous, prior, priorReadings);
    const evidence = [...task.modelInput.evidence, ...current.flatMap(item => item.evidence),
      ...(prior?.evidence ?? []), ...priorReadings.flatMap(item => item.evidence)];
    mergeSummaryEvidence(evidence); // Validate body identity and per-receipt provenance before deduplication.
    return [...new Map(evidence.map(item => [canonicalJson(item), item])).values()];
  }

  async revisionContextStatus(saved: DerivedSummaryRevision, owner: SummaryActor, database: PostgresJsDatabase) {
    if (!saved.contextBasis) return summaryContextStatus(undefined);
    const fresh = await this.members.readAll(saved.contextBasis.memberNotices.map(item => item.member), owner, database, new Set([saved.summaryId]));
    return summaryContextStatus(saved.contextBasis, await this.repository.contextBasis(fresh, owner, database));
  }

  async checkRevision(saved: DerivedSummaryRevision, owner: SummaryActor, database: PostgresJsDatabase) {
    const current = await this.members.readAll(saved.members.map(item => item.member), owner, database, new Set([saved.summaryId]));
    if (current.length !== saved.members.length) throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
    for (let i = 0; i < current.length; i++) assertMemberSnapshot(saved.members[i]!, current[i]!);
    const evidence = mergeSummaryEvidence(current.flatMap(item => item.evidence));
    const orderedEvidence = (items: typeof evidence) => [...items].sort((a, b) => a.evidenceRef.localeCompare(b.evidenceRef));
    const refs = new Set([...current.map(item => item.evidenceRef), ...evidence.map(item => item.evidenceRef)]);
    if (canonicalJson(orderedEvidence(saved.evidence)) !== canonicalJson(orderedEvidence(evidence)) ||
      saved.usedEvidenceRefs.some(ref => !refs.has(ref))) throw summaryError('DERIVED_SUMMARY_PERSISTENCE_INVALID');
    return current;
  }

  private async readHead(head: SummaryHead, owner: SummaryActor, database: PostgresJsDatabase): Promise<DerivedSummaryReadModel> {
    const wiki = await this.wiki?.metadata(head.summaryId, database);
    if (wiki?.currentBodyStatus === 'UPDATING_SCOPE') return { ...headMetadata(head), ...wiki,
      current: null, memberNotices: [], contextStatus: summaryContextStatus(undefined) };
    const current = head.currentSummaryRef ? await this.repository.saved(head.summaryId, head.currentSummaryRef, owner, database) : null;
    const members = current ? await this.checkRevision(current, owner, database) : await this.members.readAll(head.membersJson, owner, database);
    return { summaryId: head.summaryId, scope: head.scopeJson, classificationStatus: 'CANDIDATE', ...wiki,
      currentSummaryRef: head.currentSummaryRef, currentRevision: head.currentRevision, current: current ? publicSummaryRevision(current) : null,
      memberNotices: members.map(memberNotice),
      contextStatus: current ? await this.revisionContextStatus(current, owner, database) : summaryContextStatus(undefined) };
  }
}

function revisionMaterial(context: DerivedSummaryRevisionContext) {
  const { memberNotices: _notices, noticesObservedAt: _time, ...previousSummary } = context.previousSummary;
  const { priorMemberNotices, ...sources } = context.inputChanges.sources;
  return { ...context, previousSummary, inputChanges: { ...context.inputChanges, sources: {
    ...sources, priorMemberNotices: priorMemberNotices.map(({ current: _current, ...saved }) => saved),
  } } };
}

function headMetadata(head: SummaryHead): DerivedSummaryMetadata {
  return { summaryId: head.summaryId, scope: head.scopeJson, classificationStatus: 'CANDIDATE',
    currentSummaryRef: head.currentSummaryRef, currentRevision: head.currentRevision };
}

function memberNotice(item: Awaited<ReturnType<DerivedSummaryMembersService['readAll']>>[number]) {
  return { member: item.member, current: item.current, limitations: item.limitations };
}

function receipt(summaryId: string, attempt: SummaryAttempt, created: boolean): DerivedSummaryRequestReceipt {
  return { summaryId, attemptRef: attempt.operationRef!, status: attempt.status, created };
}

export function checkedSummaryTask(attempt: SummaryAttempt): DerivedSummaryRuntimeTask {
  if (!attempt.taskEnvelopeJson || !attempt.requestCommandJson || !attempt.taskInputHash)
    throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
  let task: DerivedSummaryRuntimeTask;
  try { task = JSON.parse(attempt.taskEnvelopeJson) as DerivedSummaryRuntimeTask; }
  catch { throw summaryError('DERIVED_SUMMARY_TASK_INVALID'); }
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
  const { taskInputHash, ...basis } = task;
  if (task.schemaVersion !== 'wiselink.derived-summary-task.v1' || task.taskType !== 'OPENCLAW_DERIVED_SUMMARY' ||
    task.subject?.kind !== 'DERIVED_SUMMARY' || task.subject.summaryId !== attempt.summaryId ||
    task.actionAttemptId !== attempt.attemptId || task.operationRef !== attempt.operationRef ||
    task.requestId !== attempt.triggerRequestId || task.expectedSummaryRevision !== attempt.baseRevision ||
    task.expectedSummaryRevision !== attempt.inputRevision || task.deadlineAt !== attempt.deadlineAt?.toISOString() ||
    taskInputHash !== attempt.taskInputHash || canonicalSha256(basis) !== taskInputHash ||
    canonicalJson(task.executionModel) !== attempt.executionModelJson) throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
  let command: RequestDerivedSummaryUpdate;
  try { command = parseSummaryRequest(JSON.parse(attempt.requestCommandJson), true) as RequestDerivedSummaryUpdate; }
  catch { throw summaryError('DERIVED_SUMMARY_TASK_INVALID'); }
  const input = task.modelInput;
  const purpose = Object.hasOwn(input ?? {}, 'purpose') ? input.purpose : 'SYNTHESIZE';
  const previous = input?.revisionContext?.previousSummary;
  if (Object.hasOwn(task, 'purpose') || Object.hasOwn(task, 'revisionContext') || !input ||
    input.classificationStatus !== 'CANDIDATE' || !Array.isArray(input.members) ||
    (purpose !== 'SYNTHESIZE' && purpose !== 'REVISE_SAVED_SUMMARY') ||
    command.requestId !== task.requestId || command.expectedSummaryRevision !== task.expectedSummaryRevision ||
    command.modelRef !== task.executionModel.modelRef || command.instruction !== input.instruction ||
    canonicalJson(command.scope) !== canonicalJson(input.scope) ||
    canonicalJson(command.members) !== canonicalJson(input.members.map(item => item.member)) ||
    Object.hasOwn(command, 'purpose') !== Object.hasOwn(input, 'purpose') || purpose !== (command.purpose ?? 'SYNTHESIZE') ||
    (purpose === 'SYNTHESIZE' && input.revisionContext !== undefined) ||
    (purpose === 'REVISE_SAVED_SUMMARY' && (!previous || !task.contextBasis || task.expectedSummaryRevision < 1 ||
      previous.summaryId !== task.subject.summaryId || previous.revision !== task.expectedSummaryRevision ||
      typeof previous.summaryRef !== 'string' || !previous.summaryRef || previous.candidateOnly !== true ||
      input.revisionContext!.requestedChange?.instruction !== input.instruction ||
      input.revisionContext!.inputChanges?.materialStrategy !== 'FULL_CURRENT_MATERIAL')))
    throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
  if (task.contextBasis !== undefined) assertSummaryContextBasis(task.contextBasis);
  return task;
}

export async function summaryRequestStatus(summaryId: string, attempt: SummaryAttempt,
  database: PostgresJsDatabase): Promise<DerivedSummaryRequestStatus> {
  const saved = await database.select({ ref: derivedSummaryRevision.summaryRef }).from(derivedSummaryRevision).where(and(
    eq(derivedSummaryRevision.tenantId, attempt.tenantId), eq(derivedSummaryRevision.summaryId, summaryId),
    eq(derivedSummaryRevision.attemptId, attempt.attemptId)));
  return { summaryId, attemptRef: attempt.operationRef!, status: attempt.status,
    errorCode: attempt.errorCode ?? null, savedSummaryRefs: saved.map(item => item.ref) };
}
