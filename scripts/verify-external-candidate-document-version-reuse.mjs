import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, '../../../..');
const ownerRoot = resolve(
  root,
  '../../../../../../CodexHome/worktrees/d415/WiseLink/private/runtime/miaoda-app-repos/document-management-app-q2d',
);
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

class LocalReservationRepository {
  reservation = null;
  async reserve(input) {
    if (!this.reservation) {
      this.reservation = {
        workItemId: 'WI-LOCAL-EXTERNAL-CANDIDATE-FTD',
        requestId: 'REQ-LOCAL-EXTERNAL-CANDIDATE-FTD',
        attemptId: 'ATT-LOCAL-EXTERNAL-CANDIDATE-FTD',
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
  { DocumentManagementHostedCore },
  { MiaodaFileServiceArtifactStore },
  { classifyImmutableSourceReuseState },
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
  { InMemoryHostedDocumentCatalog },
  { LocalMiaodaFileServiceDouble },
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
  import(pathToFileURL(resolve(ownerRoot, 'src/hosted/inMemoryHostedDocumentCatalog.js'))),
  import(pathToFileURL(resolve(ownerRoot, 'src/hosted/testing/localFileServiceDouble.js'))),
]);

const pdfPath = resolve(
  sourceRoot,
  'Docs/uploads/FTD/777-FTD-31-21002_Doc_09262025.pdf',
);
const pdfBytes = await readFile(pdfPath);
const fileService = new LocalMiaodaFileServiceDouble();
const selection = {
  bucketId: 'local-reviewed-external-materials',
  filePath: '/reviewed/777-FTD-31-21002_Doc_09262025.pdf',
};
fileService.seed({
  ...selection,
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

const authorizationCalls = [];
const core = new DocumentManagementHostedCore({
  artifactStore: new MiaodaFileServiceArtifactStore(fileService),
  catalog,
  authorizer: {
    async assertCanIngest(context) {
      authorizationCalls.push(structuredClone(context));
      assert.equal(context.actorUserId, 'local-reviewer');
      assert.equal(context.tenantId, 'local-tenant');
      assert.equal(context.action, 'DOCUMENT_INGEST');
    },
  },
  now: () => '2026-08-14T10:00:00.000Z',
});

const serverContext = {
  actorUserId: 'local-reviewer',
  tenantId: 'local-tenant',
  roles: ['document-reviewer'],
};
const liveDiscoveryOnly = JSON.parse(
  await readFile(
    resolve(root, 'test/fixtures/openclaw-first-oem-discovery-only.json'),
    'utf8',
  ),
);
const descriptor = {
  originalFilename: '777-FTD-31-21002_Doc_09262025.pdf',
  documentCode: '777-FTD-31-21002',
  documentFamily: 'FTD',
  issuer: 'BOEING',
  businessRevision: '2025-09-26',
  revisionDate: '2025-09-26',
  sourceGeneratedDate: '2025-09-26',
  externalDiscovery: {
    discoverySystem: 'FEISHU_HOSTED_OPENCLAW',
    publisher: 'BOEING',
    searchRunRef: 'openclaw-local-fixture:boeing-ftd-search:001',
    candidateRef: 'openclaw-local-fixture:boeing-ftd-search:001:result:001',
    query: '777 FTD 31-21002',
    disposition: 'HUMAN_SELECTED_FOR_INGEST',
    sourceLocator: 'LOCAL_REAL_FTD_FIXTURE',
  },
};

const existingCanonicalVersion = await core.ingestFileServiceSelection({
  sourceChannel: 'canonical_miaoda_document_selection',
  sourceRef: `miaoda-file-service:${selection.bucketId}:${selection.filePath}`,
  selection,
  descriptor: {},
  idempotencyKey: 'existing-hosted-first-ftd-version',
}, serverContext);
assert.equal(
  existingCanonicalVersion.documentVersionId,
  'document_version_fd88dcb9cf64cf3ba21033ef',
);
const beforeDiscovery = catalog.snapshot();
const fileOperationsBeforeDiscovery = fileService.operationCount;
const authorizationCallsBeforeDiscovery = authorizationCalls.length;
assert.equal(
  liveDiscoveryOnly.resultStatus,
  'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
);
assert.equal(liveDiscoveryOnly.directTargetMatchCount, 0);
assert.ok(
  liveDiscoveryOnly.candidates.every(
    (candidate) =>
      candidate.publisher === 'BOEING' &&
      candidate.disposition === 'TANGENTIAL_NO_DIRECT_MATCH',
  ),
);
assert.deepEqual(catalog.snapshot(), beforeDiscovery);
assert.equal(fileService.operationCount, fileOperationsBeforeDiscovery);
assert.equal(authorizationCalls.length, authorizationCallsBeforeDiscovery);

const firstConfirmedCandidate = await core.ingestFileServiceSelection({
  sourceChannel: 'openclaw_external_discovery_review',
  sourceRef: descriptor.externalDiscovery.candidateRef,
  selection,
  descriptor,
  idempotencyKey: 'external-review:first-confirmation',
}, serverContext);

const documentManagement = {
  ingestFileServiceSelection: (request, context) =>
    core.ingestFileServiceSelection(request, context),
};
const resolver = {
  async resolve(documentVersionId) {
    const version = await catalog.readDocumentVersion(documentVersionId);
    assert.ok(version);
    const family = await catalog.readFamily(version.familyId);
    const artifact = catalog
      .snapshot()
      .sourceArtifacts.find(
        (item) => item.sourceArtifactId === version.sourceArtifactId,
      );
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
  validatorRevision: 'canonical-host-external-candidate-local-real',
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
const entry = new CanonicalEntryFacadeService(
  new OrdinaryMiaodaAppBindingAdapter(),
);
const failureRecorder = new CanonicalFailureRecordingService(
  new U0Frozen2FailureAdapterService(validator),
  new OrdinaryFailureValidationWriteAuthorizationAdapter(),
  artifactStore,
  { nowIso: () => '2026-08-14T10:00:00.000Z' },
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
  userId: serverContext.actorUserId,
  tenantId: serverContext.tenantId,
  appId: 'app_17bzc551rsg',
  roles: [...serverContext.roles],
  env: 'local',
};
const firstWorkItem = await workItems.parsePdf(
  {
    documentVersionId: firstConfirmedCandidate.documentVersionId,
    query: 'software',
  },
  actor,
);
if (firstWorkItem.result.status !== 'CANDIDATE_VERTICAL_VERIFIED') {
  throw new Error(
    `EXTERNAL_CANDIDATE_VERTICAL_FAILED:${JSON.stringify(firstWorkItem.result.workItem)}`,
  );
}
const repeatedWorkItem = await workItems.parsePdf(
  {
    documentVersionId: firstConfirmedCandidate.documentVersionId,
    query: 'software',
  },
  actor,
);
const page = await vertical.page(
  {
    workItemId: firstWorkItem.result.workItem.workItemId,
    query: 'software',
  },
  actor,
);

const repeatMonitorResult = await core.ingestFileServiceSelection({
  sourceChannel: 'openclaw_external_monitor_review',
  sourceRef: 'openclaw-local-fixture:boeing-ftd-monitor:002:result:001',
  selection,
  descriptor: {
    ...descriptor,
    externalDiscovery: {
      ...descriptor.externalDiscovery,
      searchRunRef: 'openclaw-local-fixture:boeing-ftd-monitor:002',
      candidateRef: 'openclaw-local-fixture:boeing-ftd-monitor:002:result:001',
    },
  },
  idempotencyKey: 'external-review:repeat-monitor-confirmation',
}, serverContext);

const ioBeforeReplay = fileService.operationCount;
const replay = await core.ingestFileServiceSelection({
  sourceChannel: 'openclaw_external_monitor_review',
  sourceRef: 'openclaw-local-fixture:boeing-ftd-monitor:002:result:001',
  selection,
  descriptor,
  idempotencyKey: 'external-review:repeat-monitor-confirmation',
}, serverContext);
const snapshot = catalog.snapshot();

assert.equal(firstConfirmedCandidate.newDocumentVersionCreated, false);
assert.equal(firstConfirmedCandidate.decision, 'RESUME_EXISTING_PROCESS');
assert.equal(
  firstConfirmedCandidate.documentVersionId,
  existingCanonicalVersion.documentVersionId,
);
assert.equal(repeatMonitorResult.newDocumentVersionCreated, false);
assert.equal(
  repeatMonitorResult.documentVersionId,
  firstConfirmedCandidate.documentVersionId,
);
assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
assert.equal(fileService.operationCount, ioBeforeReplay);
assert.equal(snapshot.sourceArtifacts.length, 1);
assert.equal(snapshot.acquisitions.length, 3);
assert.equal(snapshot.publicationFamilies.length, 1);
assert.equal(snapshot.documents.length, 1);
assert.equal(snapshot.documentVersions.length, 1);
assert.equal(snapshot.currentnessDecisions.length, 1);
assert.equal(fileService.removeCalls.length, 0);
assert.equal(authorizationCalls.length, 4);
assert.equal(firstWorkItem.workItemCreated, true);
assert.equal(repeatedWorkItem.workItemReused, true);
assert.equal(
  repeatedWorkItem.result.workItem.workItemId,
  firstWorkItem.result.workItem.workItemId,
);
assert.equal(
  firstWorkItem.result.workItem.source.documentVersionId,
  firstConfirmedCandidate.documentVersionId,
);
assert.equal(
  firstWorkItem.result.workItem.package.packageId,
  'urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622',
);
assert.equal(firstWorkItem.result.workItem.package.contentUnitCount, 311);
assert.equal(firstWorkItem.result.workItem.package.sourceRefCount, 239);
assert.equal(registrar.producerStateTransitions, 2);
assert.ok(page.queryResults.length > 0);
assert.ok(page.queryResults.every((item) => item.sourceRefIds.length > 0));

const firstAcquisition = snapshot.acquisitions.find(
  (row) => row.idempotencyKey === 'external-review:first-confirmation',
);
const repeatAcquisition = snapshot.acquisitions.find(
  (row) => row.idempotencyKey === 'external-review:repeat-monitor-confirmation',
);
assert.equal(firstAcquisition.sourceChannel, 'openclaw_external_discovery_review');
assert.equal(firstAcquisition.sourceRef, descriptor.externalDiscovery.candidateRef);
assert.deepEqual(firstAcquisition.sourceDescriptor.externalDiscovery, descriptor.externalDiscovery);
assert.equal(
  repeatAcquisition.documentVersionId,
  firstConfirmedCandidate.documentVersionId,
);
assert.equal(
  repeatAcquisition.sourceDescriptor.externalDiscovery.searchRunRef,
  'openclaw-local-fixture:boeing-ftd-monitor:002',
);
const sourceArtifactPath = snapshot.sourceArtifacts[0].filePath.replace(
  /^\//u,
  '',
);
const sourceUploadCount = fileService.uploadCalls.filter(
  (call) => call.options.filePath === sourceArtifactPath,
).length;
assert.equal(sourceUploadCount, 1);

process.stdout.write(`${JSON.stringify({
  status: 'EXTERNAL_CANDIDATE_TO_READER_LOOP_PASS',
  acceptancePassed: true,
  onlineMutationPerformed: false,
  liveDiscoveryCatalogIo: 0,
  existingCatalogBeforeDiscovery: {
    sourceArtifacts: beforeDiscovery.sourceArtifacts.length,
    acquisitions: beforeDiscovery.acquisitions.length,
    documents: beforeDiscovery.documents.length,
    documentVersions: beforeDiscovery.documentVersions.length,
  },
  liveDiscoveryOnly,
  realSource: {
    path: pdfPath,
    byteLength: pdfBytes.byteLength,
  },
  firstConfirmedCandidate: {
    decision: firstConfirmedCandidate.decision,
    documentVersionId: firstConfirmedCandidate.documentVersionId,
    sourceChannel: firstAcquisition.sourceChannel,
    sourceRef: firstAcquisition.sourceRef,
    discovery: firstAcquisition.sourceDescriptor.externalDiscovery,
  },
  workItem: {
    workItemId: firstWorkItem.result.workItem.workItemId,
    firstCreated: firstWorkItem.workItemCreated,
    repeatReused: repeatedWorkItem.workItemReused,
    documentVersionId: firstWorkItem.result.workItem.source.documentVersionId,
    phase: firstWorkItem.result.workItem.phase,
  },
  parsedPackage: {
    packageId: firstWorkItem.result.workItem.package.packageId,
    artifact: firstWorkItem.result.workItem.package.artifact,
    contentUnitCount: firstWorkItem.result.workItem.package.contentUnitCount,
    sourceRefCount: firstWorkItem.result.workItem.package.sourceRefCount,
    fullValidator: firstWorkItem.result.workItem.package.fullValidatorProof,
  },
  reader: {
    query: 'software',
    resultCount: page.queryResults.length,
    allSourceBound: page.queryResults.every(
      (item) => item.sourceRefIds.length > 0,
    ),
  },
  repeatedMonitorCandidate: {
    decision: repeatMonitorResult.decision,
    documentVersionId: repeatMonitorResult.documentVersionId,
    reusedExistingDocumentVersion: true,
    searchRunRef: repeatAcquisition.sourceDescriptor.externalDiscovery.searchRunRef,
  },
  idempotentReplayPerformedIo: false,
  counts: {
    sourceArtifacts: snapshot.sourceArtifacts.length,
    acquisitions: snapshot.acquisitions.length,
    documents: snapshot.documents.length,
    documentVersions: snapshot.documentVersions.length,
    currentnessDecisions: snapshot.currentnessDecisions.length,
    immutableSourceUploads: sourceUploadCount,
    packageArtifactUploads: fileService.uploadCalls.length - sourceUploadCount,
    deletes: fileService.removeCalls.length,
  },
}, null, 2)}\n`);
