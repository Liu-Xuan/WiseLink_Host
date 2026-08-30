import { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalAeoEditingDraftCreateRequest,
  CanonicalAeoEditingInputProjection,
  CanonicalAeoEditingSourceRef,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  ingestAeoEditingKnowledgeCandidate,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingSourceIdentity,
} from '../aeo-authoring/aeo-editing-knowledge';
import { MiaodaFileServiceArtifactStore } from '../document-management/src/hosted/miaodaFileServiceArtifactStore.js';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { bindAeoEditingKnowledgeToHostSources } from './canonical-aeo-editing-draft.artifact';
import {
  isRoutineProducer,
  validateRoutineInput,
} from './canonical-aeo-editing-routine-input';
import {
  assertActualBytes,
  parseJson,
} from './canonical-host-aeo-editing.utils';
import type { CanonicalHostActor } from './canonical-host.types';

export interface CanonicalAeoEditingPreparedInput {
  hostInput: CanonicalAeoEditingInputProjection;
  knowledge: AeoEditingKnowledgeCandidate | null;
  routine: {
    sources: AeoEditingSourceIdentity[];
    sourceRefs: CanonicalAeoEditingSourceRef[];
    sampleRef: string;
  } | null;
}

@Injectable()
export class CanonicalAeoEditingInputProducer {
  constructor(
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifacts: UnifiedArtifactStorePort,
    private readonly fileService: FileService,
    private readonly resolver: MiaodaDocumentVersionSourceResolver,
    private readonly repository: MiaodaWorkItemRepository,
  ) {}

  async readBoundKnowledge(
    input: CanonicalAeoEditingInputProjection,
  ): Promise<AeoEditingKnowledgeCandidate | null> {
    if (input.inputKind === 'ROUTINE_SERIES_PATTERN') return null;
    const [producerBytes, manifestBytes] = await Promise.all([
      this.artifacts.readActualBytes(input.currentProducerArtifact),
      this.artifacts.readActualBytes(input.sourceManifestArtifact),
    ]);
    assertActualBytes(
      producerBytes,
      input.currentProducerArtifact,
      'AEO_EDITING_PREVIOUS_PRODUCER_ACTUAL_BYTES_MISMATCH',
    );
    assertActualBytes(
      manifestBytes,
      input.sourceManifestArtifact,
      'AEO_EDITING_PREVIOUS_MANIFEST_ACTUAL_BYTES_MISMATCH',
    );
    return bindAeoEditingKnowledgeToHostSources(
      ingestAeoEditingKnowledgeCandidate(
        parseJson(producerBytes, 'AEO_EDITING_PREVIOUS_PRODUCER_JSON_INVALID'),
        parseJson(manifestBytes, 'AEO_EDITING_PREVIOUS_MANIFEST_JSON_INVALID'),
      ),
      input,
    );
  }

  async produce(input: {
    workItem: CanonicalWorkItemProjection;
    request: CanonicalAeoEditingDraftCreateRequest;
    actor: CanonicalHostActor;
  }): Promise<CanonicalAeoEditingPreparedInput> {
    const packageProjection = input.workItem.package;
    if (
      input.workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      input.workItem.classification.status !== 'CONFIRMED' ||
      !packageProjection
    ) {
      throw new Error('AEO_EDITING_HOST_INPUT_SOURCE_NOT_READY');
    }
    const [producerBytes, manifestBytes] = await Promise.all([
      this.artifacts.readActualBytes(input.request.currentProducerArtifact),
      this.artifacts.readActualBytes(input.request.sourceManifestArtifact),
    ]);
    assertActualBytes(
      producerBytes,
      input.request.currentProducerArtifact,
      'AEO_EDITING_CURRENT_PRODUCER_ACTUAL_BYTES_MISMATCH',
    );
    assertActualBytes(
      manifestBytes,
      input.request.sourceManifestArtifact,
      'AEO_EDITING_SOURCE_MANIFEST_ACTUAL_BYTES_MISMATCH',
    );
    const producer = parseJson(
      producerBytes,
      'AEO_EDITING_CURRENT_PRODUCER_JSON_INVALID',
    );
    const manifest = parseJson(
      manifestBytes,
      'AEO_EDITING_SOURCE_MANIFEST_JSON_INVALID',
    );
    const routine = isRoutineProducer(producer)
      ? validateRoutineInput(producer, manifest)
      : null;
    const unboundKnowledge = routine
      ? null
      : ingestAeoEditingKnowledgeCandidate(producer, manifest);
    const sourceIdentities = routine?.sources ?? unboundKnowledge!.sources;
    const sourceArtifacts = await this.bindActualSourceDocuments({
      workItem: input.workItem,
      actor: input.actor,
      sourceIdentities,
      primarySourceId:
        routine?.sourceRefs[0]?.sourceId ??
        unboundKnowledge!.documentIdentity.primarySourceId,
      selections: input.request.sourceDocuments,
    });
    const inputKind = routine
      ? ('ROUTINE_SERIES_PATTERN' as const)
      : ('ACTION_UNITS' as const);
    const selectedUnitIds = routine
      ? routineSelectedUnits(input.request.selectedUnitIds)
      : selectedUnits(unboundKnowledge!, input.request.selectedUnitIds);
    const currentSourceRefs = routine
      ? routine.sourceRefs
      : selectedSourceRefs(unboundKnowledge!, selectedUnitIds);
    const next: CanonicalAeoEditingInputProjection = {
      schemaVersion: 'wiselink.3_1.aeo_editing_input.v0.candidate.1',
      status: 'HOST_INPUT_READY',
      inputKind,
      inputRevision: nextInputRevision(input.workItem.aeoEditingInput, {
        currentProducerArtifact: input.request.currentProducerArtifact,
        sourceManifestArtifact: input.request.sourceManifestArtifact,
        sourceArtifacts,
        selectedUnitIds,
      }),
      workItemId: input.workItem.workItemId,
      documentVersionId: input.workItem.source.documentVersionId,
      sourcePackageId: packageProjection.packageId,
      sourcePackageArtifactSha256: packageProjection.artifact.sha256,
      currentProducerArtifact: input.request.currentProducerArtifact,
      sourceManifestArtifact: input.request.sourceManifestArtifact,
      sourceArtifacts,
      selectedUnitIds,
      currentSourceRefs,
      draftTitle: routine
        ? `${routine.sampleRef} routine revision review candidate`
        : `${unboundKnowledge!.documentIdentity.aeoNumber} — ${unboundKnowledge!.documentIdentity.title}`,
      authority: 'HOST_OWNED_INPUT_ACTUAL_BYTES_REVALIDATED_ON_USE',
    };
    const knowledge = unboundKnowledge
      ? bindAeoEditingKnowledgeToHostSources(unboundKnowledge, next)
      : null;
    return {
      hostInput: next,
      knowledge,
      routine: routine
        ? {
            ...routine,
            sources: bindRoutineSources(routine.sources, next),
          }
        : null,
    };
  }

  private async bindActualSourceDocuments(input: {
    workItem: CanonicalWorkItemProjection;
    actor: CanonicalHostActor;
    sourceIdentities: AeoEditingSourceIdentity[];
    primarySourceId: string;
    selections: CanonicalAeoEditingDraftCreateRequest['sourceDocuments'];
  }): Promise<CanonicalAeoEditingInputProjection['sourceArtifacts']> {
    const selections = new Map(
      input.selections.map((selection) => [selection.sourceId, selection]),
    );
    const documentVersions = new Set(
      input.selections.map((selection) => selection.documentVersionId),
    );
    if (
      selections.size !== input.selections.length ||
      documentVersions.size !== input.selections.length ||
      selections.size !== input.sourceIdentities.length ||
      input.sourceIdentities.some((source) => !selections.has(source.sourceId))
    ) {
      throw new Error('AEO_EDITING_SOURCE_DOCUMENT_SET_MISMATCH');
    }
    const store = new MiaodaFileServiceArtifactStore(this.fileService);
    return Promise.all(
      input.sourceIdentities.map(async (source) => {
        const selection = selections.get(source.sourceId)!;
        const primary = source.sourceId === input.primarySourceId;
        if (
          primary &&
          selection.documentVersionId !==
            input.workItem.source.documentVersionId
        ) {
          throw new Error('AEO_EDITING_PRIMARY_SOURCE_NOT_CURRENT_WORKITEM_DV');
        }
        const access =
          await this.repository.loadTenantDocumentAuthorizationBinding({
            tenantId: input.actor.tenantId,
            documentVersionId: selection.documentVersionId,
            actorUserId: input.actor.userId,
          });
        if (
          !access ||
          access.documentVersionId !== selection.documentVersionId ||
          access.tenantId !== input.actor.tenantId ||
          access.requestedByUserId !== input.actor.userId
        ) {
          throw new Error('AEO_EDITING_SOURCE_DOCUMENT_NOT_FOUND');
        }
        const resolved = await this.resolver.resolve(
          selection.documentVersionId,
          { requireCurrent: primary },
        );
        if (
          resolved.version.documentVersionId !== selection.documentVersionId ||
          resolved.version.sourceArtifactId !==
            resolved.artifact.sourceArtifactId ||
          resolved.version.pdfSha256 !== resolved.artifact.sha256 ||
          Number(resolved.version.byteLength) !==
            Number(resolved.artifact.byteLength) ||
          (primary &&
            (resolved.version.documentId !== input.workItem.source.documentId ||
              resolved.version.sourceArtifactId !==
                input.workItem.source.sourceArtifactId ||
              normalizedSha(input.workItem.source.sourceFileSha256) !==
                resolved.artifact.sha256 ||
              input.workItem.source.sourceByteLength !==
                Number(resolved.artifact.byteLength)))
        ) {
          throw new Error('AEO_EDITING_SOURCE_DOCUMENT_IDENTITY_MISMATCH');
        }
        const actual = await store.readSelection({
          bucketId: resolved.artifact.bucketId,
          filePath: resolved.artifact.filePath,
        });
        if (
          actual.readbackVerified !== true ||
          actual.providerObjectId !== resolved.artifact.providerObjectId ||
          actual.mediaType !== resolved.artifact.mediaType ||
          actual.sha256 !== resolved.artifact.sha256 ||
          actual.byteLength !== Number(resolved.artifact.byteLength) ||
          source.sha256 !== actual.sha256 ||
          source.actualBytes !== actual.byteLength
        ) {
          throw new Error(
            `AEO_EDITING_SOURCE_ACTUAL_BYTES_MISMATCH:${source.sourceId}`,
          );
        }
        return {
          sourceId: source.sourceId,
          documentVersionId: selection.documentVersionId,
          sourceArtifactId: resolved.artifact.sourceArtifactId,
          artifactSha256: actual.sha256,
          byteLength: actual.byteLength,
          mediaType: resolved.artifact.mediaType,
        };
      }),
    );
  }
}

function selectedUnits(
  knowledge: AeoEditingKnowledgeCandidate,
  requested: string[],
): string[] {
  const known = new Set(knowledge.actionUnits.map((unit) => unit.unitId));
  if (
    requested.length === 0 ||
    new Set(requested).size !== requested.length ||
    requested.some((unitId) => !known.has(unitId))
  ) {
    throw new Error('AEO_EDITING_SELECTED_UNIT_INVALID');
  }
  return [...requested];
}

function routineSelectedUnits(requested: string[]): [] {
  if (requested.length !== 0) {
    throw new Error('AEO_ROUTINE_SERIES_PATTERN_MUST_NOT_SELECT_UNITS');
  }
  return [];
}

function selectedSourceRefs(
  knowledge: AeoEditingKnowledgeCandidate,
  selectedUnitIds: string[],
): CanonicalAeoEditingSourceRef[] {
  const selected = new Set(selectedUnitIds);
  return uniqueRefs([
    {
      sourceId: knowledge.documentIdentity.primarySourceId,
      locator: knowledge.documentIdentity.identityLocator,
    },
    ...knowledge.actionUnits
      .filter((unit) => selected.has(unit.unitId))
      .flatMap((unit) => unit.sourceRefs),
  ]);
}

function nextInputRevision(
  current: CanonicalAeoEditingInputProjection | null | undefined,
  next: Pick<
    CanonicalAeoEditingInputProjection,
    | 'currentProducerArtifact'
    | 'sourceManifestArtifact'
    | 'sourceArtifacts'
    | 'selectedUnitIds'
  >,
): number {
  if (
    current &&
    current.currentProducerArtifact.ref === next.currentProducerArtifact.ref &&
    current.currentProducerArtifact.sha256 ===
      next.currentProducerArtifact.sha256 &&
    current.sourceManifestArtifact.ref === next.sourceManifestArtifact.ref &&
    current.sourceManifestArtifact.sha256 ===
      next.sourceManifestArtifact.sha256 &&
    JSON.stringify(current.sourceArtifacts) ===
      JSON.stringify(next.sourceArtifacts) &&
    JSON.stringify(current.selectedUnitIds) ===
      JSON.stringify(next.selectedUnitIds)
  ) {
    return current.inputRevision;
  }
  return (current?.inputRevision ?? 0) + 1;
}

function bindRoutineSources(
  sources: AeoEditingSourceIdentity[],
  input: CanonicalAeoEditingInputProjection,
): AeoEditingSourceIdentity[] {
  const bindings = new Map(
    input.sourceArtifacts.map((source) => [source.sourceId, source]),
  );
  return sources.map((source) => {
    const binding = bindings.get(source.sourceId);
    if (
      !binding ||
      binding.artifactSha256 !== source.sha256 ||
      binding.byteLength !== source.actualBytes
    ) {
      throw new Error(
        `AEO_EDITING_INPUT_SOURCE_BINDING_MISMATCH:${source.sourceId}`,
      );
    }
    return { ...source, artifactRef: binding.sourceArtifactId };
  });
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

function normalizedSha(value: string): string {
  return value.replace(/^sha256:/u, '');
}
