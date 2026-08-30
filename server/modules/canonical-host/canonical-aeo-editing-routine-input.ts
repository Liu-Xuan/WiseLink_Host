import type { CanonicalAeoEditingSourceRef } from '@shared/api.interface';
import {
  consumeAeoRoutineRevisionReplay,
  type AeoEditingSourceIdentity,
  type AeoRoutineRevisionReplayCandidate,
} from '../aeo-authoring/aeo-editing-knowledge';

export interface CanonicalAeoEditingRoutineInput {
  sources: AeoEditingSourceIdentity[];
  sourceRefs: CanonicalAeoEditingSourceRef[];
  sampleRef: string;
}

export function isRoutineProducer(value: unknown): boolean {
  const record = asRecord(value, 'currentProducerRecord');
  return (
    record.recordType === 'aeo-editing-v0-category-knowledge-candidate' &&
    record.category === 'ROUTINE_PARAMETER_REVISION_UPDATE'
  );
}

export function validateRoutineInput(
  producerValue: unknown,
  manifestValue: unknown,
): CanonicalAeoEditingRoutineInput {
  const producer = asRecord(producerValue, 'currentProducerRecord');
  const manifest = asRecord(manifestValue, 'sourceManifest');
  if (
    producer.status !== 'CANDIDATE_ONLY' ||
    manifest.recordType !== 'local-aeo-routine-revision-sample-provenance' ||
    manifest.status !== 'CANDIDATE_ONLY' ||
    !Array.isArray(manifest.sources)
  ) {
    throw new Error('AEO_ROUTINE_SERIES_PATTERN_INPUT_INVALID');
  }
  const typed: AeoRoutineRevisionReplayCandidate =
    consumeAeoRoutineRevisionReplay(
      routineValidationProjection(producer),
      producer,
      manifest,
    );
  const seen = new Set<string>();
  const sources = manifest.sources.map((value, index) => {
    const source = asRecord(value, `sourceManifest.sources[${index}]`);
    const sourceId = requiredText(source.sourceId, 'sourceId');
    const sha256 = requiredText(source.sha256, 'sha256');
    if (
      seen.has(sourceId) ||
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      !Number.isSafeInteger(source.bytes) ||
      Number(source.bytes) < 1
    ) {
      throw new Error('AEO_ROUTINE_SERIES_PATTERN_SOURCE_INVALID');
    }
    seen.add(sourceId);
    return {
      sourceId,
      role: requiredText(source.role, 'role'),
      artifactRef: requiredText(source.path, 'path'),
      actualBytes: Number(source.bytes),
      sha256,
      observedIdentity:
        typeof source.observedIdentity === 'string'
          ? source.observedIdentity
          : null,
      identityLocator: null,
    };
  });
  const aliases = asRecord(producer.sourceRefs, 'sourceRefs');
  const aliasSourceIds = new Set<string>();
  const aliasRefs = Object.values(aliases).flatMap((value) => {
    const alias = asRecord(value, 'sourceRef');
    const sourceId = requiredText(alias.sourceId, 'sourceRef.sourceId');
    if (!seen.has(sourceId)) {
      throw new Error('AEO_ROUTINE_SERIES_PATTERN_SOURCE_REF_UNDECLARED');
    }
    if (aliasSourceIds.has(sourceId)) {
      throw new Error('AEO_ROUTINE_SERIES_PATTERN_SOURCE_REF_DUPLICATE');
    }
    aliasSourceIds.add(sourceId);
    const locators = asRecord(alias.locators, 'sourceRef.locators');
    return Object.values(locators).map((locator) => ({
      sourceId,
      locator: requiredText(locator, 'sourceRef.locators[]'),
    }));
  });
  const evidenceRefs = validateRoutineEvidenceRefs(producer, aliases, seen);
  const transitions = Array.isArray(producer.transitions)
    ? producer.transitions.map((value) => asRecord(value, 'transition'))
    : [];
  const current = transitions.find(
    (transition) => transition.transitionId === 'R26_TO_R27',
  );
  if (!current) {
    throw new Error('AEO_ROUTINE_SERIES_PATTERN_CURRENT_TRANSITION_MISSING');
  }
  for (const field of ['baseline', 'result', 'source'] as const) {
    const sourceId = requiredText(current[field], `transition.${field}`);
    if (!seen.has(sourceId)) {
      throw new Error('AEO_ROUTINE_SERIES_PATTERN_SOURCE_REF_UNDECLARED');
    }
  }
  return {
    sources,
    sourceRefs: uniqueRefs([
      {
        sourceId: typed.targetSourceId,
        locator: 'active section header identity',
      },
      ...aliasRefs,
      ...evidenceRefs,
    ]),
    sampleRef: requiredText(producer.sampleRef, 'sampleRef'),
  };
}

function routineValidationProjection(
  producer: Record<string, unknown>,
): Record<string, unknown> {
  return {
    recordType: 'aeo-editing-v0-local-consumer-projection',
    status: 'CANDIDATE_ONLY',
    projectionVersion: 'host-current-producer-validation.v1',
    categoryPatterns: [
      {
        category: 'ROUTINE_PARAMETER_REVISION_UPDATE',
        sampleRefs: [requiredText(producer.sampleRef, 'sampleRef')],
        observedSectionCandidate: [],
        ruleStrength: 'ONE_SERIES_PATTERN_REMAINS_NON_GENERALIZABLE',
      },
    ],
  };
}

function validateRoutineEvidenceRefs(
  producer: Record<string, unknown>,
  aliases: Record<string, unknown>,
  declaredSourceIds: Set<string>,
): CanonicalAeoEditingSourceRef[] {
  const refs: CanonicalAeoEditingSourceRef[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if (key !== 'sourceEvidence') {
        visit(child);
        return;
      }
      if (!Array.isArray(child) || new Set(child).size !== child.length) {
        throw new Error('AEO_ROUTINE_SERIES_PATTERN_EVIDENCE_REF_DUPLICATE');
      }
      child.forEach((raw) => {
        const compact = requiredText(raw, 'sourceEvidence[]');
        const separator = compact.indexOf(':');
        const aliasName = compact.slice(0, separator);
        const locator = compact.slice(separator + 1).trim();
        const alias = asRecord(aliases[aliasName], 'sourceEvidence.alias');
        const sourceId = requiredText(
          alias.sourceId,
          'sourceEvidence.sourceId',
        );
        if (separator < 1 || !locator || !declaredSourceIds.has(sourceId)) {
          throw new Error('AEO_ROUTINE_SERIES_PATTERN_EVIDENCE_REF_UNDECLARED');
        }
        refs.push({ sourceId, locator });
      });
    });
  };
  visit(producer);
  return refs;
}

function uniqueRefs(
  refs: CanonicalAeoEditingSourceRef[],
): CanonicalAeoEditingSourceRef[] {
  return Array.from(
    new Map(
      refs.map((ref) => [`${ref.sourceId}#${ref.locator}`, ref]),
    ).values(),
  );
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`AEO_EDITING_EXPECTED_OBJECT:${path}`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AEO_EDITING_REQUIRED_TEXT:${path}`);
  }
  return value.trim();
}
