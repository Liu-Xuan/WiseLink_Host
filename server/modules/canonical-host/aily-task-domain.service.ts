import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { workItem, identitySubjectMapping, actionAttempt } from '../../database/schema';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { parseTaskEnvelope, canonicalJson } from '../action-attempt/action-attempt-envelope';
import { automaticWorkItemTaskLease } from '../action-attempt/automatic-work-item-attempt-lease';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { AilyMcpIdentityService, type AilyMcpVerifiedActor } from './aily-mcp-identity.service';
import { AilyTaskAdmissionService } from './aily-task-admission';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { JobAidWorkRepository, assertJobAidWorkFence } from './jobaid-work.repository';
import { parseJobAidProblemTask } from './jobaid-problem-task';
import { exactProgramWorkRead } from './program-controlled-assessment';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';
import { AilyTrustedTaskContext, ailySourceCommand, ailyValidateCommand, ailySaveCommand, ailyReadCommand,
  ailyStageCommand, ailyFinishCommand, type AilyTaskDomainSnapshot } from './aily-task-domain.types';
import { sameAilyPendingOperation, type AilyExecutorRun } from './aily-executor-run';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import { AutomaticWorkItemDispatchService } from './automatic-work-item-dispatch.service';

type Operation = 'READ' | 'WRITE' | 'FINALIZE';

/** Trusted adapter for the existing domain consumers, not a second work store. */
@Injectable()
export class AilyTaskDomainService {
  constructor(private readonly identity: AilyMcpIdentityService, private readonly actors: EngineeringMatterWorkingRepository,
    private readonly repository: ActionAttemptRepository, private readonly work: JobAidWorkRepository,
    private readonly jobAid: CanonicalJobAidProblemService, private readonly admission: AilyTaskAdmissionService,
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR) private readonly registrar: CanonicalWorkItemRegistrarPort,
    private readonly dispatch: AutomaticWorkItemDispatchService) {}

  private run<T>(actor: AilyMcpVerifiedActor, operation: () => Promise<T>): Promise<T> {
    this.identity.assertVerified(actor);
    // This method verifies the pre-existing Hosted service role before binding
    // the mapped actor. It cannot elevate a browser SQL connection.
    return this.actors.withActorScope(actor.actorUserId, async () => {
      const result=await operation();
      this.identity.assertVerified(actor);
      await this.actors.withActorTransaction(actor.actorUserId,async({database})=>{
        const [proof]=await database.execute<{allowed:boolean}>(sql`SELECT (${this.actorPredicate(actor)}) AS allowed`);
        if(proof?.allowed!==true)throw new Error('AILY_DOMAIN_AUTHORIZATION_CHANGED');
      });
      return result;
    });
  }

  private actorPredicate(actor:AilyMcpVerifiedActor):SQL {
    return sql`${new Date(actor.expiresAt)}>clock_timestamp() AND EXISTS (SELECT 1 FROM ${identitySubjectMapping}
      WHERE ${identitySubjectMapping.id}=${actor.mappingId} AND ${identitySubjectMapping.revision}=${actor.mappingRevision}
        AND ${identitySubjectMapping.status}='ACTIVE' AND ${identitySubjectMapping.miaodaUserId}=${actor.actorUserId}
        AND ${identitySubjectMapping.miaodaTenantId}=${actor.tenantId} AND ${identitySubjectMapping.expectedClientId}=${actor.expectedClientId}
        AND ${identitySubjectMapping.feishuOpenId}=${actor.feishuOpenId} AND ${identitySubjectMapping.feishuTenantKey}=${actor.feishuTenantKey})`;
  }

  async sources(actor: AilyMcpVerifiedActor, raw: unknown) {
    const input = ailySourceCommand.parse(raw);
    return this.run(actor, async () => {
      const context = await this.context(actor, input.taskContextRef, 'WRITE');
      const {row} = context.snapshot;
      return this.jobAid.readSources({attemptRef: input.taskContextRef, workItemId: row.workItemId,
        leaseToken: row.leaseToken!, leaseGeneration: row.leaseGeneration, sourceRefs: input.sourceRefs,
        purpose: input.purpose, context: input.context}, context);
    });
  }

  async validate(actor: AilyMcpVerifiedActor, raw: unknown) {
    const input = ailyValidateCommand.parse(raw);
    return this.run(actor, async () => {
      const context = await this.context(actor, input.taskContextRef, 'WRITE');
      const {row, run, baseline} = context.snapshot;
      if (run.pending && run.pending.phase !== 'READ') {
        if (run.pending.workJson !== input.workJson) throw new Error('AILY_PENDING_SAVE_UNRESOLVED');
        return {status: 'VALID', candidateRef: run.pending.candidateRef, recoveryRequired: run.pending.phase !== 'VALIDATED'};
      }
      if (baseline?.actionAttemptId === row.attemptId) exactProgramWorkRead(row, baseline);
      const validation = await this.jobAid.validateWork({attemptRef: input.taskContextRef, workItemId: row.workItemId,
        leaseToken: row.leaseToken!, leaseGeneration: row.leaseGeneration,
        expectedWorkRevision: baseline?.workRevision ?? 0, workJson: input.workJson}, context);
      if (validation.status !== 'VALID') return validation;
      const pending: NonNullable<AilyExecutorRun['pending']> = {candidateRef: randomUUID(), saveRequestId: `SAVE-${randomUUID()}`,
        phase: 'VALIDATED', validatedAt: new Date().toISOString(), workJson: input.workJson,
        expectedWorkRevision: baseline?.workRevision ?? 0, previousWorkRevisionRef: baseline?.workRevisionRef ?? null};
      await this.pending(context, {...run, pending});
      return {...validation, candidateRef: pending.candidateRef};
    });
  }

  async save(actor: AilyMcpVerifiedActor, raw: unknown) {
    const input = ailySaveCommand.parse(raw);
    return this.run(actor, async () => {
      let context = await this.context(actor, input.taskContextRef, 'WRITE');
      let {run, row} = context.snapshot;
      let pending = run.pending;
      if (!pending || pending.candidateRef !== input.candidateRef) throw new Error('AILY_CANDIDATE_REFERENCE_INVALID');
      const originalPending=pending;
      const command = {expectedWorkRevision: pending.expectedWorkRevision, work: JSON.parse(pending.workJson) as unknown};
      // Even the first delivery checks the exact original key with proven RLS
      // coverage. A network failure never means the original write was absent.
      const saved = await this.work.readAilySave({row, actorUserId: actor.actorUserId, requestId: pending.saveRequestId,
        command, readPredicate: context.snapshot.writePredicate});
      if (saved) {
        if (pending.phase !== 'READ') await this.pending(context, {...run, pending: {...pending, phase: 'SAVED',
          workRevisionRef: saved.workRevisionRef, workRevision: saved.workRevision}});
        return {status: 'SAVED', replayed: true, saveRequestId: saved.requestId,
          workRevisionRef: saved.workRevisionRef, workRevision: saved.workRevision};
      }
      if (pending.phase === 'SAVED' || pending.phase === 'READ') throw new Error('AILY_SAVE_READBACK_UNCONFIRMED');
      if (pending.phase === 'VALIDATED') {
        await this.pending(context, {...run, pending: {...pending, phase: 'SAVE_STARTED'}});
        context = await this.context(actor, input.taskContextRef, 'WRITE');
        ({run, row} = context.snapshot);
        if(!sameAilyPendingOperation(originalPending,run.pending))throw new Error('AILY_PENDING_SAVE_CHANGED');
        pending = run.pending!;
        if(pending.phase==='SAVED'||pending.phase==='READ') {
          const original=await this.work.readAilySave({row,actorUserId:actor.actorUserId,requestId:originalPending.saveRequestId,
            command,readPredicate:context.snapshot.writePredicate});
          if(!original)throw new Error('AILY_SAVE_READBACK_UNCONFIRMED');
          return {status:'SAVED',replayed:true,saveRequestId:original.requestId,
            workRevisionRef:original.workRevisionRef,workRevision:original.workRevision};
        }
      }
      const receipt = await this.jobAid.saveWork({attemptRef: input.taskContextRef, workItemId: row.workItemId,
        leaseToken: row.leaseToken!, leaseGeneration: row.leaseGeneration, requestId: pending.saveRequestId,
        expectedWorkRevision: pending.expectedWorkRevision, workJson: pending.workJson}, context);
      await this.pending(context, {...run, pending: {...pending, phase: 'SAVED',
        workRevisionRef: receipt.workRevisionRef, workRevision: receipt.workRevision}});
      return {...receipt, status: 'SAVED', saveRequestId: pending.saveRequestId};
    });
  }

  async read(actor: AilyMcpVerifiedActor, raw: unknown) {
    const input = ailyReadCommand.parse(raw);
    return this.run(actor, async () => {
      const context = await this.context(actor, input.taskContextRef, 'READ');
      const {row, run} = context.snapshot;
      const key = input.saveRequestId ?? (!input.workRevisionRef ? run.pending?.saveRequestId : undefined);
      if (!key && !input.workRevisionRef) throw new Error('AILY_EXACT_SAVED_REFERENCE_REQUIRED');
      const result = await this.jobAid.readAttemptWork(input.taskContextRef, key, row.workItemId,
        row.leaseToken && context.snapshot.scope.automaticWorkItemLease
          ? {leaseToken: row.leaseToken, leaseGeneration: row.leaseGeneration} : undefined,
        input.workRevisionRef, context);
      const revision = result.revision;
      if (!revision) throw new Error('AILY_SAVE_READBACK_UNCONFIRMED');
      const fresh = await this.context(actor, input.taskContextRef, 'READ');
      if (fresh.snapshot.row.status === 'RUNNING' && fresh.snapshot.scope.automaticWorkItemLease && run.pending?.saveRequestId === revision.requestId &&
          sameAilyPendingOperation(run.pending,fresh.snapshot.run.pending)) {
        const proof = exactProgramWorkRead(fresh.snapshot.row, revision);
        const writer = await this.context(actor, input.taskContextRef, 'WRITE');
        if(sameAilyPendingOperation(run.pending,writer.snapshot.run.pending)) {
          const changed=await this.pending(writer, {...writer.snapshot.run, pending: {...writer.snapshot.run.pending!, phase: 'READ',
            workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision, readObservedAt: proof.readObservedAt}},true);
          if(!changed) {
            const current=await this.context(actor,input.taskContextRef,'READ');
            if(sameAilyPendingOperation(run.pending,current.snapshot.run.pending))throw new Error('AILY_PENDING_SAVE_UNCONFIRMED');
          }
        }
      }
      return result;
    });
  }

  async stageOverall(actor: AilyMcpVerifiedActor, raw: unknown) {
    const input = ailyStageCommand.parse(raw);
    return this.run(actor, async () => this.jobAid.projectAilyStage(await this.context(actor, input.taskContextRef, 'WRITE'), input.workRevisionRef));
  }

  async finish(actor: AilyMcpVerifiedActor, raw: unknown) {
    const input = ailyFinishCommand.parse(raw);
    return this.run(actor, async () => {
      const context = await this.context(actor, input.taskContextRef, 'FINALIZE');
      const result = await this.jobAid.finishAily(context, input.workRevisionRef);
      // Evaluation final is distinct from the outer complete-analysis ACK.
      const acknowledgement = await this.dispatch.acknowledgeAilyWorkItem(context);
      return {result, acknowledgement};
    });
  }

  private async pending(context: AilyTrustedTaskContext, next: AilyExecutorRun, allowReadSlotChange=false): Promise<boolean> {
    const snapshot = await context.revalidate();
    const changed=await this.repository.compareAndSetAilyDomainRun({row: snapshot.row, principalId: snapshot.scope.principalId,
      expected: context.snapshot.run, next, writePredicate: snapshot.writePredicate});
    if(!changed&&!allowReadSlotChange)throw new Error('AILY_PENDING_SAVE_UNCONFIRMED');
    return changed;
  }

  private async context(actor: AilyMcpVerifiedActor, ref: string, operation: Operation): Promise<AilyTrustedTaskContext> {
    const snapshot = await this.authorize(actor, ref, operation);
    return AilyTrustedTaskContext.authorized(snapshot, () => this.authorize(actor, ref, operation));
  }

  private async authorize(actor: AilyMcpVerifiedActor, ref: string, operation: Operation): Promise<AilyTaskDomainSnapshot> {
    this.identity.assertVerified(actor);
    const row = await this.repository.readByOperationRef(ref);
    if (!row || row.actorUserId !== actor.actorUserId || row.tenantId !== actor.tenantId || !row.workItemId)
      throw new Error('AILY_DOMAIN_TASK_NOT_FOUND');
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    const sealedInput = parseJobAidProblemTask(task);
    if (sealedInput.executionMode !== 'AILY_AGENT_V1' || task.operationRef !== ref || task.actionAttemptId !== row.attemptId ||
        task.inputHash !== row.taskInputHash || sealedInput.actorUserId !== actor.actorUserId)
      throw new Error('AILY_DOMAIN_TASK_BINDING_CHANGED');
    const current: CanonicalWorkItemProjection = await this.registrar.getTenantScopedByWorkItemId({tenantId: actor.tenantId, workItemId: row.workItemId});
    const config = this.admission.requireScope(actor.tenantId, current);
    const run = await this.repository.readAilyExecutorRun(row);
    if (!run || run.agentId !== actor.agentId || run.agentId !== config.agentId || run.scope.principalId !== config.principalId ||
        run.scope.tenantId !== actor.tenantId || run.scope.workItemId !== row.workItemId || run.scope.intakeRequestId !== current.requestId ||
        task.idempotencyKey !== `openclaw-v2:dynamic:${row.workItemId}:${task.documentVersionId}:${run.requestId}` ||
        run.leaseGeneration !== row.leaseGeneration || run.modelEvidence.selectedModelRef !== task.executionModel?.modelRef ||
        task.documentVersionId !== current.source.documentVersionId ||
        !task.sourceRefs.some(source => source.ref === current.source.sourceArtifactId && source.sha256 === canonicalHostBareSha256(current.source.sourceFileSha256)))
      throw new Error('AILY_DOMAIN_RUN_BINDING_CHANGED');
    const writePredicate = this.actorPredicate(actor);
    const authorization = await this.actors.withActorTransaction(actor.actorUserId, async ({database}) => {
      const [proof] = await database.execute<{allowed: boolean}>(sql`SELECT (${writePredicate}) AS allowed`);
      if (proof?.allowed !== true) throw new Error('AILY_DOMAIN_AUTHORIZATION_CHANGED');
      const [owner] = await database.select().from(workItem).where(and(eq(workItem.tenantId, actor.tenantId),
        eq(workItem.workItemId, row.workItemId), eq(workItem.requestedByUserId, actor.actorUserId))).limit(1);
      if (!owner || owner.requestId !== current.requestId || owner.documentVersionId !== task.documentVersionId ||
          owner.documentId !== current.source.documentId || Number(owner.sourceByteLength) !== current.source.sourceByteLength ||
          owner.sourceArtifactId !== current.source.sourceArtifactId || owner.sourceFileSha256 !== canonicalHostBareSha256(current.source.sourceFileSha256))
        throw new Error('AILY_DOMAIN_SOURCE_CHANGED');
      const bound = automaticWorkItemTaskLease(sealedInput.automaticWorkItemLease);
      const [grant] = await database.select().from(autoWorkItemAuthorization).where(and(
        eq(autoWorkItemAuthorization.tenantId, actor.tenantId), eq(autoWorkItemAuthorization.workItemId, row.workItemId))).limit(1);
      const active = !!grant && !!bound && grant.grantKind === 'MIAODA_CANONICAL_PARSE_REQUEST' && grant.status === 'LEASED' && grant.leaseOwner === config.principalId &&
        !!grant.leaseToken && !!grant.leaseExpiresAt && grant.leaseExpiresAt > new Date() &&
        grant.requestId === bound.requestId && grant.leaseGeneration === bound.leaseGeneration && grant.requestId === current.requestId &&
        grant.actorUserId === actor.actorUserId && grant.documentId === owner.documentId && grant.documentVersionId === task.documentVersionId &&
        grant.sourceArtifactId === owner.sourceArtifactId && grant.sourceFileSha256 === owner.sourceFileSha256 &&
        Number(grant.sourceByteLength) === Number(owner.sourceByteLength);
      if (operation === 'WRITE' || operation === 'FINALIZE' && row.status !== 'SUCCEEDED') {
        if (!active) throw new Error('AILY_OUTER_LEASE_REQUIRED');
        if (!row.leaseToken) throw new Error('AILY_DOMAIN_LEASE_REQUIRED');
        if (operation === 'WRITE' || row.status !== 'COMMITTING') assertJobAidWorkFence(row, {principalId: config.principalId,
          leaseToken: row.leaseToken, leaseGeneration: row.leaseGeneration});
        else if (row.leaseOwner !== config.principalId || !row.leaseExpiresAt || row.leaseExpiresAt <= new Date() ||
            !row.deadlineAt || row.deadlineAt <= new Date() || row.cancelRequestedAt)
          throw new Error('AILY_DOMAIN_FINALIZE_FENCE_REJECTED');
      }
      const outer = active && grant ? {requestId: grant.requestId, actorUserId: grant.actorUserId, documentId: grant.documentId,
        documentVersionId: grant.documentVersionId, sourceArtifactId: grant.sourceArtifactId, sourceFileSha256: grant.sourceFileSha256,
        sourceByteLength: Number(grant.sourceByteLength), leaseGeneration: grant.leaseGeneration, leaseExpiresAt: grant.leaseExpiresAt!.toISOString()} : undefined;
      const innerFence = row.status === 'SUCCEEDED' && operation !== 'WRITE' ? sql`true` : sql`EXISTS (SELECT 1 FROM ${actionAttempt}
        WHERE ${actionAttempt.attemptId}=${row.attemptId} AND ${actionAttempt.taskInputHash}=${row.taskInputHash}
          AND ${actionAttempt.leaseOwner}=${config.principalId} AND ${actionAttempt.leaseToken}=${row.leaseToken}
          AND ${actionAttempt.leaseGeneration}=${row.leaseGeneration}
          AND ${operation === 'FINALIZE' ? sql`${actionAttempt.status} IN ('RUNNING','COMMITTING')` : sql`${actionAttempt.status}='RUNNING'`}
          AND ${actionAttempt.cancelRequestedAt} IS NULL AND ${actionAttempt.leaseExpiresAt}>clock_timestamp()
          AND ${actionAttempt.deadlineAt}>clock_timestamp())`;
      const liveWrite = active && grant ? sql`(${writePredicate}) AND (${innerFence}) AND EXISTS (SELECT 1 FROM ${autoWorkItemAuthorization}
        WHERE ${autoWorkItemAuthorization.tenantId}=${actor.tenantId} AND ${autoWorkItemAuthorization.workItemId}=${row.workItemId}
          AND ${autoWorkItemAuthorization.requestId}=${grant.requestId} AND ${autoWorkItemAuthorization.leaseGeneration}=${grant.leaseGeneration}
          AND ${autoWorkItemAuthorization.leaseOwner}=${config.principalId} AND ${autoWorkItemAuthorization.leaseToken}=${grant.leaseToken}
          AND ${autoWorkItemAuthorization.grantKind}='MIAODA_CANONICAL_PARSE_REQUEST'
          AND ${autoWorkItemAuthorization.actorUserId}=${actor.actorUserId}
          AND ${autoWorkItemAuthorization.documentId}=${owner.documentId} AND ${autoWorkItemAuthorization.documentVersionId}=${task.documentVersionId}
          AND ${autoWorkItemAuthorization.sourceArtifactId}=${owner.sourceArtifactId}
          AND ${autoWorkItemAuthorization.sourceFileSha256}=${owner.sourceFileSha256} AND ${autoWorkItemAuthorization.sourceByteLength}=${owner.sourceByteLength}
          AND ${autoWorkItemAuthorization.status}='LEASED' AND ${autoWorkItemAuthorization.leaseExpiresAt}>clock_timestamp())` : writePredicate;
      return {outer, writePredicate: liveWrite};
    });
    const history = await this.work.listForRuntime({tenantId: actor.tenantId, actorUserId: actor.actorUserId, workItemId: row.workItemId});
    return {row, task, sealedInput, run, baseline: history[0] ?? null, writePredicate: authorization.writePredicate,
      scope: {principalId: config.principalId, tenantId: actor.tenantId, workItemId: row.workItemId, appId: 'app_17bzc551rsg',
        attemptRef: ref, authorizationFingerprint: config.authorizationFingerprint,
        ...(authorization.outer ? {automaticWorkItemLease: authorization.outer} : {})}};
  }
}
