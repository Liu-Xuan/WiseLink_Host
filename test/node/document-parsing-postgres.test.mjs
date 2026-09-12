import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { DocumentParsingRepository } = require('../../server/modules/document-management/src/hosted/nest/document-parsing.repository.ts');
const { DocumentStepLeaseRepository } = require('../../server/modules/document-management/src/hosted/nest/document-step-lease.repository.ts');
const repoFor = client => { const db = drizzle(client); return new DocumentParsingRepository(db, new DocumentStepLeaseRepository(db)); };
const url = process.env.DOCUMENT_PARSING_TEST_DATABASE_URL;

test('document parse publication preserves immutable source, readback, replay, CAS and actor isolation', { skip: !url }, async () => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/wiselink_document_parse_test');
  const db = postgres(url, { max: 1, onnotice() {} });
  const actor = postgres(url, { max: 1, onnotice() {} });
  const concurrentActor = postgres(url, { max: 1, onnotice() {} });
  const other = postgres(url, { max: 1, onnotice() {} });
  try {
    await db.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await db.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$;
      CREATE TYPE user_profile AS (user_id text);
      CREATE TABLE dm_document_version (
        document_version_id varchar(96) PRIMARY KEY, document_id varchar(96) NOT NULL,
        family_id varchar(96) NOT NULL, source_artifact_id varchar(96) NOT NULL,
        pdf_sha256 varchar(64) NOT NULL, byte_length bigint NOT NULL
      );
      CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar, v varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT t = 'TENANT-1' AND v = 'DV-1' AND current_setting('app.user_id', true) = 'ACTOR-1';
      $$;
      CREATE FUNCTION engineering_matter_actor_has_tenant(t varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT t = 'TENANT-1' AND current_setting('app.user_id', true) = 'ACTOR-1';
      $$;
      GRANT USAGE ON SCHEMA public TO authenticated, service_role;
      GRANT SELECT, UPDATE ON dm_document_version TO authenticated, service_role;
    `);
    await db.unsafe(await readFile(new URL('../../migrations/0038_document_parse_run.sql', import.meta.url), 'utf8'));
    for (const name of ['0039_engineering_search_projection.sql', '0042_engineering_search_projection_pending.sql',
      '0043_engineering_search_hosted_actor_scope.sql', '0050_document_source_projection_progress.sql', '0044_document_parse_step_lease.sql', '0045_document_original_pending_authorization.sql']) {
      await db.unsafe(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.unsafe('GRANT SELECT, INSERT, UPDATE ON dm_document_parse_run, engineering_search_projection_pending TO authenticated, service_role');
    await db`INSERT INTO dm_document_version VALUES ('DV-1', 'DOC-1', 'FAM-1', 'ART-1', ${'a'.repeat(64)}, 123)`;
    await actor.unsafe("SET ROLE authenticated; SELECT set_config('app.user_id', 'ACTOR-1', false)");
    await concurrentActor.unsafe("SET ROLE authenticated; SELECT set_config('app.user_id', 'ACTOR-1', false)");
    await other.unsafe("SET ROLE authenticated; SELECT set_config('app.user_id', 'ACTOR-2', false)");
    const repo = repoFor(actor);
    const otherRepo = repoFor(other);
    const scope = { tenantId: 'TENANT-1', actorUserId: 'ACTOR-1', documentVersionId: 'DV-1' };
    const input = { requestId: 'REQUEST-1', expectedPublishedRevision: 0, bucketId: 'BUCKET-1',
      sourceBinding: { documentVersionId: 'DV-1', documentId: 'DOC-1', familyId: 'FAM-1', sourceArtifactId: 'ART-1', pdfSha256: 'a'.repeat(64), byteLength: 123 } };
    const reservations = await Promise.all([repo.reserve(scope, input), repoFor(concurrentActor).reserve(scope, input)]);
    assert.equal(reservations.filter(item => item.created).length, 1);
    const run = reservations[0].row;
    assert.equal(reservations[1].row.parseRunId, run.parseRunId);
    await assert.rejects(repo.reserve(scope, { ...input, expectedPublishedRevision: 1 }), /DOCUMENT_PARSE_REQUEST_CONFLICT/);
    await assert.rejects(repo.reserve(scope, { ...input, requestId: 'REQUEST-OTHER' }), /DOCUMENT_PARSE_ALREADY_RUNNING/);
    assert.equal(await otherRepo.read({ ...scope, actorUserId: 'ACTOR-2' }, run.parseRunId), null);
    assert.equal(await repo.read({ ...scope, tenantId: 'TENANT-2' }, run.parseRunId), null);

    const manifest = { role: 'MANIFEST', relativePath: 'manifest.json', bucketId: 'BUCKET-1',
      filePath: `wiselink/parsed/DV-1/${run.parseRunId}/manifest.json`, providerObjectId: 'FILE-1',
      mediaType: 'application/json', byteLength: 321, sha256: 'b'.repeat(64), readback: 'VERIFIED' };
    const leases = new DocumentStepLeaseRepository(drizzle(actor));
    const fence = await leases.claim(scope, run.parseRunId, 'P-TEST');
    assert.ok(fence);
    await repo.stage(scope, run.parseRunId, fence);
    await repo.progress(scope, run.parseRunId, [{ ...manifest, readback: 'UPLOADED' }], fence);
    await assert.rejects(repo.publish(scope, run.parseRunId, manifest, fence), /DOCUMENT_PARSE_READBACK_REQUIRED/);
    assert.equal((await repo.read(scope, run.parseRunId)).status, 'STAGING');
    await repo.progress(scope, run.parseRunId, [manifest], fence);
    await assert.rejects(repo.progress(scope, run.parseRunId, [manifest], { ...fence, leaseToken: 'old-token' }), /DOCUMENT_STEP_LEASE_REJECTED/);
    await db.unsafe(`CREATE FUNCTION reject_pending_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PENDING_TEST_FAILURE'; END $$;
      CREATE TRIGGER reject_pending_test BEFORE INSERT ON engineering_search_projection_pending FOR EACH ROW EXECUTE FUNCTION reject_pending_test()`);
    await assert.rejects(repo.publish(scope, run.parseRunId, manifest, fence), error => /PENDING_TEST_FAILURE/.test(error.cause?.message ?? error.message));
    assert.equal((await repo.read(scope, run.parseRunId)).status, 'STAGING');
    assert.equal((await db`SELECT * FROM engineering_search_projection_pending`).length, 0);
    await db.unsafe('DROP TRIGGER reject_pending_test ON engineering_search_projection_pending');
    const published = await repo.publish(scope, run.parseRunId, manifest, fence);
    assert.equal(published.status, 'PUBLISHED');
    const [pending] = await db`SELECT * FROM engineering_search_projection_pending`;
    assert.equal(pending.exact_revision_ref, run.parseRunId);
    assert.equal(pending.subject_id, 'DV-1');
    assert.equal(pending.owner_id, 'ACTOR-1');
    assert.deepEqual((await repo.current(scope)).published.manifestArtifact, manifest);
    await assert.rejects(actor`UPDATE dm_document_parse_run SET error_code = 'overwrite' WHERE parse_run_id = ${run.parseRunId}`, /DOCUMENT_PARSE_TERMINAL_IMMUTABLE/);
    await assert.rejects(repo.reserve(scope, { ...input, requestId: 'REQUEST-2' }), /DOCUMENT_PARSE_REVISION_CONFLICT/);

    const next = await repo.reserve(scope, { ...input, requestId: 'REQUEST-2', expectedPublishedRevision: 1 });
    const nextFence = await leases.claim(scope, next.row.parseRunId, 'P-TEST');
    assert.ok(nextFence);
    await repo.stage(scope, next.row.parseRunId, nextFence);
    const partial = { ...manifest, role: 'READING_MARKDOWN', relativePath: 'document.md', readback: 'UPLOADED' };
    const pendingObject = { bucketId: 'BUCKET-1', filePath: `wiselink/parsed/DV-1/${next.row.parseRunId}/document.md` };
    await repo.fail(scope, next.row.parseRunId, { errorCode: 'MINERU_ARTIFACT_PERSIST_FAILED', progress: [partial], pendingObject }, nextFence);
    const failed = await repo.readRequest(scope, 'REQUEST-2');
    assert.equal(failed.status, 'FAILED');
    assert.deepEqual(failed.pendingObject, pendingObject);
    assert.deepEqual(failed.artifactProgress, [partial]);
    assert.equal((await repo.current(scope)).published.parseRunId, run.parseRunId);
    assert.equal((await repo.reserve(scope, { ...input, requestId: 'REQUEST-2', expectedPublishedRevision: 1 })).created, false);
    await assert.rejects(repo.reserve(scope, { ...input, requestId: 'REQUEST-3', expectedPublishedRevision: 1,
      sourceBinding: { ...input.sourceBinding, pdfSha256: 'c'.repeat(64) } }), /DOCUMENT_PARSE_SOURCE_CHANGED/);
    await assert.rejects(otherRepo.reserve({ ...scope, actorUserId: 'ACTOR-2' }, { ...input, requestId: 'FOREIGN' }),
      error => error.cause?.code === '42501' && /row-level security/i.test(error.cause.message));
  } finally {
    await Promise.all([actor.end(), concurrentActor.end(), other.end(), db.end()]);
  }
});
