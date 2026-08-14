import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(root, '../../../..');
const firstPdfPath = resolve(
  sourceRoot,
  'Docs/uploads/FTD/777-FTD-31-21002_Doc_07042025.pdf',
);
const newerPdfPath = resolve(
  sourceRoot,
  'Docs/uploads/FTD/777-FTD-31-21002_Doc_09262025.pdf',
);
const coreModulePath = resolve(
  root,
  'dist/server/modules/document-management/src/hosted/documentManagementHostedCore.js',
);
const storeModulePath = resolve(
  root,
  'dist/server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
);
const ownerRoot = resolve(
  root,
  '../../../../../../CodexHome/worktrees/d415/WiseLink/private/runtime/miaoda-app-repos/document-management-app-q2d',
);
const [{ DocumentManagementHostedCore }, { MiaodaFileServiceArtifactStore }] =
  await Promise.all([
    import(pathToFileURL(coreModulePath)),
    import(pathToFileURL(storeModulePath)),
  ]);
const [{ InMemoryHostedDocumentCatalog }, { LocalMiaodaFileServiceDouble }] =
  await Promise.all([
    import(
      pathToFileURL(
        resolve(ownerRoot, 'src/hosted/inMemoryHostedDocumentCatalog.js'),
      )
    ),
    import(
      pathToFileURL(
        resolve(ownerRoot, 'src/hosted/testing/localFileServiceDouble.js'),
      )
    ),
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
const canonicalBucket = 'local-hosted-default';
const orphanFilePath =
  `/document-management/source/sha256/${firstSha256.slice(0, 2)}/${firstSha256}.pdf`;
fileService.seed({
  bucketId: selectionBucket,
  filePath: firstFilePath,
  bytes: firstBytes,
  fileName: '777-FTD-31-21002_Doc_07042025.pdf',
});
fileService.seed({
  bucketId: selectionBucket,
  filePath: newerFilePath,
  bytes: newerBytes,
  fileName: '777-FTD-31-21002_Doc_09262025.pdf',
});
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
const first = await ingest(firstFilePath, `local:${firstFilePath}`, 'host-first');
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
const historicalBefore = await catalog.readDocumentVersion(first.documentVersionId);
const newer = await ingest(newerFilePath, `local:${newerFilePath}`, 'host-newer');
const ioCountBeforeReplay = fileService.operationCount;
const replay = await ingest(newerFilePath, `local:${newerFilePath}`, 'host-newer');
const historicalAfter = await catalog.readDocumentVersion(first.documentVersionId);
const snapshot = catalog.snapshot();
const family = snapshot.publicationFamilies[0];

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
accept(ioCountBeforeReplay === fileService.operationCount, 'replay performed I/O');
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
  fileService.uploadCalls.length === 1 &&
    fileService.uploadCalls.every((call) => call.options.upsert === false),
  'immutable FileService writes',
);
accept(fileService.removeCalls.length === 0, 'FileService delete was invoked');
accept(authorizationCalls.length === 4, 'authorization call count');

const result = {
  acceptancePassed: true,
  onlineMutationPerformed: false,
  sourcePdfs: [firstPdfPath, newerPdfPath],
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
    fileServiceImmutableUploads: fileService.uploadCalls.length,
    fileServiceDeletes: fileService.removeCalls.length,
  },
  orphanReuseProof,
  family,
  versions: snapshot.documentVersions,
  documentVersionImmutableProof: true,
  serverBoundAuthorizationCalls: authorizationCalls.length,
};
const sourceSha256 = await Promise.all(
  [firstPdfPath, newerPdfPath].map(async (path) =>
    createHash('sha256').update(await readFile(path)).digest('hex'),
  ),
);

process.stdout.write(`${JSON.stringify({
  ...result,
  sourceSha256,
  sourceOwnerCommit: '3ebc61c0532c5ee04122a251464fc644d1238439',
  executedFromHostBuild: true,
}, null, 2)}\n`);
