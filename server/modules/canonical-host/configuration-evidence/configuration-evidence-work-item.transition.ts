import type {
  CanonicalConfigurationEvidenceCurrentProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

import type { ConfigurationSnapshot } from './configuration-snapshot.types';
import type { ConfigurationEvidenceTruthSummary } from './configuration-evidence.persistence.types';
import { createConfigurationEvidenceReevaluation } from './configuration-evidence-reevaluation.state';

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
  const reevaluation = createConfigurationEvidenceReevaluation({
    triggerSnapshotId: input.snapshotId,
    triggerConfigurationRevision: input.configurationRevision,
    adoptionWorkItemRevision: revision,
  });
  return {
    ...structuredClone(input.current),
    revision,
    configurationEvidenceCurrent: currentPointer,
    configurationEvidenceReevaluation: reevaluation,
  };
}
