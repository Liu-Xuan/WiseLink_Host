import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type {
  AilyInitialAnalysisOperation,
  AilyInitialAnalysisStageStatus,
  AilyInitialAnalysisStatus,
  CanonicalInitialAnalysisReadModel,
  CanonicalExecutionModelSelection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import { actionAttempt, workItem } from '../../database/schema';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../action-attempt/action-attempt.types';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
} from './canonical-translation-rule-set-v1.private';

const INITIAL_ANALYSIS_ACTION_TYPES = [
  'OPENCLAW_TRANSLATE',
  'OPENCLAW_APPLICABILITY_EVALUATION',
  'OPENCLAW_DYNAMIC_EVALUATION',
  'OPENCLAW_OVERALL_SYNTHESIS',
] as const;

type InitialAnalysisActionType = (typeof INITIAL_ANALYSIS_ACTION_TYPES)[number];

export interface CanonicalInitialAnalysisAttemptObservation {
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
  ) {}

  async project(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
  }): Promise<AilyInitialAnalysisStatus> {
    if (!isParsedPackageReady(input.workItem)) {
      return projectCanonicalHostInitialAnalysisStatus(input.workItem, []);
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
    return projectCanonicalHostInitialAnalysisStatus(
      input.workItem,
      rows.map((row) => ({
        attemptId: row.attemptId,
        actionType: initialAnalysisActionType(row.actionType),
        attemptRef: row.attemptRef,
        status: row.status,
        terminalCode: initialAnalysisTerminalCode(row),
        executionModel: readStoredExecutionModel(row.executionModelJson),
      })),
      { englishAssessmentEnabled: process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1' },
    );
  }

  async projectForBrowser(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
  }): Promise<CanonicalInitialAnalysisReadModel> {
    const status = await this.project(input);
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
    return {
      workItemId: input.workItem.workItemId,
      workItemRevision: status.workItemRevision,
      documentVersionId: status.documentVersionId,
      status: status.status,
      analysisModel: readStoredExecutionModel(root?.model),
      nextOperation: status.nextOperation,
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
  options: { englishAssessmentEnabled?: boolean } = {},
): AilyInitialAnalysisStatus {
  const attemptByAction = latestAttemptsByAction(attempts);
  const parsedPackageReady = isParsedPackageReady(workItem);
  const stages = parsedPackageReady
    ? {
        translation: projectStage(
          translationProjectionObservation(workItem),
          attemptByAction.OPENCLAW_TRANSLATE,
        ),
        applicability: projectApplicabilityStage(
          workItem,
          attemptByAction.OPENCLAW_APPLICABILITY_EVALUATION,
        ),
        jobAid: projectStage(
          jobAidProjectionObservation(workItem),
          attemptByAction.OPENCLAW_DYNAMIC_EVALUATION,
        ),
        overall: projectStage(
          overallProjectionObservation(workItem),
          attemptByAction.OPENCLAW_OVERALL_SYNTHESIS,
        ),
      }
    : pendingStages();
  const progression = parsedPackageReady
    ? deriveProgression(stages, options.englishAssessmentEnabled === true)
    : { status: 'NOT_READY' as const, nextOperation: null };
  return {
    workItemRevision: workItem.revision,
    documentVersionId: workItem.source.documentVersionId,
    applicabilityContextRef: applicabilityContextRef(workItem),
    status: progression.status,
    nextOperation: progression.nextOperation,
    stages,
    candidateOnly: true,
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
  const supportedMethod = translation.schemaVersion === 'wiselink.3_1.translation_candidate_projection.v2'
    ? translation.ruleSetId === 'semantic-translation' && translation.ruleSetVersion === '2.0'
    : translation.ruleSetId === CANONICAL_TRANSLATION_RULE_SET_V1_ID && translation.ruleSetVersion === CANONICAL_TRANSLATION_RULE_SET_V1_VERSION;
  if (
    translation.status === 'CANDIDATE_ONLY' &&
    translation.currentness === 'CURRENT' &&
    translation.documentVersionId === workItem.source.documentVersionId &&
    translation.sourcePackageId === workItem.package?.packageId &&
    translation.sourcePackageContentHash === workItem.package?.contentHash &&
    supportedMethod
  ) {
    return { ...successfulProjection(translation.actionAttemptId),
      terminalCode: translation.schemaVersion === 'wiselink.3_1.translation_candidate_projection.v2' && translation.completeness !== 'COMPLETE'
        ? `TRANSLATION_${translation.completeness}_CANDIDATE_SAVED` : null };
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
  const current =
    applicabilityInput?.currentness === 'CURRENT' &&
    applicabilityInput.workItemId === workItem.workItemId &&
    applicabilityInput.documentVersionId ===
      workItem.source.documentVersionId &&
    applicabilityInput.sourcePackageId === workItem.package?.packageId &&
    applicabilityInput.sourcePackageContentHash ===
      workItem.package?.contentHash &&
    applicability.currentness === 'CURRENT' &&
    applicability.documentVersionId === workItem.source.documentVersionId &&
    applicability.sourcePackageId === workItem.package?.packageId &&
    applicability.sourcePackageContentHash === workItem.package?.contentHash &&
    (applicability.schemaVersion === 'wiselink.3_1.applicability_candidate_projection.v2'
      ? applicability.sourceReadingMode === 'VERIFIED_ENGLISH' && applicability.translationActionAttemptId === null
      : applicability.translationActionAttemptId === workItem.translation?.actionAttemptId) &&
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
    attemptRef: attempt.attemptRef,
    attemptStatus: attempt.status,
    terminalCode: attempt.terminalCode,
    ...(attempt.executionModel
      ? { executionModel: attempt.executionModel }
      : {}),
  };
}

function deriveProgression(
  stages: AilyInitialAnalysisStatus['stages'],
  englishAssessmentEnabled: boolean,
): Pick<AilyInitialAnalysisStatus, 'status' | 'nextOperation'> {
  const ordered: Array<{
    stage: AilyInitialAnalysisStageStatus;
    operation: AilyInitialAnalysisOperation;
  }> = [
    { stage: stages.translation, operation: 'TRANSLATE' },
    { stage: stages.applicability, operation: 'EXTRACT_APPLICABILITY' },
    { stage: stages.jobAid, operation: 'EVALUATE_JOBAID' },
    { stage: stages.overall, operation: 'SYNTHESIZE_OVERALL' },
  ];
  let hasNonBlockingMissingInput = false;
  let deferredTranslationStatus: 'FAILED' | 'CONFLICT' | null = null;
  for (const item of ordered) {
    if (item.stage.status === 'SUCCEEDED') continue;
    if (englishAssessmentEnabled && item.operation === 'TRANSLATE' && ['FAILED', 'CONFLICT'].includes(item.stage.status)) {
      deferredTranslationStatus = item.stage.status === 'FAILED' ? 'FAILED' : 'CONFLICT';
      continue;
    }
    if (
      item.operation === 'EXTRACT_APPLICABILITY' &&
      item.stage.status === 'WAITING_INPUT'
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
    status: deferredTranslationStatus ?? (hasNonBlockingMissingInput ? 'WAITING_INPUT' : 'SUCCEEDED'),
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
