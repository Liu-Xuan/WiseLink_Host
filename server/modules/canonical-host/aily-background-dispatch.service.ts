import { Inject, Injectable } from '@nestjs/common';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { canonicalJson, parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { AILY_ENTERPRISE_CONFIGURATION, type AilyEnterpriseConfigurationState } from './aily-enterprise-configuration';
import { AilyTaskAdmissionService, type AilyAssessmentAdmission } from './aily-task-admission';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { CanonicalHostInitialAnalysisStatusService } from './canonical-host-initial-analysis-status.service';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { JobAidWorkRepository } from './jobaid-work.repository';
import { AilyTaskExecutionService } from './aily-task-execution.service';
import { AilyTaskLifecycleService } from './aily-task-lifecycle.service';
import { AutomaticWorkItemDispatchService } from './automatic-work-item-dispatch.service';
import { assertAilyRequestTaskBinding } from './aily-executor-run';
import { canonicalHostBareSha256 } from './canonical-host-sha256';

/** One configured WorkItem and one persisted request per invocation. No queue or loop. */
@Injectable()
export class AilyBackgroundDispatchService {
  constructor(
    @Inject(AILY_ENTERPRISE_CONFIGURATION) private readonly state: AilyEnterpriseConfigurationState,
    private readonly admission: AilyTaskAdmissionService,
    private readonly actors: EngineeringMatterWorkingRepository,
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly status: CanonicalHostInitialAnalysisStatusService,
    private readonly repository: ActionAttemptRepository,
    private readonly jobAid: CanonicalJobAidProblemService,
    private readonly work: JobAidWorkRepository,
    private readonly execution: AilyTaskExecutionService,
    private readonly lifecycle: AilyTaskLifecycleService,
    private readonly dispatch: AutomaticWorkItemDispatchService,
  ) {}

  async runOnce() {
    if (this.state.status !== 'READY') return {status: 'UNAVAILABLE' as const, reason: this.state.reason};
    const config = this.state.configuration;
    if (!config.background.enabled) return {status: 'UNAVAILABLE' as const, reason: 'AILY_BACKGROUND_DISABLED'};
    const loaded = await this.workItems.loadAutoProcessingProjection(config.task.workItemId, config.task.tenantId);
    if (!loaded?.projection || !loaded.row.requestedByUserId)
      throw new Error('AILY_BACKGROUND_WORK_ITEM_NOT_VISIBLE');
    const actorUserId = loaded.row.requestedByUserId;
    return this.actors.withActorScope(actorUserId, async () => {
      const current = await this.workItems.loadAutoProcessingProjection(config.task.workItemId, config.task.tenantId);
      if (!current?.projection || current.row.requestedByUserId !== actorUserId ||
          current.row.revision !== current.projection.revision)
        throw new Error('AILY_BACKGROUND_WORK_ITEM_BINDING_CHANGED');
      const workItem = current.projection;
      this.admission.requireScope(config.task.tenantId, workItem);
      const context = {purpose: 'BACKGROUND' as const, identityRef: config.caller.identityRef, workItem,
        callerAppId: config.caller.appId,
        actor: {userId: actorUserId, tenantId: config.task.tenantId}};
      const reauthorize = async (): Promise<void> => {
        const fresh = await this.workItems.loadAutoProcessingProjection(workItem.workItemId, config.task.tenantId);
        if (!fresh?.projection || fresh.row.requestedByUserId !== actorUserId ||
            fresh.row.revision !== workItem.revision || fresh.projection.requestId !== workItem.requestId ||
            canonicalJson(fresh.projection.source) !== canonicalJson(workItem.source))
          throw new Error('AILY_BACKGROUND_WORK_ITEM_BINDING_CHANGED');
        this.admission.requireScope(config.task.tenantId, fresh.projection);
        // Existing exact source/grant authorization. This does not renew a lease.
        await this.dispatch.claimAilyWorkItem({tenantId: config.task.tenantId, actorUserId, workItem: fresh.projection});
      };
      const progress = await this.status.project({tenantId: config.task.tenantId, workItem});
      const stage = progress.stages.jobAid;
      const pointer = stage.attemptRef ? await this.status.readAilyBackgroundRequest({tenantId: config.task.tenantId,
        actorUserId, workItem, expectedAttemptRef: stage.attemptRef}) : undefined;
      const requestId = pointer?.requestId ?? stage.requestId;
      let row = stage.attemptRef ? await this.repository.readByOperationRef(stage.attemptRef) : null;
      if (stage.attemptRef && !row) throw new Error('AILY_BACKGROUND_REQUEST_NOT_VISIBLE');
      if (row) {
        const task = parseTaskEnvelope(row.taskEnvelopeJson);
        if (row.tenantId !== config.task.tenantId || row.workItemId !== workItem.workItemId ||
            row.actorUserId !== actorUserId || task.modelInput.executionMode !== 'AILY_AGENT_V1' ||
            task.tenantId !== row.tenantId || task.workItemId !== row.workItemId || task.actionAttemptId !== row.attemptId ||
            task.operationRef !== row.operationRef || task.taskType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
            task.documentVersionId !== workItem.source.documentVersionId || task.inputHash !== row.taskInputHash ||
            !task.sourceRefs.some(source => source.ref === workItem.source.sourceArtifactId &&
              source.sha256 === canonicalHostBareSha256(workItem.source.sourceFileSha256)))
          throw new Error('AILY_BACKGROUND_REQUEST_BINDING_CHANGED');
        const run = await this.repository.readAilyExecutorRun(row);
        if (run) {
          assertAilyRequestTaskBinding(run.requestId, task);
          if (run.scope.intakeRequestId !== workItem.requestId || run.agentId !== config.task.agentId ||
              run.scope.tenantId !== row.tenantId || run.scope.workItemId !== row.workItemId ||
              (run.invocation !== undefined && run.invocation.callerAppId !== config.caller.appId) ||
              run.modelEvidence.selectedModelRef !== task.executionModel?.modelRef ||
              (requestId !== undefined && requestId !== run.requestId) ||
              run.scope.principalId !== config.task.principalId || run.leaseGeneration !== row.leaseGeneration)
            throw new Error('AILY_BACKGROUND_RUN_BINDING_CHANGED');
          if (!run.invocation) return {status:'UNAVAILABLE' as const,reason:'AILY_ORIGINAL_BROWSER_INVOCATION_REQUIRED',
            taskContextRef:row.operationRef,requestId:run.requestId,hostStatus:row.status,postState:run.post.state};
          if (!['RUNNING', 'COMMITTING'].includes(row.status)) return {status: 'HOST_TERMINAL' as const,
            hostStatus: row.status, requestId: run.requestId, taskContextRef: row.operationRef,
            postState: run.post.state, savePhase: run.pending?.phase ?? null,
            recoveryRequired: row.status === 'SUCCEEDED' || run.post.state !== 'ACCEPTED' || run.pending !== undefined,
            nextOperation: progress.nextOperation};
          return {status: 'TICK' as const, requestId: run.requestId, taskContextRef: row.operationRef,
            result: await this.lifecycle.tick(row.operationRef!)};
        }
        if (row.status !== 'QUEUED' || row.claimCount !== 0 || !requestId)
          return {status: 'RECOVERY_REQUIRED' as const, hostStatus: row.status, taskContextRef: row.operationRef};
        assertAilyRequestTaskBinding(requestId, task);
        await this.execution.preflight(context, task.executionModel!.modelRef);
      } else {
        if (progress.nextOperation !== 'EVALUATE_JOBAID') return {status: 'PREREQUISITE_REQUIRED' as const,
          nextOperation: progress.nextOperation, hostStatus: progress.status};
        if (!config.background.allowOriginalRequest) return {status: 'UNAVAILABLE' as const, reason: 'AILY_ORIGINAL_ADMISSION_DISABLED'};
        const selected = this.admission.require(config.task.tenantId, workItem);
        await this.execution.preflight(context, selected.model.modelRef);
        await reauthorize();
        const original = await this.work.publishedOriginalBindingForRequest({tenantId: config.task.tenantId,
          actorUserId, workItemId: workItem.workItemId, documentVersionId: workItem.source.documentVersionId});
        const admission: AilyAssessmentAdmission = {...selected, executionMode: 'AILY_AGENT_V1',
          modelRef: selected.model.modelRef, actorUserId};
        const receipt = await this.jobAid.enqueueOriginalContinuation(workItem, {tenantId: config.task.tenantId,
          principalId: config.task.principalId, appId: config.host.appId, workItemId: workItem.workItemId,
          authorizationFingerprint: config.task.authorizationFingerprint}, 'INITIAL_PROBLEM_ASSESSMENT', original, admission);
        row = await this.repository.readByOperationRef(receipt.attemptRef!);
        if (!row) throw new Error('AILY_BACKGROUND_REQUEST_NOT_VISIBLE');
        return {status: 'DISPATCHED' as const, requestId: receipt.requestId,
          result: await this.execution.execute({...context, row, requestId: receipt.requestId,
            permissionSnapshotVersion: config.task.authorizationFingerprint, reauthorize})};
      }
      return {status: 'DISPATCHED' as const, requestId: requestId!,
        result: await this.execution.execute({...context, row, requestId: requestId!,
          permissionSnapshotVersion: config.task.authorizationFingerprint, reauthorize})};
    });
  }
}
