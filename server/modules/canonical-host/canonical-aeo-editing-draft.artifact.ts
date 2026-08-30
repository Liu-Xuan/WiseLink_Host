import type {
  CanonicalAeoEditingBlockingGap,
  CanonicalAeoEditingDraftProjection,
  CanonicalAeoEditingDraftReadModel,
  CanonicalAeoEditingInputProjection,
  CanonicalAeoEditingSourceRef,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  buildAeoDraftLearningInput,
  type AeoDraftAssistanceCandidate,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingSourceIdentity,
  type AeoEditingSourceRef,
} from '../aeo-authoring/aeo-editing-knowledge';

const ARTIFACT_KIND = 'CANONICAL_AEO_EDITING_DRAFT_CANDIDATE' as const;
const ARTIFACT_VERSION = 1 as const;

export interface CanonicalAeoEditingDraftArtifact {
  kind: typeof ARTIFACT_KIND;
  version: typeof ARTIFACT_VERSION;
  lifecycleStatus: 'CANDIDATE_ONLY';
  draftRevision: number;
  workItemBinding: {
    workItemId: string;
    documentVersionId: string;
    sourcePackageId: string;
    sourcePackageArtifactSha256: string;
    inputRevision: number;
    currentProducerArtifactSha256: string;
    sourceManifestArtifactSha256: string;
  };
  draft: AeoDraftAssistanceCandidate;
  blockingGaps: CanonicalAeoEditingBlockingGap[];
  adoptionDecisions: [];
  authority: {
    automaticallyAdopted: false;
    engineeringApproved: false;
    signed: false;
    sent: false;
    productionPublished: false;
    currentChanged: false;
  };
}

export function bindAeoEditingKnowledgeToHostSources(
  knowledge: AeoEditingKnowledgeCandidate,
  input: CanonicalAeoEditingInputProjection,
): AeoEditingKnowledgeCandidate {
  const sourceArtifacts = new Map(
    input.sourceArtifacts.map((source) => [source.sourceId, source] as const),
  );
  if (sourceArtifacts.size !== input.sourceArtifacts.length) {
    throw new Error('AEO_EDITING_INPUT_SOURCE_ID_DUPLICATE');
  }
  const sources: AeoEditingSourceIdentity[] = knowledge.sources.map(
    (source: AeoEditingSourceIdentity) => {
      const bound = sourceArtifacts.get(source.sourceId);
      if (
        !bound ||
        !source.sha256 ||
        bound.artifactSha256 !== source.sha256 ||
        bound.byteLength !== source.actualBytes ||
        !hostArtifactRef(bound.artifactRef)
      ) {
        throw new Error(
          `AEO_EDITING_INPUT_SOURCE_BINDING_MISMATCH:${source.sourceId}`,
        );
      }
      return { ...source, artifactRef: bound.artifactRef };
    },
  );
  if (sources.length !== input.sourceArtifacts.length) {
    throw new Error('AEO_EDITING_INPUT_SOURCE_BINDING_SET_MISMATCH');
  }
  return { ...knowledge, sources };
}

export function buildAeoEditingBlockingGaps(
  knowledge: AeoEditingKnowledgeCandidate,
): CanonicalAeoEditingBlockingGap[] {
  const missing = knowledge.missingInputs.map((message, index) => ({
    code: 'AEO_MISSING_INPUT' as const,
    message,
    sourceRefs: [missingSourceRef(`knowledge.missingInputs[${index}]`)],
    blocking: true as const,
  }));
  const conflicts = knowledge.conflicts.map((message, index) => ({
    code: 'AEO_SOURCE_CONFLICT' as const,
    message,
    sourceRefs: [missingSourceRef(`knowledge.conflicts[${index}]`)],
    blocking: true as const,
  }));
  const figures = knowledge.producerEvidence.figureUnits.map(
    (value, index) => ({
      code: 'AEO_TYPED_FIGURE_OR_TABLE_NOT_PROJECTED' as const,
      message:
        `Typed figure/table candidate ${evidenceLabel(value, index + 1)} ` +
        'is retained as a blocking gap because this bridge cannot project it into a typed editor block.',
      sourceRefs: evidenceSourceRefs(value, `knowledge.figureUnits[${index}]`),
      blocking: true as const,
    }),
  );
  const controls =
    knowledge.producerEvidence.companyAddedOrSpecializedControls.map(
      (value, index) => ({
        code: 'AEO_SPECIALIZED_CONTROL_REQUIRES_ENGINEER_REVIEW' as const,
        message:
          `Company/specialized control ${evidenceLabel(value, index + 1)} ` +
          'is retained for engineer review and was not converted into a general rule.',
        sourceRefs: evidenceSourceRefs(
          value,
          `knowledge.companyAddedOrSpecializedControls[${index}]`,
        ),
        blocking: true as const,
      }),
    );
  return [...missing, ...conflicts, ...figures, ...controls];
}

export function makeAeoEditingDraftArtifact(input: {
  workItem: CanonicalWorkItemProjection;
  hostInput: CanonicalAeoEditingInputProjection;
  draft: AeoDraftAssistanceCandidate;
  blockingGaps: CanonicalAeoEditingBlockingGap[];
}): CanonicalAeoEditingDraftArtifact {
  const packageProjection = input.workItem.package;
  if (!packageProjection)
    throw new Error('AEO_EDITING_PARSED_PACKAGE_REQUIRED');
  return {
    kind: ARTIFACT_KIND,
    version: ARTIFACT_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    draftRevision: (input.workItem.aeoEditingDraft?.revision ?? 0) + 1,
    workItemBinding: {
      workItemId: input.workItem.workItemId,
      documentVersionId: input.workItem.source.documentVersionId,
      sourcePackageId: packageProjection.packageId,
      sourcePackageArtifactSha256: packageProjection.artifact.sha256,
      inputRevision: input.hostInput.inputRevision,
      currentProducerArtifactSha256:
        input.hostInput.currentProducerArtifact.sha256,
      sourceManifestArtifactSha256:
        input.hostInput.sourceManifestArtifact.sha256,
    },
    draft: input.draft,
    blockingGaps: input.blockingGaps,
    adoptionDecisions: [],
    authority: {
      automaticallyAdopted: false,
      engineeringApproved: false,
      signed: false,
      sent: false,
      productionPublished: false,
      currentChanged: false,
    },
  };
}

export function encodeAeoEditingDraftArtifact(
  artifact: CanonicalAeoEditingDraftArtifact,
): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(artifact)}\n`);
}

export function parseAeoEditingDraftArtifact(
  bytes: Uint8Array,
): CanonicalAeoEditingDraftArtifact {
  try {
    return JSON.parse(
      new TextDecoder().decode(bytes),
    ) as CanonicalAeoEditingDraftArtifact;
  } catch {
    throw new Error('AEO_EDITING_DRAFT_ARTIFACT_JSON_INVALID');
  }
}

export function assertAeoEditingDraftArtifact(input: {
  artifact: CanonicalAeoEditingDraftArtifact;
  projection: CanonicalAeoEditingDraftProjection;
  workItem: CanonicalWorkItemProjection;
}): void {
  const { artifact, projection, workItem } = input;
  const hostInput = workItem.aeoEditingInput;
  const packageProjection = workItem.package;
  if (
    artifact.kind !== ARTIFACT_KIND ||
    artifact.version !== ARTIFACT_VERSION ||
    artifact.lifecycleStatus !== 'CANDIDATE_ONLY' ||
    artifact.draftRevision !== projection.revision ||
    artifact.draft.lifecycleStatus !== 'CANDIDATE_ONLY' ||
    artifact.workItemBinding.workItemId !== workItem.workItemId ||
    artifact.workItemBinding.documentVersionId !==
      workItem.source.documentVersionId ||
    artifact.workItemBinding.sourcePackageId !== packageProjection?.packageId ||
    artifact.workItemBinding.sourcePackageArtifactSha256 !==
      packageProjection?.artifact.sha256 ||
    artifact.workItemBinding.inputRevision !== hostInput?.inputRevision ||
    artifact.workItemBinding.currentProducerArtifactSha256 !==
      hostInput?.currentProducerArtifact.sha256 ||
    artifact.workItemBinding.sourceManifestArtifactSha256 !==
      hostInput?.sourceManifestArtifact.sha256 ||
    artifact.draft.generationRevision !== projection.generationRevision ||
    artifact.draft.suggestions.length !== projection.suggestionCount ||
    artifact.draft.editorBlocks.length !== projection.blockCount ||
    artifact.blockingGaps.length !== projection.blockingGapCount ||
    artifact.draft.feedback.length !== projection.feedbackCount ||
    artifact.draft.feedback.filter(
      (feedback) => feedback.learningDisposition === 'DO_NOT_LEARN',
    ).length !== projection.doNotLearnFeedbackCount ||
    artifact.adoptionDecisions.length !== 0 ||
    artifact.authority.automaticallyAdopted ||
    artifact.authority.engineeringApproved ||
    artifact.authority.signed ||
    artifact.authority.sent ||
    artifact.authority.productionPublished ||
    artifact.authority.currentChanged
  ) {
    throw new Error('AEO_EDITING_DRAFT_ARTIFACT_IDENTITY_DRIFT');
  }
  if (
    artifact.blockingGaps.some(
      (gap) => !gap.blocking || gap.sourceRefs.length === 0,
    )
  ) {
    throw new Error('AEO_EDITING_DRAFT_BLOCKING_GAP_INVALID');
  }
  if (
    !hostInput ||
    !sameSourceBindings(artifact.draft.sources, hostInput.sourceArtifacts) ||
    !sameRefs(artifact.draft.currentSourceRefs, hostInput.currentSourceRefs) ||
    !sameStrings(
      artifact.draft.suggestions.map((suggestion) => suggestion.sourceUnitId),
      hostInput.selectedUnitIds,
    )
  ) {
    throw new Error('AEO_EDITING_DRAFT_SOURCE_BINDING_DRIFT');
  }
}

export function toAeoEditingDraftReadModel(input: {
  workItem: CanonicalWorkItemProjection;
  artifact: CanonicalAeoEditingDraftArtifact;
}): CanonicalAeoEditingDraftReadModel {
  const projection = input.workItem.aeoEditingDraft;
  const packageProjection = input.workItem.package;
  if (!projection || !packageProjection) {
    throw new Error('AEO_EDITING_DRAFT_NOT_FOUND');
  }
  const learning = buildAeoDraftLearningInput(input.artifact.draft);
  return {
    schemaVersion: 'wiselink.3_1.aeo_editing_draft_read_model.v0.candidate.1',
    status: 'CANDIDATE_ONLY',
    workItemId: input.workItem.workItemId,
    workItemRevision: input.workItem.revision,
    documentVersionId: input.workItem.source.documentVersionId,
    sourcePackageId: packageProjection.packageId,
    projection,
    title: input.artifact.draft.title,
    generationRevision: input.artifact.draft.generationRevision,
    sources: input.artifact.draft.sources.map((source) => ({
      sourceId: source.sourceId,
      role: source.role,
      artifactRef: source.artifactRef,
      artifactSha256: requiredSha(source),
      byteLength: source.actualBytes,
      observedIdentity: source.observedIdentity,
    })),
    currentSourceRefs: structuredClone(input.artifact.draft.currentSourceRefs),
    suggestions: input.artifact.draft.suggestions.map((suggestion) => ({
      suggestionId: suggestion.suggestionId,
      sourceUnitId: suggestion.sourceUnitId,
      section: suggestion.section,
      kind: suggestion.kind,
      bodyZh: suggestion.bodyZh,
      bodyEn: suggestion.bodyEn,
      parameters: structuredClone(suggestion.parameters),
      conditions: structuredClone(suggestion.conditions),
      conditionSourceRefs:
        suggestion.conditions.length > 0
          ? structuredClone(suggestion.sourceRefs)
          : [],
      dependencies: structuredClone(suggestion.dependencies),
      branches: structuredClone(suggestion.branches),
      performerRoles: [...suggestion.performerRoles],
      inspectorRoles: [...suggestion.inspectorRoles],
      signatureGranularity: suggestion.signatureGranularity,
      verifications: structuredClone(suggestion.verifications),
      closeout: structuredClone(suggestion.closeout),
      safetyNotes: structuredClone(suggestion.safetyNotes),
      inspectionDetail: structuredClone(suggestion.inspectionDetail),
      sourceRefs: structuredClone(suggestion.sourceRefs),
      reviewStatus: suggestion.reviewStatus,
      engineerDecisionRef: suggestion.engineerDecisionRef,
    })),
    blocks: structuredClone(input.artifact.draft.editorBlocks),
    blockingGaps: structuredClone(input.artifact.blockingGaps),
    feedback: input.artifact.draft.feedback.map((feedback) => ({
      feedbackId: feedback.feedbackId,
      suggestionId: feedback.suggestionId,
      targetGenerationRevision: feedback.targetGenerationRevision,
      decision: feedback.decision,
      engineerDecisionRef: feedback.engineerDecisionRef,
      note: feedback.note,
      reasonCode: feedback.reasonCode,
      learningDisposition: feedback.learningDisposition,
      sourceRefs: structuredClone(feedback.after.sourceRefs),
    })),
    learning: {
      eligibleFeedbackCount:
        learning.accepted.length +
        learning.modified.length +
        learning.rejected.length,
      excludedDoNotLearnFeedbackIds: learning.excludedFromLearning
        .filter((feedback) => feedback.learningDisposition === 'DO_NOT_LEARN')
        .map((feedback) => feedback.feedbackId),
      boundary: learning.boundary,
    },
    adoptionDecisions: [],
    nonClaims: structuredClone(input.artifact.draft.nonClaims),
    authority: {
      candidateOnly: true,
      automaticallyAdopted: false,
      engineeringApproved: false,
      signed: false,
      sent: false,
      productionPublished: false,
      currentChanged: false,
    },
  };
}

function evidenceSourceRefs(
  value: unknown,
  missingLocator: string,
): CanonicalAeoEditingSourceRef[] {
  const refs = collectSourceRefs(value);
  return refs.length > 0 ? refs : [missingSourceRef(missingLocator)];
}

function collectSourceRefs(value: unknown): CanonicalAeoEditingSourceRef[] {
  const found: CanonicalAeoEditingSourceRef[] = [];
  visit(value, found);
  const unique = new Map(
    found.map((ref) => [`${ref.sourceId}#${ref.locator}`, ref] as const),
  );
  return Array.from(unique.values());
}

function visit(value: unknown, found: CanonicalAeoEditingSourceRef[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (key === 'sourceRefs' && Array.isArray(child)) {
      child.forEach((ref) => {
        const parsed = compactSourceRef(ref);
        if (parsed) found.push(parsed);
      });
      return;
    }
    visit(child, found);
  });
}

function compactSourceRef(value: unknown): AeoEditingSourceRef | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf('#');
  return separator > 0 && separator < value.length - 1
    ? {
        sourceId: value.slice(0, separator),
        locator: value.slice(separator + 1),
      }
    : null;
}

function evidenceLabel(value: unknown, fallback: number): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `#${fallback}`;
  }
  const record = value as Record<string, unknown>;
  const identity = record.figure ?? record.control ?? record.class;
  return typeof identity === 'string' || typeof identity === 'number'
    ? JSON.stringify(identity)
    : `#${fallback}`;
}

function missingSourceRef(locator: string): CanonicalAeoEditingSourceRef {
  return { sourceId: 'MISSING_SOURCE', locator };
}

function requiredSha(source: AeoEditingSourceIdentity): string {
  if (!source.sha256) throw new Error('AEO_EDITING_SOURCE_SHA256_REQUIRED');
  return source.sha256;
}

function sameSourceBindings(
  sources: AeoEditingSourceIdentity[],
  bindings: CanonicalAeoEditingInputProjection['sourceArtifacts'],
): boolean {
  if (sources.length !== bindings.length) return false;
  const bySourceId = new Map(
    bindings.map((binding) => [binding.sourceId, binding] as const),
  );
  return sources.every((source) => {
    const binding = bySourceId.get(source.sourceId);
    return Boolean(
      binding &&
      source.artifactRef === binding.artifactRef &&
      source.sha256 === binding.artifactSha256 &&
      source.actualBytes === binding.byteLength,
    );
  });
}

function sameRefs(
  left: AeoEditingSourceRef[],
  right: CanonicalAeoEditingSourceRef[],
): boolean {
  return sameStrings(
    left.map((ref) => `${ref.sourceId}#${ref.locator}`),
    right.map((ref) => `${ref.sourceId}#${ref.locator}`),
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hostArtifactRef(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);
}
