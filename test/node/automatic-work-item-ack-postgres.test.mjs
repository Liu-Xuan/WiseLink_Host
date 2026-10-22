import assert from 'node:assert/strict';
import test from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { validateOwnedEndpoint } from '../pg/owned-postgres-cluster.mjs';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function usingFixture(body) {
  const fixture = await startCoreP1HostFixture();
  const port = fixture.ownership.instance.port;
  const database = fixture.ownership.database;
  const endpoint = `postgres://tdms_test_owner@127.0.0.1:${port}/${database}`;
  validateOwnedEndpoint(endpoint, { port, database });
  // The fixture's admin pool has one connection. Observe locks independently
  // so the observer cannot wait behind the transaction being measured.
  const observer = postgres(endpoint, { max: 1, prepare: false, onnotice() {} });
  try {
    await body(fixture, observer);
  } finally {
    await observer.end();
    await fixture.close();
  }
}

async function competeWithWorkItemWriter(fixture, observer, changeRevision) {
  await fixture.seed();
  const queue = await fixture.nextWorkItem({ resumeWorkItemId: 'WI-core-p1' });
  const before = await fixture.snapshot();
  const owner = before.workItems[0];
  const input = {
    tenantId: fixture.tenantId,
    workItemId: queue.workItemId,
    leaseOwner: before.grants[0].lease_owner,
    leaseToken: queue.leaseToken,
    leaseGeneration: queue.leaseGeneration,
    expectedWorkItemRevision: owner.revision,
    now: new Date(),
  };
  const held = deferred();
  const continueWriter = deferred();
  // Pause a competing transaction at the WorkItem lock used by SAVE/takeover.
  // The ACK itself is the actual repository implementation on actual PG/RLS.
  const writer = fixture.sql.begin(async (transaction) => {
    await transaction`SELECT work_item_id FROM work_item
      WHERE tenant_id=${fixture.tenantId} AND work_item_id=${queue.workItemId} FOR UPDATE`;
    held.resolve();
    await continueWriter.promise;
    await transaction`SELECT work_item_id FROM auto_work_item_authorization
      WHERE tenant_id=${fixture.tenantId} AND work_item_id=${queue.workItemId} FOR UPDATE`;
    if (changeRevision) await transaction`UPDATE work_item SET revision=revision+1
      WHERE tenant_id=${fixture.tenantId} AND work_item_id=${queue.workItemId}`;
  });
  const writerResult = writer.then(
    () => ({ status: 'fulfilled' }),
    (reason) => ({ status: 'rejected', reason }),
  );
  await held.promise;
  const acknowledgement = fixture.hosted(() =>
    fixture.workItems.acknowledgeAutoProcessingLease(input));
  const acknowledgementResult = acknowledgement.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
  let observedWaiting = false;
  try {
    for (let count = 0; count < 100; count += 1) {
      const waiting = await observer`SELECT pid FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND query LIKE '%"work_item"%'`;
      if (waiting.length > 0) {
        observedWaiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    continueWriter.resolve();
  }
  const [ack, write] = await Promise.all([acknowledgementResult, writerResult]);
  assert.equal(observedWaiting, true, 'ACK actually overlaps the WorkItem writer');
  assert.equal(write.status, 'fulfilled', write.reason?.message);
  assert.equal(ack.status, 'fulfilled', ack.reason?.cause?.message ?? ack.reason?.message);
  return { input, acknowledgement: ack.value };
}

test('automatic ACK completes alongside a WorkItem-first writer and keeps its exact replay receipt',
  { timeout: 30000 }, () => usingFixture(async (fixture, observer) => {
    const { input, acknowledgement } = await competeWithWorkItemWriter(fixture, observer, false);
    assert.equal(acknowledgement.replayed, false);
    const after = await fixture.snapshot();
    assert.equal(after.grants[0].status, 'COMPLETED');
    assert.equal(after.grants[0].lease_token, null);
    const receipt = JSON.parse(after.workItems[0].projection_json).autoProcessingCompletionReceipt;
    assert.equal(receipt.completedAt, acknowledgement.acknowledgedAt.toISOString());
    // A later WorkItem revision must not turn an original ACK replay into a
    // fresh acknowledgement or prevent readback of the original receipt.
    await fixture.sql`UPDATE work_item SET revision=revision+1 WHERE work_item_id=${input.workItemId}`;
    const replay = await fixture.hosted(() => fixture.workItems.acknowledgeAutoProcessingLease(input));
    assert.equal(replay.replayed, true);
    assert.equal(replay.acknowledgedAt.toISOString(), receipt.completedAt);
    assert.equal(await fixture.hosted(() => fixture.workItems.acknowledgeAutoProcessingLease({
      ...input, leaseGeneration: input.leaseGeneration + 1,
    })), null);
    assert.equal(await fixture.hosted(() => fixture.workItems.acknowledgeAutoProcessingLease({
      ...input, leaseToken: '00000000-0000-4000-8000-000000000000',
    })), null);
  }));

test('automatic ACK cannot complete a stale revision after waiting for a concurrent writer',
  { timeout: 30000 }, () => usingFixture(async (fixture, observer) => {
    const { acknowledgement } = await competeWithWorkItemWriter(fixture, observer, true);
    assert.equal(acknowledgement, null);
    const after = await fixture.snapshot();
    assert.equal(after.grants[0].status, 'LEASED');
    assert.equal(after.grants[0].completed_at, null);
    assert.equal(JSON.parse(after.workItems[0].projection_json).autoProcessingCompletionReceipt, undefined);
  }));

// Pause only after PostgreSQL has acquired ACK's real first row lock. All
// SQL, transaction results, configuration validation and receipts stay real.
function pauseAcknowledgementLock(database, held, resume) {
  return new Proxy(database, { get(target, key) {
    if (key === 'transaction') return (callback, ...args) => target.transaction(
      (transaction) => callback(new Proxy(transaction, { get(tx, property) {
        if (property === 'select') return (...fields) => {
          const observe = (builder) => new Proxy(builder, { get(query, part) {
            const value = Reflect.get(query, part);
            if (part === 'for') return async (...lock) => {
              const rows = await value.apply(query, lock);
              held.resolve();
              await resume.promise;
              return rows;
            };
            return typeof value === 'function' ? (...parameters) => {
              const next = value.apply(query, parameters);
              return next && typeof next.for === 'function' ? observe(next) : next;
            } : value;
          } });
          return observe(tx.select(...fields));
        };
        const value = Reflect.get(tx, property);
        return typeof value === 'function' ? value.bind(tx) : value;
      } })), ...args);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

for (const replay of [false, true]) {
  test(`automatic ACK and the real pending configuration entry preserve ${replay ? 'an exact replay' : 'claimed-task rejection'} without deadlock`,
    { timeout: 30000 }, () => usingFixture(async (fixture, observer) => {
      await fixture.seed();
      const initial = (await fixture.snapshot()).workItems[0];
      const configuration = {
        configurationRequestId: '11111111-1111-4111-8111-111111111111',
        workItemId: initial.work_item_id, requestId: initial.request_id,
        documentVersionId: initial.document_version_id,
        sourceArtifactId: initial.source_artifact_id,
        sourceFileSha256: initial.source_file_sha256,
        sourceByteLength: Number(initial.source_byte_length),
        expectedWorkItemRevision: initial.revision,
        expectedExecutionModel: JSON.parse(initial.analysis_model_json),
        expectedSettingsRevision: 1,
      };
      // Synthetic prior application is a fixture precondition. The raced
      // replay/rejection below uses the actual service and repository on PG.
      const executionModel = { ...configuration.expectedExecutionModel, settingsRevision: 1 };
      const application = {
        configurationRequestId: configuration.configurationRequestId,
        appliedAt: new Date().toISOString(), executorPrincipalId: 'service:core-p1-test',
        actorUserId: fixture.actorUserId, workItemId: configuration.workItemId,
        requestId: configuration.requestId, documentVersionId: configuration.documentVersionId,
        sourceArtifactId: configuration.sourceArtifactId, sourceFileSha256: configuration.sourceFileSha256,
        sourceByteLength: configuration.sourceByteLength, workItemRevision: initial.revision,
        previousModel: configuration.expectedExecutionModel, executionModel,
      };
      const priorProjection = { ...JSON.parse(initial.projection_json), modelConfigurationApplications: [application] };
      await fixture.sql`UPDATE work_item SET analysis_model_json=${JSON.stringify(executionModel)},
        projection_json=${JSON.stringify(priorProjection)} WHERE work_item_id=${initial.work_item_id}`;
      const queue = await fixture.nextWorkItem({ resumeWorkItemId: initial.work_item_id });
      assert.equal(queue.status, 'CLAIMED');
      const before = await fixture.snapshot();
      // A second application connection is essential: the fixture pool has
      // one connection and would otherwise serialize before reaching PG locks.
      const [identity] = await fixture.db.$client`SELECT current_user AS username`;
      assert.match(identity.username, /^tdms_fixture_app_[a-f0-9]{16}$/u);
      const endpoint = new URL(`postgres://tdms_test_owner@127.0.0.1:${fixture.ownership.instance.port}/${fixture.ownership.database}`);
      validateOwnedEndpoint(endpoint.href, { port: fixture.ownership.instance.port, database: fixture.ownership.database });
      endpoint.username = identity.username;
      const second = postgres(endpoint.href, { max: 1, prepare: false, onnotice() {} });
      const held = deferred(), resume = deferred();
      let ackResult, configurationResult;
      try {
        const repository = new fixture.workItems.constructor(pauseAcknowledgementLock(drizzle(second), held, resume));
        ackResult = fixture.hosted(() => repository.acknowledgeAutoProcessingLease({
          tenantId: fixture.tenantId, workItemId: queue.workItemId,
          leaseOwner: before.grants[0].lease_owner,
          leaseToken: queue.leaseToken, leaseGeneration: queue.leaseGeneration,
          expectedWorkItemRevision: initial.revision, now: new Date(),
        })).then((value) => ({ value }), (error) => ({ error }));
        await Promise.race([held.promise, ackResult.then((result) => {
          throw result.error ?? new Error('ACK missed its WorkItem lock');
        })]);
        configurationResult = fixture.hosted(() => fixture.dispatch.applyPendingModelConfiguration({
          ...configuration,
          ...(replay ? {} : { configurationRequestId: '22222222-2222-4222-8222-222222222222' }),
        })).then((value) => ({ value }), (error) => ({ error }));
        let overlapping = false;
        for (let count = 0; count < 100; count += 1) {
          const waiting = await observer`SELECT pid FROM pg_stat_activity
            WHERE wait_event_type='Lock' AND query LIKE '%"work_item"%'`;
          if (waiting.length > 0) { overlapping = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        resume.resolve();
        const [ack, configured] = await Promise.all([ackResult, configurationResult]);
        assert.equal(overlapping, true, 'the actual configuration entry reaches the held WorkItem lock');
        assert.equal(ack.error, undefined, ack.error?.cause?.message ?? ack.error?.message);
        assert.equal(ack.value.replayed, false);
        if (replay) {
          assert.equal(configured.error, undefined, configured.error?.cause?.message ?? configured.error?.message);
          assert.deepEqual(configured.value, { status: 'MODEL_CONFIGURATION_APPLIED', replayed: true, application });
        } else assert.equal(configured.error?.message, 'PENDING_MODEL_ALREADY_CLAIMED');
        const after = await fixture.snapshot();
        assert.equal(after.grants[0].status, 'COMPLETED');
        const projection = JSON.parse(after.workItems[0].projection_json);
        assert.equal(projection.autoProcessingCompletionReceipt.completedAt, ack.value.acknowledgedAt.toISOString());
        assert.deepEqual(projection.modelConfigurationApplications, [application]);
        assert.equal(after.workItems[0].analysis_model_json, before.workItems[0].analysis_model_json);
      } finally {
        resume.resolve();
        await Promise.all([ackResult, configurationResult]);
        await second.end();
      }
    }));
}
