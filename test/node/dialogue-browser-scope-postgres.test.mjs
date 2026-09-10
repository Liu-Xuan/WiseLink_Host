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
  SessionResolver,
} = require('../../server/modules/identity/session-resolver.service.ts');
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
      const noop = async () => {
        assert.fail('wrong expected actor entered scope');
      };
      let sessionReads = 0;
      const sessions = new SessionResolver(
        {
          async validate(token) {
            sessionReads += 1;
            if (token === 'expired') return null;
            const [identityRole] = await db.execute(
              sql`SELECT current_user AS role`,
            );
            if (
              identityRole.role ===
              'service_role_wiselink_dialogue_browser_test'
            )
              return null;
            return {
              sessionId: `session-${token}`,
              revision: 1,
              expiresAt: new Date(Date.now() + 60000),
              identity: {
                miaodaUserId: token,
                tenantId: 'tenant-A',
                verifiedAt: new Date().toISOString(),
                feishuOpenId: `open-${token}`,
              },
            };
          },
        },
        {
          applicationScopeId: 'app_17bzc551rsg',
          sessionEnvironment: 'runtime',
        },
        middleware,
      );
      const scope = new DialogueBrowserScope(sessions);
      const request = (id) => ({
        headers: { cookie: `wl_session=${id}` },
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
              assert.equal(
                (await sessions.resolve(req)).actor.canonicalSubject.id,
                actorId,
              );
              assert.equal(
                await sessions.resolve({ ...req }),
                null,
                'verified identity never crosses the HTTP request boundary',
              );
              await new Promise((resolve) =>
                setTimeout(resolve, actorId === 'actor-A' ? 10 : 1),
              );
              await sessions.withVerifiedBrowserSql(async () => {
                assert.deepEqual(await read(), {
                  role: 'authenticated_wiselink_dialogue_browser_test',
                  actor: actorId,
                });
              });
              assert.deepEqual(await read(), {
                role: 'service_role_wiselink_dialogue_browser_test',
                actor: actorId,
              });
              assert.throws(
                () => sessions.withVerifiedServiceSql(noop, 'other-actor'),
                /DIALOGUE_BROWSER_IDENTITY_MISMATCH/,
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
      assert.equal(
        sessionReads,
        4,
        'two original validations plus two different-request probes; nested callers reuse the verified identity',
      );
      assert.throws(
        () => sessions.withVerifiedServiceSql(noop),
        /OFFICIAL_OAUTH_SESSION_REQUIRED/,
      );
      assert.throws(
        () => sessions.withVerifiedBrowserSql(noop),
        /OFFICIAL_OAUTH_SESSION_REQUIRED/,
      );
      const noRun = () => {
        assert.fail('unauthorized scope executed');
      };
      await assert.rejects(
        scope.run(
          { ...request('actor-A'), headers: { cookie: 'wl_session=expired' } },
          noRun,
        ),
        /OFFICIAL_OAUTH_SESSION_REQUIRED/,
      );
      await assert.rejects(
        scope.run(
          { ...request('actor-A'), headers: { cookie: 'wl_session=actor-B' } },
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
