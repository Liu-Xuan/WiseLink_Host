import type { ConfigurationEvidenceTarget } from './get-installation-events.port';
import type {
  ConfigEventEvidenceProjection,
  CurrentConfigurationAssertionCandidate,
  InstallationEventEvidenceProjection,
  InstallationEvidenceRecordProjection,
} from './installation-event-evidence.types';
import type {
  ConfigurationEvidenceIdentityRef,
  ConfigurationPredicateDependencyObservation,
  ConfigurationPredicateDependencySelector,
  ConfigurationPredicateTrace,
  ConfigurationPredicateTraceStatus,
  ConfigurationSnapshot,
  ConfigurationSnapshotCoverage,
  ConfigurationSnapshotCurrentness,
  ConfigurationSnapshotFact,
  ConfigurationSnapshotFactTemporal,
  ConfigurationSnapshotRelation,
  ConfigurationSnapshotRelationProjection,
  ConfigurationSnapshotSourceCompleteness,
  ConfigurationSnapshotSourceSlice,
} from './configuration-snapshot.types';

interface PreliminaryRelation {
  relation: ConfigurationSnapshotRelation;
  fromRef: string;
  toRef: string;
  evidenceRecordId: string | null;
  sourceBindingId: string | null;
}

/**
 * Project one or more V0 target-scoped event observations into a sparse,
 * read-only configuration view. This boundary does not persist Fleet facts
 * and does not evaluate document applicability.
 */
export function mapConfigurationSnapshot(input: {
  aircraftAssetId: string;
  assessmentAsOf: string;
  projections: readonly InstallationEventEvidenceProjection[];
}): ConfigurationSnapshot {
  if (input.projections.length === 0) {
    throw new Error('CONFIGURATION_SNAPSHOT_PROJECTIONS_REQUIRED');
  }

  const projections: InstallationEventEvidenceProjection[] = [
    ...input.projections,
  ].sort(compareProjections);
  const seenTargets: Set<string> = new Set<string>();
  const sourceSlices: ConfigurationSnapshotSourceSlice[] = [];
  const facts: ConfigurationSnapshotFact[] = [];
  const predicateTraces: ConfigurationPredicateTrace[] = [];
  const evidenceById: Map<string, InstallationEvidenceRecordProjection> =
    new Map<string, InstallationEvidenceRecordProjection>();
  const eventById: Map<string, ConfigEventEvidenceProjection> = new Map<
    string,
    ConfigEventEvidenceProjection
  >();
  const relationsByKey: Map<string, PreliminaryRelation> = new Map<
    string,
    PreliminaryRelation
  >();

  for (const projection of projections) {
    assertProjectionScope(input, projection);
    const targetKey: string = configurationTargetKey(projection.query.target);
    if (seenTargets.has(targetKey)) {
      throw new Error('CONFIGURATION_SNAPSHOT_DUPLICATE_TARGET');
    }
    seenTargets.add(targetKey);

    const sourceSliceRef: string = configurationSourceSliceRef(
      input.aircraftAssetId,
      input.assessmentAsOf,
      targetKey,
    );
    const factAssertionId: string = configurationSnapshotFactId(
      input.aircraftAssetId,
      input.assessmentAsOf,
      targetKey,
    );
    const sourceSlice: ConfigurationSnapshotSourceSlice = mapSourceSlice(
      projection,
      sourceSliceRef,
    );
    const fact: ConfigurationSnapshotFact = mapSnapshotFact({
      projection,
      sourceSliceRef,
      factAssertionId,
    });
    const trace: ConfigurationPredicateTrace = mapPredicateTrace({
      projection,
      fact,
      sourceSliceRef,
      targetKey,
    });

    sourceSlices.push(sourceSlice);
    facts.push(fact);
    predicateTraces.push(trace);
    collectEvidenceRecords(evidenceById, projection.evidenceRecords);
    collectConfigEvents(eventById, projection.configEvents);
    collectProjectionRelations({
      relationsByKey,
      projection,
      sourceSliceRef,
      factAssertionId,
      predicateTraceId: trace.predicateTraceId,
    });
  }

  const evidenceRecordRefs: InstallationEvidenceRecordProjection[] = [
    ...evidenceById.values(),
  ].sort(
    (
      left: InstallationEvidenceRecordProjection,
      right: InstallationEvidenceRecordProjection,
    ) => left.evidenceRecordId.localeCompare(right.evidenceRecordId),
  );
  const configEvents: ConfigEventEvidenceProjection[] = [
    ...eventById.values(),
  ].sort(
    (
      left: ConfigEventEvidenceProjection,
      right: ConfigEventEvidenceProjection,
    ) => left.configEventId.localeCompare(right.configEventId),
  );

  return {
    schemaVersion: 'wiselink.3_1.configuration_snapshot.v1.candidate',
    mode: 'READ_ONLY_CANDIDATE_PROJECTION',
    aircraftAssetId: input.aircraftAssetId,
    assessmentAsOf: input.assessmentAsOf,
    coverage: summarizeCoverage(projections, sourceSlices),
    sourceSlices,
    evidenceRecordRefs,
    configEvents,
    facts,
    predicateTraces,
    relations: finalizeRelations(relationsByKey),
    authority: {
      candidateOnly: true,
      readOnly: true,
      writesCurrentConfiguration: false,
      returnsApplicabilityDecision: false,
      fullAircraftConfigurationClaimed: false,
    },
  };
}

export function configurationTargetKey(
  target: ConfigurationEvidenceTarget,
): string {
  if (target.kind === 'COMPONENT') {
    return targetKeyParts(target.kind, target.componentId, target.positionId);
  }
  if (target.kind === 'EQUIPMENT') {
    return targetKeyParts(target.kind, target.equipmentKey, target.positionId);
  }
  if (target.kind === 'SOFTWARE') {
    return targetKeyParts(
      target.kind,
      target.softwareKey,
      target.targetComponentId,
      target.positionId,
    );
  }
  if (target.kind === 'MODIFICATION') {
    return targetKeyParts(target.kind, target.modificationId);
  }
  return targetKeyParts(target.kind, target.repairId);
}

export function configurationSourceSliceRef(
  aircraftAssetId: string,
  assessmentAsOf: string,
  targetKey: string,
): string {
  return scopedRef(
    'CONFIGURATION-SNAPSHOT-SOURCE',
    aircraftAssetId,
    assessmentAsOf,
    targetKey,
  );
}

export function configurationDependencyObservation(
  projection: InstallationEventEvidenceProjection,
): ConfigurationPredicateDependencyObservation {
  const evidenceRecords: ConfigurationEvidenceIdentityRef[] =
    projection.evidenceRecords
      .map(
        (
          record: InstallationEvidenceRecordProjection,
        ): ConfigurationEvidenceIdentityRef => ({
          evidenceRecordId: record.evidenceRecordId,
          sourceSystem: record.sourceSystem,
          recordId: record.recordId,
          revision: record.revision,
        }),
      )
      .sort(
        (
          left: ConfigurationEvidenceIdentityRef,
          right: ConfigurationEvidenceIdentityRef,
        ) => left.evidenceRecordId.localeCompare(right.evidenceRecordId),
      );
  const configEventIds: string[] = projection.configEvents
    .map((event: ConfigEventEvidenceProjection) => event.configEventId)
    .sort((left: string, right: string) => left.localeCompare(right));
  const diagnosticCodes: string[] = projection.diagnostics
    .map((diagnostic) => diagnostic.code)
    .sort((left: string, right: string) => left.localeCompare(right));
  return {
    sourceStatus: projection.sourceStatus,
    sourceSystem: projection.sourceObservation?.sourceSystem ?? null,
    sourceRevision: projection.sourceObservation?.sourceRevision ?? null,
    sourceFreshness: projection.sourceObservation?.freshness ?? null,
    sourceErrorCode: projection.sourceError?.code ?? null,
    coverage: structuredClone(projection.coverage),
    truth: projection.currentAssertion.truth,
    value: projection.currentAssertion.value,
    evidenceRecords,
    configEventIds,
    diagnosticCodes,
  };
}

function mapSourceSlice(
  projection: InstallationEventEvidenceProjection,
  sourceSliceRef: string,
): ConfigurationSnapshotSourceSlice {
  return {
    sourceSliceRef,
    query: structuredClone(projection.query),
    sourceStatus: projection.sourceStatus,
    sourceObservation: projection.sourceObservation
      ? structuredClone(projection.sourceObservation)
      : null,
    sourceError: projection.sourceError
      ? structuredClone(projection.sourceError)
      : null,
    coverage: structuredClone(projection.coverage),
    diagnostics: structuredClone(projection.diagnostics),
    evidenceRecordIds: projection.evidenceRecords
      .map(
        (record: InstallationEvidenceRecordProjection) =>
          record.evidenceRecordId,
      )
      .sort((left: string, right: string) => left.localeCompare(right)),
    configEventIds: projection.configEvents
      .map((event: ConfigEventEvidenceProjection) => event.configEventId)
      .sort((left: string, right: string) => left.localeCompare(right)),
  };
}

function mapSnapshotFact(input: {
  projection: InstallationEventEvidenceProjection;
  sourceSliceRef: string;
  factAssertionId: string;
}): ConfigurationSnapshotFact {
  const assertion: CurrentConfigurationAssertionCandidate =
    input.projection.currentAssertion;
  return {
    factAssertionId: input.factAssertionId,
    type: 'FactAssertion',
    sourceAssertionId: assertion.assertionId,
    aircraftAssetId: input.projection.query.aircraft.assetId,
    target: structuredClone(input.projection.query.target),
    targetRef: assertion.targetRef,
    property: assertion.property,
    truth: assertion.truth,
    value: assertion.value,
    status: assertion.status,
    authority: assertion.authority,
    assessmentAsOf: assertion.assessmentAsOf,
    currentness: assertionCurrentness(assertion),
    temporal: factTemporal(input.projection),
    coverage: {
      sourceSliceRef: input.sourceSliceRef,
      sourceStatus: input.projection.sourceStatus,
      sourceFreshness: input.projection.sourceObservation?.freshness ?? null,
      queryCoverage: structuredClone(input.projection.coverage),
    },
    supportingEvidenceRecordIds: [...assertion.supportingEvidenceRecordIds],
    derivedConfigEventIds: [...assertion.derivedConfigEventIds],
  };
}

function mapPredicateTrace(input: {
  projection: InstallationEventEvidenceProjection;
  fact: ConfigurationSnapshotFact;
  sourceSliceRef: string;
  targetKey: string;
}): ConfigurationPredicateTrace {
  const selector: ConfigurationPredicateDependencySelector = {
    aircraftAssetId: input.fact.aircraftAssetId,
    targetKey: input.targetKey,
    target: structuredClone(input.fact.target),
    targetRef: input.fact.targetRef,
    property: input.fact.property,
  };
  return {
    predicateTraceId: `CONFIGURATION-PREDICATE-TRACE:${input.fact.factAssertionId}`,
    type: 'PredicateTrace',
    predicateKind: 'CURRENT_CONFIGURATION_ASSERTION',
    aircraftAssetId: input.fact.aircraftAssetId,
    target: structuredClone(input.fact.target),
    targetRef: input.fact.targetRef,
    property: input.fact.property,
    truth: input.fact.truth,
    value: input.fact.value,
    status: traceStatus(input.fact.status),
    assessmentAsOf: input.fact.assessmentAsOf,
    factAssertionId: input.fact.factAssertionId,
    sourceSliceRef: input.sourceSliceRef,
    dependencySelector: selector,
    dependencyObservation: configurationDependencyObservation(input.projection),
    supportingEvidenceRecordIds: [...input.fact.supportingEvidenceRecordIds],
    derivedConfigEventIds: [...input.fact.derivedConfigEventIds],
    staleReason: null,
  };
}

function factTemporal(
  projection: InstallationEventEvidenceProjection,
): ConfigurationSnapshotFactTemporal {
  const assertion: CurrentConfigurationAssertionCandidate =
    projection.currentAssertion;
  const derivedEventIds: Set<string> = new Set<string>(
    assertion.derivedConfigEventIds,
  );
  const derivedEvents: ConfigEventEvidenceProjection[] =
    projection.configEvents.filter((event: ConfigEventEvidenceProjection) =>
      derivedEventIds.has(event.configEventId),
    );
  const effectiveTimes: string[] = derivedEvents.map(
    (event: ConfigEventEvidenceProjection) => event.effectiveAt,
  );
  const recordedTimes: string[] = derivedEvents.map(
    (event: ConfigEventEvidenceProjection) => event.recordedAt,
  );
  const supportingEvidenceIds: Set<string> = new Set<string>(
    assertion.supportingEvidenceRecordIds,
  );
  const evidenceObservedTimes: string[] = projection.evidenceRecords
    .filter((record: InstallationEvidenceRecordProjection) =>
      supportingEvidenceIds.has(record.evidenceRecordId),
    )
    .map((record: InstallationEvidenceRecordProjection) => record.observedAt);
  const sourceObservedAt: string[] = projection.sourceObservation
    ? [projection.sourceObservation.observedAt]
    : [];
  return {
    validFrom: stateEffectiveFrom(assertion.truth, effectiveTimes),
    validThroughAsOf: assertion.assessmentAsOf,
    recordedAt: latestTime(recordedTimes),
    observedAt: latestTime([...evidenceObservedTimes, ...sourceObservedAt]),
  };
}

function collectProjectionRelations(input: {
  relationsByKey: Map<string, PreliminaryRelation>;
  projection: InstallationEventEvidenceProjection;
  sourceSliceRef: string;
  factAssertionId: string;
  predicateTraceId: string;
}): void {
  const sourceAssertionId: string =
    input.projection.currentAssertion.assertionId;
  for (const binding of input.projection.bindings) {
    const relation: PreliminaryRelation = {
      relation: binding.relation,
      fromRef: rewriteAssertionRef(
        binding.fromRef,
        sourceAssertionId,
        input.factAssertionId,
      ),
      toRef: rewriteAssertionRef(
        binding.toRef,
        sourceAssertionId,
        input.factAssertionId,
      ),
      evidenceRecordId: binding.evidenceRecordId,
      sourceBindingId: binding.bindingId,
    };
    appendRelation(input.relationsByKey, relation);
  }
  appendRelation(input.relationsByKey, {
    relation: 'DEPENDS_ON',
    fromRef: input.predicateTraceId,
    toRef: input.factAssertionId,
    evidenceRecordId: null,
    sourceBindingId: null,
  });
  appendRelation(input.relationsByKey, {
    relation: 'DEPENDS_ON',
    fromRef: input.predicateTraceId,
    toRef: input.sourceSliceRef,
    evidenceRecordId: null,
    sourceBindingId: null,
  });
  if (input.projection.currentAssertion.status === 'WAITING_INPUT') {
    appendRelation(input.relationsByKey, {
      relation: 'AFFECTED_BY',
      fromRef: input.factAssertionId,
      toRef: input.sourceSliceRef,
      evidenceRecordId: null,
      sourceBindingId: null,
    });
  }
}

function collectEvidenceRecords(
  recordsById: Map<string, InstallationEvidenceRecordProjection>,
  records: InstallationEvidenceRecordProjection[],
): void {
  for (const record of records) {
    appendUniqueProjection(
      recordsById,
      record.evidenceRecordId,
      record,
      'CONFIGURATION_SNAPSHOT_EVIDENCE_ID_CONFLICT',
    );
  }
}

function collectConfigEvents(
  eventsById: Map<string, ConfigEventEvidenceProjection>,
  events: ConfigEventEvidenceProjection[],
): void {
  for (const event of events) {
    appendUniqueProjection(
      eventsById,
      event.configEventId,
      event,
      'CONFIGURATION_SNAPSHOT_EVENT_ID_CONFLICT',
    );
  }
}

function appendUniqueProjection<T>(
  valuesById: Map<string, T>,
  id: string,
  value: T,
  conflictCode: string,
): void {
  const existing: T | undefined = valuesById.get(id);
  if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error(conflictCode);
  }
  if (!existing) valuesById.set(id, structuredClone(value));
}

function appendRelation(
  relationsByKey: Map<string, PreliminaryRelation>,
  relation: PreliminaryRelation,
): void {
  const key: string = relationKey(relation);
  if (!relationsByKey.has(key)) relationsByKey.set(key, relation);
}

function finalizeRelations(
  relationsByKey: Map<string, PreliminaryRelation>,
): ConfigurationSnapshotRelationProjection[] {
  return [...relationsByKey.values()]
    .sort((left: PreliminaryRelation, right: PreliminaryRelation) =>
      relationKey(left).localeCompare(relationKey(right)),
    )
    .map(
      (
        relation: PreliminaryRelation,
        index: number,
      ): ConfigurationSnapshotRelationProjection => ({
        relationId: [
          'CONFIGURATION-SNAPSHOT-RELATION',
          String(index + 1).padStart(4, '0'),
          relation.relation,
        ].join(':'),
        ...relation,
      }),
    );
}

function summarizeCoverage(
  projections: InstallationEventEvidenceProjection[],
  sourceSlices: ConfigurationSnapshotSourceSlice[],
): ConfigurationSnapshotCoverage {
  const completeTargetCount: number = projections.filter(
    (projection: InstallationEventEvidenceProjection) =>
      targetCoverageComplete(projection),
  ).length;
  return {
    scope: 'REQUESTED_TARGETS_ONLY',
    sourceCompleteness: sourceCompleteness(projections),
    requestedTargetCount: projections.length,
    completeTargetCount,
    allRequestedRecordsRead: projections.every(
      (projection: InstallationEventEvidenceProjection) =>
        projection.coverage.allRecordsRead,
    ),
    sourceSliceRefs: sourceSlices.map(
      (slice: ConfigurationSnapshotSourceSlice) => slice.sourceSliceRef,
    ),
    fullAircraftConfigurationClaimed: false,
  };
}

function sourceCompleteness(
  projections: InstallationEventEvidenceProjection[],
): ConfigurationSnapshotSourceCompleteness {
  if (
    projections.some(
      (projection: InstallationEventEvidenceProjection) =>
        projection.sourceStatus === 'CONFLICT' ||
        projection.currentAssertion.truth === 'CONFLICT',
    )
  ) {
    return 'CONFLICT';
  }
  if (projections.every(targetCoverageComplete)) return 'COMPLETE';
  if (
    projections.some(
      (projection: InstallationEventEvidenceProjection) =>
        projection.sourceStatus === 'PARTIAL' ||
        projection.coverage.completeness === 'PARTIAL',
    )
  ) {
    return 'PARTIAL';
  }
  return 'UNKNOWN';
}

function targetCoverageComplete(
  projection: InstallationEventEvidenceProjection,
): boolean {
  return (
    projection.sourceStatus === 'COMPLETE' &&
    projection.coverage.completeness === 'COMPLETE' &&
    projection.coverage.allRecordsRead &&
    projection.coverage.exactAircraftMatch &&
    projection.coverage.exactTargetMatch
  );
}

function assertProjectionScope(
  input: {
    aircraftAssetId: string;
    assessmentAsOf: string;
  },
  projection: InstallationEventEvidenceProjection,
): void {
  if (projection.query.aircraft.assetId !== input.aircraftAssetId) {
    throw new Error('CONFIGURATION_SNAPSHOT_AIRCRAFT_SCOPE_MISMATCH');
  }
  if (projection.query.assessmentAsOf !== input.assessmentAsOf) {
    throw new Error('CONFIGURATION_SNAPSHOT_AS_OF_SCOPE_MISMATCH');
  }
}

function configurationSnapshotFactId(
  aircraftAssetId: string,
  assessmentAsOf: string,
  targetKey: string,
): string {
  return scopedRef(
    'CONFIGURATION-SNAPSHOT-FACT',
    aircraftAssetId,
    assessmentAsOf,
    targetKey,
  );
}

function targetKeyParts(...parts: Array<string | null>): string {
  return parts
    .map((part: string | null) =>
      part === null ? 'NULL' : `VALUE:${encodeURIComponent(part)}`,
    )
    .join('|');
}

function scopedRef(prefix: string, ...parts: string[]): string {
  return [
    prefix,
    ...parts.map((part: string) => encodeURIComponent(part)),
  ].join(':');
}

function compareProjections(
  left: InstallationEventEvidenceProjection,
  right: InstallationEventEvidenceProjection,
): number {
  return configurationTargetKey(left.query.target).localeCompare(
    configurationTargetKey(right.query.target),
  );
}

function assertionCurrentness(
  assertion: CurrentConfigurationAssertionCandidate,
): ConfigurationSnapshotCurrentness {
  if (assertion.truth === 'CONFLICT') return 'CONFLICT';
  if (assertion.truth === 'UNKNOWN') return 'UNKNOWN';
  return 'AS_OF';
}

function traceStatus(
  status: CurrentConfigurationAssertionCandidate['status'],
): ConfigurationPredicateTraceStatus {
  if (status === 'SUPPORTED') return 'EVALUATED';
  return status;
}

function stateEffectiveFrom(
  truth: CurrentConfigurationAssertionCandidate['truth'],
  effectiveTimes: string[],
): string | null {
  if (
    effectiveTimes.length === 0 ||
    truth === 'UNKNOWN' ||
    truth === 'CONFLICT'
  ) {
    return null;
  }
  const sorted: string[] = [...effectiveTimes].sort(
    (left: string, right: string) => left.localeCompare(right),
  );
  return truth === 'TRUE' ? sorted[0] : sorted[sorted.length - 1];
}

function latestTime(times: string[]): string | null {
  if (times.length === 0) return null;
  return [...times].sort((left: string, right: string) =>
    right.localeCompare(left),
  )[0];
}

function rewriteAssertionRef(
  value: string,
  sourceAssertionId: string,
  factAssertionId: string,
): string {
  return value === sourceAssertionId ? factAssertionId : value;
}

function relationKey(relation: PreliminaryRelation): string {
  return [
    relation.relation,
    relation.fromRef,
    relation.toRef,
    relation.evidenceRecordId ?? '',
  ].join('|');
}
