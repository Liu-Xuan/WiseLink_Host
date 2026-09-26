import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const { documentParseRecoveryRequestId } = require('../../shared/document-parsing-recovery.ts');
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

    // Model a persisted deadline without changing immutable source/deadline fields.
    // This grant fixture exercises the real generation predicate before reserve writes.
    await db.unsafe(`CREATE TABLE auto_work_item_authorization (
      tenant_id text, actor_user_id text, document_version_id text, work_item_id text,
      request_id text, lease_owner text, document_id text, source_artifact_id text,
      source_file_sha256 text, source_byte_length bigint, lease_generation integer,
      grant_kind text, status text, lease_expires_at timestamptz)`);
    await db`INSERT INTO auto_work_item_authorization VALUES (
      'TENANT-1','ACTOR-1','DV-1','WI-1','AUTO-REQUEST','WORKER-1','DOC-1','ART-1',
      ${input.sourceBinding.pdfSha256},123,2,'MIAODA_CANONICAL_PARSE_REQUEST','LEASED',
      CURRENT_TIMESTAMP + interval '10 minutes')`;
    const staleScope = { ...scope, automaticWorkItem: {
      workItemId: 'WI-1', requestId: 'AUTO-REQUEST', principalId: 'WORKER-1',
      documentId: 'DOC-1', sourceArtifactId: 'ART-1', sourceFileSha256: input.sourceBinding.pdfSha256,
      sourceByteLength: 123, leaseGeneration: 1,
    } };
    const adminRepo = repoFor(db);
    for (const [index, code] of ['HOSTED_MODEL_QUOTA_EXHAUSTED', 'MINERU_ARTIFACT_PERSIST_FAILED', null].entries()) {
      const parseRunId = `PRUN-EXPIRED-${index}`;
      const requestId = `REQUEST-EXPIRED-${index}`;
      const progress = [{ ...partial, filePath: `wiselink/parsed/DV-1/${parseRunId}/document.md` }];
      const pending = { bucketId: 'BUCKET-1', filePath: progress[0].filePath };
      await db`INSERT INTO dm_document_parse_run (
        parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,parse_revision,
        expected_published_revision,status,bucket_id,source_binding,artifact_progress,pending_object,
        error_code,error_message,deadline_at)
        VALUES (${parseRunId},'DV-1','TENANT-1','ACTOR-1',${requestId},${3 + index * 2},
        1,${index === 2 ? 'RUNNING' : 'STAGING'},'BUCKET-1',${JSON.stringify(input.sourceBinding)}::jsonb,
        ${JSON.stringify(progress)}::jsonb,${JSON.stringify(pending)}::jsonb,${code},'original failure detail',
        CURRENT_TIMESTAMP - interval '1 minute')`;
      const [before] = await db`SELECT * FROM dm_document_parse_run WHERE parse_run_id=${parseRunId}`;
      const freshInput = { ...input, requestId: `REQUEST-RECOVER-${index}`, expectedPublishedRevision: 1 };
      // Even when RLS is bypassed by the fixture owner, another actor cannot close this run.
      await assert.rejects(adminRepo.reserve({ ...scope, actorUserId: 'ACTOR-2' }, freshInput),
        /DOCUMENT_PARSE_ALREADY_RUNNING/);
      await assert.rejects(adminRepo.reserve(staleScope, freshInput), /DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
      const [afterRejected] = await db`SELECT * FROM dm_document_parse_run WHERE parse_run_id=${parseRunId}`;
      assert.deepEqual(afterRejected, before);
      const replacement = await repo.reserve(scope, freshInput);
      assert.equal(replacement.created, true);
      const [closed] = await db`SELECT * FROM dm_document_parse_run WHERE parse_run_id=${parseRunId}`;
      assert.equal(closed.status, 'FAILED');
      assert.equal(closed.error_code, code ?? 'DOCUMENT_PARSE_INTERRUPTED');
      assert.ok(closed.completed_at);
      assert.deepEqual({ ...closed, status: before.status, error_code: before.error_code, completed_at: before.completed_at }, before);
      assert.equal((await repo.current(scope)).published.parseRunId, run.parseRunId);
      assert.equal((await repo.reserve(scope, { ...freshInput, requestId })).created, false);
      await leases.cancel(scope, replacement.row.parseRunId);
    }

    const recoveryInput = predecessor => ({ ...input, expectedPublishedRevision: 1,
      requestId: documentParseRecoveryRequestId(predecessor.parseRunId) });
    const automaticScope = { ...staleScope, automaticWorkItem: { ...staleScope.automaticWorkItem, leaseGeneration: 2 } };
    const seedPredecessor = async ({ status = 'FAILED', errorCode = 'DOCUMENT_PARSE_INTERRUPTED',
      sourceBinding = input.sourceBinding, futureLease = false,
      parseRunId = `PRUN-${randomUUID()}`, requestId = parseRunId } = {}) => {
      await db`INSERT INTO dm_document_parse_run (
        parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,parse_revision,
        expected_published_revision,status,bucket_id,source_binding,error_code,deadline_at,
        lease_owner,lease_token,lease_expires_at,cancel_requested_at)
        SELECT ${parseRunId},'DV-1','TENANT-1','ACTOR-1',${requestId},max(parse_revision)+1,
        1,${status},'BUCKET-1',${JSON.stringify(sourceBinding)}::jsonb,${errorCode},
        ${new Date(Date.now() + (futureLease ? 60_000 : -60_000)).toISOString()}::timestamptz,'old-worker','old-token',
        ${futureLease ? new Date(Date.now() + 60_000).toISOString() : null}::timestamptz,
        ${futureLease ? new Date().toISOString() : null}::timestamptz FROM dm_document_parse_run`;
      return repo.read(scope, parseRunId);
    };
    const expired = await seedPredecessor({ status: 'STAGING', errorCode: null });
    const expiredInput = recoveryInput(expired);
    for (const malformed of ['parse-resume-', 'parse-resume-PRUN-invalid', expiredInput.requestId + '-extra']) {
      await assert.rejects(repo.reserve(scope, { ...expiredInput, requestId: malformed }), /DOCUMENT_PARSE_RECOVERY_REQUEST_INVALID/);
    }
    await assert.rejects(repo.reserve(scope, recoveryInput({ parseRunId: `PRUN-${randomUUID()}` })), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    await assert.rejects(adminRepo.reserve({ ...scope, actorUserId: 'ACTOR-2' }, expiredInput), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    await assert.rejects(adminRepo.reserve({ ...scope, tenantId: 'TENANT-2' }, expiredInput), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    await assert.rejects(repo.reserve(scope, { ...expiredInput, bucketId: 'OTHER-BUCKET' }), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    await assert.rejects(repo.reserve(scope, { ...expiredInput, sourceBinding: { ...input.sourceBinding, pdfSha256: 'c'.repeat(64) } }), /DOCUMENT_PARSE_SOURCE_CHANGED/);
    await assert.rejects(adminRepo.reserve(staleScope, expiredInput), /DOCUMENT_AUTOMATIC_LEASE_REJECTED/);
    assert.deepEqual(await repo.read(scope, expired.parseRunId), expired);
    const recovered = await Promise.all([
      repo.reserve(scope, expiredInput), repoFor(concurrentActor).reserve(scope, expiredInput),
    ]);
    assert.equal(recovered.filter(result => result.created).length, 1);
    assert.equal(recovered[0].row.parseRunId, recovered[1].row.parseRunId);
    assert.equal((await repo.reserve(scope, expiredInput)).created, false);
    await assert.rejects(repo.reserve(scope, { ...expiredInput, expectedPublishedRevision: 0 }), /DOCUMENT_PARSE_REQUEST_CONFLICT/);
    await assert.rejects(repo.reserve(scope, { ...expiredInput, bucketId: 'OTHER-BUCKET' }), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    assert.equal((await repo.read(scope, expired.parseRunId)).errorCode, 'DOCUMENT_PARSE_INTERRUPTED');
    assert.equal((await repo.read(scope, expired.parseRunId)).deadlineAt.getTime(), expired.deadlineAt.getTime());
    await leases.cancel(scope, recovered[0].row.parseRunId);

    const quota = await seedPredecessor({ status: 'STAGING', errorCode: 'HOSTED_MODEL_QUOTA_EXHAUSTED' });
    const quotaInput = recoveryInput(quota);
    await assert.rejects(adminRepo.reserve(automaticScope, quotaInput), /DOCUMENT_PARSE_RECOVERY_NOT_ELIGIBLE/);
    assert.deepEqual(await repo.read(scope, quota.parseRunId), quota);
    assert.equal(await repo.readRequest(scope, quotaInput.requestId), null);
    const manual = await repo.reserve(scope, quotaInput);
    assert.equal((await repo.read(scope, quota.parseRunId)).errorCode, 'HOSTED_MODEL_QUOTA_EXHAUSTED');
    const manualFence = await leases.claim(scope, manual.row.parseRunId, 'MANUAL-WORKER');
    await repo.fail(scope, manual.row.parseRunId, { errorCode: 'HOSTED_MODEL_QUOTA_EXHAUSTED' }, manualFence);
    await assert.rejects(adminRepo.reserve(automaticScope, recoveryInput(manual.row)), /DOCUMENT_PARSE_RECOVERY_NOT_ELIGIBLE/);
    assert.equal(await repo.readRequest(scope, recoveryInput(manual.row).requestId), null);
    // A lost response may be replayed even after later history exists.
    assert.equal((await repo.reserve(scope, expiredInput)).row.parseRunId, recovered[0].row.parseRunId);

    const old = await seedPredecessor();
    const latest = await seedPredecessor({ errorCode: 'DOCUMENT_PARSE_CANCELLED', futureLease: true });
    await assert.rejects(repo.reserve(scope, recoveryInput(old)), /DOCUMENT_PARSE_RECOVERY_NOT_LATEST/);
    const resumedCancelled = await repo.reserve(scope, recoveryInput(latest));
    assert.equal(resumedCancelled.created, true);
    assert.deepEqual(await repo.read(scope, latest.parseRunId), latest);
    await leases.cancel(scope, resumedCancelled.row.parseRunId);
    const changedSource = await seedPredecessor({ sourceBinding: { ...input.sourceBinding, sourceArtifactId: 'OLD-ARTIFACT' } });
    await assert.rejects(repo.reserve(scope, recoveryInput(changedSource)), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    const racing = await seedPredecessor({ status: 'STAGING', errorCode: null });
    await other.unsafe('RESET ROLE');
    const [{ pid: contenderPid }] = await other`SELECT pg_backend_pid() AS pid`;
    let racingResult;
    await db.begin(async tx => {
      await tx`SELECT parse_run_id FROM dm_document_parse_run WHERE parse_run_id=${racing.parseRunId} FOR UPDATE`;
      racingResult = repoFor(other).reserve(automaticScope, recoveryInput(racing))
        .then(result => ({ result }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [waiting] = await tx`SELECT pg_backend_pid() = ANY(pg_blocking_pids(${contenderPid})) AS blocked`;
        if (waiting.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, 'recovery must wait for the predecessor row lock');
      await tx`UPDATE dm_document_parse_run SET error_code='HOSTED_MODEL_QUOTA_EXHAUSTED'
        WHERE parse_run_id=${racing.parseRunId}`;
    });
    assert.match((await racingResult).error.message, /DOCUMENT_PARSE_RECOVERY_NOT_ELIGIBLE/);
    assert.equal((await repo.read(scope, racing.parseRunId)).status, 'STAGING');
    assert.equal(await repo.readRequest(scope, recoveryInput(racing).requestId), null);
    await repo.reserve(scope, recoveryInput(racing)).then(result => leases.cancel(scope, result.row.parseRunId));
    const futurePredecessorId = `PRUN-${randomUUID()}`;
    await seedPredecessor({ requestId: documentParseRecoveryRequestId(futurePredecessorId) });
    const reversed = await seedPredecessor({ parseRunId: futurePredecessorId });
    await assert.rejects(repo.reserve(scope, recoveryInput(reversed)), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    const stillActive = await seedPredecessor({ status: 'STAGING', errorCode: null });
    await seedPredecessor({ requestId: documentParseRecoveryRequestId(stillActive.parseRunId) });
    await assert.rejects(repo.reserve(scope, recoveryInput(stillActive)), /DOCUMENT_PARSE_RECOVERY_BINDING_MISMATCH/);
    await repo.reserve(scope, { ...input, requestId: 'CLOSE-FORGED-ACTIVE', expectedPublishedRevision: 1 })
      .then(result => leases.cancel(scope, result.row.parseRunId));
    const interrupted = await seedPredecessor();
    assert.equal((await adminRepo.reserve(automaticScope, recoveryInput(interrupted))).created, true);
  } finally {
    await Promise.all([actor.end(), concurrentActor.end(), other.end(), db.end()]);
  }
});
