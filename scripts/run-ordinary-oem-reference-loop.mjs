import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

const DOCUMENT_ID = 'document_3ca189e09878d76f24477bf1';
const DOCUMENT_VERSION_ID = 'document_version_ad56cbdaec487e554130afe4';
const SOURCE_ARTIFACT_ID = 'source_artifact_56333e4df067698cc0ce9689';
const SOURCE_SHA256 =
  '05cf88265253e63a16bb3d850c2bff5a6b620088a245b316fcdbddcc6a8c0dd8';
const SOURCE_BYTE_LENGTH = 10_036_964;
const PACKAGE_ID =
  'urn:techpub:package:v1:sha256:88824f5f49f28b1f80ad2fc3df7e12b87bee7510f134c06323a5d8ced1b48797';
const PACKAGE_ARTIFACT_SHA256 =
  'a079ebf1333ec09eb9d74d3024e6e3d1d7a0f02d243188be824f8b0fb37735ab';
const PACKAGE_BYTE_LENGTH = 493_117;
const APP_ORIGIN =
  'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg';

class LocalFileService {
  constructor() {
    this.defaultBucket = 'local-oem-reference';
    this.files = new Map();
    this.uploadCalls = [];
    this.removeCalls = [];
  }

  key(bucketId, filePath) {
    return `${bucketId}:${String(filePath).replace(/^\/+/, '')}`;
  }

  seed({ bucketId, filePath, bytes, fileName, contentType, id }) {
    this.files.set(this.key(bucketId, filePath), {
      id,
      bytes: Uint8Array.from(bytes),
      fileName,
      contentType,
    });
  }

  async getDefaultBucket() {
    return this.defaultBucket;
  }

  from(bucketId) {
    const owner = this;
    return {
      async getFileMetadata(filePath) {
        const stored = owner.files.get(owner.key(bucketId, filePath));
        return stored ? metadata(bucketId, filePath, stored) : null;
      },
      async upload(bytes, options) {
        assert.equal(options.upsert, false);
        const key = owner.key(bucketId, options.filePath);
        assert.equal(owner.files.has(key), false);
        const stored = {
          id: `local-file-${owner.uploadCalls.length + 1}`,
          bytes: Uint8Array.from(bytes),
          fileName: options.fileName,
          contentType: options.contentType,
        };
        owner.files.set(key, stored);
        owner.uploadCalls.push({ bucketId, options: structuredClone(options) });
        return metadata(bucketId, options.filePath, stored);
      },
      async download(filePath) {
        const stored = owner.files.get(owner.key(bucketId, filePath));
        if (!stored) throw new Error('FILE_NOT_FOUND');
        return {
          content: Uint8Array.from(stored.bytes),
          metadata: metadata(bucketId, filePath, stored),
        };
      },
    };
  }
}

function metadata(bucketId, filePath, stored) {
  return {
    id: stored.id,
    bucketID: bucketId,
    filePath: `/${String(filePath).replace(/^\/+/, '')}`,
    name: stored.fileName,
    updatedAt: '2026-08-14T08:00:00.000Z',
    metadata: {
      contentLength: String(stored.bytes.byteLength),
      mimeType: stored.contentType,
    },
  };
}

class LocalReservationRepository {
  reservation = null;

  async reserve(input) {
    if (!this.reservation) {
      this.reservation = {
        workItemId: 'WI-LOCAL-OEM-REFERENCE-FAST61',
        requestId: 'REQ-LOCAL-OEM-REFERENCE-FAST61',
        attemptId: 'ATT-LOCAL-OEM-REFERENCE-FAST61',
        identity: structuredClone(input),
      };
      return { ...this.reservation, created: true };
    }
    assert.deepEqual(input, this.reservation.identity);
    return { ...this.reservation, created: false };
  }
}

class LocalProjectionRegistrar {
  projection = null;
  producerStateTransitions = 0;

  async loadOrCreate(seed) {
    if (!this.projection) {
      this.projection = { ...structuredClone(seed), revision: 1 };
    }
    return structuredClone(this.projection);
  }

  async compareAndSet({ expectedRevision, next }) {
    assert.equal(this.projection.revision, expectedRevision);
    this.projection = {
      ...structuredClone(next),
      revision: expectedRevision + 1,
    };
    this.producerStateTransitions += 1;
    return structuredClone(this.projection);
  }

  async getExact(input) {
    assert.equal(this.projection.workItemId, input.workItemId);
    assert.equal(this.projection.requestId, input.requestId);
    assert.equal(
      this.projection.source.documentVersionId,
      input.documentVersionId,
    );
    return structuredClone(this.projection);
  }

  async getByWorkItemId(workItemId) {
    assert.equal(this.projection.workItemId, workItemId);
    return structuredClone(this.projection);
  }
}

const [
  { ExactFtdFrozen2PdfProducerAdapter },
  {
    OrdinaryCanonicalAuthorizationAdapter,
    OrdinaryCanonicalPermissionSnapshotAdapter,
  },
  { OrdinaryMiaodaAppBindingAdapter },
  { CanonicalEntryFacadeService },
  { CanonicalFailureRecordingService },
  { CanonicalHostVerticalService },
  { OrdinaryFailureValidationWriteAuthorizationAdapter },
  { OrdinaryWorkItemService },
  { MiaodaOrdinaryArtifactStoreAdapter },
  { Frozen2CandidateReaderService },
  { PythonU0FullPackageValidatorAdapter },
  { U0FullValidationService },
  { U0Frozen2FailureAdapterService },
  { UnifiedReaderService },
] = await Promise.all([
  importBuilt('modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-canonical-authorization.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-miaoda-app-binding.adapter.js'),
  importBuilt('modules/canonical-host/canonical-entry-facade.service.js'),
  importBuilt('modules/canonical-host/canonical-failure-recording.service.js'),
  importBuilt('modules/canonical-host/canonical-host-vertical.service.js'),
  importBuilt(
    'modules/canonical-host/ordinary-failure-validation-write-authorization.adapter.js',
  ),
  importBuilt('modules/work-item/ordinary-work-item.service.js'),
  importBuilt('modules/unified-reader/miaoda-ordinary-artifact-store.adapter.js'),
  importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
  importBuilt('modules/unified-reader/python-u0-full-package-validator.adapter.js'),
  importBuilt('modules/unified-reader/u0-full-validation.service.js'),
  importBuilt('modules/unified-reader/u0-frozen2-failure-adapter.service.js'),
  importBuilt('modules/unified-reader/unified-reader.service.js'),
]);

const pdfPath = '/private/tmp/airbus-fast61-april2018.pdf';
const pdfBytes = await readFile(pdfPath);
assert.equal(pdfBytes.byteLength, SOURCE_BYTE_LENGTH);
const packageFixtureBytes = await readFile(
  resolve(
    root,
    'test/fixtures/airbus-fast61-oem-reference.frozen2.unified-package.json',
  ),
);
const packageFixture = JSON.parse(packageFixtureBytes.toString('utf8'));
const artifactRecord = JSON.parse(
  await readFile(
    resolve(
      root,
      'test/fixtures/airbus-fast61-oem-reference.frozen2.artifact-record.json',
    ),
    'utf8',
  ),
);
assert.equal(packageFixtureBytes.byteLength, PACKAGE_BYTE_LENGTH);
assert.equal(
  createHash('sha256').update(packageFixtureBytes).digest('hex'),
  PACKAGE_ARTIFACT_SHA256,
);
assert.equal(packageFixture.packageId, PACKAGE_ID);
assert.equal(packageFixture.contentUnits.length, 84);
assert.equal(packageFixture.sourceRefs.length, 80);
assert.equal(packageFixture.sourceSegments.length, 40);
assert.equal(artifactRecord.packageId, PACKAGE_ID);
assert.equal(artifactRecord.contentHash, PACKAGE_ID.replace('urn:techpub:package:v1:', ''));
assert.equal(artifactRecord.artifactHash, `sha256:${PACKAGE_ARTIFACT_SHA256}`);
assert.equal(artifactRecord.byteLength, PACKAGE_BYTE_LENGTH);
const sourcePath = 'controlled-oem-reference/airbus-fast61-april2018.pdf';
const providerObjectId = 'local-oem-reference-fast61-issue61';
const fileService = new LocalFileService();
fileService.seed({
  bucketId: fileService.defaultBucket,
  filePath: sourcePath,
  bytes: pdfBytes,
  fileName: 'airbus-fast61-april2018.pdf',
  contentType: 'application/pdf',
  id: providerObjectId,
});

const resolved = {
  version: {
    documentId: DOCUMENT_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID,
    pdfSha256: SOURCE_SHA256,
    byteLength: SOURCE_BYTE_LENGTH,
  },
  family: {
    familyId: 'family_6d2f5ae200f2999e8874188a',
    documentFamily: 'OEM_REFERENCE',
  },
  artifact: {
    bucketId: fileService.defaultBucket,
    filePath: sourcePath,
    providerObjectId,
    providerVersionId: providerObjectId,
  },
};
const resolver = {
  async resolve(documentVersionId) {
    assert.equal(documentVersionId, DOCUMENT_VERSION_ID);
    return structuredClone(resolved);
  },
};
const documentManagement = {
  async ingestFileServiceSelection() {
    throw new Error('OEM_REFERENCE_LOOP_MUST_USE_EXACT_DOCUMENT_VERSION');
  },
};
const reservationRepository = new LocalReservationRepository();
const registrar = new LocalProjectionRegistrar();
const artifactStore = new MiaodaOrdinaryArtifactStoreAdapter(fileService);
const validator = new U0FullValidationService(
  new PythonU0FullPackageValidatorAdapter({
    pythonExecutable: process.env.WL_LOCAL_U0_PYTHON || 'python3',
    contractRoot: resolve(
      root,
      'dist/server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
    ),
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
    validatorRevision: 'canonical-host-oem-reference-local-real',
  }),
);
const exactProducer = new ExactFtdFrozen2PdfProducerAdapter(
  fileService,
  resolver,
  validator,
);
let producerRunCount = 0;
const producer = {
  async producePdf(request) {
    producerRunCount += 1;
    return exactProducer.producePdf(request);
  },
};
const reader = new UnifiedReaderService(
  artifactStore,
  new Frozen2CandidateReaderService(),
  validator,
  {
    mode: 'HOST_CONFIGURED',
    artifactStoreConfigured: true,
    fullU0ValidatorConfigured: true,
    immutableAcceptanceReceiptOwnerConfigured: false,
    aeoSpecialistReaderConfigured: false,
    authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
  },
);
const entry = new CanonicalEntryFacadeService(
  new OrdinaryMiaodaAppBindingAdapter(),
);
const failureRecorder = new CanonicalFailureRecordingService(
  new U0Frozen2FailureAdapterService(validator),
  new OrdinaryFailureValidationWriteAuthorizationAdapter(),
  artifactStore,
  { nowIso: () => '2026-08-14T08:00:02.000Z' },
);
const vertical = new CanonicalHostVerticalService(
  registrar,
  producer,
  new OrdinaryCanonicalAuthorizationAdapter(),
  new OrdinaryCanonicalPermissionSnapshotAdapter(),
  artifactStore,
  reader,
  entry,
  failureRecorder,
);
const workItems = new OrdinaryWorkItemService(
  documentManagement,
  resolver,
  reservationRepository,
  vertical,
);
const actor = {
  userId: 'local-oem-reference-reviewer',
  tenantId: 'local-tenant',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'local',
};
const request = { documentVersionId: DOCUMENT_VERSION_ID, query: 'FAST' };
const first = await workItems.parsePdf(request, actor);
if (first.result.status !== 'CANDIDATE_VERTICAL_VERIFIED') {
  throw new Error(`OEM_REFERENCE_FIRST_LOOP_FAILED:${JSON.stringify(first.result.workItem)}`);
}
const second = await workItems.parsePdf(request, actor);
const sourcePage = await vertical.page(
  { workItemId: first.result.workItem.workItemId, query: 'FAST' },
  actor,
);

assert.equal(first.workItemCreated, true);
assert.equal(second.workItemReused, true);
assert.equal(first.result.status, 'CANDIDATE_VERTICAL_VERIFIED');
assert.equal(second.result.workItem.workItemId, first.result.workItem.workItemId);
assert.equal(first.result.workItem.source.documentVersionId, DOCUMENT_VERSION_ID);
assert.equal(first.result.workItem.classification.normalizedFamily, 'OEM_REFERENCE');
assert.equal(first.result.workItem.package.packageId, PACKAGE_ID);
assert.equal(first.result.workItem.package.artifact.sha256, PACKAGE_ARTIFACT_SHA256);
assert.equal(first.result.workItem.package.artifact.byteLength, PACKAGE_BYTE_LENGTH);
assert.equal(first.result.workItem.package.resultStatus, 'partial');
assert.equal(first.result.workItem.package.contentUnitCount, 84);
assert.equal(first.result.workItem.package.sourceRefCount, 80);
assert.deepEqual(first.result.workItem.package.usagePolicy, {
  presentationMode: 'REFERENCE_ONLY',
  qualityStatus: 'NEEDS_REVIEW',
  applicability: {
    sourceExpressionCount: 0,
    normalizedCandidateCount: 0,
    assignmentCount: 0,
  },
  assessmentAutoAdoptionAllowed: false,
  aeoAutoAdoptionAllowed: false,
  projectionSource: 'IMMUTABLE_PACKAGE_ACTUAL_BYTES',
});
assert.equal(producerRunCount, 1);
assert.equal(registrar.producerStateTransitions, 2);
assert.ok(sourcePage.queryResults.length > 0);
assert.ok(
  sourcePage.queryResults.every((item) => item.sourceRefIds.length > 0),
);
assert.equal(
  sourcePage.entry.deepLinkPath,
  `${APP_ORIGIN}/work-items/WI-LOCAL-OEM-REFERENCE-FAST61/documents`,
);
assert.equal('assessment' in first.result.workItem, false);
assert.equal('aeo' in first.result.workItem, false);
assert.equal(fileService.uploadCalls.length, 1);
assert.equal(fileService.removeCalls.length, 0);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ORDINARY_OEM_REFERENCE_LOOP_PASS',
      formalEntry: {
        schema: 'wiselink.v3_1.document_management.parse_request_export.v1',
        documentManagementOwnerCommit:
          'fcab253b17dd1d118232fdbb72f4e0fe2d295f0e',
        parserCommit: '454957b9f1559ea9bde72c32524f14507794cfdc',
        unifiedAcceptanceCommit:
          'bbc2824bdf4cb9ce9c82f1be53fd24dd768966b5',
        formalRequestCommit:
          'bb836ed6e97383f651a57657d7361fa64d898126',
      },
      source: {
        path: pdfPath,
        byteLength: pdfBytes.byteLength,
        sha256: SOURCE_SHA256,
        documentVersionId: DOCUMENT_VERSION_ID,
      },
      workItem: {
        workItemId: first.result.workItem.workItemId,
        firstCreated: first.workItemCreated,
        repeatReused: second.workItemReused,
        producerRunCount,
        phase: first.result.workItem.phase,
      },
      package: {
        packageId: first.result.workItem.package.packageId,
        artifact: first.result.workItem.package.artifact,
        resultStatus: first.result.workItem.package.resultStatus,
        contentUnitCount: first.result.workItem.package.contentUnitCount,
        sourceRefCount: first.result.workItem.package.sourceRefCount,
        sourceSegmentCount: packageFixture.sourceSegments.length,
        usagePolicy: first.result.workItem.package.usagePolicy,
        fullValidator: first.result.workItem.package.fullValidatorProof,
        artifactRecord: {
          schema: artifactRecord.$schema,
          artifactHash: artifactRecord.artifactHash,
          byteLength: artifactRecord.byteLength,
          contentHash: artifactRecord.contentHash,
          packageId: artifactRecord.packageId,
        },
      },
      reader: {
        applicabilityObjects:
          first.result.workItem.package.usagePolicy.applicability,
        sourceBoundResultCount: sourcePage.queryResults.length,
        allReturnedUnitsSourceBound: sourcePage.queryResults.every(
          (item) => item.sourceRefIds.length > 0,
        ),
      },
      page: {
        deepLink: sourcePage.entry.deepLinkPath,
        sameWorkItem: sourcePage.workItem.workItemId,
        referenceOnly: true,
        qualityStatus: 'NEEDS_REVIEW',
      },
      authority: {
        assessmentAutoAdoption: false,
        aeoAutoAdoption: false,
        onlineWrites: 0,
        published: false,
      },
    },
    null,
    2,
  )}\n`,
);
