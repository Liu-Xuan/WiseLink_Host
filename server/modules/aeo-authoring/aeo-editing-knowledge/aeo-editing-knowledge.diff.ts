import type {
  AeoEditingActionUnit,
  AeoEditingKnowledgeCandidate,
  AeoEditingKnowledgeVersionDiff,
} from './aeo-editing-knowledge.types';
import { assertAeoEditingKnowledgeCandidate } from './aeo-editing-knowledge.validator';

export function diffAeoEditingKnowledgeVersions(
  from: AeoEditingKnowledgeCandidate,
  to: AeoEditingKnowledgeCandidate,
): AeoEditingKnowledgeVersionDiff {
  assertAeoEditingKnowledgeCandidate(from);
  assertAeoEditingKnowledgeCandidate(to);
  const fromMap: Map<string, AeoEditingActionUnit> = new Map(
    from.actionUnits.map((unit: AeoEditingActionUnit) => [unit.unitId, unit]),
  );
  const toMap: Map<string, AeoEditingActionUnit> = new Map(
    to.actionUnits.map((unit: AeoEditingActionUnit) => [unit.unitId, unit]),
  );
  const unitIds: string[] = Array.from(
    new Set([...fromMap.keys(), ...toMap.keys()]),
  );
  return {
    fromKnowledgeVersion: from.knowledgeVersion,
    toKnowledgeVersion: to.knowledgeVersion,
    sameMatter:
      from.documentIdentity.aeoNumber === to.documentIdentity.aeoNumber,
    changes: unitIds.map((unitId: string) =>
      diffAction(unitId, fromMap.get(unitId), toMap.get(unitId)),
    ),
    boundary: 'DIFF_ASSISTANCE_NOT_ENGINEERING_CONCLUSION',
  };
}

function diffAction(
  unitId: string,
  from: AeoEditingActionUnit | undefined,
  to: AeoEditingActionUnit | undefined,
): AeoEditingKnowledgeVersionDiff['changes'][number] {
  if (!from && to) {
    return {
      unitId,
      change: 'ADDED',
      reasons: ['Action unit is present only in the later candidate version.'],
      fromSourceRefs: [],
      toSourceRefs: to.sourceRefs,
    };
  }
  if (from && !to) {
    return {
      unitId,
      change: 'REMOVED',
      reasons: ['Action unit is absent from the later candidate version.'],
      fromSourceRefs: from.sourceRefs,
      toSourceRefs: [],
    };
  }
  if (!from || !to) {
    throw new Error('AEO_KNOWLEDGE_DIFF_INTERNAL_ERROR');
  }
  const reasons: string[] = [];
  compareStructuredField('sequence', from.sequence, to.sequence, reasons);
  compareField('phase', from.phase, to.phase, reasons);
  compareField('operation', from.operation, to.operation, reasons);
  compareField('object', from.object, to.object, reasons);
  compareField('Chinese text', from.bodyZh, to.bodyZh, reasons);
  compareField('English text', from.bodyEn, to.bodyEn, reasons);
  compareStructuredField(
    'dependencies',
    from.dependencies,
    to.dependencies,
    reasons,
  );
  compareField(
    'parameters',
    JSON.stringify(from.parameters),
    JSON.stringify(to.parameters),
    reasons,
  );
  compareField(
    'branches',
    JSON.stringify(from.branches),
    JSON.stringify(to.branches),
    reasons,
  );
  compareField(
    'roles/signature',
    JSON.stringify([
      from.performerRoles,
      from.inspectorRoles,
      from.signatureGranularity,
    ]),
    JSON.stringify([
      to.performerRoles,
      to.inspectorRoles,
      to.signatureGranularity,
    ]),
    reasons,
  );
  compareStructuredField('conditions', from.conditions, to.conditions, reasons);
  compareStructuredField(
    'verifications',
    from.verifications,
    to.verifications,
    reasons,
  );
  compareStructuredField('closeout', from.closeout, to.closeout, reasons);
  compareStructuredField(
    'safety notes',
    from.safetyNotes,
    to.safetyNotes,
    reasons,
  );
  compareStructuredField(
    'inspection detail',
    from.inspectionDetail,
    to.inspectionDetail,
    reasons,
  );
  compareStructuredField(
    'source references',
    from.sourceRefs,
    to.sourceRefs,
    reasons,
  );
  compareField(
    'source disposition',
    from.sourceDisposition,
    to.sourceDisposition,
    reasons,
  );
  compareField('review status', from.reviewStatus, to.reviewStatus, reasons);
  return {
    unitId,
    change: reasons.length === 0 ? 'UNCHANGED' : 'CHANGED',
    reasons,
    fromSourceRefs: from.sourceRefs,
    toSourceRefs: to.sourceRefs,
  };
}

function compareStructuredField(
  label: string,
  from: unknown,
  to: unknown,
  reasons: string[],
): void {
  compareField(label, JSON.stringify(from), JSON.stringify(to), reasons);
}

function compareField(
  label: string,
  from: string | null,
  to: string | null,
  reasons: string[],
): void {
  if (from !== to) {
    reasons.push(`${label} changed.`);
  }
}
