import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  InMemoryHostedDocumentCatalog,
  LocalMiaodaFileServiceDouble,
  resolveRealFtdFixturePath,
} from '../test/support/document-management-hosted-test-support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

class LocalReservationRepository {
  reservation = null;
  async reserve(input) {
    if (!this.reservation) {
      this.reservation = {
        workItemId: 'WI-LOCAL-FTD-FIRST-VERTICAL',
        requestId: 'REQ-LOCAL-FTD-FIRST-VERTICAL',
        attemptId: 'ATT-LOCAL-FTD-FIRST-VERTICAL',
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
    if (!this.projection) this.projection = { ...structuredClone(seed), revision: 1 };
    return structuredClone(this.projection);
  }
  async compareAndSet({ expectedRevision, next }) {
    assert.equal(this.projection.revision, expectedRevision);
    this.projection = { ...structuredClone(next), revision: expectedRevision + 1 };
    this.producerStateTransitions += 1;
    return structuredClone(this.projection);
  }
  async getExact(input) {
    assert.equal(this.projection.workItemId, input.workItemId);
    assert.equal(this.projection.requestId, input.requestId);
    assert.equal(this.projection.source.documentVersionId, input.documentVersionId);
    return structuredClone(this.projection);
  }
  async getByWorkItemId(workItemId) {
    assert.equal(this.projection.workItemId, workItemId);
    return structuredClone(this.projection);
  }
}
const [
  { DocumentManagementHostedCore },
  { MiaodaFileServiceArtifactStore },
  { classifyImmutableSourceReuseState, classifyIncompleteIngestionRecoveryState },
  { ExactFtdFrozen2PdfProducerAdapter },
  { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter },
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
  importBuilt('modules/document-management/src/hosted/documentManagementHostedCore.js'),
  importBuilt('modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js'),
  importBuilt('modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js'),
  importBuilt('modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-canonical-authorization.adapter.js'),
  importBuilt('modules/canonical-host/ordinary-miaoda-app-binding.adapter.js'),
  importBuilt('modules/canonical-host/canonical-entry-facade.service.js'),
  importBuilt('modules/canonical-host/canonical-failure-recording.service.js'),
  importBuilt('modules/canonical-host/canonical-host-vertical.service.js'),
  importBuilt('modules/canonical-host/ordinary-failure-validation-write-authorization.adapter.js'),
  importBuilt('modules/work-item/ordinary-work-item.service.js'),
  importBuilt('modules/unified-reader/miaoda-ordinary-artifact-store.adapter.js'),
  importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
  importBuilt('modules/unified-reader/python-u0-full-package-validator.adapter.js'),
  importBuilt('modules/unified-reader/u0-full-validation.service.js'),
  importBuilt('modules/unified-reader/u0-frozen2-failure-adapter.service.js'),
  importBuilt('modules/unified-reader/unified-reader.service.js'),
]);

const pdfPath = await resolveRealFtdFixturePath({ repoRoot: root });
const pdfBytes = await readFile(pdfPath);
const fileService = new LocalMiaodaFileServiceDouble();
const selectionBucket = 'local-drive-like-selection';
const selectionPath = '/selection/777-FTD-31-21002_Doc_09262025.pdf';
fileService.seed({
  bucketId: selectionBucket,
  filePath: selectionPath,
  bytes: pdfBytes,
  fileName: '777-FTD-31-21002_Doc_09262025.pdf',
});
const catalog = new InMemoryHostedDocumentCatalog();
catalog.assertImmutableSourceReuseSafe = async (input) => {
  const snapshot = catalog.snapshot();
  const acquisitions = snapshot.acquisitions.filter((row) => (
    row.acquisitionId === input.acquisitionId
    || row.idempotencyKey === input.idempotencyKey
    || row.sourceArtifactId === input.sourceArtifactId
  ));
  const acquisitionIds = new Set([
    input.acquisitionId,
    ...acquisitions.map((row) => row.acquisitionId),
  ]);
  return classifyImmutableSourceReuseState(input, {
    artifacts: snapshot.sourceArtifacts.filter((row) => (
      row.sourceArtifactId === input.sourceArtifactId
      || (row.sha256 === input.sha256 && row.byteLength === input.byteLength)
      || (row.bucketId === input.bucketId && row.filePath === input.filePath)
    )),
    acquisitions,
    preflights: snapshot.preflights.filter((row) => acquisitionIds.has(row.acquisitionId)),
    versions: snapshot.documentVersions.filter((row) => (
      row.sourceArtifactId === input.sourceArtifactId
      || row.acquisitionId === input.acquisitionId
    )),
  });
};
catalog.assertIncompleteIngestionRecoverySafe = async (input) => {
  const snapshot = catalog.snapshot();
  return classifyIncompleteIngestionRecoveryState(input, {
    artifacts: snapshot.sourceArtifacts.filter((row) => (
      row.sourceArtifactId === input.sourceArtifact.sourceArtifactId
      || (row.sha256 === input.sourceArtifact.sha256
        && row.byteLength === input.sourceArtifact.byteLength)
      || (row.bucketId === input.sourceArtifact.bucketId
        && row.filePath === input.sourceArtifact.filePath)
    )),
    acquisitions: snapshot.acquisitions.filter((row) => (
      row.acquisitionId === input.acquisition.acquisitionId
      || row.idempotencyKey === input.acquisition.idempotencyKey
      || row.sourceArtifactId === input.sourceArtifact.sourceArtifactId
    )).map((row) => ({
      ...row,
      sourceDescriptorJson: JSON.stringify(row.sourceDescriptor),
    })),
    preflights: snapshot.preflights.filter((row) => (
      row.preflightId === input.preflight.preflightId
      || row.acquisitionId === input.acquisition.acquisitionId
    )).map((row) => ({
      ...row,
      documentVersionId: row.documentVersionId ?? null,
      commitIdempotencyKey: row.commitIdempotencyKey ?? null,
      normalizedDescriptorJson: JSON.stringify(row.normalizedDescriptor),
      decisionPayloadJson: JSON.stringify(row.decisionPayload),
    })),
    families: snapshot.publicationFamilies.filter((row) => (
      row.familyId === input.downstream.familyId
      || row.canonicalIdentityKey === input.downstream.canonicalIdentityKey
    )),
    documents: snapshot.documents.filter((row) => (
      row.documentId === input.downstream.documentId
      || row.familyId === input.downstream.familyId
    )),
    versions: snapshot.documentVersions.filter((row) => (
      row.documentVersionId === input.downstream.documentVersionId
      || row.familyId === input.downstream.familyId
      || row.sourceArtifactId === input.sourceArtifact.sourceArtifactId
      || row.acquisitionId === input.acquisition.acquisitionId
    )),
    currentness: snapshot.currentnessDecisions.filter((row) => (
      row.familyId === input.downstream.familyId
      || row.preflightId === input.preflight.preflightId
      || row.nextDocumentVersionId === input.downstream.documentVersionId
    )),
    workItems: [],
    actionAttempts: [],
  });
};
const dmCore = new DocumentManagementHostedCore({
  artifactStore: new MiaodaFileServiceArtifactStore(fileService),
  catalog,
  authorizer: {
    async assertCanIngest(context) {
      assert.equal(context.actorUserId, 'local-user');
      assert.equal(context.tenantId, 'local-tenant');
    },
  },
});
const documentManagement = {
  ingestFileServiceSelection: (request, context) =>
    dmCore.ingestFileServiceSelection(request, context),
};
const resolver = {
  async resolve(documentVersionId) {
    const version = await catalog.readDocumentVersion(documentVersionId);
    assert.ok(version);
    const family = await catalog.readFamily(version.familyId);
    const artifact = catalog
      .snapshot()
      .sourceArtifacts.find((item) => item.sourceArtifactId === version.sourceArtifactId);
    assert.ok(family);
    assert.ok(artifact);
    return { version, family, artifact };
  },
};

const reservationRepository = new LocalReservationRepository();
const registrar = new LocalProjectionRegistrar();
const artifactStore = new MiaodaOrdinaryArtifactStoreAdapter(fileService);
const validatorAdapter = new PythonU0FullPackageValidatorAdapter({
  pythonExecutable: process.env.WL_LOCAL_U0_PYTHON || 'python3',
  contractRoot: resolve(
    root,
    'dist/server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
  ),
  contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
  validatorRevision: 'canonical-host-ordinary-local-real',
});
const validator = new U0FullValidationService(validatorAdapter);
const producer = new ExactFtdFrozen2PdfProducerAdapter(
  fileService,
  resolver,
  validator,
);
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
const entry = new CanonicalEntryFacadeService(new OrdinaryMiaodaAppBindingAdapter());
const failureRecorder = new CanonicalFailureRecordingService(
  new U0Frozen2FailureAdapterService(validator),
  new OrdinaryFailureValidationWriteAuthorizationAdapter(),
  artifactStore,
  { nowIso: () => '2026-08-14T06:00:00.000Z' },
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
  userId: 'local-user',
  tenantId: 'local-tenant',
  appId: 'app_17bzc551rsg',
  roles: ['authenticated'],
  env: 'local',
};
const request = {
  selection: { bucketId: selectionBucket, filePath: selectionPath },
  query: 'software',
};
let residualProof = null;
if (process.env.WL_TEST_SEED_THREE_ROW_RESIDUAL === '1') {
  const commitNewVersion = catalog.commitNewVersion.bind(catalog);
  catalog.commitNewVersion = async () => {
    throw Object.assign(new Error('Simulated hosted commit failure after three ingress rows.'), {
      code: 'SIMULATED_HOSTED_COMMIT_FAILURE',
    });
  };
  await assert.rejects(
    workItems.parsePdf(request, actor),
    (error) => error?.code === 'SIMULATED_HOSTED_COMMIT_FAILURE',
  );
  catalog.commitNewVersion = commitNewVersion;
  const residual = catalog.snapshot();
  assert.equal(residual.sourceArtifacts.length, 1);
  assert.equal(residual.acquisitions.length, 1);
  assert.equal(residual.preflights.length, 1);
  assert.equal(residual.publicationFamilies.length, 0);
  assert.equal(residual.documents.length, 0);
  assert.equal(residual.documentVersions.length, 0);
  assert.equal(residual.currentnessDecisions.length, 0);
  assert.equal(reservationRepository.reservation, null);
  residualProof = {
    sourceArtifacts: residual.sourceArtifacts.length,
    acquisitions: residual.acquisitions.length,
    preflights: residual.preflights.length,
    downstreamRows: 0,
    workItems: 0,
    actionAttempts: 0,
    immutableUploadsBeforeRecovery: fileService.uploadCalls.length,
    sourceFilePath: residual.sourceArtifacts[0].filePath,
  };
}
const first = await workItems.parsePdf(request, actor);
if (first.result.status !== 'CANDIDATE_VERTICAL_VERIFIED') {
  throw new Error(`FIRST_LOOP_FAILED:${JSON.stringify(first.result.workItem)}`);
}
const second = await workItems.parsePdf(request, actor);
const page = await vertical.page(
  { workItemId: first.result.workItem.workItemId, query: 'software' },
  actor,
);
const failureVertical = new CanonicalHostVerticalService(
  new LocalProjectionRegistrar(),
  {
    producePdf: async () => ({
      kind: 'FAILURE_SIGNAL',
      failureCode: 'PDF_PRODUCER_PROFILE_NOT_AVAILABLE',
      message: 'No activated producer profile.',
      executionRoute: 'ordinary-local-explicit-failure',
    }),
  },
  new OrdinaryCanonicalAuthorizationAdapter(),
  new OrdinaryCanonicalPermissionSnapshotAdapter(),
  artifactStore,
  reader,
  entry,
  failureRecorder,
);
const failure = await failureVertical.runPdf(
  {
    schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
    workItemId: 'WI-LOCAL-FTD-FAILURE',
    requestId: 'REQ-LOCAL-FTD-FAILURE',
    source: structuredClone(first.result.workItem.source),
    classification: structuredClone(first.result.workItem.classification),
    query: 'software',
  },
  actor,
);

assert.equal(first.workItemCreated, true);
assert.equal(second.workItemReused, true);
assert.equal(first.result.status, 'CANDIDATE_VERTICAL_VERIFIED');
assert.equal(second.result.workItem.workItemId, first.result.workItem.workItemId);
assert.equal(registrar.producerStateTransitions, 2);
assert.equal(first.result.workItem.source.documentVersionId, 'document_version_fd88dcb9cf64cf3ba21033ef');
assert.equal(
  first.result.workItem.package.packageId,
  'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
);
assert.equal(first.result.workItem.package.contentUnitCount, 311);
assert.equal(first.result.workItem.package.sourceRefCount, 239);
assert.ok(page.queryResults.length > 0);
assert.ok(page.queryResults.every((item) => item.sourceRefIds.length > 0));
assert.equal(failure.status, 'FAILED');
assert.equal(failure.workItem.failure.failureCode, 'PRODUCER_UNSUPPORTED');
assert.equal(failure.workItem.failure.adapterReceipt.actualByteReadbackVerified, true);
await artifactStore.readActualBytes(failure.workItem.failure.artifact);
assert.equal(first.result.authority.onlineWritePerformed, false);
assert.equal(fileService.removeCalls.length, 0);
if (residualProof) {
  assert.equal(residualProof.immutableUploadsBeforeRecovery, 1);
  assert.equal(
    fileService.uploadCalls.filter(
      (call) => call.options.filePath === residualProof.sourceFilePath.replace(/^\//u, ''),
    ).length,
    1,
  );
}

process.stdout.write(`${JSON.stringify({
  status: 'ORDINARY_FIRST_FTD_LOOP_PASS',
  source: {
    path: pdfPath,
    byteLength: pdfBytes.byteLength,
    documentVersionId: first.result.workItem.source.documentVersionId,
  },
  workItem: {
    workItemId: first.result.workItem.workItemId,
    firstCreated: first.workItemCreated,
    repeatReused: second.workItemReused,
    phase: first.result.workItem.phase,
    revision: first.result.workItem.revision,
  },
  package: {
    packageId: first.result.workItem.package.packageId,
    artifact: first.result.workItem.package.artifact,
    contentUnitCount: first.result.workItem.package.contentUnitCount,
    sourceRefCount: first.result.workItem.package.sourceRefCount,
    fullValidator: first.result.workItem.package.fullValidatorProof,
  },
  query: {
    text: 'software',
    resultCount: page.queryResults.length,
    allSourceBound: page.queryResults.every((item) => item.sourceRefIds.length > 0),
  },
  explicitFailure: {
    status: failure.status,
    phase: failure.workItem.phase,
    failureCode: failure.workItem.failure.failureCode,
    artifact: failure.workItem.failure.artifact,
    strictValidator:
      failure.workItem.failure.adapterReceipt.strictValidation.status,
  },
  fileService: {
    uploads: fileService.uploadCalls.length,
    deletes: fileService.removeCalls.length,
  },
  onlineWrites: 0,
  residualRecovery: residualProof,
}, null, 2)}\n`);
