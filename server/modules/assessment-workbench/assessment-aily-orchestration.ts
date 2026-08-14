import type { EvaluationContextPackageResponse } from '@shared/assessment-host.interface';

import {
  buildControlledAilyHolisticDynamicInput,
  type ControlledAilyHolisticDynamicInput,
} from './aily-holistic-assessment';
import {
  buildEvaluationContextPackage,
} from './evaluation-context.service';
import {
  consumeReviewedExternalOemKnowledge,
} from './external-oem-knowledge.consumer';
import {
  buildSbJobAidAssessmentPackage,
} from './job-aid-runtime/assessmentPackage.js';
import {
  buildUnifiedAssessmentSnapshot,
} from './unified-assessment-snapshot';
import {
  buildUnifiedSbJobAidAssessmentInput,
  type BuildUnifiedAssessmentInputOptions,
} from './unified-assessment-input';

const buildRuntimeAssessment = buildSbJobAidAssessmentPackage as unknown as
  (value: Record<string, unknown>) => Record<string, any>;

export interface JobAidSourceIdentityForAssessment {
  status: string;
  sourceManifestHash: string;
  allowsCandidateOnlyAssessment: boolean;
  blocksEngineeringClosure: boolean;
  blocksRulePromotion: boolean;
}

export interface EvaluateByJobAidForAilyOptions
  extends BuildUnifiedAssessmentInputOptions {
  workItemId: string;
  rulePack: Record<string, unknown>;
  rulePackHash: string;
  criterionSet: Record<string, any>;
  jobAidSourceIdentity: JobAidSourceIdentityForAssessment;
  generatedAt: string;
}

export interface AilyJobAidEvaluationCandidate {
  operation: 'assessment.evaluate_by_job_aid';
  workItemId: string;
  assessmentPackage: Record<string, any>;
  snapshot: ReturnType<typeof buildUnifiedAssessmentSnapshot>;
  context: EvaluationContextPackageResponse;
  jobAidSourceIdentity: JobAidSourceIdentityForAssessment;
  warningCodes: string[];
  authorityBoundary: {
    candidateOnly: true;
    blocksEngineeringClosure: boolean;
    blocksRulePromotion: boolean;
    createsEngineerDecision: false;
    createsClosureDecision: false;
    createsAirworthinessConclusion: false;
  };
}

export interface AilyOverallSynthesisCandidate {
  operation: 'assessment.synthesize_overall';
  workItemId: string;
  assessmentPackageId: string;
  context: EvaluationContextPackageResponse;
  transport: ControlledAilyHolisticDynamicInput;
  warningCodes: string[];
  authorityBoundary: AilyJobAidEvaluationCandidate['authorityBoundary'];
}

/**
 * Internal orchestration used by the canonical host after it has fresh-read the
 * WorkItem and its accepted ParsedPackage. It does not expose an HTTP endpoint,
 * persist a second WorkItem, or let Aily provide an authority envelope.
 */
export function evaluateByJobAidForAily(
  options: EvaluateByJobAidForAilyOptions,
): AilyJobAidEvaluationCandidate {
  const workItemId = requiredIdentity(options.workItemId, 'workItemId');
  const input = buildUnifiedSbJobAidAssessmentInput({
    documentVersionBinding: options.documentVersionBinding,
    artifactBytes: options.artifactBytes,
    assessmentAsOf: options.assessmentAsOf,
  });
  const assessmentPackage = buildRuntimeAssessment({
    input,
    rulePack: options.rulePack,
    rulePackHash: options.rulePackHash,
    criterionSet: options.criterionSet,
    generatedAt: options.generatedAt,
  }) as Record<string, any>;
  const snapshot = buildUnifiedAssessmentSnapshot(assessmentPackage);
  const context = buildEvaluationContextPackage(snapshot);
  const warningCodes = collectWarningCodes(
    options.jobAidSourceIdentity,
    assessmentPackage,
  );

  return {
    operation: 'assessment.evaluate_by_job_aid',
    workItemId,
    assessmentPackage,
    snapshot,
    context,
    jobAidSourceIdentity: { ...options.jobAidSourceIdentity },
    warningCodes,
    authorityBoundary: {
      candidateOnly: true,
      blocksEngineeringClosure:
        options.jobAidSourceIdentity.blocksEngineeringClosure,
      blocksRulePromotion: options.jobAidSourceIdentity.blocksRulePromotion,
      createsEngineerDecision: false,
      createsClosureDecision: false,
      createsAirworthinessConclusion: false,
    },
  };
}

/**
 * Reuses the existing EvaluationContextPackage/holistic transport. The only
 * added input is the already-frozen external OEM manifest; discovery snippets
 * never enter the model input, while reviewed DM DocumentVersion references do.
 */
export function prepareOverallSynthesisWithReviewedExternalOemKnowledgeForAily(
  evaluated: AilyJobAidEvaluationCandidate,
  manifest: unknown,
): AilyOverallSynthesisCandidate {
  const current = evaluated.context.manifest;
  const externalKnowledge = consumeReviewedExternalOemKnowledge(manifest, {
    workItemId: evaluated.workItemId,
    assessmentCaseId: evaluated.assessmentPackage.packageId,
    documentId: current.documentId,
    documentVersionId: current.documentVersionId,
    assessmentAsOf: current.assessmentAsOf,
    parsedPackage: {
      packageId: current.parsedPackage.packageId,
      contractRevision: current.parsedPackage.contractRevision,
      artifactRef: current.parsedPackage.artifactRef,
      artifactHash: current.parsedPackage.artifactHash,
      semanticHash: current.parsedPackage.semanticHash,
    },
    jobAid: {
      criterionSetId: current.jobAidRuleSet.criterionSetId,
      criterionSetHash: current.jobAidRuleSet.criterionSetHash,
      memberIdentityHash:
        current.jobAidRuleSet.criterionSetMemberIdentityHash,
      criterionCount: current.jobAidRuleSet.criteriaCount,
      ruleArtifactRef: current.jobAidRuleSet.ruleArtifactRef,
      ruleArtifactVersion: current.jobAidRuleSet.ruleArtifactVersion,
      ruleArtifactDigest: current.jobAidRuleSet.ruleArtifactDigest,
      sourceManifestHash:
        evaluated.jobAidSourceIdentity.sourceManifestHash,
    },
  });
  const context = buildEvaluationContextPackage(evaluated.snapshot, {
    knowledgeContext: externalKnowledge,
  });
  const synthesis = prepareOverallSynthesisForAily(evaluated, context);
  return {
    ...synthesis,
    warningCodes: [
      ...new Set([
        ...synthesis.warningCodes,
        'EXTERNAL_OEM_REVIEWED_REFERENCE_ONLY',
        ...(externalKnowledge.status === 'AVAILABLE_WITH_VERSION_GAPS'
          ? ['EXTERNAL_OEM_CONTEXT_GAPS_VISIBLE']
          : []),
      ]),
    ],
  };
}

/**
 * Prepares the complete dynamic-N context for the strongest allowed model.
 * The optional context supports explicit engineer-change resynthesis while the
 * WorkItem identity remains inherited from the evaluated candidate.
 */
export function prepareOverallSynthesisForAily(
  evaluated: AilyJobAidEvaluationCandidate,
  context: EvaluationContextPackageResponse = evaluated.context,
): AilyOverallSynthesisCandidate {
  if (
    context.manifest.assessmentPackageId !==
      evaluated.assessmentPackage.packageId
  ) {
    throw new Error('AILY_ASSESSMENT_CONTEXT_PACKAGE_MISMATCH');
  }
  return {
    operation: 'assessment.synthesize_overall',
    workItemId: evaluated.workItemId,
    assessmentPackageId: evaluated.assessmentPackage.packageId,
    context,
    transport: buildControlledAilyHolisticDynamicInput(context),
    warningCodes: [...evaluated.warningCodes],
    authorityBoundary: { ...evaluated.authorityBoundary },
  };
}

function collectWarningCodes(
  sourceIdentity: JobAidSourceIdentityForAssessment,
  assessmentPackage: Record<string, any>,
): string[] {
  const warnings: string[] = [];
  if (sourceIdentity.status === 'SOURCE_IDENTITY_MISMATCH') {
    warnings.push('SOURCE_IDENTITY_MISMATCH');
  }
  if (assessmentPackage.unifiedParsedPackageBinding?.resultStatus !== 'complete') {
    warnings.push('PARSED_PACKAGE_STRUCTURED_COVERAGE_PARTIAL');
  }
  if (
    assessmentPackage.assessmentPayload?.applicability?.predicates?.length === 0
  ) {
    warnings.push('FLEET_FACTS_AND_APPLICABILITY_PREDICATES_NOT_BOUND');
  }
  return warnings;
}

function requiredIdentity(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`AILY_ASSESSMENT_${field.toUpperCase()}_REQUIRED`);
  return normalized;
}
