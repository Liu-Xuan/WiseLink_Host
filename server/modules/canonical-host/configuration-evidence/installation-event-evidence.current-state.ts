import type {
  ConfigurationEvidenceTarget,
  GetInstallationEventsQuery,
  InstallationEventSourceRecord,
} from './get-installation-events.port';
import { appendBinding } from './installation-event-evidence.relations';
import type {
  ConfigEventEvidenceProjection,
  ConfigurationEventEvidenceBinding,
  CurrentConfigurationAssertionCandidate,
  CurrentConfigurationProperty,
} from './installation-event-evidence.types';

export interface MappedEventCandidate {
  evidenceRecordId: string;
  configEventId: string;
  effectiveAt: string;
  effect: 'TRUE' | 'FALSE' | 'CONFLICT';
  value: boolean | string | null;
  canCloseCurrentState: boolean;
}

export interface CurrentTargetIdentity {
  targetRef: string;
  property: CurrentConfigurationProperty;
}

export function currentTargetIdentity(
  query: GetInstallationEventsQuery,
): CurrentTargetIdentity {
  const target: ConfigurationEvidenceTarget = query.target;
  if (target.kind === 'COMPONENT') {
    return { targetRef: target.componentId, property: 'component.installed' };
  }
  if (target.kind === 'EQUIPMENT') {
    return {
      targetRef: `EQUIPMENT:${target.equipmentKey}`,
      property: 'component.installed',
    };
  }
  if (target.kind === 'SOFTWARE') {
    return {
      targetRef: `SOFTWARE:${target.softwareKey}`,
      property: 'software.loaded',
    };
  }
  if (target.kind === 'MODIFICATION') {
    return {
      targetRef: target.modificationId,
      property: 'modification.embodied',
    };
  }
  return { targetRef: target.repairId, property: 'repair.present' };
}

export function supportedAssertion(
  query: GetInstallationEventsQuery,
  target: CurrentTargetIdentity,
  truth: 'TRUE' | 'FALSE',
  value: boolean | string,
  candidates: MappedEventCandidate[],
): CurrentConfigurationAssertionCandidate {
  return {
    ...assertionBase(query, target),
    truth,
    value,
    status: 'SUPPORTED',
    authority: 'CONTROLLED_SOURCE',
    supportingEvidenceRecordIds: candidates.map(
      (candidate: MappedEventCandidate) => candidate.evidenceRecordId,
    ),
    derivedConfigEventIds: candidates.map(
      (candidate: MappedEventCandidate) => candidate.configEventId,
    ),
  };
}

export function unresolvedAssertion(
  query: GetInstallationEventsQuery,
  target: CurrentTargetIdentity,
): CurrentConfigurationAssertionCandidate {
  return {
    ...assertionBase(query, target),
    truth: 'UNKNOWN',
    value: null,
    status: 'WAITING_INPUT',
    authority: 'NONE',
    supportingEvidenceRecordIds: [],
    derivedConfigEventIds: [],
  };
}

export function conflictAssertion(
  query: GetInstallationEventsQuery,
  target: CurrentTargetIdentity,
): CurrentConfigurationAssertionCandidate {
  return {
    ...assertionBase(query, target),
    truth: 'CONFLICT',
    value: null,
    status: 'CONFLICT',
    authority: 'NONE',
    supportingEvidenceRecordIds: [],
    derivedConfigEventIds: [],
  };
}

export function addAssertionSupportBindings(
  assertion: CurrentConfigurationAssertionCandidate,
  candidates: MappedEventCandidate[],
  bindings: ConfigurationEventEvidenceBinding[],
): void {
  for (const candidate of candidates) {
    appendBinding(
      bindings,
      'SUPPORTS',
      candidate.evidenceRecordId,
      assertion.assertionId,
      candidate.evidenceRecordId,
    );
    appendBinding(
      bindings,
      'DERIVED_FROM',
      assertion.assertionId,
      candidate.configEventId,
      candidate.evidenceRecordId,
    );
  }
}

export function markConflictBindings(
  assertion: CurrentConfigurationAssertionCandidate,
  candidates: MappedEventCandidate[],
  bindings: ConfigurationEventEvidenceBinding[],
): void {
  for (const candidate of candidates) {
    appendBinding(
      bindings,
      'AFFECTED_BY',
      assertion.assertionId,
      candidate.evidenceRecordId,
      candidate.evidenceRecordId,
    );
    appendBinding(
      bindings,
      'AFFECTED_BY',
      assertion.assertionId,
      candidate.configEventId,
      candidate.evidenceRecordId,
    );
  }
}

export function markEventsConflict(
  candidates: MappedEventCandidate[],
  events: ConfigEventEvidenceProjection[],
): void {
  const eventIds: Set<string> = new Set<string>(
    candidates.map(
      (candidate: MappedEventCandidate) => candidate.configEventId,
    ),
  );
  for (const event of events) {
    if (!eventIds.has(event.configEventId)) continue;
    event.occurrenceStatus = 'CONFLICT';
    event.eventChainStatus = 'CONFLICT';
  }
}

export function evidenceId(
  sourceSystem: string,
  record: InstallationEventSourceRecord,
  identityOccurrence: number,
): string {
  const base: string = [
    'CONFIGURATION-EVIDENCE',
    encodeURIComponent(sourceSystem),
    encodeURIComponent(record.recordId),
    encodeURIComponent(record.revision),
  ].join(':');
  return identityOccurrence === 1
    ? base
    : `${base}:CONFLICTING-OBSERVATION-${identityOccurrence}`;
}

export function eventId(evidenceRecordId: string): string {
  return `CONFIGURATION-EVENT:${evidenceRecordId}`;
}

function assertionBase(
  query: GetInstallationEventsQuery,
  target: CurrentTargetIdentity,
): Pick<
  CurrentConfigurationAssertionCandidate,
  'assertionId' | 'type' | 'targetRef' | 'property' | 'assessmentAsOf'
> {
  const assertionScope: string = [
    query.aircraft.assetId,
    target.targetRef,
    query.assessmentAsOf,
  ]
    .map((value: string) => encodeURIComponent(value))
    .join(':');
  return {
    assertionId: `CONFIGURATION-ASSERTION:${assertionScope}`,
    type: 'FactAssertion',
    targetRef: target.targetRef,
    property: target.property,
    assessmentAsOf: query.assessmentAsOf,
  };
}
