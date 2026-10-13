import type { Request } from 'express';
import { DialogueBrowserScope } from '../../server/modules/canonical-host/dialogue-browser-scope.service';
import { DialogueRepository } from '../../server/modules/canonical-host/dialogue.repository';
import { CANONICAL_MIAODA_APP_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';

describe('native browser review SQL scope', () => {
  const priorSandboxId = process.env.SANDBOX_ID;
  const priorLocalDev = process.env.MIAODA_LOCAL_DEV;

  beforeEach(() => {
    process.env.SANDBOX_ID = 'native-review-scope-test';
    delete process.env.MIAODA_LOCAL_DEV;
  });

  afterAll(() => {
    if (priorSandboxId === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = priorSandboxId;
    if (priorLocalDev === undefined) delete process.env.MIAODA_LOCAL_DEV;
    else process.env.MIAODA_LOCAL_DEV = priorLocalDev;
  });

  it('uses authenticated B for reads and retains B plus reviewer role in write scope', async () => {
    const request = {
      headers: {},
      userContext: {
        userId: 'user-B',
        tenantId: '63849986',
        appId: CANONICAL_MIAODA_APP_ID,
        env: 'preview',
        roles: ['wiselink_engineering_reviewer'],
      },
    } as unknown as Request;
    const contexts: unknown[] = [];
    const sqlContext = {
      use: (scoped: Request, _response: unknown, next: () => void) => {
        contexts.push(scoped.userContext);
        next();
      },
    };
    const resolver = new SessionResolver(
      { validate: jest.fn() } as never,
      { applicationScopeId: CANONICAL_MIAODA_APP_ID } as never,
      sqlContext as never,
    );
    const browser = new DialogueBrowserScope(resolver);
    await browser.runRead(request, async () => {
      expect(resolver.nativeBrowserIdentity(request)).toMatchObject({
        actor: { canonicalSubject: { id: 'user-B' } },
        oauthSession: null,
      });
    });
    await browser.runNativeWrite(request, async () => undefined);
    await browser.run(request, async () => undefined);
    expect(contexts).toEqual([
      request.userContext,
      request.userContext,
      expect.objectContaining({
        userId: 'user-B',
        tenantId: '63849986',
        isSystemAccount: true,
        roles: ['wiselink_engineering_reviewer'],
      }),
    ]);
  });

  it('rejects an OAuth cookie bound to a different native user', async () => {
    const request = {
      headers: {},
      userContext: {
        userId: 'user-B', tenantId: '63849986',
        appId: CANONICAL_MIAODA_APP_ID, env: 'preview', roles: [],
      },
    } as unknown as Request;
    const sqlContext = { use: jest.fn() };
    const resolver = new SessionResolver(
      { validate: jest.fn() } as never,
      { applicationScopeId: CANONICAL_MIAODA_APP_ID } as never,
      sqlContext as never,
    );
    jest.spyOn(resolver, 'resolve').mockResolvedValue({
      actor: {
        canonicalSubject: { id: 'user-A' }, tenantId: '63849986',
        applicationScopeId: CANONICAL_MIAODA_APP_ID,
      },
    } as never);
    const browser = new DialogueBrowserScope(resolver);
    await expect(browser.runRead(request, async () => undefined))
      .rejects.toThrow('DIALOGUE_BROWSER_IDENTITY_MISMATCH');
    expect(sqlContext.use).not.toHaveBeenCalled();
  });

  it('preserves the legacy OAuth request session for the delegated write path', async () => {
    const request = {
      headers: {},
      userContext: {
        userId: 'user-A', tenantId: '63849986',
        appId: CANONICAL_MIAODA_APP_ID, env: 'preview', roles: [],
      },
    } as unknown as Request;
    const sqlContext = {
      use: jest.fn((_request: Request, _response: unknown, next: () => void) => next()),
    };
    const resolver = new SessionResolver(
      { validate: jest.fn() } as never,
      { applicationScopeId: CANONICAL_MIAODA_APP_ID } as never,
      sqlContext as never,
    );
    jest.spyOn(resolver, 'resolve').mockResolvedValue({
      actor: {
        canonicalSubject: { id: 'user-A' }, tenantId: '63849986',
        applicationScopeId: CANONICAL_MIAODA_APP_ID,
      },
      session: { id: 'oauth-A', expiresAt: new Date(Date.now() + 60_000) },
    } as never);
    await new DialogueBrowserScope(resolver).runOAuth(request, async () => undefined);
    expect(sqlContext.use).toHaveBeenCalledWith(request, expect.anything(), expect.any(Function));
  });

  it('uses an authenticated transaction for dialogue GET without service-role upgrade', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const withBrowserActorTransaction = jest.fn(async (_actor: string, operation: Function) =>
      operation({ database: { execute } }));
    const withActorTransaction = jest.fn();
    const repository = new DialogueRepository({
      withBrowserActorTransaction, withActorTransaction,
    } as never);
    await repository.list({ tenantId: '63849986', actorId: 'user-B', browserRead: true });
    expect(withBrowserActorTransaction).toHaveBeenCalledWith('user-B', expect.any(Function));
    expect(withActorTransaction).not.toHaveBeenCalled();
  });
});
