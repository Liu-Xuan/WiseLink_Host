import type {
  AeoDraftSuggestion,
  AeoEditingSourceIdentity,
} from './aeo-editing-knowledge.types';

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
    if (
      requestedSource &&
      !sameSourceIdentity(currentSource, requestedSource)
    ) {
      throw new Error(
        `AEO_DRAFT_REGENERATION_SOURCE_IDENTITY_CONFLICT: ${sourceId}`,
      );
    }
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
