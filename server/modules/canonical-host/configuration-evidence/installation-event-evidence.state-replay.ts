import type {
  ConfigurationEvidenceTarget,
  GetInstallationEventsQuery,
  InstallationEventSourceRecord,
} from './get-installation-events.port';
import {
  addAssertionSupportBindings,
  conflictAssertion,
  markConflictBindings,
  markEventsConflict,
  supportedAssertion,
  type CurrentTargetIdentity,
  type MappedEventCandidate,
} from './installation-event-evidence.current-state';
import type {
  EventEffect,
  EventScopeResult,
} from './installation-event-evidence.relations';
import type {
  ConfigEventEvidenceProjection,
  ConfigurationEventEvidenceBinding,
  ConfigurationEvidenceDiagnostic,
  CurrentConfigurationAssertionCandidate,
} from './installation-event-evidence.types';

interface LatestCandidateState {
  stateKey: string;
  latestEffectiveAt: string;
  latestCandidates: MappedEventCandidate[];
  effect: 'TRUE' | 'FALSE' | 'CONFLICT';
  value: boolean | string | null;
}

export interface CurrentAssertionClosureInput {
  query: GetInstallationEventsQuery;
  targetIdentity: CurrentTargetIdentity;
  mappedCandidates: MappedEventCandidate[];
  configEvents: ConfigEventEvidenceProjection[];
  bindings: ConfigurationEventEvidenceBinding[];
  diagnostics: ConfigurationEvidenceDiagnostic[];
}

export function createMappedEventCandidates(input: {
  query: GetInstallationEventsQuery;
  record: InstallationEventSourceRecord;
  scope: EventScopeResult;
  evidenceRecordId: string;
  configEventId: string;
  canCloseCurrentState: boolean;
}): MappedEventCandidate[] {
  if (input.scope.effect === 'NONE') return [];
  const target: ConfigurationEvidenceTarget = input.query.target;
  if (target.kind === 'EQUIPMENT' && target.positionId === null) {
    return aircraftEquipmentCandidates({
      record: input.record,
      equipmentKey: target.equipmentKey,
      evidenceRecordId: input.evidenceRecordId,
      configEventId: input.configEventId,
      canCloseCurrentState: input.canCloseCurrentState,
    });
  }
  return [
    mappedCandidate({
      record: input.record,
      effect: input.scope.effect,
      stateKey: 'QUERY_TARGET',
      evidenceRecordId: input.evidenceRecordId,
      configEventId: input.configEventId,
      canCloseCurrentState: input.canCloseCurrentState,
    }),
  ];
}

export function closeCurrentAssertion(
  input: CurrentAssertionClosureInput,
): CurrentConfigurationAssertionCandidate {
  if (
    input.query.target.kind === 'EQUIPMENT' &&
    input.query.target.positionId === null
  ) {
    return closeAircraftEquipmentAssertion(input);
  }
  return closeSingleStateAssertion(input);
}

function aircraftEquipmentCandidates(input: {
  record: InstallationEventSourceRecord;
  equipmentKey: string;
  evidenceRecordId: string;
  configEventId: string;
  canCloseCurrentState: boolean;
}): MappedEventCandidate[] {
  const candidates: MappedEventCandidate[] = [];
  const event: InstallationEventSourceRecord['event'] = input.record.event;
  if (
    event.kind === 'INSTALL' &&
    event.installedComponent.equipmentKey === input.equipmentKey
  ) {
    candidates.push(
      equipmentCandidate(input, event.installedComponent.componentId, 'TRUE'),
    );
  } else if (
    event.kind === 'REMOVE' &&
    event.removedComponent.equipmentKey === input.equipmentKey
  ) {
    candidates.push(
      equipmentCandidate(input, event.removedComponent.componentId, 'FALSE'),
    );
  } else if (event.kind === 'REPLACE') {
    if (event.installedComponent.equipmentKey === input.equipmentKey) {
      candidates.push(
        equipmentCandidate(input, event.installedComponent.componentId, 'TRUE'),
      );
    }
    if (event.removedComponent.equipmentKey === input.equipmentKey) {
      candidates.push(
        equipmentCandidate(input, event.removedComponent.componentId, 'FALSE'),
      );
    }
  }
  return candidates;
}

function equipmentCandidate(
  input: {
    record: InstallationEventSourceRecord;
    evidenceRecordId: string;
    configEventId: string;
    canCloseCurrentState: boolean;
  },
  componentId: string,
  effect: 'TRUE' | 'FALSE',
): MappedEventCandidate {
  return mappedCandidate({
    record: input.record,
    effect,
    stateKey: equipmentInstanceStateKey(
      componentId,
      input.record.position?.positionId ?? null,
    ),
    evidenceRecordId: input.evidenceRecordId,
    configEventId: input.configEventId,
    canCloseCurrentState: input.canCloseCurrentState,
  });
}

function mappedCandidate(input: {
  record: InstallationEventSourceRecord;
  effect: Exclude<EventEffect, 'NONE'>;
  stateKey: string;
  evidenceRecordId: string;
  configEventId: string;
  canCloseCurrentState: boolean;
}): MappedEventCandidate {
  return {
    evidenceRecordId: input.evidenceRecordId,
    configEventId: input.configEventId,
    effectiveAt: input.record.effectiveAt,
    effect: input.effect,
    value: candidateValue(input.record, input.effect),
    stateKey: input.stateKey,
    canCloseCurrentState: input.canCloseCurrentState,
  };
}

function equipmentInstanceStateKey(
  componentId: string,
  positionId: string | null,
): string {
  return JSON.stringify([componentId, positionId]);
}

function candidateValue(
  record: InstallationEventSourceRecord,
  effect: Exclude<EventEffect, 'NONE'>,
): boolean | string | null {
  if (effect === 'FALSE') return false;
  if (effect !== 'TRUE') return null;
  return record.event.kind === 'SOFTWARE_LOAD'
    ? record.event.softwareLoad.softwareLoadId
    : true;
}

function closeSingleStateAssertion(
  input: CurrentAssertionClosureInput,
): CurrentConfigurationAssertionCandidate {
  const state: LatestCandidateState = latestCandidateState(
    input.mappedCandidates[0].stateKey,
    input.mappedCandidates,
  );
  if (state.effect === 'CONFLICT' || state.value === null) {
    return stateConflictAssertion(input, [state]);
  }
  const truth: 'TRUE' | 'FALSE' = state.effect === 'TRUE' ? 'TRUE' : 'FALSE';
  const assertion: CurrentConfigurationAssertionCandidate = supportedAssertion(
    input.query,
    input.targetIdentity,
    truth,
    state.value,
    state.latestCandidates,
  );
  addAssertionSupportBindings(
    assertion,
    state.latestCandidates,
    input.bindings,
  );
  return assertion;
}

function closeAircraftEquipmentAssertion(
  input: CurrentAssertionClosureInput,
): CurrentConfigurationAssertionCandidate {
  const candidatesByState: Map<string, MappedEventCandidate[]> = new Map<
    string,
    MappedEventCandidate[]
  >();
  for (const candidate of input.mappedCandidates) {
    const stateCandidates: MappedEventCandidate[] =
      candidatesByState.get(candidate.stateKey) ?? [];
    stateCandidates.push(candidate);
    candidatesByState.set(candidate.stateKey, stateCandidates);
  }

  const states: LatestCandidateState[] = [];
  for (const entry of candidatesByState.entries()) {
    const stateKey: string = entry[0];
    const candidates: MappedEventCandidate[] = entry[1];
    states.push(latestCandidateState(stateKey, candidates));
  }
  const conflictStates: LatestCandidateState[] = states.filter(
    (state: LatestCandidateState) =>
      state.effect === 'CONFLICT' || state.value === null,
  );
  if (conflictStates.length > 0) {
    return stateConflictAssertion(input, conflictStates);
  }

  const installedCandidates: MappedEventCandidate[] = states
    .filter((state: LatestCandidateState) => state.effect === 'TRUE')
    .flatMap((state: LatestCandidateState) => state.latestCandidates);
  const truth: 'TRUE' | 'FALSE' =
    installedCandidates.length > 0 ? 'TRUE' : 'FALSE';
  const supportingCandidates: MappedEventCandidate[] =
    truth === 'TRUE'
      ? installedCandidates
      : states.flatMap((state: LatestCandidateState) => state.latestCandidates);
  const assertion: CurrentConfigurationAssertionCandidate = supportedAssertion(
    input.query,
    input.targetIdentity,
    truth,
    truth === 'TRUE',
    supportingCandidates,
  );
  addAssertionSupportBindings(assertion, supportingCandidates, input.bindings);
  return assertion;
}

function latestCandidateState(
  stateKey: string,
  candidates: MappedEventCandidate[],
): LatestCandidateState {
  const latestEffectiveAt: string = candidates.reduce(
    (latest: string, candidate: MappedEventCandidate) =>
      candidate.effectiveAt > latest ? candidate.effectiveAt : latest,
    candidates[0].effectiveAt,
  );
  const latestCandidates: MappedEventCandidate[] = candidates.filter(
    (candidate: MappedEventCandidate) =>
      candidate.effectiveAt === latestEffectiveAt,
  );
  const effects: Set<EventEffect> = new Set<EventEffect>(
    latestCandidates.map((candidate: MappedEventCandidate) => candidate.effect),
  );
  const values: Set<string> = new Set<string>(
    latestCandidates.map((candidate: MappedEventCandidate) =>
      JSON.stringify(candidate.value),
    ),
  );
  const conflicted: boolean =
    effects.size !== 1 || effects.has('CONFLICT') || values.size !== 1;
  return {
    stateKey,
    latestEffectiveAt,
    latestCandidates,
    effect: conflicted ? 'CONFLICT' : latestCandidates[0].effect,
    value: conflicted ? null : latestCandidates[0].value,
  };
}

function stateConflictAssertion(
  input: CurrentAssertionClosureInput,
  conflictStates: LatestCandidateState[],
): CurrentConfigurationAssertionCandidate {
  for (const state of conflictStates) {
    input.diagnostics.push({
      code: 'EVENT_STATE_CONFLICT',
      sourceRecordId: null,
      detail: `${state.stateKey}:${state.latestEffectiveAt}`,
    });
  }
  const conflictCandidates: MappedEventCandidate[] = conflictStates.flatMap(
    (state: LatestCandidateState) => state.latestCandidates,
  );
  const assertion: CurrentConfigurationAssertionCandidate = conflictAssertion(
    input.query,
    input.targetIdentity,
  );
  markEventsConflict(conflictCandidates, input.configEvents);
  markConflictBindings(assertion, conflictCandidates, input.bindings);
  return assertion;
}
