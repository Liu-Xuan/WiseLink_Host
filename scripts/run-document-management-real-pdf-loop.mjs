import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ingestActualPdfThroughHostedCore,
  InMemoryHostedDocumentCatalog,
  LocalMiaodaFileServiceDouble,
  resolveRealFtdFixturePath,
} from '../test/support/document-management-hosted-test-support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const newerPdfPath = await resolveRealFtdFixturePath({ repoRoot: root });
const firstPdfPath = resolve(
  dirname(newerPdfPath),
  '777-FTD-31-21002_Doc_07042025.pdf',
);
await access(firstPdfPath);
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));
const coreModulePath = resolve(
  root,
  'dist/server/modules/document-management/src/hosted/documentManagementHostedCore.js',
);
const storeModulePath = resolve(
  root,
  'dist/server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
);
const [
  { DocumentManagementHostedCore },
  { MiaodaFileServiceArtifactStore },
  { ExactFtdFrozen2PdfProducerAdapter },
  { MiaodaScopedProfessionalArtifactCorrelationAdapter },
  { MiaodaOrdinaryArtifactStoreAdapter },
  { Frozen2CandidateReaderService },
  { PythonU0FullPackageValidatorAdapter },
  { U0FullValidationService },
  { UnifiedReaderService },
] = await Promise.all([
  import(pathToFileURL(coreModulePath)),
  import(pathToFileURL(storeModulePath)),
  importBuilt(
    'modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter.js',
  ),
  importBuilt(
    'modules/canonical-host/scoped-professional-artifact-correlation.port.js',
  ),
  importBuilt(
    'modules/unified-reader/miaoda-ordinary-artifact-store.adapter.js',
  ),
  importBuilt('modules/unified-reader/frozen2-candidate-reader.service.js'),
  importBuilt(
    'modules/unified-reader/python-u0-full-package-validator.adapter.js',
  ),
  importBuilt('modules/unified-reader/u0-full-validation.service.js'),
  importBuilt('modules/unified-reader/unified-reader.service.js'),
]);
const [firstBytes, newerBytes] = await Promise.all([
  readFile(firstPdfPath),
  readFile(newerPdfPath),
]);
const fileService = new LocalMiaodaFileServiceDouble();
const selectionBucket = 'local-drive-like-selection';
const firstFilePath = '/selection/777-FTD-31-21002_Doc_07042025.pdf';
const newerFilePath = '/selection/777-FTD-31-21002_Doc_09262025.pdf';
const firstSha256 = createHash('sha256').update(firstBytes).digest('hex');
const newerSha256 = createHash('sha256').update(newerBytes).digest('hex');
const canonicalBucket = 'local-hosted-default';
const orphanFilePath = `/document-management/source/sha256/${firstSha256.slice(0, 2)}/${firstSha256}.pdf`;
fileService.seed({
  bucketId: canonicalBucket,
  filePath: orphanFilePath,
  bytes: firstBytes,
  fileName: `${firstSha256}.pdf`,
  metadataOverrides: {
    id: 'local-preexisting-content-addressed-object',
    updatedAt: '2026-08-14T03:20:24.629928515+08:00',
  },
});
fileService.overrideDownloadMetadata(canonicalBucket, orphanFilePath, {
  updatedAt: '2026-08-14T03:20:24.629929+08:00',
});
const catalog = new InMemoryHostedDocumentCatalog();
const authorizationCalls = [];
const actorUserId = 'local-hosted-registrar';
const tenantId = 'local-hosted-tenant';
const core = new DocumentManagementHostedCore({
  artifactStore: new MiaodaFileServiceArtifactStore(fileService),
  catalog,
  authorizer: {
    async assertCanIngest(context) {
      authorizationCalls.push(structuredClone(context));
      if (
        context.actorUserId !== actorUserId ||
        context.tenantId !== tenantId ||
        context.action !== 'DOCUMENT_INGEST'
      ) {
        throw Object.assign(new Error('Test provider denied ingress.'), {
          code: 'DOCUMENT_INGEST_FORBIDDEN',
        });
      }
    },
  },
  now: () => '2026-08-30T00:00:00.000Z',
});
const serverContext = {
  actorUserId,
  tenantId,
  roles: ['local-dev-registrar'],
};
const baseRequest = {
  sourceChannel: 'drive_like_local_selection',
  descriptor: {},
};
const ingest = (filePath, sourceRef, idempotencyKey) =>
  core.ingestFileServiceSelection(
    {
      ...baseRequest,
      selection: { bucketId: selectionBucket, filePath },
      sourceRef,
      idempotencyKey,
    },
    serverContext,
  );
const firstOwner = await ingestActualPdfThroughHostedCore({
  core,
  catalog,
  fileService,
  bytes: firstBytes,
  selection: { bucketId: selectionBucket, filePath: firstFilePath },
  fileName: '777-FTD-31-21002_Doc_07042025.pdf',
  sourceChannel: baseRequest.sourceChannel,
  sourceRef: `local:${firstFilePath}`,
  idempotencyKey: 'host-first',
  descriptor: baseRequest.descriptor,
  serverContext,
});
const first = firstOwner.ingested;
const orphanReuseProof = {
  filePath: orphanFilePath,
  providerObjectId: 'local-preexisting-content-addressed-object',
  uploadCountAfterFirstIngest: fileService.uploadCalls.length,
  deleteCountAfterFirstIngest: fileService.removeCalls.length,
};
const exact = await ingest(
  firstFilePath,
  `local:${firstFilePath}:repeat`,
  'host-exact-repeat',
);
const historicalBefore = await catalog.readDocumentVersion(
  first.documentVersionId,
);
const newerOwner = await ingestActualPdfThroughHostedCore({
  core,
  catalog,
  fileService,
  bytes: newerBytes,
  selection: { bucketId: selectionBucket, filePath: newerFilePath },
  fileName: '777-FTD-31-21002_Doc_09262025.pdf',
  sourceChannel: baseRequest.sourceChannel,
  sourceRef: `local:${newerFilePath}`,
  idempotencyKey: 'host-newer',
  descriptor: baseRequest.descriptor,
  serverContext,
});
const newer = newerOwner.ingested;
const ioCountBeforeReplay = fileService.operationCount;
const replay = await ingest(
  newerFilePath,
  `local:${newerFilePath}`,
  'host-newer',
);
const historicalAfter = await catalog.readDocumentVersion(
  first.documentVersionId,
);
const snapshot = catalog.snapshot();
const family = snapshot.publicationFamilies[0];
const dmImmutableUploadCalls = fileService.uploadCalls.length;
const dmDeleteCalls = fileService.removeCalls.length;

function accept(condition, message) {
  if (!condition) throw new Error(`HOST_DM_REAL_LOOP_FAILED:${message}`);
}
accept(first.decision === 'INGEST_NEW_FAMILY', 'first decision');
accept(
  orphanReuseProof.uploadCountAfterFirstIngest === 0,
  'orphan reuse performed a second upload',
);
accept(
  orphanReuseProof.deleteCountAfterFirstIngest === 0,
  'orphan reuse performed a delete',
);
accept(exact.decision === 'RESUME_EXISTING_PROCESS', 'exact decision');
accept(newer.decision === 'INGEST_NEW_REVISION', 'newer decision');
accept(replay.disposition === 'IDEMPOTENT_REPLAY', 'replay disposition');
accept(
  ioCountBeforeReplay === fileService.operationCount,
  'replay performed I/O',
);
accept(snapshot.sourceArtifacts.length === 2, 'source artifact count');
accept(snapshot.acquisitions.length === 3, 'acquisition count');
accept(snapshot.publicationFamilies.length === 1, 'family count');
accept(snapshot.documents.length === 1, 'document count');
accept(snapshot.documentVersions.length === 2, 'version count');
accept(snapshot.currentnessDecisions.length === 2, 'currentness count');
accept(family.currentGeneration === 2, 'family generation');
accept(
  family.currentDocumentVersionId === newer.documentVersionId,
  'family current version',
);
accept(
  JSON.stringify(historicalBefore) === JSON.stringify(historicalAfter),
  'historical overwrite',
);
accept(
  dmImmutableUploadCalls === 1 &&
    fileService.uploadCalls.every((call) => call.options.upsert === false),
  'immutable FileService writes',
);
accept(dmDeleteCalls === 0, 'FileService delete was invoked');
accept(authorizationCalls.length === 4, 'authorization call count');

const currentSource = await catalog.resolveDocumentVersionSource(
  newer.documentVersionId,
  { requireCurrent: true },
);
accept(
  currentSource.version.documentVersionId === newer.documentVersionId,
  'current DocumentVersion resolution',
);
accept(
  currentSource.artifact.sourceArtifactId === newer.sourceArtifactId,
  'current SourceArtifact resolution',
);
accept(
  currentSource.artifact.sha256 === newerSha256,
  'current SourceArtifact SHA',
);
accept(
  currentSource.artifact.byteLength === newerBytes.byteLength,
  'current SourceArtifact byte length',
);
accept(
  currentSource.family.currentDocumentVersionId === newer.documentVersionId,
  'current family head resolution',
);

const validator = new U0FullValidationService(
  new PythonU0FullPackageValidatorAdapter({
    pythonExecutable:
      process.env.WL31_U0_PYTHON?.trim() ||
      process.env.WL_LOCAL_U0_PYTHON?.trim() ||
      'python3',
    contractRoot: resolve(
      root,
      'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
    ),
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
    validatorRevision: 'document-management-real-pdf-loop',
  }),
);
const producer = new ExactFtdFrozen2PdfProducerAdapter(
  fileService,
  {
    resolve: (documentVersionId, options) =>
      catalog.resolveDocumentVersionSource(documentVersionId, options),
  },
  validator,
  new MiaodaScopedProfessionalArtifactCorrelationAdapter(fileService),
);
const workItemId = 'WI-DM-REAL-FTD-OWNER-CHAIN';
const requestId = 'REQ-DM-REAL-FTD-OWNER-CHAIN';
const producerRequest = {
  schemaVersion: 'wiselink.3_1.canonical_pdf_vertical_request.v0.candidate',
  workItemId,
  requestId,
  source: {
    documentId: newer.documentId,
    documentVersionId: newer.documentVersionId,
    parserRequestId: 'parser-request-dm-real-ftd-owner-chain',
    sourceArtifactId: newer.sourceArtifactId,
    sourceFileSha256: `sha256:${newerSha256}`,
    sourceByteLength: newerBytes.byteLength,
    driveFileToken: 'local-fileservice-selection',
    driveSourceVersion: currentSource.artifact.providerVersionId,
  },
  classification: {
    status: 'CONFIRMED',
    normalizedFamily: 'FTD',
    classifierReleaseId: 'local-dm-real-ftd-classification',
    classifierReleaseHash:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    parserProfileId: 'parser-profile:boeing.ftd.v1@1.0.0',
    parserProfileHash:
      'sha256:c47a7388da23d106c2476b579308c458332127153930ced8c684212f1b431731',
    fingerprint:
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
  query: 'AIMS-2',
};
const firstProduced = await producer.producePdf(producerRequest);
const secondProduced = await producer.producePdf(producerRequest);
accept(firstProduced.kind === 'PACKAGE', 'professional producer result');
accept(
  secondProduced.kind === 'PACKAGE',
  'professional producer replay result',
);
accept(
  firstProduced.packageId === secondProduced.packageId,
  'packageId determinism',
);
accept(
  Buffer.from(firstProduced.bytes).equals(Buffer.from(secondProduced.bytes)),
  'professional package byte determinism',
);
const packageBytes = Uint8Array.from(firstProduced.bytes);
const packageSha256 = createHash('sha256').update(packageBytes).digest('hex');
const parsedPackage = JSON.parse(Buffer.from(packageBytes).toString('utf8'));
accept(
  parsedPackage.packageId === firstProduced.packageId,
  'package JSON identity',
);
accept(
  parsedPackage.source.sourcePackageHash === `sha256:${newerSha256}`,
  'package source SHA binding',
);
accept(parsedPackage.sourceRefs.length === 197, 'package sourceRef count');
accept(parsedPackage.contentUnits.length === 196, 'package contentUnit count');
accept(
  parsedPackage.document.documentType.value === 'service_bulletin',
  'FTD documentType evidence',
);

const professionalPathPrefix = [
  'canonical-host',
  'professional-artifacts',
  encodeURIComponent(workItemId),
  encodeURIComponent(newer.documentVersionId),
].join('/');
const professionalFile = fileService
  .listFiles()
  .find(({ metadata }) =>
    metadata.filePath.replace(/^\/+/, '').startsWith(professionalPathPrefix),
  );
accept(Boolean(professionalFile), 'professional FileService artifact');
accept(
  createHash('sha256').update(professionalFile.bytes).digest('hex') ===
    packageSha256,
  'professional actual-byte SHA',
);

const artifactStore = new MiaodaOrdinaryArtifactStoreAdapter(fileService);
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
const readerReadback = await reader.persistAndReadback(packageBytes, {
  workItemId,
  requestId,
  documentVersionId: newer.documentVersionId,
  permissionSnapshotVersion: 'local-dm-real-ftd-permission-snapshot',
  packageId: firstProduced.packageId,
  contractId: firstProduced.contractId,
  contractRevision: firstProduced.contractRevision,
  query: 'AIMS-2',
});
const allSourceUnits = await reader.readAllSourceUnits({
  artifact: readerReadback.artifact,
  packageId: firstProduced.packageId,
});
accept(
  readerReadback.status === 'CANDIDATE_READBACK_VERIFIED',
  'Reader readback status',
);
accept(
  readerReadback.documentVersionId === newer.documentVersionId,
  'Reader DocumentVersion binding',
);
accept(
  readerReadback.package.packageId === firstProduced.packageId,
  'Reader package binding',
);
accept(
  readerReadback.package.contentUnitCount === 196,
  'Reader contentUnit count',
);
accept(readerReadback.package.sourceRefCount === 197, 'Reader sourceRef count');
accept(readerReadback.queryResults.length > 0, 'Reader bounded query results');
accept(
  readerReadback.queryResults.every((entry) => entry.sourceRefIds.length > 0),
  'Reader query SourceRef binding',
);
accept(allSourceUnits.length === 196, 'Reader browse all source units');
accept(
  allSourceUnits.every((entry) => entry.sourceRefIds.length > 0),
  'Reader browse SourceRef binding',
);
accept(
  fileService.removeCalls.length === 0,
  'FileService delete was invoked after owner chain',
);

const unifiedFile = fileService
  .listFiles()
  .find(
    ({ metadata }) =>
      metadata.filePath.replace(/^\/+/, '') ===
      `unified-parsed-packages/sha256/${packageSha256}.json`,
  );
accept(Boolean(unifiedFile), 'Unified Reader FileService artifact');
accept(
  createHash('sha256').update(unifiedFile.bytes).digest('hex') ===
    packageSha256,
  'Unified Reader actual-byte SHA',
);

process.stdout.write(
  `${JSON.stringify(
    {
      acceptancePassed: true,
      onlineMutationPerformed: false,
      sourcePdfs: [firstPdfPath, newerPdfPath],
      sourceSha256: [firstSha256, newerSha256],
      documentManagement: {
        decisions: [first, exact, newer, replay].map((entry) => ({
          decision: entry.decision,
          disposition: entry.disposition,
          documentVersionId: entry.documentVersionId,
          currentnessChanged: entry.currentnessChanged,
          immutableReadbackVerified: entry.immutableReadbackVerified,
        })),
        counts: {
          sourceArtifacts: snapshot.sourceArtifacts.length,
          acquisitions: snapshot.acquisitions.length,
          publicationFamilies: snapshot.publicationFamilies.length,
          documents: snapshot.documents.length,
          documentVersions: snapshot.documentVersions.length,
          currentnessDecisions: snapshot.currentnessDecisions.length,
          immutableSourceUploads: dmImmutableUploadCalls,
          deletes: dmDeleteCalls,
        },
        orphanReuseProof,
        family,
        versions: snapshot.documentVersions,
        documentVersionImmutableProof: true,
        serverBoundAuthorizationCalls: authorizationCalls.length,
      },
      ownerChain: {
        source: {
          sourceArtifactId: newer.sourceArtifactId,
          documentId: newer.documentId,
          documentVersionId: newer.documentVersionId,
          currentGeneration: family.currentGeneration,
          sha256: newerSha256,
          byteLength: newerBytes.byteLength,
          providerObjectId: currentSource.artifact.providerObjectId,
        },
        professionalInput: {
          parserProfileId: producerRequest.classification.parserProfileId,
          packageId: firstProduced.packageId,
          packageArtifactSha256: packageSha256,
          packageByteLength: packageBytes.byteLength,
          contentUnitCount: parsedPackage.contentUnits.length,
          sourceRefCount: parsedPackage.sourceRefs.length,
          documentType: parsedPackage.document.documentType.value,
          providerObjectId: professionalFile.metadata.id,
          filePath: professionalFile.metadata.filePath,
          deterministicReplay: true,
          fullU0Status: readerReadback.fullValidatorProof.status,
          contractCommit: readerReadback.fullValidatorProof.contractCommit,
        },
        reader: {
          status: readerReadback.status,
          documentVersionId: readerReadback.documentVersionId,
          packageId: readerReadback.package.packageId,
          artifactRef: readerReadback.artifact.ref,
          artifactSha256: readerReadback.artifact.sha256,
          readerReceiptId: readerReadback.receipt.readerReceiptId,
          browseUnitCount: allSourceUnits.length,
          query: 'AIMS-2',
          queryResultCount: readerReadback.queryResults.length,
          allResultsSourceBound: true,
        },
      },
      nonclaims: {
        postgresCatalogTransactionExercised: false,
        hostedFileServiceProviderExercised: false,
        cloudOrModelCallPerformed: false,
        ocrRequiredOrExercised: false,
      },
      localSupportOwner:
        'test/support/document-management-hosted-test-support.mjs',
      executedFromHostBuild: true,
    },
    null,
    2,
  )}\n`,
);
