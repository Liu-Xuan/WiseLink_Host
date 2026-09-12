import { CanonicalHostApplicabilityInputProducer } from './canonical-host-applicability-input.producer';
import { originalApplicabilityInputMatches } from './original-applicability-currentness';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { JobAidWorkRepository } from './jobaid-work.repository';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { compareDocumentOriginal } from '../document-management/src/hosted/nest/document-original-change';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';

import type {
  AilyInitialAnalysisOperation,
  AilyInitialAnalysisStageStatus,
  AilyInitialAnalysisStatus,
  CanonicalInitialAnalysisReadModel,
  CanonicalExecutionModelSelection,
  CanonicalConfigurationEvidenceReevaluationStageProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import {
  actionAttempt,
  translationWorkspace,
  workItem,
} from '../../database/schema';
import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';
import { isOpenClawAutomaticReviewConfigured } from './configured-development-service-scope.authorization';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../action-attempt/action-attempt.types';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
} from './canonical-translation-rule-set-v1.private';
import {
  activeConfigurationEvidenceReevaluation,
  configurationEvidenceShadow,
} from './configuration-evidence/configuration-evidence-reevaluation.state';

const INITIAL_ANALYSIS_ACTION_TYPES = [
  'OPENCLAW_TRANSLATE',
  'OPENCLAW_APPLICABILITY_EVALUATION',
  'OPENCLAW_DYNAMIC_EVALUATION',
  'OPENCLAW_OVERALL_SYNTHESIS',
] as const;

const ORIGINAL_ENGINEERING_STAGES = ['applicability', 'jobAid', 'overall'] as const;
type OriginalEngineeringStage = (typeof ORIGINAL_ENGINEERING_STAGES)[number];

type InitialAnalysisActionType = (typeof INITIAL_ANALYSIS_ACTION_TYPES)[number];

export interface CanonicalInitialAnalysisAttemptObservation {
  requestId?: string;
  baseRevision?: number | null;
  executionModel?: CanonicalExecutionModelSelection | null;
  attemptId: string;
  actionType: InitialAnalysisActionType;
  attemptRef: string | null;
  status: string;
  terminalCode: string | null;
}

interface StageProjectionObservation {
  status: 'SUCCEEDED' | 'WAITING_INPUT' | 'STALE' | 'ABSENT';
  actionAttemptId: string | null;
  terminalCode: string | null;
}

interface InitialAnalysisAttemptByAction {
  OPENCLAW_TRANSLATE?: CanonicalInitialAnalysisAttemptObservation;
  OPENCLAW_APPLICABILITY_EVALUATION?: CanonicalInitialAnalysisAttemptObservation;
  OPENCLAW_DYNAMIC_EVALUATION?: CanonicalInitialAnalysisAttemptObservation;
  OPENCLAW_OVERALL_SYNTHESIS?: CanonicalInitialAnalysisAttemptObservation;
}

@Injectable()
export class CanonicalHostInitialAnalysisStatusService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly attempts: ActionAttemptLifecycleService,
    @Optional() private readonly originalWork?: JobAidWorkRepository,
    @Optional() private readonly originalReader?: UnifiedReaderService,
    @Optional() private readonly applicabilityInputs?: CanonicalHostApplicabilityInputProducer,
  ) {}

  async project(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    expectedOriginalParseRunId?: string;
  }): Promise<AilyInitialAnalysisStatus> {
    const originalMode=process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1';
    const readPublished=() => this.db.select({id:dmDocumentParseRun.parseRunId}).from(dmDocumentParseRun)
      .where(and(eq(dmDocumentParseRun.tenantId,input.tenantId),eq(dmDocumentParseRun.documentVersionId,input.workItem.source.documentVersionId),
        eq(dmDocumentParseRun.status,'PUBLISHED'),sql`${dmDocumentParseRun.manifestArtifact}->>'relativePath' = 'original/manifest.json'`,
        sql`${dmDocumentParseRun.sourceBinding}->>'sourceArtifactId' = ${input.workItem.source.sourceArtifactId}`,
        sql`${dmDocumentParseRun.sourceBinding}->>'pdfSha256' = ${input.workItem.source.sourceFileSha256}`,
        sql`${dmDocumentParseRun.sourceBinding}->>'byteLength' = ${String(input.workItem.source.sourceByteLength)}`))
      .orderBy(desc(dmDocumentParseRun.parseRevision)).limit(1);
    let published: Array<{id:string}> | null=null;
    if (originalMode) {
      const [role]=await this.db.execute<{service:boolean}>(sql`SELECT starts_with(current_user::text,'service_role_') AS service`);
      if (role?.service) {
        if (!this.originalWork) throw new Error('ORIGINAL_STATUS_RUNTIME_UNAVAILABLE');
        const [owner]=await this.db.select({actor:workItem.requestedByUserId}).from(workItem)
          .where(and(eq(workItem.workItemId,input.workItem.workItemId),eq(workItem.tenantId,input.tenantId))).limit(1);
        if (!owner?.actor) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
        published=await this.originalWork.withActorScope(owner.actor,readPublished);
      } else published=await readPublished();
    }
    if (input.expectedOriginalParseRunId && published?.[0]?.id !== input.expectedOriginalParseRunId)
      throw new Error('JOBAID_ORIGINAL_REQUEST_CHANGED');
    const originalPublished=published === null ? undefined : published.length>0;
    if (!(originalPublished ?? isParsedPackageReady(input.workItem))) {
      return projectCanonicalHostInitialAnalysisStatus(input.workItem, [],{originalPublished});
    }
    const rows = await this.db
      .selectDistinctOn([actionAttempt.actionType], {
        attemptId: actionAttempt.attemptId,
        actionType: actionAttempt.actionType,
        attemptRef: actionAttempt.operationRef,
        status: actionAttempt.status,
        terminalReason: actionAttempt.terminalReason,
        errorCode: actionAttempt.errorCode,
        cancelReason: actionAttempt.cancelReason,
        executionModelJson: actionAttempt.executionModelJson,
        idempotencyKey: actionAttempt.idempotencyKey,
        baseRevision: actionAttempt.baseRevision,
        deadlineAt: actionAttempt.deadlineAt,
      })
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.workItemId, input.workItem.workItemId),
          eq(
            actionAttempt.documentVersionId,
            input.workItem.source.documentVersionId,
          ),
          eq(actionAttempt.requestOrigin, ACTION_ATTEMPT_REQUEST_ORIGIN),
          inArray(actionAttempt.actionType, [...INITIAL_ANALYSIS_ACTION_TYPES]),
        ),
      )
      .orderBy(actionAttempt.actionType, desc(actionAttempt.attemptNo));
    for (const row of rows) {
      if (row.status !== 'RUNNING' || !row.attemptRef || !row.deadlineAt || row.deadlineAt > new Date()) continue;
      const current = await this.attempts.reconcileRunningDeadline({
        attemptRef: row.attemptRef,
        tenantId: input.tenantId,
        workItemId: input.workItem.workItemId,
      });
      row.status = current.status;
      row.terminalReason = current.terminalReason;
      row.errorCode = current.errorCode;
      row.cancelReason = current.cancelReason;
    }
    const originalImpactStages: Partial<Record<OriginalEngineeringStage, boolean>> = {};
    const execution = activeConfigurationEvidenceReevaluation(input.workItem)
      ? configurationEvidenceShadow(input.workItem) : input.workItem;
    const savedAttempts = {
      applicability: execution.applicability?.actionAttemptId,
      jobAid: execution.integratedAssessment?.baseRules.actionAttemptId,
      overall: execution.integratedAssessment?.overallSynthesis?.actionAttemptId,
    };
    const savedIds = Object.values(savedAttempts).filter((id): id is string => !!id);
    if (published?.[0] && savedIds.length) {
      const bases = await this.db.select({
        attemptId: actionAttempt.attemptId,
        parseRunId: sql<string | null>`case when ${actionAttempt.taskEnvelopeJson} #>> '{modelInput,schemaVersion}' = 'wiselink.3_1.applicability_task.v3' then ${actionAttempt.taskEnvelopeJson} #>> '{modelInput,originalInput,binding,parseRunId}' else ${actionAttempt.taskEnvelopeJson} #>> '{modelInput,modelInput,documentOverview,original,binding,parseRunId}' end`,
      }).from(actionAttempt).where(and(eq(actionAttempt.tenantId, input.tenantId),
        eq(actionAttempt.workItemId, input.workItem.workItemId),
        eq(actionAttempt.documentVersionId, input.workItem.source.documentVersionId),
        inArray(actionAttempt.attemptId, savedIds))).limit(savedIds.length);
      const changedByRun = new Map<string, boolean>([[published[0].id, false]]);
      const differentRuns = [...new Set(bases.map(basis => basis.parseRunId)
        .filter((id): id is string => !!id && id !== published[0].id))];
      if (differentRuns.length) {
        if (!this.originalWork || !this.originalReader) throw new Error('ORIGINAL_STATUS_RUNTIME_UNAVAILABLE');
        const [owner] = await this.db.select({actor: workItem.requestedByUserId}).from(workItem)
          .where(and(eq(workItem.workItemId, input.workItem.workItemId), eq(workItem.tenantId, input.tenantId))).limit(1);
        if (!owner?.actor) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
        const scope = {tenantId: input.tenantId, actorUserId: owner.actor, roles: [] as string[]};
        await this.originalWork.withActorScope(owner.actor, async () => {
          const current = await this.originalReader!.readDocumentOriginal(input.workItem.source.documentVersionId, published[0].id, scope);
          for (const runId of differentRuns) {
            const previous = await this.originalReader!.readDocumentOriginal(input.workItem.source.documentVersionId, runId, scope);
            changedByRun.set(runId, compareDocumentOriginal(previous.original, current.original).kind !== 'LOCATOR_ONLY');
          }
        });
      }
      for (const stage of ORIGINAL_ENGINEERING_STAGES) {
        const attemptId = savedAttempts[stage];
        if (!attemptId) continue;
        const basis = bases.find(row => row.attemptId === attemptId);
        originalImpactStages[stage] = !basis?.parseRunId || changedByRun.get(basis.parseRunId) !== false;
      }
      // Overall also depends on the retained JobAid result, even if its own
      // task happened to read a newer original.
      if (originalImpactStages.jobAid) originalImpactStages.overall = true;
    }
    const originalAdmission = originalMode && originalPublished && !execution.applicabilityInput && this.applicabilityInputs
      ? await this.applicabilityInputs.readOriginalAdmissionContext({workItemId:input.workItem.workItemId,
          tenantId:input.tenantId,documentVersionId:input.workItem.source.documentVersionId}) : undefined;
    return projectCanonicalHostInitialAnalysisStatus(
      input.workItem,
      rows.map((row) => ({
        attemptId: row.attemptId,
        actionType: initialAnalysisActionType(row.actionType),
        attemptRef: row.attemptRef,
        status: row.status,
        baseRevision: row.baseRevision,
        terminalCode: initialAnalysisTerminalCode(row),
        executionModel: readStoredExecutionModel(row.executionModelJson),
        ...(continuationRequestId(row, input.workItem)
          ? { requestId: continuationRequestId(row, input.workItem)! }
          : {}),
      })),
      {
        originalPublished,
        originalImpactStages,
        originalAdmission,
        englishAssessmentEnabled:
          process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1',
      },
    );
  }

  async projectForBrowser(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
  }): Promise<CanonicalInitialAnalysisReadModel> {
    const status = await this.project(input);
    const execution = activeConfigurationEvidenceReevaluation(input.workItem)
      ? configurationEvidenceShadow(input.workItem)
      : input.workItem;
    const [root] = await this.db
      .select({ model: workItem.analysisModelJson })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.workItemId, input.workItem.workItemId),
        ),
      )
      .limit(1);
    const stage = (key: keyof typeof status.stages) => ({
      status: status.stages[key].status,
      terminalCode: status.stages[key].terminalCode,
      ...(status.stages[key].executionModel
        ? { executionModel: status.stages[key].executionModel }
        : {}),
    });
    const active = Object.values(status.stages).some(
      (value) =>
        value.attemptStatus &&
        ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
          value.attemptStatus,
        ),
    );
    const automatic =
      status.status !== 'NOT_READY' &&
      !active &&
      isOpenClawAutomaticReviewConfigured({
        tenantId: input.tenantId,
        workItemId: input.workItem.workItemId,
      });
    const canTranslate =
      automatic && isParsedPackageReady(input.workItem) && process.env.WL_TRANSLATION_V2_ENABLED === '1';
    const continuationOperations: NonNullable<
      CanonicalInitialAnalysisReadModel['continuationOperations']
    > = [];
    if (
      canTranslate &&
      (status.stages.translation.status !== 'SUCCEEDED' ||
        input.workItem.translation?.schemaVersion !==
          'wiselink.3_1.translation_candidate_projection.v2' ||
        input.workItem.translation.completeness !== 'COMPLETE')
    )
      continuationOperations.push('TRANSLATE');
    if (
      automatic &&
      process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1' &&
      (input.workItem.classification.normalizedFamily !== 'SB' ||
        input.workItem.classification.status === 'CONFIRMED')
    ) {
      if (
        ['FAILED', 'CONFLICT'].includes(status.stages.jobAid.status) &&
        canContinueInitialStage(
          status.stages,
          'EVALUATE_JOBAID',
          true,
          input.workItem,
        )
      )
        continuationOperations.push('EVALUATE_JOBAID');
      if (
        isJobAidProblemProjection(execution.integratedAssessment?.baseRules) &&
        ['FAILED', 'CONFLICT'].includes(status.stages.overall.status) &&
        canContinueInitialStage(
          status.stages,
          'SYNTHESIZE_OVERALL',
          true,
          input.workItem,
        )
      )
        continuationOperations.push('SYNTHESIZE_OVERALL');
    }
    let translationWork: CanonicalInitialAnalysisReadModel['translationWork'] =
      null;
    if (
      input.workItem.package &&
      (process.env.WL_TRANSLATION_V2_ENABLED === '1' ||
        input.workItem.translation?.schemaVersion ===
          'wiselink.3_1.translation_candidate_projection.v2')
    ) {
      const [saved] = await this.db
        .select({
          workspaceId: translationWorkspace.workspaceId,
          rowVersion: translationWorkspace.rowVersion,
        })
        .from(translationWorkspace)
        .where(
          and(
            eq(translationWorkspace.tenantId, input.tenantId),
            eq(translationWorkspace.workItemId, input.workItem.workItemId),
            eq(
              translationWorkspace.documentVersionId,
              input.workItem.source.documentVersionId,
            ),
            eq(
              translationWorkspace.parsedArtifactRef,
              input.workItem.package.artifact.ref,
            ),
            eq(
              translationWorkspace.parsedArtifactSha256,
              input.workItem.package.artifact.sha256,
            ),
            eq(translationWorkspace.targetLocale, 'zh-CN'),
          ),
        )
        .limit(1);
      translationWork = saved ?? null;
    }
    return {
      workItemId: input.workItem.workItemId,
      workItemRevision: status.workItemRevision,
      documentVersionId: status.documentVersionId,
      status: status.status,
      analysisModel: readStoredExecutionModel(root?.model),
      nextOperation: status.nextOperation,
      continuationOperations,
      canRequestBlockTranslation: canTranslate,
      translationWork,
      stages: {
        translation: stage('translation'),
        applicability: stage('applicability'),
        jobAid: stage('jobAid'),
        overall: stage('overall'),
      },
      candidateOnly: true,
    };
  }
}

export function initialAnalysisTerminalCode(row: {
  terminalReason: string | null;
  errorCode: string | null;
  cancelReason: string | null;
}): string | null {
  // The consumer cancels before commit on a model failure. Preserve its bounded
  // diagnostic code instead of hiding it behind the generic cancellation code.
  const executionFailure = row.cancelReason?.match(
    /^HOSTED_INITIAL_EXECUTION_FAILED:([A-Z][A-Z0-9_:.-]{0,199})$/u,
  );
  const code = executionFailure?.[1] ?? row.terminalReason ?? row.errorCode;
  return code && /^[A-Z][A-Z0-9_:.-]{0,199}$/u.test(code) ? code : null;
}

export function projectCanonicalHostInitialAnalysisStatus(
  workItem: CanonicalWorkItemProjection,
  attempts: readonly CanonicalInitialAnalysisAttemptObservation[],
  options: { originalAdmission?: {contextRef:string|null;reason:string|null}; englishAssessmentEnabled?: boolean; originalPublished?: boolean; originalImpactPending?: boolean; originalImpactStages?: Partial<Record<OriginalEngineeringStage, boolean>> } = {},
): AilyInitialAnalysisStatus {
  const attemptByAction = latestAttemptsByAction(attempts);
  const parsedPackageReady = options.originalPublished ?? isParsedPackageReady(workItem);
  const reevaluation = parsedPackageReady
    ? activeConfigurationEvidenceReevaluation(workItem)
    : null;
  const execution = reevaluation
    ? configurationEvidenceShadow(workItem)
    : workItem;
  const stages = parsedPackageReady
    ? {
        translation: projectStage(
          translationProjectionObservation(workItem),
          attemptByAction.OPENCLAW_TRANSLATE,
        ),
        applicability: reevaluation
          ? projectReevaluationStage(
              reevaluation.stages.applicability,
              applicabilityProjectionObservation(execution),
              attemptByAction.OPENCLAW_APPLICABILITY_EVALUATION,
              workItem.revision,
            )
          : projectApplicabilityStage(
              workItem,
              attemptByAction.OPENCLAW_APPLICABILITY_EVALUATION,
            ),
        jobAid: reevaluation
          ? projectReevaluationStage(
              reevaluation.stages.dynamic,
              jobAidProjectionObservation(execution),
              attemptByAction.OPENCLAW_DYNAMIC_EVALUATION,
              workItem.revision,
            )
          : projectStage(
              jobAidProjectionObservation(workItem),
              attemptByAction.OPENCLAW_DYNAMIC_EVALUATION,
            ),
        overall: reevaluation
          ? projectReevaluationStage(
              reevaluation.stages.overall,
              overallProjectionObservation(execution),
              attemptByAction.OPENCLAW_OVERALL_SYNTHESIS,
              workItem.revision,
            )
          : projectStage(
              overallProjectionObservation(workItem),
              attemptByAction.OPENCLAW_OVERALL_SYNTHESIS,
            ),
      }
    : pendingStages();
  if (options.originalAdmission && stages.applicability.terminalCode==='APPLICABILITY_SELECTION_REQUIRED') {
    stages.applicability=options.originalAdmission.contextRef ? pendingStage() :
      {...stages.applicability,terminalCode:options.originalAdmission.reason ?? 'APPLICABILITY_SELECTION_REQUIRED'};
  }
  if (options.originalImpactPending || options.originalImpactStages) {
    // Retain the exact historical candidate, but do not report it as assessed
    // against corrected source content. Active successors keep their own state.
    for (const key of ORIGINAL_ENGINEERING_STAGES) {
      if ((options.originalImpactPending || options.originalImpactStages?.[key]) &&
        (stages[key].status === 'SUCCEEDED' || (key === 'overall' && stages[key].status === 'CONFLICT' &&
          stages[key].terminalCode === 'OVERALL_PROJECTION_NOT_CURRENT'))) stages[key]={...stages[key],status:'CONFLICT',
        terminalCode:'DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED'};
    }
  }
  if (options.originalPublished && !workItem.package && !originalApplicabilityInputMatches(execution) && !options.originalAdmission?.contextRef && stages.applicability.status === 'PENDING')
    stages.applicability={...stages.applicability,status:'WAITING_INPUT',terminalCode:options.originalAdmission?.reason ?? 'ORIGINAL_APPLICABILITY_MAPPING_REQUIRED'};
  const progression = parsedPackageReady
    ? deriveProgression(
        stages,
        options.englishAssessmentEnabled === true,
        reevaluation !== null,
      )
    : { status: 'NOT_READY' as const, nextOperation: null };
  return {
    workItemRevision: workItem.revision,
    documentVersionId: workItem.source.documentVersionId,
    applicabilityContextRef: reevaluation
      ? (reevaluation.stagedBundle.applicabilityInput
          ?.applicabilityContextRef ?? null)
      : applicabilityContextRef(workItem) ?? options.originalAdmission?.contextRef ?? null,
    status: progression.status,
    nextOperation: progression.nextOperation,
    stages,
    candidateOnly: true,
  };
}

/** Retained serving results do not complete a stage in the active P0B cycle. */
function projectReevaluationStage(
  stage: CanonicalConfigurationEvidenceReevaluationStageProjection,
  projection: StageProjectionObservation,
  attempt: CanonicalInitialAnalysisAttemptObservation | undefined,
  workItemRevision: number,
): AilyInitialAnalysisStageStatus {
  const currentAttempt =
    attempt &&
    (attempt.attemptId === stage.attempt?.attemptId ||
      (['PENDING', 'RUNNING', 'COMMITTING'].includes(stage.status) &&
        attempt.baseRevision === workItemRevision))
      ? attempt
      : undefined;
  if (stage.status === 'SUCCEEDED')
    return projectStage(projection, currentAttempt);
  if (
    stage.status === 'WAITING_INPUT' ||
    stage.status === 'FAILED' ||
    stage.status === 'CONFLICT'
  ) {
    return {
      ...(currentAttempt
        ? attemptStageStatus(stage.status, currentAttempt)
        : pendingStage()),
      status: stage.status,
      attemptRef:
        currentAttempt?.attemptRef ?? stage.attempt?.attemptRef ?? null,
      terminalCode:
        stage.terminal?.code ?? currentAttempt?.terminalCode ?? null,
    };
  }
  if (currentAttempt) return projectStage(absentProjection(), currentAttempt);
  return {
    ...pendingStage(),
    status: stage.status === 'PENDING' ? 'PENDING' : 'BUSY',
  };
}

function projectApplicabilityStage(
  workItem: CanonicalWorkItemProjection,
  attempt: CanonicalInitialAnalysisAttemptObservation | undefined,
): AilyInitialAnalysisStageStatus {
  if (!workItem.applicability && !workItem.applicabilityInput && !attempt) {
    // No aircraft/configuration selection is not a model task or a false match.
    // Leave fleet matching explicitly waiting while document-level work proceeds.
    return {
      ...pendingStage(),
      status: 'WAITING_INPUT',
      terminalCode: 'APPLICABILITY_SELECTION_REQUIRED',
    };
  }
  return projectStage(applicabilityProjectionObservation(workItem), attempt);
}

function translationProjectionObservation(
  workItem: CanonicalWorkItemProjection,
): StageProjectionObservation {
  const translation = workItem.translation;
  if (!translation) return absentProjection();
  const supportedMethod =
    translation.schemaVersion ===
    'wiselink.3_1.translation_candidate_projection.v2'
      ? translation.ruleSetId === 'semantic-translation' &&
        translation.ruleSetVersion === '2.0'
      : translation.ruleSetId === CANONICAL_TRANSLATION_RULE_SET_V1_ID &&
        translation.ruleSetVersion ===
          CANONICAL_TRANSLATION_RULE_SET_V1_VERSION;
  if (
    translation.status === 'CANDIDATE_ONLY' &&
    translation.currentness === 'CURRENT' &&
    translation.documentVersionId === workItem.source.documentVersionId &&
    translation.sourcePackageId === workItem.package?.packageId &&
    translation.sourcePackageContentHash === workItem.package?.contentHash &&
    supportedMethod
  ) {
    return {
      ...successfulProjection(translation.actionAttemptId),
      terminalCode:
        translation.schemaVersion ===
          'wiselink.3_1.translation_candidate_projection.v2' &&
        translation.completeness !== 'COMPLETE'
          ? `TRANSLATION_${translation.completeness}_CANDIDATE_SAVED`
          : null,
    };
  }
  return staleProjection(
    translation.actionAttemptId,
    'TRANSLATION_PROJECTION_NOT_CURRENT',
  );
}

function applicabilityProjectionObservation(
  workItem: CanonicalWorkItemProjection,
): StageProjectionObservation {
  const applicability = workItem.applicability;
  if (!applicability) return absentProjection();
  const applicabilityInput = workItem.applicabilityInput;
  const original = applicabilityInput?.originalSource;
  const sourceCurrent = applicability.schemaVersion === 'wiselink.3_1.applicability_candidate_projection.v3'
    ? !!original && applicabilityInput?.sourcePackageId === null && applicabilityInput.sourcePackageContentHash === null &&
      applicability.sourcePackageId === null && applicability.sourcePackageContentHash === null &&
      canonicalJson(applicability.originalSource) === canonicalJson(original) &&
      original.binding.documentVersionId === workItem.source.documentVersionId &&
      original.binding.sourceArtifactId === workItem.source.sourceArtifactId &&
      original.binding.sourceSha256 === workItem.source.sourceFileSha256 &&
      original.binding.sourceByteLength === workItem.source.sourceByteLength &&
      applicability.sourceReadingMode === 'VERIFIED_ENGLISH' && applicability.translationActionAttemptId === null
    : applicabilityInput?.sourcePackageId === workItem.package?.packageId &&
      applicabilityInput?.sourcePackageContentHash === workItem.package?.contentHash &&
      applicability.sourcePackageId === workItem.package?.packageId &&
      applicability.sourcePackageContentHash === workItem.package?.contentHash &&
      (applicability.schemaVersion === 'wiselink.3_1.applicability_candidate_projection.v2'
        ? applicability.sourceReadingMode === 'VERIFIED_ENGLISH' && applicability.translationActionAttemptId === null
        : applicability.translationActionAttemptId === workItem.translation?.actionAttemptId);
  const current =
    applicabilityInput?.currentness === 'CURRENT' &&
    applicabilityInput.workItemId === workItem.workItemId &&
    applicabilityInput.documentVersionId ===
      workItem.source.documentVersionId &&
    sourceCurrent &&
    applicability.currentness === 'CURRENT' &&
    applicability.documentVersionId === workItem.source.documentVersionId &&
    applicability.applicabilityContextRef ===
      applicabilityInput?.applicabilityContextRef &&
    applicability.applicabilityBindingRevision ===
      applicabilityInput?.bindingRevision &&
    applicability.aircraftNumber === applicabilityInput?.aircraftNumber &&
    applicability.assessmentAsOf === applicabilityInput?.assessmentAsOf;
  if (current && applicability.status === 'CANDIDATE_ONLY') {
    return successfulProjection(applicability.actionAttemptId);
  }
  if (current && applicability.status === 'WAITING_INPUT') {
    return waitingInputProjection(applicability.actionAttemptId);
  }
  return staleProjection(
    applicability.actionAttemptId,
    'APPLICABILITY_PROJECTION_NOT_CURRENT',
  );
}

function jobAidProjectionObservation(
  workItem: CanonicalWorkItemProjection,
): StageProjectionObservation {
  const baseRules = workItem.integratedAssessment?.baseRules;
  if (!baseRules) return absentProjection();
  if (baseRules.status === 'CANDIDATE_ONLY') {
    return successfulProjection(baseRules.actionAttemptId);
  }
  return staleProjection(
    baseRules.actionAttemptId,
    'JOBAID_PROJECTION_NOT_CURRENT',
  );
}

function overallProjectionObservation(
  workItem: CanonicalWorkItemProjection,
): StageProjectionObservation {
  const integrated = workItem.integratedAssessment;
  const overall = integrated?.overallSynthesis;
  if (!overall) return absentProjection();
  if (
    integrated.status === 'OVERALL_CANDIDATE_READY' &&
    overall.status === 'CANDIDATE_ONLY' &&
    overall.staleReason === null &&
    overall.basedOnBaseRuleRevision === integrated.baseRules.revision &&
    overall.basedOnBaseRuleArtifactSha256 ===
      integrated.baseRules.artifact.sha256
  ) {
    return successfulProjection(overall.actionAttemptId);
  }
  return staleProjection(
    overall.actionAttemptId,
    'OVERALL_PROJECTION_NOT_CURRENT',
  );
}

function projectStage(
  projection: StageProjectionObservation,
  attempt: CanonicalInitialAnalysisAttemptObservation | undefined,
): AilyInitialAnalysisStageStatus {
  // A separately requested run is visible beside the retained earlier result.
  // QUEUED means the consumer may claim it; it is not an already running call.
  if (
    attempt?.requestId &&
    (attempt.attemptId !== projection.actionAttemptId ||
      ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
        attempt.status,
      ))
  ) {
    if (attempt.status === 'QUEUED')
      return attemptStageStatus('PENDING', attempt);
    if (['RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(attempt.status))
      return attemptStageStatus('BUSY', attempt);
    if (attempt.status === 'WAITING_INPUT')
      return attemptStageStatus('WAITING_INPUT', attempt);
    if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(attempt.status))
      return attemptStageStatus('FAILED', attempt);
    return attemptStageStatus('CONFLICT', attempt);
  }
  if (projection.status === 'SUCCEEDED') {
    return projectionStageStatus('SUCCEEDED', projection, attempt);
  }
  if (projection.status === 'WAITING_INPUT') {
    return projectionStageStatus('WAITING_INPUT', projection, attempt);
  }
  if (projection.status === 'STALE') {
    return {
      status: 'CONFLICT',
      attemptRef:
        attempt?.attemptId === projection.actionAttemptId
          ? attempt.attemptRef
          : null,
      attemptStatus:
        attempt?.attemptId === projection.actionAttemptId
          ? attempt.status
          : null,
      terminalCode: projection.terminalCode,
      ...(attempt?.attemptId === projection.actionAttemptId &&
      attempt.executionModel
        ? { executionModel: attempt.executionModel }
        : {}),
    };
  }
  if (!attempt) return pendingStage();
  switch (attempt.status) {
    case 'QUEUED':
    case 'RUNNING':
    case 'RETRY_SCHEDULED':
    case 'COMMITTING':
      return attemptStageStatus('BUSY', attempt);
    case 'WAITING_INPUT':
      return attemptStageStatus('WAITING_INPUT', attempt);
    case 'FAILED':
    case 'TIMED_OUT':
    case 'CANCELLED':
      return attemptStageStatus('FAILED', attempt);
    case 'CONFLICT':
    case 'OBSOLETE':
      return attemptStageStatus('CONFLICT', attempt);
    case 'SUCCEEDED':
      return {
        ...attemptStageStatus('CONFLICT', attempt),
        terminalCode: 'SUCCEEDED_ATTEMPT_WITHOUT_CURRENT_PROJECTION',
      };
    default:
      return {
        ...attemptStageStatus('CONFLICT', attempt),
        terminalCode: 'ACTION_ATTEMPT_STATUS_INVALID',
      };
  }
}

function projectionStageStatus(
  status: 'SUCCEEDED' | 'WAITING_INPUT',
  projection: StageProjectionObservation,
  attempt: CanonicalInitialAnalysisAttemptObservation | undefined,
): AilyInitialAnalysisStageStatus {
  const exactAttempt =
    attempt?.attemptId === projection.actionAttemptId ? attempt : undefined;
  return {
    status,
    attemptRef: exactAttempt?.attemptRef ?? null,
    attemptStatus: exactAttempt?.status ?? null,
    ...(exactAttempt?.executionModel
      ? { executionModel: exactAttempt.executionModel }
      : {}),
    terminalCode:
      status === 'WAITING_INPUT'
        ? (exactAttempt?.terminalCode ?? projection.terminalCode)
        : projection.terminalCode,
  };
}

function attemptStageStatus(
  status: AilyInitialAnalysisStageStatus['status'],
  attempt: CanonicalInitialAnalysisAttemptObservation,
): AilyInitialAnalysisStageStatus {
  return {
    status,
    ...(attempt.requestId ? { requestId: attempt.requestId } : {}),
    attemptRef: attempt.attemptRef,
    attemptStatus: attempt.status,
    terminalCode: attempt.terminalCode,
    ...(attempt.executionModel
      ? { executionModel: attempt.executionModel }
      : {}),
  };
}

function continuationRequestId(
  row: { actionType: string; idempotencyKey: string | null },
  item: CanonicalWorkItemProjection,
): string | null {
  const kind = {
    OPENCLAW_TRANSLATE: 'translate',
    OPENCLAW_DYNAMIC_EVALUATION: 'dynamic',
    OPENCLAW_OVERALL_SYNTHESIS: 'overall',
  }[row.actionType];
  if (!kind) return null;
  const prefix = `openclaw-v2:${kind}:${item.workItemId}:${item.source.documentVersionId}:`;
  if (!row.idempotencyKey?.startsWith(prefix)) return null;
  const requestId = row.idempotencyKey.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,64}$/u.test(requestId) ? requestId : null;
}

export function canContinueInitialStage(
  stages: AilyInitialAnalysisStatus['stages'],
  operation: Exclude<AilyInitialAnalysisOperation, 'EXTRACT_APPLICABILITY'>,
  englishAssessmentEnabled: boolean,
  workItem?: CanonicalWorkItemProjection,
): boolean {
  if (operation === 'TRANSLATE') return true;
  if (
    !(
      stages.translation.status === 'SUCCEEDED' ||
      (englishAssessmentEnabled &&
        ['PENDING', 'FAILED', 'CONFLICT'].includes(stages.translation.status))
    )
  )
    return false;
  if (!['SUCCEEDED', 'WAITING_INPUT'].includes(stages.applicability.status))
    return false;
  const reevaluation = workItem
    ? activeConfigurationEvidenceReevaluation(workItem)
    : null;
  if (
    reevaluation &&
    (reevaluation.stages.applicability.status !== 'SUCCEEDED' ||
      stages.applicability.status !== 'SUCCEEDED' ||
      (operation === 'SYNTHESIZE_OVERALL' &&
        reevaluation.stages.dynamic.status !== 'SUCCEEDED'))
  )
    return false;
  return (
    operation === 'EVALUATE_JOBAID' || stages.jobAid.status === 'SUCCEEDED'
  );
}

function deriveProgression(
  stages: AilyInitialAnalysisStatus['stages'],
  englishAssessmentEnabled: boolean,
  configurationReevaluationActive = false,
): Pick<AilyInitialAnalysisStatus, 'status' | 'nextOperation'> {
  const ordered: Array<{
    stage: AilyInitialAnalysisStageStatus;
    operation: AilyInitialAnalysisOperation;
  }> = [
    ...(!englishAssessmentEnabled
      ? [{ stage: stages.translation, operation: 'TRANSLATE' as const }]
      : []),
    { stage: stages.applicability, operation: 'EXTRACT_APPLICABILITY' },
    { stage: stages.jobAid, operation: 'EVALUATE_JOBAID' },
    { stage: stages.overall, operation: 'SYNTHESIZE_OVERALL' },
    ...(englishAssessmentEnabled && (stages.translation.status === 'BUSY' ||
      (stages.translation.status === 'PENDING' && !!stages.translation.requestId))
      ? [{ stage: stages.translation, operation: 'TRANSLATE' as const }]
      : []),
  ];
  // Verified-English analysis consumes the parsed source directly. A new
  // translation must not delay that analysis, while a running attempt or an
  // explicit continuation retains its existing execution and CAS ownership.
  if (ordered.some((item) => item.stage.status === 'BUSY'))
    return { status: 'BUSY', nextOperation: null };
  const requested = ordered.find(
    (item) => item.stage.status === 'PENDING' && item.stage.requestId,
  );
  if (requested)
    return { status: 'REQUIRED', nextOperation: requested.operation };
  let hasNonBlockingMissingInput = false;
  for (const item of ordered) {
    if (item.stage.status === 'SUCCEEDED') continue;
    if (
      item.operation === 'EXTRACT_APPLICABILITY' &&
      item.stage.status === 'WAITING_INPUT' &&
      !configurationReevaluationActive
    ) {
      hasNonBlockingMissingInput = true;
      continue;
    }
    if (item.stage.status === 'PENDING') {
      return {
        status: hasNonBlockingMissingInput ? 'WAITING_INPUT' : 'REQUIRED',
        nextOperation: item.operation,
      };
    }
    return { status: item.stage.status, nextOperation: null };
  }
  return {
    status: hasNonBlockingMissingInput ? 'WAITING_INPUT' : 'SUCCEEDED',
    nextOperation: null,
  };
}

function latestAttemptsByAction(
  attempts: readonly CanonicalInitialAnalysisAttemptObservation[],
): InitialAnalysisAttemptByAction {
  const indexed: InitialAnalysisAttemptByAction = {};
  for (const attempt of attempts) {
    indexed[attempt.actionType] ??= attempt;
  }
  return indexed;
}

function pendingStages(): AilyInitialAnalysisStatus['stages'] {
  return {
    translation: pendingStage(),
    applicability: pendingStage(),
    jobAid: pendingStage(),
    overall: pendingStage(),
  };
}

function pendingStage(): AilyInitialAnalysisStageStatus {
  return {
    status: 'PENDING',
    attemptRef: null,
    attemptStatus: null,
    terminalCode: null,
  };
}

function absentProjection(): StageProjectionObservation {
  return { status: 'ABSENT', actionAttemptId: null, terminalCode: null };
}

function successfulProjection(
  actionAttemptId: string,
): StageProjectionObservation {
  return {
    status: 'SUCCEEDED',
    actionAttemptId,
    terminalCode: null,
  };
}

function waitingInputProjection(
  actionAttemptId: string,
): StageProjectionObservation {
  return {
    status: 'WAITING_INPUT',
    actionAttemptId,
    terminalCode: 'HOST_MISSING_CONTROLLED_FACTS',
  };
}

function staleProjection(
  actionAttemptId: string,
  terminalCode: string,
): StageProjectionObservation {
  return { status: 'STALE', actionAttemptId, terminalCode };
}

function applicabilityContextRef(
  workItem: CanonicalWorkItemProjection,
): string | null {
  const value = workItem.applicabilityInput?.applicabilityContextRef;
  return typeof value === 'string' && value.trim() ? value : null;
}

function isParsedPackageReady(workItem: CanonicalWorkItemProjection): boolean {
  return (
    workItem.phase === 'CANDIDATE_READBACK_VERIFIED' &&
    workItem.package?.contractId === 'techpub.parsed-package.v1' &&
    workItem.package.contractRevision === 'frozen.2'
  );
}

function initialAnalysisActionType(value: string): InitialAnalysisActionType {
  if (
    INITIAL_ANALYSIS_ACTION_TYPES.includes(value as InitialAnalysisActionType)
  ) {
    return value as InitialAnalysisActionType;
  }
  throw new Error('INITIAL_ANALYSIS_ACTION_TYPE_INVALID');
}
