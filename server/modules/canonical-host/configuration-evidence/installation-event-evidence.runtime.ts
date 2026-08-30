import type {
  ConfigurationEvidenceTarget,
  GetInstallationEventsFailureCode,
  GetInstallationEventsQuery,
  GetInstallationEventsResult,
  InstallationEventPayload,
  InstallationEventSourceRecord,
} from './get-installation-events.port';
import type {
  ConfigurationEvidenceDiagnostic,
  ConfigurationEvidenceDiagnosticCode,
} from './installation-event-evidence.types';

export interface IndexedSourceRecord {
  identityOccurrence: number;
  record: InstallationEventSourceRecord;
}

export interface CollectedSourceRecords {
  records: IndexedSourceRecord[];
  hadInvalidRecord: boolean;
}

interface ValidSourceRecordEntry {
  record: InstallationEventSourceRecord;
  semanticContent: string;
}

export function collectSourceRecords(input: {
  result: GetInstallationEventsResult;
  diagnostics: ConfigurationEvidenceDiagnostic[];
}): CollectedSourceRecords {
  const records: IndexedSourceRecord[] = [];
  const validEntries: ValidSourceRecordEntry[] = [];
  const payloadByIdentity: Map<string, string> = new Map<string, string>();
  const revisionsByRecord: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();
  const occurrencesByIdentity: Map<string, number> = new Map<string, number>();
  const rawRecords: readonly unknown[] = input.result.records;
  let hadInvalidRecord: boolean = false;

  rawRecords.forEach((rawRecord: unknown, responseIndex: number) => {
    if (!isValidSourceRecord(rawRecord)) {
      hadInvalidRecord = true;
      addDiagnostic(
        input.diagnostics,
        'RECORD_INVALID',
        null,
        `responseIndex=${responseIndex}`,
      );
      return;
    }
    validEntries.push({
      record: rawRecord,
      semanticContent: stableSemanticJson(rawRecord),
    });
  });
  validEntries.sort(
    (left: ValidSourceRecordEntry, right: ValidSourceRecordEntry): number => {
      const leftIdentity: string = sourceIdentity(input.result, left.record);
      const rightIdentity: string = sourceIdentity(input.result, right.record);
      return (
        compareStableStrings(leftIdentity, rightIdentity) ||
        compareStableStrings(left.semanticContent, right.semanticContent)
      );
    },
  );

  for (const entry of validEntries) {
    const record: InstallationEventSourceRecord = entry.record;
    const identity: string = sourceIdentity(input.result, record);
    const sourceRecord: string = [
      input.result.source.sourceSystem,
      record.recordId,
    ].join('|');
    const serialized: string = entry.semanticContent;
    const priorPayload: string | undefined = payloadByIdentity.get(identity);
    if (priorPayload === serialized) continue;

    const identityOccurrence: number =
      (occurrencesByIdentity.get(identity) ?? 0) + 1;
    occurrencesByIdentity.set(identity, identityOccurrence);
    if (priorPayload !== undefined) {
      addRecordDiagnostic(
        input.diagnostics,
        'SOURCE_RECORD_IDENTITY_CONFLICT',
        record,
        identity,
      );
    } else {
      payloadByIdentity.set(identity, serialized);
    }

    const revisions: Set<string> =
      revisionsByRecord.get(sourceRecord) ?? new Set<string>();
    if (revisions.size > 0 && !revisions.has(record.revision)) {
      addRecordDiagnostic(
        input.diagnostics,
        'SOURCE_RECORD_REVISION_CONFLICT',
        record,
        sourceRecord,
      );
    }
    revisions.add(record.revision);
    revisionsByRecord.set(sourceRecord, revisions);
    records.push({ identityOccurrence, record });
  }
  return { records, hadInvalidRecord };
}

export function isRecordInQueryWindow(
  record: InstallationEventSourceRecord,
  query: GetInstallationEventsQuery,
): boolean {
  return (
    record.effectiveAt <= query.assessmentAsOf &&
    (query.windowStart === null || record.effectiveAt >= query.windowStart)
  );
}

export function isRecordVisibleAtAssessment(
  record: InstallationEventSourceRecord,
  query: GetInstallationEventsQuery,
): boolean {
  return record.recordedAt <= query.assessmentAsOf;
}

export function isUsableFreshness(value: string): boolean {
  return value === 'CURRENT' || value === 'AS_OF';
}

export function sameQueryScope(
  expected: GetInstallationEventsQuery,
  actual: GetInstallationEventsQuery,
): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export function addRecordDiagnostic(
  diagnostics: ConfigurationEvidenceDiagnostic[],
  code: ConfigurationEvidenceDiagnosticCode,
  record: InstallationEventSourceRecord,
  detail: string,
): void {
  addDiagnostic(diagnostics, code, record.recordId, detail);
}

export function appendRecordDiagnostics(input: {
  diagnostics: ConfigurationEvidenceDiagnostic[];
  record: InstallationEventSourceRecord;
  authorityEligible: boolean;
  recordControlled: boolean;
  recordCoverageComplete: boolean;
  recordFresh: boolean;
  aircraftMatches: boolean;
  recordInWindow: boolean;
  recordVisibleAtAssessment: boolean;
  targetMatches: boolean;
}): void {
  const findings: Array<{
    failed: boolean;
    code: ConfigurationEvidenceDiagnostic['code'];
    detail: string;
  }> = [
    {
      failed: !input.authorityEligible,
      code: 'RECORD_AUTHORITY_INELIGIBLE',
      detail: `${input.record.authorityClass}:${input.record.event.kind}`,
    },
    {
      failed: !input.recordControlled,
      code: 'RECORD_NOT_CONTROLLED',
      detail: input.record.controlStatus,
    },
    {
      failed: !input.recordCoverageComplete,
      code: 'RECORD_COVERAGE_INCOMPLETE',
      detail: input.record.coverage.limitation,
    },
    {
      failed: !input.recordFresh,
      code: 'RECORD_FRESHNESS_UNUSABLE',
      detail: input.record.freshness,
    },
    {
      failed: !input.aircraftMatches,
      code: 'RECORD_AIRCRAFT_MISMATCH',
      detail: input.record.aircraftAssetId,
    },
    {
      failed: !input.recordInWindow,
      code: 'RECORD_OUTSIDE_QUERY_WINDOW',
      detail: input.record.effectiveAt,
    },
    {
      failed: !input.recordVisibleAtAssessment,
      code: 'RECORD_RECORDED_AFTER_AS_OF',
      detail: input.record.recordedAt,
    },
    {
      failed: !input.targetMatches,
      code: 'RECORD_TARGET_MISMATCH',
      detail: input.record.event.kind,
    },
  ];
  for (const finding of findings) {
    if (!finding.failed) continue;
    addRecordDiagnostic(
      input.diagnostics,
      finding.code,
      input.record,
      finding.detail,
    );
  }
}

export function addDiagnostic(
  diagnostics: ConfigurationEvidenceDiagnostic[],
  code: ConfigurationEvidenceDiagnosticCode,
  sourceRecordId: string | null,
  detail: string,
): void {
  diagnostics.push({ code, sourceRecordId, detail });
}

export function assertValidQuery(query: GetInstallationEventsQuery): void {
  if (
    query.schemaVersion !==
      'wiselink.3_1.get_installation_events_query.v0.candidate' ||
    !isNonBlank(query.aircraft.assetId) ||
    !isNonBlank(query.aircraft.aircraftNumber) ||
    !isNullableString(query.aircraft.msn) ||
    !isNullableNonNegativeInteger(query.aircraft.lineNumber) ||
    !isIsoDateTime(query.assessmentAsOf) ||
    (query.windowStart !== null && !isIsoDateTime(query.windowStart)) ||
    (query.windowStart !== null && query.windowStart > query.assessmentAsOf) ||
    !isValidTarget(query.target)
  ) {
    throw new Error('GET_INSTALLATION_EVENTS_QUERY_INVALID');
  }
}

export function assertValidResultEnvelope(
  result: GetInstallationEventsResult,
): void {
  const errorShapeValid: boolean =
    result.error === null ||
    (isFailureCode(result.error.code) &&
      isNonBlank(result.error.message) &&
      typeof result.error.retryable === 'boolean');
  if (
    !isNonBlank(result.source.owner) ||
    !isNonBlank(result.source.sourceSystem) ||
    !isNonBlank(result.source.sourceRevision) ||
    !isIsoDateTime(result.source.observedAt) ||
    !isFreshness(result.source.freshness) ||
    !isValidQueryShape(result.queryScope) ||
    !Array.isArray(result.records) ||
    !isQueryCoverage(result.coverage) ||
    !errorShapeValid ||
    (result.status === 'COMPLETE' && result.error !== null) ||
    (result.status !== 'COMPLETE' && result.error === null) ||
    (result.status === 'UNAVAILABLE' && result.records.length > 0)
  ) {
    throw new Error('GET_INSTALLATION_EVENTS_RESULT_INVALID');
  }
}

function sourceIdentity(
  result: GetInstallationEventsResult,
  record: InstallationEventSourceRecord,
): string {
  return [result.source.sourceSystem, record.recordId, record.revision].join(
    '|',
  );
}

function stableSemanticJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded: string | undefined = JSON.stringify(value);
    return encoded ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown) => stableSemanticJson(item))
      .join(',')}]`;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const properties: string[] = Object.keys(record)
    .sort(compareStableStrings)
    .map(
      (key: string): string =>
        `${JSON.stringify(key)}:${stableSemanticJson(record[key])}`,
    );
  return `{${properties.join(',')}}`;
}

function compareStableStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isFailureCode(
  value: unknown,
): value is GetInstallationEventsFailureCode {
  return [
    'SOURCE_NOT_CONFIGURED',
    'ACCESS_DENIED',
    'TIMEOUT',
    'SOURCE_UNAVAILABLE',
    'AIRCRAFT_AMBIGUOUS',
    'TARGET_AMBIGUOUS',
    'PARTIAL_RESULTS',
    'TRUNCATED',
    'SOURCE_CONFLICT',
  ].includes(String(value));
}

function isValidSourceRecord(
  value: unknown,
): value is InstallationEventSourceRecord {
  if (value === null || typeof value !== 'object') return false;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return (
    isNonBlank(record.recordId) &&
    isNonBlank(record.revision) &&
    isAuthorityClass(record.authorityClass) &&
    (record.controlStatus === 'CONTROLLED' ||
      record.controlStatus === 'RETRACTED' ||
      record.controlStatus === 'UNVERIFIED') &&
    isIsoDateTime(record.observedAt) &&
    isFreshness(record.freshness) &&
    isCoverage(record.coverage) &&
    isNonBlank(record.aircraftAssetId) &&
    (record.position === null || isPosition(record.position)) &&
    isIsoDateTime(record.effectiveAt) &&
    isIsoDateTime(record.recordedAt) &&
    isEventPayload(record.event)
  );
}

function isEventPayload(value: unknown): value is InstallationEventPayload {
  if (value === null || typeof value !== 'object') return false;
  const event: Record<string, unknown> = value as Record<string, unknown>;
  if (event.kind === 'INSTALL') return isComponent(event.installedComponent);
  if (event.kind === 'REMOVE') return isComponent(event.removedComponent);
  if (event.kind === 'REPLACE') {
    return (
      isComponent(event.installedComponent) &&
      isComponent(event.removedComponent)
    );
  }
  if (event.kind === 'SOFTWARE_LOAD') {
    return isSoftwareLoad(event.softwareLoad);
  }
  if (event.kind === 'MODIFICATION_EMBODIMENT') {
    return (
      isModification(event.modification) && isAffectedItem(event.affectedItem)
    );
  }
  if (event.kind === 'REPAIR_ACCOMPLISHMENT') {
    return isRepair(event.repair) && isAffectedItem(event.affectedItem);
  }
  return false;
}

function isComponent(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const component: Record<string, unknown> = value as Record<string, unknown>;
  return (
    isNonBlank(component.componentId) &&
    isNullableString(component.partNumber) &&
    isNullableString(component.serialNumber) &&
    isNullableString(component.equipmentKey)
  );
}

function isSoftwareLoad(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const load: Record<string, unknown> = value as Record<string, unknown>;
  return (
    isNonBlank(load.softwareLoadId) &&
    isNonBlank(load.softwareKey) &&
    isNullableString(load.version) &&
    isNullableString(load.targetComponentId)
  );
}

function isPosition(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const position: Record<string, unknown> = value as Record<string, unknown>;
  return (
    isNonBlank(position.positionId) && isNonBlank(position.sourcePositionKey)
  );
}

function isModification(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return isNonBlank((value as Record<string, unknown>).modificationId);
}

function isRepair(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return isNonBlank((value as Record<string, unknown>).repairId);
}

function isAffectedItem(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const item: Record<string, unknown> = value as Record<string, unknown>;
  return (
    ['AIRCRAFT', 'POSITION', 'PART', 'COMPONENT', 'EQUIPMENT'].includes(
      String(item.kind),
    ) && isNonBlank(item.id)
  );
}

function isQueryCoverage(value: unknown): boolean {
  if (!isCoverage(value)) return false;
  const coverage: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof coverage.allRecordsRead === 'boolean' &&
    typeof coverage.exactAircraftMatch === 'boolean' &&
    typeof coverage.exactTargetMatch === 'boolean'
  );
}

function isCoverage(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const coverage: Record<string, unknown> = value as Record<string, unknown>;
  return (
    isNonBlank(coverage.included) &&
    isNonBlank(coverage.limitation) &&
    ['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(String(coverage.completeness))
  );
}

function isAuthorityClass(value: unknown): boolean {
  return [
    'INSTALLATION_EVENT_SOR',
    'SOFTWARE_LOAD_EVENT_SOR',
    'MAINTENANCE_RELEASE_RECORD',
  ].includes(String(value));
}

function isFreshness(value: unknown): boolean {
  return ['CURRENT', 'AS_OF', 'STALE', 'UNKNOWN'].includes(String(value));
}

function isValidQueryShape(
  value: unknown,
): value is GetInstallationEventsQuery {
  try {
    assertValidQuery(value as GetInstallationEventsQuery);
    return true;
  } catch {
    return false;
  }
}

function isValidTarget(target: ConfigurationEvidenceTarget): boolean {
  if (target.kind === 'COMPONENT') {
    return (
      isNonBlank(target.componentId) && isNullableString(target.positionId)
    );
  }
  if (target.kind === 'EQUIPMENT') {
    return (
      isNonBlank(target.equipmentKey) && isNullableString(target.positionId)
    );
  }
  if (target.kind === 'SOFTWARE') {
    return (
      isNonBlank(target.softwareKey) &&
      isNullableString(target.targetComponentId) &&
      isNullableString(target.positionId)
    );
  }
  if (target.kind === 'MODIFICATION') {
    return isNonBlank(target.modificationId);
  }
  return target.kind === 'REPAIR' && isNonBlank(target.repairId);
}

function isNullableString(value: unknown): boolean {
  return value === null || isNonBlank(value);
}

function isNullableNonNegativeInteger(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0)
  );
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/u.test(value)
  ) {
    return false;
  }
  const parsed: number = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
