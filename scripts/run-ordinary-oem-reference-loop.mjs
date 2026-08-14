import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

const DOCUMENT_ID = 'document_ca48ac1dc4b0642ef85c97b6';
const FAMILY_ID = 'family_10e75a738b3d197ddab94307';
const DOCUMENT_CODE = 'AIRBUS-FAST';
const MAPPING_PROFILE = 'frozen.2-controlled-oem-reference.1';
const VERSIONS = [
  {
    issue: 61,
    businessRevision: 'ISSUE 61',
    pdfPath: '/private/tmp/airbus-fast61-april2018.pdf',
    fileName: 'airbus-fast61-april2018.pdf',
    sourcePath: 'controlled-oem-reference/airbus-fast61-april2018.pdf',
    providerObjectId: 'local-oem-reference-fast61-issue61',
    documentVersionId: 'document_version_7d5aca8851db8ea41b89003d',
    sourceArtifactId: 'source_artifact_56333e4df067698cc0ce9689',
    sourceSha256:
      '05cf88265253e63a16bb3d850c2bff5a6b620088a245b316fcdbddcc6a8c0dd8',
    sourceByteLength: 10_036_964,
    packageFixture:
      'airbus-fast61-oem-reference.frozen2.unified-package.json',
    artifactRecordFixture:
      'airbus-fast61-oem-reference.frozen2.artifact-record.json',
    packageId:
      'urn:techpub:package:v1:sha256:c2e4716fdde0ca6d29673d19ec21288d0030ac07a6d511081e7d857400897aa3',
    packageArtifactSha256:
      'abd9b428864cd47bb28617c251d7504095add87b84388b4605fd80e421af9f48',
    packageByteLength: 493_111,
    semanticHash:
      'sha256:439154c42b51a2be6d2fdbbf1e5546f2054fe881ddb9384a76ce079531cc86db',
    provenanceHash:
      'sha256:226eefc3fb5f7cbc451c2d4e9165fa31781395853e5a84c52bb94d953a9671be',
    coverageHash:
      'sha256:efa78d0e362756ced700b1be75a3505513fb7c62ad94c19180eb093f5c7516db',
    workItemId: 'WI-LOCAL-OEM-REFERENCE-FAST61',
    requestId: 'REQ-LOCAL-OEM-REFERENCE-FAST61',
    attemptId: 'ATT-LOCAL-OEM-REFERENCE-FAST61',
  },
  {
    issue: 62,
    businessRevision: 'ISSUE 62',
    pdfPath: '/private/tmp/airbus-fast62-october2018.pdf',
    fileName: 'airbus-fast62-october2018.pdf',
    sourcePath: 'controlled-oem-reference/airbus-fast62-october2018.pdf',
    providerObjectId: 'local-oem-reference-fast62-issue62',
    documentVersionId: 'document_version_c71fbc457cdc5e7a05725a4d',
    sourceArtifactId: 'source_artifact_cbf15ea1ac0b2575ed939d45',
    sourceSha256:
      '7b793ed00e10ae8513de6972cce06128986c938b565986f49aa02405fab4f380',
    sourceByteLength: 7_179_982,
    packageFixture:
      'airbus-fast62-oem-reference.frozen2.unified-package.json',
    artifactRecordFixture:
      'airbus-fast62-oem-reference.frozen2.artifact-record.json',
    packageId:
      'urn:techpub:package:v1:sha256:bd7d7f707b6ac6518d99de187c1f1295f70df5d12714d4eab000f6025cb354a2',
    packageArtifactSha256:
      '305aff0102c82cfac5609d99ca47b2dd574a05d27b5a3ba889630a979fbfb2ec',
    packageByteLength: 508_172,
    semanticHash:
      'sha256:b1ff0474818ea8a33867e3c121d74c1b65c71665d885937f905b68e607af9de6',
    provenanceHash:
      'sha256:cafcfb9ee525a07ded948f7996e8d71a69924141a447321481dabbc8212298f8',
    coverageHash:
      'sha256:6e3bf643f863a45d463c7fa04c3e7f6e4da05f95d52cac3e83d959582f34bd87',
    workItemId: 'WI-LOCAL-OEM-REFERENCE-FAST62',
    requestId: 'REQ-LOCAL-OEM-REFERENCE-FAST62',
    attemptId: 'ATT-LOCAL-OEM-REFERENCE-FAST62',
  },
];
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
  reservations = new Map();

  async reserve(input) {
    const version = VERSIONS.find(
      (candidate) => candidate.documentVersionId === input.documentVersionId,
    );
    assert.ok(version);
    const existing = this.reservations.get(input.documentVersionId);
    if (!existing) {
      const reservation = {
        workItemId: version.workItemId,
        requestId: version.requestId,
        attemptId: version.attemptId,
        identity: structuredClone(input),
      };
      this.reservations.set(input.documentVersionId, reservation);
      return { ...reservation, created: true };
    }
    assert.deepEqual(input, existing.identity);
    return { ...existing, created: false };
  }
}

class LocalProjectionRegistrar {
  projections = new Map();
  producerStateTransitions = 0;

  async loadOrCreate(seed) {
    if (!this.projections.has(seed.workItemId)) {
      this.projections.set(seed.workItemId, {
        ...structuredClone(seed),
        revision: 1,
      });
    }
    return structuredClone(this.projections.get(seed.workItemId));
  }

  async compareAndSet({ workItemId, expectedRevision, next }) {
    const projection = this.projections.get(workItemId);
    assert.ok(projection);
    assert.equal(projection.revision, expectedRevision);
    const updated = {
      ...structuredClone(next),
      revision: expectedRevision + 1,
    };
    this.projections.set(workItemId, updated);
    this.producerStateTransitions += 1;
    return structuredClone(updated);
  }

  async getExact(input) {
    const projection = this.projections.get(input.workItemId);
    assert.ok(projection);
    assert.equal(projection.requestId, input.requestId);
    assert.equal(
      projection.source.documentVersionId,
      input.documentVersionId,
    );
    return structuredClone(projection);
  }

  async getByWorkItemId(workItemId) {
    const projection = this.projections.get(workItemId);
    assert.ok(projection);
    return structuredClone(projection);
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

const fileService = new LocalFileService();
const fixtureByVersion = new Map();
const resolvedByVersion = new Map();

for (const version of VERSIONS) {
  const sourceBytes = await readFile(version.pdfPath);
  assert.equal(sourceBytes.byteLength, version.sourceByteLength);
  assert.equal(
    createHash('sha256').update(sourceBytes).digest('hex'),
    version.sourceSha256,
  );
  const packageBytes = await readFile(
    resolve(root, 'test/fixtures', version.packageFixture),
  );
  const packageFixture = JSON.parse(packageBytes.toString('utf8'));
  const artifactRecord = JSON.parse(
    await readFile(
      resolve(root, 'test/fixtures', version.artifactRecordFixture),
      'utf8',
    ),
  );
  assert.equal(packageBytes.byteLength, version.packageByteLength);
  assert.equal(
    createHash('sha256').update(packageBytes).digest('hex'),
    version.packageArtifactSha256,
  );
  assert.equal(packageFixture.packageId, version.packageId);
  assert.equal(packageFixture.integrity.semanticHash, version.semanticHash);
  assert.equal(packageFixture.integrity.provenanceHash, version.provenanceHash);
  assert.equal(packageFixture.integrity.coverageHash, version.coverageHash);
  assert.equal(packageFixture.contentUnits.length, 84);
  assert.equal(packageFixture.sourceRefs.length, 80);
  assert.equal(packageFixture.sourceSegments.length, 40);
  assert.equal(packageFixture.document.identifiers[0].value, DOCUMENT_CODE);
  assert.equal(
    packageFixture.document.revision.label.value,
    version.businessRevision,
  );
  assert.equal(artifactRecord.packageId, version.packageId);
  assert.equal(
    artifactRecord.contentHash,
    version.packageId.replace('urn:techpub:package:v1:', ''),
  );
  assert.equal(
    artifactRecord.artifactHash,
    `sha256:${version.packageArtifactSha256}`,
  );
  assert.equal(artifactRecord.byteLength, version.packageByteLength);
  fileService.seed({
    bucketId: fileService.defaultBucket,
    filePath: version.sourcePath,
    bytes: sourceBytes,
    fileName: version.fileName,
    contentType: 'application/pdf',
    id: version.providerObjectId,
  });
  fixtureByVersion.set(version.documentVersionId, {
    packageFixture,
    artifactRecord,
  });
  resolvedByVersion.set(version.documentVersionId, {
    version: {
      documentId: DOCUMENT_ID,
      documentVersionId: version.documentVersionId,
      sourceArtifactId: version.sourceArtifactId,
      pdfSha256: version.sourceSha256,
      byteLength: version.sourceByteLength,
    },
    family: {
      familyId: FAMILY_ID,
      documentFamily: 'OEM_REFERENCE',
      canonicalDocumentNumber: DOCUMENT_CODE,
      currentDocumentVersionId: VERSIONS[1].documentVersionId,
      currentGeneration: 2,
    },
    artifact: {
      bucketId: fileService.defaultBucket,
      filePath: version.sourcePath,
      providerObjectId: version.providerObjectId,
      providerVersionId: version.providerObjectId,
    },
  });
}

const resolver = {
  async resolve(documentVersionId) {
    const resolved = resolvedByVersion.get(documentVersionId);
    assert.ok(resolved);
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
const producerRunCounts = new Map();
const producer = {
  async producePdf(request) {
    const documentVersionId = request.source.documentVersionId;
    producerRunCounts.set(
      documentVersionId,
      (producerRunCounts.get(documentVersionId) ?? 0) + 1,
    );
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
const acceptedVersions = [];

for (const version of VERSIONS) {
  const request = {
    documentVersionId: version.documentVersionId,
    query: 'FAST',
  };
  const first = await workItems.parsePdf(request, actor);
  if (first.result.status !== 'CANDIDATE_VERTICAL_VERIFIED') {
    throw new Error(
      `OEM_REFERENCE_LOOP_FAILED:${version.issue}:${JSON.stringify(first.result.workItem)}`,
    );
  }
  const repeat = await workItems.parsePdf(request, actor);
  const page = await vertical.page(
    { workItemId: first.result.workItem.workItemId, query: 'FAST' },
    actor,
  );
  const fixture = fixtureByVersion.get(version.documentVersionId);
  assert.ok(fixture);
  assert.equal(first.workItemCreated, true);
  assert.equal(repeat.workItemReused, true);
  assert.equal(repeat.result.workItem.workItemId, version.workItemId);
  assert.equal(first.result.workItem.workItemId, version.workItemId);
  assert.equal(
    first.result.workItem.source.documentVersionId,
    version.documentVersionId,
  );
  assert.equal(
    first.result.workItem.classification.normalizedFamily,
    'OEM_REFERENCE',
  );
  assert.equal(
    first.result.workItem.classification.parserProfileId,
    'parser-profile:generic.document@1.0.0',
  );
  assert.equal(first.result.workItem.package.packageId, version.packageId);
  assert.equal(
    first.result.workItem.package.artifact.sha256,
    version.packageArtifactSha256,
  );
  assert.equal(
    first.result.workItem.package.artifact.byteLength,
    version.packageByteLength,
  );
  assert.equal(first.result.workItem.package.semanticHash, version.semanticHash);
  assert.equal(
    first.result.workItem.package.provenanceHash,
    version.provenanceHash,
  );
  assert.equal(first.result.workItem.package.coverageHash, version.coverageHash);
  assert.equal(first.result.workItem.package.resultStatus, 'partial');
  assert.equal(first.result.workItem.package.contentUnitCount, 84);
  assert.equal(first.result.workItem.package.sourceRefCount, 80);
  assert.deepEqual(first.result.workItem.package.documentIdentity, {
    documentCode: DOCUMENT_CODE,
    businessRevision: version.businessRevision,
  });
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
  assert.equal(producerRunCounts.get(version.documentVersionId), 1);
  assert.ok(page.queryResults.length > 0);
  assert.ok(
    page.queryResults.every((item) => item.sourceRefIds.length > 0),
  );
  assert.equal(page.workItem.workItemId, version.workItemId);
  assert.equal(page.workItem.package.packageId, version.packageId);
  assert.equal(
    page.entry.deepLinkPath,
    `${APP_ORIGIN}/work-items/${version.workItemId}/documents`,
  );
  assert.equal('assessment' in first.result.workItem, false);
  assert.equal('aeo' in first.result.workItem, false);
  acceptedVersions.push({ version, first, repeat, page, fixture });
}

const historicalIssue61Page = await vertical.page(
  { workItemId: VERSIONS[0].workItemId, query: 'FAST' },
  actor,
);
assert.equal(
  historicalIssue61Page.workItem.source.documentVersionId,
  VERSIONS[0].documentVersionId,
);
assert.equal(
  historicalIssue61Page.workItem.package.packageId,
  VERSIONS[0].packageId,
);
assert.notEqual(VERSIONS[0].workItemId, VERSIONS[1].workItemId);
assert.notEqual(VERSIONS[0].documentVersionId, VERSIONS[1].documentVersionId);
assert.equal(registrar.producerStateTransitions, 4);
assert.equal(fileService.uploadCalls.length, 2);
assert.equal(fileService.removeCalls.length, 0);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'ORDINARY_OEM_REFERENCE_VERSION_CHAIN_PASS',
      formalEntry: {
        schema: 'wiselink.v3_1.document_management.parse_request_export.v1',
        documentManagementOwnerCommit:
          '7eec76ae972312ecb81bbce569140df6c782fbba',
        parserCommit: '454957b9f1559ea9bde72c32524f14507794cfdc',
        unifiedAcceptanceCommit:
          '916e647a0edd7d02c77433e4765ce42237a369c9',
        formalRequestCommit:
          'bb836ed6e97383f651a57657d7361fa64d898126',
        mappingProfile: MAPPING_PROFILE,
      },
      documentChain: {
        familyId: FAMILY_ID,
        documentId: DOCUMENT_ID,
        documentCode: DOCUMENT_CODE,
        currentGeneration: 2,
        currentDocumentVersionId: VERSIONS[1].documentVersionId,
        historicalDocumentVersionId: VERSIONS[0].documentVersionId,
        historicalWorkItemStillReadable: true,
      },
      versions: acceptedVersions.map(({ version, first, repeat, page, fixture }) => ({
        issue: version.issue,
        businessRevision: version.businessRevision,
        source: {
          path: version.pdfPath,
          byteLength: version.sourceByteLength,
          sha256: version.sourceSha256,
          documentVersionId: version.documentVersionId,
        },
        workItem: {
          workItemId: first.result.workItem.workItemId,
          firstCreated: first.workItemCreated,
          repeatReused: repeat.workItemReused,
          producerRunCount: producerRunCounts.get(version.documentVersionId),
          phase: first.result.workItem.phase,
        },
        package: {
          packageId: first.result.workItem.package.packageId,
          artifact: first.result.workItem.package.artifact,
          resultStatus: first.result.workItem.package.resultStatus,
          documentIdentity: first.result.workItem.package.documentIdentity,
          semanticHash: first.result.workItem.package.semanticHash,
          provenanceHash: first.result.workItem.package.provenanceHash,
          coverageHash: first.result.workItem.package.coverageHash,
          contentUnitCount: first.result.workItem.package.contentUnitCount,
          sourceRefCount: first.result.workItem.package.sourceRefCount,
          sourceSegmentCount: fixture.packageFixture.sourceSegments.length,
          usagePolicy: first.result.workItem.package.usagePolicy,
          fullValidator: first.result.workItem.package.fullValidatorProof,
          artifactRecord: {
            schema: fixture.artifactRecord.$schema,
            artifactHash: fixture.artifactRecord.artifactHash,
            byteLength: fixture.artifactRecord.byteLength,
            contentHash: fixture.artifactRecord.contentHash,
            packageId: fixture.artifactRecord.packageId,
          },
        },
        reader: {
          sourceBoundResultCount: page.queryResults.length,
          allReturnedUnitsSourceBound: page.queryResults.every(
            (item) => item.sourceRefIds.length > 0,
          ),
        },
        page: {
          deepLink: page.entry.deepLinkPath,
          sameWorkItem: page.workItem.workItemId,
          referenceOnly: true,
          qualityStatus: 'NEEDS_REVIEW',
        },
      })),
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
