import { Injectable } from '@nestjs/common';

import type {
  EvaluationContextPackageResponse,
  SbJobAidShadowSnapshotResponse,
} from '@shared/assessment-host.interface';

import {
  evaluateByJobAidForAily,
  prepareOverallSynthesisForAily,
  prepareOverallSynthesisWithReviewedExternalOemKnowledgeForAily,
  type AilyJobAidEvaluationCandidate,
  type AilyOverallSynthesisCandidate,
  type EvaluateByJobAidForAilyOptions,
} from './assessment-aily-orchestration';
import { buildEvaluationContextPackage } from './evaluation-context.service';
import {
  prepareExternalDiscoveryCandidateDraftForAily,
  type ExternalDiscoveryCandidateDraft,
  type HostedOpenClawDiscoveryResult,
} from './external-discovery-assessment';

export interface AssessmentHostCandidateRequest {
  assessment: EvaluateByJobAidForAilyOptions;
  externalDiscovery?: HostedOpenClawDiscoveryResult | null;
  reviewedExternalOemManifest?: unknown | null;
}

export interface AssessmentHostCandidateSummary {
  workItemId: string;
  documentVersionId: string;
  parsedPackageId: string;
  criterionSetId: string;
  criterionCount: number;
  evaluationItemCount: number;
  packageStatus: string;
  applicabilityOverall: string;
  authorityLevel: 'candidate_only';
  warningCodes: string[];
  blocksEngineeringClosure: boolean;
}

export interface AssessmentHostStaleState {
  previousOverallStale: boolean;
  reason: 'ENGINEER_ITEM_SET_CHANGED' | 'EXTERNAL_CONTEXT_STALE' | null;
  previousContextHash: string | null;
  currentContextHash: string;
  previousTransportHash: string | null;
  currentTransportHash: string;
}

export interface AssessmentHostCandidateResult {
  evaluation: AilyJobAidEvaluationCandidate;
  candidateArtifact: Record<string, any>;
  overall: AilyOverallSynthesisCandidate;
  externalDiscovery: ExternalDiscoveryCandidateDraft | null;
  summary: AssessmentHostCandidateSummary;
  staleState: AssessmentHostStaleState;
}

/**
 * Ordinary in-process Nest seam for the canonical Miaoda host. The host owns
 * HTTP, login/authorization, WorkItem fresh-read and persistence; this provider
 * only consumes those already-resolved inputs and returns candidate artifacts.
 */
@Injectable()
export class AssessmentHostConsumerService {
  runCandidate(
    request: AssessmentHostCandidateRequest,
  ): AssessmentHostCandidateResult {
    const evaluation = evaluateByJobAidForAily(request.assessment);
    const overall = request.reviewedExternalOemManifest
      ? prepareOverallSynthesisWithReviewedExternalOemKnowledgeForAily(
          evaluation,
          request.reviewedExternalOemManifest,
        )
      : prepareOverallSynthesisForAily(evaluation);
    return this.result(
      evaluation,
      overall,
      request.externalDiscovery ?? null,
      false,
      null,
      null,
      null,
    );
  }

  resynthesizeAfterEngineerChange(
    previous: AssessmentHostCandidateResult,
    changedSnapshot: SbJobAidShadowSnapshotResponse,
    externalDiscovery: HostedOpenClawDiscoveryResult | null = null,
    reviewedExternalOemManifest: unknown | null = null,
  ): AssessmentHostCandidateResult {
    const changedContext = buildEvaluationContextPackage(changedSnapshot);
    const changedEvaluation = {
      ...previous.evaluation,
      snapshot: changedSnapshot,
      context: changedContext,
    };
    const overall = reviewedExternalOemManifest
      ? prepareOverallSynthesisWithReviewedExternalOemKnowledgeForAily(
          changedEvaluation,
          reviewedExternalOemManifest,
        )
      : prepareOverallSynthesisForAily(changedEvaluation, changedContext);
    const stale = previous.overall.context.contextHash !== changedContext.contextHash
      || previous.overall.transport.transportHash !== overall.transport.transportHash;
    return this.result(
      previous.evaluation,
      overall,
      externalDiscovery,
      stale,
      stale ? 'ENGINEER_ITEM_SET_CHANGED' : null,
      previous.overall.context,
      previous.overall.transport.transportHash,
    );
  }

  resynthesizeAfterReviewedExternalChange(
    previous: AssessmentHostCandidateResult,
    reviewedExternalOemManifest: unknown,
    externalDiscovery: HostedOpenClawDiscoveryResult | null = null,
  ): AssessmentHostCandidateResult {
    const overall =
      prepareOverallSynthesisWithReviewedExternalOemKnowledgeForAily(
        previous.evaluation,
        reviewedExternalOemManifest,
      );
    const stale = previous.overall.context.contextHash !== overall.context.contextHash
      || previous.overall.transport.transportHash !== overall.transport.transportHash;
    return this.result(
      previous.evaluation,
      overall,
      externalDiscovery,
      stale,
      stale ? 'EXTERNAL_CONTEXT_STALE' : null,
      previous.overall.context,
      previous.overall.transport.transportHash,
    );
  }

  private result(
    evaluation: AilyJobAidEvaluationCandidate,
    overall: AilyOverallSynthesisCandidate,
    externalInput: HostedOpenClawDiscoveryResult | null,
    previousOverallStale: boolean,
    staleReason: AssessmentHostStaleState['reason'],
    previousContext: EvaluationContextPackageResponse | null,
    previousTransportHash: string | null,
  ): AssessmentHostCandidateResult {
    const externalDiscovery = externalInput
      ? prepareExternalDiscoveryCandidateDraftForAily(
          evaluation,
          externalInput,
          overall.context,
        )
      : null;
    const manifest = overall.context.manifest;
    const itemCount = overall.context.criterionCards.length;
    return {
      evaluation,
      candidateArtifact: evaluation.assessmentPackage,
      overall,
      externalDiscovery,
      summary: {
        workItemId: evaluation.workItemId,
        documentVersionId: manifest.documentVersionId,
        parsedPackageId: manifest.parsedPackage.packageId,
        criterionSetId: manifest.jobAidRuleSet.criterionSetId,
        criterionCount: manifest.jobAidRuleSet.criteriaCount,
        evaluationItemCount: itemCount,
        packageStatus: evaluation.assessmentPackage.status,
        applicabilityOverall:
          overall.context.currentAssessment.applicabilityOverall,
        authorityLevel: 'candidate_only',
        warningCodes: [...new Set([
          ...overall.warningCodes,
          ...(externalDiscovery?.warningCodes ?? []),
        ])],
        blocksEngineeringClosure:
          evaluation.authorityBoundary.blocksEngineeringClosure,
      },
      staleState: {
        previousOverallStale,
        reason: staleReason,
        previousContextHash: previousContext?.contextHash ?? null,
        currentContextHash: overall.context.contextHash,
        previousTransportHash,
        currentTransportHash: overall.transport.transportHash,
      },
    };
  }
}
