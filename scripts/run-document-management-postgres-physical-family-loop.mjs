import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { PhysicalFileService } from './support/physical-file-service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uploadRoot = '/Volumes/SSD/LLM/WiseLink/Docs/uploads';
const expectedBaseCommit = 'a68daa396f92e0850992f7d1fd3b40db7f130202';
const databaseUrl = requiredEnvironment('WL31_DM_FAMILY_TEST_DATABASE_URL');
const archiveRoot = resolve(requiredEnvironment('WL31_DM_FAMILY_ARCHIVE_ROOT'));
const bucketId = 'wiselink-integration-default';
const actorUserId = 'integration-document-registrar';
const tenantA = 'integration-tenant-a';
const tenantB = 'integration-tenant-b';

const samples = [
  {
    key: 'ftd-old',
    token: '11111111-1111-4111-8111-111111111111',
    relativePath: 'FTD/777-FTD-31-21002_Doc_07042025.pdf',
    issuer: 'BOEING',
    family: 'FTD',
    documentNumber: '777-FTD-31-21002',
    sourceGeneratedDate: '2025-07-04',
    pageCount: 5,
  },
  {
    key: 'ftd-new',
    token: '22222222-2222-4222-8222-222222222222',
    relativePath: 'FTD/777-FTD-31-21002_Doc_09262025.pdf',
    issuer: 'BOEING',
    family: 'FTD',
    documentNumber: '777-FTD-31-21002',
    sourceGeneratedDate: '2025-09-26',
    pageCount: 5,
  },
  {
    key: 'faa-ad',
    token: '33333333-3333-4333-8333-333333333333',
    relativePath: 'AD/AD2011-03-14/AD2011-03-14.pdf',
    issuer: 'FAA',
    family: 'AD',
    documentNumber: 'AD-2011-03-14',
    businessRevision: 'ORIGINAL ISSUE',
    revisionDate: '2011-03-14',
    pageCount: 10,
  },
  {
    key: 'boeing-sl',
    token: '44444444-4444-4444-8444-444444444444',
    relativePath: 'SL-777-45-006.pdf',
    issuer: 'BOEING',
    family: 'SL',
    documentNumber: '777-SL-45-006',
    businessRevision: 'ORIGINAL ISSUE',
    revisionDate: '2013-11-25',
    pageCount: 11,
  },
  {
    key: 'boeing-sb',
    token: '55555555-5555-4555-8555-555555555555',
    relativePath: 'SB-777-31-0293-01_17A.1.pdf',
    issuer: 'BOEING',
    family: 'SB',
    documentNumber: '777-31-0293',
    businessRevision: 'R1',
    revisionDate: '2018-07-31',
    pageCount: 60,
  },
  {
    key: 'airbus-sb',
    token: '66666666-6666-4666-8666-666666666666',
    relativePath: 'SB/机身/AIRBUS/2026/202603/A330-34-3478 R00.pdf',
    issuer: 'AIRBUS',
    family: 'SB',
    documentNumber: 'A330-34-3478',
    businessRevision: 'R0',
    revisionDate: '2026-03-04',
    pageCount: 30,
  },
];
const bom = {
  key: 'cad-bom',
  token: '77777777-7777-4777-8777-777777777777',
  relativePath:
    'AD/AD2020-06-14 CAD2020-B787-03 787飞机定期断电重启/CAD2020-B787-03.pdf',
};

assertSafeDatabase(databaseUrl);
await assertSafeArchiveRoot(archiveRoot);
await Promise.all(
  [...samples, bom].map((sample) =>
    access(resolve(uploadRoot, sample.relativePath)),
  ),
);

const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));
const [
  { DocumentManagementHostedCore },
  { MiaodaFileServiceArtifactStore },
  { MiaodaHostedDocumentCatalog },
  { OrdinaryDocumentManagementAuthorizer },
  { controlledPdfByteView },
  { deterministicId },
] = await Promise.all([
  importBuilt(
    'modules/document-management/src/hosted/documentManagementHostedCore.js',
  ),
  importBuilt(
    'modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  ),
  importBuilt(
    'modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js',
  ),
  importBuilt(
    'modules/document-management-runtime/ordinary-document-management-authorizer.js',
  ),
  importBuilt(
    'modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js',
  ),
  importBuilt('modules/document-management/src/runtime/valueTools.js'),
]);

const sampleBytes = new Map();
for (const sample of [...samples, bom]) {
  const bytes = await readFile(resolve(uploadRoot, sample.relativePath));
  sampleBytes.set(sample.key, bytes);
  sample.sha256 = sha256(bytes);
  sample.byteLength = bytes.byteLength;
  sample.selection = {
    bucketId,
    filePath: `wiselink/dev-intake/${sample.token}/${sample.key}.pdf`,
  };
}

const bomBytes = sampleBytes.get(bom.key);
assert.equal(
  bom.sha256,
  '11d4e91d54b3fdd34fbc6f3dff3ef6bbe558254cf84ec76e7ca441593cc3402d',
);
assert.equal(bom.byteLength, 169326);
assert.equal(bomBytes.subarray(0, 8).toString('hex'), 'efbbbf255044462d');
const bomView = controlledPdfByteView(bomBytes);
assert.equal(bomView.normalization, 'UTF8_BOM_STRIPPED');
assert.equal(bomView.offset, 3);
assert.equal(bomView.bytes.subarray(0, 5).toString('ascii'), '%PDF-');
assert.throws(
  () => controlledPdfByteView(Buffer.concat([Buffer.from([0]), bomView.bytes])),
  (error) => error?.code === 'INVALID_PDF_INPUT',
);

const adminSql = postgres(databaseUrl, { max: 1 });
let runtimeSql;
try {
  const cluster = await verifyTemporaryCluster(adminSql);
  await bootstrapDatabase(adminSql);
  runtimeSql = postgres(runtimeDatabaseUrl(databaseUrl), { max: 8 });
  const runtime = await verifyRuntimeDatabase(runtimeSql);
  const db = drizzle(runtimeSql);
  const fileService = await new PhysicalFileService({
    rootDirectory: archiveRoot,
    defaultBucketId: bucketId,
    createdByUserId: actorUserId,
  }).initialize();
  for (const sample of [...samples, bom]) {
    await fileService.seed({
      filePath: sample.selection.filePath,
      bytes: sampleBytes.get(sample.key),
      fileName: basename(sample.relativePath),
    });
  }

  const catalog = new MiaodaHostedDocumentCatalog(db);
  const authorizer = new OrdinaryDocumentManagementAuthorizer({}, fileService);
  const core = new DocumentManagementHostedCore({
    artifactStore: new MiaodaFileServiceArtifactStore(fileService),
    catalog,
    authorizer,
    now: () => '2026-08-30T00:00:00.000Z',
  });

  await assert.rejects(
    core.ingestFileServiceSelection(
      requestFor(samples[0]),
      contextFor(tenantA, 'another-user'),
    ),
    (error) => error?.code === 'DOCUMENT_ACTION_FORBIDDEN',
  );
  assert.deepEqual(await catalogCounts(runtimeSql), zeroCatalogCounts());

  const results = new Map();
  for (const sample of samples) {
    const ingested = await core.ingestFileServiceSelection(
      requestFor(sample),
      contextFor(tenantA),
    );
    assertIdentity(ingested.identityReadback, sample, tenantA);
    assert.equal(ingested.immutableReadbackVerified, true);
    assert.equal(ingested.catalogFreshReadVerified, true);
    results.set(sample.key, ingested);

    if (sample.key === 'ftd-old') {
      const exact = await core.ingestFileServiceSelection(
        {
          ...requestFor(sample, 'dm-family:ftd-old:exact'),
          sourceRef: 'physical:ftd-old:exact-selection',
          descriptor: {
            issuer: 'AIRBUS',
            documentFamily: 'SB',
            documentCode: '787-FTD-34-19008',
            businessRevision: 'R999',
            pageCount: 6,
          },
        },
        contextFor(tenantA),
      );
      assert.equal(exact.decision, 'RESUME_EXISTING_PROCESS');
      assert.equal(exact.documentVersionId, ingested.documentVersionId);
      assertIdentity(exact.identityReadback, sample, tenantA);
      results.set('ftd-old-exact', exact);
    }
  }

  assert.equal(results.get('ftd-old').decision, 'INGEST_NEW_FAMILY');
  assert.equal(results.get('ftd-new').decision, 'INGEST_NEW_REVISION');
  assert.notEqual(
    results.get('ftd-old').documentVersionId,
    results.get('ftd-new').documentVersionId,
  );
  assert.equal(
    results.get('ftd-old').familyId,
    results.get('ftd-new').familyId,
  );

  const operationsBeforeReplay = fileService.operationCounts;
  const replay = await core.ingestFileServiceSelection(
    requestFor(samples.find((sample) => sample.key === 'ftd-new')),
    contextFor(tenantA),
  );
  assert.equal(replay.disposition, 'IDEMPOTENT_REPLAY');
  const operationsAfterReplay = fileService.operationCounts;
  assert.equal(
    operationsAfterReplay.getDefaultBucket,
    operationsBeforeReplay.getDefaultBucket + 1,
  );
  assert.equal(
    operationsAfterReplay.getFileMetadata,
    operationsBeforeReplay.getFileMetadata + 1,
  );
  assert.equal(operationsAfterReplay.download, operationsBeforeReplay.download);
  assert.equal(operationsAfterReplay.upload, operationsBeforeReplay.upload);
  assertIdentity(replay.identityReadback, samples[1], tenantA);

  const tenantBIngest = await core.ingestFileServiceSelection(
    requestFor(samples[0]),
    contextFor(tenantB),
  );
  assert.equal(tenantBIngest.decision, 'INGEST_NEW_FAMILY');
  assertIdentity(tenantBIngest.identityReadback, samples[0], tenantB);
  assert.notEqual(
    tenantBIngest.acquisitionId,
    results.get('ftd-old').acquisitionId,
  );
  assert.notEqual(tenantBIngest.familyId, results.get('ftd-old').familyId);
  assert.notEqual(
    tenantBIngest.documentVersionId,
    results.get('ftd-old').documentVersionId,
  );
  assert.equal(
    tenantBIngest.sourceArtifactId,
    results.get('ftd-old').sourceArtifactId,
  );
  const tenantBReplay = await core.ingestFileServiceSelection(
    requestFor(samples[0]),
    contextFor(tenantB),
  );
  assert.equal(tenantBReplay.disposition, 'IDEMPOTENT_REPLAY');
  assert.equal(
    tenantBReplay.documentVersionId,
    tenantBIngest.documentVersionId,
  );

  const legacyTenant = 'integration-legacy-tenant';
  const legacyOtherTenantId = 'integration-legacy-other-tenant';
  const legacyRawKey = 'legacy-unscoped-ftd-old';
  const legacyAcquisitionId = deterministicId(
    'acquisition',
    legacyTenant,
    legacyRawKey,
  );
  const legacyCatalog = proxyCatalog(catalog, {
    recordAcquisition({ sourceArtifact, acquisition }) {
      return catalog.recordAcquisition({
        sourceArtifact,
        acquisition: {
          ...structuredClone(acquisition),
          acquisitionId: legacyAcquisitionId,
          idempotencyKey: legacyRawKey,
        },
      });
    },
    commitNewVersion(command) {
      return catalog.commitNewVersion({
        ...structuredClone(command),
        idempotencyKey: `catalog:${legacyTenant}:${legacyRawKey}`,
      });
    },
  });
  const legacyWriterCore = new DocumentManagementHostedCore({
    artifactStore: new MiaodaFileServiceArtifactStore(fileService),
    catalog: legacyCatalog,
    authorizer,
    now: () => '2026-08-30T00:00:00.000Z',
  });
  const legacyRequest = requestFor(samples[0], legacyRawKey);
  const legacyWritten = await legacyWriterCore.ingestFileServiceSelection(
    legacyRequest,
    contextFor(legacyTenant),
  );
  assert.equal(legacyWritten.acquisitionId, legacyAcquisitionId);
  const legacyReplay = await core.ingestFileServiceSelection(
    legacyRequest,
    contextFor(legacyTenant),
  );
  assert.equal(legacyReplay.disposition, 'IDEMPOTENT_REPLAY');
  assert.equal(legacyReplay.acquisitionId, legacyAcquisitionId);
  assert.equal(legacyReplay.documentVersionId, legacyWritten.documentVersionId);
  const legacyOtherTenantIngest = await core.ingestFileServiceSelection(
    legacyRequest,
    contextFor(legacyOtherTenantId),
  );
  assert.equal(legacyOtherTenantIngest.decision, 'INGEST_NEW_FAMILY');
  assert.notEqual(legacyOtherTenantIngest.acquisitionId, legacyAcquisitionId);
  assert.notEqual(legacyOtherTenantIngest.familyId, legacyWritten.familyId);
  assert.notEqual(
    legacyOtherTenantIngest.documentVersionId,
    legacyWritten.documentVersionId,
  );
  assert.equal(
    legacyOtherTenantIngest.sourceArtifactId,
    legacyWritten.sourceArtifactId,
  );

  const countsBeforeBom = await catalogCounts(runtimeSql);
  await assert.rejects(
    core.ingestFileServiceSelection(requestFor(bom), contextFor(tenantA)),
    (error) =>
      error?.code === 'DM_PDF_FAMILY_IDENTITY_NOT_ACTIVATED' &&
      error?.details?.adapterId === 'issuer.caac.cad.v1',
  );
  assert.deepEqual(await catalogCounts(runtimeSql), countsBeforeBom);

  const rows = await ownerRows(runtimeSql);
  assert.equal(rows.length, 10);
  for (const row of rows) {
    const descriptor = JSON.parse(row.sourceDescriptorJson);
    const normalized = JSON.parse(row.normalizedDescriptorJson);
    assert.equal(descriptor.sha256, row.sha256);
    assert.equal(Number(descriptor.sizeBytes), Number(row.byteLength));
    assert.equal(normalized.sha256, row.sha256);
    assert.equal(Number(normalized.sizeBytes), Number(row.byteLength));
    assert.equal(normalized.pageCount > 0, true);
    assert.equal(row.readbackVerified, true);
    const physicalPath = fileService.physicalObjectPath(
      row.bucketId,
      row.filePath,
    );
    const physicalBytes = await readFile(physicalPath);
    assert.equal(sha256(physicalBytes), row.sha256);
    assert.equal(physicalBytes.byteLength, Number(row.byteLength));
  }

  const currentFamilies = await runtimeSql`
    SELECT canonical_identity_key AS "canonicalIdentityKey",
      current_document_version_id AS "currentDocumentVersionId",
      current_generation AS "currentGeneration"
    FROM dm_publication_family
    ORDER BY canonical_identity_key
  `;
  const tenantAFtd = currentFamilies.find(
    (row) => row.canonicalIdentityKey === tenantFamilyKey(tenantA, samples[0]),
  );
  const tenantBFtd = currentFamilies.find(
    (row) => row.canonicalIdentityKey === tenantFamilyKey(tenantB, samples[0]),
  );
  assert.equal(tenantAFtd.currentGeneration, 2);
  assert.equal(
    tenantAFtd.currentDocumentVersionId,
    results.get('ftd-new').documentVersionId,
  );
  assert.equal(tenantBFtd.currentGeneration, 1);
  assert.equal(
    tenantBFtd.currentDocumentVersionId,
    tenantBIngest.documentVersionId,
  );

  const finalCounts = await catalogCounts(runtimeSql);
  assert.deepEqual(finalCounts, {
    sourceArtifacts: 6,
    acquisitions: 10,
    preflights: 10,
    families: 8,
    documents: 8,
    versions: 9,
    currentness: 9,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        acceptancePassed: true,
        implementationBasedOnCommit: expectedBaseCommit,
        postgres: { cluster, runtime, finalCounts },
        physicalFileService: {
          rootDirectory: archiveRoot,
          operationCounts: fileService.operationCounts,
          actualByteReadbackVerified: true,
        },
        authorization: {
          wrongActorDeniedBeforeCatalogMutation: true,
          productionAuthorizerExercised: true,
        },
        tenantScope: {
          sameRawIdempotencyKeyDistinctAcquisitions: true,
          sharedContentAddressedSourceArtifact: true,
          distinctFamiliesAndDocumentVersions: true,
          independentCurrentDocumentVersions: true,
          tenantA: {
            familyId: results.get('ftd-old').familyId,
            currentDocumentVersionId: tenantAFtd.currentDocumentVersionId,
            currentGeneration: tenantAFtd.currentGeneration,
          },
          tenantB: {
            familyId: tenantBIngest.familyId,
            currentDocumentVersionId: tenantBFtd.currentDocumentVersionId,
            currentGeneration: tenantBFtd.currentGeneration,
          },
          legacyReplay: {
            rawIdempotencyKey: legacyRawKey,
            acquisitionId: legacyReplay.acquisitionId,
            disposition: legacyReplay.disposition,
            otherTenantDidNotAdoptLegacyAcquisition: true,
            otherTenantAcquisitionId: legacyOtherTenantIngest.acquisitionId,
            otherTenantFamilyId: legacyOtherTenantIngest.familyId,
          },
        },
        documentManagement: samples.map((sample) => ({
          sourcePdf: resolve(uploadRoot, sample.relativePath),
          sha256: sample.sha256,
          byteLength: sample.byteLength,
          decision: results.get(sample.key).decision,
          sourceArtifactId: results.get(sample.key).sourceArtifactId,
          documentVersionId: results.get(sample.key).documentVersionId,
          identityReadback: results.get(sample.key).identityReadback,
        })),
        ftdRevisionAndIdempotency: {
          oldDecision: results.get('ftd-old').decision,
          exactDecision: results.get('ftd-old-exact').decision,
          newDecision: results.get('ftd-new').decision,
          replayDisposition: replay.disposition,
        },
        bomBoundary: {
          sourcePdf: resolve(uploadRoot, bom.relativePath),
          actualSha256: bom.sha256,
          actualByteLength: bom.byteLength,
          leadingHex: bomBytes.subarray(0, 8).toString('hex'),
          normalization: bomView.normalization,
          inspectionOffset: bomView.offset,
          arbitraryLeadingGarbageAccepted: false,
          commitBlocker: 'DM_PDF_FAMILY_IDENTITY_NOT_ACTIVATED',
          adapterId: 'issuer.caac.cad.v1',
          catalogMutationPerformed: false,
        },
        nonclaims: {
          hostedRemoteFileServiceProviderExercised: false,
          databaseSchemaChanged: false,
          databaseRlsCarriesTenantIdentity: false,
          allUnresolvedCorpusDocumentsFixed: false,
          full401RerunPerformed: false,
          parserProfilesChangedOrExercised: false,
          ocrChangedOrExercised: false,
          clientOrReaderChangedOrExercised: false,
          cloudModelPushOrDeployPerformed: false,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await runtimeSql?.end({ timeout: 5 }).catch(() => undefined);
  await adminSql.end({ timeout: 5 }).catch(() => undefined);
}

function requestFor(sample, idempotencyKey = `dm-family:${sample.key}`) {
  return {
    sourceChannel: 'ordinary_physical_file_service_selection',
    sourceRef: `physical:${sample.key}`,
    selection: sample.selection,
    idempotencyKey,
    descriptor: {},
  };
}

function contextFor(tenantId, userId = actorUserId) {
  return {
    actorUserId: userId,
    tenantId,
    roles: ['wiselink_development'],
  };
}

function proxyCatalog(catalog, overrides) {
  return new Proxy(catalog, {
    get(target, property) {
      const override = overrides[property];
      if (override) return override.bind(overrides);
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function assertIdentity(identity, sample, tenantId) {
  assert.equal(identity.identityAuthority, 'DM_ACTUAL_PDF_FIRST_THREE_PAGES');
  assert.equal(identity.issuerAuthority, sample.issuer);
  assert.equal(identity.documentFamily, sample.family);
  assert.equal(identity.documentNumber, sample.documentNumber);
  assert.equal(identity.pageCount, sample.pageCount);
  assert.equal(
    identity.canonicalIdentityKey,
    tenantFamilyKey(tenantId, sample),
  );
  if (sample.businessRevision) {
    assert.equal(identity.businessRevision, sample.businessRevision);
  }
  if (sample.revisionDate)
    assert.equal(identity.revisionDate, sample.revisionDate);
  if (sample.sourceGeneratedDate) {
    assert.equal(identity.sourceGeneratedDate, sample.sourceGeneratedDate);
  }
}

function tenantFamilyKey(tenantId, sample) {
  const businessKey = `${sample.issuer}|${sample.family}|${sample.documentNumber}`;
  return `tenant:${encodeURIComponent(tenantId)}:family:${encodeURIComponent(businessKey)}`;
}

async function bootstrapDatabase(sql) {
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`
    DO $bootstrap$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiselink_dm_family_runtime') THEN
        CREATE ROLE wiselink_dm_family_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
      END IF;
    END
    $bootstrap$;
  `);
  await sql.unsafe('GRANT service_role TO wiselink_dm_family_runtime');
  await sql.unsafe(
    "ALTER ROLE wiselink_dm_family_runtime SET row_security = 'on'",
  );
  await sql.unsafe('CREATE TYPE user_profile AS (user_id text)');
  await sql.unsafe(
    await readFile(
      resolve(root, 'migrations/0001_document_management_hosted_catalog.sql'),
      'utf8',
    ),
  );
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO service_role');
  await sql.unsafe('GRANT USAGE ON TYPE user_profile TO service_role');
  await sql.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role',
  );
}

async function verifyTemporaryCluster(sql) {
  const [identity] = await sql`
    SELECT current_database() AS "databaseName",
      current_setting('data_directory') AS "dataDirectory",
      current_setting('port')::int AS port,
      inet_server_addr()::text AS "serverAddress"
  `;
  assert.equal(identity.databaseName, 'wiselink_dm_family_identity_test');
  assert.ok(
    identity.dataDirectory.startsWith('/private/tmp/wiselink-dm-family-pg.'),
  );
  assert.ok(['127.0.0.1/32', '::1/128'].includes(identity.serverAddress));
  return identity;
}

async function verifyRuntimeDatabase(sql) {
  const [identity] = await sql`
    SELECT current_user AS "currentUser",
      current_setting('row_security') AS "rowSecurity",
      pg_has_role(current_user, 'service_role', 'member') AS "serviceRoleMember",
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS "bypassRls"
  `;
  assert.equal(identity.currentUser, 'wiselink_dm_family_runtime');
  assert.equal(identity.rowSecurity, 'on');
  assert.equal(identity.serviceRoleMember, true);
  assert.equal(identity.superuser, false);
  assert.equal(identity.bypassRls, false);
  return identity;
}

async function catalogCounts(sql) {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM dm_source_artifact) AS "sourceArtifacts",
      (SELECT count(*)::int FROM dm_acquisition) AS acquisitions,
      (SELECT count(*)::int FROM dm_ingress_preflight) AS preflights,
      (SELECT count(*)::int FROM dm_publication_family) AS families,
      (SELECT count(*)::int FROM dm_document) AS documents,
      (SELECT count(*)::int FROM dm_document_version) AS versions,
      (SELECT count(*)::int FROM dm_currentness_decision) AS currentness
  `;
  return row;
}

function zeroCatalogCounts() {
  return {
    sourceArtifacts: 0,
    acquisitions: 0,
    preflights: 0,
    families: 0,
    documents: 0,
    versions: 0,
    currentness: 0,
  };
}

async function ownerRows(sql) {
  return sql`
    SELECT a.source_descriptor_json AS "sourceDescriptorJson",
      p.normalized_descriptor_json AS "normalizedDescriptorJson",
      s.sha256,
      s.byte_length AS "byteLength",
      s.bucket_id AS "bucketId",
      s.file_path AS "filePath",
      s.readback_verified AS "readbackVerified"
    FROM dm_acquisition a
    JOIN dm_ingress_preflight p ON p.acquisition_id = a.acquisition_id
    JOIN dm_source_artifact s ON s.source_artifact_id = a.source_artifact_id
    ORDER BY a.acquisition_id
  `;
}

function runtimeDatabaseUrl(value) {
  const parsed = new URL(value);
  parsed.username = 'wiselink_dm_family_runtime';
  parsed.password = '';
  return parsed.toString();
}

function assertSafeDatabase(value) {
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/wiselink_dm_family_identity_test');
}

async function assertSafeArchiveRoot(value) {
  assert.equal(isAbsolute(value), true);
  assert.ok(value.startsWith('/private/tmp/') || value.startsWith('/tmp/'));
  assert.notEqual(value, '/private/tmp');
  assert.notEqual(value, '/tmp');
  const [entry, actual, children] = await Promise.all([
    lstat(value),
    realpath(value),
    readdir(value),
  ]);
  assert.equal(entry.isDirectory(), true);
  assert.equal(entry.isSymbolicLink(), false);
  assert.equal(actual, value);
  assert.equal(children.length, 0);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
