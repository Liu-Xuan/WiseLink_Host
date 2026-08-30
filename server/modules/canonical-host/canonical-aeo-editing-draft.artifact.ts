import type {
  CanonicalAeoEditingBrowserSourceRef,
  CanonicalAeoEditingDraftFeedbackRequest,
  CanonicalAeoEditingDraftProjection,
  CanonicalAeoEditingDraftReadModel,
  CanonicalAeoEditingInputProjection,
  CanonicalAeoEditingSourceRef,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  buildAeoDraftLearningInput,
  AEO_DRAFT_ASSISTANCE_VERSION,
  type AeoDraftAssistanceCandidate,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingSourceIdentity,
  type AeoEditingSourceRef,
} from '../aeo-authoring/aeo-editing-knowledge';
import {
  evidenceLabel,
  evidenceSourceRefs,
  missingSourceRef,
} from './canonical-aeo-editing-gap.utils';

const ARTIFACT_KIND = 'CANONICAL_AEO_EDITING_DRAFT_CANDIDATE' as const;
const ARTIFACT_VERSION = 1 as const;

export interface CanonicalAeoEditingInternalBlockingGap {
  code:
    | 'AEO_MISSING_INPUT'
    | 'AEO_SOURCE_CONFLICT'
    | 'AEO_TYPED_FIGURE_OR_TABLE_NOT_PROJECTED'
    | 'AEO_SPECIALIZED_CONTROL_REQUIRES_ENGINEER_REVIEW'
    | 'AEO_ROUTINE_SERIES_PATTERN_NOT_GENERIC';
  message: string;
  sourceRefs: CanonicalAeoEditingSourceRef[];
  blocking: true;
}

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
  blockingGaps: CanonicalAeoEditingInternalBlockingGap[];
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
        !bound.sourceArtifactId.trim()
      ) {
        throw new Error(
          `AEO_EDITING_INPUT_SOURCE_BINDING_MISMATCH:${source.sourceId}`,
        );
      }
      return { ...source, artifactRef: bound.sourceArtifactId };
    },
  );
  if (sources.length !== input.sourceArtifacts.length) {
    throw new Error('AEO_EDITING_INPUT_SOURCE_BINDING_SET_MISMATCH');
  }
  return { ...knowledge, sources };
}

export function buildAeoEditingBlockingGaps(
  knowledge: AeoEditingKnowledgeCandidate,
): CanonicalAeoEditingInternalBlockingGap[] {
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
  blockingGaps: CanonicalAeoEditingInternalBlockingGap[];
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

export function makeRoutineSeriesPatternDraft(input: {
  workItemId: string;
  title: string;
  generationRevision: number;
  sources: AeoEditingSourceIdentity[];
  currentSourceRefs: AeoEditingSourceRef[];
}): AeoDraftAssistanceCandidate {
  return {
    schemaVersion: AEO_DRAFT_ASSISTANCE_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    authority: 'EDITABLE_DRAFT_NOT_APPROVAL_NOT_RELEASE',
    draftKey: input.workItemId,
    title: input.title,
    generationRevision: input.generationRevision,
    knowledgeDocumentIdentity: {
      aeoNumber: input.title.split(' ', 1)[0] ?? input.workItemId,
      revision: 'CANDIDATE',
      title: input.title,
      category: 'ROUTINE_PARAMETER_REVISION_UPDATE',
      actualBytes: input.sources[0]?.actualBytes ?? 1,
      primarySourceId: input.currentSourceRefs[0]?.sourceId ?? 'MISSING_SOURCE',
      expectedHeader: input.title,
      observedHeader: input.title,
      identityLocator: input.currentSourceRefs[0]?.locator ?? 'MISSING_SOURCE',
    },
    knowledgeDocumentState:
      'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED',
    sources: input.sources,
    currentSourceRefs: input.currentSourceRefs,
    suggestions: [],
    editorBlocks: [],
    missingInputs: [
      'Observed B777 routine revision pattern remains series-specific and cannot be generalized into authoring suggestions.',
    ],
    conflicts: [],
    feedback: [],
    supersededFeedback: [],
    regenerationHistory:
      input.generationRevision > 1
        ? [
            {
              generationRevision: input.generationRevision,
              regeneratedUnitIds: [],
              reason: 'Host current routine-series evidence revision advanced.',
            },
          ]
        : [],
    nonClaims: [
      'Routine revision observations remain candidate evidence and are not a generic rule.',
      'No suggestion was generated, adopted, approved, signed, sent, published, or made current.',
    ],
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
  if (!projection || !input.workItem.package) {
    throw new Error('AEO_EDITING_DRAFT_NOT_FOUND');
  }
  const learning = buildAeoDraftLearningInput(input.artifact.draft);
  const browser = new AeoEditingBrowserReferences(input.artifact);
  return {
    schemaVersion: 'wiselink.3_1.aeo_editing_draft_read_model.v0.candidate.3',
    status: 'CANDIDATE_ONLY',
    workItemRevision: input.workItem.revision,
    projection: {
      status: projection.status,
      revision: projection.revision,
      generationRevision: projection.generationRevision,
      basedOnInputRevision: projection.basedOnInputRevision,
      suggestionCount: projection.suggestionCount,
      blockCount: projection.blockCount,
      blockingGapCount: projection.blockingGapCount,
      feedbackCount: projection.feedbackCount,
      supersededFeedbackCount: input.artifact.draft.supersededFeedback.length,
      doNotLearnFeedbackCount: projection.doNotLearnFeedbackCount,
      adoptionDecisions: [],
      automaticallyAdopted: false,
      engineeringApproved: false,
      productionPublished: false,
      currentChanged: false,
    },
    title: input.artifact.draft.title,
    generationRevision: input.artifact.draft.generationRevision,
    sources: input.artifact.draft.sources.map((source) => ({
      sourceRef: browser.sourceRef(source.sourceId),
      sourceLabel: browser.sourceLabel(source.sourceId),
      roleLabel:
        source.sourceId ===
        input.artifact.draft.knowledgeDocumentIdentity.primarySourceId
          ? 'PRIMARY AEO SOURCE'
          : 'SUPPORTING ENGINEERING SOURCE',
    })),
    currentSourceRefs: browser.sourceRefs(
      input.artifact.draft.currentSourceRefs,
    ),
    suggestions: input.artifact.draft.suggestions.map((suggestion, index) => ({
      suggestionRef: browser.suggestionRef(suggestion.suggestionId),
      unitLabel: `Candidate item ${String(index + 1)}`,
      section: suggestion.section,
      kind: suggestion.kind,
      bodyZh: suggestion.bodyZh,
      bodyEn: suggestion.bodyEn,
      parameters: browserSafeDetails(suggestion.parameters, browser),
      conditions: browserSafeDetails(suggestion.conditions, browser),
      conditionSourceRefs:
        suggestion.conditions.length > 0
          ? browser.sourceRefs(suggestion.sourceRefs)
          : [],
      dependencies: browserSafeDetails(suggestion.dependencies, browser),
      branches: suggestion.branches.map((branch) => ({
        when: branch.when,
        then: branch.then,
        sourceRefs: browser.sourceRefs(branch.sourceRefs),
      })),
      performerRoles: [...suggestion.performerRoles],
      inspectorRoles: [...suggestion.inspectorRoles],
      signatureGranularity: suggestion.signatureGranularity,
      verifications: browserSafeDetails(suggestion.verifications, browser),
      closeout: browserSafeDetails(suggestion.closeout, browser),
      safetyNotes: browserSafeDetails(suggestion.safetyNotes, browser),
      inspectionDetail: browserSafeDetails(
        suggestion.inspectionDetail,
        browser,
      ),
      sourceRefs: browser.sourceRefs(suggestion.sourceRefs),
      reviewStatus: suggestion.reviewStatus,
    })),
    blocks: input.artifact.draft.editorBlocks.map((block, index) => {
      if (block.blockType !== 'PARAGRAPH') {
        throw new Error('AEO_EDITING_BROWSER_BLOCK_TYPE_UNSUPPORTED');
      }
      return {
        blockRef: browser.blockRef(block.blockId),
        sequence: index + 1,
        blockType: block.blockType,
        originType: block.originType,
        bodyZh: block.bodyZh,
        bodyEn: block.bodyEn,
        sourceRefs: block.sourceBindings.map((binding) =>
          browser.sourceLocationRef({
            sourceId: sourceIdForArtifact(
              input.artifact.draft.sources,
              binding.sourceArtifactRef,
            ),
            locator: binding.locator,
          }),
        ),
        unresolved: block.unresolved.map((item) => ({
          code: item.code,
          message: item.message,
          severity: item.severity,
          blocksCheckpoint: item.blocksCheckpoint,
        })),
      };
    }),
    blockingGaps: input.artifact.blockingGaps.map((gap) => ({
      code: gap.code,
      message: gap.message,
      sourceRefs: browser.sourceRefs(gap.sourceRefs),
      blocking: true,
    })),
    feedback: input.artifact.draft.feedback.map((feedback) => ({
      feedbackRef: browser.feedbackRef(feedback.feedbackId),
      suggestionRef: browser.suggestionRef(feedback.suggestionId),
      targetGenerationRevision: feedback.targetGenerationRevision,
      decision: feedback.decision,
      note: feedback.note,
      reasonCode: feedback.reasonCode,
      learningDisposition: feedback.learningDisposition,
      sourceRefs: browser.sourceRefs(feedback.after.sourceRefs),
    })),
    supersededFeedback: input.artifact.draft.supersededFeedback.map((item) => ({
      feedbackRef: browser.feedbackRef(item.feedback.feedbackId),
      suggestionRef: browser.suggestionRef(item.feedback.suggestionId),
      unitLabel: browser.unitLabel(item.sourceUnitId),
      decision: item.feedback.decision,
      targetGenerationRevision: item.feedback.targetGenerationRevision,
      activeThroughGenerationRevision: item.activeThroughGenerationRevision,
      supersededAtGenerationRevision: item.supersededAtGenerationRevision,
      reason: item.reason,
      note: item.feedback.note,
      learningDisposition: item.feedback.learningDisposition,
      sourceRefs: browser.sourceRefs(item.feedback.after.sourceRefs),
    })),
    learning: {
      eligibleFeedbackCount:
        learning.accepted.length +
        learning.modified.length +
        learning.rejected.length,
      excludedDoNotLearnFeedbackRefs: learning.excludedFromLearning
        .filter((feedback) => feedback.learningDisposition === 'DO_NOT_LEARN')
        .map((feedback) => browser.feedbackRef(feedback.feedbackId)),
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

export function resolveAeoEditingBrowserFeedback(input: {
  artifact: CanonicalAeoEditingDraftArtifact;
  request: CanonicalAeoEditingDraftFeedbackRequest;
}): {
  feedbackId: string;
  suggestionId: string;
  revisionSourceRefs?: CanonicalAeoEditingSourceRef[];
} {
  const browser = new AeoEditingBrowserReferences(input.artifact);
  const suggestionId = browser.resolveSuggestionRef(
    input.request.suggestionRef,
  );
  const revisionSourceRefs = input.request.revisionSourceRefs?.map((ref) =>
    browser.resolveSourceLocationRef(ref),
  );
  return {
    feedbackId: input.request.feedbackRef,
    suggestionId,
    ...(revisionSourceRefs ? { revisionSourceRefs } : {}),
  };
}

class AeoEditingBrowserReferences {
  private readonly sourceIds: string[];
  private readonly sourceLocations = new Map<
    string,
    CanonicalAeoEditingSourceRef
  >();
  private readonly suggestions: string[];
  private readonly units: string[];
  private readonly blocks: string[];
  private readonly feedback: string[];

  constructor(private readonly artifact: CanonicalAeoEditingDraftArtifact) {
    this.sourceIds = artifact.draft.sources.map((source) => source.sourceId);
    this.suggestions = artifact.draft.suggestions.map(
      (suggestion) => suggestion.suggestionId,
    );
    this.units = artifact.draft.suggestions.map(
      (suggestion) => suggestion.sourceUnitId,
    );
    this.blocks = artifact.draft.editorBlocks.map((block) => block.blockId);
    this.feedback = Array.from(
      new Set([
        ...artifact.draft.feedback.map((item) => item.feedbackId),
        ...artifact.draft.supersededFeedback.map(
          (item) => item.feedback.feedbackId,
        ),
      ]),
    );
  }

  sourceRef(sourceId: string): string {
    return `source-${String(this.sourceOrdinal(sourceId))}`;
  }

  sourceLabel(sourceId: string): string {
    if (sourceId === 'MISSING_SOURCE') return 'Missing controlled source';
    const ordinal = this.sourceOrdinal(sourceId);
    return sourceId ===
      this.artifact.draft.knowledgeDocumentIdentity.primarySourceId
      ? 'Primary AEO source'
      : `Supporting engineering source ${String(ordinal)}`;
  }

  sourceRefs(
    refs: CanonicalAeoEditingSourceRef[],
  ): CanonicalAeoEditingBrowserSourceRef[] {
    return refs.map((ref) => this.sourceLocationRef(ref));
  }

  sourceLocationRef(
    ref: CanonicalAeoEditingSourceRef,
  ): CanonicalAeoEditingBrowserSourceRef {
    const key = `${ref.sourceId}\u0000${ref.locator}`;
    if (!this.sourceLocations.has(key)) this.sourceLocations.set(key, ref);
    const matching = [...this.sourceLocations.keys()].filter((item) =>
      item.startsWith(`${ref.sourceId}\u0000`),
    );
    const locationOrdinal = matching.indexOf(key) + 1;
    return {
      ref: `${this.sourceRef(ref.sourceId)}-location-${String(locationOrdinal)}`,
      sourceLabel: this.sourceLabel(ref.sourceId),
      locationLabel: controlledLocationLabel(ref.locator, locationOrdinal),
    };
  }

  resolveSourceLocationRef(browserRef: string): CanonicalAeoEditingSourceRef {
    for (const ref of allArtifactSourceRefs(this.artifact)) {
      if (this.sourceLocationRef(ref).ref === browserRef) return ref;
    }
    throw new Error('AEO_EDITING_BROWSER_SOURCE_REF_NOT_FOUND');
  }

  suggestionRef(suggestionId: string): string {
    let ordinal = this.suggestions.indexOf(suggestionId) + 1;
    if (ordinal === 0) {
      this.suggestions.push(suggestionId);
      ordinal = this.suggestions.length;
    }
    return `suggestion-${String(ordinal)}`;
  }

  resolveSuggestionRef(browserRef: string): string {
    const match = /^suggestion-([1-9][0-9]*)$/u.exec(browserRef);
    const value = match ? this.suggestions[Number(match[1]) - 1] : undefined;
    if (!value) throw new Error('AEO_EDITING_BROWSER_SUGGESTION_REF_NOT_FOUND');
    return value;
  }

  unitLabel(unitId: string): string {
    let ordinal = this.units.indexOf(unitId) + 1;
    if (ordinal === 0) {
      this.units.push(unitId);
      ordinal = this.units.length;
    }
    return `Candidate item ${String(ordinal)}`;
  }

  blockRef(blockId: string): string {
    return `block-${String(this.blocks.indexOf(blockId) + 1)}`;
  }

  feedbackRef(feedbackId: string): string {
    return `feedback-${String(this.feedback.indexOf(feedbackId) + 1)}`;
  }

  private sourceOrdinal(sourceId: string): number {
    let ordinal = this.sourceIds.indexOf(sourceId) + 1;
    if (ordinal === 0) {
      this.sourceIds.push(sourceId);
      ordinal = this.sourceIds.length;
    }
    return ordinal;
  }
}

function controlledLocationLabel(locator: string, ordinal: number): string {
  const page = /(?:^|[^a-z])p(?:age)?[-_ ]?([1-9][0-9]*)/iu.exec(locator);
  return page
    ? `Page ${page[1]}`
    : `Controlled source location ${String(ordinal)}`;
}

function allArtifactSourceRefs(
  artifact: CanonicalAeoEditingDraftArtifact,
): CanonicalAeoEditingSourceRef[] {
  return uniqueInternalRefs([
    ...artifact.draft.currentSourceRefs,
    ...artifact.draft.suggestions.flatMap((item) => [
      ...item.sourceRefs,
      ...item.branches.flatMap((branch) => branch.sourceRefs),
    ]),
    ...artifact.blockingGaps.flatMap((gap) => gap.sourceRefs),
    ...artifact.draft.feedback.flatMap((item) => item.after.sourceRefs),
    ...artifact.draft.supersededFeedback.flatMap(
      (item) => item.feedback.after.sourceRefs,
    ),
  ]);
}

function uniqueInternalRefs(
  refs: CanonicalAeoEditingSourceRef[],
): CanonicalAeoEditingSourceRef[] {
  return Array.from(
    new Map(
      refs.map((ref) => [`${ref.sourceId}\u0000${ref.locator}`, ref] as const),
    ).values(),
  );
}

function browserSafeDetails<T>(
  value: T,
  browser: AeoEditingBrowserReferences,
): T {
  if (Array.isArray(value)) {
    return value.map((item) => browserSafeDetails(item, browser)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'sourceRefs' && Array.isArray(child)) {
      output.evidenceSourceRefs = child
        .map(compactBrowserSourceRef)
        .filter((ref): ref is CanonicalAeoEditingSourceRef => ref !== null)
        .map((ref) => browser.sourceLocationRef(ref));
      continue;
    }
    if (isInternalBrowserKey(key)) continue;
    output[key] = browserSafeDetails(child, browser);
  }
  return output as T;
}

function compactBrowserSourceRef(
  value: unknown,
): CanonicalAeoEditingSourceRef | null {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf('#');
  if (separator <= 0 || separator >= value.length - 1) return null;
  return {
    sourceId: value.slice(0, separator),
    locator: value.slice(separator + 1),
  };
}

function isInternalBrowserKey(key: string): boolean {
  return (
    /(?:^|_)(?:artifact|sha256|locator|filePath|bucketId|providerObjectId)$/iu.test(
      key,
    ) ||
    /(?:source|suggestion|unit|block|feedback|documentVersion|workItem)Id$/u.test(
      key,
    ) ||
    /Ref$/u.test(key)
  );
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
      source.artifactRef === binding.sourceArtifactId &&
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

function sourceIdForArtifact(
  sources: AeoEditingSourceIdentity[],
  artifactRef: string,
): string {
  const source = sources.find((item) => item.artifactRef === artifactRef);
  if (!source) throw new Error('AEO_EDITING_BROWSER_SOURCE_BINDING_INVALID');
  return source.sourceId;
}
