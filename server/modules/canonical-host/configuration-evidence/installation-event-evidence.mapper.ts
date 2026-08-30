import type {
  GetInstallationEventsFailure,
  GetInstallationEventsFailureCode,
  GetInstallationEventsQuery,
  GetInstallationEventsResult,
  InstallationEventSourceRecord,
} from './get-installation-events.port';
import {
  conflictAssertion,
  currentTargetIdentity,
  eventId,
  evidenceId,
  markConflictBindings,
  markEventsConflict,
  unresolvedAssertion,
  type CurrentTargetIdentity,
  type MappedEventCandidate,
} from './installation-event-evidence.current-state';
import {
  appendEventBindings,
  authoritySupportsEvent,
  eventScope,
  evidenceRole,
  type EventScopeResult,
} from './installation-event-evidence.relations';
import {
  closeCurrentAssertion,
  createMappedEventCandidates,
} from './installation-event-evidence.state-replay';
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
  ConfigurationEvidencePublicSourceError,
  CurrentConfigurationAssertionCandidate,
  InstallationEventEvidenceProjection,
  InstallationEvidenceRecordProjection,
} from './installation-event-evidence.types';

const PUBLIC_SOURCE_ERROR_MESSAGES: Record<
  GetInstallationEventsFailureCode,
  string
> = {
  SOURCE_NOT_CONFIGURED: '尚未配置受控构型事件数据源，请联系系统管理员。',
  ACCESS_DENIED: '当前账号无权读取受控构型事件，请联系数据源管理员。',
  TIMEOUT: '构型事件查询超时，请稍后重试。',
  SOURCE_UNAVAILABLE: '受控构型事件数据源暂不可用，请稍后重试。',
  AIRCRAFT_AMBIGUOUS: '飞机身份无法唯一匹配，请核对飞机标识后重试。',
  TARGET_AMBIGUOUS: '构型查询目标无法唯一匹配，请核对目标后重试。',
  PARTIAL_RESULTS: '构型事件结果不完整，当前状态保持未知；请补齐数据后重试。',
  TRUNCATED: '构型事件结果已截断，当前状态保持未知；请缩小范围后重试。',
  SOURCE_CONFLICT: '受控构型事件存在冲突，当前状态需工程师复核。',
};

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
      candidates: MappedEventCandidate[];
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
    mappedCandidates.push(...mapped.candidates);
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
    sourceError: publicSourceError(result.error),
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

function publicSourceError(
  error: GetInstallationEventsFailure | null,
): ConfigurationEvidencePublicSourceError | null {
  if (error === null) return null;
  return {
    code: error.code,
    message: PUBLIC_SOURCE_ERROR_MESSAGES[error.code],
    retryable: error.retryable,
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
  candidates: MappedEventCandidate[];
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

  const candidates: MappedEventCandidate[] = createMappedEventCandidates({
    query: input.query,
    record,
    scope,
    evidenceRecordId,
    configEventId,
    canCloseCurrentState,
  });
  return {
    candidates,
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
