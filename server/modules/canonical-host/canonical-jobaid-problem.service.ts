import { assertTdmsSealedResultFence, tdmsReviewBinding, type TdmsReviewCaller, type TdmsReviewIngress } from '../tdms-source/tdms-review-delegation';
import type { TdmsReviewSavedContext, TdmsReviewContext } from './tdms-review-saved-context';
import { assertJobAidSemanticContent } from './jobaid-semantic-content';
import {
  buildJobAidPreparationView, preparationAfterSavedWork, unavailableJobAidPreparationFacts,
  type JobAidEngineerPreparationFacts, type JobAidPreparationScope,
} from './jobaid-preparation-view';
import { assertAutomaticWorkItemAttemptLease, taskAutomaticWorkItemLease } from '../action-attempt/automatic-work-item-attempt-lease';
import type { CancelledInitialContinuationGuard } from '../action-attempt/cancelled-initial-continuation';
import { TDMS_RUNTIME_READER, type TdmsRuntimeReaderPort, type TdmsRuntimeTaskContext } from '../tdms-source/tdms-runtime-reader.port';
import { TDMS_NATIVE_EVIDENCE_VERIFIER, verifyTdmsNativeEvidence, assertTdmsNativeInTransaction, type TdmsNativeEvidenceVerifier,
  type TdmsNativeTransactionInput } from './tdms-native-evidence-verifier.port';
import { parseAssessmentTdmsEvidence } from '@shared/assessment-tdms-evidence';
import { mergeTdmsReadEvidence, resolvedTdmsReadEvidence, resolvedTdmsReadCarriers, tdmsJobAidDirectory } from './jobaid-tdms-context';
import { DocumentActivityRunRepository } from './document-activity-run.repository';
import { projectSavedDocumentActivityForAssessment, type DocumentActivityAssessmentProjection } from './document-activity-assessment-projection';
import { sourceStatementEvidence } from './document-activity-assessment-consumer';
import { parseAssessmentSourceStatement } from '@shared/assessment-evidence-roots';
import type { JobAidKnowledgeObservationStatus } from '@shared/jobaid-activity.interface';
import { projectJobAidActivity } from './jobaid-activity';
import { originalApplicabilityResultMatches } from './original-applicability-currentness';
import { InitialAssessmentKnowledgeService } from './initial-assessment-knowledge.service';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { DocumentSemanticService } from './document-semantic.service';
import {
  prepareDocumentOriginalEngineeringReader,
  prepareDocumentOriginalEvidenceFinder,
} from './document-original-engineering-reading';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  actionAttempt,
  assessmentWorkRevision,
  reviewTurn,
  workItem as workItemTable,
} from '../../database/schema';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalOverallRegenerationRequestProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  isJobAidProblemProjection,
  type CanonicalJobAidProblemCandidateProjection,
  type JobAidWorkRevision,
  type JobAidWorkingReadModel,
} from '@shared/jobaid-problem-assessment.interface';
import {
  canonicalJson,
  canonicalSha256,
  parseTaskEnvelope,
  parseStoredResultEnvelope,
} from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import {
  buildInitialAnalysisRequestInput,
  readInitialAnalysisRequestInput,
} from '../action-attempt/initial-analysis-request';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ActionAttemptTerminalProjection,
  PreparedActionAttemptCommit,
} from '../action-attempt/action-attempt.types';
import { ReviewConversationRepository } from '../review-persistence/review-conversation.repository';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedArtifactReadScope } from '../unified-reader/unified-artifact-read-scope';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { CANONICAL_OBJECT_ACCESS, type CanonicalObjectAccessPort } from '../work-item/canonical-object-access.port';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import { CanonicalHostCommonContextService } from './canonical-host-common-context.service';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import {
  assertJobAidOverallWorkCurrent,
  buildJobAidOverallProjection,
} from './jobaid-overall-projection';
import { preflightCanonicalHostOpenClawResult, parseCanonicalHostOpenClawAttemptTask, parseCanonicalHostOpenClawStoredResult } from './canonical-host-openclaw-runtime-policy';
import {
  overallModelEvidenceRegistry,
} from './overall-assessment-reading';
import {
  buildJobAidProblemTask,
  jobAidSourceFileReference,
  expandJobAidSourceSelection,
  isJobAidProblemTask,
  parseJobAidProblemTask,
  resolvedAssessmentSources,
  type JobAidProblemModelInput,
  type JobAidProblemTaskInput,
  type JobAidSourceBinding,
} from './jobaid-problem-task';
import {
  jobAidReadingResult,
  materializeJobAidWork,
  assertJobAidIssueEditScope,
} from './jobaid-problem-work';
import {
  JobAidWorkRepository,
  assertJobAidWorkFence,
  type JobAidWorkFence,
} from './jobaid-work.repository';
import {
  activeConfigurationEvidenceReevaluation,
  configurationEvidenceShadow,
  withStagedBaseRules,
  promoteConfigurationEvidenceReevaluation,
  retryConfigurationEvidenceReevaluationStage,
} from './configuration-evidence/configuration-evidence-reevaluation.state';

// Host-only exact pointer; the immutable work and APPLIED Review receipt remain
// authoritative. Browser read models deliberately do not expose this field.
export interface JobAidReviewOverallRegenerationBinding {
  workRevisionRef: string;
  workRevision: number;
}
export type JobAidReviewOverallRegenerationMarker =
  CanonicalOverallRegenerationRequestProjection & {
    jobAidReviewWork?: JobAidReviewOverallRegenerationBinding;
  };

export interface BeginJobAidProblemResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
  recoveryResult?: OpenClawResultEnvelope;
  modelInput: JobAidProblemModelInput;
  selectedDiscoveryRefs: string[];
}

/** Problem analysis uses the existing ActionAttempt, source authorization and candidate CAS. */
@Injectable()
export class CanonicalJobAidProblemService {
  // Request-local routing only. The provider rechecks the private immutable
  // binding; storing a scope or a JSON lookalike never grants authority.
  private readonly successorCallers=new WeakMap<CanonicalVerifiedServiceScope,TdmsReviewCaller>();
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    private readonly attempts: ActionAttemptLifecycleService,
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly conversations: ReviewConversationRepository,
    private readonly common: CanonicalHostCommonContextService,
    private readonly work: JobAidWorkRepository,
    @Optional() private readonly knowledge?: InitialAssessmentKnowledgeService,
    @Optional() private readonly originalReader?: UnifiedReaderService,
    @Optional() private readonly semantics?: DocumentSemanticService,
    @Optional()
    @Inject(DRIZZLE_DATABASE)
    private readonly database?: PostgresJsDatabase,
    @Optional() private readonly activityRuns?: DocumentActivityRunRepository,
    @Optional() @Inject(CANONICAL_OBJECT_ACCESS) private readonly objectAccess?: CanonicalObjectAccessPort,
    @Optional() @Inject(TDMS_RUNTIME_READER) private readonly tdmsReader?: TdmsRuntimeReaderPort,
    @Optional() @Inject(TDMS_NATIVE_EVIDENCE_VERIFIER) private readonly nativeVerifier?: TdmsNativeEvidenceVerifier,
  ) {}

  /** Deployment first installs dual readers; only explicitly enabled NEW tasks use v2. */
  enabledForNewTasks(): boolean {
    return process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1';
  }

  async hasBoundTask(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    purpose: JobAidProblemModelInput['purpose'],
  ): Promise<boolean> {
    return !!(await this.attempts.readExactIdempotency({
      tenantId,
      workItemId: workItem.workItemId,
      taskType:
        purpose === 'INITIAL_PROBLEM_ASSESSMENT'
          ? 'OPENCLAW_DYNAMIC_EVALUATION'
          : 'OPENCLAW_OVERALL_SYNTHESIS',
      baseRevision: workItem.revision,
      documentVersionId: workItem.source.documentVersionId,
      idempotencyKey: problemIdempotencyKey(workItem, purpose),
    }));
  }

  async begin(
    workItem: CanonicalWorkItemProjection,
    scope: CanonicalVerifiedServiceScope,
    purpose: JobAidProblemModelInput['purpose'],
    requestId?: string,
  ): Promise<BeginJobAidProblemResult> {
    const loaded = await this.workItems.loadTenantScopedProjection(
      workItem.workItemId,
      scope.tenantId,
    );
    if (
      !loaded ||
      loaded.row.documentVersionId !== workItem.source.documentVersionId
    )
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const actorUserId = loaded.row.requestedByUserId;
    const taskType =
      purpose === 'INITIAL_PROBLEM_ASSESSMENT'
        ? 'OPENCLAW_DYNAMIC_EVALUATION'
        : 'OPENCLAW_OVERALL_SYNTHESIS';
    const idempotencyKey = problemIdempotencyKey(workItem, purpose, requestId);
    let originalParseRunId: string | undefined;
    if (requestId !== undefined) {
      const existing = await this.attempts.readRequest({
        tenantId: scope.tenantId,
        workItemId: workItem.workItemId,
        taskType,
        documentVersionId: workItem.source.documentVersionId,
        idempotencyKey,
      });
      if (existing) {
        continuationReceipt(existing, purpose);
        originalParseRunId = readInitialAnalysisRequestInput(parseTaskEnvelope(existing.taskEnvelopeJson))?.originalParseRunId;
        if (
          !['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
            existing.status,
          )
        )
          throw new Error(`ACTION_ATTEMPT_ALREADY_${existing.status}`);
      } else if (!this.enabledForNewTasks()) {
        throw new Error('JOBAID_PROBLEM_V2_NEW_REQUEST_DISABLED');
      }
    }
    // A queued task still names its sealed work. Recheck the exact Host marker
    // before claiming so a later Review cannot expose obsolete model input.
    if (purpose === 'OVERALL_CONSISTENCY' && workItem.overallRegenerationRequest)
      await this.reviewOverallRegenerationBinding({workItem,tenantId:scope.tenantId,actorUserId,nativeCaller:{runtimeScope:scope}},false);
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType,
      actorUserId: 'service:openclaw-main',
      tenantId: scope.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey,
      sourceRefs: [
        jobAidSourceFileReference(workItem),
      ],
      allowedConnectors: loaded.row.initialAilySessionId
        ? ['feishu-aily-user']
        : [],
      initialKnowledgeSession: {
        expectedSessionId: loaded.row.initialAilySessionId ?? null,
      },
      buildModelInput: (identity) =>
        this.buildInput(
          workItem,
          scope.tenantId,
          actorUserId,
          scope.authorizationFingerprint,
          purpose,
          identity.createdAt.toISOString(),
          [],
          undefined,
          originalParseRunId,
          undefined, false, {scope,taskContextRef:identity.operationRef},
        ),
    });
    const input = parseJobAidProblemTask(claim.task);
    if (purpose === 'OVERALL_CONSISTENCY') {
      const [latest] = await this.work.listHeadersForRuntime({tenantId:scope.tenantId,
        workItemId:workItem.workItemId,actorUserId});
      if (!latest || input.previousWork?.workRevisionRef !== latest.workRevisionRef ||
        input.previousWork.workRevision !== latest.workRevision)
        throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    }
    await this.assertSourcesAuthorized(
      input.sourceCatalog,
      input,
      scope.tenantId,
      workItem.workItemId,
      scope,
    );
    return {
      attemptRef: claim.attemptRef,
      status: claim.status,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      leaseExpiresAt: claim.leaseExpiresAt,
      task: structuredClone(claim.task),
      ...(claim.status === 'COMMITTING'
        ? { recoveryResult: structuredClone(claim.recoveryResult) }
        : {}),
      modelInput: structuredClone(input.modelInput),
      selectedDiscoveryRefs: [],
    };
  }

  /** A caller supplies only a persisted turn pointer; the Host chooses the work. */
  async beginSuccessorOverall(
    workItemId: string,
    scope: CanonicalVerifiedServiceScope,
    successorReviewTurnRef: string,
  ): Promise<BeginJobAidProblemResult> {
    const delegated = scope.successorReviewDelegation;
    if (!delegated || delegated.workItemId !== workItemId ||
      delegated.tenantId !== scope.tenantId ||
      delegated.principalId !== scope.principalId ||
      delegated.reviewTurnRef !== successorReviewTurnRef || !delegated.overallRequested)
      throw new Error('JOBAID_SUCCESSOR_OVERALL_DELEGATION_REQUIRED');
    const idempotencyKey = `openclaw-successor-overall:${workItemId}:${successorReviewTurnRef}`;
    const identity=await this.attempts.readRequestIdentity({tenantId:scope.tenantId,workItemId,
      taskType:'OPENCLAW_OVERALL_SYNTHESIS',documentVersionId:delegated.documentVersionId,idempotencyKey});
    // After this execution's own projection CAS the WorkItem can be base+1.
    // Its genuine persisted attempt supplies that narrow recovery proof before
    // any completed turn/work/task body is loaded. No former lease is inferred.
    await this.admitSuccessorSources(scope,successorReviewTurnRef,
      identity?.operationRef && ['RUNNING','COMMITTING','SUCCEEDED'].includes(identity.status)
        ? identity.operationRef : undefined);
    const binding = await this.conversations.loadOpenClawTurnByIdBinding({
      tenantId: scope.tenantId, actorId: delegated.actorUserId, workItemId,
      reviewConversationId: delegated.reviewConversationRef,
      reviewTurnId: successorReviewTurnRef,
    });
    const turn = binding?.turn;
    const receipt = turn?.assistantCandidate?.jobAidWorkingUpdate;
    if (!turn || turn.requestId !== delegated.requestId ||
      turn.inputRevision !== delegated.inputRevision || !turn.overallRequested ||
      turn.purpose !== 'UPDATE_ASSESSMENT' || turn.reviewScope)
      throw new Error('JOBAID_SUCCESSOR_OVERALL_TURN_CHANGED');
    if (!receipt?.workRevisionRef || receipt.status !== 'APPLIED')
      throw new Error('JOBAID_SUCCESSOR_OVERALL_NO_WORK');
    const workItem = await this.registrar.getTenantScopedByWorkItemId({tenantId: scope.tenantId, workItemId});
    if (workItem.source.documentVersionId !== delegated.documentVersionId ||
      workItem.source.sourceArtifactId !== delegated.sourceArtifactId ||
      canonicalHostBareSha256(workItem.source.sourceFileSha256) !== canonicalHostBareSha256(delegated.sourceFileSha256) ||
      workItem.source.sourceByteLength !== delegated.sourceByteLength)
      throw new Error('JOBAID_SUCCESSOR_OVERALL_SOURCE_CHANGED');
    const history = await this.work.listForRuntime({tenantId: scope.tenantId, workItemId,
      actorUserId: delegated.actorUserId});
    const exact = history[0];
    if (!exact || exact.workRevisionRef !== receipt.workRevisionRef ||
      exact.workRevision !== receipt.workRevision ||
      exact.documentVersionId !== delegated.documentVersionId ||
      exact.content.roundCompletion === 'IN_PROGRESS')
      throw new Error('JOBAID_SUCCESSOR_OVERALL_WORK_CHANGED');
    const existing = await this.attempts.readRequest({tenantId: scope.tenantId,workItemId,
      taskType: 'OPENCLAW_OVERALL_SYNTHESIS',documentVersionId: delegated.documentVersionId,idempotencyKey});
    if (existing && !['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'].includes(existing.status))
      throw new Error(`ACTION_ATTEMPT_ALREADY_${existing.status}`);
    // Projection CAS can succeed before the terminal acknowledgement. Return the
    // same sealed result and execution fence, without reserving against the new revision.
    if (existing?.status === 'COMMITTING') {
      await this.admitSuccessorSources(scope,successorReviewTurnRef,existing.operationRef!);
      if (existing.leaseOwner !== scope.principalId || !existing.leaseToken || !existing.leaseExpiresAt)
        throw new Error('JOBAID_SUCCESSOR_OVERALL_RECOVERY_FENCE_INVALID');
      const recoveryTask = parseCanonicalHostOpenClawAttemptTask(existing);
      const recoveryInput = parseJobAidProblemTask(recoveryTask);
      if (recoveryInput.successorReviewTurnRef !== successorReviewTurnRef ||
        recoveryInput.previousWork?.workRevisionRef !== exact.workRevisionRef)
        throw new Error('JOBAID_SUCCESSOR_OVERALL_ATTEMPT_CHANGED');
      await this.assertSourcesAuthorized(recoveryInput.sourceCatalog,recoveryInput,scope.tenantId,workItemId,scope);
      return {attemptRef: recoveryTask.operationRef,status:'COMMITTING',
        leaseToken:existing.leaseToken,leaseGeneration:existing.leaseGeneration,
        leaseExpiresAt:existing.leaseExpiresAt.toISOString(),task:recoveryTask,
        recoveryResult:parseCanonicalHostOpenClawStoredResult({row:existing,task:recoveryTask}),
        modelInput:structuredClone(recoveryInput.modelInput),selectedDiscoveryRefs:[]};
    }
    if (!existing && workItem.integratedAssessment?.overallSynthesis?.status === 'CANDIDATE_ONLY' &&
      workItem.integratedAssessment.overallSynthesis.basedOnJobAidWorkRevisionRef === exact.workRevisionRef)
      throw new Error('JOBAID_SUCCESSOR_OVERALL_ALREADY_CURRENT');
    const claim = await this.attempts.reserveAndClaim({
      workItemId, taskType: 'OPENCLAW_OVERALL_SYNTHESIS', actorUserId: 'service:openclaw-main',
      tenantId: scope.tenantId, leaseOwner: scope.principalId,
      documentVersionId: delegated.documentVersionId,
      inputRevision: workItem.revision, baseRevision: workItem.revision, idempotencyKey,
      sourceRefs: [jobAidSourceFileReference(workItem)], allowedConnectors: [],
      buildModelInput: async identity => {
        await this.admitSuccessorSources(scope,successorReviewTurnRef,undefined,identity);
        return ({
        ...await this.buildInput(workItem, scope.tenantId, delegated.actorUserId,
          scope.authorizationFingerprint, 'OVERALL_CONSISTENCY', identity.createdAt.toISOString(),
          [], undefined, undefined, exact, false, {scope,taskContextRef:identity.operationRef}),
        successorReviewTurnRef,
        successorOverallBinding: {
          reviewConversationRef: delegated.reviewConversationRef, requestId: delegated.requestId,
          inputRevision: delegated.inputRevision, workRevisionRef: exact.workRevisionRef,
          workRevision: exact.workRevision, workItemRevision: workItem.revision,
        },
      });
      },
    });
    await this.admitSuccessorSources(scope,successorReviewTurnRef,claim.attemptRef);
    const task = parseJobAidProblemTask(claim.task);
    if (task.successorReviewTurnRef !== successorReviewTurnRef ||
      task.previousWork?.workRevisionRef !== exact.workRevisionRef)
      throw new Error('JOBAID_SUCCESSOR_OVERALL_ATTEMPT_CHANGED');
    await this.assertSourcesAuthorized(task.sourceCatalog,task,scope.tenantId,workItemId,scope);
    return { attemptRef: claim.attemptRef, status: claim.status, leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration, leaseExpiresAt: claim.leaseExpiresAt,
      task: structuredClone(claim.task), selectedDiscoveryRefs: [], modelInput: structuredClone(task.modelInput),
      ...(claim.status === 'COMMITTING' ? {recoveryResult: structuredClone(claim.recoveryResult)} : {}),
    };
  }

  async readOriginalContinuationBinding(workItem: CanonicalWorkItemProjection, scope: CanonicalVerifiedServiceScope) {
    const loaded = await this.workItems.loadTenantScopedProjection(workItem.workItemId, scope.tenantId);
    if (!loaded || loaded.row.documentVersionId !== workItem.source.documentVersionId)
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    return this.work.publishedOriginalBinding({tenantId:scope.tenantId,actorUserId:loaded.row.requestedByUserId,
      workItemId:workItem.workItemId,documentVersionId:workItem.source.documentVersionId});
  }

  /** Queue recovery is already service/tenant/Source authorized. Rebind only
   * its persisted actor on the existing transaction; do not acquire a pool connection. */
  async assertAutomaticCommittingRecoveryAuthorized(row: ActionAttemptRow, actorUserId: string,
    database: PostgresJsDatabase, recoveryScope?: NonNullable<TdmsNativeTransactionInput['recoveryCaller']>['scope']): Promise<void> {
    if (!row.taskEnvelopeJson) throw new Error('JOBAID_TASK_BINDING_INVALID');
    const task=parseJobAidProblemTask(parseTaskEnvelope(row.taskEnvelopeJson));
    if (task.actorUserId !== actorUserId) throw new Error('JOBAID_ACTOR_AUTHORIZATION_CHANGED');
    await this.work.withActorScope(actorUserId,async()=>{
      const result=row.resultEnvelopeJson?parseStoredResultEnvelope({value:row.resultEnvelopeJson,task:parseTaskEnvelope(row.taskEnvelopeJson!)}):null;
      let resultWorkRef:string|undefined;
      if(result?.modelOutput) {
        const output:unknown=JSON.parse(result.modelOutput);
        if(output && typeof output==='object' && 'workRevisionRef' in output && typeof output.workRevisionRef==='string') resultWorkRef=output.workRevisionRef;
      }
      const saved=resultWorkRef?await this.work.readByRef({tenantId:row.tenantId,workItemId:row.workItemId,workRevisionRef:resultWorkRef},database):null;
      // Recover only the result's exact saved body. Later unused READs remain in
      // the journal; the receipt verifier checks the consumed carriers against it.
      const evidence=[...task.sourceCatalog,...(saved?.content.evidence??[])];
      const assertNative=async(native:AssessmentEvidence[])=>{
        if(!native.some(item=>item.kind==='TDMS_NATIVE_RECORD')) return;
        if(!recoveryScope||!saved||saved.documentVersionId!==row.documentVersionId||!row.taskInputHash||!row.resultContentHash||!row.operationRef)
          throw new Error('TDMS_COMMIT_RECOVERY_CALLER_REQUIRED');
        await assertTdmsNativeInTransaction({actor:{tenantId:row.tenantId,actorUserId},recoveryCaller:{scope:recoveryScope,
          workItemId:row.workItemId,documentVersionId:row.documentVersionId,attemptRef:row.operationRef,
          taskInputHash:row.taskInputHash,resultContentHash:row.resultContentHash},evidence:native,database},this.nativeVerifier);
      };
      await this.assertEvidenceOwned(evidence,row.tenantId,actorUserId,row.workItemId,database,assertNative);
      for (const binding of task.sourceBindings) {
        const current=await this.work.loadOwnedSourceBinding({tenantId:row.tenantId,actorUserId,
          workItemId:binding.workItemId,kind:binding.kind},database);
        if (canonicalJson(current) !== canonicalJson(binding)) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
      }
      const original=task.modelInput.documentOverview.original?.binding;
      if (original) {
        const current=await this.work.publishedOriginalBindingInTransaction({tenantId:row.tenantId,
          actorUserId,workItemId:row.workItemId,documentVersionId:original.documentVersionId},database);
        if(current.parseRunId !== original.parseRunId) throw new Error('JOBAID_ORIGINAL_REQUEST_CHANGED');
      }
      await assertNative(evidence);
    },database);
  }

  /** Called only after an authorized queue claim. The old sealed task remains immutable. */
  async enqueueAutomaticTakeover(workItemId: string): Promise<void> {
    const scope = await this.serviceScope.authorizeOpenClawWorkItem({operation:'BEGIN_DYNAMIC',workItemId});
    if (!scope.automaticWorkItemLease || scope.workItemId !== workItemId) throw new Error('AUTO_WORK_ITEM_LEASE_REQUIRED');
    const current = await this.registrar.getTenantScopedByWorkItemId({tenantId:scope.tenantId,workItemId});
    const hasBase = isJobAidProblemProjection(current.integratedAssessment?.baseRules);
    if (hasBase && current.integratedAssessment?.overallSynthesis?.status === 'CANDIDATE_ONLY') return;
    const taskType = hasBase ? 'OPENCLAW_OVERALL_SYNTHESIS' : 'OPENCLAW_DYNAMIC_EVALUATION';
    if (!this.database) throw new Error('JOBAID_DATABASE_REQUIRED');
    const [previous] = await this.database.select().from(actionAttempt).where(and(
      eq(actionAttempt.tenantId,scope.tenantId),eq(actionAttempt.workItemId,workItemId),
      eq(actionAttempt.documentVersionId,current.source.documentVersionId),eq(actionAttempt.actionType,taskType)))
      .orderBy(desc(actionAttempt.attemptNo)).limit(1);
    if (!previous || !['TIMED_OUT','OBSOLETE'].includes(previous.status) || previous.cancelRequestedAt ||
        !['ACTION_ATTEMPT_DEADLINE_EXCEEDED','ACTION_ATTEMPT_SUPERSEDED_AFTER_LEASE_EXPIRY'].includes(previous.terminalReason ?? '')) return;
    const original = await this.readOriginalContinuationBinding(current,scope);
    const latest = (await this.work.listForRuntime({tenantId:scope.tenantId,workItemId,
      actorUserId:scope.automaticWorkItemLease.actorUserId}))[0];
    // Expiry never proves that an unknown provider call has stopped. Only a
    // never-started task or an exact INITIAL COMPLETE save can be resumed
    // automatically. Saved problem work does not settle an Overall provider call.
    if (previous.claimCount > 0 && (hasBase || !latest || latest.content.roundCompletion !== 'COMPLETE' ||
        latest.basedOnWorkItemRevision !== current.revision)) return;
    const requestId = canonicalSha256({purpose:'AUTOMATIC_INITIAL_TAKEOVER',taskType,
      tenantId:scope.tenantId,workItemId,workItemRevision:current.revision,
      authorization:scope.automaticWorkItemLease});
    await this.work.withActorScope(scope.automaticWorkItemLease.actorUserId,()=>this.enqueueContinuation(
      current,scope.tenantId,scope.authorizationFingerprint,requestId,
      hasBase ? 'OVERALL_CONSISTENCY' : 'INITIAL_PROBLEM_ASSESSMENT',undefined,original));
  }

  /** The caller has verified Hosted WorkItem authority and a changed original. */
  async enqueueOriginalContinuation(
    workItem: CanonicalWorkItemProjection,
    scope: CanonicalVerifiedServiceScope,
    purpose: 'INITIAL_PROBLEM_ASSESSMENT' | 'OVERALL_CONSISTENCY',
    expectedOriginal: {parseRunId:string;parseRevision:number},
  ) {
    const loaded = await this.workItems.loadTenantScopedProjection(workItem.workItemId, scope.tenantId);
    if (!loaded || loaded.row.documentVersionId !== workItem.source.documentVersionId)
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const actorUserId = loaded.row.requestedByUserId;
    return this.work.withActorScope(actorUserId, async () => {
      const original = await this.work.publishedOriginalBindingForRequest({tenantId:scope.tenantId,
        actorUserId,workItemId:workItem.workItemId,documentVersionId:workItem.source.documentVersionId});
      if (original.parseRunId !== expectedOriginal.parseRunId || original.parseRevision !== expectedOriginal.parseRevision)
        throw new Error('JOBAID_ORIGINAL_REQUEST_CHANGED');
      if (!Number.isSafeInteger(original.parseRevision) || original.parseRevision < 1)
        throw new Error('JOBAID_ORIGINAL_REVISION_INVALID');
      // Existing uniqueness includes WorkItem, DocumentVersion and operation.
      // A published parse revision supplies the durable request identity; a
      // failed request is replayed as failed, never given a new random identity.
      const requestId = `original-${original.parseRevision}`;
      const receipt = await this.enqueueContinuation(workItem, scope.tenantId,
        scope.authorizationFingerprint, requestId, purpose, undefined, original);
      return {...receipt,requestId,parseRunId:original.parseRunId};
    });
  }

  /** Called after browser owner, permission and current-version checks. */
  async enqueueContinuation(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    permissionSnapshotVersion: string,
    requestId: string,
    purpose: 'INITIAL_PROBLEM_ASSESSMENT' | 'OVERALL_CONSISTENCY',
    authorizedKnowledgeSession?: {
      sessionId: string;
      actorId: string;
      tenantId: string;
    },
    expectedOriginal?: {parseRunId:string;parseRevision:number},
    cancelledInitialContinuation?: CancelledInitialContinuationGuard,
  ) {
    if (!permissionSnapshotVersion.trim())
      throw new Error('JOBAID_PERMISSION_SNAPSHOT_REQUIRED');
    const idempotencyKey = problemIdempotencyKey(workItem, purpose, requestId);
    const taskType =
      purpose === 'INITIAL_PROBLEM_ASSESSMENT'
        ? 'OPENCLAW_DYNAMIC_EVALUATION'
        : 'OPENCLAW_OVERALL_SYNTHESIS';
    const existing = await this.attempts.readRequest({
      tenantId,
      workItemId: workItem.workItemId,
      taskType,
      documentVersionId: workItem.source.documentVersionId,
      idempotencyKey,
    });
    if (existing) return continuationReceipt(existing, purpose);
    if (!this.enabledForNewTasks())
      throw new Error('JOBAID_PROBLEM_V2_NEW_REQUEST_DISABLED');

    const execution = await this.prepareContinuationWorkItem(
      workItem,
      tenantId,
      purpose,
    );
    const loaded = await this.workItems.loadTenantScopedProjection(
      execution.workItemId,
      tenantId,
    );
    if (
      !loaded ||
      loaded.row.documentVersionId !== execution.source.documentVersionId
    )
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const original = await this.work.publishedOriginalBindingForRequest({
      tenantId, actorUserId: loaded.row.requestedByUserId, workItemId: execution.workItemId,
      documentVersionId: execution.source.documentVersionId,
    });
    if (expectedOriginal && (original.parseRunId !== expectedOriginal.parseRunId ||
      original.parseRevision !== expectedOriginal.parseRevision)) throw new Error('JOBAID_ORIGINAL_REQUEST_CHANGED');
    const reserved = await this.attempts.reserve({
      cancelledInitialContinuation,
      workItemId: execution.workItemId,
      taskType,
      actorUserId: 'service:openclaw-main',
      tenantId,
      documentVersionId: execution.source.documentVersionId,
      inputRevision: execution.revision,
      baseRevision: execution.revision,
      idempotencyKey,
      sourceRefs: [
        jobAidSourceFileReference(execution),
      ],
      allowedConnectors:
        authorizedKnowledgeSession || loaded.row.initialAilySessionId
          ? ['feishu-aily-user']
          : [],
      initialKnowledgeSession: {
        expectedSessionId: loaded.row.initialAilySessionId ?? null,
        ...(authorizedKnowledgeSession
          ? { replacement: authorizedKnowledgeSession }
          : {}),
      },
      buildModelInput: async () =>
        buildInitialAnalysisRequestInput({ taskType, requestId, originalParseRunId: original.parseRunId }),
    });
    return {
      attemptRef: reserved.task.operationRef,
      status: reserved.row.status,
      created: reserved.created,
      workItemRevision: reserved.task.baseRevision,
    };
  }

  private async prepareContinuationWorkItem(
    requested: CanonicalWorkItemProjection,
    tenantId: string,
    purpose: 'INITIAL_PROBLEM_ASSESSMENT' | 'OVERALL_CONSISTENCY',
  ): Promise<CanonicalWorkItemProjection> {
    let authoritative = await this.registrar.getTenantScopedByWorkItemId({
      tenantId,
      workItemId: requested.workItemId,
    });
    if (
      authoritative.revision !== requested.revision ||
      authoritative.source.documentVersionId !==
        requested.source.documentVersionId
    )
      throw new Error('JOBAID_WORK_ITEM_BINDING_CHANGED');
    const marker = activeConfigurationEvidenceReevaluation(authoritative);
    if (!marker) return authoritative;
    if (
      marker.stages.applicability.status !== 'SUCCEEDED' ||
      !marker.stagedBundle.applicabilityInput ||
      !marker.stagedBundle.applicability
    )
      throw new Error(
        'CONFIGURATION_REEVALUATION_APPLICABILITY_STAGE_REQUIRED',
      );
    if (
      purpose === 'INITIAL_PROBLEM_ASSESSMENT' &&
      marker.stages.dynamic.status === 'SUCCEEDED'
    )
      throw new Error('CONFIGURATION_REEVALUATION_DYNAMIC_ALREADY_SUCCEEDED');
    if (
      purpose === 'OVERALL_CONSISTENCY' &&
      (marker.stages.dynamic.status !== 'SUCCEEDED' ||
        !marker.stagedBundle.baseRules)
    )
      throw new Error('CONFIGURATION_REEVALUATION_OVERALL_STAGE_REQUIRED');
    const stage =
      purpose === 'INITIAL_PROBLEM_ASSESSMENT' ? 'DYNAMIC' : 'OVERALL';
    const status =
      stage === 'DYNAMIC'
        ? marker.stages.dynamic.status
        : marker.stages.overall.status;
    if (['WAITING_INPUT', 'FAILED', 'CONFLICT'].includes(status)) {
      const retry = retryConfigurationEvidenceReevaluationStage({
        workItem: authoritative,
        stage,
      });
      authoritative = await this.registrar.compareAndSet({
        workItemId: authoritative.workItemId,
        expectedRevision: authoritative.revision,
        syncPrimaryAttempt: false,
        next: withoutRevision(retry),
      });
    }
    return configurationEvidenceShadow(authoritative);
  }

  async enqueueOverall(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    permissionSnapshotVersion: string,
    requestContext = false,
    nativeCaller?: {runtimeScope:CanonicalVerifiedServiceScope} |
      {browserActor:NonNullable<TdmsNativeTransactionInput['browserCaller']>['actor']},
  ) {
    const loaded = await this.workItems.loadTenantScopedProjection(
      workItem.workItemId,
      tenantId,
    );
    if (!loaded || loaded.row.documentVersionId !== workItem.source.documentVersionId)
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const reviewBinding = workItem.overallRegenerationRequest
      ? await this.reviewOverallRegenerationBinding(
        { workItem, tenantId, actorUserId: loaded.row.requestedByUserId, nativeCaller },
        requestContext,
      ) : undefined;
    const base = workItem.integratedAssessment?.baseRules;
    const nativeOverall = isJobAidProblemProjection(base) &&
      base.readingResult?.evidence.some(item => item.kind === 'TDMS_NATIVE_RECORD');
    // No browser-to-service impersonation: the existing queue stores only intent.
    // Full native preparation occurs inside reserveAndClaim with the real scope.
    const originalScope = {tenantId,actorUserId:loaded.row.requestedByUserId,
      workItemId:workItem.workItemId,documentVersionId:workItem.source.documentVersionId};
    const nativeOriginal = nativeOverall ? requestContext
      ? await this.work.publishedOriginalBindingForRequest(originalScope)
      : await this.work.publishedOriginalBinding(originalScope) : undefined;
    const nativeWork = nativeOverall && isJobAidProblemProjection(base)
      ? reviewBinding ?? {workRevisionRef:base.workRevisionRef,workRevision:base.workRevision} : undefined;
    const reserved = await this.attempts.reserve({
      workItemId: workItem.workItemId,
      taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
      actorUserId: 'service:openclaw-main',
      tenantId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey: problemIdempotencyKey(workItem, 'OVERALL_CONSISTENCY'),
      sourceRefs: [
        jobAidSourceFileReference(workItem),
      ],
      allowedConnectors: loaded.row.initialAilySessionId
        ? ['feishu-aily-user']
        : [],
      initialKnowledgeSession: {
        expectedSessionId: loaded.row.initialAilySessionId ?? null,
      },
      buildModelInput: (identity) => nativeWork && nativeOriginal
        ? Promise.resolve(buildInitialAnalysisRequestInput({
            taskType:'OPENCLAW_OVERALL_SYNTHESIS',requestId:`original-${workItem.revision}`,
            originalParseRunId:nativeOriginal.parseRunId,
            nativeOverallAdmission:{...nativeWork,
              ...(workItem.overallRegenerationRequest?.executionRevision===workItem.revision &&
                  workItem.overallRegenerationRequest.staleReason==='USER_REQUESTED_REGENERATION'
                ? {regenerationRequestId:workItem.overallRegenerationRequest.requestId} : {})},
          }))
        : this.buildInput(
          workItem,
          tenantId,
          loaded.row.requestedByUserId,
          permissionSnapshotVersion,
          'OVERALL_CONSISTENCY',
          identity.createdAt.toISOString(),
          [],
          undefined,
          undefined,
          undefined,
          requestContext,
        ),
    });
    return {
      attemptRef: reserved.task.operationRef,
      created: reserved.created,
    };
  }

  private async buildInput(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    actorUserId: string,
    permissionSnapshotVersion: string,
    purpose: JobAidProblemModelInput['purpose'],
    asOf: string,
    extraEvidence: AssessmentEvidence[] = [],
    reviewSelection?: {
      reviewConversationId: string;
      beforeTurnNo: number;
      includedDiscussionTurnIds: string[];
    },
    originalParseRunId?: string,
    successorWork?: JobAidWorkRevision,
    requestContext = false,
    nativeAdmission?: {scope:CanonicalVerifiedServiceScope;taskContextRef:string},
    reviewCaller?: TdmsReviewCaller,
  ): Promise<JobAidProblemTaskInput> {
    const readScope = new UnifiedArtifactReadScope(this.artifactStore);
    if (!this.originalReader) throw new Error('DOCUMENT_ORIGINAL_READER_UNAVAILABLE');
    if (!this.semantics) throw new Error('DOCUMENT_SEMANTIC_READER_UNAVAILABLE');
    await this.sourceBindings(
      [],
      workItem,
      tenantId,
      actorUserId,
      requestContext,
      reviewCaller ? {reviewCaller} : undefined,
    );
    const originalScope = {
      tenantId,
      actorUserId,
      workItemId: workItem.workItemId,
      documentVersionId: workItem.source.documentVersionId,
    };
    const bound = originalParseRunId
      ? { parseRunId: originalParseRunId }
      : requestContext
        ? await this.work.publishedOriginalBindingForRequest(originalScope)
        : await this.work.publishedOriginalBinding(originalScope);
    const readInContext = <T>(read: () => Promise<T>) =>
      requestContext ? read() : this.work.withActorScope(actorUserId, read);
    const original = await readInContext(() =>
      this.originalReader!.readDocumentOriginal(
        workItem.source.documentVersionId,
        bound.parseRunId,
        { tenantId, actorUserId, roles: [] },
      ),
    );
    const semanticMap = await readInContext(() =>
      this.semantics!.read(
        {
          tenantId,
          actorUserId,
          documentVersionId: workItem.source.documentVersionId,
          roles: [],
        },
        original,
      ),
    );
    if (original.original.binding.sourceArtifactId !== workItem.source.sourceArtifactId ||
      original.original.binding.sourceSha256 !== canonicalHostBareSha256(workItem.source.sourceFileSha256) ||
      original.original.binding.sourceByteLength !== workItem.source.sourceByteLength)
      throw new Error('JOBAID_ORIGINAL_FILE_BINDING_MISMATCH');
    const assessmentWorkItem = workItem.applicability?.schemaVersion==='wiselink.3_1.applicability_candidate_projection.v3' &&
      !originalApplicabilityResultMatches(workItem,original.original.binding) ? {...workItem,applicability:null} : workItem;
    const primaryByRef = new Map<string, AssessmentEvidence>();
    const readOriginal = prepareDocumentOriginalEngineeringReader(original);
    for (let offset=0; offset<original.structuredSource.units.length; offset+=20)
      for (const evidence of readOriginal(offset,20).evidence)
        primaryByRef.set(evidence.evidenceRef,{...evidence,workItemId:workItem.workItemId});
    if (!primaryByRef.size) throw new Error('DOCUMENT_ORIGINAL_NO_READABLE_EVIDENCE');
    const originalUnits = original.structuredSource.units.map(unit => ({unitId:unit.unitId,kind:unit.kind,
      text:JSON.stringify(unit.payload),sourceRefIds:[...unit.sourceRefIds],
      sourceLocators:original.structuredSource.sourceLocators.filter(locator => unit.sourceRefIds.includes(locator.sourceRefId))}));
    const [common, history] = await Promise.all([
      this.common.buildForWorkItemWithEvidence(
        assessmentWorkItem,
        tenantId,
        asOf,
        readScope,
        reviewSelection,
        originalUnits,
      ),
      requestContext
        ? this.withInputDatabase(actorUserId, true, (database) =>
            database
              .select({
                workRevisionRef:
                  assessmentWorkRevision.assessmentWorkRevisionId,
                workRevision: assessmentWorkRevision.workRevision,
              })
              .from(assessmentWorkRevision)
              .where(
                and(
                  eq(assessmentWorkRevision.tenantId, tenantId),
                  eq(assessmentWorkRevision.workItemId, workItem.workItemId),
                ),
              )
              .orderBy(desc(assessmentWorkRevision.workRevision)),
          )
        : this.work.listHeadersForRuntime({
            tenantId,
            workItemId: workItem.workItemId,
            actorUserId,
          }),
    ]);
    const primary = [...primaryByRef.values()];
    const sourceCatalog = [
      ...primary,
      ...common.availableReadingEvidence,
      ...extraEvidence,
    ];
    const base = workItem.integratedAssessment?.baseRules;
    if (purpose === 'OVERALL_CONSISTENCY' && !isJobAidProblemProjection(base))
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    const previousWorkRef = (reviewCaller && tdmsReviewBinding(reviewCaller).workRevisionRef) || successorWork?.workRevisionRef || (
      purpose === 'OVERALL_CONSISTENCY' && isJobAidProblemProjection(base)
        ? base.workRevisionRef
        : history[0]?.workRevisionRef);
    let previousWork = previousWorkRef
      ? requestContext
        ? await this.work.readByRef({
            tenantId,
            workItemId: workItem.workItemId,
            workRevisionRef: previousWorkRef,
          })
        : await this.work.readByRefForRuntime({
            tenantId,
            workItemId: workItem.workItemId,
            actorUserId,
            workRevisionRef: previousWorkRef,
          })
      : null;
    if (previousWorkRef && !previousWork)
      throw new Error(
        purpose === 'OVERALL_CONSISTENCY'
          ? 'JOBAID_OVERALL_EXACT_WORK_REQUIRED'
          : 'JOBAID_PREVIOUS_WORK_NOT_FOUND',
      );
    if (purpose === 'OVERALL_CONSISTENCY') {
      if (!isJobAidProblemProjection(base))
        throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
      const seedRef = successorWork?.workRevisionRef ?? base.workRevisionRef;
      const seedRevision = successorWork?.workRevision ?? base.workRevision;
      if (!previousWork || previousWork.workRevisionRef !== seedRef ||
        previousWork.workRevision !== seedRevision ||
        previousWork.documentVersionId !== workItem.source.documentVersionId ||
        previousWork.content.roundCompletion === 'IN_PROGRESS')
        throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
      if (previousWork.workRevisionRef !== history[0]?.workRevisionRef) {
        if (successorWork)
          throw new Error('JOBAID_SUCCESSOR_OVERALL_WORK_CHANGED');
        const baseWork = previousWork;
        const latest = requestContext
          ? null
          : await this.work.readByRefForRuntime({
              tenantId, actorUserId, workItemId: workItem.workItemId,
              workRevisionRef: history[0]!.workRevisionRef,
            });
        const latestAttempt = latest && !workItem.overallRegenerationRequest
          ? await this.attempts.readScopedById({
              attemptId: latest.actionAttemptId, tenantId,
              workItemId: workItem.workItemId,
            })
          : null;
        if (latestAttempt?.actionType === 'OPENCLAW_OVERALL_SYNTHESIS' &&
          canRecoverSavedOverallWork(latestAttempt)) {
          // A Host-terminal Overall retains its continuous, source-bound save chain.
          // A Host Review marker never enters this recovery branch.
          previousWork = await this.recoverSavedOverallWork({
            workItem, tenantId, actorUserId, baseWork,
            latestWorkRevisionRef: history[0]?.workRevisionRef,
          });
        } else {
          // New Review work is admitted only through the exact durable receipt.
          previousWork = await this.exactReviewWorkForOverall({
            workItem, tenantId, actorUserId, requestContext,
            workRevisionRef: history[0]?.workRevisionRef,
            workRevision: history[0]?.workRevision,
          });
        }
      }
      if (!previousWork ||
        previousWork.workRevisionRef !== history[0]?.workRevisionRef ||
        previousWork.workRevision !== history[0]?.workRevision ||
        previousWork.documentVersionId !== workItem.source.documentVersionId ||
        previousWork.content.roundCompletion === 'IN_PROGRESS')
        throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    }
    // New source reuse never starts an Activity. Historical references stay exact.
    let sourceActivityProjections: DocumentActivityAssessmentProjection[] | undefined;
    let sourceStatementAvailability: JobAidProblemModelInput['sourceStatementAvailability'];
    if (this.activityRuns && (purpose !== 'PROBLEM_REVIEW' || (previousWork?.content.evidence??[]).some(e=>e.kind==='PRIOR_RESULT'&&e.sourceStatement))) {
      sourceActivityProjections = [];
      if (purpose === 'INITIAL_PROBLEM_ASSESSMENT' && semanticMap) {
        const saved = await readInContext(() => this.activityRuns!.readLatestSavedForBinding(originalScope,
          original.original.binding, semanticMap.semanticRevision));
        const projected = projectSavedDocumentActivityForAssessment({savedRevision:saved, original:original.original,
          semanticMap, originalEvidence:primary.map(e=>({...e,workItemId:null}))});
        sourceActivityProjections.push(projected);
        sourceStatementAvailability={status:projected.availability,semanticFieldsAvailability:projected.activityContexts.some(c=>c.sourceContext!==undefined)?'CAPTURED_FIELDS_ONLY':'LEGACY_PARTIAL',limitations:projected.limitations};
      } else sourceStatementAvailability={status:semanticMap?'NOT_SAVED':'NOT_INDEXED',semanticFieldsAvailability:'LEGACY_PARTIAL',
        limitations:['该准确来源未选取已保存声明；可继续读取原文。']};
      const historical=await readInContext(()=>this.readSourceStatementProjections(previousWork?.content.evidence??[],{tenantId,actorUserId}));
      for(const p of historical) {
        const existing=sourceActivityProjections.find(x=>x.activityContexts[0]?.runRef===p.activityContexts[0]?.runRef &&
          x.activityContexts[0]?.candidateRevision===p.activityContexts[0]?.candidateRevision);
        if(!existing) sourceActivityProjections.push(p);
      }
      const historicalBindingDiffers=sourceActivityProjections.some(p=>p.records.length && (p.sourceBinding.original.parseRunId!==original.original.binding.parseRunId || p.sourceBinding.semanticRevision!==semanticMap?.semanticRevision));
      if(historicalBindingDiffers) sourceStatementAvailability!.limitations.push('固定来源声明保留其历史解析及语义组织修订；不得用当前SemanticMap替换其声明作用域。');
      if (sourceActivityProjections.some(p=>p.records.length)) sourceStatementAvailability={status:'AVAILABLE',semanticFieldsAvailability:sourceActivityProjections.some(p=>p.activityContexts.some(c=>c.sourceContext!==undefined))?'CAPTURED_FIELDS_ONLY':'LEGACY_PARTIAL',
        limitations:[...new Set([...sourceActivityProjections.flatMap(p=>p.limitations),...(sourceStatementAvailability?.status==='AVAILABLE'?[]:sourceStatementAvailability?.limitations??[])])]};
      sourceCatalog.push(...sourceActivityProjections.flatMap(p=>p.records.map(sourceStatementEvidence)));
    }
    let tdmsContext: TdmsRuntimeTaskContext | undefined;
    const reviewPreparation=reviewCaller && tdmsReviewBinding(reviewCaller).attempt?.phase==='PREPARATION'
      ? tdmsReviewBinding(reviewCaller) : undefined;
    const runtimePrincipal = reviewPreparation ? {scope:reviewPreparation.scope,actorUserId,reviewCaller} :
      nativeAdmission ? this.runtimePrincipal(nativeAdmission.scope,actorUserId) : undefined;
    const taskContextRef=reviewPreparation?.attempt?.attemptRef ?? nativeAdmission?.taskContextRef;
    if (runtimePrincipal && taskContextRef && this.tdmsReader) {
      tdmsContext = (await this.tdmsReader.discover(runtimePrincipal,
        {tenantId,workItemId:workItem.workItemId,documentVersionId:workItem.source.documentVersionId,
          actorUserId,taskContextRef})) ?? undefined;
      if (tdmsContext) await this.tdmsReader.assertAuthorized(runtimePrincipal,tdmsContext);
    }
    // Authorize the complete new input inside buildModelInput, before the
    // lifecycle persists or claims an attempt. begin also rechecks replays.
    const sourceBindings = await this.sourceBindings(
      [...sourceCatalog, ...(previousWork?.content.evidence ?? [])],
      workItem,
      tenantId,
      actorUserId,
      requestContext,
      reviewCaller ? {reviewCaller} : tdmsContext && nativeAdmission ? this.nativeTransactionCaller(
        nativeAdmission.scope,actorUserId,tdmsContext,'ADMISSION') : undefined,
    );
    const taskInput = buildJobAidProblemTask({
      workItem: assessmentWorkItem,
      actorUserId,
      permissionSnapshotVersion: permissionSnapshotVersion,
      purpose,
      ...(nativeAdmission?.scope.automaticWorkItemLease ? {automaticWorkItemLease: {
        requestId: nativeAdmission.scope.automaticWorkItemLease.requestId,
        leaseGeneration: nativeAdmission.scope.automaticWorkItemLease.leaseGeneration,
      }} : {}),
      sourceCatalog,
      ...(tdmsContext && !reviewCaller ? {tdmsContext} : {}),
      ...(reviewCaller ? {tdmsReviewContext:this.reviewSavedContext(reviewCaller,tdmsContext)} : {}),
      ...(sourceActivityProjections ? {sourceActivityProjections,sourceStatementAvailability} : {}),
      originalParseRunId: original.original.binding.parseRunId,
      sourceBindings,
      common: common.common,
      previousWork,
      expectedWorkRevision: history[0]?.workRevision ?? 0,
      priorAssessmentRefs: history.map((revision) => revision.workRevisionRef),
    });
    taskInput.modelInput.documentOverview.original = { binding: original.original.binding, semanticMap,
      coverage: original.original.coverage, findings: original.structuredSource.findings };
    const preparationScope: JobAidPreparationScope | undefined = purpose === 'PROBLEM_REVIEW'
      ? {...reviewSelection,selectedContributionRefs:extraEvidence.flatMap(item => item.kind === 'ENGINEER_STATEMENT' && item.dialogueSource
          ? [item.dialogueSource.contributionRef] : [])} : undefined;
    if (preparationScope) taskInput.preparationScope = structuredClone(preparationScope);
    const preparationFacts = await readInContext(() => this.readPreparationFacts({
      workItem,tenantId,actorUserId,purpose,selection:preparationScope,
      ...(requestContext ? {browserRead:true} : {}),
    }));
    taskInput.modelInput.preparation = buildJobAidPreparationView({
      taskPurpose:purpose,taskInputRevision:workItem.revision,current:workItem,
      documentVersionId:workItem.source.documentVersionId,originalBinding:original.original.binding,
      latestWork:previousWork,facts:preparationFacts,
    });
    if (purpose !== 'PROBLEM_REVIEW') {
      const loaded = await this.workItems.loadTenantScopedProjection(
        workItem.workItemId,
        tenantId,
      );
      const knowledge = await this.knowledge?.binding(
        { tenantId, actorId: actorUserId, workItemId: workItem.workItemId },
        loaded?.row.initialAilySessionId,
      );
      taskInput.knowledgeBinding = knowledge?.binding;
      taskInput.modelInput.knowledgeAccess = knowledge?.access ?? {
        available: false,
        reason: 'NOT_CONFIGURED',
      };
      const knowledgeCapability = taskInput.modelInput.capabilities.find(
        (item) => item.capability === 'knowledge_retrieval',
      );
      if (knowledgeCapability) {
        knowledgeCapability.status = knowledge?.binding
          ? 'AVAILABLE'
          : knowledge?.access.reason === 'USER_REAUTHORIZATION_REQUIRED'
            ? 'ACCESS_DENIED'
            : 'NOT_CONNECTED';
        knowledgeCapability.impact = knowledge?.binding
          ? '本轮准备时可按需检索；不代表已取得检索结果或核实原文，实际调用仍需有效授权。'
          : knowledge?.access.reason === 'USER_REAUTHORIZATION_REQUIRED'
            ? '本轮准备时缺少有效知识检索授权；可继续分析已授权正文，未取得资料保持线索。'
            : '本轮未接通知识检索；可继续分析已授权正文，未取得资料保持线索。';
      }
      if (taskInput.modelInput.contextPackage)
        taskInput.modelInput.contextPackage.knowledgeRetrieval = {
          status: knowledge?.binding ? 'NOT_REQUESTED' : 'UNAVAILABLE',
          reason:
            knowledge?.access.reason ??
            (knowledge?.binding ? undefined : 'NOT_CONFIGURED'),
          fragments: [],
        };
    }
    if (purpose === 'INITIAL_PROBLEM_ASSESSMENT' && previousWork?.content.roundCompletion === 'COMPLETE' &&
        previousWork.basedOnWorkItemRevision === workItem.revision &&
        !isJobAidProblemProjection(workItem.integratedAssessment?.baseRules)) {
      const source = await this.attempts.readScopedById({attemptId:previousWork.actionAttemptId,tenantId,workItemId:workItem.workItemId});
      const prior = source.taskEnvelopeJson ? parseJobAidProblemTask(parseTaskEnvelope(source.taskEnvelopeJson)) : null;
      if (source.actionType === 'OPENCLAW_DYNAMIC_EVALUATION' && source.status !== 'CANCELLED' &&
          source.baseRevision === workItem.revision && source.inputRevision === workItem.revision && prior &&
          source.documentVersionId === workItem.source.documentVersionId &&
          canonicalJson(prior.sourceBindings) === canonicalJson(taskInput.sourceBindings) &&
          canonicalJson(prior.modelInput.documentOverview.original?.binding) === canonicalJson(taskInput.modelInput.documentOverview.original?.binding)) {
        taskInput.savedWorkReconciliation = {executionKind:'HOST_SAVED_WORK_RECONCILIATION',modelRequests:0,
          workRevisionRef:previousWork.workRevisionRef,workRevision:previousWork.workRevision,
          sourceActionAttemptId:previousWork.actionAttemptId};
      }
    }
    if (tdmsContext && runtimePrincipal) await this.tdmsReader!.assertAuthorized(runtimePrincipal,tdmsContext);
    return taskInput;
  }

  private async recoverSavedOverallWork(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    actorUserId: string;
    baseWork: JobAidWorkRevision;
    latestWorkRevisionRef: string | undefined;
  }): Promise<JobAidWorkRevision> {
    const invalid = () => new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    if (!input.latestWorkRevisionRef) throw invalid();
    const chain = new Map<string, JobAidWorkRevision>();
    const attemptIds = new Set<string>();
    let cursor: string | null = input.latestWorkRevisionRef;
    let expectedRevision: number | null = null;
    while (cursor !== input.baseWork.workRevisionRef) {
      if (!cursor || chain.has(cursor) || chain.size >= 64) throw invalid();
      const revision = await this.work.readByRefForRuntime({
        tenantId: input.tenantId,
        workItemId: input.workItem.workItemId,
        actorUserId: input.actorUserId,
        workRevisionRef: cursor,
      });
      if (!revision || revision.workRevisionRef !== cursor ||
        revision.workItemId !== input.workItem.workItemId ||
        revision.documentVersionId !== input.workItem.source.documentVersionId ||
        revision.basedOnWorkItemRevision !== input.workItem.revision ||
        revision.workRevision <= input.baseWork.workRevision ||
        (expectedRevision !== null && revision.workRevision !== expectedRevision))
        throw invalid();
      chain.set(cursor, revision);
      attemptIds.add(revision.actionAttemptId);
      expectedRevision = revision.workRevision - 1;
      cursor = revision.previousWorkRevisionRef;
    }
    if (expectedRevision !== input.baseWork.workRevision) throw invalid();
    const allowedPriorRefs = new Set([...chain.keys(), input.baseWork.workRevisionRef]);
    for (const attemptId of attemptIds) {
      const row = await this.attempts.readScopedById({
        attemptId, tenantId: input.tenantId, workItemId: input.workItem.workItemId,
      }).catch(() => null);
      if (!row || !canRecoverSavedOverallWork(row) ||
        row.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS' ||
        row.documentVersionId !== input.workItem.source.documentVersionId ||
        row.baseRevision !== input.workItem.revision || !row.taskEnvelopeJson)
        throw invalid();
      let prior: JobAidProblemTaskInput;
      try { prior = parseJobAidProblemTask(parseTaskEnvelope(row.taskEnvelopeJson)); }
      catch { throw invalid(); }
      if (prior.modelInput.purpose !== 'OVERALL_CONSISTENCY' ||
        !prior.previousWork || !allowedPriorRefs.has(prior.previousWork.workRevisionRef))
        throw invalid();
    }
    const latest = chain.get(input.latestWorkRevisionRef);
    if (!latest || latest.content.roundCompletion === 'IN_PROGRESS') throw invalid();
    return latest;
  }

  async readCurrentWorkForRuntime(input: {
    workItemId: string;
    tenantId: string;
    actorUserId: string;
  }): Promise<JobAidWorkRevision | null> {
    const current = await this.work.latestForRuntime(input);
    if (current)
      await this.work.withActorTransaction(input.actorUserId, (database) =>
        this.assertEvidenceOwned(
          current.content.evidence,
          input.tenantId,
          input.actorUserId,
          input.workItemId,
          database,
        ),
      );
    return current;
  }

  /** Aggregate consumers reuse the exact saved work and its existing source checks.
   * The caller owns the authenticated/Hosted transaction; never borrow another connection. */
  async readSummaryMemberInTransaction(input: {
    tenantId: string; actorUserId: string; workItemId: string; workRef: string;
    readScope?: 'TENANT';
  }, database: PostgresJsDatabase, assertNative?: (evidence: AssessmentEvidence[]) => Promise<void>) {
    const revision = await this.work.readByRef({ tenantId: input.tenantId,
      workItemId: input.workItemId, workRevisionRef: input.workRef }, database);
    if (!revision) throw new Error('JOBAID_WORK_NOT_FOUND');
    await (input.readScope === 'TENANT' ? this.assertEvidenceReadable(revision.content.evidence, input.tenantId,
      input.actorUserId, input.workItemId, database, assertNative) : this.assertEvidenceOwned(revision.content.evidence, input.tenantId,
      input.actorUserId, input.workItemId, database, assertNative));
    const [row] = await database.select({ projectionJson: workItemTable.projectionJson }).from(workItemTable)
      .where(and(eq(workItemTable.tenantId, input.tenantId), eq(workItemTable.workItemId, input.workItemId),
        input.readScope === 'TENANT' ? undefined : eq(workItemTable.requestedByUserId, input.actorUserId))).limit(1);
    if (!row?.projectionJson) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    const projection = JSON.parse(row.projectionJson) as CanonicalWorkItemProjection;
    if (projection.source.documentVersionId !== revision.documentVersionId)
      throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    const latest = await this.work.latest({ tenantId: input.tenantId, workItemId: input.workItemId }, database);
    return { revision, current: latest?.workRevisionRef === revision.workRevisionRef };
  }

  async admitReviewSources(ingress: TdmsReviewIngress): Promise<TdmsReviewCaller | undefined> {
    if (!this.nativeVerifier?.admitReview) {
      if (!this.database) throw new Error('TDMS_REVIEW_ADMISSION_NOT_CONNECTED');
      const [saved] = await this.database.execute<{native:boolean;marker:boolean}>(sql`SELECT EXISTS (
        SELECT 1 FROM assessment_work_revision WHERE tenant_id=${ingress.scope.tenantId}
          AND work_item_id=${ingress.scope.workItemId} AND content_json::jsonb->'evidence' @>
            '[{"kind":"TDMS_NATIVE_RECORD"}]'::jsonb) AS native, EXISTS (
        SELECT 1 FROM work_item w JOIN dm_document_version v ON v.document_version_id=w.document_version_id
        JOIN dm_acquisition a ON a.document_version_id=v.document_version_id OR a.acquisition_id=v.acquisition_id
        WHERE w.tenant_id=${ingress.scope.tenantId} AND w.work_item_id=${ingress.scope.workItemId}
          AND jsonb_exists(a.source_descriptor_json::jsonb, 'tdmsRegistration')) AS marker`);
      if (saved?.native||saved?.marker) throw new Error('TDMS_REVIEW_ADMISSION_NOT_CONNECTED');
      return undefined;
    }
    return (await this.nativeVerifier.admitReview(ingress)) ?? undefined;
  }

  private reviewSavedContext(caller: TdmsReviewCaller, runtimeContext?: TdmsRuntimeTaskContext): TdmsReviewContext {
    const value = tdmsReviewBinding(caller);
    const base={reviewConversationRef:value.reviewConversationRef,reviewTurnRef:value.reviewTurnRef,
      requestId:value.requestId,inputRevision:value.inputRevision,workRevisionRef:value.workRevisionRef,
      workRevision:value.workRevision};
    if(runtimeContext) {
      if(!value.attempt || canonicalJson(runtimeContext.binding)!==canonicalJson({tenantId:value.tenantId,
        actorUserId:value.actorUserId,workItemId:value.workItemId,documentVersionId:value.documentVersionId,
        taskContextRef:value.attempt.attemptRef})) throw new Error('TDMS_REVIEW_CALLER_BINDING_MISMATCH');
      return {schemaVersion:'wiselink.tdms-review-runtime-context.v1',mode:'BOUNDED_NATIVE_READ',...base,
        savedEvidenceRefs:value.nativeMetadata.map(item=>item.evidenceRef),runtimeContext};
    }
    if(!value.nativeMetadata.length) throw new Error('TDMS_REVIEW_PREPARATION_NOT_CONNECTED');
    return {schemaVersion:'wiselink.tdms-review-saved-context.v1',mode:'SAVED_EVIDENCE_ONLY',
      reviewConversationRef:value.reviewConversationRef,reviewTurnRef:value.reviewTurnRef,
      requestId:value.requestId,inputRevision:value.inputRevision,workRevisionRef:value.workRevisionRef,
      workRevision:value.workRevision,evidenceRefs:value.nativeMetadata.map(item=>item.evidenceRef)};
  }

  private assertReviewCaller(task: JobAidProblemTaskInput, caller?: TdmsReviewCaller): void {
    if (task.tdmsReviewContext) {
      if (!caller || canonicalJson(task.tdmsReviewContext)!==canonicalJson(this.reviewSavedContext(caller,
          task.tdmsReviewContext.mode==='BOUNDED_NATIVE_READ' ? task.tdmsReviewContext.runtimeContext : undefined)) ||
        task.actorUserId!==tdmsReviewBinding(caller).actorUserId) throw new Error('TDMS_REVIEW_CALLER_BINDING_MISMATCH');
    } else if (caller || task.sourceCatalog.some(item=>item.kind==='TDMS_NATIVE_RECORD'))
      throw new Error('TDMS_REVIEW_CALLER_BINDING_MISMATCH');
  }

  async assertReviewNativeInTransaction(task: JobAidProblemTaskInput, caller: TdmsReviewCaller | undefined,
    tenantId: string, database: PostgresJsDatabase, evidence:AssessmentEvidence[]=task.sourceCatalog): Promise<void> {
    this.assertReviewCaller(task,caller);
    if (caller) await assertTdmsNativeInTransaction({actor:{tenantId,actorUserId:task.actorUserId},
      reviewCaller:caller,evidence,database},this.nativeVerifier);
  }

  /** The original receipt changes recovery into saved verification. Re-mint
   * on the held connection; never mutate or normalize the old capability. */
  async reviewCallerAfterPersistence(caller:TdmsReviewCaller|undefined,database:PostgresJsDatabase):Promise<TdmsReviewCaller|undefined> {
    if(!caller) return caller;
    const before=tdmsReviewBinding(caller);
    if(before.attempt?.phase!=='SEALED_RECOVERY') return caller;
    if(before.kind!=='REVIEW'||!this.nativeVerifier?.admitReviewInTransaction)
      throw new Error('TDMS_REVIEW_ADMISSION_NOT_CONNECTED');
    const fresh=await this.nativeVerifier.admitReviewInTransaction({database,ingress:{scope:before.scope,
      reviewConversationRef:before.reviewConversationRef,requestId:before.requestId,attemptRef:before.attempt.attemptRef}});
    if(!fresh) throw new Error('TDMS_REVIEW_ADMISSION_NOT_CONNECTED');
    const after=tdmsReviewBinding(fresh);
    if(after.attempt?.phase!=='SAVED_VERIFICATION' || canonicalJson({...after,
      attempt:{...after.attempt,phase:'SEALED_RECOVERY'}})!==canonicalJson(before))
      throw new Error('TDMS_REVIEW_CALLER_BINDING_MISMATCH');
    return fresh;
  }

  async readReviewNativeSources(input: {row:ActionAttemptRow;task:JobAidProblemTaskInput;
    scope:CanonicalVerifiedServiceScope;reviewCaller?:TdmsReviewCaller;leaseToken:string;leaseGeneration:number;
    sourceRefs:string[];purpose:string;context:'EXACT'}) {
    const {row,task,scope,reviewCaller}=input;
    this.assertReviewCaller(task,reviewCaller);
    if(!reviewCaller||task.tdmsReviewContext?.mode!=='BOUNDED_NATIVE_READ'||!this.tdmsReader?.readReviewAndJournal ||
        row.status!=='RUNNING'||input.context!=='EXACT'||typeof input.purpose!=='string'||
        !input.purpose.trim()||input.purpose.length>2000||!Array.isArray(input.sourceRefs)||
        !input.sourceRefs.length||input.sourceRefs.length>96||new Set(input.sourceRefs).size!==input.sourceRefs.length)
      throw new Error('REVIEW_NATIVE_READ_INVALID');
    const context=task.tdmsReviewContext.runtimeContext;
    const directory=new Set(tdmsJobAidDirectory(context,task.sourceCatalog).map(item=>item.ref));
    if(input.sourceRefs.some(ref=>!directory.has(ref))) throw new Error('REVIEW_NATIVE_SOURCE_REF_NOT_ALLOWED');
    const fence={principalId:scope.principalId,leaseToken:input.leaseToken,leaseGeneration:input.leaseGeneration,
      automaticLeaseRequired:false};
    assertJobAidWorkFence(row,fence);
    const principal={scope,actorUserId:task.actorUserId,reviewCaller};
    const read=await this.tdmsReader.readReviewAndJournal(principal,{context,evidenceRefs:input.sourceRefs,
      purpose:'JOB_AID_NATIVE_RECORD',taskContextRef:row.operationRef},async(result,assertReadAuthorized)=>{
      const actual=result.evidence.map(parseAssessmentTdmsEvidence);
      if(actual.length!==input.sourceRefs.length||new Set(actual.map(item=>item.evidenceRef)).size!==actual.length||
          input.sourceRefs.some(ref=>!actual.some(item=>item.evidenceRef===ref))||
          actual.some(item=>item.nativeReadReceipt.taskContextRef!==row.operationRef)||
          canonicalJson(actual.map(item=>item.nativeReadReceipt))!==canonicalJson(result.receipts))
        throw new Error('JOBAID_TDMS_READ_BINDING_INVALID');
      await this.work.recordSourceRead({row,actorUserId:task.actorUserId,fence,sourceBindings:task.sourceBindings,
        sourceRefs:input.sourceRefs,purpose:input.purpose,nativeEvidence:actual,assertNativeAuthorized:assertReadAuthorized});
    });
    await this.assertReviewSources(task,row.tenantId,row.workItemId,reviewCaller);
    return {schemaVersion:task.sourceActivityProjections?'wiselink.jobaid-source-read.v3':'wiselink.jobaid-source-read.v2',
      ...(task.sourceActivityProjections?{sourceStatements:[],activityContexts:[]}:{}),status:'AVAILABLE',
      sourceRefs:read.evidence.map(item=>item.evidenceRef),
      evidence:read.evidence.map(item=>structuredClone(parseAssessmentTdmsEvidence(item))),
      nativeReadReceipts:read.receipts,scope:'EXACT',completeRequestedScope:true};
  }

  reviewDecision(task:JobAidProblemTaskInput,activity:string|null|undefined) {
    const reads=resolvedTdmsReadEvidence(activity),carriers=resolvedTdmsReadCarriers(activity);
    return {catalog:mergeTdmsReadEvidence(task.sourceCatalog,reads),
      evidence:[...task.sourceCatalog,...carriers],sourceRefs:resolvedAssessmentSources(activity)};
  }

  async prepareReview(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    actorUserId: string;
    asOf: string;
    evidence: AssessmentEvidence[];
    reviewCaller?: TdmsReviewCaller;
    reviewSelection?: {
      reviewConversationId: string;
      beforeTurnNo: number;
      includedDiscussionTurnIds: string[];
    };
  }): Promise<JobAidProblemTaskInput> {
    return this.buildInput(
      input.workItem,
      input.tenantId,
      input.actorUserId,
      'review-owner-context',
      'PROBLEM_REVIEW',
      input.asOf,
      input.evidence,
      input.reviewSelection,
      undefined, undefined, false, undefined, input.reviewCaller,
    );
  }

  async assertReviewSources(
    input: JobAidProblemTaskInput,
    tenantId: string,
    workItemId: string,
    reviewCaller?: TdmsReviewCaller,
  ): Promise<void> {
    this.assertReviewCaller(input, reviewCaller);
    await this.assertSourcesAuthorized(
      input.sourceCatalog,
      input,
      tenantId,
      workItemId,
      undefined, reviewCaller,
    );
  }

  prepareReviewWork(
    task: JobAidProblemTaskInput,
    workItemId: string,
    proposal: unknown,
    actualReadRefs: Set<string>,
    targetIssueKeys?: string[],
    decisionCatalog:AssessmentEvidence[]=task.sourceCatalog,
  ) {
    const content = materializeJobAidWork(proposal, {
      contentValidationVersion: task.contentValidationVersion,
      methodBinding: task.modelInput.methodBinding,
      workItemId,
      previous: task.previousWork?.content ?? null,
      evidence: decisionCatalog,
      readSourceRefs: [
        ...new Set([...task.initiallyDeliveredRefs, ...actualReadRefs]),
      ],
      currentDeliveredSourceRefs:[...new Set([...task.initiallyDeliveredRefs,...actualReadRefs])],
      capabilities: task.modelInput.capabilities,
      history: task.modelInput.historyReview,
    });
    assertJobAidIssueEditScope(
      task.previousWork?.content ?? null, content, targetIssueKeys,
    );
    return content;
  }

  async saveReviewWork(
    input: {
      row: ActionAttemptRow;
      task: JobAidProblemTaskInput;
      fence: JobAidWorkFence;
      requestId: string;
      proposal: unknown;
      actualReadRefs: Set<string>;
      targetIssueKeys?: string[];
      reviewCaller?: TdmsReviewCaller;
    },
    database: PostgresJsDatabase,
  ) {
    this.assertReviewCaller(input.task,input.reviewCaller);
    const decision=this.reviewDecision(input.task,input.row.reviewActivityJson);
    const assertNativeAuthorized = input.reviewCaller ? (evidence: AssessmentEvidence[]) =>
      assertTdmsNativeInTransaction({actor:{tenantId:input.row.tenantId,actorUserId:input.task.actorUserId},
        reviewCaller:input.reviewCaller,evidence:[...evidence,...decision.evidence],database},this.nativeVerifier) : undefined;
    await this.assertEvidenceOwned(decision.catalog,input.row.tenantId,input.task.actorUserId,input.row.workItemId,database,assertNativeAuthorized);
    await this.assertSourceStatementReferences(decision.catalog,{tenantId:input.row.tenantId,actorUserId:input.task.actorUserId},database);
    return this.work.save(
      {
        row: input.row,
        actorUserId: input.task.actorUserId,
        assertNativeAuthorized: input.reviewCaller ? (connection) => this.assertReviewNativeInTransaction(
          input.task,input.reviewCaller,input.row.tenantId,connection,decision.evidence) : undefined,
        fence: { ...input.fence, allowCommittingReview: true },
        reviewCaller:input.reviewCaller,
        sourceBindings: input.task.sourceBindings,
        requestId: input.requestId,
        expectedWorkRevision: input.task.modelInput.expectedWorkRevision,
        command: {
          expectedWorkRevision: input.task.modelInput.expectedWorkRevision,
          work: input.proposal,
        },
        content: this.prepareReviewWork(
          input.task,
          input.row.workItemId,
          input.proposal,
          input.actualReadRefs,
          input.targetIssueKeys,
          decision.catalog,
        ),
      },
      database,
    );
  }

  /** The Review caller keeps this check and its unchanged receipt in the same
   * actor transaction. Return stored work, never the task's frozen copy. */
  async assertReviewWorkUnchanged(
    input: { row: ActionAttemptRow; task: JobAidProblemTaskInput; fence: JobAidWorkFence; reviewCaller?: TdmsReviewCaller },
    database: PostgresJsDatabase,
  ): Promise<JobAidWorkRevision> {
    this.assertReviewCaller(input.task,input.reviewCaller);
    const decision=this.reviewDecision(input.task,input.row.reviewActivityJson);
    const assertNativeAuthorized = input.reviewCaller ? (evidence: AssessmentEvidence[]) =>
      assertTdmsNativeInTransaction({actor:{tenantId:input.row.tenantId,actorUserId:input.task.actorUserId},
        reviewCaller:input.reviewCaller,evidence:[...evidence,...decision.evidence],database},this.nativeVerifier) : undefined;
    const previous = input.task.previousWork;
    if (!previous || input.task.modelInput.purpose !== 'PROBLEM_REVIEW' ||
        input.task.actorUserId !== input.row.actorUserId ||
        previous.workItemId !== input.row.workItemId ||
        previous.documentVersionId !== input.row.documentVersionId ||
        previous.workRevision !== input.task.modelInput.expectedWorkRevision)
      throw new Error('JOBAID_REVIEW_UNCHANGED_BASIS_INVALID');
    await this.assertEvidenceOwned(decision.catalog, input.row.tenantId,
      input.task.actorUserId, input.row.workItemId, database, assertNativeAuthorized);
    await this.assertSourceStatementReferences(decision.catalog,
      { tenantId: input.row.tenantId, actorUserId: input.task.actorUserId }, database);
    const current = await this.work.assertReviewUnchanged({
      row: input.row, actorUserId: input.task.actorUserId,
      fence: { ...input.fence, allowCommittingReview: true },
      reviewCaller:input.reviewCaller,
      sourceBindings: input.task.sourceBindings,
      expectedWorkRevisionRef: previous.workRevisionRef,
      expectedWorkRevision: input.task.modelInput.expectedWorkRevision,
    }, database);
    if (assertNativeAuthorized) await assertNativeAuthorized(current.content.evidence);
    if (current.basedOnWorkItemRevision !== previous.basedOnWorkItemRevision)
      throw new Error('JOBAID_REVIEW_UNCHANGED_BASIS_INVALID');
    return current;
  }

  /** Called in the same short actor transaction as the work and Review receipt.
   * This changes candidate coverage, not the formal WorkItem revision or the
   * old base artifact's exact identity. No artifact I/O runs in this transaction. */
  async invalidateReviewOverall(
    row: ActionAttemptRow,
    revision: JobAidWorkRevision,
    actorUserId: string,
    database: PostgresJsDatabase,
  ): Promise<boolean> {
    const [owned] = await database
      .select({
        revision: workItemTable.revision,
        projectionJson: workItemTable.projectionJson,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.tenantId, row.tenantId),
          eq(workItemTable.workItemId, row.workItemId),
          eq(workItemTable.requestedByUserId, actorUserId),
        ),
      )
      .limit(1)
      .for('update');
    if (!owned?.projectionJson)
      throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    const current = JSON.parse(
      owned.projectionJson,
    ) as CanonicalWorkItemProjection;
    const latest = await this.work.latest(
      { tenantId: row.tenantId, workItemId: row.workItemId },
      database,
    );
    const overall = current.integratedAssessment?.overallSynthesis;
    if (
      !overall ||
      latest?.workRevisionRef !== revision.workRevisionRef ||
      overall.basedOnJobAidWorkRevisionRef === revision.workRevisionRef
    )
      return false;
    if (owned.revision !== row.baseRevision) return false;
    if (
      overall.status === 'STALE' &&
      overall.staleReason === 'BASE_RULE_RESULT_CHANGED' &&
      !current.aeo &&
      !current.integratedAssessment!.overallForAeoConfirmation
    )
      return true;
    const next: CanonicalWorkItemProjection = {
      ...current,
      aeo: null,
      integratedAssessment: {
        ...current.integratedAssessment!,
        status: 'OVERALL_CANDIDATE_STALE',
        overallSynthesis: {
          ...overall,
          status: 'STALE',
          staleReason: 'BASE_RULE_RESULT_CHANGED',
        },
        overallForAeoConfirmation: null,
      },
    };
    const updated = await database
      .update(workItemTable)
      .set({ projectionJson: JSON.stringify(next), updatedAt: new Date() })
      .where(
        and(
          eq(workItemTable.tenantId, row.tenantId),
          eq(workItemTable.workItemId, row.workItemId),
          eq(workItemTable.requestedByUserId, actorUserId),
          eq(workItemTable.revision, owned.revision),
          eq(workItemTable.projectionJson, owned.projectionJson),
        ),
      )
      .returning({ id: workItemTable.workItemId });
    if (updated.length !== 1)
      throw new Error('JOBAID_REVIEW_PROJECTION_CONFLICT');
    return true;
  }

  /** Browser request validation uses its authenticated SQL actor, never a
   * Hosted scope. Only the server chooses this branch, after fresh object access. */
  async reviewOverallRegenerationBinding(
    input: {
      workItem: CanonicalWorkItemProjection;
      tenantId: string;
      actorUserId: string;
      nativeCaller?: {runtimeScope:CanonicalVerifiedServiceScope} |
        {browserActor:NonNullable<TdmsNativeTransactionInput['browserCaller']>['actor']};
    },
    requestContext = true,
    stage: 'REQUEST' | 'EXECUTION' = 'EXECUTION',
  ): Promise<JobAidReviewOverallRegenerationBinding> {
    const base = input.workItem.integratedAssessment?.baseRules;
    if (!isJobAidProblemProjection(base))
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    const { latest, previous } = await this.withInputDatabase(
      input.actorUserId,
      requestContext,
      async (database) => ({
        latest: await this.work.latest(
          { tenantId: input.tenantId, workItemId: input.workItem.workItemId },
          database,
        ),
        previous: await this.work.readByRef(
          {
            tenantId: input.tenantId,
            workItemId: input.workItem.workItemId,
            workRevisionRef: base.workRevisionRef,
          },
          database,
        ),
      }),
    );
    if (
      !latest ||
      !previous ||
      previous.workRevisionRef !== base.workRevisionRef ||
      previous.workRevision !== base.workRevision ||
      previous.documentVersionId !== input.workItem.source.documentVersionId
    )
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    const marker = input.workItem.overallRegenerationRequest as
      JobAidReviewOverallRegenerationMarker | undefined;
    if (stage === 'EXECUTION' && marker &&
      marker.jobAidReviewWork === undefined &&
      latest.workRevisionRef === base.workRevisionRef &&
      latest.workRevision === base.workRevision &&
      latest.workItemId === input.workItem.workItemId &&
      latest.documentVersionId === input.workItem.source.documentVersionId &&
      latest.content.roundCompletion !== 'IN_PROGRESS') {
      // Ordinary regeneration retains the exact base work. Its complete Host
      // marker must still match the actor, formal revision, Overall and sources.
      this.reviewRegenerationBaseRevision(input.workItem, input.actorUserId,
        latest.workRevisionRef, latest.workRevision);
      await this.sourceBindings(latest.content.evidence, input.workItem,
        input.tenantId, input.actorUserId, requestContext,
        await this.savedReadNativeContext(input,latest));
      return { workRevisionRef: latest.workRevisionRef, workRevision: latest.workRevision };
    }
    if (latest.workRevisionRef === base.workRevisionRef)
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    const saved = await this.exactReviewWorkForOverall({
      ...input,
      requestContext,
      ...(stage === 'REQUEST'
        ? { requestedFromRevision: input.workItem.revision }
        : {}),
      workRevisionRef: latest.workRevisionRef,
      workRevision: latest.workRevision,
    });
    if (saved.content.roundCompletion === 'IN_PROGRESS')
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    await this.sourceBindings(
      saved.content.evidence,
      input.workItem,
      input.tenantId,
      input.actorUserId,
      requestContext,
    );
    return {
      workRevisionRef: saved.workRevisionRef,
      workRevision: saved.workRevision,
    };
  }

  private async withInputDatabase<T>(
    actorUserId: string,
    requestContext: boolean,
    read: (database: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> {
    if (!requestContext)
      return this.work.withActorTransaction(actorUserId, read);
    if (!this.database) throw new Error('JOBAID_REQUEST_DATABASE_UNAVAILABLE');
    return this.database.transaction(async (transaction) => {
      const database = transaction as PostgresJsDatabase;
      const [identity] = await database.execute<{ actorId: string }>(
        sql`SELECT current_setting('app.user_id',true) AS "actorId"`,
      );
      if (identity?.actorId !== actorUserId)
        throw new Error('JOBAID_REQUEST_ACTOR_CONTEXT_REQUIRED');
      return read(database);
    });
  }

  private reviewRegenerationBaseRevision(
    item: CanonicalWorkItemProjection,
    actorUserId: string,
    workRevisionRef: string,
    workRevision: number | undefined,
  ): number {
    const request = item.overallRegenerationRequest as
      | JobAidReviewOverallRegenerationMarker
      | undefined;
    if (!request) return item.revision;
    const overall = item.integratedAssessment?.overallSynthesis;
    const base = item.integratedAssessment?.baseRules;
    const source = request.sourceIdentity;
    const sameSha = (a: unknown, b: unknown) =>
      !!canonicalHostBareSha256(a) &&
      canonicalHostBareSha256(a) === canonicalHostBareSha256(b);
    if (
      request.schemaVersion !==
        'wiselink.3_1.overall_regeneration_request.v1' ||
      request.staleReason !== 'USER_REQUESTED_REGENERATION' ||
      request.requestedByUserId !== actorUserId ||
      request.executionRevision !== item.revision ||
      request.executionRevision !== request.requestedFromRevision + 1 ||
      (request.jobAidReviewWork === undefined
        ? !isJobAidProblemProjection(base) || base.workRevisionRef !== workRevisionRef ||
          base.workRevision !== workRevision
        : request.jobAidReviewWork?.workRevisionRef !== workRevisionRef ||
          request.jobAidReviewWork?.workRevision !== workRevision) ||
      item.integratedAssessment?.status !== 'OVERALL_CANDIDATE_STALE' ||
      overall?.status !== 'STALE' ||
      overall.staleReason !== null ||
      request.sourceOverall.revision !== overall.revision ||
      request.sourceOverall.actionAttemptId !== overall.actionAttemptId ||
      !sameSha(
        request.sourceOverall.artifactSha256,
        overall.artifact?.sha256,
      ) ||
      source.documentVersionId !== item.source.documentVersionId ||
      source.sourceArtifactId !== item.source.sourceArtifactId ||
      !sameSha(source.sourceFileSha256, item.source.sourceFileSha256) ||
      source.packageId !== item.package?.packageId ||
      !sameSha(source.packageArtifactSha256, item.package?.artifact.sha256)
    )
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    return request.requestedFromRevision;
  }

  private async exactReviewWorkForOverall(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    actorUserId: string;
    workRevisionRef: string | undefined;
    workRevision: number | undefined;
    requestContext?: boolean;
    requestedFromRevision?: number | readonly number[];
    database?: PostgresJsDatabase;
    reviewConversationId?: string;
    reviewTurnId?: string;
    requireSucceeded?: boolean;
  }): Promise<JobAidWorkRevision> {
    const fail = (): never => {
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    };
    if (!input.workRevisionRef) return fail();
    const saved = input.database
      ? await this.work.readByRef({
          tenantId: input.tenantId,
          workItemId: input.workItem.workItemId,
          workRevisionRef: input.workRevisionRef,
        }, input.database)
      : input.requestContext
      ? await this.work.readByRef({
          tenantId: input.tenantId,
          workItemId: input.workItem.workItemId,
          workRevisionRef: input.workRevisionRef,
        })
      : await this.work.readByRefForRuntime({
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          workItemId: input.workItem.workItemId,
          workRevisionRef: input.workRevisionRef,
        });
    const expectedBaseRevision =
      input.requestedFromRevision ??
      this.reviewRegenerationBaseRevision(
        input.workItem,
        input.actorUserId,
        input.workRevisionRef,
        input.workRevision,
      );
    if (
      !saved ||
      saved.workRevisionRef !== input.workRevisionRef ||
      saved.workRevision !== input.workRevision ||
      saved.workItemId !== input.workItem.workItemId ||
      saved.documentVersionId !== input.workItem.source.documentVersionId ||
      !(Array.isArray(expectedBaseRevision)
        ? expectedBaseRevision.includes(saved.basedOnWorkItemRevision)
        : saved.basedOnWorkItemRevision === expectedBaseRevision) ||
      !saved.requestId.startsWith('review-turn:')
    )
      return fail();
    const reviewTurnId = saved.requestId.slice('review-turn:'.length);
    if (input.reviewTurnId && input.reviewTurnId !== reviewTurnId) return fail();
    const verify = async (database: PostgresJsDatabase) => {
        const [turn] = await database
          .select({
            conversationId: reviewTurn.reviewConversationId,
            operationRef: actionAttempt.operationRef,
            resultContentHash: actionAttempt.resultContentHash,
            taskEnvelopeJson: actionAttempt.taskEnvelopeJson,
            status: actionAttempt.status,
          })
          .from(reviewTurn)
          .innerJoin(
            actionAttempt,
            eq(actionAttempt.attemptId, reviewTurn.actionAttemptId),
          )
          .where(
            and(
              eq(reviewTurn.reviewTurnId, reviewTurnId),
              eq(reviewTurn.tenantId, input.tenantId),
              eq(reviewTurn.actorId, input.actorUserId),
              eq(reviewTurn.workItemId, input.workItem.workItemId),
              eq(reviewTurn.actionAttemptId, saved.actionAttemptId),
              eq(reviewTurn.inputRevision, saved.basedOnWorkItemRevision),
              eq(actionAttempt.tenantId, input.tenantId),
              eq(actionAttempt.actorUserId, input.actorUserId),
              eq(actionAttempt.workItemId, input.workItem.workItemId),
              eq(actionAttempt.documentVersionId, saved.documentVersionId),
              eq(actionAttempt.baseRevision, saved.basedOnWorkItemRevision),
              eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
              inArray(actionAttempt.status, input.requireSucceeded
                ? ['SUCCEEDED'] : ['COMMITTING', 'SUCCEEDED']),
            ),
          )
          .limit(1);
        if (!turn?.taskEnvelopeJson) return fail();
        if (input.reviewConversationId && turn.conversationId !== input.reviewConversationId)
          return fail();
        const task = parseTaskEnvelope(turn.taskEnvelopeJson);
        const reviewTask = (
          task.modelInput as { jobAidContext?: JobAidProblemTaskInput }
        ).jobAidContext;
        const reviewScope = (
          task.modelInput as { context?: { issueEditScope?: unknown } }
        ).context?.issueEditScope;
        if (
          task.workItemId !== input.workItem.workItemId ||
          task.documentVersionId !== saved.documentVersionId ||
          task.baseRevision !== saved.basedOnWorkItemRevision ||
          reviewTask?.actorUserId !== input.actorUserId ||
          (input.requireSucceeded && reviewScope != null) ||
          reviewTask.modelInput.expectedWorkRevision !== saved.workRevision - 1
        )
          return fail();
        await this.assertEvidenceOwned(
          saved.content.evidence,
          input.tenantId,
          input.actorUserId,
          input.workItem.workItemId,
          database,
        );
        for (const source of reviewTask.sourceBindings) {
          const actual = await this.work.loadOwnedSourceBinding(
            {
              workItemId: source.workItemId,
              tenantId: input.tenantId,
              actorUserId: input.actorUserId,
              kind: source.kind,
            },
            database,
          );
          if (
            !actual ||
            actual.documentVersionId !== source.documentVersionId ||
            actual.artifactRef !== source.artifactRef ||
            actual.artifactSha256 !== source.artifactSha256
          )
            return fail();
        }
        // Use the existing browser repository reader under authenticated RLS.
        // The OpenClaw reader intentionally requires Hosted runtime policies.
        const aggregate = input.requestContext
          ? await this.conversations.loadById(turn.conversationId, database)
          : null;
        const binding = input.requestContext
          ? null
          : await this.conversations.loadOpenClawTurnByIdBinding(
              {
                reviewConversationId: turn.conversationId,
                reviewTurnId,
                tenantId: input.tenantId,
                actorId: input.actorUserId,
                workItemId: input.workItem.workItemId,
              },
              database,
            );
        if (
          input.requestContext &&
          (!aggregate ||
            aggregate.conversation.tenantId !== input.tenantId ||
            aggregate.conversation.actorId !== input.actorUserId ||
            aggregate.conversation.workItemId !== input.workItem.workItemId)
        )
          return fail();
        const selectedTurn = input.requestContext
          ? aggregate?.turns.find(
              (item) =>
                item.reviewTurnId === reviewTurnId &&
                item.inputRevision === saved.basedOnWorkItemRevision,
            )
          : null;
        if (input.requireSucceeded &&
          (selectedTurn?.purpose !== 'UPDATE_ASSESSMENT' ||
            selectedTurn.reviewScope || selectedTurn.targetIssueKeys))
          return fail();
        const candidate = input.requestContext
          ? selectedTurn?.assistantCandidate
          : binding?.turn.assistantCandidate;
        const receipt = candidate?.jobAidWorkingUpdate;
        if (
          candidate?.actionAttemptRef !== turn.operationRef ||
          !turn.resultContentHash ||
          candidate.provenance.resultContentHash !== turn.resultContentHash ||
          receipt?.status !== 'APPLIED' ||
          receipt.workRevisionRef !== saved.workRevisionRef ||
          receipt.workRevision !== saved.workRevision
        )
          return fail();
        return saved;
      };
    return input.database
      ? verify(input.database)
      : this.withInputDatabase(input.actorUserId, input.requestContext === true, verify);
  }

  /** Normal browser admission and commit reuse the exact persisted Review receipt. */
  async exactSavedReviewWorkForProjection(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    actorUserId: string;
    expectedRevision: number;
    reviewConversationId: string;
    reviewTurnId: string;
    workRevisionRef: string;
    expectedWorkRevision: number;
    database?: PostgresJsDatabase;
  }): Promise<JobAidWorkRevision> {
    const saved = await this.exactReviewWorkForOverall({
      workItem: input.workItem,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      workRevisionRef: input.workRevisionRef,
      workRevision: input.expectedWorkRevision,
      // Review persistence marks any old Overall stale without advancing the
      // formal WorkItem revision. A later formal revision needs a new review.
      requestedFromRevision: input.expectedRevision,
      reviewConversationId: input.reviewConversationId,
      reviewTurnId: input.reviewTurnId,
      requireSucceeded: true,
      requestContext: true,
      database: input.database,
    });
    if (saved.content.schemaVersion !== JOBAID_PROBLEM_WORK_SCHEMA ||
      saved.content.overviewStatus !== 'CURRENT' ||
      saved.content.roundCompletion === 'IN_PROGRESS')
      throw new Error('JOBAID_OVERALL_COMPLETE_REVIEW_WORK_REQUIRED');
    const latest = await this.work.latest({ tenantId: input.tenantId,
      workItemId: input.workItem.workItemId }, input.database);
    if (latest?.workRevisionRef !== saved.workRevisionRef ||
      latest.workRevision !== saved.workRevision)
      throw new Error('JOBAID_OVERALL_EXACT_WORK_CHANGED');
    return saved;
  }

  async assertProjectionOriginalCurrent(input: {
    tenantId: string;
    actorUserId: string;
    workItem: CanonicalWorkItemProjection;
    saved: JobAidWorkRevision;
    database: PostgresJsDatabase;
  }): Promise<void> {
    const [source] = await input.database.select({
      taskEnvelopeJson: actionAttempt.taskEnvelopeJson,
    }).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, input.tenantId),
      eq(actionAttempt.actorUserId, input.actorUserId),
      eq(actionAttempt.workItemId, input.workItem.workItemId),
      eq(actionAttempt.attemptId, input.saved.actionAttemptId),
      eq(actionAttempt.status, 'SUCCEEDED'),
    )).limit(1);
    if (!source?.taskEnvelopeJson) throw new Error('JOBAID_OVERALL_REVIEW_SOURCE_CHANGED');
    const task = parseTaskEnvelope(source.taskEnvelopeJson);
    const context = (task.modelInput as {
      jobAidContext?: JobAidProblemTaskInput;
    }).jobAidContext;
    const sourceOriginal = context?.modelInput.documentOverview.original?.binding;
    const published = await this.work.publishedOriginalBindingInTransaction({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      workItemId: input.workItem.workItemId,
      documentVersionId: input.workItem.source.documentVersionId,
    }, input.database);
    if (!sourceOriginal?.parseRunId ||
      published.parseRunId !== sourceOriginal.parseRunId)
      throw new Error('JOBAID_OVERALL_ORIGINAL_PARSE_CHANGED');
  }

  async readSources(input: {
    attemptRef: string;
    workItemId?: string;
    leaseToken: string;
    leaseGeneration: number;
    sourceRefs: string[];
    purpose: string;
    context: 'EXACT' | 'PAGE';
  }) {
    const { row, taskInput, scope } = await this.authorizedAttempt(
      input.attemptRef,
      'READ_ASSESSMENT_SOURCES',
      input.workItemId,
    );
    if (!input.purpose.trim())
      throw new Error('JOBAID_SOURCE_PURPOSE_REQUIRED');
    if (!input.sourceRefs.length || input.sourceRefs.length > 96 || new Set(input.sourceRefs).size !== input.sourceRefs.length)
      throw new Error('JOBAID_SOURCE_SELECTION_INVALID');
    await this.assertNativeTaskAuthorized(taskInput, scope);
    const nativeDirectory = new Set(tdmsJobAidDirectory(taskInput.tdmsContext,taskInput.sourceCatalog).map(item=>item.ref));
    const nativeRefs = input.sourceRefs.filter(ref=>nativeDirectory.has(ref));
    const ordinaryRefs = input.sourceRefs.filter(ref=>!nativeDirectory.has(ref));
    const requested = ordinaryRefs.length ? expandJobAidSourceSelection(taskInput.sourceCatalog,ordinaryRefs,'EXACT') : [];
    const statementRefs = requested.filter(item=>item.kind==='PRIOR_RESULT'&&item.sourceStatement).map(item=>item.evidenceRef);
    if(statementRefs.length && !taskInput.sourceActivityProjections)
      throw new Error('JOBAID_SOURCE_STATEMENT_RECORD_REQUIRES_V3');
    const mandatoryRoots = requested.flatMap(item=>item.kind==='PRIOR_RESULT'&&item.sourceStatement ? item.originalEvidenceRefs : []);
    const expandedRefs = new Set([...ordinaryRefs,...mandatoryRoots]);
    let selected=statementRefs.length ? [...expandedRefs].map(ref=>taskInput.sourceCatalog.find(item=>item.evidenceRef===ref)).filter((item):item is AssessmentEvidence=>!!item) :
      ordinaryRefs.length ? expandJobAidSourceSelection(taskInput.sourceCatalog,ordinaryRefs,input.context) : [];
    if(statementRefs.length && input.context==='PAGE') {
      // The existing PAGE rule is applied to each bounded original selection;
      // internally required context is not a new user-selected batch budget.
      const pageSelected = selected.flatMap(item=>expandJobAidSourceSelection(taskInput.sourceCatalog,[item.evidenceRef],'PAGE'));
      selected=taskInput.sourceCatalog.filter(item=>pageSelected.some(e=>e.evidenceRef===item.evidenceRef));
    }
    if([...expandedRefs].some(ref=>!selected.some(item=>item.evidenceRef===ref))) throw new Error('JOBAID_SOURCE_STATEMENT_ROOT_REQUIRED');
    // Recheck the complete session scope. Revoked material may already be in
    // native memory; a new lease check alone cannot make that session forget it.
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      scope.tenantId,
      scope.workItemId,
      scope,
    );
    if (taskInput.tdmsContext) assertJobAidWorkFence(row, {...input,principalId:scope.principalId});
    let journaled=false;
    const principal=this.runtimePrincipal(scope,taskInput.actorUserId);
    const readRequest={context:taskInput.tdmsContext!,evidenceRefs:nativeRefs,
      purpose:'JOB_AID_NATIVE_RECORD' as const,taskContextRef:row.operationRef};
    const nativeRead = nativeRefs.length ? principal.reviewCaller
      ? await this.tdmsReader!.readReviewAndJournal!(principal,readRequest,async(result,assertReadAuthorized)=>{
          const actual=result.evidence.map(parseAssessmentTdmsEvidence);
          if(actual.length!==nativeRefs.length||new Set(actual.map(item=>item.evidenceRef)).size!==actual.length||
              nativeRefs.some(ref=>!actual.some(item=>item.evidenceRef===ref))||
              actual.some(item=>item.nativeReadReceipt.taskContextRef!==row.operationRef)||
              canonicalJson(actual.map(item=>item.nativeReadReceipt))!==canonicalJson(result.receipts))
            throw new Error('JOBAID_TDMS_READ_BINDING_INVALID');
          await this.work.recordSourceRead({row,actorUserId:taskInput.actorUserId,
            fence:{...input,principalId:scope.principalId,automaticLeaseRequired:false},sourceBindings:taskInput.sourceBindings,
            sourceRefs:[...selected,...actual].map(item=>item.evidenceRef),nativeEvidence:actual,
            assertNativeAuthorized:assertReadAuthorized,purpose:input.purpose});
          journaled=true;
        })
      : await this.tdmsReader!.read(principal,readRequest) : null;
    if (nativeRead) {
      const actual = nativeRead.evidence.map(parseAssessmentTdmsEvidence);
      if (actual.length !== nativeRefs.length || new Set(actual.map(item=>item.evidenceRef)).size !== nativeRefs.length ||
          nativeRefs.some(ref=>!actual.some(item=>item.evidenceRef===ref)) || actual.some(item=>item.nativeReadReceipt.taskContextRef!==row.operationRef) ||
          canonicalJson(actual.map(item=>item.nativeReadReceipt))!==canonicalJson(nativeRead.receipts))
        throw new Error('JOBAID_TDMS_READ_BINDING_INVALID');
      selected = [...selected,...actual];
    }
    await this.assertNativeTaskAuthorized(taskInput, scope);
    if(!journaled) await this.work.recordSourceRead({
      row,
      actorUserId: taskInput.actorUserId,
      fence: { ...input, principalId: scope.principalId, automaticLeaseRequired: !!scope.automaticWorkItemLease },
      sourceBindings: taskInput.sourceBindings,
      sourceRefs: selected.map((item) => item.evidenceRef),
      ...(nativeRead ? {nativeEvidence:nativeRead.evidence.map(parseAssessmentTdmsEvidence)} : {}),
      ...(taskInput.tdmsContext ? {assertNativeAuthorized:async(database:PostgresJsDatabase)=>{
        await assertTdmsNativeInTransaction({actor:{tenantId:scope.tenantId,actorUserId:taskInput.actorUserId},
          ...this.nativeTransactionCaller(scope,taskInput.actorUserId,taskInput.tdmsContext!),
          evidence:nativeRead?.evidence ?? [],database},this.nativeVerifier);
      }} : {}),
      purpose: input.purpose,
    });
    await this.assertNativeTaskAuthorized(taskInput, scope);
    if (nativeRead) await this.tdmsReader!.verifyEvidence(this.runtimePrincipal(scope,taskInput.actorUserId),nativeRead.evidence);
    return {
      ...(nativeRead ? {nativeReadReceipts:nativeRead.receipts} : {}),
      schemaVersion: taskInput.sourceActivityProjections ? 'wiselink.jobaid-source-read.v3' : 'wiselink.jobaid-source-read.v2',
      ...(taskInput.sourceActivityProjections ? {
        sourceStatements:(taskInput.sourceActivityProjections??[]).flatMap(p=>p.records).filter(r=>statementRefs.includes(r.ref)).map(r=>structuredClone(r)),
        activityContexts:(taskInput.sourceActivityProjections??[]).filter(p=>p.records.some(r=>statementRefs.includes(r.ref))).flatMap(p=>p.activityContexts).map(c=>structuredClone(c)),
      } : {}),
      status: 'AVAILABLE',
      sourceRefs: selected.map((item) => item.evidenceRef),
      evidence: overallModelEvidenceRegistry(selected, taskInput.modelInput.evidenceProjectionVersion),
      scope: input.context,
      completeRequestedScope: true,
    };
  }

  async queryKnowledge(input: {
    attemptRef: string;
    workItemId?: string;
    leaseToken: string;
    leaseGeneration: number;
    requestKey?: string;
    query?: string;
    queryRef?: string;
  }) {
    const { row, task, taskInput, scope } = await this.authorizedAttempt(
      input.attemptRef,
      'READ_ASSESSMENT_SOURCES',
      input.workItemId,
    );
    assertJobAidWorkFence(row, { ...input, principalId: scope.principalId });
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      scope.tenantId,
      scope.workItemId,
      scope,
    );
    const observe = (status: JobAidKnowledgeObservationStatus) =>
      this.work.recordKnowledgeObservation({ row, actorUserId: taskInput.actorUserId,
        fence: { ...input, principalId: scope.principalId, automaticLeaseRequired: !!scope.automaticWorkItemLease },
        sourceBindings: taskInput.sourceBindings, status });
    if (
      !this.knowledge ||
      !taskInput.knowledgeBinding ||
      !task.allowedConnectors.includes('feishu-aily-user')
    ) {
      await observe('UNAVAILABLE');
      return {
        queryRef: null,
        status: 'UNAVAILABLE',
        error: taskInput.modelInput.knowledgeAccess?.reason ?? 'NOT_CONNECTED',
        evidence: [],
        candidateOnly: true,
        originalDocumentsVerified: false,
      };
    }
    await observe('REQUESTED');
    let receipt;
    try {
      receipt = await this.knowledge.query(
        {
          tenantId: scope.tenantId,
          actorId: taskInput.actorUserId,
          workItemId: scope.workItemId,
        },
        taskInput.knowledgeBinding,
        row.attemptId,
        input,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AILY_USER_REAUTHORIZATION_REQUIRED'
      ) {
        await observe('UNAVAILABLE');
        return {
          queryRef: input.queryRef ?? null,
          status: 'UNAVAILABLE',
          error: error.message,
          evidence: [],
          candidateOnly: true,
          originalDocumentsVerified: false,
        };
      }
      // An exception does not prove that a remote query failed or never started.
      await observe('UNKNOWN');
      throw error;
    }
    await observe(receipt.status);
    if (receipt.evidence.length)
      await this.work.recordSourceRead({
        row,
        actorUserId: taskInput.actorUserId,
        fence: { ...input, principalId: scope.principalId, automaticLeaseRequired: !!scope.automaticWorkItemLease },
        sourceBindings: taskInput.sourceBindings,
        sourceRefs: receipt.evidence.map((item) => item.evidenceRef),
        purpose: '读取实际知识检索回执',
      });
    return {
      ...receipt,
      evidence: overallModelEvidenceRegistry(receipt.evidence, taskInput.modelInput.evidenceProjectionVersion),
    };
  }

  private readPreparationFacts(input: Parameters<CanonicalHostCommonContextService['readPreparationFacts']>[0]): Promise<JobAidEngineerPreparationFacts> {
    // A missing optional reader is explicit in the view; it is never an empty
    // claim that there were no corrections or human confirmations.
    return typeof this.common.readPreparationFacts === 'function'
      ? this.common.readPreparationFacts(input)
      : Promise.resolve(unavailableJobAidPreparationFacts());
  }

  private async currentPreparation(row: ActionAttemptRow, taskInput: JobAidProblemTaskInput,
    tenantId: string, latestWork: JobAidWorkRevision | null) {
    const current = await this.registrar.getTenantScopedByWorkItemId({tenantId,workItemId:row.workItemId});
    return this.work.withActorScope(taskInput.actorUserId, async () => {
      const facts = await this.readPreparationFacts({workItem:current,tenantId,actorUserId:taskInput.actorUserId,
        purpose:taskInput.modelInput.purpose,
        selection:taskInput.preparationScope ?? (taskInput.modelInput.purpose === 'PROBLEM_REVIEW'
          ? {includedDiscussionTurnIds:[],selectedContributionRefs:[]} : undefined)});
      return buildJobAidPreparationView({taskPurpose:taskInput.modelInput.purpose,taskInputRevision:row.inputRevision,
        current,documentVersionId:row.documentVersionId,originalBinding:taskInput.modelInput.documentOverview.original?.binding ?? null,
        latestWork,facts,sealedGoal:taskInput.modelInput.preparation});
    });
  }

  async saveWork(input: {
    attemptRef: string;
    workItemId?: string;
    leaseToken: string;
    leaseGeneration: number;
    requestId: string;
    expectedWorkRevision: number;
    workJson: string;
  }) {
    const { row, taskInput, scope } = await this.authorizedAttempt(
      input.attemptRef,
      'SAVE_ASSESSMENT_WORK',
      input.workItemId,
    );
    if (taskInput.successorReviewTurnRef)
      throw new Error('JOBAID_SUCCESSOR_OVERALL_EXACT_WORK_READ_ONLY');
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      scope.tenantId,
      scope.workItemId,
      scope,
    );
    const history = await this.work.listForRuntime({
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
      actorUserId: taskInput.actorUserId,
    });
    const preparation = await this.currentPreparation(row,taskInput,scope.tenantId,history[0] ?? null);
    const command: unknown = JSON.parse(input.workJson);
    const replay = history.find((item) => item.requestId === input.requestId);
    const previous = replay
      ? (history.find(
          (item) => item.workRevisionRef === replay.previousWorkRevisionRef,
        ) ?? null)
      : (history[0] ?? taskInput.previousWork);
    const readRefs = [
      ...new Set([
        ...taskInput.initiallyDeliveredRefs,
        ...resolvedAssessmentSources(row.reviewActivityJson),
        ...(previous?.content.readSourceRefs ?? []),
      ]),
    ];
    const nativeReads = resolvedTdmsReadEvidence(row.reviewActivityJson);
    if (nativeReads.some(item=>item.nativeReadReceipt.taskContextRef!==row.operationRef)) throw new Error('JOBAID_TDMS_READ_BINDING_INVALID');
    await verifyTdmsNativeEvidence(nativeReads,{tenantId:scope.tenantId,actorUserId:taskInput.actorUserId},this.nativeVerifier);
    await this.assertNativeTaskAuthorized(taskInput,scope);
    const content = materializeJobAidWork(command, {
      contentValidationVersion: taskInput.contentValidationVersion,
      methodBinding: taskInput.modelInput.methodBinding,
      workItemId: scope.workItemId,
      previous: previous?.content ?? null,
      evidence: [
        ...mergeTdmsReadEvidence(taskInput.sourceCatalog,nativeReads),
        ...((await this.knowledge?.saved(
          {
            tenantId: scope.tenantId,
            actorId: taskInput.actorUserId,
            workItemId: scope.workItemId,
          },
          row.attemptId,
        )) ?? []),
      ],
      readSourceRefs: readRefs,
      currentDeliveredSourceRefs:[...new Set([...taskInput.initiallyDeliveredRefs,...resolvedAssessmentSources(row.reviewActivityJson)])],
      capabilities: taskInput.modelInput.capabilities,
      history: taskInput.modelInput.historyReview,
    });
    const saved = await this.work.save({
      row,
      actorUserId: taskInput.actorUserId,
      fence: { ...input, principalId: scope.principalId, automaticLeaseRequired: !!scope.automaticWorkItemLease },
      sourceBindings: taskInput.sourceBindings,
      requestId: input.requestId,
      expectedWorkRevision: input.expectedWorkRevision,
      command: {
        expectedWorkRevision: input.expectedWorkRevision,
        work: command,
      },
      content,
      ...(taskInput.tdmsContext ? {assertNativeAuthorized:async(database:PostgresJsDatabase)=>{
        await assertTdmsNativeInTransaction({actor:{tenantId:scope.tenantId,actorUserId:taskInput.actorUserId},
          ...this.nativeTransactionCaller(scope,taskInput.actorUserId,taskInput.tdmsContext!),
          evidence:content.evidence,database},this.nativeVerifier);
      }} : {}),
    });
    await this.assertSourcesAuthorized(saved.revision.content.evidence,taskInput,scope.tenantId,scope.workItemId,scope);
    return {
      schemaVersion: 'wiselink.jobaid-work-saved.v2',
      workRevisionRef: saved.revision.workRevisionRef,
      workRevision: saved.revision.workRevision,
      replayed: saved.replayed,
      roundCompletion: saved.revision.content.roundCompletion,
      issueKeys: saved.revision.content.issues.map((issue) => issue.issueKey),
      currentUnderstanding: saved.revision.content.understanding,
      preparation:preparationAfterSavedWork(preparation,
        saved.revision.workRevision >= (history[0]?.workRevision ?? 0) ? saved.revision : history[0]),
    };
  }

  async readAttemptWork(attemptRef: string, requestId?: string, workItemId?: string) {
    const { row, taskInput, scope } = await this.authorizedAttempt(
      attemptRef,
      'READ_ASSESSMENT_WORK',
      workItemId,
    );
    await this.assertSourcesAuthorized(taskInput.sourceCatalog,taskInput,scope.tenantId,scope.workItemId,scope);
    const history = await this.work.listForRuntime({
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
      actorUserId: taskInput.actorUserId,
    });
    const revision = requestId
      ? (history.find(
          (item) =>
            item.requestId === requestId &&
            (item.actionAttemptId === row.attemptId ||
              (taskInput.savedWorkReconciliation?.workRevisionRef === item.workRevisionRef &&
               taskInput.savedWorkReconciliation.sourceActionAttemptId === item.actionAttemptId)),
        ) ?? null)
      : (history[0] ?? null);
    if (revision)
      await this.assertSourcesAuthorized(
        revision.content.evidence,
        taskInput,
        scope.tenantId,
        scope.workItemId,
        scope,
      );
    return {
      schemaVersion: 'wiselink.jobaid-work-read.v2',
      attemptId: row.attemptId,
      inputWorkRevision: taskInput.modelInput.expectedWorkRevision,
      revision,
      executionStatus: row.status,
      preparation:await this.currentPreparation(row,taskInput,scope.tenantId,history[0] ?? null),
    };
  }

  async commit(input: {
    row: ActionAttemptRow;
    scope: CanonicalVerifiedOpenClawAttemptScope;
    leaseToken: string;
    leaseGeneration: number;
    result: unknown;
  }): Promise<
    | {
        workItemId: string;
        workItemRevision: number;
        status: CanonicalIntegratedAssessmentProjection['status'];
        baseRules?: CanonicalBaseRuleCandidateProjection;
        overallSynthesis?: CanonicalOpenClawOverallProjection;
      }
    | ActionAttemptTerminalProjection
  > {
    if(input.scope.successorReviewDelegation) await this.admitSuccessorSources(input.scope,
      input.scope.successorReviewDelegation.reviewTurnRef,input.scope.attemptRef);
    const preflight = preflightCanonicalHostOpenClawResult({
      row: input.row,
      result: input.result,
    });
    const taskInput = parseJobAidProblemTask(preflight.task);
    if (input.scope.automaticWorkItemLease && !taskAutomaticWorkItemLease(input.row))
      throw new Error('AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED');
    if (
      preflight.result.toolVersions['jobaid-problem-protocol'] !== (taskInput.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA?'3':'2') ||
      preflight.result.promptVersion !== (taskInput.schemaVersion===JOBAID_PROBLEM_SOURCE_STATEMENT_TASK_SCHEMA?'wiselink-jobaid-problem@v3':'wiselink-jobaid-problem@v2')
    )
      throw new Error('JOBAID_RUNTIME_CAPABILITY_REQUIRED');
    if (taskInput.tdmsContext && preflight.result.toolVersions['tdms-native-context'] !== '1') throw new Error('JOBAID_TDMS_RUNTIME_CAPABILITY_REQUIRED');
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      input.scope.tenantId,
      input.scope.workItemId,
      input.scope,
    );
    if (taskInput.contentValidationVersion && input.row.status !== 'COMMITTING' && input.row.status !== 'SUCCEEDED' &&
        preflight.task.taskType === 'OPENCLAW_OVERALL_SYNTHESIS') {
      const finish = parseFinishOutput(preflight.result.modelOutput);
      const saved = await this.work.listForRuntime({tenantId: input.scope.tenantId,
        workItemId: input.scope.workItemId, actorUserId: taskInput.actorUserId});
      const selected = saved.find(item => item.workRevisionRef === finish.workRevisionRef);
      if (!selected) throw new Error('JOBAID_OVERALL_WORK_REQUIRED');
      assertJobAidSemanticContent(selected.content, selected.content.evidence);
    }
    const prepared = await this.attempts.prepareCommit({
      attemptRef: input.scope.attemptRef,
      tenantId: input.scope.tenantId,
      workItemId: input.scope.workItemId,
      principalId: input.scope.principalId,
      automaticLeaseRequired: !!input.scope.automaticWorkItemLease,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      result: preflight.result,
    });
    if (
      prepared.row.status !== 'COMMITTING' &&
      prepared.row.status !== 'SUCCEEDED'
    )
      return this.attempts.projectTerminal(prepared.row);
    const current = await this.registrar.getTenantScopedByWorkItemId({
      tenantId: input.scope.tenantId,
      workItemId: input.scope.workItemId,
    });
    const isOverall = prepared.task.taskType === 'OPENCLAW_OVERALL_SYNTHESIS';
    const committed = isOverall
      ? current.integratedAssessment?.overallSynthesis
      : (activeConfigurationEvidenceReevaluation(current)?.stagedBundle
          .baseRules ?? current.integratedAssessment?.baseRules);
    if (committed?.actionAttemptId === prepared.row.attemptId) {
      await this.assertNativeProjectionAuthorized(committed,taskInput,input.scope);
      await this.attempts.finishProjectionSuccess(prepared);
      await this.assertNativeProjectionAuthorized(committed,taskInput,input.scope);
      return {
        workItemId: current.workItemId,
        workItemRevision: current.revision,
        status:
          current.integratedAssessment?.status ?? 'BASE_RULE_CANDIDATE_READY',
        ...(isOverall
          ? {
              overallSynthesis: committed as CanonicalOpenClawOverallProjection,
            }
          : { baseRules: committed as CanonicalBaseRuleCandidateProjection }),
      };
    }
    if (prepared.row.status === 'SUCCEEDED')
      throw new Error('JOBAID_SUCCESS_PROJECTION_MISSING');
    if (current.revision !== prepared.task.baseRevision)
      return this.attempts.finishProjectionConflict({
        prepared,
        currentRevision: current.revision,
      });
    try {
      const output = parseFinishOutput(prepared.result.modelOutput);
      const history = await this.work.listForRuntime({
        tenantId: input.scope.tenantId,
        workItemId: current.workItemId,
        actorUserId: taskInput.actorUserId,
      });
      const revision = history.find(
        (item) => item.workRevisionRef === output.workRevisionRef,
      );
      if (taskInput.successorReviewTurnRef &&
        revision?.workRevisionRef !== taskInput.previousWork?.workRevisionRef)
        throw new Error('JOBAID_SUCCESSOR_OVERALL_WORK_CHANGED');
      const allowedPriorForOverall =
        isOverall &&
        revision?.workRevisionRef === taskInput.previousWork?.workRevisionRef;
      const savedRecovery = taskInput.savedWorkReconciliation;
      const allowedSavedRecovery = !isOverall && savedRecovery &&
        prepared.result.executionKind === 'HOST_SAVED_WORK_RECONCILIATION' &&
        savedRecovery.workRevisionRef === revision?.workRevisionRef &&
        savedRecovery.sourceActionAttemptId === revision?.actionAttemptId &&
        revision?.content.roundCompletion === 'COMPLETE' && revision.basedOnWorkItemRevision === current.revision &&
        !isJobAidProblemProjection(current.integratedAssessment?.baseRules);
      if (savedRecovery && !allowedSavedRecovery && !isOverall)
        throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
      if (
        !revision ||
        revision.workRevisionRef !== history[0]?.workRevisionRef ||
        revision.documentVersionId !== current.source.documentVersionId ||
        (revision.actionAttemptId !== prepared.row.attemptId &&
          !allowedPriorForOverall && !allowedSavedRecovery) ||
        revision.content.roundCompletion === 'IN_PROGRESS'
      )
        throw new Error('JOBAID_COMPLETED_WORK_REQUIRED');
      await this.assertSourcesAuthorized(revision.content.evidence,taskInput,input.scope.tenantId,input.scope.workItemId,input.scope);
      if (isOverall)
        return await this.commitOverall(prepared, current, revision, output, input.scope);
      const bytes = new TextEncoder().encode(canonicalJson(revision));
      const persisted = await this.artifactStore.persistAndReadback(bytes);
      const baseRules = this.baseProjection(
        current,
        prepared.row,
        revision,
        persisted.artifact,
      );
      const oldOverall = current.integratedAssessment?.overallSynthesis;
      const integrated: CanonicalIntegratedAssessmentProjection = {
        status: oldOverall
          ? 'OVERALL_CANDIDATE_STALE'
          : 'BASE_RULE_CANDIDATE_READY',
        baseRules,
        engineerReviews: current.integratedAssessment?.engineerReviews ?? null,
        overallSynthesis: oldOverall
          ? {
              ...oldOverall,
              status: 'STALE',
              staleReason: 'BASE_RULE_RESULT_CHANGED',
            }
          : null,
        overallForAeoConfirmation: null,
      };
      const marker = activeConfigurationEvidenceReevaluation(current);
      const next = marker
        ? withStagedBaseRules(current, baseRules, attemptBinding(prepared.row))
        : { ...current, integratedAssessment: integrated, aeo: null };
      await this.assertNativeProjectionAuthorized(baseRules,taskInput,input.scope);
      const saved = await this.registrar.compareAndSet({
        workItemId: current.workItemId,
        expectedRevision: prepared.task.baseRevision,
        syncPrimaryAttempt: false,
        jobAidWorkRevisionGuard:{tenantId:input.scope.tenantId,workRevisionRef:revision.workRevisionRef,
          sourceGuard:{actorUserId:taskInput.actorUserId,sourceBindings:taskInput.sourceBindings}},
        nativeEvidenceGuard:(database:PostgresJsDatabase)=>this.work.withActorScope(taskInput.actorUserId,async()=>{
          await this.assertProjectionWriteFence(database,prepared,taskInput,input.scope);
          await this.assertNativeProjectionAuthorized(baseRules,taskInput,input.scope,database);
        },database),
        next: withoutRevision(next),
      });
      await this.assertNativeProjectionAuthorized(baseRules,taskInput,input.scope);
      await this.attempts.finishProjectionSuccess(prepared);
      await this.assertNativeProjectionAuthorized(baseRules,taskInput,input.scope);
      return {
        workItemId: saved.workItemId,
        workItemRevision: saved.revision,
        status: integrated.status,
        baseRules,
        ...(allowedSavedRecovery ? {executionKind:'HOST_SAVED_WORK_RECONCILIATION' as const, modelRequests:0 as const,
          workRevisionRef:revision.workRevisionRef,sourceActionAttemptId:revision.actionAttemptId} : {}),
      };
    } catch (error) {
      // An already-applied projection is recovered by the same commit identity;
      // it never triggers another model call or a replacement ResultEnvelope.
      const fresh = await this.registrar.getTenantScopedByWorkItemId({
        tenantId: input.scope.tenantId,
        workItemId: current.workItemId,
      });
      const applied = isOverall
        ? fresh.integratedAssessment?.overallSynthesis
        : (activeConfigurationEvidenceReevaluation(fresh)?.stagedBundle
            .baseRules ?? fresh.integratedAssessment?.baseRules);
      if (applied?.actionAttemptId === prepared.row.attemptId) {
        await this.assertNativeProjectionAuthorized(applied,taskInput,input.scope);
        await this.attempts.finishProjectionSuccess(prepared);
        await this.assertNativeProjectionAuthorized(applied,taskInput,input.scope);
        return {
          workItemId: fresh.workItemId,
          workItemRevision: fresh.revision,
          status:
            fresh.integratedAssessment?.status ?? 'BASE_RULE_CANDIDATE_READY',
          ...(isOverall
            ? {
                overallSynthesis: applied as CanonicalOpenClawOverallProjection,
              }
            : { baseRules: applied as CanonicalBaseRuleCandidateProjection }),
        };
      }
      if (error instanceof Error && error.message.startsWith('JOBAID_'))
        return this.attempts.finishResultGateFailure(prepared, error);
      throw error;
    }
  }

  private async commitOverall(
    prepared: PreparedActionAttemptCommit,
    workItem: CanonicalWorkItemProjection,
    revision: JobAidWorkRevision,
    output: ReturnType<typeof parseFinishOutput>,
    scope: CanonicalVerifiedOpenClawAttemptScope,
  ) {
    if (!output.consistencyCheck || !output.consistencyCheck.trim())
      throw new Error('JOBAID_OVERALL_CONSISTENCY_REQUIRED');
    assertJobAidOverallWorkCurrent(revision);
    const marker = activeConfigurationEvidenceReevaluation(workItem);
    const effective = marker ? configurationEvidenceShadow(workItem) : workItem;
    const base = effective.integratedAssessment!.baseRules;
    if (!isJobAidProblemProjection(base))
      throw new Error('JOBAID_OVERALL_BASE_VERSION_INVALID');
    const assessmentOriginal = parseJobAidProblemTask(prepared.task).modelInput.documentOverview.original?.binding;
    const reading = jobAidReadingResult(revision);
    const artifact = await this.artifactStore.persistAndReadback(
      new TextEncoder().encode(
        canonicalJson({
          schemaVersion: 'wiselink.jobaid-problem-overall.v2',
          analysis: revision,
          consistencyCheck: output.consistencyCheck,
          readingResult: reading,
          authorityLevel: 'candidate_only',
          adopted: false,
        }),
      ),
    );
    const synthesis = buildJobAidOverallProjection({
      workItem, revision, artifact: artifact.artifact,
      actionAttemptId: prepared.row.attemptId,
      sourceResultId: `openclaw-overall://${prepared.row.triggerRequestId}`,
      applicabilityStatus:
        effective.applicability?.schemaVersion ===
        'wiselink.3_1.applicability_candidate_projection.v3'
          ? assessmentOriginal &&
            originalApplicabilityResultMatches(effective, assessmentOriginal)
            ? effective.applicability.decision
            : 'UNKNOWN'
          : (effective.applicability?.decision ?? 'UNKNOWN'),
      modelProvenance: {
        modelVersion: prepared.result.modelVersion,
        promptVersion: prepared.result.promptVersion,
        skillVersion: prepared.result.skillVersion,
        toolVersions: prepared.result.toolVersions,
      },
    });
    let nextBase = base;
    if (revision.workRevisionRef !== base.workRevisionRef) {
      const saved = await this.artifactStore.persistAndReadback(
        new TextEncoder().encode(canonicalJson(revision)),
      );
      nextBase = {
        ...base,
        revision: base.revision + 1,
        workRevisionRef: revision.workRevisionRef,
        workRevision: revision.workRevision,
        issueCount: revision.content.issues.length,
        openQuestionCount: synthesis.unresolvedCount,
        headline: revision.content.headline,
        listBrief: revision.content.listBrief,
        readingResult: reading,
        artifact: saved.artifact,
      };
      synthesis.basedOnBaseRuleArtifactSha256 = nextBase.artifact.sha256;
      synthesis.basedOnBaseRuleRevision = nextBase.revision;
    }
    const integrated: CanonicalIntegratedAssessmentProjection = {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: nextBase,
      engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
      overallSynthesis: synthesis,
      overallForAeoConfirmation: null,
    };
    const promotionBasis = marker
      ? {
          ...workItem,
          configurationEvidenceReevaluation: {
            ...marker,
            stagedBundle: { ...marker.stagedBundle, baseRules: nextBase },
          },
        }
      : workItem;
    const next = marker
      ? promoteConfigurationEvidenceReevaluation(
          promotionBasis,
          synthesis,
          attemptBinding(prepared.row),
        )
      : { ...workItem, integratedAssessment: integrated, aeo: null };
    const taskInput = parseJobAidProblemTask(prepared.task);
    await this.assertNativeProjectionAuthorized(synthesis,taskInput,scope);
    const saved = await this.registrar.compareAndSet({
      workItemId: workItem.workItemId,
      expectedRevision: prepared.task.baseRevision,
      syncPrimaryAttempt: false,
      jobAidWorkRevisionGuard: { tenantId: prepared.row.tenantId, workRevisionRef: revision.workRevisionRef,
        sourceGuard:{actorUserId:taskInput.actorUserId,sourceBindings:taskInput.sourceBindings} },
      nativeEvidenceGuard:(database:PostgresJsDatabase)=>this.work.withActorScope(taskInput.actorUserId,async()=>{
        await this.assertProjectionWriteFence(database,prepared,taskInput,scope);
        await this.assertNativeProjectionAuthorized(synthesis,taskInput,scope,database);
      },database),
      next: withoutRevision(next),
    });
    await this.assertNativeProjectionAuthorized(synthesis,taskInput,scope);
    await this.attempts.finishProjectionSuccess(prepared);
    await this.assertNativeProjectionAuthorized(synthesis,taskInput,scope);
    return {
      workItemId: saved.workItemId,
      workItemRevision: saved.revision,
      status: integrated.status,
      overallSynthesis: synthesis,
    };
  }

  /** Native authority accompanies the exact committed carrier, never just a directory. */
  private async assertNativeProjectionAuthorized(
    projection: CanonicalBaseRuleCandidateProjection | CanonicalOpenClawOverallProjection,
    task: JobAidProblemTaskInput,
    scope: CanonicalVerifiedOpenClawAttemptScope,
    database?: PostgresJsDatabase,
  ): Promise<void> {
    if(!database) await this.assertNativeTaskAuthorized(task,scope);
    const reading = 'readingResult' in projection ? projection.readingResult : undefined;
    const evidence = reading?.evidence ?? [];
    if (!task.tdmsContext && !evidence.some(item=>item.kind==='TDMS_NATIVE_RECORD')) return;
    if (!task.tdmsContext || !reading) throw new Error('TDMS_NATIVE_PROJECTION_EVIDENCE_REQUIRED');
    const workRevisionRef = isJobAidProblemProjection(projection) ? projection.workRevisionRef
      : 'basedOnJobAidWorkRevisionRef' in projection ? projection.basedOnJobAidWorkRevisionRef : undefined;
    if (!workRevisionRef) throw new Error('TDMS_NATIVE_PROJECTION_WORK_REQUIRED');
    if (database && typeof this.nativeVerifier?.assertInTransaction !== 'function')
      throw new Error('TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED');
    const exact = {tenantId:scope.tenantId,actorUserId:task.actorUserId,workItemId:scope.workItemId,workRevisionRef};
    const saved = database ? await this.work.readByRefForRuntimeInTransaction(exact,database)
      : await this.work.readByRefForRuntime(exact);
    if (!saved || saved.workRevisionRef !== workRevisionRef || saved.workItemId !== scope.workItemId ||
        saved.documentVersionId !== task.tdmsContext.binding.documentVersionId ||
        (isJobAidProblemProjection(projection) && saved.workRevision !== projection.workRevision) ||
        canonicalJson(jobAidReadingResult(saved)) !== canonicalJson(reading))
      throw new Error('TDMS_NATIVE_PROJECTION_WORK_MISMATCH');
    if (database) {
      // No ordinary adapter/root-pool IO while CAS holds its connection and locks.
      await assertTdmsNativeInTransaction({actor:{tenantId:scope.tenantId,actorUserId:task.actorUserId},
        ...this.nativeTransactionCaller(scope,task.actorUserId,task.tdmsContext),evidence,database},this.nativeVerifier);
      return;
    }
    await this.assertNativeTaskAuthorized(task,scope);
    if(!scope.successorReviewDelegation) await verifyTdmsNativeEvidence(evidence,{tenantId:scope.tenantId,actorUserId:task.actorUserId},this.nativeVerifier,database);
    const native=evidence.filter((item):item is Extract<AssessmentEvidence,{kind:'TDMS_NATIVE_RECORD'}>=>item.kind==='TDMS_NATIVE_RECORD');
    if (native.length) await this.tdmsReader!.verifyEvidence(this.runtimePrincipal(scope,task.actorUserId),native);
  }

  async readBrowserRevision(
    workItemId: string,
    workRevisionRef: string,
    actor: CanonicalHostActor,
  ): Promise<JobAidWorkRevision> {
    return (await this.readAuthorizedBrowserRevision(workItemId, workRevisionRef, actor)).revision;
  }

  /** Rebuild-only read: fresh native authorization, creator and exact body in the caller's transaction. */
  async readBrowserRevisionForProjection(
    workItemId: string,
    workRevisionRef: string,
    actor: CanonicalHostActor,
    database: PostgresJsDatabase,
  ): Promise<JobAidWorkRevision> {
    const identity = actor.objectAccessActor;
    if (!this.objectAccess || !identity || !isHostedCanonicalFinalUserActor(identity) ||
      identity.canonicalSubject.id !== actor.userId || identity.tenantId !== actor.tenantId)
      throw jobAidBrowserWorkUnavailable();
    const access = await this.objectAccess.freshRead({ actor: identity,
      action: 'READ_DOCUMENT_PARSING', accessRoot: { kind: 'WORK_ITEM', id: workItemId } }, database);
    if ('code' in access || access.workItemId !== workItemId) throw jobAidBrowserWorkUnavailable();
    const [saved] = await database.select({ ref: assessmentWorkRevision.assessmentWorkRevisionId })
      .from(assessmentWorkRevision).where(and(
        eq(assessmentWorkRevision.tenantId, actor.tenantId),
        eq(assessmentWorkRevision.workItemId, workItemId),
        eq(assessmentWorkRevision.assessmentWorkRevisionId, workRevisionRef),
        eq(assessmentWorkRevision.createdByUserId, actor.userId),
      )).limit(1);
    if (!saved) throw jobAidBrowserWorkUnavailable();
    const revision = await this.work.readByRef({ tenantId: actor.tenantId, workItemId, workRevisionRef }, database);
    if (!revision || revision.workItemId !== workItemId || revision.workRevisionRef !== workRevisionRef || !revision.content)
      throw jobAidBrowserWorkUnavailable();
    // Projection rebuild is an owner-authorized writer, not a shared browser read.
    await this.assertEvidenceOwned(revision.content.evidence, actor.tenantId, actor.userId, workItemId, database,
      this.browserNativeAssertion(actor,{workItemId,documentVersionId:revision.documentVersionId,
        workItemRevision:access.workItemRevision},[workRevisionRef],database));
    return revision;
  }

  async readBrowserKnowledgeRevision(
    workItemId: string,
    workRevisionRef: string,
    actor: CanonicalHostActor,
  ): Promise<{
    revision: JobAidWorkRevision;
    overall: { status: 'CANDIDATE_ONLY' | 'STALE';
      readingResult: NonNullable<CanonicalOpenClawOverallProjection['readingResult']> } | null;
  }> {
    const { workItem, revision } = await this.readAuthorizedBrowserRevision(
      workItemId, workRevisionRef, actor,
    );
    const overall = workItem.integratedAssessment?.overallSynthesis;
    const readingResult = overall?.readingResult;
    if (!overall || !readingResult ||
      overall.basedOnJobAidWorkRevisionRef !== workRevisionRef) {
      return { revision, overall: null };
    }
    if (readingResult.scope.kind !== 'WORK_ITEM' ||
      readingResult.scope.workItemId !== workItemId ||
      readingResult.scope.documentVersionId !== workItem.source.documentVersionId) {
      throw new Error('JOBAID_OVERALL_SOURCE_BINDING_INVALID');
    }
    await this.assertBrowserEvidenceOwned(
      readingResult.evidence, actor.tenantId, actor.userId, workItemId,
      actor.objectAccessActor?.identityProvenance === 'MIAODA_GATEWAY_USER_CONTEXT',
      {actor,workItem,workRevisionRefs:[workRevisionRef]},
    );
    return { revision, overall: { status: overall.status, readingResult } };
  }

  private async readAuthorizedBrowserRevision(
    workItemId: string,
    workRevisionRef: string,
    actor: CanonicalHostActor,
  ): Promise<{ workItem: CanonicalWorkItemProjection; revision: JobAidWorkRevision }> {
    const { workItem } = await authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId,
    });
    const revision = await this.work.readByRef({
      tenantId: actor.tenantId, workItemId, workRevisionRef,
    });
    if (!revision) throw jobAidBrowserWorkUnavailable();
    await this.assertBrowserEvidenceOwned(revision.content.evidence, actor.tenantId, actor.userId, workItemId,
      actor.objectAccessActor?.identityProvenance === 'MIAODA_GATEWAY_USER_CONTEXT',
      {actor,workItem,workRevisionRefs:[workRevisionRef]});
    return { workItem, revision };
  }

  async readBrowser(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<JobAidWorkingReadModel> {
    const { workItem } = await authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId,
    });
    const receipt = await this.workItems.readReadableAutoProcessingCompletion({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      workItemId,
      revision: workItem.revision,
    });
    // The authorized projection may precede this read. Never attach an ACK
    // belonging to a different request/source or concurrent WorkItem revision.
    const autoProcessingAcknowledgement: JobAidWorkingReadModel['autoProcessingAcknowledgement'] =
      receipt &&
      receipt.workItemId === workItem.workItemId &&
      receipt.requestId === workItem.requestId &&
      receipt.documentId === workItem.source.documentId &&
      receipt.documentVersionId === workItem.source.documentVersionId &&
      receipt.sourceArtifactId === workItem.source.sourceArtifactId &&
      receipt.sourceFileSha256 === canonicalHostBareSha256(workItem.source.sourceFileSha256) &&
      receipt.sourceByteLength === workItem.source.sourceByteLength
        ? {
          workItemId: receipt.workItemId,
          requestId: receipt.requestId,
          documentVersionId: receipt.documentVersionId,
          acknowledgedAt: receipt.completedAt,
        }
        : null;
    // A new attempt may legitimately retain the previous saved body, but all
    // three observations must come from the same database snapshot.
    const { execution, current, savedActivity, latestAttempt } = await this.work.readBrowserSnapshot({
      tenantId: actor.tenantId,
      workItemId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (current)
      await this.assertBrowserEvidenceOwned(
        current.content.evidence,
        actor.tenantId,
        actor.userId,
        workItemId,
        actor.objectAccessActor?.identityProvenance === 'MIAODA_GATEWAY_USER_CONTEXT',
        {actor,workItem,workRevisionRefs:[current.workRevisionRef]},
      );
    const activity = execution ? projectJobAidActivity(execution, savedActivity) : null;
    const overall = workItem.integratedAssessment?.overallSynthesis;
    const base = workItem.integratedAssessment?.baseRules;
    return {
      schemaVersion: 'wiselink.jobaid-working-read.v2',
      workItemId,
      autoProcessingAcknowledgement,
      current,
      latestAttempt,
      selectedExecution: execution ? {
        actionType: execution.actionType,
        attemptId: execution.attemptId,
        attemptRef: execution.attemptRef,
        status: execution.status,
        createdAt: execution.createdAt,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
      } : null,
      enabled:
        !!current ||
        isJobAidProblemProjection(base) ||
        (!base && this.enabledForNewTasks()),
      executionStatus: execution?.status ?? null,
      activity,
      currentInputChanged:
        !!current &&
        current.basedOnWorkItemRevision !== workItem.revision &&
        (!isJobAidProblemProjection(base) ||
          base.workRevisionRef !== current.workRevisionRef),
      overallStatus: !overall
        ? 'NOT_AVAILABLE'
        : overall.status === 'CANDIDATE_ONLY' &&
            overall.basedOnJobAidWorkRevisionRef === current?.workRevisionRef
          ? 'CURRENT'
          : 'STALE',
      overallBasedOnWorkRevisionRef:
        overall?.basedOnJobAidWorkRevisionRef ?? null,
    };
  }

  private baseProjection(
    workItem: CanonicalWorkItemProjection,
    row: ActionAttemptRow,
    revision: JobAidWorkRevision,
    artifact: CanonicalBaseRuleCandidateProjection['artifact'],
  ): CanonicalJobAidProblemCandidateProjection {
    if (revision.content.roundCompletion === 'IN_PROGRESS')
      throw new Error('JOBAID_COMPLETED_WORK_REQUIRED');
    return {
      schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
      status: 'CANDIDATE_ONLY',
      revision: (workItem.integratedAssessment?.baseRules.revision ?? 0) + 1,
      sourceResultId: `openclaw-dynamic://${row.triggerRequestId}`,
      workRevisionRef: revision.workRevisionRef,
      workRevision: revision.workRevision,
      issueCount: revision.content.issues.length,
      openQuestionCount: revision.content.issues.reduce(
        (sum, issue) => sum + issue.openQuestions.length,
        0,
      ),
      roundCompletion: revision.content.roundCompletion,
      methodBinding: structuredClone(revision.content.methodBinding),
      headline: revision.content.headline,
      listBrief: revision.content.listBrief,
      artifact,
      actionAttemptId: row.attemptId,
      readingResult: jobAidReadingResult(revision),
    };
  }

  private async sourceBindings(
    evidence: AssessmentEvidence[],
    primary: CanonicalWorkItemProjection,
    tenantId: string,
    actorUserId: string,
    requestContext = false,
    nativeContext?: Pick<TdmsNativeTransactionInput,'runtime'|'browserCaller'|'reviewCaller'>,
  ): Promise<JobAidSourceBinding[]> {
    const ids = new Set([
      primary.workItemId,
      ...evidence.flatMap((item) =>
        item.kind === 'DOCUMENT_PASSAGE' ? [item.workItemId] : [],
      ),
    ]);
    return this.withInputDatabase(
      actorUserId,
      requestContext,
      async (database) => {
      await this.assertEvidenceOwned(
        evidence,
        tenantId,
        actorUserId,
        primary.workItemId,
        database,
        nativeContext ? evidence => assertTdmsNativeInTransaction({actor:{tenantId,actorUserId},...nativeContext,evidence,database},this.nativeVerifier) : undefined,
      );
      const bindings: JobAidSourceBinding[] = [];
      for (const workItemId of ids) {
        const binding = await this.work.loadOwnedSourceBinding(
          { workItemId, tenantId, actorUserId,kind:'SOURCE_FILE' },
          database,
        );
        if (!binding) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
        bindings.push(binding);
      }
      return bindings;
      },
    );
  }

  private async savedReadNativeContext(input:{workItem:CanonicalWorkItemProjection;tenantId:string;actorUserId:string;
    nativeCaller?:{runtimeScope:CanonicalVerifiedServiceScope}|
      {browserActor:NonNullable<TdmsNativeTransactionInput['browserCaller']>['actor']}},saved:JobAidWorkRevision):
    Promise<Pick<TdmsNativeTransactionInput,'runtime'|'browserCaller'>|undefined> {
    if (!saved.content.evidence.some(item=>item.kind==='TDMS_NATIVE_RECORD')) return undefined;
    const caller=input.nativeCaller;
    if (!caller) throw new Error('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED');
    if ('browserActor' in caller) return {browserCaller:{actor:caller.browserActor,action:'READ_WORK_ITEM',
      workItemId:input.workItem.workItemId,documentVersionId:input.workItem.source.documentVersionId,
      workItemRevision:input.workItem.revision,workRevisionRef:saved.workRevisionRef,workRevisionRefs:[saved.workRevisionRef]}};
    if (!this.tdmsReader) throw new Error('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED');
    const principal={scope:caller.runtimeScope,actorUserId:input.actorUserId};
    const context=await this.tdmsReader.discover(principal,{tenantId:input.tenantId,workItemId:input.workItem.workItemId,
      documentVersionId:input.workItem.source.documentVersionId,actorUserId:input.actorUserId,taskContextRef:'TDMS_OVERALL_ADMISSION'});
    if (!context) throw new Error('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED');
    return {runtime:{principal,context,phase:'ADMISSION'}};
  }

  private async assertSourcesAuthorized(
    evidence: AssessmentEvidence[],
    input: JobAidProblemTaskInput,
    tenantId: string,
    workItemId: string,
    runtimeScope?: CanonicalVerifiedServiceScope,
    reviewCaller?: TdmsReviewCaller,
  ): Promise<void> {
    await this.assertNativeTaskAuthorized(input, runtimeScope);
    const nativeCaller=reviewCaller ?? (runtimeScope?this.successorCallers.get(runtimeScope):undefined);
    await this.work.withActorTransaction(
      input.actorUserId,
      async (database) => {
        await this.assertEvidenceOwned(
          evidence,
          tenantId,
          input.actorUserId,
          workItemId,
          database,
          nativeCaller ? evidence => assertTdmsNativeInTransaction({actor:{tenantId,actorUserId:input.actorUserId},reviewCaller:nativeCaller,evidence,database},this.nativeVerifier) : input.tdmsContext && runtimeScope ? evidence => assertTdmsNativeInTransaction({actor:{tenantId,actorUserId:input.actorUserId},
            runtime:{principal:{scope:runtimeScope,actorUserId:input.actorUserId},context:input.tdmsContext!,
              ...('attemptRef' in runtimeScope?{}:{phase:'ADMISSION' as const})},evidence,database},this.nativeVerifier) : undefined,
        );
        for (const binding of input.sourceBindings) {
          const current = await this.work.loadOwnedSourceBinding(
            {
              workItemId: binding.workItemId,
              kind:binding.kind,
              tenantId,
              actorUserId: input.actorUserId,
            },
            database,
          );
          if (
            !current ||
            current.documentVersionId !== binding.documentVersionId ||
            current.artifactSha256 !== binding.artifactSha256 || current.artifactRef !== binding.artifactRef
          )
            throw new Error('JOBAID_SOURCE_VERSION_CHANGED');
        }
      },
    );
    const originals = evidence.filter((item): item is Extract<AssessmentEvidence,{kind:'DOCUMENT_PASSAGE'}> =>
      item.kind === 'DOCUMENT_PASSAGE' && item.evidenceRef.startsWith('DOCUMENT_ORIGINAL:'));
    if (originals.length) {
      if (!this.originalReader) throw new Error('DOCUMENT_ORIGINAL_READER_UNAVAILABLE');
      await this.work.withActorScope(input.actorUserId, async () => {
        const finders = new Map<string, ReturnType<typeof prepareDocumentOriginalEvidenceFinder>>();
        for (const item of originals) {
          const prefix = `DOCUMENT_ORIGINAL:${item.documentVersionId}:`;
          const parseRunId = item.evidenceRef.slice(prefix.length,-(item.sourceRefId.length+1));
          if (
            !item.evidenceRef.startsWith(prefix) ||
            !item.evidenceRef.endsWith(`:${item.sourceRefId}`) ||
            !/^[A-Za-z0-9_-]{1,96}$/u.test(parseRunId)
          ) throw new Error('JOBAID_ORIGINAL_SOURCE_BINDING_INVALID');
          const key = `${item.documentVersionId}:${parseRunId}`;
          let find = finders.get(key);
          if (!find) {
            const loaded = await this.originalReader!.readDocumentOriginal(item.documentVersionId,parseRunId,
              {tenantId,actorUserId:input.actorUserId,roles:[]});
            find = prepareDocumentOriginalEvidenceFinder(loaded);
            finders.set(key, find);
          }
          const actual = {...find(item.sourceRefId),workItemId:item.workItemId};
          if (canonicalJson(actual) !== canonicalJson(item)) throw new Error('JOBAID_ORIGINAL_SOURCE_CHANGED');
        }
      });
    }
    await this.work.withActorScope(input.actorUserId, async()=>{
      await this.assertSourceStatementReferences(evidence,{tenantId,actorUserId:input.actorUserId});
      const fresh=await this.readSourceStatementProjections(evidence,{tenantId,actorUserId:input.actorUserId});
      if(input.sourceActivityProjections) for(const p of fresh) for(const r of p.records) {
        const sealed=input.sourceActivityProjections.flatMap(x=>x.records).find(x=>x.ref===r.ref);
        const sealedContext=input.sourceActivityProjections.flatMap(x=>x.activityContexts).find(x=>x.runRef===r.reference.runRef&&x.candidateRevision===r.reference.candidateRevision);
        if(canonicalJson(sealed)!==canonicalJson(r)||canonicalJson(sealedContext)!==canonicalJson(p.activityContexts[0])) throw new Error('JOBAID_SOURCE_STATEMENT_CHANGED');
      }
    });
    await this.assertNativeTaskAuthorized(input, runtimeScope);
    if (!nativeCaller) await verifyTdmsNativeEvidence(evidence, {tenantId,actorUserId:input.actorUserId}, this.nativeVerifier);
    const native = evidence.filter((item): item is Extract<AssessmentEvidence,{kind:'TDMS_NATIVE_RECORD'}>=>item.kind==='TDMS_NATIVE_RECORD');
    if (input.tdmsContext && runtimeScope && native.length)
      await this.tdmsReader!.verifyEvidence(this.runtimePrincipal(runtimeScope,input.actorUserId),native);
  }

  private async assertNativeTaskAuthorized(input: JobAidProblemTaskInput, scope?: CanonicalVerifiedServiceScope): Promise<void> {
    if (!input.tdmsContext) return;
    if (!scope || !this.tdmsReader) throw new Error('TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED');
    if(input.successorReviewTurnRef && scope.successorReviewDelegation && 'attemptRef' in scope)
      await this.admitSuccessorSources(scope,String(input.successorReviewTurnRef),String(scope.attemptRef));
    await this.tdmsReader.assertAuthorized(this.runtimePrincipal(scope,input.actorUserId),input.tdmsContext);
  }

  /** Exact SAVED lineage checked on the caller's actor-bound transaction. */
  async assertSourceStatementReferences(evidence: AssessmentEvidence[], actor: {tenantId:string;actorUserId:string}, database?: PostgresJsDatabase): Promise<void> {
    const selected=evidence.filter((item):item is Extract<AssessmentEvidence,{kind:'PRIOR_RESULT'}>=>item.kind==='PRIOR_RESULT'&&!!item.sourceStatement);
    if(!selected.length) return;
    if(!this.activityRuns) throw new Error('JOBAID_SOURCE_STATEMENT_READER_UNAVAILABLE');
    for(const item of selected) {
      const source=parseAssessmentSourceStatement(item.sourceStatement);
      if(item.sourceWork || item.evidenceRef!==`DOCUMENT_ACTIVITY:${source.reference.runRef}:${source.reference.candidateRevision}:${source.reference.statementId}` ||
        item.resultRef!==source.reference.runRef || item.resultRevision!==source.reference.candidateRevision) throw new Error('JOBAID_SOURCE_STATEMENT_BINDING_INVALID');
      const saved=await this.activityRuns.readSavedByReference({...actor,documentVersionId:source.sourceBinding.original.documentVersionId},source.reference,source.sourceBinding,database);
      const statement=saved?.statements.find(x=>x.statementId===source.reference.statementId);
      if(!statement) throw new Error('JOBAID_SOURCE_STATEMENT_UNAVAILABLE');
      const rootRefs=[...new Set(saved!.sourceAnchors.flatMap(a=>a.sourceRefIds.map(ref=>`DOCUMENT_ORIGINAL:${source.sourceBinding.original.documentVersionId}:${source.sourceBinding.original.parseRunId}:${ref}`)))];
      if(item.excerpt!==statement.label || canonicalJson([...item.originalEvidenceRefs].sort())!==canonicalJson(rootRefs.sort())) throw new Error('JOBAID_SOURCE_STATEMENT_CHANGED');
    }
  }

  /** Fresh Reader ACL, exact historical map and saved payload validation, no latest substitution. */
  async readSourceStatementProjections(evidence: AssessmentEvidence[], actor: {tenantId:string;actorUserId:string}): Promise<DocumentActivityAssessmentProjection[]> {
    const selected=evidence.filter((item):item is Extract<AssessmentEvidence,{kind:'PRIOR_RESULT'}>=>item.kind==='PRIOR_RESULT'&&!!item.sourceStatement);
    if(!selected.length) return [];
    if(!this.activityRuns||!this.originalReader||!this.semantics) throw new Error('JOBAID_SOURCE_STATEMENT_READER_UNAVAILABLE');
    const projections:DocumentActivityAssessmentProjection[]=[];
    for(const item of selected) {
      const source=parseAssessmentSourceStatement(item.sourceStatement);
      const scope={...actor,documentVersionId:source.sourceBinding.original.documentVersionId};
      const prior=projections.find(p=>p.activityContexts[0]?.runRef===source.reference.runRef && p.activityContexts[0]?.candidateRevision===source.reference.candidateRevision);
      if(prior) continue;
      const original=await this.originalReader.readDocumentOriginal(scope.documentVersionId,source.sourceBinding.original.parseRunId,{...actor,roles:[]});
      const map=await this.semantics.read({...scope,roles:[]},original,source.sourceBinding.semanticRevision);
      if(!map) throw new Error('JOBAID_SOURCE_STATEMENT_SEMANTIC_UNAVAILABLE');
      const saved=await this.activityRuns.readSavedByReference(scope,source.reference,source.sourceBinding);
      if(!saved) throw new Error('JOBAID_SOURCE_STATEMENT_UNAVAILABLE');
      const byRef=new Map<string,AssessmentEvidence>();
      const read=prepareDocumentOriginalEngineeringReader(original);
      for(let offset=0;offset<original.structuredSource.units.length;offset+=20) for(const root of read(offset,20).evidence) byRef.set(root.evidenceRef,root);
      const projected=projectSavedDocumentActivityForAssessment({savedRevision:saved,original:original.original,semanticMap:map,originalEvidence:[...byRef.values()]});
      const refs=new Set(selected.filter(e=>e.sourceStatement!.reference.runRef===source.reference.runRef && e.sourceStatement!.reference.candidateRevision===source.reference.candidateRevision).map(e=>e.evidenceRef));
      projected.records=projected.records.filter(r=>refs.has(r.ref)); projected.entries=projected.entries.filter(e=>refs.has(e.ref));
      for(const ref of refs) {
        const expected=evidence.find(e=>e.evidenceRef===ref); const record=projected.records.find(r=>r.ref===ref);
        if(!record||canonicalJson(sourceStatementEvidence(record))!==canonicalJson(expected)) throw new Error('JOBAID_SOURCE_STATEMENT_CHANGED');
      }
      projections.push(projected);
    }
    return projections;
  }

  private async assertBrowserEvidenceOwned(
    evidence: AssessmentEvidence[],
    tenantId: string,
    actorUserId: string,
    workItemId: string,
    sharedRead = false,
    native?: {actor:CanonicalHostActor;workItem:CanonicalWorkItemProjection;workRevisionRefs:string[]},
  ): Promise<void> {
    try {
      if (evidence.some(item=>item.kind==='TDMS_NATIVE_RECORD') && native) {
        if (!this.database) throw new Error('JOBAID_REQUEST_DATABASE_UNAVAILABLE');
        return await this.database.transaction(async tx=>{
          const database=tx as PostgresJsDatabase;
          const assertNative=this.browserNativeAssertion(native.actor,{workItemId,
            documentVersionId:native.workItem.source.documentVersionId,workItemRevision:native.workItem.revision},
            native.workRevisionRefs,database);
          await (sharedRead ? this.assertEvidenceReadable(evidence,tenantId,actorUserId,workItemId,database,assertNative)
            : this.assertEvidenceOwned(evidence,tenantId,actorUserId,workItemId,database,assertNative));
        });
      }
      await (sharedRead ? this.assertEvidenceReadable(evidence, tenantId, actorUserId, workItemId)
        : this.assertEvidenceOwned(evidence, tenantId, actorUserId, workItemId));
    } catch (cause: unknown) {
      // Only these verified bare authorization sentinels become the public
      // unavailable response. Preserve explicit conflicts and storage errors.
      if (
        cause instanceof Error &&
        !('code' in cause) &&
        !('statusCode' in cause) &&
        !('status' in cause) &&
        (cause.message === 'JOBAID_SOURCE_AUTHORIZATION_CHANGED' ||
          cause.message === 'JOBAID_ACTOR_AUTHORIZATION_CHANGED')
      ) {
        throw jobAidBrowserWorkUnavailable();
      }
      throw cause;
    }
  }

  private browserNativeAssertion(actor:CanonicalHostActor,
    binding:{workItemId:string;documentVersionId:string;workItemRevision:number},
    workRevisionRefs:string[],database:PostgresJsDatabase):(evidence:AssessmentEvidence[])=>Promise<void> {
    return async evidence=>{
      if (!evidence.some(item=>item.kind==='TDMS_NATIVE_RECORD')) return;
      const identity=actor.objectAccessActor;
      if (!identity || !isHostedCanonicalFinalUserActor(identity) || identity.tenantId!==actor.tenantId ||
          identity.canonicalSubject.id!==actor.userId || actor.appId!==identity.applicationScopeId)
        throw jobAidBrowserWorkUnavailable();
      const refs=[...new Set(workRevisionRefs)];
      if (!refs.length) throw new Error('TDMS_NATIVE_PROJECTION_WORK_REQUIRED');
      await assertTdmsNativeInTransaction({actor:{tenantId:actor.tenantId,actorUserId:actor.userId},
        browserCaller:{actor:identity,action:'READ_WORK_ITEM',...binding,workRevisionRef:refs[0]!,workRevisionRefs:refs},
        evidence,database},this.nativeVerifier);
    };
  }

  /** Read an immutable saved candidate under the current native reader, not its creator. */
  private async assertEvidenceReadable(evidence: AssessmentEvidence[], tenantId: string,
    actorUserId: string, primaryWorkItemId: string, connection?: PostgresJsDatabase,
    assertNative?: (evidence: AssessmentEvidence[]) => Promise<void>): Promise<void> {
    const database = connection ?? this.database;
    if (!database) throw new Error('JOBAID_SOURCE_AUTHORIZATION_UNAVAILABLE');
    const workIds = new Set<string>([primaryWorkItemId]);
    const documentIds = new Set<string>();
    for (const item of evidence) {
      for (const id of item.dialogueSource?.contextWorkItemIds ?? []) workIds.add(id);
      if (item.kind === 'DOCUMENT_PASSAGE') { workIds.add(item.workItemId); documentIds.add(item.documentVersionId); }
      if (item.kind === 'ENGINEER_ATTACHMENT') { workIds.add(item.workItemId); documentIds.add(item.documentVersionId); }
    }
    const [access] = await database.execute<{ allowed: boolean }>(sql`SELECT
      native_app_shared_read_allowed(${tenantId}) AND current_setting('app.user_id',true)=${actorUserId}
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify([...workIds])}::jsonb) w(id)
        WHERE native_app_work_item_readable(${tenantId},w.id::varchar) IS NOT TRUE)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify([...documentIds])}::jsonb) d(id)
        WHERE native_app_document_readable(${tenantId},d.id::varchar) IS NOT TRUE) AS allowed`);
    if (access?.allowed !== true) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    if (assertNative) await assertNative(evidence);
    else await verifyTdmsNativeEvidence(evidence, { tenantId, actorUserId }, this.nativeVerifier, database);
    const queried = evidence.filter(item => item.kind === 'QUERY_RECEIPT' && item.queryProvenance?.origin === 'AILY_RETRIEVAL');
    if (queried.length) {
      const saved = await this.knowledge?.saved({ tenantId, actorId: actorUserId,
        workItemId: primaryWorkItemId, readScope: 'TENANT' }, undefined, database) ?? [];
      for (const item of queried) if (!saved.some(receipt => receipt.evidenceRef === item.evidenceRef &&
        canonicalJson(receipt) === canonicalJson(item))) throw new Error('JOBAID_QUERY_RECEIPT_AUTHORIZATION_CHANGED');
    }
    for (const item of evidence) {
      if (item.kind !== 'DOCUMENT_PASSAGE' && item.kind !== 'ENGINEER_ATTACHMENT') continue;
      const binding = await this.workItems.loadAuthorizationBinding({ workItemId: item.workItemId,
        tenantId, actorUserId, readScope: 'TENANT' }, database);
      if (!binding || (item.kind === 'DOCUMENT_PASSAGE' && binding.documentVersionId !== item.documentVersionId))
        throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
      if (item.kind !== 'ENGINEER_ATTACHMENT') continue;
      const [stored] = await database.select({ actorId: reviewTurn.actorId }).from(reviewTurn).where(and(
        eq(reviewTurn.tenantId, tenantId), eq(reviewTurn.workItemId, item.workItemId),
        eq(reviewTurn.reviewConversationId, item.reviewConversationId), eq(reviewTurn.reviewTurnId, item.reviewTurnId))).limit(1);
      if (!stored) throw new Error('JOBAID_ATTACHMENT_AUTHORIZATION_CHANGED');
      const turn = await this.conversations.loadOpenClawTurnByIdBinding({ tenantId, actorId: stored.actorId,
        workItemId: item.workItemId, reviewConversationId: item.reviewConversationId, reviewTurnId: item.reviewTurnId,
        readScope: 'TENANT' }, database);
      const attachment = turn?.turn.attachmentBindings?.find(entry => entry.attachmentRef === item.attachmentRef);
      if (!attachment || attachment.documentVersionId !== item.documentVersionId ||
        attachment.parsedArtifact.ref !== item.artifactRef || attachment.parsedArtifact.sha256 !== item.artifactSha256)
        throw new Error('JOBAID_ATTACHMENT_AUTHORIZATION_CHANGED');
    }
    if (assertNative) await assertNative(evidence);
    else await verifyTdmsNativeEvidence(evidence, { tenantId, actorUserId }, this.nativeVerifier, database);
  }

  private async assertEvidenceOwned(
    evidence: AssessmentEvidence[],
    tenantId: string,
    actorUserId: string,
    primaryWorkItemId: string,
    database?: PostgresJsDatabase,
    assertNative?: (evidence: AssessmentEvidence[]) => Promise<void>,
  ): Promise<void> {
    if (assertNative) await assertNative(evidence);
    else await verifyTdmsNativeEvidence(evidence, {tenantId,actorUserId}, this.nativeVerifier, database);
    if (
      !(await this.conversations.hasActiveOfficialActorMapping(
        { tenantId, actorId: actorUserId },
        database,
      ))
    )
      throw new Error('JOBAID_ACTOR_AUTHORIZATION_CHANGED');
    const queried = evidence.filter(
      (item) =>
        item.kind === 'QUERY_RECEIPT' &&
        item.queryProvenance?.origin === 'AILY_RETRIEVAL',
    );
    if (queried.length) {
      const saved =
        (await this.knowledge?.saved(
          { tenantId, actorId: actorUserId, workItemId: primaryWorkItemId },
          undefined,
          database,
        )) ?? [];
      for (const item of queried)
        if (
          !saved.some(
            (receipt) =>
              receipt.evidenceRef === item.evidenceRef &&
              canonicalJson(receipt) === canonicalJson(item),
          )
        )
          throw new Error('JOBAID_QUERY_RECEIPT_AUTHORIZATION_CHANGED');
    }
    const bindings = new Map<string, string | null>([
      [primaryWorkItemId, null],
    ]);
    for (const item of evidence)
      for (const id of item.dialogueSource?.contextWorkItemIds ?? [])
        bindings.set(id, bindings.get(id) ?? null);
    for (const item of evidence)
      if (item.kind === 'DOCUMENT_PASSAGE')
        bindings.set(item.workItemId, item.documentVersionId);
    for (const item of evidence)
      if (item.kind === 'ENGINEER_ATTACHMENT') {
        const binding = await this.conversations.loadOpenClawTurnByIdBinding(
          {
            reviewConversationId: item.reviewConversationId,
            reviewTurnId: item.reviewTurnId,
            tenantId,
            actorId: actorUserId,
            workItemId: item.workItemId,
          },
          database,
        );
        const attachment = binding?.turn.attachmentBindings?.find(
          (entry) => entry.attachmentRef === item.attachmentRef,
        );
        if (
          !attachment ||
          attachment.documentVersionId !== item.documentVersionId ||
          attachment.parsedArtifact.ref !== item.artifactRef ||
          attachment.parsedArtifact.sha256 !== item.artifactSha256
        )
          throw new Error('JOBAID_ATTACHMENT_AUTHORIZATION_CHANGED');
      }
    for (const [workItemId, documentVersionId] of bindings) {
      const owned = database
        ? await this.work.loadOwnedSourceBinding(
        { workItemId, tenantId, actorUserId, kind:'SOURCE_FILE' },
            database,
          )
        : await this.workItems.loadAuthorizationBinding({
            workItemId,
            tenantId,
            actorUserId,
          });
      if (
        !owned ||
        (documentVersionId && owned.documentVersionId !== documentVersionId)
      )
        throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    }
    if (assertNative) await assertNative(evidence);
    else await verifyTdmsNativeEvidence(evidence, {tenantId,actorUserId}, this.nativeVerifier, database);
  }

  private async assertProjectionWriteFence(database: PostgresJsDatabase,
    prepared: PreparedActionAttemptCommit, input: JobAidProblemTaskInput,
    scope: CanonicalVerifiedOpenClawAttemptScope): Promise<void> {
    if(scope.successorReviewDelegation && input.tdmsContext) {
      const delegation=scope.successorReviewDelegation;
      if(!this.nativeVerifier?.admitReviewInTransaction) throw new Error('TDMS_REVIEW_ADMISSION_NOT_CONNECTED');
      // The WorkItem is already locked by CAS. Re-mint in normal conversation ->
      // turn -> attempt order, both before and after this exact own projection.
      const caller=await this.nativeVerifier.admitReviewInTransaction({database,ingress:{scope,attemptRef:scope.attemptRef,
        reviewConversationRef:delegation.reviewConversationRef,requestId:delegation.requestId,
        successorOverall:{reviewTurnRef:delegation.reviewTurnRef}}});
      if(!caller) throw new Error('TDMS_REVIEW_ADMISSION_NOT_CONNECTED');
      this.successorCallers.set(scope,caller);
    }
    await assertAutomaticWorkItemAttemptLease(database,prepared.row,scope.principalId,!!scope.automaticWorkItemLease);
    const [current] = await database.select().from(actionAttempt).where(and(
      eq(actionAttempt.attemptId,prepared.row.attemptId),eq(actionAttempt.tenantId,scope.tenantId),
      eq(actionAttempt.workItemId,scope.workItemId))).limit(1).for('update');
    if (!current || current.status !== 'COMMITTING' || current.taskInputHash !== prepared.row.taskInputHash ||
        current.resultContentHash !== prepared.result.contentHash || current.leaseOwner !== scope.principalId ||
        current.leaseToken !== prepared.row.leaseToken || current.leaseGeneration !== prepared.row.leaseGeneration ||
        current.cancelRequestedAt)
      throw new Error('JOBAID_PROJECTION_LEASE_FENCE_REJECTED');
    const caller=this.successorCallers.get(scope);
    if(caller && tdmsReviewBinding(caller).attempt?.phase==='SEALED_RECOVERY')
      assertTdmsSealedResultFence(caller,current,{principalId:scope.principalId,
        leaseToken:prepared.row.leaseToken!,leaseGeneration:prepared.row.leaseGeneration},'SUCCESSOR_OVERALL');
    else if(!current.leaseExpiresAt || current.leaseExpiresAt<=new Date() ||
      !current.deadlineAt || current.deadlineAt<=new Date()) throw new Error('JOBAID_PROJECTION_LEASE_FENCE_REJECTED');
    await this.assertEvidenceOwned(input.sourceCatalog,scope.tenantId,input.actorUserId,scope.workItemId,database,
      input.tdmsContext ? evidence=>assertTdmsNativeInTransaction({actor:{tenantId:scope.tenantId,actorUserId:input.actorUserId},
        ...this.nativeTransactionCaller(scope,input.actorUserId,input.tdmsContext!),evidence,database},this.nativeVerifier) : undefined);
    const original = input.modelInput.documentOverview.original?.binding;
    if (original) {
      const published = await this.work.publishedOriginalBindingInTransaction({tenantId:scope.tenantId,
        actorUserId:input.actorUserId,workItemId:scope.workItemId,documentVersionId:prepared.task.documentVersionId},database);
      if (published.parseRunId !== original.parseRunId) throw new Error('JOBAID_ORIGINAL_REQUEST_CHANGED');
    }
    if (input.savedWorkReconciliation) {
      const [saved] = await database.select().from(assessmentWorkRevision).where(and(
        eq(assessmentWorkRevision.tenantId,scope.tenantId),eq(assessmentWorkRevision.workItemId,scope.workItemId),
        eq(assessmentWorkRevision.assessmentWorkRevisionId,input.savedWorkReconciliation.workRevisionRef))).limit(1);
      const [source] = await database.select().from(actionAttempt).where(and(
        eq(actionAttempt.attemptId,input.savedWorkReconciliation.sourceActionAttemptId),
        eq(actionAttempt.tenantId,scope.tenantId),eq(actionAttempt.workItemId,scope.workItemId))).limit(1);
      if (!saved || saved.basedOnWorkItemRevision !== prepared.task.baseRevision ||
          saved.documentVersionId !== prepared.task.documentVersionId || saved.actionAttemptId !== source?.attemptId ||
          !source?.taskEnvelopeJson || source.status === 'CANCELLED')
        throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
      const prior = parseJobAidProblemTask(parseTaskEnvelope(source.taskEnvelopeJson));
      if (canonicalJson(prior.sourceBindings) !== canonicalJson(input.sourceBindings) ||
          canonicalJson(prior.modelInput.documentOverview.original?.binding) !== canonicalJson(original))
        throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
    }
  }

  async admitSuccessorSources(scope:CanonicalVerifiedServiceScope,reviewTurnRef:string,
    attemptRef?:string,preparation?:{attemptId:string;operationRef:string;createdAt:Date}):Promise<TdmsReviewCaller|undefined> {
    const d=scope.successorReviewDelegation;
    if(!d||d.reviewTurnRef!==reviewTurnRef) throw new Error('JOBAID_SUCCESSOR_OVERALL_DELEGATION_REQUIRED');
    const caller=await this.admitReviewSources({scope,reviewConversationRef:d.reviewConversationRef,requestId:d.requestId,
      ...(attemptRef?{attemptRef}:{}),successorOverall:{reviewTurnRef,...(preparation?{preparation}:{})}});
    if(caller) this.successorCallers.set(scope,caller);
    else this.successorCallers.delete(scope);
    return caller;
  }
  private runtimePrincipal(scope:CanonicalVerifiedServiceScope,actorUserId:string) {
    const reviewCaller=scope.successorReviewDelegation?this.successorCallers.get(scope):undefined;
    return {scope,actorUserId,...(reviewCaller?{reviewCaller}:{})};
  }
  private nativeTransactionCaller(scope:CanonicalVerifiedServiceScope,actorUserId:string,
    context:TdmsRuntimeTaskContext,phase?:'ADMISSION'|'EXECUTION'):Pick<TdmsNativeTransactionInput,'runtime'|'reviewCaller'> {
    const principal=this.runtimePrincipal(scope,actorUserId);
    return principal.reviewCaller?{reviewCaller:principal.reviewCaller}:{runtime:{principal,context,...(phase?{phase}:{})}};
  }

  private async authorizedAttempt(
    attemptRef: string,
    operation:
      | 'READ_ASSESSMENT_SOURCES'
      | 'SAVE_ASSESSMENT_WORK'
      | 'READ_ASSESSMENT_WORK',
    workItemId?: string,
  ) {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      attemptRef,
      operation,
      workItemId,
    });
    if(scope.successorReviewDelegation) await this.admitSuccessorSources(scope,
      scope.successorReviewDelegation.reviewTurnRef,attemptRef);
    const row = await this.attempts.readScoped({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    if (
      row.operationRef !== attemptRef ||
      !row.taskEnvelopeJson ||
      !['OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS'].includes(
        row.actionType,
      )
    )
      throw new Error('JOBAID_ATTEMPT_NOT_FOUND');
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    const taskInput = parseJobAidProblemTask(task);
    if (
      scope.appId !== 'app_17bzc551rsg' ||
      row.tenantId !== scope.tenantId ||
      row.workItemId !== scope.workItemId
    )
      throw new Error('JOBAID_ATTEMPT_NOT_FOUND');
    if (taskInput.tdmsContext && (taskInput.tdmsContext.binding.taskContextRef !== row.operationRef ||
      taskInput.tdmsContext.binding.tenantId !== row.tenantId || taskInput.tdmsContext.binding.workItemId !== row.workItemId ||
      taskInput.tdmsContext.binding.documentVersionId !== row.documentVersionId)) throw new Error('JOBAID_TDMS_TASK_BINDING_INVALID');
    if (operation !== 'READ_ASSESSMENT_WORK' && scope.automaticWorkItemLease && !taskAutomaticWorkItemLease(row))
      throw new Error('AUTO_WORK_ITEM_TASK_LEASE_BINDING_REQUIRED');
    await this.assertNativeTaskAuthorized(taskInput, scope);
    return { row, task, taskInput, scope };
  }
}

function canRecoverSavedOverallWork(row: Pick<ActionAttemptRow, 'status' | 'terminalReason'>): boolean {
  // Only persisted deadline terminals join the existing cancellation recovery.
  // This reuses saved work; it neither retries the old run nor proves a provider stopped.
  return row.status === 'CANCELLED' || (row.status === 'TIMED_OUT' &&
    ['ACTION_ATTEMPT_DEADLINE_EXCEEDED', 'DEADLINE_EXCEEDED_DURING_LEASE']
      .includes(row.terminalReason ?? ''));
}

function parseFinishOutput(value: string | null): {
  workRevisionRef: string;
  consistencyCheck: string | null;
} {
  if (!value) throw new Error('JOBAID_FINAL_OUTPUT_MISSING');
  const output: unknown = JSON.parse(value);
  if (
    !output ||
    typeof output !== 'object' ||
    !('workRevisionRef' in output) ||
    typeof output.workRevisionRef !== 'string' ||
    !output.workRevisionRef
  )
    throw new Error('JOBAID_FINAL_OUTPUT_INVALID');
  return {
    workRevisionRef: output.workRevisionRef,
    consistencyCheck:
      'consistencyCheck' in output &&
      typeof output.consistencyCheck === 'string'
        ? output.consistencyCheck
        : null,
  };
}
function withoutRevision(
  value: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = value;
  return rest;
}
function attemptBinding(row: ActionAttemptRow) {
  return {
    attemptId: row.attemptId,
    attemptRef: row.operationRef!,
    inputRevision: row.inputRevision!,
    baseRevision: row.baseRevision!,
  };
}
function jobAidBrowserWorkUnavailable(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function problemIdempotencyKey(
  workItem: CanonicalWorkItemProjection,
  purpose: JobAidProblemModelInput['purpose'],
  requestId?: string,
): string {
  if (requestId !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(requestId))
      throw new Error('JOBAID_REQUEST_ID_INVALID');
    if (
      purpose !== 'INITIAL_PROBLEM_ASSESSMENT' &&
      purpose !== 'OVERALL_CONSISTENCY'
    )
      throw new Error('JOBAID_CONTINUATION_PURPOSE_INVALID');
    return `openclaw-v2:${purpose === 'INITIAL_PROBLEM_ASSESSMENT' ? 'dynamic' : 'overall'}:${workItem.workItemId}:${workItem.source.documentVersionId}:${requestId}`;
  }
  const regeneration = workItem.overallRegenerationRequest;
  if (
    purpose === 'OVERALL_CONSISTENCY' &&
    regeneration?.executionRevision === workItem.revision &&
    regeneration.staleReason === 'USER_REQUESTED_REGENERATION'
  )
    return [
      'openclaw-v1',
      'overall',
      workItem.workItemId,
      workItem.revision,
      'USER_REQUESTED_REGENERATION',
      regeneration.requestId,
    ].join(':');
  return `openclaw-v1:${purpose === 'INITIAL_PROBLEM_ASSESSMENT' ? 'dynamic' : 'overall'}:${workItem.workItemId}:${workItem.revision}:problem-v2`;
}

function continuationReceipt(
  row: ActionAttemptRow,
  purpose: JobAidProblemModelInput['purpose'],
) {
  const task = parseTaskEnvelope(row.taskEnvelopeJson!);
  const request = readInitialAnalysisRequestInput(task);
  const expectedTaskType =
    purpose === 'INITIAL_PROBLEM_ASSESSMENT'
      ? 'OPENCLAW_DYNAMIC_EVALUATION'
      : 'OPENCLAW_OVERALL_SYNTHESIS';
  if (
    request
      ? request.taskType !== expectedTaskType
      : parseJobAidProblemTask(task).modelInput.purpose !== purpose
  )
    throw new Error('JOBAID_CONTINUATION_PURPOSE_MISMATCH');
  return {
    attemptRef: task.operationRef,
    status: row.status,
    created: false,
    workItemRevision: task.baseRevision,
  };
}
