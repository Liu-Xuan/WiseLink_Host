import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The existing fixture predates configured-model capture and native browser
// reads. Add only their local constructed inputs; attempt/Wiki RLS stays real.
export async function configureUnclaimedWikiPostgres(admin) {
  await admin.unsafe(
    await readFile('server/database/canonical-model-setting.ddl.sql', 'utf8'),
  );
  await admin.unsafe(
    await readFile(
      'migrations/0057_model_setting_authenticated_tenant_read.sql',
      'utf8',
    ),
  );
  await admin.unsafe(`GRANT SELECT ON canonical_model_setting TO authenticated,service_role;
    INSERT INTO canonical_model_setting(tenant_id,revision,model_ref,changed_by_user_id)
      VALUES('tenant-summary',1,'miaoda/glm-5.3','actor-summary');
    ALTER TABLE dm_document_version ADD COLUMN acquisition_id varchar, ADD COLUMN document_id varchar;
    ALTER TABLE dm_publication_family ADD COLUMN canonical_identity_key varchar;
    CREATE TABLE dm_source_artifact(source_artifact_id varchar,readback_verified boolean,sha256 varchar,byte_length bigint);
    CREATE TABLE dm_acquisition(acquisition_id varchar,document_version_id varchar,source_artifact_id varchar,idempotency_key varchar,status varchar);
    CREATE FUNCTION engineering_matter_uri_component(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;
    UPDATE dm_document_version SET acquisition_id='ACQ-summary',document_id='DOC-summary' WHERE document_version_id='DV-old';
    UPDATE dm_publication_family SET canonical_identity_key='tenant:tenant-summary:family:synthetic';
    GRANT SELECT ON dm_source_artifact,dm_acquisition TO authenticated,service_role;`);
  await admin`INSERT INTO dm_source_artifact VALUES('SRC-summary',true,${'a'.repeat(64)},100)`;
  await admin`INSERT INTO dm_acquisition VALUES('ACQ-summary','DV-old','SRC-summary','tenant:tenant-summary:request:synthetic','COMMITTED_CANONICAL')`;
  const nativeRead = await readFile(
    'migrations/0078_native_tenant_shared_read.sql',
    'utf8',
  );
  for (const name of [
    'native_app_shared_read_allowed',
    'native_app_work_item_readable',
    'native_app_document_readable',
  ]) {
    const statement = nativeRead.match(
      new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`, 'u'),
    )?.[0];
    assert.ok(statement, `existing ${name} definition is present`);
    // Same SQL admission/receipt predicate, bound to this fixture's schema/tenant.
    await admin.unsafe(
      statement
        .replaceAll('workspace_aadkpkjef3slu', 'public')
        .replaceAll("'63849986'", "'tenant-summary'"),
    );
  }
}

export function unclaimedWikiModelSettings(database) {
  const {
    CanonicalModelSettingsRepository,
  } = require('../../../server/modules/model-settings/canonical-model-settings.repository.ts');
  const {
    CanonicalModelSettingsService,
  } = require('../../../server/modules/model-settings/canonical-model-settings.service.ts');
  return new CanonicalModelSettingsService(
    new CanonicalModelSettingsRepository(database),
  );
}

// Fixtures control service time only while admitting an immutable original
// request. PG keeps its real engine/locks/RLS/clock; no deadline trigger is disabled.
async function atAdmissionTime(instant, operation) {
  const OriginalDate = globalThis.Date;
  class AdmissionDate extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
    static now() {
      return instant;
    }
  }
  globalThis.Date = AdmissionDate;
  try {
    return await operation();
  } finally {
    globalThis.Date = OriginalDate;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function outcome(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}

async function observeRowLock(admin, waitingPid, blockingPid, stage, evidence) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] =
      await admin`SELECT pg_blocking_pids(${waitingPid}) AS blockers,wait_event_type,query
      FROM pg_stat_activity WHERE pid=${waitingPid}`;
    if (row?.blockers.includes(blockingPid)) {
      assert.equal(row.wait_event_type, 'Lock');
      assert.match(row.query, /action_attempt.*for update/iu);
      evidence.lockWaits.push({
        stage,
        waitingPid,
        blockingPid,
        waitEventType: row.wait_event_type,
        table: 'action_attempt',
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`No real action_attempt row lock wait: ${stage}`);
}

export async function verifyUnclaimedWikiPostgres(t, f, evidence) {
  const { sql } = require('drizzle-orm');
  const {
    DerivedSummaryRuntimeService,
  } = require('../../../server/modules/canonical-host/derived-summary-runtime.service.ts');
  const {
    HierarchicalWikiCompletion,
  } = require('../../../server/modules/canonical-host/hierarchical-wiki-completion.ts');
  const {
    reconcileWikiReservations,
  } = require('../../../server/modules/canonical-host/hierarchical-wiki-attempt-reconciliation.ts');
  const {
    wikiRows,
  } = require('../../../server/modules/canonical-host/hierarchical-wiki.persistence.ts');
  const concurrentRuntime = new DerivedSummaryRuntimeService(
    f.concurrentRepository,
    f.members,
    f.summaries,
    new HierarchicalWikiCompletion(),
  );
  const hosted = (operation) => f.run('-1', true, operation);
  let caseNumber = 0;
  const browser = (actor, operation) => f.run(actor.userId, false, operation);
  const [readSession] = await f.client`SELECT pg_backend_pid() AS pid`;
  const [writerSession] =
    await f.concurrentClient`SELECT pg_backend_pid() AS pid`;
  assert.notEqual(readSession.pid, writerSession.pid);
  evidence.physicalConnections = {
    reader: readSession.pid,
    writer: writerSession.pid,
  };

  const attempt = async (p) =>
    (
      await f.admin`SELECT *,xmin::text AS row_version FROM action_attempt
    WHERE operation_ref=${p.target.attemptRef}`
    )[0];
  const registry = async (p) =>
    (
      await f.admin`SELECT *,xmin::text AS row_version FROM hierarchical_wiki_scope
    WHERE summary_id=${p.target.summaryId}`
    )[0];
  const frozen = (row) => ({
    attemptId: row.attempt_id,
    operationRef: row.operation_ref,
    requestId: row.trigger_request_id,
    tenantId: row.tenant_id,
    actorId: row.actor_user_id,
    deadlineAt: row.deadline_at.toISOString(),
    requestOrigin: row.request_origin,
    taskEnvelopeJson: row.task_envelope_json,
    taskInputHash: row.task_input_hash,
    commandJson: row.summary_request_command_json,
    executionModelJson: row.execution_model_json,
    principalId: row.summary_delegated_principal_id,
  });
  const scheduling = (state) => ({
    retryCount: state.retryCount,
    blocked: state.blocked,
    dueAt: state.dueAt,
    versions: state.versions,
    waiting: state.waiting,
    desiredGeneration: state.desiredGeneration,
  });
  const prepare = async (admittedAt = Date.now()) => {
    await f.admin`UPDATE hierarchical_wiki_scope SET enabled=false`;
    const actorId = `wiki-pg-${++caseNumber}`;
    await f.admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
      VALUES(${actorId},${f.owner.tenantId},'cli_aadde8b579f95bc9','ACTIVE')`;
    await f.admin`INSERT INTO summary_test_document_acl VALUES(${f.owner.tenantId},${actorId},'DV-old',true)`;
    const actor = f.nativeActor(actorId, f.owner.tenantId);
    const first = await browser(actor, () =>
      f.wiki.enable(
        {
          fleetFamilyId: 'B787',
          fleetModelId: 'B787-9',
          modelRef: 'miaoda/glm-5.3',
        },
        actor,
      ),
    );
    const root = first.items.find((item) => item.scope.kind === 'FLEET');
    assert.equal(root.activeRequest, null);
    await browser(actor, () =>
      f.wiki.classify(
        root.summaryId,
        {
          sourceKind: 'DOCUMENT',
          sourceId: 'FAMILY-summary',
          ata: '46-00',
          included: true,
        },
        actor,
      ),
    );
    const selected = await atAdmissionTime(admittedAt, () =>
      hosted(() =>
        f.wiki.next(new Date(Date.now() + 3 * 60 * 60_000).toISOString()),
      ),
    );
    assert.equal(selected.status, 'SUMMARY_PENDING');
    const target = {
      summaryId: selected.summaryId,
      attemptRef: selected.attemptRef,
      scope: f.serviceScope,
    };
    const p = { actor, target };
    p.before = await attempt(p);
    assert.equal(p.before.status, 'QUEUED');
    assert.equal(p.before.claim_count, 0);
    assert.equal(p.before.lease_generation, 0);
    assert.equal(
      JSON.parse(p.before.execution_model_json).modelRef,
      'miaoda/glm-5.3',
    );
    return p;
  };
  const read = (p, service = f.wiki) =>
    browser(p.actor, () => service.list(p.actor));
  const item = (list, p) =>
    list.items.find((row) => row.summaryId === p.target.summaryId);
  const waitPastDeadline = async (p) => {
    const wait = p.before.deadline_at.getTime() - Date.now() + 20;
    assert.ok(wait < 7000, 'only a short constructed deadline is awaited');
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    assert.ok(p.before.deadline_at.getTime() < Date.now());
  };
  const record = (name, details) =>
    evidence.cases.push({ name, status: 'PASS', ...details });

  await t.test(
    'real GET expiration CAS is idempotent under competing physical readers',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const original = await registry(p);
      const before = { ...original.state_json, retryCount: 2 };
      await f.admin`UPDATE hierarchical_wiki_scope SET state_json=${f.admin.json(before)}
        WHERE summary_id=${p.target.summaryId}`;
      const [one, two] = await Promise.all([
        read(p),
        read(p, f.concurrentWiki),
      ]);
      assert.equal(item(one, p).errorCode, 'DERIVED_SUMMARY_DEADLINE_EXCEEDED');
      assert.equal(item(two, p).errorCode, 'DERIVED_SUMMARY_DEADLINE_EXCEEDED');
      assert.equal(item(one, p).activeRequest, null);
      assert.equal(item(two, p).activeRequest, null);
      const expired = await attempt(p),
        retried = await registry(p);
      assert.equal(expired.status, 'TIMED_OUT');
      assert.equal(expired.error_code, 'DERIVED_SUMMARY_DEADLINE_EXCEEDED');
      assert.equal(expired.claim_count, 0);
      assert.equal(expired.lease_generation, 0);
      assert.ok(expired.completed_at);
      assert.deepEqual(frozen(expired), frozen(p.before));
      assert.equal(retried.state_json.active, null);
      assert.equal(retried.state_json.retryCount, 2);
      assert.deepEqual(scheduling(retried.state_json), scheduling(before));
      await read(p);
      await read(p);
      assert.equal((await attempt(p)).row_version, expired.row_version);
      assert.equal((await registry(p)).row_version, retried.row_version);
      const [count] =
        await f.admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${p.target.summaryId}`;
      assert.equal(count.n, 1);
      record('GET expiration + concurrent/repeated idempotency', {
        statusAfter: expired.status,
        retryCount: 2,
        immutableOriginalPreserved: true,
      });
    },
  );

  await t.test(
    'normal next preserves retry two, re-reserves once in the same tick and reuses the new request',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const original = await registry(p);
      const before = { ...original.state_json, retryCount: 2,
        dueAt: new Date(Date.now() - 1000).toISOString() };
      await f.admin`UPDATE hierarchical_wiki_scope SET state_json=${f.admin.json(before)}
        WHERE summary_id=${p.target.summaryId}`;
      await f.admin`UPDATE action_attempt SET error_code='WIKI_FIXTURE_ORIGINAL_CAUSE',terminal_reason='ORIGINAL_FIXTURE_REASON'
      WHERE operation_ref=${p.target.attemptRef}`;
      const next = await hosted(() => f.wiki.next());
      const expired = await attempt(p),
        r = await registry(p);
      assert.equal(expired.status, 'TIMED_OUT');
      assert.equal(expired.error_code, 'WIKI_FIXTURE_ORIGINAL_CAUSE');
      assert.equal(expired.terminal_reason, 'ORIGINAL_FIXTURE_REASON');
      assert.deepEqual(frozen(expired), frozen(p.before));
      assert.equal(next.status, 'SUMMARY_PENDING');
      assert.equal(next.summaryId, p.target.summaryId);
      assert.notEqual(next.attemptRef, p.target.attemptRef);
      assert.equal(r.state_json.active.attemptRef, next.attemptRef);
      assert.deepEqual(scheduling(r.state_json), scheduling(before));
      assert.equal(item(await read(p), p).activeRequest.attemptRef, next.attemptRef);
      const again = await hosted(() => f.wiki.next());
      assert.equal(again.status, 'SUMMARY_PENDING');
      assert.equal(again.summaryId, next.summaryId);
      assert.equal(again.attemptRef, next.attemptRef);
      assert.deepEqual(scheduling((await registry(p)).state_json), scheduling(before));
      const [count] = await f.admin`SELECT count(*)::int AS n FROM action_attempt
        WHERE summary_id=${p.target.summaryId}`;
      assert.equal(count.n, 2);
      assert.equal(
        r.state_json.lastAttemptErrorCode,
        'WIKI_FIXTURE_ORIGINAL_CAUSE',
      );
      record('next expiration preserves budget/input and re-reserves exactly once', {
        statusAfter: expired.status,
        retryCount: r.state_json.retryCount,
        sameTickNewReservation: true,
        secondNextReusesReservation: true,
        originalCauseAndSealsPreserved: true,
      });
    },
  );

  await t.test(
    'unexpired QUEUED stays queued without extending or rewriting the immutable original',
    async () => {
      const p = await prepare();
      const listed = item(await read(p), p);
      assert.equal(listed.state, 'QUEUED');
      assert.deepEqual(listed.activeRequest, {
        requestId: p.before.trigger_request_id,
        attemptRef: p.target.attemptRef,
        status: 'QUEUED',
        claimCount: 0,
        executorSessionKey: null,
      });
      const exact = await browser(p.actor, () =>
        f.summaries.status(
          listed.summaryId,
          listed.activeRequest.attemptRef,
          p.actor,
        ),
      );
      assert.equal(exact.attemptRef, listed.activeRequest.attemptRef);
      assert.equal(exact.summaryId, listed.summaryId);
      assert.equal(exact.status, listed.activeRequest.status);
      await assert.rejects(
        browser(p.actor, () =>
          f.summaries.status(listed.summaryId, 'AQ-unrelated-fixture', p.actor),
        ),
        (error) => error.message === 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE',
      );

      // The read model distinguishes an absent legacy counter from a real zero.
      const originalAttempt = f.repository.attempt.bind(f.repository);
      try {
        f.repository.attempt = async (...args) => {
          const value = await originalAttempt(...args);
          return value.operationRef === p.target.attemptRef
            ? { ...value, claimCount: undefined, executorSessionKey: undefined }
            : value;
        };
        const missing = item(await read(p), p).activeRequest;
        assert.equal(missing.claimCount, null);
        assert.equal(missing.executorSessionKey, null);
        f.repository.attempt = async (...args) => {
          const value = await originalAttempt(...args);
          return value.operationRef === p.target.attemptRef
            ? { ...value, triggerRequestId: 'different-current-request-fixture' }
            : value;
        };
        await assert.rejects(
          read(p),
          (error) => error.message === 'WIKI_ATTEMPT_BINDING_MISMATCH',
        );
      } finally {
        f.repository.attempt = originalAttempt;
      }
      const row = await attempt(p),
        r = await registry(p);
      await f.admin`UPDATE hierarchical_wiki_scope SET state_json=${f.admin.json({
        ...r.state_json,
        lastAttemptErrorCode: 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
      })} WHERE summary_id=${p.target.summaryId}`;
      const priorError = item(await read(p), p);
      assert.equal(priorError.errorCode, 'DERIVED_SUMMARY_DEADLINE_EXCEEDED');
      assert.equal(priorError.activeRequest.status, 'QUEUED');
      assert.equal(priorError.activeRequest.attemptRef, p.target.attemptRef);
      const next = await hosted(() => f.wiki.next());
      assert.equal(next.attemptRef, p.target.attemptRef);
      await read(p);
      assert.equal((await attempt(p)).row_version, row.row_version);
      assert.equal(
        (await registry(p)).state_json.active.attemptRef,
        r.state_json.active.attemptRef,
      );
      assert.deepEqual(frozen(await attempt(p)), frozen(p.before));
      record('unexpired QUEUED unchanged', {
        presentedState: 'QUEUED',
        exactStatusBinding: true,
        missingMetadataNull: true,
        mismatchedRequestRejected: true,
      });
    },
  );

  await t.test(
    'SQL roles, other owner/tenant and TENANT read cannot expire another original',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const other = f.nativeActor('other-actor', f.owner.tenantId);
      const otherListing = await browser(other, () => f.wiki.list(other));
      assert.equal(item(otherListing, p)?.activeRequest ?? null, null);
      await browser(other, () =>
        f.repository.browser(other, async (database) => {
          const [role] =
            await database.execute(sql`SELECT current_user AS role,rolsuper,rolbypassrls
        FROM pg_roles WHERE rolname=current_user`);
          assert.equal(role.role, 'authenticated_public');
          assert.equal(role.rolsuper, false);
          assert.equal(role.rolbypassrls, false);
          const rows = await database.execute(
            sql`SELECT attempt_id FROM action_attempt WHERE operation_ref=${p.target.attemptRef}`,
          );
          assert.equal(rows.length, 0);
          const updated =
            await database.execute(sql`UPDATE action_attempt SET status='TIMED_OUT'
        WHERE operation_ref=${p.target.attemptRef} RETURNING attempt_id`);
          assert.equal(updated.length, 0);
        }),
      );
      await f.admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
      VALUES('wiki-other-tenant','wiki-tenant-other','cli_aadde8b579f95bc9','ACTIVE')`;
      const foreign = f.nativeActor('wiki-other-tenant', 'wiki-tenant-other');
      await browser(foreign, () =>
        f.repository.browser(foreign, async (database) => {
          assert.equal(
            (
              await database.execute(
                sql`SELECT attempt_id FROM action_attempt WHERE operation_ref=${p.target.attemptRef}`,
              )
            ).length,
            0,
          );
          assert.equal(
            (
              await wikiRows(database, {
                tenantId: foreign.tenantId,
                actorUserId: foreign.userId,
              })
            ).length,
            0,
          );
        }),
      );
      await assert.rejects(
        browser(p.actor, () =>
          f.repository.readBrowser(p.actor, async (database, reader) =>
            reconcileWikiReservations(
              database,
              f.repository,
              reader,
              await wikiRows(database, reader),
              new Date().toISOString(),
            ),
          ),
        ),
        (error) => error.message === 'WIKI_OWNER_WRITE_SCOPE_REQUIRED',
      );
      assert.equal((await attempt(p)).row_version, p.before.row_version);
      assert.equal((await attempt(p)).status, 'QUEUED');
      record('authenticated NOBYPASSRLS owner/tenant/read-scope boundaries', {
        otherOwnerReadRows: 0,
        otherOwnerUpdatedRows: 0,
        foreignTenantReadRows: 0,
      });
    },
  );

  await t.test(
    'RLS-hidden source-bound attempt stays untouched and GET reports the explicit metadata block',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      await f.admin`UPDATE summary_test_document_acl SET allowed=false WHERE tenant_id=${f.owner.tenantId} AND actor_id=${p.actor.userId}`;
      const blocked = item(await read(p), p);
      assert.equal(blocked.state, 'BLOCKED');
      assert.equal(blocked.errorCode, 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE');
      assert.equal(blocked.activeRequest, null);
      assert.equal((await attempt(p)).row_version, p.before.row_version);
      assert.equal(
        (await registry(p)).state_json.active.attemptRef,
        p.target.attemptRef,
      );
      await f.admin`UPDATE summary_test_document_acl SET allowed=true WHERE tenant_id=${f.owner.tenantId} AND actor_id=${p.actor.userId}`;
      record('RLS-hidden attempt explicit BLOCKED without timeout', {
        errorCode: blocked.errorCode,
      });
    },
  );

  await t.test(
    'a real CLAIM winning the row lock remains RUNNING after GET observes the hard deadline',
    async () => {
      const p = await prepare(Date.now() - 60 * 60_000 + 6000);
      const reached = deferred(),
        release = deferred();
      const runtime = f.concurrentRepository.runtime.bind(
        f.concurrentRepository,
      );
      f.concurrentRepository.runtime = (target, operation) =>
        runtime(target, async (...args) => {
          const value = await operation(...args);
          reached.resolve();
          await release.promise;
          return value;
        });
      const claim = outcome(hosted(() => concurrentRuntime.claim(p.target)));
      let get;
      try {
        await Promise.race([
          reached.promise,
          claim.then((result) => {
            throw (
              result.error ??
              new Error('CLAIM returned before its transaction barrier')
            );
          }),
        ]);
        await waitPastDeadline(p);
        get = outcome(read(p));
        await observeRowLock(
          f.admin,
          readSession.pid,
          writerSession.pid,
          'GET waits for earlier CLAIM',
          evidence,
        );
        release.resolve();
        const claimed = await claim,
          listed = await get;
        assert.equal(claimed.error, undefined);
        assert.equal(listed.error, undefined);
        assert.equal(item(listed.value, p).state, 'RUNNING');
        const row = await attempt(p);
        assert.equal(row.status, 'RUNNING');
        assert.equal(row.claim_count, 1);
        assert.equal(row.lease_generation, 1);
        assert.deepEqual(item(listed.value, p).activeRequest, {
          requestId: row.trigger_request_id,
          attemptRef: row.operation_ref,
          status: row.status,
          claimCount: row.claim_count,
          executorSessionKey: row.executor_session_key,
        });
        assert.deepEqual(frozen(row), frozen(p.before));
        assert.equal(
          (await registry(p)).state_json.active.attemptRef,
          p.target.attemptRef,
        );
        await read(p);
        assert.equal((await attempt(p)).row_version, row.row_version);
        record(
          'CLAIM wins actual row lock, expired unknown RUNNING preserved',
          { claimCount: 1, leaseGeneration: 1 },
        );
      } finally {
        release.resolve();
        await claim;
        if (get) await get;
        f.concurrentRepository.runtime = runtime;
        await hosted(() =>
          f.runtime.cancel({
            ...p.target,
            reason: 'Owned isolated fixture cleanup',
          }),
        );
      }
    },
  );

  await t.test(
    'GET expiration winning the real row lock makes a competing CLAIM observe TIMED_OUT',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const reached = deferred(),
        release = deferred();
      const originalBrowser = f.repository.browser.bind(f.repository);
      f.repository.browser = (actor, operation) =>
        originalBrowser(actor, async (...args) => {
          const value = await operation(...args);
          reached.resolve();
          await release.promise;
          return value;
        });
      const get = outcome(read(p));
      let claim;
      try {
        await Promise.race([
          reached.promise,
          get.then((result) => {
            throw (
              result.error ??
              new Error('GET returned before its transaction barrier')
            );
          }),
        ]);
        claim = outcome(hosted(() => concurrentRuntime.claim(p.target)));
        await observeRowLock(
          f.admin,
          writerSession.pid,
          readSession.pid,
          'CLAIM waits for GET expiration',
          evidence,
        );
        release.resolve();
        const listed = await get,
          claimed = await claim;
        assert.equal(listed.error, undefined);
        assert.equal(claimed.error?.message, 'DERIVED_SUMMARY_TIMED_OUT');
        assert.equal((await attempt(p)).status, 'TIMED_OUT');
        assert.equal((await attempt(p)).claim_count, 0);
        assert.equal((await registry(p)).state_json.retryCount, 0);
        record(
          'GET timeout wins actual row lock and competing CLAIM cannot revive',
          { claimError: claimed.error.message },
        );
      } finally {
        release.resolve();
        await get;
        if (claim) await claim;
        f.repository.browser = originalBrowser;
      }
    },
  );

  await t.test(
    'concurrent actual SAVE and a saved terminal with stale registry never create another attempt',
    async () => {
      const p = await prepare(Date.now() - 60 * 60_000 + 6000);
      const lease = await hosted(() => concurrentRuntime.claim(p.target));
      const fence = {
        leaseToken: lease.leaseToken,
        leaseGeneration: lease.leaseGeneration,
      };
      const refs = lease.task.modelInput.members.map(
        (member) => member.evidenceRef,
      );
      const sources = lease.task.modelInput.evidence.map(
        (member) => member.evidenceRef,
      );
      await hosted(() =>
        concurrentRuntime.readMemberWork({
          ...p.target,
          ...fence,
          evidenceRefs: refs,
          purpose: 'Constructed exact member',
        }),
      );
      await hosted(() =>
        concurrentRuntime.readSources({
          ...p.target,
          ...fence,
          evidenceRefs: sources,
          purpose: 'Constructed exact original',
        }),
      );
      const state = (await registry(p)).state_json;
      const reached = deferred(),
        release = deferred();
      const runtime = f.concurrentRepository.runtime.bind(
        f.concurrentRepository,
      );
      f.concurrentRepository.runtime = (target, operation) =>
        runtime(target, async (...args) => {
          const value = await operation(...args);
          if (value.summaryRef) {
            reached.resolve();
            await release.promise;
          }
          return value;
        });
      const save = outcome(
        hosted(() =>
          concurrentRuntime.save({
            ...p.target,
            ...fence,
            requestId: lease.task.requestId,
            expectedSummaryRevision: lease.task.expectedSummaryRevision,
            contentJson: JSON.stringify({
              headline: 'Constructed saved Wiki',
              listBrief: 'No model invocation',
              body: [...refs, ...sources].map((ref) => `[[${ref}]]`).join(' '),
              limitations: ['Constructed original and candidate only.'],
            }),
          }),
        ),
      );
      try {
        await Promise.race([
          reached.promise,
          save.then((result) => {
            throw (
              result.error ??
              new Error('SAVE returned before its final transaction barrier')
            );
          }),
        ]);
        await waitPastDeadline(p);
        assert.equal(item(await read(p), p).state, 'RUNNING');
        release.resolve();
        const saved = await save;
        assert.equal(saved.error, undefined);
        assert.equal((await attempt(p)).status, 'RUNNING');
        // Only the existing explicit runtime CLAIM owns deadline terminalization;
        // GET never guesses a terminal status for this running/saved request.
        await assert.rejects(
          hosted(() => concurrentRuntime.claim(p.target)),
          (error) => error.message === 'DERIVED_SUMMARY_TIMED_OUT',
        );
        assert.equal((await attempt(p)).status, 'TIMED_OUT');
        // Construct a lost-registry-completion condition after a real, policy-checked SAVE.
        await f.admin`UPDATE hierarchical_wiki_scope SET state_json=${f.admin.json(state)} WHERE summary_id=${p.target.summaryId}`;
        const before = await registry(p),
          row = await attempt(p);
        const savedPending = item(await read(p), p);
        assert.equal(savedPending.errorCode, 'WIKI_SAVED_RESERVATION_PENDING');
        assert.equal((await registry(p)).row_version, before.row_version);
        assert.equal((await attempt(p)).row_version, row.row_version);
        const next = await hosted(() => f.wiki.next());
        assert.notEqual(next.attemptRef, p.target.attemptRef);
        const [count] =
          await f.admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${p.target.summaryId}`;
        assert.equal(count.n, 1);
        const [revision] =
          await f.admin`SELECT summary_ref FROM derived_summary_revision
        WHERE summary_id=${p.target.summaryId} AND request_id=${lease.task.requestId}`;
        assert.equal(revision.summary_ref, saved.value.summaryRef);
        assert.deepEqual(frozen(await attempt(p)), frozen(p.before));
        record(
          'actual SAVE commits after deadline observation; saved terminal/stale registry preserved',
          { savedRevisionRetained: true, originalAttemptCount: 1 },
        );
      } finally {
        release.resolve();
        await save;
        f.concurrentRepository.runtime = runtime;
      }
    },
  );
}
