import type {
  AeoDraftAssistanceCandidate,
  AeoDraftRegenerationRequest,
  AeoDraftSuggestion,
  AeoEditingDocumentIdentity,
  AeoEditingSourceIdentity,
} from './aeo-editing-knowledge.types';

export function assertAeoDraftRegenerationContext(
  current: AeoDraftAssistanceCandidate,
  request: AeoDraftRegenerationRequest,
  reason: string,
): void {
  if (current.draftKey !== request.draftKey) {
    throw new Error('AEO_DRAFT_REGENERATION_WORK_ITEM_MISMATCH');
  }
  if (current.generationRevision !== request.expectedGenerationRevision) {
    throw new Error(
      `AEO_DRAFT_REGENERATION_GENERATION_CONFLICT: expected ${String(
        request.expectedGenerationRevision,
      )}, current ${String(current.generationRevision)}`,
    );
  }
  if (!reason.trim()) {
    throw new Error('AEO_DRAFT_REGENERATION_REASON_REQUIRED');
  }
  const currentIdentity: AeoEditingDocumentIdentity =
    current.knowledgeDocumentIdentity;
  const requestedIdentity: AeoEditingDocumentIdentity =
    request.knowledge.documentIdentity;
  if (
    currentIdentity.aeoNumber !== requestedIdentity.aeoNumber ||
    currentIdentity.title !== requestedIdentity.title ||
    currentIdentity.category !== requestedIdentity.category ||
    !sameRevisionOrVerifiedForwardRevision(currentIdentity, requestedIdentity)
  ) {
    throw new Error('AEO_DRAFT_REGENERATION_MATTER_IDENTITY_MISMATCH');
  }
}

function sameRevisionOrVerifiedForwardRevision(
  current: AeoEditingDocumentIdentity,
  requested: AeoEditingDocumentIdentity,
): boolean {
  if (current.revision === requested.revision) {
    return current.expectedHeader === requested.expectedHeader;
  }
  const currentRevision = revisionNumber(current.revision);
  const requestedRevision = revisionNumber(requested.revision);
  return Boolean(
    currentRevision !== null &&
    requestedRevision !== null &&
    requestedRevision > currentRevision &&
    requested.expectedHeader ===
      `${requested.aeoNumber}-${requested.revision}` &&
    requested.observedHeader === requested.expectedHeader,
  );
}

function revisionNumber(value: string): number | null {
  const matched = value.match(/^R(\d+)$/u);
  if (!matched?.[1]) return null;
  const revision = Number(matched[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

export function resolveAeoDraftRegenerationSources(
  currentSources: AeoEditingSourceIdentity[],
  requestedSources: AeoEditingSourceIdentity[],
  unselectedSuggestions: AeoDraftSuggestion[],
): AeoEditingSourceIdentity[] {
  const currentById: Map<string, AeoEditingSourceIdentity> = new Map(
    currentSources.map((source: AeoEditingSourceIdentity) => [
      source.sourceId,
      source,
    ]),
  );
  const requestedById: Map<string, AeoEditingSourceIdentity> = new Map(
    requestedSources.map((source: AeoEditingSourceIdentity) => [
      source.sourceId,
      source,
    ]),
  );
  const requiredSourceIds: Set<string> = new Set(
    unselectedSuggestions.flatMap((suggestion: AeoDraftSuggestion) =>
      suggestion.sourceRefs.map((ref) => ref.sourceId),
    ),
  );
  requestedById.forEach(
    (requestedSource: AeoEditingSourceIdentity, sourceId: string) => {
      const currentSource: AeoEditingSourceIdentity | undefined =
        currentById.get(sourceId);
      if (
        currentSource &&
        !sameSourceIdentity(currentSource, requestedSource)
      ) {
        throw new Error(
          `AEO_DRAFT_REGENERATION_SOURCE_IDENTITY_CONFLICT: ${sourceId}`,
        );
      }
    },
  );
  const retainedSources: AeoEditingSourceIdentity[] = [];
  requiredSourceIds.forEach((sourceId: string) => {
    const currentSource: AeoEditingSourceIdentity | undefined =
      currentById.get(sourceId);
    if (!currentSource) {
      throw new Error(
        `AEO_DRAFT_REGENERATION_UNSELECTED_SOURCE_MISSING: ${sourceId}`,
      );
    }
    const requestedSource: AeoEditingSourceIdentity | undefined =
      requestedById.get(sourceId);
    if (!requestedSource) {
      retainedSources.push(currentSource);
    }
  });
  return [...requestedSources, ...retainedSources];
}

function sameSourceIdentity(
  left: AeoEditingSourceIdentity,
  right: AeoEditingSourceIdentity,
): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.role === right.role &&
    left.artifactRef === right.artifactRef &&
    left.actualBytes === right.actualBytes &&
    left.sha256 === right.sha256 &&
    left.observedIdentity === right.observedIdentity &&
    left.identityLocator === right.identityLocator
  );
}
