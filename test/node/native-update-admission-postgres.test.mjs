import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';

const require = createRequire(import.meta.url);
const load = (path) => require(`../../server/modules/${path}.ts`);
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { SessionResolver } = load('identity/session-resolver.service');
const { ReviewConversationService } = load('review-persistence/review-conversation.service');
const { ReviewConversationController } = load('review-persistence/review-conversation.controller');
const { ReviewAttemptDispatchService } = load('action-attempt/review-attempt-dispatch.service');
const { MiaodaHostedCanonicalObjectAccessAdapter } = load('work-item/miaoda-hosted-canonical-object-access.adapter');

async function startNativeUpdateFixture() {
  // Reuse the unchanged baseline Q1/core migrations and policies. This adds no
  // native CHAT/DOC_CHAT migration, policy, grant or permissive authorizer.
  const f = await startCoreP1HostFixture({ browser: true });
  const environment = {
    SANDBOX_ID: 'owned-p1-native-update-test',
    MIAODA_LOCAL_DEV: undefined,
    WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED: '1',
    WL_OPENCLAW_REVIEW_ADDITIONAL_CONVERSATION_BINDING: undefined,
  };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const sessions = new SessionResolver({
      validate() { assert.fail('no OAuth cookie was sent'); },
    }, { applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime' },
    new SqlExecutionContextMiddleware({ roleSchema: 'wiselink_jobaid_test' }));
    const service = new ReviewConversationService(
      sessions, new MiaodaHostedCanonicalObjectAccessAdapter(f.workItems), f.reviews, undefined,
      new ReviewAttemptDispatchService(f.attemptRepository, f.attempts, f.modelSettings),
      f.modelSettings, undefined, f.workItems,
    );
    const controller = new ReviewConversationController(service, sessions);
    return {
      ...f, controller, repository: f.reviews,
      request: (overrides = {}) => ({ headers: {}, userContext: {
        userId: f.actorUserId, tenantId: f.tenantId, appId: 'app_17bzc551rsg',
        env: 'runtime', isSystemAccount: false, roles: [], ...overrides,
      } }),
      async close() { restore(); await f.close(); },
    };
  } catch (error) {
    restore(); await f.close(); throw error;
  }
}

async function absentNativeMigrations(database) {
  const [absence] = await database`SELECT
    (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'review_native_chat_%') AS native_chat_functions,
    (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'document_chat_%') AS document_chat_functions,
    (SELECT count(*)::int FROM pg_policies WHERE policyname LIKE 'review_native_chat_%'
      OR policyname LIKE 'document_chat_%') AS new_chat_policies`;
  assert.deepEqual(absence, { native_chat_functions: 0, document_chat_functions: 0, new_chat_policies: 0 });
  return absence;
}

test('native UPDATE append and readback need no 0082/0083 and retain mapping, scope and original-request boundaries', async (t) => {
  const f = await startNativeUpdateFixture();
  const wi = 'WI-native-update';
  try {
    const migrationsAbsent = await absentNativeMigrations(f.sql);
    const policies = () => f.sql`SELECT tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`;
    const originalPolicies = await policies();
    const roles = await f.sql`SELECT rolname,rolsuper,rolbypassrls FROM pg_roles
      WHERE rolname IN ('authenticated_wiselink_jobaid_test','service_role_wiselink_jobaid_test',
        ${f.ownership.applicationLogin}) ORDER BY rolname`;
    assert.equal(roles.length, 3);
    assert.ok(roles.every(role => !role.rolsuper && !role.rolbypassrls));
    const item = await f.seed(wi);
    // Completed intake is a constructed precondition. This test exercises only
    // the changed browser admission, persistence/readback and original replay.
    item.revision = 5;
    item.autoProcessingCompletionReceipt = {
      tenantId: f.tenantId, actorUserId: f.actorUserId, workItemId: wi,
      requestId: item.requestId, documentId: 'doc-job', documentVersionId: 'dv-job',
      sourceArtifactId: 'ART-TEST', sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 1234, completedAt: new Date().toISOString(),
    };
    await f.sql`UPDATE work_item SET revision=5,projection_json=${JSON.stringify(item)} WHERE work_item_id=${wi}`;
    await f.sql`UPDATE auto_work_item_authorization SET status='COMPLETED',
      completed_lease_token_hash=${'b'.repeat(64)},completed_lease_generation=1,completed_at=now()
      WHERE work_item_id=${wi}`;
    process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-other-static-scope';
    const created = await f.controller.createOrResume(wi, {}, f.request());
    const rc = created.conversation.reviewConversationId;
    assert.equal(created.conversation.automaticExecutionAvailable, true);
    assert.equal(created.conversation.overallExecutionAvailable, false);
    assert.equal(created.conversation.currentWorkItemRevision, 5);
    assert.equal(created.conversation.turns.length, 0);
    assert.equal((await f.sql`SELECT count(*)::int AS n FROM identity_session`)[0].n, 0);
    const body = {
      requestId: 'native-original-update', userMessage: 'Preserve the exact qualification in the saved assessment.',
      purpose: 'UPDATE_ASSESSMENT', executionMode: 'AUTOMATIC',
      expectedInputRevision: 5, includedDiscussionTurnIds: [],
    };
    const turnCount = async () => (await f.sql`SELECT count(*)::int AS n FROM review_turn`)[0].n;
    const attemptCount = async () => (await f.sql`SELECT count(*)::int AS n FROM action_attempt WHERE work_item_id=${wi}`)[0].n;
    const originalAttemptCount = await attemptCount();
    await t.test('revoked, wrong-client and foreign-tenant mappings cannot admit a turn', async () => {
      for (const patch of [
        { status: 'REVOKED', expected_client_id: 'cli_aadde8b579f95bc9', miaoda_tenant_id: f.tenantId },
        { status: 'ACTIVE', expected_client_id: 'cli-unrelated', miaoda_tenant_id: f.tenantId },
        { status: 'ACTIVE', expected_client_id: 'cli_aadde8b579f95bc9', miaoda_tenant_id: 'tenant-unrelated' },
      ]) {
        await f.sql`UPDATE identity_subject_mapping SET ${f.sql(patch)} WHERE miaoda_user_id=${f.actorUserId}`;
        assert.notEqual((await f.controller.current(wi, f.request())).conversation?.automaticExecutionAvailable, true);
        await assert.rejects(f.controller.appendTextTurn(wi, rc, body, f.request()));
        assert.equal(await turnCount(), 0);
      }
      await f.sql`UPDATE identity_subject_mapping SET status='ACTIVE',expected_client_id='cli_aadde8b579f95bc9',
        miaoda_tenant_id=${f.tenantId} WHERE miaoda_user_id=${f.actorUserId}`;
    });
    await t.test('owner, tenant, current revision and existing successor completion remain required', async () => {
      const other = f.request({ userId: 'actor-nonowner' });
      await assert.rejects(f.controller.appendTextTurn(wi, rc, body, other));
      await assert.rejects(f.controller.appendTextTurn(wi, rc, body, f.request({ tenantId: 'tenant-unrelated' })));
      await assert.rejects(f.controller.appendTextTurn(wi, rc, { ...body, expectedInputRevision: 4 }, f.request()),
        { code: 'REVIEW_UPDATE_REVISION_STALE' });
      const withoutReceipt = { ...item };
      delete withoutReceipt.autoProcessingCompletionReceipt;
      await f.sql`UPDATE work_item SET projection_json=${JSON.stringify(withoutReceipt)} WHERE work_item_id=${wi}`;
      assert.equal((await f.controller.current(wi, f.request())).conversation.automaticExecutionAvailable, false);
      await assert.rejects(f.controller.appendTextTurn(wi, rc, body, f.request()),
        { code: 'REVIEW_AUTOMATIC_EXECUTION_UNAVAILABLE' });
      await f.sql`UPDATE work_item SET projection_json=${JSON.stringify(item)} WHERE work_item_id=${wi}`;
      const ordinaryAutomatic = {
        requestId: body.requestId, userMessage: body.userMessage, executionMode: body.executionMode,
      };
      for (const request of [
        ordinaryAutomatic, { ...ordinaryAutomatic, purpose: 'CHAT' },
        { ...body, overallRequested: true },
        { ...body, attachmentSelection: { bucketId: 'private', filePath: 'other.pdf' } },
      ]) await assert.rejects(f.controller.appendTextTurn(wi, rc, request, f.request()),
        { code: 'REVIEW_EXTERNAL_DELEGATION_REQUIRED' });
      assert.equal(await turnCount(), 0);
    });
    // Observe the real role while retaining the actual repository operation.
    const browserWriteRoles = [];
    const browserRoleFacts = [];
    const append = f.repository.appendTextTurn.bind(f.repository);
    f.repository.appendTextTurn = async (input) => {
      const [role] = await f.db.execute(sql`SELECT current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls,
        (SELECT tableowner=current_user FROM pg_tables WHERE tablename='review_turn') AS owns_turns,
        (SELECT relrowsecurity FROM pg_class WHERE oid='review_turn'::regclass) AS turn_rls`);
      browserWriteRoles.push(role.current_user);
      browserRoleFacts.push(role);
      assert.equal(role.current_user, 'authenticated_wiselink_jobaid_test');
      assert.equal(role.superuser, false); assert.equal(role.bypassrls, false);
      assert.equal(role.owns_turns, false); assert.equal(role.turn_rls, true);
      return append(input);
    };
    const appended = await f.controller.appendTextTurn(wi, rc, body, f.request());
    assert.equal(appended.replayed, false);
    const stored = await f.controller.current(wi, f.request());
    assert.equal(stored.conversation.turns[0].reviewTurnId, appended.turn.reviewTurnId);
    assert.equal(stored.conversation.turns[0].purpose, 'UPDATE_ASSESSMENT');
    const [rawTurn] = await f.sql`SELECT user_message FROM review_turn WHERE review_turn_id=${appended.turn.reviewTurnId}`;
    assert.doesNotMatch(rawTurn.user_message, /nativeUpdateAuthorized|nativeChatAdmission|ailySessionId/u);
    const changed = { ...item, revision: 6, permissionSnapshotVersion: 'fixture-after-original-append' };
    await f.sql`UPDATE work_item SET revision=6,projection_json=${JSON.stringify(changed)} WHERE work_item_id=${wi}`;
    process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED = '0';
    const replay = await f.controller.appendTextTurn(wi, rc, body, f.request());
    assert.equal(replay.replayed, true);
    assert.equal(replay.turn.reviewTurnId, appended.turn.reviewTurnId);
    assert.equal(replay.turn.inputRevision, 5);
    assert.equal(await turnCount(), 1);
    assert.equal((await f.sql`SELECT count(*)::int AS n FROM assessment_work_revision WHERE work_item_id=${wi}`)[0].n, 0);
    assert.equal(await attemptCount(), originalAttemptCount);
    assert.equal((await f.sql`SELECT count(*)::int AS n FROM identity_session`)[0].n, 0);
    assert.deepEqual(browserWriteRoles, ['authenticated_wiselink_jobaid_test', 'authenticated_wiselink_jobaid_test']);
    assert.deepEqual(await policies(), originalPolicies);
    assert.deepEqual(await absentNativeMigrations(f.sql), migrationsAbsent);
    console.log(JSON.stringify({ scenario: 'isolated-native-update-without-0082-0083',
      modelCalls: 0, remoteCalls: 0, migrationsAbsent, existingPoliciesUnchanged: true,
      extraPoliciesOrGrantsAdded: false, restrictedRoles: roles, browserWriteRoles, browserRoleFacts,
      newAttempts: 0, newSavedWorkRevisions: 0, replayAddedTurns: 0,
      constructedPreconditions: ['source material', 'completed intake receipt/grant', 'later Host revision/config'] }));
  } finally { await f.close(); }
});
