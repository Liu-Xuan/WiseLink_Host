import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { WikiGuideNode } from '@shared/wiki-guide.interface';
import { DerivedSummaryRepository } from '../../server/modules/canonical-host/derived-summary.repository';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import { HierarchicalWikiController } from '../../server/modules/canonical-host/hierarchical-wiki.controller';
import { readWikiGuideNavigation, wikiGuideChapterTitleCodes }
  from '../../server/modules/canonical-host/hierarchical-wiki-navigation';
import type { SummaryActor } from '../../server/modules/canonical-host/derived-summary-members.service';

const owner: SummaryActor = { tenantId: 'tenant-A', actorUserId: 'reader-B', readScope: 'TENANT' };
function actor(userId = 'reader-B', tenantId = 'tenant-A') {
  return { userId, tenantId, appId: 'app_17bzc551rsg', objectAccessActor: {
    principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: { source: 'MIAODA_GATEWAY_USER_CONTEXT', applicationScopeId: 'app_17bzc551rsg', tenantId,
      version: 'miaoda-hosted-native-sso.v1', decidedAt: new Date().toISOString() },
    tenantId, applicationScopeId: 'app_17bzc551rsg', applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null, workspaceProvenance: 'UNAVAILABLE', env: 'runtime', platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT', feishuUserId: null, feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE', sessionId: null, sessionRevision: null, sessionProvenance: 'UNAVAILABLE',
  } };
}

function node(index: number): WikiGuideNode {
  const segment = { summaryId: `DS-${String(index).padStart(3, '0')}`, parentSummaryId: null,
    scope: { kind: 'FLEET' as const, title: 'B787 Wiki', fleetFamilyId: 'B787', fleetModelIds: [],
      ata2: null, ata4: null, selectionReason: 'registered' }, currentSummaryRef: null, currentRevision: 0 };
  return { ...segment, wikiId: `WIKI-${index}`, enabled: true, currentBodyStatus: 'AVAILABLE',
    state: 'EMPTY', path: [segment] };
}

function setup(items: WikiGuideNode[] = [node(1)]) {
  const database = { execute: jest.fn().mockResolvedValue([{ selectionFound: true, scopeValid: true, items }]) };
  const members = { authorizeActor: jest.fn().mockResolvedValue(undefined), readAll: jest.fn(),
    withNativeTransaction: jest.fn(async (_owner, _database, _caller, operation: () => Promise<unknown>) => operation()) };
  const transactions = { withBrowserActorTransaction: jest.fn(async (_id, operation) => operation({ database })) };
  const repository = new DerivedSummaryRepository(database as never, transactions as never, members as never);
  const service = new HierarchicalWikiService(database as never, repository, {} as never, members as never,
    transactions as never, {} as never, {} as never);
  return { database, members, transactions, repository, service };
}

describe('Wiki guide navigation pure discovery consumer', () => {
  it('wires a distinct no-store reading route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HierarchicalWikiController.prototype.navigation)).toBe('navigation');
    expect(Reflect.getMetadata('__headers__', HierarchicalWikiController.prototype.navigation))
      .toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });

  it('uses authentic readBrowser scope and one SQL, without reading bodies or reconciling queues', async () => {
    const h = setup();
    const write = jest.spyOn(h.repository, 'browser');
    const oldList = jest.spyOn(h.service, 'list');
    const result = await h.service.navigation({}, actor() as never);
    expect(result).toEqual({ items: [node(1)], nextCursor: null });
    expect(h.members.authorizeActor).toHaveBeenCalledWith(owner, h.database);
    expect(h.members.withNativeTransaction).toHaveBeenCalled();
    expect(h.members.readAll).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(oldList).not.toHaveBeenCalled();
    expect(h.database.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.sql).toContain('WITH RECURSIVE');
    expect(query.sql).toContain('JOIN derived_summary h');
    expect(query.sql).toContain('child.parent_wiki_id=parent.wiki_id');
    expect(query.sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/u);
    expect(query.sql).not.toContain('content_json');
    expect(query.sql).not.toContain('FOR UPDATE');
    expect(query.params).toContain('tenant-A');
  });

  it('rejects a forged native tenant before issuing the query', async () => {
    const h = setup();
    const authentic = actor();
    expect(() => h.service.navigation({ summaryId: 'DS-001' },
      { ...authentic, tenantId: 'other-tenant' } as never)).toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    expect(h.database.execute).not.toHaveBeenCalled();
  });

  it('keeps mapped/owner readers scoped to their actor in the query', async () => {
    const h = setup();
    await readWikiGuideNavigation(h.database as never, { tenantId: 'tenant-A', actorUserId: 'owner-A' }, {});
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.params).toContain('owner-A');
    expect(query.sql).toContain('w.actor_user_id=');
  });

  it('returns 20/21 metadata nodes with a query-bound keyset and does not invent a body ref', async () => {
    const h = setup(Array.from({ length: 21 }, (_, index) => node(index + 1)));
    const page = await h.service.navigation({}, actor() as never);
    expect(page.items).toHaveLength(20);
    expect(page.items[0].currentSummaryRef).toBeNull();
    expect(page.items[0].currentBodyStatus).toBe('AVAILABLE');
    const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
    expect(cursor.key.at(-1)).toBe('DS-020');
    h.database.execute.mockResolvedValueOnce([{ selectionFound: true, scopeValid: true, items: [node(21)] }]);
    await expect(h.service.navigation({ after: page.nextCursor }, actor() as never))
      .resolves.toEqual({ items: [node(21)], nextCursor: null });
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[1][0] as SQL);
    expect(query.params).toContain('DS-020');
    await expect(h.service.navigation({ limit: 10, after: page.nextCursor }, actor() as never))
      .rejects.toThrow('WIKI_GUIDE_NAVIGATION_CURSOR_INVALID');
  });

  it('restores one exact registered node and its supplied real path without a directory-wide body read', async () => {
    const root = node(1);
    const child: WikiGuideNode = { ...node(2), parentSummaryId: root.summaryId,
      scope: { ...root.scope, kind: 'ATA4', title: 'ATA31', ata2: '31', ata4: '31-00' }, path: [] };
    child.path = [root.path[0], { summaryId: child.summaryId, parentSummaryId: root.summaryId,
      scope: child.scope, currentSummaryRef: 'DSR-2', currentRevision: 2 }];
    child.currentSummaryRef = 'DSR-2'; child.currentRevision = 2;
    const h = setup([child]);
    await expect(h.service.navigation({ summaryId: child.summaryId }, actor() as never))
      .resolves.toEqual({ items: [child], nextCursor: null });
    expect(h.database.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { summaryId: 'DS', limit: 20 }, { summaryId: 'DS', parentSummaryId: 'parent' },
    { summaryId: 'DS', rootSummaryId: 'root' }, { summaryId: 'DS', search: '' },
    { summaryId: 'DS', after: 'cursor' }, { parentSummaryId: 'DS', search: 'chapter' },
    { search: 'chapter' }, { limit: 51 }, { limit: 0 }, { after: '' },
    { rootSummaryId: ['root', 'other'] }, { rogue: 'source' },
  ])('rejects conflicting/invalid query %j rather than widening its scope', async query => {
    const h = setup();
    await expect(h.service.navigation(query, actor() as never)).rejects.toThrow('WIKI_GUIDE_NAVIGATION_QUERY_INVALID');
    expect(h.database.execute).not.toHaveBeenCalled();
  });

  it('requires a real fleet root and rejects a cross-root parent before returning metadata', async () => {
    const h = setup([]);
    h.database.execute.mockResolvedValue([{ selectionFound: true, scopeValid: false, items: [] }]);
    await expect(h.service.navigation({ rootSummaryId: 'chapter-not-fleet', search: '31' }, actor() as never))
      .rejects.toThrow('WIKI_GUIDE_ROOT_SCOPE_INVALID');
    await expect(h.service.navigation({ rootSummaryId: 'root-A', parentSummaryId: 'root-B' }, actor() as never))
      .rejects.toThrow('WIKI_GUIDE_ROOT_SCOPE_INVALID');
  });

  it('parameterizes chapter searches and returns not-found for a missing exact node', async () => {
    const h = setup([]);
    const search = "31' OR true --";
    await h.service.navigation({ rootSummaryId: 'root-A', search, limit: '50' }, actor() as never);
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.params).toContain(search);
    expect(query.sql).not.toContain(search);
    expect(query.params).toContain(51);
    h.database.execute.mockResolvedValueOnce([{ selectionFound: false, scopeValid: true, items: [] }]);
    await expect(h.service.navigation({ summaryId: 'missing' }, actor() as never))
      .rejects.toThrow('WIKI_GUIDE_NODE_UNAVAILABLE');
  });

  it('matches the displayed iSpec Chinese chapter and precise ATA4 title without mixing JASC names', () => {
    expect(wikiGuideChapterTitleCodes('记录')).toEqual({ ata2: ['31'], ata4: ['31-30'] });
    expect(wikiGuideChapterTitleCodes(' 记录器 ')).toEqual({ ata2: [], ata4: ['31-30'] });
    expect(wikiGuideChapterTitleCodes('仪表和控制面板')).toEqual({ ata2: [], ata4: ['31-10'] });
    expect(wikiGuideChapterTitleCodes('Control Panels')).toEqual({ ata2: [], ata4: ['31-10'] });
    expect(wikiGuideChapterTitleCodes('数据记录器(飞行/维修)')).toEqual({ ata2: [], ata4: [] });
    expect(wikiGuideChapterTitleCodes('')).toEqual({ ata2: [], ata4: [] });
    expect(wikiGuideChapterTitleCodes('并不存在的章节名称')).toEqual({ ata2: [], ata4: [] });
  });

  it('adds exact title codes to the existing root-scoped SQL while retaining raw title/code matching', async () => {
    const h = setup([]);
    await h.service.navigation({ rootSummaryId: 'DS-root', search: '记录' }, actor() as never);
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.params).toEqual(expect.arrayContaining(['DS-root', '记录', '31', '31-30']));
    expect(query.sql).toContain("scope->>'kind'='ATA2' AND scope->>'ata2'=ANY(ARRAY[");
    expect(query.sql).toContain("scope->>'kind'='ATA4' AND scope->>'ata4'=ANY(ARRAY[");
    expect(query.sql).toContain("concat_ws(' ',scope->>'title',scope->>'ata2',scope->>'ata4')");
    expect(query.sql).toContain('SELECT * FROM guide_tree WHERE root_summary_id=');
    expect(query.sql).not.toContain('记录');
    expect(query.params).not.toContain('97');
    expect(h.database.execute).toHaveBeenCalledTimes(1);
  });

  it('does not create a chapter result when a title matches a code with no registered node', async () => {
    const h = setup([]);
    await expect(h.service.navigation({ rootSummaryId: 'DS-root-without-31', search: '记录器' }, actor() as never))
      .resolves.toEqual({ items: [], nextCursor: null });
    expect(h.members.readAll).not.toHaveBeenCalled();
    expect(h.database.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.params).toContain('31-30');
    expect(query.sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/u);
  });
});
