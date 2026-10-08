import { AsyncLocalStorage } from 'node:async_hooks';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import { DialogueBrowserScope } from '../../server/modules/canonical-host/dialogue-browser-scope.service';

const identity = { subjectMappingId: 'mapping', provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  miaodaUserId: 'user', tenantId: 'tenant', feishuUserId: null, feishuOpenId: 'open',
  namespacedSubject: { namespace: 'FEISHU_OPEN_ID', subject: 'open', tenantKey: 'tenant-key' },
  verifiedAt: new Date().toISOString() };
const makeRequest = () => ({ headers: { cookie: 'wl_session=opaque' }, userContext: { userId: 'user',
  tenantId: 'tenant', appId: 'app_17bzc551rsg', env: 'runtime', isSystemAccount: false, roles: [] } });

function fixture() {
  let live = true;
  const store = { validate: jest.fn(async (_token, _database?) => live ? {
    sessionId: 'session', revision: 1, expiresAt: new Date(Date.now() + 60_000), identity,
  } : null) };
  // Tests resolver/scope control flow. Real SDK SQL/RLS behavior stays in the PG contract.
  const sqlIdentity = new AsyncLocalStorage<ReturnType<typeof makeRequest>['userContext']>();
  const middleware = { use: jest.fn((request, _response, next) => sqlIdentity.run(request.userContext, next)) };
  const sessions = new SessionResolver(store as never, {
    applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime',
  } as never, middleware as never);
  return { sessions, scope: new DialogueBrowserScope(sessions), store, sqlIdentity, revoke: () => { live = false; } };
}

it('transactional resolve bypasses the same-request ALS cache after revocation', async () => {
  const h = fixture(); const request = makeRequest(); const tx = { transaction: true };
  await h.sessions.withRequestSession(request as never, async admitted => {
    expect(admitted?.session.id).toBe('session');
    h.revoke();
    expect((await h.sessions.resolve(request as never))?.session.id).toBe('session');
    expect(await h.sessions.resolve(request as never, tx as never)).toBeNull();
    expect(h.store.validate).toHaveBeenCalledTimes(2);
    expect(h.store.validate).toHaveBeenLastCalledWith('opaque', tx);
  });
});

it('switches only SQL context and restores it after browser recheck and after exceptions', async () => {
  const oldSandbox = process.env.SANDBOX_ID; const oldLocal = process.env.MIAODA_LOCAL_DEV;
  process.env.SANDBOX_ID = 'constructed-unit-fixture'; delete process.env.MIAODA_LOCAL_DEV;
  try {
    const h = fixture(); const request = makeRequest();
    await h.scope.run(request as never, async () => {
      expect(request.userContext.isSystemAccount).toBe(false);
      expect(h.sqlIdentity.getStore()?.isSystemAccount).toBe(true);
      await expect(h.sessions.withVerifiedBrowserSql(async () => {
        expect(h.sqlIdentity.getStore()).toBe(request.userContext);
        throw new Error('read failed');
      })).rejects.toThrow('read failed');
      expect(h.sqlIdentity.getStore()?.isSystemAccount).toBe(true);
    });
    expect(h.sqlIdentity.getStore()).toBeUndefined();
    expect(request.userContext.isSystemAccount).toBe(false);
    expect(() => h.sessions.withVerifiedServiceSql(async () => undefined)).toThrow('OFFICIAL_OAUTH_SESSION_REQUIRED');
  } finally {
    if (oldSandbox === undefined) delete process.env.SANDBOX_ID; else process.env.SANDBOX_ID = oldSandbox;
    if (oldLocal === undefined) delete process.env.MIAODA_LOCAL_DEV; else process.env.MIAODA_LOCAL_DEV = oldLocal;
  }
});
