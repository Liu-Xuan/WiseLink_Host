import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LocalMiaodaFileServiceDouble,
  resolveRealFtdFixturePath,
} from '../test/support/document-management-hosted-test-support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pdfPath = await resolveRealFtdFixturePath({
  repoRoot: root,
  filename: '777-FTD-31-21002_Doc_07042025.pdf',
  explicitFile: process.env.WL31_REAL_FTD_0704_FIXTURE?.trim() || null,
});
const [{ MiaodaFileServiceArtifactStore }, { DocumentManagementHostedCore }, catalogModule] =
  await Promise.all([
    import(pathToFileURL(resolve(
      root,
      'dist/server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
    ))),
    import(pathToFileURL(resolve(
      root,
      'dist/server/modules/document-management/src/hosted/documentManagementHostedCore.js',
    ))),
    import(pathToFileURL(resolve(
      root,
      'dist/server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js',
    ))),
  ]);

const {
  classifyImmutableSourceReuseState,
  classifyIncompleteIngestionRecoveryState,
} = catalogModule;
const bytes = await readFile(pdfPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const bucketId = 'local-hosted-default';
const filePath = `/document-management/source/sha256/${sha256.slice(0, 2)}/${sha256}.pdf`;

function seedCanonical(service, content, overrides = {}) {
  service.seed({
    bucketId,
    filePath,
    bytes: content,
    fileName: `${sha256}.pdf`,
    metadataOverrides: {
      id: 'verified-orphan-object',
      ...overrides,
    },
  });
}

async function expectCode(code, action) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

const exactService = new LocalMiaodaFileServiceDouble();
seedCanonical(exactService, bytes);
const exactReceipt = await new MiaodaFileServiceArtifactStore(exactService)
  .persistImmutableSource({
    bytes,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/pdf',
  });
assert.equal(exactReceipt.reusedExisting, true);
assert.equal(exactReceipt.providerObjectId, 'verified-orphan-object');
assert.equal(exactService.uploadCalls.length, 0);
assert.equal(exactService.removeCalls.length, 0);

const wrongBytesService = new LocalMiaodaFileServiceDouble();
const wrongBytes = Buffer.from(bytes);
wrongBytes[wrongBytes.byteLength - 1] ^= 0xff;
seedCanonical(wrongBytesService, wrongBytes);
await expectCode('ACTUAL_BYTE_READBACK_MISMATCH', () => (
  new MiaodaFileServiceArtifactStore(wrongBytesService).persistImmutableSource({
    bytes,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/pdf',
  })
));

const objectDriftService = new LocalMiaodaFileServiceDouble();
seedCanonical(objectDriftService, bytes);
objectDriftService.overrideDownloadMetadata(bucketId, filePath, {
  id: 'different-provider-object',
});
await expectCode('FILESERVICE_OBJECT_VERSION_DRIFT', () => (
  new MiaodaFileServiceArtifactStore(objectDriftService).persistImmutableSource({
    bytes,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/pdf',
  })
));

const lengthDriftService = new LocalMiaodaFileServiceDouble();
seedCanonical(lengthDriftService, bytes);
lengthDriftService.overrideDownloadMetadata(bucketId, filePath, {
  metadata: {
    contentLength: String(bytes.byteLength + 1),
    mimeType: 'application/pdf',
  },
});
await expectCode('FILESERVICE_METADATA_LENGTH_MISMATCH', () => (
  new MiaodaFileServiceArtifactStore(lengthDriftService).persistImmutableSource({
    bytes,
    sha256,
    byteLength: bytes.byteLength,
    mediaType: 'application/pdf',
  })
));

const input = {
  sourceArtifactId: 'source_artifact_exact',
  acquisitionId: 'acquisition_exact',
  idempotencyKey: 'ingest-exact',
  sha256,
  byteLength: bytes.byteLength,
  mediaType: 'application/pdf',
  bucketId,
  filePath,
  providerObjectId: 'verified-orphan-object',
  providerVersionId: 'verified-orphan-object',
};
const artifact = {
  ...input,
  id: 'artifact-row',
  readbackVerified: true,
  createdAt: new Date('2026-08-14T00:00:00Z'),
  createdBy: null,
  updatedAt: new Date('2026-08-14T00:00:00Z'),
  updatedBy: null,
};
const version = {
  sourceArtifactId: input.sourceArtifactId,
  acquisitionId: input.acquisitionId,
  documentVersionId: 'document_version_exact',
};
const acquisition = {
  sourceArtifactId: input.sourceArtifactId,
  acquisitionId: input.acquisitionId,
  documentVersionId: version.documentVersionId,
  status: 'COMMITTED_CANONICAL',
};
const preflight = {
  acquisitionId: input.acquisitionId,
  documentVersionId: version.documentVersionId,
  status: 'COMMITTED',
};

assert.equal(classifyImmutableSourceReuseState(input, {
  artifacts: [], acquisitions: [], preflights: [], versions: [],
}).disposition, 'ORPHAN_RECOVERY_ALLOWED');
assert.equal(classifyImmutableSourceReuseState(input, {
  artifacts: [artifact], acquisitions: [acquisition], preflights: [preflight], versions: [version],
}).disposition, 'CATALOGED_SOURCE_REUSE_ALLOWED');
assert.throws(
  () => classifyImmutableSourceReuseState(input, {
    artifacts: [artifact], acquisitions: [], preflights: [], versions: [],
  }),
  (error) => error?.code === 'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
);
assert.throws(
  () => classifyImmutableSourceReuseState(input, {
    artifacts: [{ ...artifact, providerObjectId: 'conflicting-object' }],
    acquisitions: [acquisition],
    preflights: [preflight],
    versions: [version],
  }),
  (error) => error?.code === 'IMMUTABLE_SOURCE_REUSE_DB_CONFLICT',
);

const recoveryInput = {
  sourceArtifact: input,
  acquisition: {
    acquisitionId: input.acquisitionId,
    sourceArtifactId: input.sourceArtifactId,
    sourceChannel: 'canonical_miaoda_document_selection',
    sourceRef: 'miaoda-file-service:selection:/ftd.pdf',
    selectionBucketId: 'selection',
    selectionFilePath: '/ftd.pdf',
    providerObjectId: 'selection-object',
    providerVersionId: 'selection-version',
    acquiredBy: 'actor',
    idempotencyKey: input.idempotencyKey,
    sourceDescriptor: {
      originalFilename: '777-FTD-31-21002_Doc_09262025.pdf',
      sha256,
      sizeBytes: bytes.byteLength,
      sourceKind: 'canonical_miaoda_document_selection',
    },
  },
  preflight: {
    preflightId: 'preflight_exact',
    acquisitionId: input.acquisitionId,
    decision: 'INGEST_NEW_FAMILY',
    branch: 'COMMIT_CANDIDATE',
    observedCurrentGeneration: 0,
    observedCurrentDocumentVersionId: null,
    normalizedDescriptor: { canonicalDocumentFamily: 'FTD' },
    decisionPayload: {
      generatedAt: '2026-08-14T09:00:00.000Z',
      decision: 'INGEST_NEW_FAMILY',
    },
  },
  downstream: {
    familyId: 'family_exact',
    canonicalIdentityKey: 'BOEING|FTD|777-FTD-31-21002',
    documentId: 'document_exact',
    documentVersionId: 'document_version_exact',
  },
};
const residualAcquisition = {
  ...recoveryInput.acquisition,
  documentVersionId: null,
  status: 'ACQUIRED_READBACK_VERIFIED',
  sourceDescriptorJson: JSON.stringify(recoveryInput.acquisition.sourceDescriptor),
};
const residualPreflight = {
  ...recoveryInput.preflight,
  executionAuthorized: false,
  status: 'READY',
  documentVersionId: null,
  commitIdempotencyKey: null,
  normalizedDescriptorJson: JSON.stringify(recoveryInput.preflight.normalizedDescriptor),
  decisionPayloadJson: JSON.stringify({
    ...recoveryInput.preflight.decisionPayload,
    generatedAt: '2026-08-14T08:00:00.000Z',
  }),
};
const threeRowState = {
  artifacts: [artifact],
  acquisitions: [residualAcquisition],
  preflights: [residualPreflight],
  families: [],
  documents: [],
  versions: [],
  currentness: [],
  workItems: [],
  actionAttempts: [],
};
assert.equal(
  classifyIncompleteIngestionRecoveryState(recoveryInput, threeRowState).disposition,
  'INCOMPLETE_INGESTION_RECOVERY_ALLOWED',
);
assert.throws(
  () => classifyIncompleteIngestionRecoveryState(recoveryInput, {
    ...threeRowState,
    artifacts: [{ ...artifact, providerVersionId: 'another-version' }],
  }),
  (error) => error?.code === 'INCOMPLETE_INGESTION_RECOVERY_ARTIFACT_CONFLICT',
);
assert.throws(
  () => classifyIncompleteIngestionRecoveryState(recoveryInput, {
    ...threeRowState,
    acquisitions: [{ ...residualAcquisition, acquiredBy: 'another-actor' }],
  }),
  (error) => error?.code === 'INCOMPLETE_INGESTION_RECOVERY_ACQUISITION_CONFLICT',
);
assert.throws(
  () => classifyIncompleteIngestionRecoveryState(recoveryInput, {
    ...threeRowState,
    acquisitions: [{ ...residualAcquisition, sourceRef: 'another-route' }],
  }),
  (error) => error?.code === 'INCOMPLETE_INGESTION_RECOVERY_ACQUISITION_CONFLICT',
);
assert.throws(
  () => classifyIncompleteIngestionRecoveryState(recoveryInput, {
    ...threeRowState,
    preflights: [{ ...residualPreflight, decision: 'REVIEW_REQUIRED' }],
  }),
  (error) => error?.code === 'INCOMPLETE_INGESTION_RECOVERY_PREFLIGHT_CONFLICT',
);
assert.throws(
  () => classifyIncompleteIngestionRecoveryState(recoveryInput, {
    ...threeRowState,
    workItems: [{}],
  }),
  (error) => error?.code === 'INCOMPLETE_INGESTION_RECOVERY_DOWNSTREAM_PRESENT',
);
assert.throws(
  () => classifyIncompleteIngestionRecoveryState(recoveryInput, {
    ...threeRowState,
    acquisitions: [residualAcquisition, { ...residualAcquisition }],
  }),
  (error) => error?.code === 'INCOMPLETE_INGESTION_RECOVERY_SHAPE_MISMATCH',
);

let deniedArtifactIo = 0;
const deniedCore = new DocumentManagementHostedCore({
  artifactStore: {
    async readSelection() { deniedArtifactIo += 1; },
    async persistImmutableSource() { deniedArtifactIo += 1; },
  },
  catalog: {
    async findIngestionByIdempotency() { throw new Error('catalog must not be called'); },
  },
  authorizer: {
    async assertCanIngest() {
      throw Object.assign(new Error('Permission changed.'), {
        code: 'DOCUMENT_INGEST_FORBIDDEN',
      });
    },
  },
});
await expectCode('DOCUMENT_INGEST_FORBIDDEN', () => (
  deniedCore.ingestFileServiceSelection({
    idempotencyKey: 'incomplete',
    sourceChannel: 'test',
    sourceRef: 'test:source',
    selection: { bucketId: 'selection', filePath: '/source.pdf' },
  }, {
    actorUserId: 'actor',
    tenantId: 'tenant',
    roles: [],
  })
));
assert.equal(deniedArtifactIo, 0);

process.stdout.write(`${JSON.stringify({
  status: 'HOSTED_ORPHAN_RECOVERY_PASS',
  realPdfSha256: sha256,
  realPdfByteLength: bytes.byteLength,
  exactOrphanReuse: true,
  uploadCount: exactService.uploadCalls.length,
  deleteCount: exactService.removeCalls.length,
  negativeCodes: [
    'ACTUAL_BYTE_READBACK_MISMATCH',
    'FILESERVICE_OBJECT_VERSION_DRIFT',
    'FILESERVICE_METADATA_LENGTH_MISMATCH',
    'IMMUTABLE_SOURCE_REUSE_DB_PARTIAL',
    'IMMUTABLE_SOURCE_REUSE_DB_CONFLICT',
    'INCOMPLETE_INGESTION_RECOVERY_SHAPE_MISMATCH',
    'INCOMPLETE_INGESTION_RECOVERY_ARTIFACT_CONFLICT',
    'INCOMPLETE_INGESTION_RECOVERY_ACQUISITION_CONFLICT',
    'INCOMPLETE_INGESTION_RECOVERY_PREFLIGHT_CONFLICT',
    'INCOMPLETE_INGESTION_RECOVERY_DOWNSTREAM_PRESENT',
    'DOCUMENT_INGEST_FORBIDDEN',
  ],
}, null, 2)}\n`);
