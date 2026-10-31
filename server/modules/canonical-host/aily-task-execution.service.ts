import { ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { CanonicalAilyTaskDispatchReceipt, CanonicalWorkItemProjection } from '@shared/api.interface';
import { identitySession, identitySubjectMapping } from '../../database/schema';
import { openAilyUserGrant } from '../identity/aily-user-grant.codec';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import { canonicalJson, parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { AilyTaskAdmissionService, type AilyAssessmentAdmission } from './aily-task-admission';
import { AILY_TASK_ROLE_MAPPING, assertAilyRequestTaskBinding, type AilyExecutorRun } from './aily-executor-run';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import { createAilyChat, observeAilyChat, serializeAilyChatRequest, type AilyChatReceipt, type AilyChatRequest } from './aily-chat-client';
import { AILY_HOST_INVOCATION_IDENTITY, UNAVAILABLE_AILY_HOST_INVOCATION_IDENTITY, assertAilyInvocationBinding,
  type AilyHostInvocationIdentityPort } from './aily-host-invocation-identity.port';
import { AutomaticWorkItemDispatchService } from './automatic-work-item-dispatch.service';

export const AILY_TASK_CHAT_CLIENT = Symbol('AILY_TASK_CHAT_CLIENT');
export interface AilyTaskChatClient {
  configured: boolean;
  serialize(request: Pick<AilyChatRequest, 'message' | 'remoteSessionId'>): string;
  create(request: AilyChatRequest & {expectedRequestBody: string}): Promise<AilyChatReceipt>;
  read(request: {agentId: string; accessToken: string; chatId: string; remoteSessionId?: string}):
    Promise<{chatId: string; remoteStatus: string; remoteFinishReason?: string}>;
}

/** No target/profile transport is enabled by this local implementation batch. */
export const UNCONFIGURED_AILY_TASK_CLIENT: AilyTaskChatClient = {
  configured: false,
  serialize: () => { throw new Error('INITIAL_CONTINUATION_AILY_TRANSPORT_UNAVAILABLE'); },
  create: async () => { throw new Error('INITIAL_CONTINUATION_AILY_TRANSPORT_UNAVAILABLE'); },
  read: async () => { throw new Error('INITIAL_CONTINUATION_AILY_TRANSPORT_UNAVAILABLE'); },
};

/** The single verified chats protocol. A null admission still prevents dispatch. */
export const AILY_TASK_CHAT_ADAPTER: AilyTaskChatClient = {
  configured: true, serialize: serializeAilyChatRequest, create: createAilyChat, read: observeAilyChat,
};

interface ExecuteContext {
  workItem: CanonicalWorkItemProjection;
  actor: {userId: string; tenantId: string};
  permissionSnapshotVersion: string;
  requestId: string;
  row: ActionAttemptRow;
  reauthorize: () => Promise<void>;
}
type InvocationInput = {purpose?: 'BROWSER'; sessionId: string | null; identityRef?: never} |
  {purpose: 'BACKGROUND'; identityRef: string; callerAppId: string; sessionId?: never};
type ExecuteInput = ExecuteContext & InvocationInput;
type PreflightInput = Pick<ExecuteContext, 'workItem' | 'actor'> & InvocationInput;
interface InvocationCredentials {
  accessToken: string;
  application?: {identityRef: string; callerAppId: string};
}

@Injectable()
export class AilyTaskExecutionService {
  constructor(
    private readonly admission: AilyTaskAdmissionService,
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly attempts: ActionAttemptLifecycleService,
    private readonly repository: ActionAttemptRepository,
    private readonly actors: EngineeringMatterWorkingRepository,
    @Inject(AILY_TASK_CHAT_CLIENT) private readonly client: AilyTaskChatClient,
    @Inject(AILY_HOST_INVOCATION_IDENTITY) private readonly invocation: AilyHostInvocationIdentityPort = UNAVAILABLE_AILY_HOST_INVOCATION_IDENTITY,
    @Optional() private readonly dispatch?: AutomaticWorkItemDispatchService,
  ) {}

  async preflight(input: PreflightInput,
    modelRef: string, originalRequest = false): Promise<void> {
    if (originalRequest) this.admission.requireScope(input.actor.tenantId, input.workItem);
    else this.admission.require(input.actor.tenantId, input.workItem, modelRef);
    if (!this.client.configured) throw new ConflictException('INITIAL_CONTINUATION_AILY_TRANSPORT_UNAVAILABLE');
    await this.repository.assertAilyExecutorStorage();
    // Existing requests select transport from their persisted run in execute.
    // A current application preference cannot migrate an old browser grant.
    if (!originalRequest) await this.invocationToken(input);
  }

  async execute(input: ExecuteInput): Promise<CanonicalAilyTaskDispatchReceipt> {
    const task = parseTaskEnvelope(input.row.taskEnvelopeJson);
    assertAilyRequestTaskBinding(input.requestId, task);
    if (task.modelInput.executionMode !== 'AILY_AGENT_V1' || input.row.actorUserId !== input.actor.userId ||
        task.tenantId !== input.actor.tenantId || task.workItemId !== input.workItem.workItemId ||
        task.documentVersionId !== input.workItem.source.documentVersionId || input.row.taskInputHash !== task.inputHash ||
        !task.sourceRefs.some(source => source.ref === input.workItem.source.sourceArtifactId &&
          source.sha256 === canonicalHostBareSha256(input.workItem.source.sourceFileSha256)))
      throw new ConflictException('INITIAL_CONTINUATION_AILY_TASK_BINDING_CHANGED');
    const configuration = this.admission.requireScope(input.actor.tenantId, input.workItem);
    if (!this.client.configured) throw new ConflictException('INITIAL_CONTINUATION_AILY_TRANSPORT_UNAVAILABLE');
    const prior = await this.repository.readAilyExecutorRun(input.row);
    if (prior) {
      if (!prior.invocation && input.purpose === 'BACKGROUND')
        throw new ConflictException('AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED');
      if (prior.requestId !== input.requestId || prior.agentId !== configuration.agentId ||
          !this.sameInvocation(input, prior) || prior.scope.tenantId !== input.actor.tenantId ||
          prior.scope.workItemId !== input.workItem.workItemId || prior.scope.intakeRequestId !== input.workItem.requestId ||
          prior.scope.principalId !== configuration.principalId || prior.leaseGeneration !== input.row.leaseGeneration ||
          prior.modelEvidence.selectedModelRef !== task.executionModel?.modelRef)
        throw new ConflictException('INITIAL_CONTINUATION_AILY_RUN_BINDING_CHANGED');
      await input.reauthorize();
      if (!prior.invocation && input.purpose !== 'BACKGROUND')
        return this.observe(input, prior, await this.accessToken(input.actor, input.sessionId));
      const identity = await this.invocationToken(input, true);
      if (prior.invocation && prior.invocation.callerAppId !== identity.application?.callerAppId)
        throw new ConflictException('AILY_INVOCATION_CALLER_CHANGED');
      return this.observe(input, prior, identity.accessToken);
    }
    const selected = this.admission.require(input.actor.tenantId, input.workItem, task.executionModel?.modelRef);
    // No COMMITTING/expired/cancelled request is sent through a reclaim path.
    if (!['QUEUED', 'RUNNING'].includes(input.row.status) || input.row.cancelRequestedAt ||
        !input.row.deadlineAt || input.row.deadlineAt <= new Date())
      throw new ConflictException('INITIAL_CONTINUATION_AILY_NOT_CLAIMABLE');
    const admission: AilyAssessmentAdmission = {...selected, executionMode: 'AILY_AGENT_V1',
      modelRef: selected.model.modelRef, actorUserId: input.actor.userId};
    if (!this.dispatch) throw new ConflictException('AILY_OUTER_LEASE_UNAVAILABLE');
    // A queued intent can outlive the initiating request's transport identity.
    // Reject unavailable credentials before claiming; the final check below
    // still reauthorizes immediately before STARTED CAS and the unique POST.
    await this.invocationToken(input);
    const outer = await this.dispatch.claimAilyWorkItem({tenantId: input.actor.tenantId,
      actorUserId: input.actor.userId, workItem: input.workItem});
    const begin = await this.jobAid.beginAily({workItem: input.workItem, tenantId: input.actor.tenantId,
      actorUserId: input.actor.userId, permissionSnapshotVersion: input.permissionSnapshotVersion,
      requestId: input.requestId, admission, automaticWorkItemLease: outer});
    const current = await this.attempts.readScoped({attemptRef: begin.attemptRef,
      tenantId: input.actor.tenantId, workItemId: input.workItem.workItemId});
    if (current.leaseOwner !== selected.configuration.principalId || current.leaseToken !== begin.leaseToken ||
        current.leaseGeneration !== begin.leaseGeneration)
      throw new ConflictException('INITIAL_CONTINUATION_AILY_LEASE_CHANGED');
    // The full safe modelInput is the sole task source. The task/claim wrapper,
    // actor permissions and lease are never serialized into the model message.
    const message = canonicalJson({taskContextRef: begin.attemptRef,
      responsibility: '完成本轮工程候选分析；通过已授权Host工具核对和保存。平台完成不等于Host保存或正式采用。',
      roleMapping: AILY_TASK_ROLE_MAPPING, modelInput: begin.modelInput});
    const requestBody = this.client.serialize({message});
    const config = {...selected.configuration};
    let started: AilyExecutorRun = {schemaVersion: 'wiselink.aily-executor-run.v1', executor: 'AILY_AGENT_V1',
      requestId: input.requestId, agentId: config.agentId, publicationRef: config.publicationRef,
      configurationSource: config.configurationSource, hostSessionId: input.purpose === 'BACKGROUND' ? null : input.sessionId,
      ...(input.purpose === 'BACKGROUND' ? {invocation: {purpose: 'BACKGROUND' as const,
        identityRef: input.identityRef, callerAppId: input.callerAppId, configurationSource: config.configurationSource}} : {}),
      leaseGeneration: current.leaseGeneration,
      scope: {tenantId: input.actor.tenantId, workItemId: input.workItem.workItemId,
        intakeRequestId: input.workItem.requestId, principalId: config.principalId},
      modelEvidence: {selectedModelRef: admission.modelRef === 'aily/glm-5.3' ? 'aily/glm-5.3' : 'aily/deepseek-v4-pro', actualModelRef: null},
      post: {state: 'STARTED', startedAt: new Date().toISOString(), requestBody}};
    // Finish all asynchronous authorization work before the final original
    // lease/status/deadline CAS. Its success is followed directly by one POST.
    await input.reauthorize();
    const identity = await this.invocationToken(input);
    if (input.purpose !== 'BACKGROUND' && identity.application) started = {...started,
      invocation: {purpose: 'BROWSER', ...identity.application, configurationSource: config.configurationSource}};
    const owned = await this.repository.compareAndSetAilyExecutorRun({row: current, principalId: config.principalId, expected: null, next: started});
    if (!owned) {
      const winner = await this.repository.readAilyExecutorRun(current);
      if (!winner) throw new ConflictException('INITIAL_CONTINUATION_AILY_INTENT_UNCONFIRMED');
      if (winner.requestId !== started.requestId || winner.agentId !== started.agentId ||
          !this.sameInvocation(input, winner) || canonicalJson(winner.scope) !== canonicalJson(started.scope) ||
          winner.invocation?.callerAppId !== started.invocation?.callerAppId ||
          winner.post.requestBody !== requestBody)
        throw new ConflictException('INITIAL_CONTINUATION_AILY_RUN_BINDING_CHANGED');
      return this.receipt(begin.attemptRef, winner);
    }
    let next: AilyExecutorRun;
    try {
      const accepted = await this.client.create({agentId: started.agentId, accessToken: identity.accessToken, message, expectedRequestBody: requestBody});
      next = {...started, post: {...started.post, state: 'ACCEPTED', acceptedAt: new Date().toISOString(),
        chatId: accepted.chatId, remoteSessionId: accepted.remoteSessionId ?? null}};
    } catch (cause) {
      const code = cause instanceof Error && /^[A-Z][A-Z0-9_]{0,95}$/u.test(cause.message)
        ? cause.message : 'AILY_POST_RESULT_UNCONFIRMED';
      next = {...started, post: {state: 'UNKNOWN', startedAt: started.post.startedAt,
        requestBody, observedAt: new Date().toISOString(), errorCode: code}};
    }
    const saved = await this.repository.compareAndSetAilyExecutorRun({row: current, principalId: config.principalId, expected: started, next});
    if (!saved) return {attemptRef: begin.attemptRef, dispatchStatus: 'UNKNOWN', chatId: null, remoteSessionId: null,
      errorCode: 'AILY_POST_RECEIPT_UNCONFIRMED'};
    return this.receipt(begin.attemptRef, next);
  }

  private async observe(input: ExecuteInput, run: AilyExecutorRun, accessToken: string): Promise<CanonicalAilyTaskDispatchReceipt> {
    if (run.post.state !== 'ACCEPTED') return this.receipt(input.row.operationRef!, run);
    const snapshot = await this.client.read({agentId: run.agentId, accessToken, chatId: run.post.chatId,
      remoteSessionId: run.post.remoteSessionId ?? undefined});
    if (snapshot.chatId !== run.post.chatId) throw new Error('AILY_RESULT_CHAT_MISMATCH');
    // One explicit read only. No background polling, lease renewal or Host loop.
    return {...this.receipt(input.row.operationRef!, run), remoteStatus: snapshot.remoteStatus};
  }

  private receipt(attemptRef: string, run: AilyExecutorRun): CanonicalAilyTaskDispatchReceipt {
    return run.post.state === 'ACCEPTED'
      ? {attemptRef, dispatchStatus: 'ACCEPTED', chatId: run.post.chatId, remoteSessionId: run.post.remoteSessionId}
      : {attemptRef, dispatchStatus: 'UNKNOWN', chatId: null, remoteSessionId: null,
          errorCode: run.post.state === 'UNKNOWN' ? run.post.errorCode : 'AILY_POST_RESULT_UNCONFIRMED'};
  }

  private async accessToken(actor: ExecuteInput['actor'], sessionId: string | null): Promise<string> {
    if (sessionId === null) throw new ConflictException('INITIAL_CONTINUATION_AILY_USER_GRANT_REQUIRED');
    const grant = await this.actors.withActorTransaction(actor.userId, async ({database}) => {
      const rows = await database.select({sealed: identitySession.ailyAccessTokenSealed,
        tokenHash: identitySession.sessionTokenHash, mappingId: identitySession.subjectMappingId})
        .from(identitySession).innerJoin(identitySubjectMapping, eq(identitySession.subjectMappingId, identitySubjectMapping.id))
        .where(and(eq(identitySession.id, sessionId), eq(identitySubjectMapping.miaodaUserId, actor.userId),
          eq(identitySubjectMapping.miaodaTenantId, actor.tenantId), eq(identitySubjectMapping.status, 'ACTIVE'),
          eq(identitySubjectMapping.expectedClientId, process.env.FEISHU_OAUTH_CLIENT_ID ?? ''), isNull(identitySession.revokedAt),
          gt(identitySession.expiresAt, sql`clock_timestamp()`), gt(identitySession.ailyAccessTokenExpiresAt, sql`clock_timestamp()`))).limit(1);
      return rows[0];
    });
    if (!grant?.sealed) throw new ConflictException('INITIAL_CONTINUATION_AILY_USER_GRANT_REQUIRED');
    return openAilyUserGrant(grant.sealed, `${grant.tokenHash}:${grant.mappingId}`);
  }

  private sameInvocation(input: InvocationInput, run: AilyExecutorRun): boolean {
    return input.purpose === 'BACKGROUND'
      ? run.hostSessionId === null && run.invocation?.purpose === 'BACKGROUND' && run.invocation.callerAppId === input.callerAppId
      : run.invocation?.purpose !== 'BACKGROUND' && run.hostSessionId === input.sessionId;
  }

  private async invocationToken(input: PreflightInput, applicationRequired = false): Promise<InvocationCredentials> {
    const config = this.admission.requireScope(input.actor.tenantId, input.workItem);
    const request = {purpose: input.purpose ?? 'BROWSER', tenantId: input.actor.tenantId, actorUserId: input.actor.userId,
      workItemId: input.workItem.workItemId, principalId: config.principalId, agentId: config.agentId};
    const identity = await this.invocation.resolve(request);
    if (identity.status === 'READY') {
      if (input.purpose !== 'BACKGROUND' && input.sessionId === null &&
          (identity.transport !== 'APPLICATION' || !identity.callerAppId))
        throw new ConflictException('AILY_INVOCATION_IDENTITY_BINDING_CHANGED');
      if (input.purpose === 'BACKGROUND' && (identity.identityRef !== input.identityRef || identity.callerAppId !== input.callerAppId))
        throw new ConflictException('AILY_INVOCATION_IDENTITY_BINDING_CHANGED');
      if (identity.transport === 'APPLICATION' && !identity.callerAppId)
        throw new ConflictException('AILY_INVOCATION_IDENTITY_BINDING_CHANGED');
      return {accessToken: assertAilyInvocationBinding(identity, request), ...(identity.callerAppId ? {
        application: {identityRef: identity.identityRef, callerAppId: identity.callerAppId}} : {})};
    }
    // This existing short grant remains a browser-only path. Background tick
    // consumes the formal port and never falls back to a user's login cookie.
    if (applicationRequired || input.purpose === 'BACKGROUND' || input.sessionId === null ||
        identity.transport === 'APPLICATION') throw new ConflictException(identity.reason);
    return {accessToken: await this.accessToken(input.actor, input.sessionId)};
  }
}
