import assert from 'node:assert/strict';
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
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const {
  DialogueBrowserScope,
} = require('../../server/modules/canonical-host/dialogue-browser-scope.service.ts');
const {
  EngineeringMatterWorkingRepository,
} = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const url = process.env.DIALOGUE_TEST_DATABASE_URL;

test(
  'verified browser SQL scope preserves real SDK isolation and the existing service guard',
  { skip: !url },
  async () => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/wiselink_dialogue_test');
    const savedSandbox = process.env.SANDBOX_ID;
    const savedLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'isolated-sdk-context-test';
    delete process.env.MIAODA_LOCAL_DEV;
    const pg = postgres(url, { max: 4, onnotice() {} });
    try {
      await pg.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_wiselink_dialogue_browser_test') THEN CREATE ROLE service_role_wiselink_dialogue_browser_test NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_wiselink_dialogue_browser_test') THEN CREATE ROLE authenticated_wiselink_dialogue_browser_test NOLOGIN; END IF;
    END $$;`);
      const db = drizzle(pg);
      const middleware = new SqlExecutionContextMiddleware({
        roleSchema: 'wiselink_dialogue_browser_test',
      });
      const working = new EngineeringMatterWorkingRepository(db, middleware, {
        roleSchema: 'wiselink_dialogue_browser_test',
      });
      const sessions = {
        async resolve(request) {
          if (request.headers.cookie === 'expired') return null;
          return {
            actor: {
              canonicalSubject: { id: request.headers.cookie },
              tenantId: 'tenant-A',
              applicationScopeId: 'app_17bzc551rsg',
            },
          };
        },
      };
      const scope = new DialogueBrowserScope(sessions, middleware);
      const request = (id) => ({
        headers: { cookie: id },
        body: { actorId: 'forged' },
        userContext: {
          userId: id,
          tenantId: 'tenant-A',
          appId: 'app_17bzc551rsg',
          env: 'runtime',
          isSystemAccount: false,
          roles: [],
        },
      });
      const original = (req, work) =>
        new Promise((resolve, reject) =>
          middleware.use(req, {}, () => {
            void Promise.resolve().then(work).then(resolve, reject);
          }),
        );
      const read = async () =>
        (
          await db.execute(
            sql`SELECT current_user AS role, current_setting('app.user_id',true) AS actor`,
          )
        )[0];
      await Promise.all(
        ['actor-A', 'actor-B'].map((actorId) => {
          const req = request(actorId);
          return original(req, async () => {
            assert.deepEqual(await read(), {
              role: 'authenticated_wiselink_dialogue_browser_test',
              actor: actorId,
            });
            await assert.rejects(
              working.withActorTransaction(actorId, () =>
                assert.fail('direct browser must stay rejected'),
              ),
              /RUNTIME_AUTHORIZATION_UNAVAILABLE/,
            );
            await scope.run(req, async () => {
              await new Promise((resolve) =>
                setTimeout(resolve, actorId === 'actor-A' ? 10 : 1),
              );
              await working.withActorTransaction(
                actorId,
                async ({ database }) => {
                  for (let i = 0; i < 2; i++) {
                    const [row] = await database.execute(
                      sql`SELECT current_user AS role, current_setting('app.user_id',true) AS actor`,
                    );
                    assert.deepEqual(row, {
                      role: 'service_role_wiselink_dialogue_browser_test',
                      actor: actorId,
                    });
                  }
                },
              );
            });
            assert.deepEqual(await read(), {
              role: 'authenticated_wiselink_dialogue_browser_test',
              actor: actorId,
            });
            assert.equal(req.userContext.isSystemAccount, false);
          });
        }),
      );
      const noRun = () => {
        assert.fail('unauthorized scope executed');
      };
      await assert.rejects(
        scope.run(
          { ...request('actor-A'), headers: { cookie: 'expired' } },
          noRun,
        ),
        /OFFICIAL_OAUTH_SESSION_REQUIRED/,
      );
      await assert.rejects(
        scope.run(
          { ...request('actor-A'), headers: { cookie: 'actor-B' } },
          noRun,
        ),
        /DIALOGUE_BROWSER_IDENTITY_MISMATCH/,
      );
      await assert.rejects(
        scope.run(
          {
            ...request('actor-A'),
            userContext: {
              ...request('actor-A').userContext,
              tenantId: 'tenant-B',
            },
          },
          noRun,
        ),
        /DIALOGUE_BROWSER_IDENTITY_MISMATCH/,
      );
      await assert.rejects(
        scope.run(request("actor';RESET ROLE;--"), noRun),
        /DIALOGUE_BROWSER_IDENTITY_MISMATCH/,
      );
      await assert.rejects(
        scope.run(
          {
            ...request('actor-A'),
            userContext: {
              ...request('actor-A').userContext,
              isSystemAccount: true,
            },
          },
          noRun,
        ),
        /CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE/,
      );
      process.env.MIAODA_LOCAL_DEV = '1';
      await assert.rejects(
        scope.run(request('actor-A'), noRun),
        /CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE/,
      );
    } finally {
      await pg.end();
      if (savedSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = savedSandbox;
      if (savedLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
      else process.env.MIAODA_LOCAL_DEV = savedLocal;
    }
  },
);
