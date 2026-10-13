import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import { DerivedSummaryRepository } from '../../server/modules/canonical-host/derived-summary.repository';
import { DerivedSummaryMembersService } from '../../server/modules/canonical-host/derived-summary-members.service';
import { DerivedSummaryService } from '../../server/modules/canonical-host/derived-summary.service';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import { wikiRows } from '../../server/modules/canonical-host/hierarchical-wiki.persistence';

function nativeActor(userId: string, tenantId: string) {
  return { userId, tenantId, appId: 'app_17bzc551rsg', objectAccessActor: {
    principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: { source: 'MIAODA_GATEWAY_USER_CONTEXT', applicationScopeId: 'app_17bzc551rsg', tenantId,
      version: 'miaoda-hosted-native-sso.v1', decidedAt: new Date().toISOString() },
    tenantId, applicationScopeId: 'app_17bzc551rsg', applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null, workspaceProvenance: 'UNAVAILABLE', env: 'runtime', platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT', feishuUserId: null, feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE', sessionId: null, sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  } };
}

describe('Native summary tenant read boundary', () => {
  it('uses the real B browser transaction and a read-only tenant scope without an OAuth mapping query', async () => {
    const execute = jest.fn().mockResolvedValue([{ allowed: true }]);
    const database = { execute, select: jest.fn(() => { throw new Error('unexpected OAuth mapping lookup'); }) };
    const members = new DerivedSummaryMembersService({} as never, {} as never);
    const withBrowserActorTransaction = jest.fn(async (id: string, operation: (value: unknown) => Promise<unknown>) =>
      operation({ database }));
    const repository = new DerivedSummaryRepository({} as never, { withBrowserActorTransaction } as never, members);
    const actor = nativeActor('user-B', 'tenant-A');
    const reader = await repository.readBrowser(actor as never, async (_database, scope) => scope);
    expect(reader).toEqual({ tenantId: 'tenant-A', actorUserId: 'user-B', readScope: 'TENANT' });
    expect(withBrowserActorTransaction).toHaveBeenCalledWith('user-B', expect.any(Function));
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('native_app_shared_read_allowed');
    expect(query.params).toContain('tenant-A');
    expect(query.params).toContain('user-B');
    expect(() => repository.readBrowser({ ...actor, tenantId: 'tenant-C' } as never, async () => null))
      .toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
  });

  it('keeps ordinary browser/write actor authorization on the existing mapping branch', async () => {
    const database = { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'mapping' }] }) }) })),
      execute: jest.fn() };
    const members = new DerivedSummaryMembersService({} as never, {} as never);
    const withBrowserActorTransaction = jest.fn(async (_id: string, operation: (value: unknown) => Promise<unknown>) =>
      operation({ database }));
    const repository = new DerivedSummaryRepository({} as never, { withBrowserActorTransaction } as never, members);
    const owner = await repository.browser(nativeActor('user-A', 'tenant-A') as never, async (_database, scope) => scope);
    expect(owner).toEqual({ tenantId: 'tenant-A', actorUserId: 'user-A' });
    expect(database.select).toHaveBeenCalled();
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('keeps an OAuth reader owner-scoped through its mapped browser path', async () => {
    const database = { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'mapping' }] }) }) })),
      execute: jest.fn() };
    const members = new DerivedSummaryMembersService({} as never, {} as never);
    const withBrowserActorTransaction = jest.fn(async (_id: string, operation: (value: unknown) => Promise<unknown>) =>
      operation({ database }));
    const repository = new DerivedSummaryRepository({} as never, { withBrowserActorTransaction } as never, members);
    const native = nativeActor('user-A', 'tenant-A');
    const oauth = { ...native, objectAccessActor: { ...native.objectAccessActor,
      subjectDecision: { ...native.objectAccessActor.subjectDecision, source: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        version: 'feishu-oauth-verified.v1' },
      applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID', identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      feishuOpenId: 'ou-A', feishuIdentityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      sessionId: 'session-A', sessionRevision: 1, sessionProvenance: 'SERVER_OPAQUE_SESSION',
    } };
    const reader = await repository.readBrowser(oauth as never, async (_database, scope) => scope);
    expect(reader).toEqual({ tenantId: 'tenant-A', actorUserId: 'user-A' });
    expect(database.select).toHaveBeenCalled();
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('reads A-owned immutable nested summary by exact tenant/id/ref under B without replacing the owner', async () => {
    const member = { kind: 'DERIVED_SUMMARY' as const, summaryId: 'DS-A', summaryRef: 'DSR-A1', summaryRevision: 1 };
    const predicates: Array<{ table: string; params: unknown[] }> = [];
    const database = { execute: jest.fn().mockResolvedValue([{ allowed: true }]), select: jest.fn(() => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const name = getTableName(table);
        return { where: (predicate: Parameters<PgDialect['sqlToQuery']>[0]) => {
          predicates.push({ table: name, params: new PgDialect().sqlToQuery(predicate).params });
          const row = name === 'derived_summary' ? { actorUserId: 'user-A', currentSummaryRef: 'DSR-A1' } :
            { actorUserId: 'user-A', revision: 1, contentJson: { summaryId: 'DS-A', summaryRef: 'DSR-A1', revision: 1,
              members: [], evidence: [], usedEvidenceRefs: [], content: { headline: 'A summary', body: 'A body', limitations: [] } } };
          return { limit: async () => [row] };
        } };
      },
    })) };
    const members = new DerivedSummaryMembersService({} as never, {} as never);
    const [reading] = await members.readAll([member], { tenantId: 'tenant-A', actorUserId: 'user-B', readScope: 'TENANT' }, database as never);
    expect(reading).toMatchObject({ member, headline: 'A summary', body: 'A body', current: true });
    expect(predicates.map(item => item.table)).toEqual(['derived_summary', 'derived_summary_revision']);
    for (const predicate of predicates) {
      expect(predicate.params).toContain('tenant-A');
      expect(predicate.params).toContain('DS-A');
      expect(predicate.params).not.toContain('user-A');
      expect(predicate.params).not.toContain('user-B');
    }
  });

  it('rejects a revision whose stored owner differs from its exact summary head', async () => {
    const database = { select: jest.fn(() => ({ from: (table: Parameters<typeof getTableName>[0]) => ({
      where: () => ({ limit: async () => [getTableName(table) === 'derived_summary'
        ? { actorUserId: 'user-A' }
        : { actorUserId: 'user-C', contentJson: { summaryId: 'DS-A', summaryRef: 'DSR-A1', revision: 1 } }] }),
    }) })) };
    const repository = new DerivedSummaryRepository({} as never, {} as never, {} as never);
    await expect(repository.saved('DS-A', 'DSR-A1',
      { tenantId: 'tenant-A', actorUserId: 'user-B', readScope: 'TENANT' }, database as never))
      .rejects.toThrow('DERIVED_SUMMARY_REVISION_UNAVAILABLE');
  });

  it('does not expose an attempt bound to the summary ID when its actor differs from the head owner', async () => {
    const repository = { readBrowser: jest.fn(async (_actor: unknown, operation: (database: unknown, scope: unknown) => Promise<unknown>) =>
      operation({} as never, { tenantId: 'tenant-A', actorUserId: 'user-B', readScope: 'TENANT' })),
    head: jest.fn().mockResolvedValue({ summaryId: 'DS-A', actorUserId: 'user-A' }),
    attempt: jest.fn().mockResolvedValue({ summaryId: 'DS-A', actorUserId: 'user-C' }) };
    const service = new DerivedSummaryService(repository as never, {} as never, {} as never);
    await expect(service.status('DS-A', 'AQ-foreign', nativeActor('user-B', 'tenant-A') as never))
      .rejects.toThrow('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE');
  });
});

describe('Wiki GET read boundary', () => {
  it('reads the existing directory without invoking refresh or a write transaction', async () => {
    const result = { items: [], classifications: [], candidates: [], nextClassificationCursor: null,
      sourceCurrentness: 'UNKNOWN' };
    const repository = { browser: jest.fn(() => { throw new Error('GET attempted write transaction'); }),
      readBrowser: jest.fn(async (_actor: unknown, operation: (database: unknown, scope: unknown) => Promise<unknown>) =>
        operation({ execute: jest.fn().mockResolvedValue([]) }, { tenantId: 'tenant-A', actorUserId: 'user-B', readScope: 'TENANT' })) };
    const wiki = new HierarchicalWikiService({} as never, repository as never, {} as never, {} as never,
      {} as never, {} as never, {} as never);
    await expect(wiki.list(nativeActor('user-B', 'tenant-A') as never)).resolves.toEqual(result);
    expect(repository.readBrowser).toHaveBeenCalledTimes(1);
    expect(repository.browser).not.toHaveBeenCalled();
  });

  it('selects all owners in the verified tenant only for a read-scoped Wiki directory', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    await wikiRows({ execute } as never, { tenantId: 'tenant-A', actorUserId: 'user-B', readScope: 'TENANT' });
    const tenantQuery = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(tenantQuery.params).toEqual(['tenant-A']);
    expect(tenantQuery.sql).not.toContain('actor_user_id=');
    execute.mockClear();
    await wikiRows({ execute } as never, { tenantId: 'tenant-A', actorUserId: 'user-B' });
    const ownerQuery = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(ownerQuery.params).toEqual(['tenant-A', 'user-B']);
  });
});
