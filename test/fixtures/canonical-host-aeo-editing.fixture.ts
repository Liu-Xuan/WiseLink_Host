import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  CanonicalAeoEditingDraftCreateRequest,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import { ingestAeoEditingKnowledgeCandidate } from '../../server/modules/aeo-authoring/aeo-editing-knowledge';
import { CanonicalAeoEditingInputProducer } from '../../server/modules/canonical-host/canonical-aeo-editing-input.producer';
import { CanonicalHostAeoEditingService } from '../../server/modules/canonical-host/canonical-host-aeo-editing.service';

const REAL_AEO_ROOT = '/Volumes/SSD/LLM/WiseLink/output/personal-assistant/aeo';
const BUCKET_ID = 'test-aeo-source-bucket';

export const AEO_EDITING_TEST_ACTOR = {
  userId: 'engineer-1',
  tenantId: 'tenant-1',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'test',
};

export function aeoEditingHarness(directory: string, deny = false) {
  const producerName = producerFile(directory);
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
  const routine = directory.startsWith('AEO-B777');
  const knowledge = routine
    ? null
    : ingestAeoEditingKnowledgeCandidate(producer, manifest);
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
  const sourceRows = new Map(
    manifest.sources.map((source, index) => {
      const value = bytes(source.path);
      if (value.byteLength !== source.bytes || sha(value) !== source.sha256) {
        throw new Error(`REAL_AEO_SOURCE_BYTES_MISMATCH:${source.sourceId}`);
      }
      const documentVersionId = `DV-${directory}-${index + 1}`;
      const sourceArtifactId = `SOURCE-${directory}-${index + 1}`;
      const filePath = `aeo-real-samples/${encodeURIComponent(source.sourceId)}`;
      return [
        documentVersionId,
        {
          documentVersionId,
          documentId: `DOC-${directory}-${index + 1}`,
          sourceArtifactId,
          bucketId: BUCKET_ID,
          filePath,
          providerObjectId: `OBJECT-${directory}-${index + 1}`,
          mediaType: mediaType(source.path),
          bytes: value,
          sha256: source.sha256,
          byteLength: source.bytes,
          sourceId: source.sourceId,
        },
      ] as const;
    }),
  );
  const primarySourceId = routine
    ? routinePrimarySourceId(producer)
    : knowledge!.documentIdentity.primarySourceId;
  const primary = [...sourceRows.values()].find(
    (row) => row.sourceId === primarySourceId,
  );
  if (!primary) throw new Error('REAL_AEO_PRIMARY_SOURCE_MISSING');
  const state: { workItem: CanonicalWorkItemProjection; attempts: number } = {
    workItem: workItem(directory, primary),
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
    loadTenantDocumentAuthorizationBinding: jest.fn(async (input) =>
      sourceRows.has(input.documentVersionId)
        ? {
            documentVersionId: input.documentVersionId,
            tenantId: input.tenantId,
            requestedByUserId: input.actorUserId,
          }
        : null,
    ),
    reserveAssessmentAction: jest.fn(async () => ({
      attemptId: `ATT-AEO-EDITING-${++state.attempts}`,
      created: true,
    })),
    completeAssessmentAction: jest.fn(async () => undefined),
    failAssessmentAction: jest.fn(async () => undefined),
  };
  const resolver = {
    resolve: jest.fn(async (documentVersionId: string) => {
      const row = sourceRows.get(documentVersionId);
      if (!row) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      return {
        version: {
          documentId: row.documentId,
          documentVersionId: row.documentVersionId,
          sourceArtifactId: row.sourceArtifactId,
          pdfSha256: row.sha256,
          byteLength: row.byteLength,
        },
        family: { currentDocumentVersionId: row.documentVersionId },
        artifact: {
          sourceArtifactId: row.sourceArtifactId,
          sha256: row.sha256,
          byteLength: row.byteLength,
          mediaType: row.mediaType,
          bucketId: row.bucketId,
          filePath: row.filePath,
          providerObjectId: row.providerObjectId,
        },
      };
    }),
  };
  const fileService = {
    from: jest.fn((bucketId: string) => ({
      getFileMetadata: jest.fn(async (filePath: string) => {
        const row = [...sourceRows.values()].find(
          (candidate) =>
            candidate.bucketId === bucketId && candidate.filePath === filePath,
        );
        return row ? fileMetadata(row) : null;
      }),
      download: jest.fn(async (filePath: string) => {
        const row = [...sourceRows.values()].find(
          (candidate) =>
            candidate.bucketId === bucketId && candidate.filePath === filePath,
        );
        if (!row) throw new Error('FILESERVICE_OBJECT_NOT_FOUND');
        return { metadata: fileMetadata(row), content: Buffer.from(row.bytes) };
      }),
    })),
  };
  const inputProducer = new CanonicalAeoEditingInputProducer(
    artifacts as never,
    fileService as never,
    resolver as never,
    repository as never,
  );
  const service = new CanonicalHostAeoEditingService(
    registrar as never,
    authorization as never,
    permissions as never,
    artifacts as never,
    repository as never,
    inputProducer,
  );
  const baseRequest = (): CanonicalAeoEditingDraftCreateRequest => ({
    expectedRevision: state.workItem.revision,
    currentProducerArtifact: producerArtifact,
    sourceManifestArtifact: manifestArtifact,
    sourceDocuments: [...sourceRows.values()].map((row) => ({
      sourceId: row.sourceId,
      documentVersionId: row.documentVersionId,
    })),
    selectedUnitIds: knowledge
      ? knowledge.actionUnits.map((unit) => unit.unitId)
      : [],
  });
  return {
    service,
    state,
    artifacts,
    repository,
    registrar,
    authorization,
    resolver,
    knowledge,
    byteStore,
    sourceRows,
    createRequest: baseRequest,
    replaceProducer(mutator: (value: Record<string, unknown>) => void) {
      const changed = structuredClone(producer);
      mutator(changed);
      const changedBytes = new TextEncoder().encode(
        `${JSON.stringify(changed)}\n`,
      );
      const changedArtifact = descriptor(
        `${producerArtifact.ref}-revision-${sha(changedBytes)}`,
        changedBytes,
      );
      byteStore.set(changedArtifact.ref, changedBytes);
      return {
        ...baseRequest(),
        currentProducerArtifact: changedArtifact,
      };
    },
  };
}

function workItem(
  directory: string,
  primary: {
    documentId: string;
    documentVersionId: string;
    sourceArtifactId: string;
    sha256: string;
    byteLength: number;
  },
): CanonicalWorkItemProjection {
  const packageArtifact: UnifiedPackageArtifactDescriptor = {
    storeRole: 'UnifiedArtifactStoreCandidate',
    ref: `artifact://canonical-host/packages/${directory}`,
    sha256: 'a'.repeat(64),
    byteLength: 100,
    mediaType: 'application/json',
  };
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: `WI-${directory}`,
    requestId: `REQ-${directory}`,
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-1',
    parseAuthorization: {} as never,
    source: {
      documentId: primary.documentId,
      documentVersionId: primary.documentVersionId,
      parserRequestId: `REQ-${directory}`,
      sourceArtifactId: primary.sourceArtifactId,
      sourceFileSha256: `sha256:${primary.sha256}`,
      sourceByteLength: primary.byteLength,
      driveFileToken: `DRIVE-${directory}`,
      driveSourceVersion: `VERSION-${directory}`,
    },
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'AEO',
      classifierReleaseId: 'test',
      classifierReleaseHash: 'test',
      parserProfileId: 'test',
      parserProfileHash: 'test',
      fingerprint: 'test',
    },
    package: {
      packageId: `PKG-${directory}`,
      artifact: packageArtifact,
    } as never,
    aeoEditingInput: null,
    aeoEditingDraft: null,
    failure: null,
    recordingFailure: null,
  };
}

function fileMetadata(row: {
  bucketId: string;
  filePath: string;
  providerObjectId: string;
  mediaType: string;
  byteLength: number;
}) {
  return {
    bucketID: row.bucketId,
    filePath: row.filePath,
    id: row.providerObjectId,
    name: row.filePath.split('/').at(-1),
    updatedAt: '2026-08-30T00:00:00.000Z',
    metadata: {
      mimeType: row.mediaType,
      contentLength: row.byteLength,
    },
  };
}

function producerFile(directory: string): string {
  if (directory.startsWith('AEO-B737')) return 'inspection-units.json';
  if (directory.startsWith('AEO-B777')) return 'revision-update-pattern.json';
  return 'knowledge-units.json';
}

function routinePrimarySourceId(producer: Record<string, unknown>): string {
  const transitions = producer.transitions as Array<Record<string, unknown>>;
  const current = transitions.find(
    (transition) => transition.transitionId === 'R26_TO_R27',
  );
  if (typeof current?.result !== 'string') {
    throw new Error('REAL_AEO_ROUTINE_CURRENT_SOURCE_MISSING');
  }
  return current.result;
}

function mediaType(path: string): string {
  return path.toLowerCase().endsWith('.docx')
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf';
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
