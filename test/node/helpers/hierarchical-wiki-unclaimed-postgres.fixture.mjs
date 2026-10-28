import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The existing fixture predates configured-model capture and native browser
// reads. Add only their local constructed inputs; attempt/Wiki RLS stays real.
export async function configureUnclaimedWikiPostgres(admin) {
  // The constructed base fixture predates the real Wiki Matter-catalog query.
  // Match its required association columns to 0014/0032 (and schema.ts), even
  // when these two relations contain no rows. Do not stub the catalog reader.
  await admin.unsafe(`ALTER TABLE engineering_matter_material_link
    ADD COLUMN tenant_id varchar(128) NOT NULL, ADD COLUMN material_id varchar(96) NOT NULL;
    ALTER TABLE engineering_matter_revision_work_item ADD COLUMN tenant_id varchar(128) NOT NULL;`);
  await admin.unsafe(
    await readFile('server/database/canonical-model-setting.ddl.sql', 'utf8'),
  );
  // The real repository reads the column added by the existing 0084 migration.
  // Keep the disposable fixture on that schema; do not replace model capture.
  await admin.unsafe((await readFile('migrations/0084_canonical_model_output_budgets.sql', 'utf8'))
    .replaceAll('workspace_aadkpkjef3slu', 'public'));
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

// next deliberately returns a public diagnostic. Preserve the underlying
// failure for this owned, synthetic fixture without logging SQL, parameters,
// source text or a sealed task. Drizzle's outer message can contain all of them.
function prepareFailure(error) {
  const chain = [];
  const seen = new Set();
  for (let item = error; item && typeof item === 'object' && !seen.has(item) && chain.length < 4; item = item.cause) {
    seen.add(item);
    const message = typeof item.message === 'string' ? item.message.split('\n')[0] : '';
    chain.push({
      name: /^[A-Za-z][A-Za-z0-9]*$/u.test(item.name ?? '') ? item.name : 'Error',
      code: /^[A-Z0-9_]+$/u.test(item.code ?? '') ? item.code : null,
      message: /^[A-Z][A-Z0-9_:-]+$/u.test(message)
        || /^(?:column|relation|function) [A-Za-z0-9_." (),]+ does not exist$/u.test(message)
        ? message : '[message omitted; SQL and values are not logged]',
      locations: [...String(item.stack ?? '').matchAll(/(?:server|test)\/[A-Za-z0-9_./-]+\.(?:ts|mjs):\d+:\d+/gu)]
        .slice(0, 5).map(match => match[0]),
    });
  }
  return chain;
}

async function observeRowLock(admin, waitingPid, blockingPid, stage, evidence, table = 'action_attempt') {
  const statements = {
    action_attempt: /action_attempt.*for update/iu,
    hierarchical_wiki_scope: /FROM hierarchical_wiki_scope[\s\S]*ORDER BY wiki_id FOR UPDATE/u,
    derived_summary: /^select "summary_id" from "derived_summary" where \("derived_summary"\."tenant_id" = \$1 and "derived_summary"\."actor_user_id" = \$2 and "derived_summary"\."summary_id" = \$3\) for update$/iu,
  };
  assert.ok(statements[table], 'only the specifically expected lock statement is observable');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] =
      await admin`SELECT pg_blocking_pids(${waitingPid}) AS blockers,wait_event_type,query
      FROM pg_stat_activity WHERE pid=${waitingPid}`;
    if (row?.blockers.includes(blockingPid)) {
      assert.equal(row.wait_event_type, 'Lock');
      assert.match(row.query, statements[table]);
      evidence.lockWaits.push({
        stage,
        waitingPid,
        blockingPid,
        waitEventType: row.wait_event_type,
        table,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`No real ${table} row lock wait: ${stage}`);
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
  const prepare = async (admittedAt = Date.now(), existingActor = null) => {
    await f.admin`UPDATE hierarchical_wiki_scope SET enabled=false`;
    const actorId = existingActor?.userId ?? `wiki-pg-${++caseNumber}`;
    if (!existingActor) {
      await f.admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
      VALUES(${actorId},${f.owner.tenantId},'cli_aadde8b579f95bc9','ACTIVE')`;
      await f.admin`INSERT INTO summary_test_document_acl VALUES(${f.owner.tenantId},${actorId},'DV-old',true)`;
    }
    const actor = existingActor ?? f.nativeActor(actorId, f.owner.tenantId);
    const fleetModelId = existingActor ? null : 'B787-9';
    const first = await browser(actor, () =>
      f.wiki.enable(
        {
          fleetFamilyId: 'B787',
          fleetModelId,
          modelRef: 'miaoda/glm-5.3',
        },
        actor,
      ),
    );
    const root = first.items.find((item) => item.scope.kind === 'FLEET'
      && JSON.stringify(item.scope.fleetModelIds) === JSON.stringify(fleetModelId ? [fleetModelId] : []));
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
    const failures = [];
    const originalActorTransaction = f.actors.withActorTransaction;
    f.actors.withActorTransaction = async function (...args) {
      try {
        return await originalActorTransaction.apply(this, args);
      } catch (error) {
        failures.push(prepareFailure(error));
        throw error;
      }
    };
    let selected;
    try {
      selected = await atAdmissionTime(admittedAt, () =>
        hosted(() =>
          f.wiki.next(new Date(Date.now() + 3 * 60 * 60_000).toISOString()),
        ),
      );
    } finally {
      f.actors.withActorTransaction = originalActorTransaction;
    }
    assert.equal(selected.status, 'SUMMARY_PENDING', JSON.stringify({
      stage: 'prepare.next', status: selected.status, errorCodes: selected.errorCodes ?? [], failures,
    }));
    const target = {
      summaryId: selected.summaryId,
      attemptRef: selected.attemptRef,
      scope: f.serviceScope,
    };
    const p = { actor, target, rootSummaryId: root.summaryId };
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
  // The existing directory pause button is an explicit owner mutation. Reads
  // and polling never call it. Disabling keeps the old request's backoff intact.
  const maintain = (p, service = f.wiki, input = { enabled: false }) =>
    browser(p.actor, () => service.update(p.target.summaryId, input, p.actor));
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
    'repeated physical GETs are read-only; explicit owner maintenance is idempotent under competition',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const beforeRegistry = await registry(p);
      const reads = await Promise.all([read(p), read(p, f.concurrentWiki)]);
      for (const listed of reads) assert.equal(item(listed, p).state, 'QUEUED');
      await read(p);
      assert.deepEqual(await attempt(p), p.before);
      assert.deepEqual(await registry(p), beforeRegistry);
      const [one, two] = await Promise.all([
        maintain(p),
        maintain(p, f.concurrentWiki),
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
      assert.equal(retried.state_json.retryCount, 1);
      await read(p);
      await read(p);
      assert.equal((await attempt(p)).row_version, expired.row_version);
      assert.equal((await registry(p)).row_version, retried.row_version);
      const [count] =
        await f.admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${p.target.summaryId}`;
      assert.equal(count.n, 1);
      record('GET read-only + explicit expiration concurrent/repeated idempotency', {
        statusAfter: expired.status,
        retryCount: 1,
        immutableOriginalPreserved: true,
      });
    },
  );

  for (const excluded of ['disabled', 'other-principal', 'inactive-identity'])
    await t.test(`next exclusion ${excluded} never becomes authority through GET`, async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const originalPrincipal = f.serviceScope.principalId;
      try {
        if (excluded === 'disabled')
          await f.admin`UPDATE hierarchical_wiki_scope SET enabled=false WHERE actor_user_id=${p.actor.userId}`;
        // Change only the constructed current caller configuration. The old
        // registry, request command, task seal and principal remain unchanged.
        if (excluded === 'other-principal') f.serviceScope.principalId = 'different-current-service';
        if (excluded === 'inactive-identity')
          await f.admin`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id=${p.actor.userId}`;
        const before = await registry(p);
        await read(p);
        await read(p, f.concurrentWiki);
        await hosted(() => f.wiki.next());
        assert.deepEqual(await attempt(p), p.before);
        assert.deepEqual(await registry(p), before);
        if (excluded === 'inactive-identity') {
          await assert.rejects(maintain(p), error => error.message === 'DERIVED_SUMMARY_ACTOR_UNAVAILABLE');
          assert.deepEqual(await attempt(p), p.before);
          assert.deepEqual(await registry(p), before);
        } else {
          // Disabled pages use their existing explicit Resume action; other
          // principal pages use Pause. Neither action dispatches a new attempt.
          await maintain(p, f.wiki, { enabled: excluded === 'disabled' });
          const expired = await attempt(p), after = await registry(p);
          assert.equal(expired.status, 'TIMED_OUT');
          assert.deepEqual(frozen(expired), frozen(p.before));
          assert.equal(after.enabled, excluded === 'disabled');
          assert.equal(after.state_json.active, null);
          assert.equal(after.state_json.retryCount, 1);
          assert.equal(after.delegated_principal_id, before.delegated_principal_id);
          const [count] = await f.admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${p.target.summaryId}`;
          assert.equal(count.n, 1);
        }
        record(`next exclusion ${excluded}, pure reads and original owner boundary`, { excluded });
      } finally {
        f.serviceScope.principalId = originalPrincipal;
        if (excluded === 'inactive-identity')
          await f.admin`UPDATE identity_subject_mapping SET status='ACTIVE' WHERE miaoda_user_id=${p.actor.userId}`;
      }
    });

  await t.test('two physical owner updates lock both Fleet roots in one order after their distinct attempt passes', async () => {
    const admittedAt = Date.now() - 2 * 60 * 60_000;
    const a = await prepare(admittedAt), b = await prepare(admittedAt, a.actor);
    assert.notEqual(a.rootSummaryId, b.rootSummaryId);
    assert.notEqual(a.target.attemptRef, b.target.attemptRef);
    // Both genuine reservations were admitted through next. The second setup
    // temporarily disabled the first scope to keep its original request intact.
    await f.admin`UPDATE hierarchical_wiki_scope SET enabled=true WHERE actor_user_id=${a.actor.userId}`;
    const roots = await f.admin`SELECT wiki_id FROM hierarchical_wiki_scope
      WHERE actor_user_id=${a.actor.userId} AND scope_json->>'kind'='FLEET' ORDER BY wiki_id`;
    assert.equal(roots.length, 2); // family root and its distinct model-specific root
    const { PgDialect } = require('drizzle-orm/pg-core');
    const dialect = new PgDialect();
    const entries = [
      { repository: f.repository, service: f.wiki, p: a },
      { repository: f.concurrentRepository, service: f.concurrentWiki, p: b },
    ].map(entry => ({ ...entry, browser: entry.repository.browser.bind(entry.repository),
      reached: deferred(), enter: deferred(), locked: deferred(), release: deferred(), seen: false, locks: [] }));
    async function bounded(promise, label) {
      let timer;
      try {
        return await Promise.race([promise, new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`WIKI_CROSS_ROOT_BARRIER_TIMEOUT:${label}`)), 5000);
        })]);
      } finally { clearTimeout(timer); }
    }
    for (const entry of entries) {
      entry.repository.browser = (actor, operation) => entry.browser(actor, async (database, owner) => {
        // Instrument the real transaction handed down by the authorized
        // repository, not the root pool or a replacement transaction.
        const execute = database.execute.bind(database);
        database.execute = async query => {
          const text = dialect.sqlToQuery(query).sql;
          if (text.includes('FROM hierarchical_wiki_scope') && text.includes('FOR UPDATE')) entry.locks.push(text);
          if (!entry.seen && text.includes('ORDER BY wiki_id FOR UPDATE')) {
            entry.seen = true;
            // The exact original is already terminal in this transaction,
            // while no Wiki root has yet been taken by this update.
            const [ownAttempt] = await execute(sql`SELECT status,claim_count,lease_generation
              FROM action_attempt WHERE operation_ref=${entry.p.target.attemptRef}`);
            assert.deepEqual({ ...ownAttempt }, { status: 'TIMED_OUT', claim_count: 0, lease_generation: 0 });
            entry.reached.resolve();
            await entry.enter.promise;
            const value = await execute(query);
            entry.locked.resolve();
            await entry.release.promise;
            return value;
          }
          return execute(query);
        };
        try { return await operation(database, owner); }
        finally { database.execute = execute; }
      });
    }
    const operations = entries.map(entry => outcome(browser(entry.p.actor, () =>
      entry.service.update(entry.p.rootSummaryId, { enabled: false }, entry.p.actor))));
    try {
      await bounded(Promise.all(entries.map((entry, index) => Promise.race([
        entry.reached.promise,
        operations[index].then(result => { throw result.error ?? new Error('Update missed root barrier'); }),
      ]))), 'both attempt passes');
      for (const entry of entries) {
        assert.match(entry.locks[0], /ORDER BY wiki_id FOR UPDATE/u);
        assert.doesNotMatch(entry.locks[0], /fleetFamilyId/u, 'no local root lock before the common root order');
      }
      entries[0].enter.resolve();
      await bounded(entries[0].locked.promise, 'first transaction owns all roots');
      entries[1].enter.resolve();
      await observeRowLock(f.admin, writerSession.pid, readSession.pid,
        'second exact target waits for common Fleet root order', evidence, 'hierarchical_wiki_scope');
      entries[0].release.resolve();
      entries[1].release.resolve();
      const results = await bounded(Promise.all(operations), 'both updates commit');
      for (const result of results) assert.equal(result.error, undefined);
      for (const p of [a, b]) {
        const ended = await attempt(p), row = await registry(p);
        assert.equal(ended.status, 'TIMED_OUT');
        assert.deepEqual(frozen(ended), frozen(p.before));
        assert.equal(row.state_json.active, null);
        assert.equal(row.state_json.retryCount, 1);
        const [count] = await f.admin`SELECT count(*)::int AS n FROM action_attempt WHERE summary_id=${p.target.summaryId}`;
        assert.equal(count.n, 1);
      }
      record('distinct Fleet roots, real ordered root wait and both exact updates commit once', {
        roots: roots.map(root => root.wiki_id), requestCount: 2, terminalCount: 2,
      });
    } finally {
      for (const entry of entries) { entry.enter.resolve(); entry.release.resolve(); }
      await Promise.all(operations);
      for (const entry of entries) entry.repository.browser = entry.browser;
    }
  });

  await t.test(
    'normal next expires the old reservation and preserves original failure/model/source seals',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      await f.admin`UPDATE action_attempt SET error_code='WIKI_FIXTURE_ORIGINAL_CAUSE',terminal_reason='ORIGINAL_FIXTURE_REASON'
      WHERE operation_ref=${p.target.attemptRef}`;
      await hosted(() => f.wiki.next());
      const expired = await attempt(p),
        r = await registry(p);
      assert.equal(expired.status, 'TIMED_OUT');
      assert.equal(expired.error_code, 'WIKI_FIXTURE_ORIGINAL_CAUSE');
      assert.equal(expired.terminal_reason, 'ORIGINAL_FIXTURE_REASON');
      assert.deepEqual(frozen(expired), frozen(p.before));
      assert.equal(r.state_json.active, null);
      assert.equal(item(await read(p), p).activeRequest, null);
      assert.equal(
        r.state_json.lastAttemptErrorCode,
        'WIKI_FIXTURE_ORIGINAL_CAUSE',
      );
      record('next expiration preserves original cause and frozen input', {
        statusAfter: expired.status,
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
      await assert.rejects(browser(other, () => f.wiki.update(p.target.summaryId, { enabled: false }, other)),
        error => error.message === 'WIKI_UNAVAILABLE');
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
    'a real CLAIM winning the row lock remains RUNNING after explicit maintenance observes the hard deadline',
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
        get = outcome(maintain(p));
        await observeRowLock(
          f.admin,
          readSession.pid,
          writerSession.pid,
          'explicit maintenance waits for earlier CLAIM',
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
    'explicit owner expiration winning the real row lock makes a competing CLAIM observe TIMED_OUT',
    async () => {
      const p = await prepare(Date.now() - 2 * 60 * 60_000);
      const reached = deferred(),
        release = deferred();
      const originalBrowser = f.repository.browser.bind(f.repository);
      const originalLockContext = f.concurrentRepository.lockContext;
      let exactClaimContext = false;
      f.concurrentRepository.lockContext = async function (basis, owner, database, summaryId) {
        assert.equal(owner.tenantId, f.owner.tenantId);
        assert.equal(owner.actorUserId, p.actor.userId);
        assert.equal(summaryId, p.target.summaryId);
        exactClaimContext = true;
        return originalLockContext.call(this, basis, owner, database, summaryId);
      };
      f.repository.browser = (actor, operation) =>
        originalBrowser(actor, async (...args) => {
          const value = await operation(...args);
          const pending = await args[0].execute(sql`SELECT status,claim_count,lease_generation,lease_owner,lease_token
            FROM action_attempt WHERE attempt_id=${p.before.attempt_id} AND tenant_id=${f.owner.tenantId}
              AND actor_user_id=${p.actor.userId}`);
          assert.equal(pending.length, 1);
          assert.deepEqual({ ...pending[0] }, { status: 'TIMED_OUT', claim_count: 0, lease_generation: 0,
            lease_owner: null, lease_token: null });
          reached.resolve();
          await release.promise;
          return value;
        });
      const get = outcome(maintain(p));
      let claim;
      try {
        await Promise.race([
          reached.promise,
          get.then((result) => {
            throw (
              result.error ??
              new Error('Explicit maintenance returned before its transaction barrier')
            );
          }),
        ]);
        // The original maintenance has finished but has not committed. A
        // different physical reader still sees the immutable queued original.
        const beforeCommit = await attempt(p);
        assert.equal(beforeCommit.status, 'QUEUED');
        assert.equal(beforeCommit.claim_count, 0);
        assert.deepEqual(frozen(beforeCommit), frozen(p.before));
        claim = outcome(hosted(() => concurrentRuntime.claim(p.target)));
        // claimCurrent locks its exact context/summary head before the attempt.
        // At this existing end-of-transaction barrier it waits on that head,
        // not on a later action_attempt SELECT. Keep the specific SQL + PID proof.
        await observeRowLock(
          f.admin,
          writerSession.pid,
          readSession.pid,
          'exact CLAIM context head waits for uncommitted explicit expiration',
          evidence,
          'derived_summary',
        );
        assert.equal(exactClaimContext, true);
        release.resolve();
        const listed = await get,
          claimed = await claim;
        assert.equal(listed.error, undefined);
        assert.equal(claimed.error?.message, 'DERIVED_SUMMARY_TIMED_OUT');
        const ended = await attempt(p);
        assert.equal(ended.status, 'TIMED_OUT');
        assert.equal(ended.claim_count, 0);
        assert.equal(ended.lease_generation, 0);
        assert.equal(ended.lease_owner, null);
        assert.equal(ended.lease_token, null);
        assert.equal(ended.lease_expires_at, null);
        assert.deepEqual(frozen(ended), frozen(p.before));
        assert.equal((await registry(p)).state_json.active, null);
        assert.equal((await registry(p)).state_json.retryCount, 1);
        record(
          'explicit timeout wins actual row lock and competing CLAIM cannot revive',
          { claimError: claimed.error.message, observedWaitTable: 'derived_summary',
            beforeCommitStatus: beforeCommit.status, afterCommitStatus: ended.status, claimCount: 0, leaseGeneration: 0 },
        );
      } finally {
        release.resolve();
        await get;
        if (claim) await claim;
        f.repository.browser = originalBrowser;
        f.concurrentRepository.lockContext = originalLockContext;
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
      // This constructed document has no Matter association. The sealed
      // catalog, not a universal heading or every task ref, defines its section.
      const catalog = lease.task.contextBasis?.wikiMatterCatalog;
      assert.ok(catalog, 'the real claimed task carries its sealed Wiki Matter catalog');
      assert.equal(catalog.schemaVersion, 'wiselink.wiki-matter-catalog.v1');
      assert.deepEqual(catalog.entries, []);
      assert.ok(catalog.unbound.length > 0);
      const bodyRefs = [...new Set(catalog.unbound.flatMap(binding => [binding.memberRef, ...binding.sourceRefs]))];
      const registered = new Set([...refs, ...sources]);
      assert.ok(bodyRefs.every(ref => registered.has(ref)));
      assert.ok(catalog.unbound.some(binding => binding.sourceRefs.some(ref => sources.includes(ref))),
        'the unbound section cites actual supporting source evidence');
      const body = `## 未归属资料\n\n${bodyRefs.map(ref => `[[${ref}]]`).join(' ')}`;
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
              body,
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
