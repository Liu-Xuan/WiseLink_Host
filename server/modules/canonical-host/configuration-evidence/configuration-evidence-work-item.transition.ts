import type {
  CanonicalConfigurationEvidenceCurrentProjection,
  CanonicalConfigurationEvidenceReevaluationProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import type { ConfigurationSnapshot } from './configuration-snapshot.types';
import type { ConfigurationEvidenceTruthSummary } from './configuration-evidence.persistence.types';

export function adoptConfigurationEvidenceIntoWorkItem(input: {
  current: CanonicalWorkItemProjection;
  snapshotId: string;
  configurationRevision: number;
  snapshot: ConfigurationSnapshot;
  truthSummary: ConfigurationEvidenceTruthSummary;
  recordedAt: string;
}): CanonicalWorkItemProjection {
  const revision: number = input.current.revision + 1;
  const currentPointer: CanonicalConfigurationEvidenceCurrentProjection = {
    schemaVersion: 'wiselink.3_1.configuration_evidence_work_item_current.v1',
    snapshotId: input.snapshotId,
    configurationRevision: input.configurationRevision,
    aircraftAssetId: input.snapshot.aircraftAssetId,
    assessmentAsOf: input.snapshot.assessmentAsOf,
    sourceCompleteness: input.snapshot.coverage.sourceCompleteness,
    truthSummary: structuredClone(input.truthSummary),
    recordedAt: input.recordedAt,
    authority: 'WORK_ITEM_CURRENT_EVIDENCE_VIEW',
    globalAircraftCurrentChanged: false,
  };
  const reevaluation: CanonicalConfigurationEvidenceReevaluationProjection = {
    schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v1',
    trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
    triggerSnapshotId: input.snapshotId,
    triggerConfigurationRevision: input.configurationRevision,
    adoptionWorkItemRevision: revision,
    mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
    status: 'REQUIRED',
    applicability: 'STALE_OR_NOT_AVAILABLE',
    jobAid: 'FULL_RERUN_REQUIRED',
    overall: 'STALE_OR_NOT_AVAILABLE',
    candidateOnly: true,
  };
  return {
    ...structuredClone(input.current),
    revision,
    configurationEvidenceCurrent: currentPointer,
    configurationEvidenceReevaluation: reevaluation,
    applicabilityInput: staleApplicabilityInput(input.current),
    applicability: staleApplicability(input.current),
    assessment: staleAssessment(input.current),
    integratedAssessment: staleIntegratedAssessment(input.current),
  };
}

function staleApplicabilityInput(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection['applicabilityInput'] {
  const current = workItem.applicabilityInput;
  return current ? { ...current, currentness: 'STALE' } : (current ?? null);
}

function staleApplicability(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection['applicability'] {
  const current = workItem.applicability;
  if (!current) return current ?? null;
  return {
    ...current,
    status: 'STALE',
    currentness: 'STALE',
    staleReason: 'FLEET_FACTS_CHANGED',
  };
}

function staleAssessment(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection['assessment'] {
  const current = workItem.assessment;
  if (!current) return current ?? null;
  return {
    ...current,
    previousOverallStale: true,
    staleReason: 'EXTERNAL_CONTEXT_STALE',
  };
}

function staleIntegratedAssessment(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection['integratedAssessment'] {
  const current = workItem.integratedAssessment;
  if (!current?.overallSynthesis) return current ?? null;
  return {
    ...current,
    status: 'OVERALL_CANDIDATE_STALE',
    overallSynthesis: {
      ...current.overallSynthesis,
      status: 'STALE',
      staleReason: 'BASE_RULE_RESULT_CHANGED',
    },
    overallForAeoConfirmation: null,
  };
}
