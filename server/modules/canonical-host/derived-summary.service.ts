import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  CreateDerivedSummaryRequest, DerivedSummaryMetadata, DerivedSummaryReadModel, DerivedSummaryRequestReceipt,
  DerivedSummaryRequestStatus, DerivedSummaryRevision, DerivedSummaryRevisionReadModel, DerivedSummaryTask, RequestDerivedSummaryUpdate,
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
import { assertSummaryReplay, summaryError } from './derived-summary.validation';

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
      const head = await this.repository.head(existing.summaryId, owner, database, true);
      return this.reserve({ ...input, expectedSummaryRevision: 0 }, owner, head, database);
    });
  }

  request(summaryId: string, input: RequestDerivedSummaryUpdate, actor: CanonicalHostActor): Promise<DerivedSummaryRequestReceipt> {
    return this.repository.browser(actor, async (database, owner) => {
      const head = await this.repository.head(summaryId, owner, database, true);
      return this.reserve(input, owner, head, database);
    });
  }

  private async reserve(input: RequestDerivedSummaryUpdate, owner: SummaryActor, head: SummaryHead,
    database: PostgresJsDatabase): Promise<DerivedSummaryRequestReceipt> {
    const idempotencyKey = `derived-summary:${head.summaryId}:${input.requestId}`;
    const [prior] = await database.select({ attemptRef: actionAttempt.operationRef }).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, owner.tenantId), eq(actionAttempt.actorUserId, owner.actorUserId),
      eq(actionAttempt.idempotencyKey, idempotencyKey))).limit(1);
    if (prior?.attemptRef) {
      const saved = await this.repository.attempt(head.summaryId, prior.attemptRef, owner.tenantId, database);
      assertSummaryReplay(JSON.parse(saved.requestCommandJson!), input);
      await this.members.readAll(input.members, owner, database);
      return receipt(head.summaryId, saved, false);
    }
    if (head.currentRevision !== input.expectedSummaryRevision) throw summaryError('DERIVED_SUMMARY_REVISION_CONFLICT');
    const [active] = await database.select({ ref: actionAttempt.operationRef }).from(actionAttempt)
      .where(and(eq(actionAttempt.tenantId, owner.tenantId), sql`action_attempt.summary_id = ${head.summaryId}`,
        inArray(actionAttempt.status, ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING']))).limit(1);
    if (active) throw summaryError('DERIVED_SUMMARY_REQUEST_ACTIVE');
    const readings = await this.members.readAll(input.members, owner, database, new Set([head.summaryId]));
    if (input.members.some(member => member.kind === 'DERIVED_SUMMARY' && member.summaryId === head.summaryId))
      throw summaryError('DERIVED_SUMMARY_SELF_MEMBER', 400);
    const scope = await this.authorization.authorizeOpenClawAutoWorkItemQueue();
    if (scope.appId !== 'app_17bzc551rsg' || scope.tenantId !== owner.tenantId || !scope.principalId)
      throw summaryError('DERIVED_SUMMARY_EXECUTOR_UNAVAILABLE', 503);
    const now = new Date();
    const attemptId = `ATT-${randomUUID()}`;
    const attemptRef = `AQ-${randomUUID().replaceAll('-', '')}`;
    const deadline = new Date(now.getTime() + ACTION_ATTEMPT_DEFAULT_DEADLINE_MS);
    const evidence = mergeSummaryEvidence(readings.flatMap(member => member.evidence));
    const limitations = ['仅覆盖显式选取的精确保存成员；未选成员、其他ATA和其他机型均未覆盖。',
      '机型/ATA为用户选取的候选分类，成员归属和适用性未核。不是受控事实、批准或正式采用。',
      ...readings.flatMap(member => member.limitations)];
    const taskBasis = { schemaVersion: 'wiselink.derived-summary-task.v1' as const,
      taskType: 'OPENCLAW_DERIVED_SUMMARY' as const, subject: { kind: 'DERIVED_SUMMARY' as const, summaryId: head.summaryId },
      expectedSummaryRevision: input.expectedSummaryRevision, requestId: input.requestId,
      actionAttemptId: attemptId, operationRef: attemptRef, deadlineAt: deadline.toISOString(),
      executionModel: taskModelSelection(input.modelRef, now),
      modelInput: { scope: input.scope, classificationStatus: 'CANDIDATE' as const,
        instruction: input.instruction, members: readings, evidence, limitations } };
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
    return this.repository.browser(actor, async (database, owner) => {
      const heads = await database.select().from(derivedSummary).where(and(eq(derivedSummary.tenantId, owner.tenantId),
        eq(derivedSummary.actorUserId, owner.actorUserId))).orderBy(desc(derivedSummary.updatedAt));
      return heads.map(headMetadata);
    });
  }

  read(summaryId: string, actor: CanonicalHostActor): Promise<DerivedSummaryReadModel> {
    return this.repository.browser(actor, async (database, owner) =>
      this.readHead(await this.repository.head(summaryId, owner, database), owner, database));
  }

  readRevision(summaryId: string, summaryRef: string, actor: CanonicalHostActor): Promise<DerivedSummaryRevisionReadModel> {
    return this.repository.browser(actor, async (database, owner) => {
      const head = await this.repository.head(summaryId, owner, database);
      const saved = await this.repository.saved(summaryId, summaryRef, owner, database);
      const selected = await this.checkRevision(saved, owner, database);
      return { summaryId, currentSummaryRef: head.currentSummaryRef, currentRevision: head.currentRevision,
        revision: saved, memberNotices: selected.map(memberNotice) };
    });
  }

  status(summaryId: string, attemptRef: string, actor: CanonicalHostActor): Promise<DerivedSummaryRequestStatus> {
    return this.repository.browser(actor, async (database, owner) => {
      await this.repository.head(summaryId, owner, database);
      const attempt = await this.repository.attempt(summaryId, attemptRef, owner.tenantId, database);
      if (attempt.actorUserId !== owner.actorUserId) throw summaryError('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE', 404);
      await this.members.readAll(checkedSummaryTask(attempt).modelInput.members.map(item => item.member), owner, database);
      return summaryRequestStatus(summaryId, attempt, database);
    });
  }

  async checkRevision(saved: DerivedSummaryRevision, owner: SummaryActor, database: PostgresJsDatabase) {
    const current = await this.members.readAll(saved.members.map(item => item.member), owner, database);
    for (let i = 0; i < current.length; i++) assertMemberSnapshot(saved.members[i]!, current[i]!);
    return current;
  }

  private async readHead(head: SummaryHead, owner: SummaryActor, database: PostgresJsDatabase): Promise<DerivedSummaryReadModel> {
    const current = head.currentSummaryRef ? await this.repository.saved(head.summaryId, head.currentSummaryRef, owner, database) : null;
    const members = current ? await this.checkRevision(current, owner, database) : await this.members.readAll(head.membersJson, owner, database);
    return { summaryId: head.summaryId, scope: head.scopeJson, classificationStatus: 'CANDIDATE',
      currentSummaryRef: head.currentSummaryRef, currentRevision: head.currentRevision, current,
      memberNotices: members.map(memberNotice) };
  }
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
  const task = JSON.parse(attempt.taskEnvelopeJson) as DerivedSummaryRuntimeTask;
  const { taskInputHash, ...basis } = task;
  if (task.schemaVersion !== 'wiselink.derived-summary-task.v1' || task.taskType !== 'OPENCLAW_DERIVED_SUMMARY' ||
    task.subject?.kind !== 'DERIVED_SUMMARY' || task.subject.summaryId !== attempt.summaryId ||
    task.actionAttemptId !== attempt.attemptId || task.operationRef !== attempt.operationRef ||
    task.requestId !== attempt.triggerRequestId || task.expectedSummaryRevision !== attempt.baseRevision ||
    task.expectedSummaryRevision !== attempt.inputRevision || task.deadlineAt !== attempt.deadlineAt?.toISOString() ||
    taskInputHash !== attempt.taskInputHash || canonicalSha256(basis) !== taskInputHash ||
    canonicalJson(task.executionModel) !== attempt.executionModelJson) throw summaryError('DERIVED_SUMMARY_TASK_INVALID');
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
