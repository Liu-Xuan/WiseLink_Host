import type {
  ConfigurationEventAuthorityClass,
  ConfigurationEvidenceTarget,
  InstallationEventPayload,
  InstallationEventSourceRecord,
} from './get-installation-events.port';
import type {
  ConfigurationEventEvidenceBinding,
  InstallationEvidenceRecordProjection,
} from './installation-event-evidence.types';

export type EventEffect = 'TRUE' | 'FALSE' | 'NONE' | 'CONFLICT';

export interface EventScopeResult {
  inScope: boolean;
  effect: EventEffect;
}

export function eventScope(
  record: InstallationEventSourceRecord,
  target: ConfigurationEvidenceTarget,
): EventScopeResult {
  if (!positionMatches(record, target)) {
    return { inScope: false, effect: 'NONE' };
  }
  const event: InstallationEventPayload = record.event;
  if (target.kind === 'COMPONENT') {
    if (event.kind === 'INSTALL') {
      return matchEffect(
        event.installedComponent.componentId,
        target.componentId,
        'TRUE',
      );
    }
    if (event.kind === 'REMOVE') {
      return matchEffect(
        event.removedComponent.componentId,
        target.componentId,
        'FALSE',
      );
    }
    if (event.kind === 'REPLACE') {
      const installed: boolean =
        event.installedComponent.componentId === target.componentId;
      const removed: boolean =
        event.removedComponent.componentId === target.componentId;
      if (installed && removed) return { inScope: true, effect: 'CONFLICT' };
      if (installed) return { inScope: true, effect: 'TRUE' };
      if (removed) return { inScope: true, effect: 'FALSE' };
    }
    if (
      event.kind === 'SOFTWARE_LOAD' &&
      event.softwareLoad.targetComponentId === target.componentId
    ) {
      return { inScope: true, effect: 'NONE' };
    }
    if (affectsTarget(event, 'COMPONENT', target.componentId)) {
      return { inScope: true, effect: 'NONE' };
    }
    return { inScope: false, effect: 'NONE' };
  }
  if (target.kind === 'EQUIPMENT') {
    if (event.kind === 'INSTALL') {
      return matchEffect(
        event.installedComponent.equipmentKey,
        target.equipmentKey,
        'TRUE',
      );
    }
    if (event.kind === 'REMOVE') {
      return matchEffect(
        event.removedComponent.equipmentKey,
        target.equipmentKey,
        'FALSE',
      );
    }
    if (event.kind === 'REPLACE') {
      const installed: boolean =
        event.installedComponent.equipmentKey === target.equipmentKey;
      const removed: boolean =
        event.removedComponent.equipmentKey === target.equipmentKey;
      if (installed) return { inScope: true, effect: 'TRUE' };
      if (removed) return { inScope: true, effect: 'FALSE' };
    }
    if (affectsTarget(event, 'EQUIPMENT', target.equipmentKey)) {
      return { inScope: true, effect: 'NONE' };
    }
    return { inScope: false, effect: 'NONE' };
  }
  if (target.kind === 'SOFTWARE') {
    if (
      event.kind === 'SOFTWARE_LOAD' &&
      event.softwareLoad.softwareKey === target.softwareKey &&
      (target.targetComponentId === null ||
        event.softwareLoad.targetComponentId === target.targetComponentId)
    ) {
      return { inScope: true, effect: 'TRUE' };
    }
    return { inScope: false, effect: 'NONE' };
  }
  if (
    target.kind === 'MODIFICATION' &&
    event.kind === 'MODIFICATION_EMBODIMENT' &&
    event.modification.modificationId === target.modificationId
  ) {
    return { inScope: true, effect: 'TRUE' };
  }
  if (
    target.kind === 'REPAIR' &&
    event.kind === 'REPAIR_ACCOMPLISHMENT' &&
    event.repair.repairId === target.repairId
  ) {
    return { inScope: true, effect: 'TRUE' };
  }
  return { inScope: false, effect: 'NONE' };
}

export function appendEventBindings(input: {
  bindings: ConfigurationEventEvidenceBinding[];
  evidenceRecordId: string;
  configEventId: string;
  record: InstallationEventSourceRecord;
}): void {
  appendBinding(
    input.bindings,
    'SUPPORTS',
    input.evidenceRecordId,
    input.configEventId,
    input.evidenceRecordId,
  );
  appendBinding(
    input.bindings,
    'ON_AIRCRAFT',
    input.configEventId,
    input.record.aircraftAssetId,
    input.evidenceRecordId,
  );
  if (input.record.position) {
    appendBinding(
      input.bindings,
      'AT_POSITION',
      input.configEventId,
      input.record.position.positionId,
      input.evidenceRecordId,
    );
  }
  const event: InstallationEventPayload = input.record.event;
  if (event.kind === 'INSTALL') {
    appendBinding(
      input.bindings,
      'INSTALLS',
      input.configEventId,
      event.installedComponent.componentId,
      input.evidenceRecordId,
    );
  } else if (event.kind === 'REMOVE') {
    appendBinding(
      input.bindings,
      'REMOVES',
      input.configEventId,
      event.removedComponent.componentId,
      input.evidenceRecordId,
    );
  } else if (event.kind === 'REPLACE') {
    appendReplacementBindings(input, event);
  } else if (event.kind === 'SOFTWARE_LOAD') {
    appendSoftwareBindings(input, event);
  } else if (event.kind === 'MODIFICATION_EMBODIMENT') {
    appendBinding(
      input.bindings,
      'EMBODIES_MODIFICATION',
      input.configEventId,
      event.modification.modificationId,
      input.evidenceRecordId,
    );
    appendBinding(
      input.bindings,
      'AFFECTS_ITEM',
      event.modification.modificationId,
      event.affectedItem.id,
      input.evidenceRecordId,
    );
  } else {
    appendBinding(
      input.bindings,
      'ACCOMPLISHES_REPAIR',
      input.configEventId,
      event.repair.repairId,
      input.evidenceRecordId,
    );
    appendBinding(
      input.bindings,
      'AFFECTS_ITEM',
      event.repair.repairId,
      event.affectedItem.id,
      input.evidenceRecordId,
    );
  }
}

export function appendBinding(
  bindings: ConfigurationEventEvidenceBinding[],
  relation: ConfigurationEventEvidenceBinding['relation'],
  fromRef: string,
  toRef: string,
  evidenceRecordId: string,
): void {
  bindings.push({
    bindingId: `CONFIGURATION-EVIDENCE-BINDING:${bindings.length + 1}:${relation}`,
    relation,
    fromRef,
    toRef,
    evidenceRecordId,
  });
}

export function authoritySupportsEvent(
  authority: ConfigurationEventAuthorityClass,
  kind: InstallationEventPayload['kind'],
): boolean {
  if (authority === 'MAINTENANCE_RELEASE_RECORD') return true;
  if (authority === 'SOFTWARE_LOAD_EVENT_SOR') {
    return kind === 'SOFTWARE_LOAD';
  }
  return kind === 'INSTALL' || kind === 'REMOVE' || kind === 'REPLACE';
}

export function evidenceRole(
  kind: InstallationEventPayload['kind'],
): InstallationEvidenceRecordProjection['evidenceRole'] {
  const roles: Record<
    InstallationEventPayload['kind'],
    InstallationEvidenceRecordProjection['evidenceRole']
  > = {
    INSTALL: 'INSTALLATION_EVENT_EVIDENCE',
    REMOVE: 'REMOVAL_EVENT_EVIDENCE',
    REPLACE: 'REPLACEMENT_EVENT_EVIDENCE',
    SOFTWARE_LOAD: 'SOFTWARE_LOAD_EVENT_EVIDENCE',
    MODIFICATION_EMBODIMENT: 'MODIFICATION_EMBODIMENT_EVIDENCE',
    REPAIR_ACCOMPLISHMENT: 'REPAIR_ACCOMPLISHMENT_EVIDENCE',
  };
  return roles[kind];
}

function appendReplacementBindings(
  input: {
    bindings: ConfigurationEventEvidenceBinding[];
    evidenceRecordId: string;
    configEventId: string;
  },
  event: Extract<InstallationEventPayload, { kind: 'REPLACE' }>,
): void {
  appendBinding(
    input.bindings,
    'INSTALLS',
    input.configEventId,
    event.installedComponent.componentId,
    input.evidenceRecordId,
  );
  appendBinding(
    input.bindings,
    'REMOVES',
    input.configEventId,
    event.removedComponent.componentId,
    input.evidenceRecordId,
  );
  appendBinding(
    input.bindings,
    'REPLACES',
    event.installedComponent.componentId,
    event.removedComponent.componentId,
    input.evidenceRecordId,
  );
}

function appendSoftwareBindings(
  input: {
    bindings: ConfigurationEventEvidenceBinding[];
    evidenceRecordId: string;
    configEventId: string;
  },
  event: Extract<InstallationEventPayload, { kind: 'SOFTWARE_LOAD' }>,
): void {
  appendBinding(
    input.bindings,
    'LOADS_SOFTWARE',
    input.configEventId,
    event.softwareLoad.softwareLoadId,
    input.evidenceRecordId,
  );
  if (!event.softwareLoad.targetComponentId) return;
  appendBinding(
    input.bindings,
    'LOADED_ON',
    event.softwareLoad.softwareLoadId,
    event.softwareLoad.targetComponentId,
    input.evidenceRecordId,
  );
}

function matchEffect(
  actual: string | null,
  expected: string,
  effect: 'TRUE' | 'FALSE',
): EventScopeResult {
  return actual === expected
    ? { inScope: true, effect }
    : { inScope: false, effect: 'NONE' };
}

function affectsTarget(
  event: InstallationEventPayload,
  kind: 'COMPONENT' | 'EQUIPMENT',
  id: string,
): boolean {
  return (
    (event.kind === 'MODIFICATION_EMBODIMENT' ||
      event.kind === 'REPAIR_ACCOMPLISHMENT') &&
    event.affectedItem.kind === kind &&
    event.affectedItem.id === id
  );
}

function positionMatches(
  record: InstallationEventSourceRecord,
  target: ConfigurationEvidenceTarget,
): boolean {
  if (target.kind === 'MODIFICATION' || target.kind === 'REPAIR') return true;
  return (
    target.positionId === null ||
    record.position?.positionId === target.positionId
  );
}
