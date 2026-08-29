import type {
  GetInstallationEventsQuery,
  GetInstallationEventsResult,
  InstallationEventSourceRecord,
} from './get-installation-events.port';
import {
  addAssertionSupportBindings,
  conflictAssertion,
  currentTargetIdentity,
  eventId,
  evidenceId,
  markConflictBindings,
  markEventsConflict,
  supportedAssertion,
  unresolvedAssertion,
  type CurrentTargetIdentity,
  type MappedEventCandidate,
} from './installation-event-evidence.current-state';
import {
  appendEventBindings,
  authoritySupportsEvent,
  eventScope,
  evidenceRole,
  type EventEffect,
  type EventScopeResult,
} from './installation-event-evidence.relations';
import {
  addDiagnostic,
  appendRecordDiagnostics,
  assertValidQuery,
  assertValidResultEnvelope,
  collectSourceRecords,
  isRecordInQueryWindow,
  isRecordVisibleAtAssessment,
  isUsableFreshness,
  sameQueryScope,
  type CollectedSourceRecords,
  type IndexedSourceRecord,
} from './installation-event-evidence.runtime';
import type {
  ConfigEventEvidenceProjection,
  ConfigurationEventEvidenceBinding,
  ConfigurationEvidenceDiagnostic,
  CurrentConfigurationAssertionCandidate,
  InstallationEventEvidenceProjection,
  InstallationEvidenceRecordProjection,
} from './installation-event-evidence.types';

/**
 * Pure Host mapping boundary from read-only source observations to candidate
 * EvidenceRecord, ConfigEvent and relation projections. It does not persist a
 * Fleet fact and it does not evaluate document applicability.
 */
export function mapInstallationEventEvidence(input: {
  query: GetInstallationEventsQuery;
  result: GetInstallationEventsResult;
}): InstallationEventEvidenceProjection {
  assertValidQuery(input.query);
  assertValidResultEnvelope(input.result);

  const query: GetInstallationEventsQuery = structuredClone(input.query);
  const result: GetInstallationEventsResult = input.result;
  const diagnostics: ConfigurationEvidenceDiagnostic[] = [];
  const evidenceRecords: InstallationEvidenceRecordProjection[] = [];
  const configEvents: ConfigEventEvidenceProjection[] = [];
  const bindings: ConfigurationEventEvidenceBinding[] = [];
  const mappedCandidates: MappedEventCandidate[] = [];
  const targetIdentity: CurrentTargetIdentity = currentTargetIdentity(query);
  let sourceCanClose: boolean = true;
  let sourceConflict: boolean = result.status === 'CONFLICT';

  if (!sameQueryScope(query, result.queryScope)) {
    sourceCanClose = false;
    addDiagnostic(
      diagnostics,
      'QUERY_SCOPE_MISMATCH',
      null,
      'The source response does not echo the exact Host query scope.',
    );
  }

  sourceCanClose = applySourceStatusDiagnostics({
    result,
    diagnostics,
    sourceCanClose,
  });
  sourceCanClose = applySourceCoverageDiagnostics({
    result,
    diagnostics,
    sourceCanClose,
  });

  const collected: CollectedSourceRecords = collectSourceRecords({
    result,
    diagnostics,
  });
  let recordSetInvalid: boolean = collected.hadInvalidRecord;
  const sourceIdentityConflict: boolean = diagnostics.some(
    (diagnostic: ConfigurationEvidenceDiagnostic) =>
      diagnostic.code === 'SOURCE_RECORD_IDENTITY_CONFLICT' ||
      diagnostic.code === 'SOURCE_RECORD_REVISION_CONFLICT',
  );
  sourceConflict = sourceConflict || sourceIdentityConflict;
  if (sourceIdentityConflict) sourceCanClose = false;

  for (const indexed of collected.records) {
    const mapped: {
      candidate: MappedEventCandidate | null;
      targetMismatch: boolean;
      eventConflict: boolean;
    } = mapSourceRecord({
      indexed,
      query,
      result,
      sourceCanClose,
      sourceConflict,
      diagnostics,
      evidenceRecords,
      configEvents,
      bindings,
    });
    recordSetInvalid = recordSetInvalid || mapped.targetMismatch;
    sourceConflict = sourceConflict || mapped.eventConflict;
    if (mapped.candidate) mappedCandidates.push(mapped.candidate);
  }

  let currentAssertion: CurrentConfigurationAssertionCandidate =
    unresolvedAssertion(query, targetIdentity);
  if (sourceConflict) {
    currentAssertion = conflictAssertion(query, targetIdentity);
    markEventsConflict(mappedCandidates, configEvents);
    markConflictBindings(currentAssertion, mappedCandidates, bindings);
  } else if (
    sourceCanClose &&
    !recordSetInvalid &&
    mappedCandidates.length > 0 &&
    mappedCandidates.every(
      (candidate: MappedEventCandidate) => candidate.canCloseCurrentState,
    )
  ) {
    currentAssertion = closeCurrentAssertion({
      query,
      targetIdentity,
      mappedCandidates,
      configEvents,
      bindings,
      diagnostics,
    });
  } else if (mappedCandidates.length === 0) {
    addDiagnostic(
      diagnostics,
      'NO_RELEVANT_CONTROLLED_EVENT',
      null,
      'No controlled event establishes the queried state.',
    );
  }

  return {
    schemaVersion: 'wiselink.3_1.installation_event_evidence.v0.candidate',
    mode: 'READ_ONLY_CANDIDATE_PROJECTION',
    query,
    sourceStatus: result.status,
    sourceObservation: structuredClone(result.source),
    sourceError: result.error ? structuredClone(result.error) : null,
    coverage: structuredClone(result.coverage),
    evidenceRecords,
    configEvents,
    bindings,
    currentAssertion,
    diagnostics,
    authority: {
      candidateOnly: true,
      writesCurrentConfiguration: false,
      returnsApplicabilityDecision: false,
    },
  };
}

function mapSourceRecord(input: {
  indexed: IndexedSourceRecord;
  query: GetInstallationEventsQuery;
  result: GetInstallationEventsResult;
  sourceCanClose: boolean;
  sourceConflict: boolean;
  diagnostics: ConfigurationEvidenceDiagnostic[];
  evidenceRecords: InstallationEvidenceRecordProjection[];
  configEvents: ConfigEventEvidenceProjection[];
  bindings: ConfigurationEventEvidenceBinding[];
}): {
  candidate: MappedEventCandidate | null;
  targetMismatch: boolean;
  eventConflict: boolean;
} {
  const record: InstallationEventSourceRecord = input.indexed.record;
  const scope: EventScopeResult = eventScope(record, input.query.target);
  const authorityEligible: boolean = authoritySupportsEvent(
    record.authorityClass,
    record.event.kind,
  );
  const recordControlled: boolean = record.controlStatus === 'CONTROLLED';
  const recordCoverageComplete: boolean =
    record.coverage.completeness === 'COMPLETE';
  const recordFresh: boolean = isUsableFreshness(record.freshness);
  const aircraftMatches: boolean =
    record.aircraftAssetId === input.query.aircraft.assetId;
  const recordInWindow: boolean = isRecordInQueryWindow(record, input.query);
  const recordVisibleAtAssessment: boolean = isRecordVisibleAtAssessment(
    record,
    input.query,
  );

  appendRecordDiagnostics({
    diagnostics: input.diagnostics,
    record,
    authorityEligible,
    recordControlled,
    recordCoverageComplete,
    recordFresh,
    aircraftMatches,
    recordInWindow,
    recordVisibleAtAssessment,
    targetMatches: scope.inScope,
  });

  const eventConflict: boolean = scope.effect === 'CONFLICT';
  const canCloseCurrentState: boolean =
    input.sourceCanClose &&
    authorityEligible &&
    recordControlled &&
    recordCoverageComplete &&
    recordFresh &&
    aircraftMatches &&
    recordInWindow &&
    recordVisibleAtAssessment &&
    scope.inScope &&
    !eventConflict;
  const evidenceRecordId: string = evidenceId(
    input.result.source.sourceSystem,
    record,
    input.indexed.identityOccurrence,
  );
  const configEventId: string = eventId(evidenceRecordId);
  const mappedConflict: boolean = input.sourceConflict || eventConflict;

  input.evidenceRecords.push(
    mapEvidenceRecord(input.result, record, evidenceRecordId),
  );
  input.configEvents.push(
    mapConfigEvent({
      result: input.result,
      record,
      evidenceRecordId,
      configEventId,
      mappedConflict,
      authorityEligible,
      recordControlled,
      recordCoverageComplete,
      canCloseCurrentState,
    }),
  );
  appendEventBindings({
    bindings: input.bindings,
    evidenceRecordId,
    configEventId,
    record,
  });

  const candidate: MappedEventCandidate | null =
    scope.effect === 'NONE'
      ? null
      : {
          evidenceRecordId,
          configEventId,
          effectiveAt: record.effectiveAt,
          effect: scope.effect,
          value: candidateValue(record, scope.effect),
          canCloseCurrentState,
        };
  return {
    candidate,
    targetMismatch: !scope.inScope,
    eventConflict,
  };
}

function mapEvidenceRecord(
  result: GetInstallationEventsResult,
  record: InstallationEventSourceRecord,
  evidenceRecordId: string,
): InstallationEvidenceRecordProjection {
  return {
    evidenceRecordId,
    type: 'EvidenceRecord',
    owner: result.source.owner,
    sourceSystem: result.source.sourceSystem,
    recordId: record.recordId,
    revision: record.revision,
    authorityClass: record.authorityClass,
    evidenceRole: evidenceRole(record.event.kind),
    controlStatus: record.controlStatus,
    observedAt: record.observedAt,
    freshness: record.freshness,
    coverage: structuredClone(record.coverage),
    effectiveAt: record.effectiveAt,
    recordedAt: record.recordedAt,
  };
}

function mapConfigEvent(input: {
  result: GetInstallationEventsResult;
  record: InstallationEventSourceRecord;
  evidenceRecordId: string;
  configEventId: string;
  mappedConflict: boolean;
  authorityEligible: boolean;
  recordControlled: boolean;
  recordCoverageComplete: boolean;
  canCloseCurrentState: boolean;
}): ConfigEventEvidenceProjection {
  return {
    configEventId: input.configEventId,
    type: 'ConfigEvent',
    evidenceRecordId: input.evidenceRecordId,
    eventKind: input.record.event.kind,
    occurrenceStatus: input.mappedConflict
      ? 'CONFLICT'
      : input.authorityEligible &&
          input.recordControlled &&
          input.recordCoverageComplete
        ? 'OBSERVED'
        : 'CANDIDATE',
    eventChainStatus: input.mappedConflict
      ? 'CONFLICT'
      : input.canCloseCurrentState
        ? 'CLOSED'
        : input.result.status === 'PARTIAL' ||
            input.record.coverage.completeness === 'PARTIAL'
          ? 'PARTIAL'
          : 'UNKNOWN',
    aircraftAssetId: input.record.aircraftAssetId,
    positionId: input.record.position?.positionId ?? null,
    effectiveAt: input.record.effectiveAt,
    recordedAt: input.record.recordedAt,
    event: structuredClone(input.record.event),
  };
}

function closeCurrentAssertion(input: {
  query: GetInstallationEventsQuery;
  targetIdentity: CurrentTargetIdentity;
  mappedCandidates: MappedEventCandidate[];
  configEvents: ConfigEventEvidenceProjection[];
  bindings: ConfigurationEventEvidenceBinding[];
  diagnostics: ConfigurationEvidenceDiagnostic[];
}): CurrentConfigurationAssertionCandidate {
  const latestEffectiveAt: string = input.mappedCandidates.reduce(
    (latest: string, candidate: MappedEventCandidate) =>
      candidate.effectiveAt > latest ? candidate.effectiveAt : latest,
    input.mappedCandidates[0].effectiveAt,
  );
  const latestCandidates: MappedEventCandidate[] =
    input.mappedCandidates.filter(
      (candidate: MappedEventCandidate) =>
        candidate.effectiveAt === latestEffectiveAt,
    );
  const latestEffects: Set<EventEffect> = new Set<EventEffect>(
    latestCandidates.map((candidate: MappedEventCandidate) => candidate.effect),
  );
  const latestValues: Set<string> = new Set<string>(
    latestCandidates.map((candidate: MappedEventCandidate) =>
      JSON.stringify(candidate.value),
    ),
  );
  if (
    latestEffects.size !== 1 ||
    latestEffects.has('CONFLICT') ||
    latestValues.size !== 1
  ) {
    addDiagnostic(
      input.diagnostics,
      'EVENT_STATE_CONFLICT',
      null,
      latestEffectiveAt,
    );
    const assertion: CurrentConfigurationAssertionCandidate = conflictAssertion(
      input.query,
      input.targetIdentity,
    );
    markEventsConflict(latestCandidates, input.configEvents);
    markConflictBindings(assertion, latestCandidates, input.bindings);
    return assertion;
  }
  const truth: 'TRUE' | 'FALSE' = latestEffects.has('TRUE') ? 'TRUE' : 'FALSE';
  const value: boolean | string | null = latestCandidates[0].value;
  if (value === null) {
    addDiagnostic(
      input.diagnostics,
      'EVENT_STATE_CONFLICT',
      null,
      `${latestEffectiveAt}:missing-current-value`,
    );
    return conflictAssertion(input.query, input.targetIdentity);
  }
  const assertion: CurrentConfigurationAssertionCandidate = supportedAssertion(
    input.query,
    input.targetIdentity,
    truth,
    value,
    latestCandidates,
  );
  addAssertionSupportBindings(assertion, latestCandidates, input.bindings);
  return assertion;
}

function candidateValue(
  record: InstallationEventSourceRecord,
  effect: EventEffect,
): boolean | string | null {
  if (effect === 'FALSE') return false;
  if (effect !== 'TRUE') return null;
  return record.event.kind === 'SOFTWARE_LOAD'
    ? record.event.softwareLoad.softwareLoadId
    : true;
}

function applySourceStatusDiagnostics(input: {
  result: GetInstallationEventsResult;
  diagnostics: ConfigurationEvidenceDiagnostic[];
  sourceCanClose: boolean;
}): boolean {
  if (input.result.status === 'COMPLETE') return input.sourceCanClose;
  const code: ConfigurationEvidenceDiagnostic['code'] =
    input.result.status === 'UNAVAILABLE'
      ? 'SOURCE_UNAVAILABLE'
      : input.result.status === 'PARTIAL'
        ? 'SOURCE_RESULTS_PARTIAL'
        : 'SOURCE_CONFLICT_REPORTED';
  addDiagnostic(input.diagnostics, code, null, input.result.error.code);
  return false;
}

function applySourceCoverageDiagnostics(input: {
  result: GetInstallationEventsResult;
  diagnostics: ConfigurationEvidenceDiagnostic[];
  sourceCanClose: boolean;
}): boolean {
  let sourceCanClose: boolean = input.sourceCanClose;
  if (
    input.result.coverage.completeness !== 'COMPLETE' ||
    input.result.coverage.allRecordsRead !== true ||
    input.result.coverage.exactAircraftMatch !== true ||
    input.result.coverage.exactTargetMatch !== true
  ) {
    sourceCanClose = false;
    addDiagnostic(
      input.diagnostics,
      'SOURCE_COVERAGE_INCOMPLETE',
      null,
      input.result.coverage.limitation,
    );
  }
  if (!isUsableFreshness(input.result.source.freshness)) {
    sourceCanClose = false;
    addDiagnostic(
      input.diagnostics,
      'SOURCE_FRESHNESS_UNUSABLE',
      null,
      input.result.source.freshness,
    );
  }
  return sourceCanClose;
}
