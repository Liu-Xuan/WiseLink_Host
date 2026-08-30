import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  CanonicalAeoEditingInputProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { ingestAeoEditingKnowledgeCandidate } from '../../server/modules/aeo-authoring/aeo-editing-knowledge';
import { CanonicalHostAeoEditingService } from '../../server/modules/canonical-host/canonical-host-aeo-editing.service';

const REAL_AEO_ROOT = '/Volumes/SSD/LLM/WiseLink/output/personal-assistant/aeo';

export const AEO_EDITING_TEST_ACTOR = {
  userId: 'engineer-1',
  tenantId: 'tenant-1',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'test',
};

export function aeoEditingHarness(directory: string, deny = false) {
  const producerName = directory.startsWith('AEO-B737')
    ? 'inspection-units.json'
    : 'knowledge-units.json';
  const producerBytes = bytes(`${REAL_AEO_ROOT}/${directory}/${producerName}`);
  const manifestBytes = bytes(
    `${REAL_AEO_ROOT}/${directory}/source-manifest.json`,
  );
  const producer = JSON.parse(
    new TextDecoder().decode(producerBytes),
  ) as Record<string, unknown>;
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    sources: Array<{
      sourceId: string;
      role: string;
      path: string;
      bytes: number;
      sha256: string;
      observedIdentity?: string;
      identityLocator?: string;
    }>;
  };
  const knowledge = ingestAeoEditingKnowledgeCandidate(producer, manifest);
  const producerArtifact = descriptor(
    `artifact://canonical-host/aeo-input/${directory}/producer`,
    producerBytes,
  );
  const manifestArtifact = descriptor(
    `artifact://canonical-host/aeo-input/${directory}/manifest`,
    manifestBytes,
  );
  const byteStore = new Map<string, Uint8Array>([
    [producerArtifact.ref, producerBytes],
    [manifestArtifact.ref, manifestBytes],
  ]);
  const state: { workItem: CanonicalWorkItemProjection; attempts: number } = {
    workItem: workItem({
      directory,
      producerArtifact,
      manifestArtifact,
      manifest,
      selectedUnitIds: knowledge.actionUnits.map((unit) => unit.unitId),
      currentSourceRefs: [
        {
          sourceId: knowledge.documentIdentity.primarySourceId,
          locator: knowledge.documentIdentity.identityLocator,
        },
      ],
    }),
    attempts: 0,
  };
  const artifacts = {
    readActualBytes: jest.fn(
      async (artifact: UnifiedPackageArtifactDescriptor) => {
        const value = byteStore.get(artifact.ref);
        if (!value) throw new Error('ARTIFACT_NOT_FOUND');
        return Uint8Array.from(value);
      },
    ),
    persistAndReadback: jest.fn(async (value: Uint8Array) => {
      const copy = Uint8Array.from(value);
      const artifact = descriptor(
        `artifact://canonical-host/aeo-drafts/${sha(copy)}`,
        copy,
      );
      byteStore.set(artifact.ref, copy);
      return { artifact, bytes: copy, reused: false };
    }),
  };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => state.workItem),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.expectedRevision !== state.workItem.revision) {
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        state.workItem = {
          ...input.next,
          revision: input.expectedRevision + 1,
        };
        return state.workItem;
      },
    ),
  };
  const authorization = {
    authorize: jest.fn(async (input: { action: string }) => {
      if (deny) {
        throw Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
          statusCode: 404,
        });
      }
      return {
        action: input.action,
        allowed: true,
        actorFingerprint: 'actor-fingerprint',
        decisionId: 'decision-1',
        decisionHash: 'decision-hash',
        permissionSnapshotVersion: 'permission-1',
      };
    }),
  };
  const permissions = {
    freshRead: jest.fn(async () => ({
      permissionSnapshotVersion: 'permission-1',
    })),
  };
  const repository = {
    reserveAssessmentAction: jest.fn(async () => ({
      attemptId: `ATT-AEO-EDITING-${++state.attempts}`,
      created: true,
    })),
    completeAssessmentAction: jest.fn(async () => undefined),
    failAssessmentAction: jest.fn(async () => undefined),
  };
  const service = new CanonicalHostAeoEditingService(
    registrar as never,
    authorization as never,
    permissions as never,
    artifacts as never,
    repository as never,
  );
  return {
    service,
    state,
    artifacts,
    repository,
    registrar,
    authorization,
    knowledge,
    byteStore,
  };
}

function workItem(input: {
  directory: string;
  producerArtifact: UnifiedPackageArtifactDescriptor;
  manifestArtifact: UnifiedPackageArtifactDescriptor;
  manifest: {
    sources: Array<{
      sourceId: string;
      path: string;
      bytes: number;
      sha256: string;
    }>;
  };
  selectedUnitIds: string[];
  currentSourceRefs: Array<{ sourceId: string; locator: string }>;
}): CanonicalWorkItemProjection {
  const packageArtifact: UnifiedPackageArtifactDescriptor = {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://canonical-host/packages/${input.directory}`,
    sha256: 'a'.repeat(64),
    byteLength: 100,
    mediaType: 'application/json',
  };
  const hostInput: CanonicalAeoEditingInputProjection = {
    schemaVersion: 'wiselink.3_1.aeo_editing_input.v0.candidate.1',
    status: 'HOST_INPUT_READY',
    inputRevision: 1,
    workItemId: `WI-${input.directory}`,
    documentVersionId: `DV-${input.directory}`,
    sourcePackageId: `PKG-${input.directory}`,
    sourcePackageArtifactSha256: packageArtifact.sha256,
    currentProducerArtifact: input.producerArtifact,
    sourceManifestArtifact: input.manifestArtifact,
    sourceArtifacts: input.manifest.sources.map((source) => ({
      sourceId: source.sourceId,
      artifactRef: `artifact://canonical-host/aeo-sources/${encodeURIComponent(
        source.sourceId,
      )}`,
      artifactSha256: source.sha256,
      byteLength: source.bytes,
      mediaType: source.path.toLowerCase().endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
    })),
    selectedUnitIds: input.selectedUnitIds,
    currentSourceRefs: input.currentSourceRefs,
    draftTitle: `${input.directory} editable candidate`,
    authority: 'HOST_OWNED_INPUT_ACTUAL_BYTES_REVALIDATED_ON_USE',
  };
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: hostInput.workItemId,
    requestId: `REQ-${input.directory}`,
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-1',
    parseAuthorization: {} as never,
    source: {
      documentId: `DOC-${input.directory}`,
      documentVersionId: hostInput.documentVersionId,
      sourceArtifactId: `SOURCE-${input.directory}`,
      artifactSha256: 'b'.repeat(64),
      byteLength: 100,
    } as never,
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
      parserProfileId: 'issuer.boeing.sb',
    } as never,
    package: {
      packageId: hostInput.sourcePackageId,
      artifact: packageArtifact,
    } as never,
    aeoEditingInput: hostInput,
    aeoEditingDraft: null,
    failure: null,
    recordingFailure: null,
  };
}

function bytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

function descriptor(
  ref: string,
  value: Uint8Array,
): UnifiedPackageArtifactDescriptor {
  return {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref,
    sha256: sha(value),
    byteLength: value.byteLength,
    mediaType: 'application/json',
  };
}

function sha(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
