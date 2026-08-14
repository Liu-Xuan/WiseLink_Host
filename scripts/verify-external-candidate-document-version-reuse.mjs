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

const [
  { DocumentManagementHostedCore },
  { MiaodaFileServiceArtifactStore },
  { classifyImmutableSourceReuseState },
  { InMemoryHostedDocumentCatalog },
  { LocalMiaodaFileServiceDouble },
] = await Promise.all([
  importBuilt('modules/document-management/src/hosted/documentManagementHostedCore.js'),
  importBuilt('modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js'),
  importBuilt('modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js'),
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

const beforeConfirmation = catalog.snapshot();
assert.equal(beforeConfirmation.sourceArtifacts.length, 0);
assert.equal(beforeConfirmation.acquisitions.length, 0);
assert.equal(beforeConfirmation.documentVersions.length, 0);

const first = await core.ingestFileServiceSelection({
  sourceChannel: 'openclaw_external_discovery_review',
  sourceRef: descriptor.externalDiscovery.candidateRef,
  selection,
  descriptor,
  idempotencyKey: 'external-review:first-confirmation',
}, serverContext);

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

assert.equal(first.newDocumentVersionCreated, true);
assert.equal(first.catalogFreshReadVerified, true);
assert.equal(repeatMonitorResult.newDocumentVersionCreated, false);
assert.equal(repeatMonitorResult.documentVersionId, first.documentVersionId);
assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
assert.equal(fileService.operationCount, ioBeforeReplay);
assert.equal(snapshot.sourceArtifacts.length, 1);
assert.equal(snapshot.acquisitions.length, 2);
assert.equal(snapshot.publicationFamilies.length, 1);
assert.equal(snapshot.documents.length, 1);
assert.equal(snapshot.documentVersions.length, 1);
assert.equal(snapshot.currentnessDecisions.length, 1);
assert.equal(fileService.uploadCalls.length, 1);
assert.equal(fileService.removeCalls.length, 0);
assert.equal(authorizationCalls.length, 3);

const firstAcquisition = snapshot.acquisitions.find(
  (row) => row.idempotencyKey === 'external-review:first-confirmation',
);
const repeatAcquisition = snapshot.acquisitions.find(
  (row) => row.idempotencyKey === 'external-review:repeat-monitor-confirmation',
);
assert.equal(firstAcquisition.sourceChannel, 'openclaw_external_discovery_review');
assert.equal(firstAcquisition.sourceRef, descriptor.externalDiscovery.candidateRef);
assert.deepEqual(firstAcquisition.sourceDescriptor.externalDiscovery, descriptor.externalDiscovery);
assert.equal(repeatAcquisition.documentVersionId, first.documentVersionId);
assert.equal(
  repeatAcquisition.sourceDescriptor.externalDiscovery.searchRunRef,
  'openclaw-local-fixture:boeing-ftd-monitor:002',
);

process.stdout.write(`${JSON.stringify({
  acceptancePassed: true,
  onlineMutationPerformed: false,
  preConfirmationCatalogRows: 0,
  realSource: {
    path: pdfPath,
    byteLength: pdfBytes.byteLength,
  },
  firstConfirmedCandidate: {
    decision: first.decision,
    documentVersionId: first.documentVersionId,
    sourceChannel: firstAcquisition.sourceChannel,
    sourceRef: firstAcquisition.sourceRef,
    discovery: firstAcquisition.sourceDescriptor.externalDiscovery,
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
    immutableUploads: fileService.uploadCalls.length,
    deletes: fileService.removeCalls.length,
  },
}, null, 2)}\n`);
