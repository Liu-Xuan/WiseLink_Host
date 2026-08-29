import type { InstallationEventEvidenceProjection } from './installation-event-evidence.types';
import {
  configurationDependencyObservation,
  configurationObservationVersion,
  configurationSourceSliceRef,
  configurationTargetKey,
} from './configuration-snapshot.mapper';
import type {
  ConfigurationEvidenceIdentityRef,
  ConfigurationPredicateDependencyObservation,
  ConfigurationPredicateTrace,
  ConfigurationSnapshot,
} from './configuration-snapshot.types';

/**
 * Preserve an old snapshot and its old truth while marking only traces whose
 * exact configuration dependency received a different source observation.
 * Re-evaluation remains a separate future attempt.
 */
export function markDependentConfigurationPredicateTracesStale(input: {
  snapshot: ConfigurationSnapshot;
  incomingProjections: readonly InstallationEventEvidenceProjection[];
}): ConfigurationSnapshot {
  const incomingByTarget: Map<string, InstallationEventEvidenceProjection> =
    new Map<string, InstallationEventEvidenceProjection>();
  for (const projection of input.incomingProjections) {
    assertIncomingScope(input.snapshot, projection);
    const targetKey: string = configurationTargetKey(projection.query.target);
    if (incomingByTarget.has(targetKey)) {
      throw new Error('CONFIGURATION_PREDICATE_STALE_DUPLICATE_TARGET');
    }
    incomingByTarget.set(targetKey, projection);
  }

  const snapshot: ConfigurationSnapshot = structuredClone(input.snapshot);
  snapshot.predicateTraces = snapshot.predicateTraces.map(
    (trace: ConfigurationPredicateTrace): ConfigurationPredicateTrace => {
      const incoming: InstallationEventEvidenceProjection | undefined =
        incomingByTarget.get(trace.dependencySelector.targetKey);
      if (!incoming) return trace;
      const observation: ConfigurationPredicateDependencyObservation =
        configurationDependencyObservation(incoming);
      if (sameObservation(trace.dependencyObservation, observation)) {
        return trace;
      }
      const evidenceRecordIds: string[] = observation.evidenceRecords.map(
        (record: ConfigurationEvidenceIdentityRef) => record.evidenceRecordId,
      );
      return {
        ...trace,
        status: 'STALE',
        staleReason: {
          code: 'DEPENDENCY_OBSERVATION_CHANGED',
          previousStatus: trace.staleReason?.previousStatus ?? trace.status,
          incomingSourceSliceRef: configurationSourceSliceRef(
            incoming.query.aircraft.assetId,
            incoming.query.assessmentAsOf,
            trace.dependencySelector.targetKey,
            configurationObservationVersion(incoming),
          ),
          incomingSourceStatus: incoming.sourceStatus,
          incomingSourceSystem:
            incoming.sourceObservation?.sourceSystem ?? null,
          incomingSourceRevision:
            incoming.sourceObservation?.sourceRevision ?? null,
          incomingEvidenceRecordIds: evidenceRecordIds,
          incomingConfigEventIds: [...observation.configEventIds],
        },
      };
    },
  );
  return snapshot;
}

function assertIncomingScope(
  snapshot: ConfigurationSnapshot,
  projection: InstallationEventEvidenceProjection,
): void {
  if (projection.query.aircraft.assetId !== snapshot.aircraftAssetId) {
    throw new Error('CONFIGURATION_PREDICATE_STALE_AIRCRAFT_MISMATCH');
  }
  if (projection.query.assessmentAsOf < snapshot.assessmentAsOf) {
    throw new Error('CONFIGURATION_PREDICATE_STALE_AS_OF_PRECEDES_SNAPSHOT');
  }
}

function sameObservation(
  left: ConfigurationPredicateDependencyObservation,
  right: ConfigurationPredicateDependencyObservation,
): boolean {
  return (
    left.sourceStatus === right.sourceStatus &&
    left.sourceSystem === right.sourceSystem &&
    left.sourceRevision === right.sourceRevision &&
    left.sourceObservedAt === right.sourceObservedAt &&
    left.sourceFreshness === right.sourceFreshness &&
    left.sourceErrorCode === right.sourceErrorCode &&
    left.truth === right.truth &&
    left.value === right.value &&
    left.coverage.included === right.coverage.included &&
    left.coverage.limitation === right.coverage.limitation &&
    left.coverage.completeness === right.coverage.completeness &&
    left.coverage.allRecordsRead === right.coverage.allRecordsRead &&
    left.coverage.exactAircraftMatch === right.coverage.exactAircraftMatch &&
    left.coverage.exactTargetMatch === right.coverage.exactTargetMatch &&
    sameEvidenceRecords(left.evidenceRecords, right.evidenceRecords) &&
    sameStringArray(left.configEventIds, right.configEventIds) &&
    sameStringArray(left.diagnosticCodes, right.diagnosticCodes)
  );
}

function sameEvidenceRecords(
  left: ConfigurationEvidenceIdentityRef[],
  right: ConfigurationEvidenceIdentityRef[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (record: ConfigurationEvidenceIdentityRef, index: number) =>
        record.evidenceRecordId === right[index].evidenceRecordId &&
        record.sourceSystem === right[index].sourceSystem &&
        record.recordId === right[index].recordId &&
        record.revision === right[index].revision,
    )
  );
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value: string, index: number) => value === right[index])
  );
}
