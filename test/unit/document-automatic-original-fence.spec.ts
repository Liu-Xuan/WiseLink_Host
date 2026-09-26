import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { DocumentStepLeaseRepository, type DocumentStepFence } from '../../server/modules/document-management/src/hosted/nest/document-step-lease.repository';
import { DocumentParsingRepository, type DocumentParseScope } from '../../server/modules/document-management/src/hosted/nest/document-parsing.repository';

const scope: DocumentParseScope = {
  tenantId: 'tenant-test', actorUserId: 'actor-test', documentVersionId: 'DV-test',
  automaticWorkItem: {
    workItemId: 'WI-test', requestId: 'REQ-test', principalId: 'worker-test',
    documentId: 'DOC-test', sourceArtifactId: 'SRC-test', sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 1024, leaseGeneration: 7,
  },
};
const source = { documentVersionId: 'DV-test', documentId: 'DOC-test', familyId: 'F-test',
  sourceArtifactId: 'SRC-test', pdfSha256: 'a'.repeat(64), byteLength: 1024 };
const request = { requestId: 'auto-original-REQ-test', expectedPublishedRevision: 0, bucketId: 'bucket-test', sourceBinding: source };
const fence: DocumentStepFence = { parseRunId: 'PR-test', leaseOwner: 'step-worker', leaseToken: 'token-test', leaseGeneration: 3 };

function fixture() {
  const events: string[] = [];
  const predicates: SQL[] = [];
  const rows: unknown[][] = [[{ workItemId: 'WI-test' }], [{ id: 'parse-row' }]];
  const chain = {
    from: jest.fn(() => chain),
    where: jest.fn((predicate: SQL) => { predicates.push(predicate); return chain; }),
    for: jest.fn(async (mode: string) => { events.push(`lock:${mode}`); return rows.shift() ?? []; }),
    returning: jest.fn(async () => [{ leaseToken: 'token-test', leaseGeneration: 3 }]),
    set: jest.fn(() => chain),
  };
  const tx = {
    select: jest.fn(() => { events.push('select'); return chain; }),
    update: jest.fn(() => { events.push('update'); return chain; }),
  };
  const db = { ...tx, transaction: jest.fn(async (work: (database: typeof tx) => Promise<unknown>) => {
    events.push('transaction'); return work(tx);
  }) };
  const leases = new DocumentStepLeaseRepository(db as never);
  const parses = new DocumentParsingRepository(db as never, leases);
  return { events, predicates, rows, chain, tx, db, leases, parses };
}

describe('automatic original processing transaction fence', () => {
  it('locks an exact active grant including immutable source and captured generation', async () => {
    const f = fixture();
    await f.leases.assertAutomaticWorkItem(f.tx as never, scope);
    const query = new PgDialect().sqlToQuery(f.predicates[0]);
    const columns = ['tenant_id', 'actor_user_id', 'document_version_id', 'work_item_id', 'request_id',
      'lease_owner', 'document_id', 'source_artifact_id', 'source_file_sha256', 'source_byte_length',
      'lease_generation', 'grant_kind', 'status', 'lease_expires_at'];
    for (const column of columns) expect(query.sql).toContain(`"auto_work_item_authorization"."${column}"`);
    expect(query.params.slice(0, -1)).toEqual(['tenant-test', 'actor-test', 'DV-test', 'WI-test', 'REQ-test',
      'worker-test', 'DOC-test', 'SRC-test', 'a'.repeat(64), 1024, 7, 'MIAODA_CANONICAL_PARSE_REQUEST', 'LEASED']);
    expect(query.sql).toContain('"lease_expires_at" >');
    expect(Number.isFinite(Date.parse(String(query.params.at(-1))))).toBe(true);
    expect(f.chain.for).toHaveBeenCalledWith('update');
  });

  it.each(['claim', 'renew'] as const)('%s checks the grant inside the mutation transaction', async operation => {
    const f = fixture();
    if (operation === 'claim') await f.leases.claim(scope, fence.parseRunId, fence.leaseOwner);
    else await f.leases.renew(scope, fence);
    expect(f.events).toEqual(['transaction', 'select', 'lock:update', 'update']);
  });

  it.each(['claim', 'renew', 'stage', 'progress', 'publish', 'failure', 'reserve'] as const)(
    'rejects %s before mutation when the originating grant no longer matches', async operation => {
      const f = fixture(); f.rows.splice(0, f.rows.length, []);
      const execute = async () => {
        switch (operation) {
          case 'claim': return f.leases.claim(scope, fence.parseRunId, fence.leaseOwner);
          case 'renew': return f.leases.renew(scope, fence);
          case 'stage': return f.parses.stage(scope, fence.parseRunId, fence);
          case 'progress': return f.parses.progress(scope, fence.parseRunId, [], fence);
          case 'publish': return f.parses.publish(scope, fence.parseRunId, {} as never, fence);
          case 'failure': return f.parses.recordStepFailure(scope, fence, 'PLUGIN_FAILED');
          case 'reserve': return f.parses.reserve(scope, request);
        }
      };
      await expect(execute()).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REJECTED');
      expect(f.tx.update).not.toHaveBeenCalled();
      expect(f.events).toEqual(['transaction', 'select', 'lock:update']);
    },
  );

  it('locks the grant before the document lease for authoritative writes', async () => {
    const f = fixture();
    await f.leases.assertValid(f.tx as never, scope, fence);
    expect(f.events).toEqual(['select', 'lock:update', 'select', 'lock:update']);
    expect(new PgDialect().sqlToQuery(f.predicates[1]).sql).toContain('"dm_document_parse_run"');
  });

  it('checks the actual catalog source against the grant before reservation', async () => {
    const f = fixture();
    const changedSource = { ...source, sourceArtifactId: 'SRC-changed' };
    f.rows[1] = [changedSource];
    await expect(f.parses.reserve(scope, { ...request, sourceBinding: changedSource }))
      .rejects.toThrow('DOCUMENT_PARSE_SOURCE_CHANGED');
    expect(f.tx.update).not.toHaveBeenCalled();
    expect(f.events).toEqual(['transaction', 'select', 'lock:update', 'select', 'lock:update']);
  });

  it('preserves static claims and permits fenced release after queue generation changes', async () => {
    const f = fixture();
    const { automaticWorkItem: _grant, ...staticScope } = scope;
    await f.leases.claim(staticScope, fence.parseRunId, fence.leaseOwner);
    await f.leases.renew(staticScope, fence);
    await f.leases.release(scope, fence);
    expect(f.db.transaction).not.toHaveBeenCalled();
    expect(f.tx.select).not.toHaveBeenCalled();
    expect(f.tx.update).toHaveBeenCalledTimes(3);
  });
});

const localDatabaseUrl = process.env.WL_AUTOMATIC_ORIGINAL_TEST_DATABASE_URL;
(localDatabaseUrl ? describe : describe.skip)('automatic original fence with isolated PostgreSQL', () => {
  const schema = `automatic_original_fixture_${process.pid}`;
  const client = postgres(localDatabaseUrl ?? '', { max: 1 });
  const contender = postgres(localDatabaseUrl ?? '', { max: 1 });
  const database = drizzle(client);
  const leases = new DocumentStepLeaseRepository(database as never);
  const parses = new DocumentParsingRepository(database as never, leases);

  beforeAll(async () => {
    const url = new URL(localDatabaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test'))
      throw new Error('ISOLATED_LOCAL_DATABASE_REQUIRED');
    await client.unsafe(`CREATE SCHEMA "${schema}"`);
    await client.unsafe(`SET search_path TO "${schema}"`);
    await contender.unsafe(`SET search_path TO "${schema}"`);
    await client.unsafe(`CREATE TABLE auto_work_item_authorization (
      tenant_id text, actor_user_id text, document_version_id text, work_item_id text,
      request_id text, lease_owner text, document_id text, source_artifact_id text,
      source_file_sha256 text, source_byte_length bigint, lease_generation integer,
      grant_kind text, status text, lease_expires_at timestamptz);
      CREATE TABLE dm_document_version (document_version_id text, document_id text, family_id text,
        source_artifact_id text, pdf_sha256 text, byte_length bigint);
      CREATE TABLE dm_document_parse_run (
        id uuid DEFAULT gen_random_uuid(), parse_run_id text, document_version_id text, tenant_id text,
        actor_user_id text, request_id text, parse_revision integer, expected_published_revision integer,
        status text, bucket_id text, source_binding jsonb, artifact_progress jsonb DEFAULT '[]',
        pending_object jsonb, manifest_artifact jsonb, lease_owner text, lease_token text,
        lease_generation integer DEFAULT 0, lease_expires_at timestamptz, cancel_requested_at timestamptz,
        error_code text, error_message text, started_at timestamptz DEFAULT CURRENT_TIMESTAMP,
        deadline_at timestamptz, completed_at timestamptz)`);
    await client`INSERT INTO dm_document_version VALUES ('DV-test','DOC-test','F-test','SRC-test',${source.pdfSha256},1024)`;
  });
  beforeEach(async () => {
    await client`DELETE FROM auto_work_item_authorization`;
    await client`DELETE FROM dm_document_parse_run`;
    await client`INSERT INTO auto_work_item_authorization VALUES (
      'tenant-test','actor-test','DV-test','WI-test','REQ-test','worker-test','DOC-test','SRC-test',
      ${source.pdfSha256},1024,7,'MIAODA_CANONICAL_PARSE_REQUEST','LEASED',CURRENT_TIMESTAMP+interval '10 minutes')`;
  });
  afterAll(async () => {
    await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([client.end(), contender.end()]);
  });

  it('resumes persisted runs across queue generations while rejecting old claim, renew, publish and error writes', async () => {
    const reserved = await parses.reserve(scope, request);
    const parseRunId = reserved.row.parseRunId;
    const claimed = await leases.claim(scope, parseRunId, 'worker-test');
    expect(claimed).not.toBeNull();
    await parses.stage(scope, parseRunId, claimed!);
    await parses.progress(scope, parseRunId, [], claimed!);
    expect(await leases.renew(scope, claimed!)).toBe(true);
    await client`UPDATE auto_work_item_authorization SET lease_generation=8`;
    for (const action of [
      () => parses.reserve(scope, request), () => leases.claim(scope, parseRunId, 'old-worker'),
      () => leases.renew(scope, claimed!), () => parses.progress(scope, parseRunId, [], claimed!),
      () => parses.publish(scope, parseRunId, {} as never, claimed!),
      () => parses.recordStepFailure(scope, claimed!, 'STALE_WORKER_FAILED'),
    ]) await expect(action()).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REJECTED');
    const [unchanged] = await client`SELECT status,error_code FROM dm_document_parse_run WHERE parse_run_id=${parseRunId}`;
    expect(unchanged).toEqual({ status: 'STAGING', error_code: null });
    await leases.release(scope, claimed!);
    const fresh = { ...scope, automaticWorkItem: { ...scope.automaticWorkItem!, leaseGeneration: 8 } };
    const replay = await parses.reserve(fresh, request);
    expect(replay.created).toBe(false);
    expect(replay.row.parseRunId).toBe(parseRunId);
    expect(await leases.claim(fresh, parseRunId, 'new-worker')).not.toBeNull();
  });

  it.each([
    "status='BLOCKED'", "lease_expires_at=CURRENT_TIMESTAMP-interval '1 second'",
    "actor_user_id='other-actor'", "source_artifact_id='other-source'", "lease_owner='other-principal'",
  ])('rejects changed grant %s with real SQL', async mutation => {
    await client.unsafe(`UPDATE auto_work_item_authorization SET ${mutation}`);
    await expect(parses.reserve(scope, request)).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REJECTED');
    expect(await client`SELECT parse_run_id FROM dm_document_parse_run`).toHaveLength(0);
  });

  it('only supersedes an errored parse after its active lease is released, preserving the original error', async () => {
    const browserScope = { tenantId: scope.tenantId, actorUserId: scope.actorUserId, documentVersionId: scope.documentVersionId };
    const prior = await parses.reserve(browserScope, request);
    const claim = await leases.claim(browserScope, prior.row.parseRunId, 'official-worker');
    await parses.stage(browserScope, prior.row.parseRunId, claim!);
    await parses.recordStepFailure(browserScope, claim!, 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED');
    const localRequest = { ...request, requestId: 'local-recovery', sourceBinding: { ...source,
      parserInput: { mode: 'LOCAL_MINERU_IMPORT' as const, bucketId: 'bucket-test', filePath: 'candidate.json',
        providerObjectId: 'candidate-object', sha256: 'b'.repeat(64), byteLength: 900 } } };
    await expect(parses.reserve(browserScope, localRequest)).rejects.toThrow('DOCUMENT_PARSE_ALREADY_RUNNING');
    expect((await parses.read(browserScope, prior.row.parseRunId))?.status).toBe('STAGING');
    await leases.release(browserScope, claim!);
    const next = await parses.reserve(browserScope, localRequest);
    expect(next.row.parseRevision).toBe(2);
    expect(await parses.read(browserScope, prior.row.parseRunId)).toMatchObject({ status: 'FAILED', errorCode: 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED' });
    expect((await parses.reserve(browserScope, localRequest)).row.parseRunId).toBe(next.row.parseRunId);
    await expect(parses.reserve(browserScope, { ...localRequest, sourceBinding: { ...localRequest.sourceBinding,
      parserInput: { ...localRequest.sourceBinding.parserInput, sha256: 'c'.repeat(64) } } })).rejects.toThrow('DOCUMENT_PARSE_REQUEST_CONFLICT');
  });

  it('holds the grant row lock until the document transaction completes', async () => {
    await contender`SET lock_timeout='150ms'`;
    await database.transaction(async transaction => {
      await leases.assertAutomaticWorkItem(transaction as never, scope);
      await expect(contender`UPDATE auto_work_item_authorization SET lease_generation=8`)
        .rejects.toMatchObject({ code: '55P03' });
    });
    await contender`UPDATE auto_work_item_authorization SET lease_generation=8`;
    await expect(parses.reserve(scope, request)).rejects.toThrow('DOCUMENT_AUTOMATIC_LEASE_REJECTED');
  });
});
