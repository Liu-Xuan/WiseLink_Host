import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  SqlExecutionContextMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const {
  EngineeringMatterWorkingRepository,
} = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { reviewTurn } = require('../../server/database/schema.ts');
const {
  ReviewConversationRepository,
} = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const url = process.env.DIALOGUE_DISPATCH_TEST_DATABASE_URL;
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Exercises the production guard and INSERT against real PostgreSQL locks in an
// isolated schema with service-only request access and authenticated-only turn
// INSERT. Full Host Review triggers belong to the integration suite.
test(
  'dialogue dispatch serializes real PostgreSQL working and request races',
  { skip: !url },
  async (t) => {
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
    const admin = postgres(url, { max: 1, onnotice() {} });
    const schema = `dialogue_dispatch_${randomUUID().replaceAll('-', '')}`;
    const roleSchema = `dd_${randomUUID().replaceAll('-', '')}`;
    const serviceRole = `service_role_${roleSchema}`;
    const browserRole = `authenticated_${roleSchema}`;
    let pool;
    try {
      await admin.unsafe(
        `CREATE ROLE ${serviceRole} NOLOGIN; CREATE ROLE ${browserRole} NOLOGIN`,
      );
      await admin.unsafe(`CREATE SCHEMA ${schema}`);
      pool = postgres(url, {
        max: 6,
        connection: { search_path: schema },
        onnotice() {},
      });
      const db = drizzle(pool);
      await pool.unsafe(
        'CREATE TABLE dialogue_assessment_request (request_ref uuid PRIMARY KEY, tenant_id text, actor_id text, work_item_id text, review_conversation_id text, request_json text, user_message text)',
      );
      await pool.unsafe(
        'CREATE TABLE work_item (tenant_id text, work_item_id text PRIMARY KEY, revision integer)',
      );
      await pool.unsafe(
        'CREATE TABLE assessment_work_revision (tenant_id text, work_item_id text, assessment_work_revision_id text, work_revision integer)',
      );
      const columns = getTableConfig(reviewTurn)
        .columns.map((c) => `"${c.name}" ${c.getSQLType()}`)
        .join(',');
      await pool.unsafe(
        `CREATE TABLE review_turn (${columns}, UNIQUE(review_conversation_id,request_id))`,
      );
      await pool.unsafe(`
        GRANT USAGE ON SCHEMA ${schema} TO ${serviceRole},${browserRole};
        GRANT SELECT,UPDATE ON dialogue_assessment_request,work_item,assessment_work_revision TO ${serviceRole};
        GRANT SELECT,INSERT ON review_turn TO ${serviceRole},${browserRole};
        ALTER TABLE dialogue_assessment_request ENABLE ROW LEVEL SECURITY;
        CREATE POLICY request_read ON dialogue_assessment_request FOR SELECT TO ${serviceRole}
          USING (actor_id=current_setting('app.user_id',true));
        CREATE POLICY request_lock ON dialogue_assessment_request FOR UPDATE TO ${serviceRole}
          USING (actor_id=current_setting('app.user_id',true));
        ALTER TABLE review_turn ENABLE ROW LEVEL SECURITY;
        CREATE POLICY turn_read ON review_turn FOR SELECT TO ${serviceRole},${browserRole}
          USING (actor_id=current_setting('app.user_id',true));
        CREATE POLICY turn_insert ON review_turn FOR INSERT TO ${browserRole}
          WITH CHECK (actor_id=current_setting('app.user_id',true));
      `);
      const middleware = new SqlExecutionContextMiddleware({ roleSchema });
      const roleScope = (isSystemAccount, operation) =>
        new Promise((resolve, reject) => {
          middleware.use(
            { userContext: { userId: 'actor', roles: [], isSystemAccount } },
            {},
            () => {
              void Promise.resolve().then(operation).then(resolve, reject);
            },
          );
        });
      // Session authentication is covered by the browser-scope suite. Here the
      // scope port drives the real SDK and both PostgreSQL roles on every query.
      const sessions = {
        withVerifiedServiceSql: (operation, actor) => {
          if (actor !== undefined) assert.equal(actor, 'actor');
          return roleScope(true, operation);
        },
        withVerifiedBrowserSql: (operation) => roleScope(false, operation),
      };
      const working = new EngineeringMatterWorkingRepository(db, middleware, {
        roleSchema,
      });
      const input = {
        conversation: {
          reviewConversationId: 'RC-A',
          tenantId: 'tenant',
          actorId: 'actor',
          workItemId: 'WI-A',
        },
        requestId: `dialogue-${randomUUID()}`,
        userMessage: 'exact frozen input',
        purpose: 'UPDATE_ASSESSMENT',
        executionRequested: true,
        includedDiscussionTurnIds: [],
        expectedInputRevision: 7,
        currentRevision: 7,
      };
      const reset = async () => {
        await pool.unsafe(
          'TRUNCATE review_turn,dialogue_assessment_request,work_item,assessment_work_revision',
        );
        await pool`INSERT INTO work_item VALUES ('tenant','WI-A',7)`;
        await pool`INSERT INTO assessment_work_revision VALUES ('tenant','WI-A','work-4',4)`;
        await pool`INSERT INTO dialogue_assessment_request VALUES (${input.requestId.slice(9)}::uuid,'tenant','actor','WI-A','RC-A',${JSON.stringify({ expectedWorkItemRevision: 7, expectedWorkingRef: 'work-4' })},${input.userMessage})`;
      };
      let onWorkLock = () => {};
      let onInsert = async () => {};
      const actors = {
        withActorTransaction: async (actor, run) => {
          assert.equal(actor, 'actor');
          return working.withActorTransaction(
            actor,
            async ({ database: tx }) => {
              const database = new Proxy(tx, {
                get(target, key) {
                  if (key === 'execute')
                    return (q) => {
                      if (
                        q.queryChunks.some((c) =>
                          c?.value?.some?.(
                            (v) =>
                              typeof v === 'string' &&
                              v.includes('SELECT revision FROM work_item'),
                          ),
                        )
                      )
                        onWorkLock();
                      return target.execute(q);
                    };
                  if (key === 'insert')
                    return (table) => ({
                      values: async (values) => {
                        const [sqlIdentity] = await target.execute(
                          sql`SELECT current_user AS role,current_setting('app.user_id',true) AS actor`,
                        );
                        assert.deepEqual(sqlIdentity, {
                          role: browserRole,
                          actor: 'actor',
                        });
                        await onInsert();
                        return target.insert(table).values(values);
                      },
                    });
                  const value = target[key];
                  return typeof value === 'function'
                    ? value.bind(target)
                    : value;
                },
              });
              return run({ database });
            },
          );
        },
      };
      const repo = new ReviewConversationRepository(db, actors, sessions);
      const dispatch = () =>
        sessions.withVerifiedBrowserSql(() => repo.appendTextTurn(input));
      // Only the unrelated engineer-input projection is replaced; the production
      // binding reads, base reads, locks and actual ReviewTurn INSERT all run.
      repo.loadTurnByRequest = async (
        conversationId,
        requestId,
        executor = db,
      ) => {
        const [row] = await executor.execute(
          sql`SELECT * FROM review_turn WHERE review_conversation_id=${conversationId} AND request_id=${requestId}`,
        );
        if (!row) return null;
        const stored = JSON.parse(row.user_message.slice(5));
        return {
          ...stored,
          reviewTurnId: row.review_turn_id,
          candidateText: stored.userMessage,
          attachmentBindings: stored.attachments,
          inputType: row.input_type,
          adoptionStatus: row.adoption_status,
        };
      };
      await t.test(
        'service cannot insert ReviewTurn and browser cannot read private dispatch requests',
        async () => {
          await reset();
          await assert.rejects(
            sessions.withVerifiedServiceSql(() =>
              db.execute(
                sql`INSERT INTO review_turn (review_turn_id,actor_id) VALUES ('forbidden','actor')`,
              ),
            ),
            (error) => error.code === '42501' || error.cause?.code === '42501',
          );
          await assert.rejects(
            sessions.withVerifiedBrowserSql(() =>
              db.execute(sql`SELECT * FROM dialogue_assessment_request`),
            ),
            (error) => error.code === '42501' || error.cause?.code === '42501',
          );
        },
      );
      await t.test(
        'working commit wins: first dispatch rejects its frozen old base',
        async () => {
          await reset();
          const locked = deferred(),
            release = deferred(),
            reached = deferred();
          onWorkLock = reached.resolve;
          const writer = pool.begin(async (tx) => {
            await tx`SELECT * FROM work_item WHERE work_item_id='WI-A' FOR UPDATE`;
            await tx`INSERT INTO assessment_work_revision VALUES ('tenant','WI-A','work-5',5)`;
            locked.resolve();
            await release.promise;
          });
          await locked.promise;
          const pendingDispatch = dispatch();
          const rejected = assert.rejects(
            pendingDispatch,
            /DIALOGUE_ASSESSMENT_BASE_CHANGED/,
          );
          await reached.promise;
          release.resolve();
          await writer;
          await rejected;
          assert.equal((await pool`SELECT * FROM review_turn`).length, 0);
        },
      );
      await t.test(
        'concurrent retries create one original turn and replay it after base changes',
        async () => {
          await reset();
          onWorkLock = () => {};
          const results = await Promise.all([dispatch(), dispatch()]);
          assert.equal(
            results[0].turn.reviewTurnId,
            results[1].turn.reviewTurnId,
          );
          assert.deepEqual(results.map((r) => r.replayed).sort(), [
            false,
            true,
          ]);
          await pool`INSERT INTO assessment_work_revision VALUES ('tenant','WI-A','work-5',5)`;
          const replay = await dispatch();
          assert.equal(replay.turn.reviewTurnId, results[0].turn.reviewTurnId);
          assert.equal(replay.replayed, true);
          assert.equal((await pool`SELECT * FROM review_turn`).length, 1);
        },
      );
      await t.test(
        'dispatch holds the work lock until its turn insert commits',
        async () => {
          await reset();
          const inserting = deferred(),
            release = deferred();
          onInsert = async () => {
            inserting.resolve();
            await release.promise;
          };
          const pendingDispatch = dispatch();
          await inserting.promise;
          // NOWAIT checks the real competing transaction cannot change this base.
          await assert.rejects(
            pool.begin(async (tx) => {
              await tx`SELECT * FROM work_item WHERE work_item_id='WI-A' FOR UPDATE NOWAIT`;
            }),
            (error) => error.code === '55P03',
          );
          release.resolve();
          await pendingDispatch;
          onInsert = async () => {};
          assert.equal((await pool`SELECT * FROM review_turn`).length, 1);
        },
      );
    } finally {
      if (pool) await pool.end();
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.unsafe(`DROP ROLE IF EXISTS ${serviceRole},${browserRole}`);
      await admin.end();
    }
  },
);
