import { ForbiddenException, Logger } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { WikiGuidePathSegment } from '@shared/wiki-guide.interface';
import { EngineeringIssueSearchService } from '../../server/modules/canonical-host/engineering-issue-search.service';
import { EngineeringIssueSearchController } from '../../server/modules/canonical-host/engineering-issue-search.controller';
import type { WikiGuideIssueCandidate } from '../../server/modules/canonical-host/engineering-wiki-issue-page';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const actor = {
  userId: 'reader', tenantId: 'tenant-A', appId: 'app_17bzc551rsg', roles: [], env: 'runtime',
  objectAccessActor: { principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'reader' },
    subjectDecision: { source: 'MIAODA_GATEWAY_USER_CONTEXT', applicationScopeId: 'app_17bzc551rsg',
      tenantId: 'tenant-A', version: 'miaoda-hosted-native-sso.v1', decidedAt: new Date().toISOString() },
    tenantId: 'tenant-A', applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT', identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    workspaceId: null, workspaceProvenance: 'UNAVAILABLE', env: 'runtime', platformRoles: [],
    feishuUserId: null, feishuOpenId: null, feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null, sessionRevision: null, sessionProvenance: 'UNAVAILABLE' },
};

const root: WikiGuidePathSegment = { summaryId: 'DS-root', parentSummaryId: null,
  scope: { kind: 'FLEET', title: 'B787', fleetFamilyId: 'B787', fleetModelIds: [],
    ata2: null, ata4: null, selectionReason: 'registered' }, currentSummaryRef: null, currentRevision: 0 };
const chapter: WikiGuidePathSegment = { ...root, summaryId: 'DS-chapter', parentSummaryId: root.summaryId,
  scope: { ...root.scope, kind: 'ATA2', title: 'ATA31', ata2: '31' } };
const leaf: WikiGuidePathSegment = { ...chapter, summaryId: 'DS-leaf', parentSummaryId: chapter.summaryId,
  scope: { ...chapter.scope, kind: 'ATA4', title: 'ATA31-00', ata4: '31-00' },
  currentSummaryRef: 'DSR-old-body', currentRevision: 3 };

function candidate(index: number, subjectId = 'WI-shared'): WikiGuideIssueCandidate {
  return { subjectKind: 'WORK_ITEM', subjectId, workRef: `JAWR-${subjectId}`, workRevision: 2,
    documentVersionId: `DVI-${subjectId}`, issueKey: `issue-${String(index).padStart(3, '0')}`,
    paths: [[root, chapter, leaf]] };
}

function setup(candidates: WikiGuideIssueCandidate[]) {
  const saved = jobAidReadingFixture().current!;
  const database = { execute: jest.fn().mockResolvedValue([{ scopeValid: true, items: candidates }]) };
  const owner = { tenantId: 'tenant-A', actorUserId: 'reader', readScope: 'TENANT' as const };
  const summaryReads = { readBrowser: jest.fn(async (_actor: unknown,
    operation: (database: unknown, owner: unknown) => Promise<unknown>) => operation(database, owner)) };
  const jobAid = { readBrowserRevision: jest.fn(async (subjectId: string, workRef: string) => ({
    ...saved, workItemId: subjectId, workRevisionRef: workRef, workRevision: 2,
    documentVersionId: `DVI-${subjectId}`, content: { ...saved.content,
      understanding: 'PRIVATE FULL BODY MUST NOT BE RETURNED',
      issues: candidates.filter(item => item.subjectId === subjectId).map(item => ({
        ...saved.content.issues[0], issueKey: item.issueKey, question: `Saved ${item.issueKey}`,
        body: 'PRIVATE ISSUE BODY MUST NOT BE RETURNED',
      })) },
  })) };
  const matters = { readWorkingRevision: jest.fn() };
  const service = new EngineeringIssueSearchService(database as never, jobAid as never,
    matters as never, undefined, undefined, undefined, undefined, summaryReads as never);
  return { service, database, summaryReads, jobAid, matters, saved };
}

describe('Wiki guide server issue page', () => {
  const originalProjection = process.env.WL_ENGINEERING_SEARCH_PROJECTION;
  let log: jest.SpyInstance;
  beforeEach(() => { delete process.env.WL_ENGINEERING_SEARCH_PROJECTION; log = jest.spyOn(Logger.prototype, 'log').mockImplementation(); });
  afterEach(() => {
    if (originalProjection === undefined) delete process.env.WL_ENGINEERING_SEARCH_PROJECTION;
    else process.env.WL_ENGINEERING_SEARCH_PROJECTION = originalProjection;
    log.mockRestore();
  });

  it('registers a no-store route distinct from legacy issue search', () => {
    expect(Reflect.getMetadata(PATH_METADATA, EngineeringIssueSearchController.prototype.wikiGuide)).toBe('wiki-guide');
    expect(Reflect.getMetadata('__headers__', EngineeringIssueSearchController.prototype.wikiGuide))
      .toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });

  it('pages 20/21 issues, shares one exact work authorization and releases only small metadata', async () => {
    const h = setup(Array.from({ length: 21 }, (_, index) => candidate(index + 1)));
    const oldSearch = jest.spyOn(h.service, 'search');
    const result = await h.service.wikiGuide({ rootSummaryId: root.summaryId, search: '' }, actor as never);
    expect(result.items).toHaveLength(20);
    expect(result.coverage).toBe('CONFIRMED_WIKI_MEMBERS');
    expect(result.items[0]).toMatchObject({ question: 'Saved issue-001', paths: [[root, chapter, leaf]] });
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(1);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledWith('WI-shared', 'JAWR-WI-shared', actor);
    expect(h.database.execute).toHaveBeenCalledTimes(1);
    expect(oldSearch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|"evidence"|"body"|"reading"/u);
    const cursor = JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString());
    expect(cursor.identity.issueKey).toBe('issue-020');
    expect(cursor.query).toMatchObject({ rootSummaryId: root.summaryId, search: '', scope: 'CURRENT', limit: 20 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'WIKI_GUIDE_ISSUE_READ',
      candidateRows: 21, uniqueWorkReads: 1, authorizedIssues: 21, status: 'ok' }));
  });

  it('continues after the last visible issue and freshly reauthorizes the next request', async () => {
    const candidates = Array.from({ length: 21 }, (_, index) => candidate(index + 1));
    const h = setup(candidates);
    const first = await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    h.database.execute.mockResolvedValueOnce([{ scopeValid: true, items: [candidates[20]] }]);
    const second = await h.service.wikiGuide({ rootSummaryId: root.summaryId, after: first.nextCursor }, actor as never);
    expect(second.items.map(item => item.issueKey)).toEqual(['issue-021']);
    expect(second.nextCursor).toBeNull();
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(2);
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[1][0] as SQL);
    expect(query.params).toContain('issue-020');
    expect(query.params).toContain('JAWR-WI-shared');
  });

  it('releases the metadata read transaction before opening exact work/source readers', async () => {
    const h = setup([candidate(1)]);
    const metadata = h.summaryReads.readBrowser.getMockImplementation()!;
    let insideMetadata = false;
    h.summaryReads.readBrowser.mockImplementation(async (identity, operation) => {
      insideMetadata = true;
      try { return await metadata(identity, operation); } finally { insideMetadata = false; }
    });
    const exact = h.jobAid.readBrowserRevision.getMockImplementation()!;
    h.jobAid.readBrowserRevision.mockImplementation(async (subjectId, workRef) => {
      expect(insideMetadata).toBe(false);
      return exact(subjectId, workRef);
    });
    await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    expect(h.summaryReads.readBrowser).toHaveBeenCalledTimes(1);
  });

  it.each([
    { rootSummaryId: 'other-root' }, { chapterSummaryId: 'other-chapter' },
    { search: 'new query' }, { scope: 'HISTORY' }, { limit: 10 },
  ])('rejects reuse of a cursor with changed query/scope %j before SQL', async change => {
    const h = setup(Array.from({ length: 21 }, (_, index) => candidate(index + 1)));
    const first = await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    const calls = h.database.execute.mock.calls.length;
    await expect(h.service.wikiGuide({ rootSummaryId: root.summaryId, after: first.nextCursor, ...change }, actor as never))
      .rejects.toThrow('WIKI_GUIDE_ISSUE_CURSOR_INVALID');
    expect(h.database.execute).toHaveBeenCalledTimes(calls);
  });

  it('omits denied work, counts it only once and uses an authorized twentieth cursor', async () => {
    const rows = [candidate(1, 'WI-denied'), candidate(2, 'WI-denied'),
      ...Array.from({ length: 21 }, (_, index) => candidate(index + 3, 'WI-readable'))];
    const h = setup(rows);
    const allowed = h.jobAid.readBrowserRevision.getMockImplementation()!;
    h.jobAid.readBrowserRevision.mockImplementation(async (subjectId, workRef) => {
      if (subjectId === 'WI-denied') throw new ForbiddenException('SOURCE_REVOKED');
      return allowed(subjectId, workRef);
    });
    const page = await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    expect(page.items).toHaveLength(20);
    expect(page.items.every(item => item.subjectId === 'WI-readable')).toBe(true);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(2);
    expect(Buffer.from(page.nextCursor!, 'base64url').toString()).not.toContain('WI-denied');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ uniqueWorkReads: 2, deniedWorkReads: 1 }));
  });

  it('keeps at most four exact work reads in flight', async () => {
    const h = setup(Array.from({ length: 21 }, (_, index) => candidate(1, `WI-${String(index).padStart(2, '0')}`)));
    const original = h.jobAid.readBrowserRevision.getMockImplementation()!;
    let active = 0; let peak = 0;
    h.jobAid.readBrowserRevision.mockImplementation(async (subjectId, workRef) => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      try { return await original(subjectId, workRef); } finally { active--; }
    });
    await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(21);
  });

  it('fails explicitly at 40 unique denied works, without reading a forty-first or issuing a hidden cursor', async () => {
    const h = setup(Array.from({ length: 41 }, (_, index) => candidate(1, `WI-denied-${index}`)));
    h.jobAid.readBrowserRevision.mockRejectedValue(new ForbiddenException('SOURCE_REVOKED'));
    await expect(h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never))
      .rejects.toThrow('WIKI_GUIDE_ISSUE_SCAN_LIMIT');
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(40);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ uniqueWorkReads: 40, status: 'error' }));
  });

  it('fails explicitly at the 200 candidate scan edge even when all candidates share one denied work', async () => {
    const h = setup(Array.from({ length: 200 }, (_, index) => candidate(index + 1)));
    h.jobAid.readBrowserRevision.mockRejectedValue(new ForbiddenException('SOURCE_REVOKED'));
    await expect(h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never))
      .rejects.toThrow('WIKI_GUIDE_ISSUE_SCAN_LIMIT');
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ examinedCandidates: 200, status: 'error' }));
  });

  it('returns a genuine exhausted empty page without exposing denied metadata', async () => {
    const h = setup(Array.from({ length: 199 }, (_, index) => candidate(index + 1)));
    h.jobAid.readBrowserRevision.mockRejectedValue(new ForbiddenException('SOURCE_REVOKED'));
    await expect(h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never))
      .resolves.toEqual({ items: [], nextCursor: null, coverage: 'CONFIRMED_WIKI_MEMBERS' });
  });

  it('does not substitute another revision or DVI after exact authorization', async () => {
    const h = setup([{ ...candidate(1), documentVersionId: 'DVI-other-version' },
      { ...candidate(2), workRevision: 1 }]);
    const page = await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('preserves multiple real paths as membership, without claiming a saved Wiki body covers the work', async () => {
    const other = { ...leaf, summaryId: 'DS-other-leaf', currentSummaryRef: null, currentRevision: 0 };
    const row = { ...candidate(1), paths: [[root, chapter, leaf], [root, chapter, other]] };
    const h = setup([row]);
    const page = await h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never);
    expect(page.items[0].paths).toEqual(row.paths);
    expect(page.coverage).toBe('CONFIRMED_WIKI_MEMBERS');
    const query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.sql).toContain("membership.member->>'workRef'=candidate.work_ref");
    expect(query.sql).toContain("membership.member->>'workRevision'=candidate.work_revision::text");
    expect(query.sql).toContain("membership.member->>'documentVersionId'=candidate.document_version_id");
    expect(query.sql).toContain("jsonb_exists(membership.member->'issueKeys',candidate.issue_key)");
    expect(query.sql).toContain("m.basis_json->>'classificationStatus'='CONFIRMED'");
    expect(query.sql).toContain('LIMIT 200');
    expect(query.sql).not.toContain('derived_summary_revision');
  });

  it('uses the existing Matter exact reader and validates its actual saved identity', async () => {
    const row: WikiGuideIssueCandidate = { ...candidate(1), subjectKind: 'ENGINEERING_MATTER',
      subjectId: 'MAT-1', workRef: 'MW-1', documentVersionId: null };
    const h = setup([row]);
    h.matters.readWorkingRevision.mockResolvedValue({ matterId: 'MAT-1', matterWorkRevisionId: 'MW-1',
      workingRevision: 2, state: { problemWork: { issues: [{ issueKey: row.issueKey, question: 'Saved Matter issue' }] } } });
    const page = await h.service.wikiGuide({ rootSummaryId: root.summaryId, scope: 'HISTORY' }, actor as never);
    expect(page.items[0]).toMatchObject({ subjectKind: 'ENGINEERING_MATTER', workRef: 'MW-1',
      documentVersionId: null, question: 'Saved Matter issue' });
    expect(h.matters.readWorkingRevision).toHaveBeenCalledWith('MAT-1', 'MW-1', actor);
    expect(h.jobAid.readBrowserRevision).not.toHaveBeenCalled();
    expect(new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL).params).toContain('HISTORY');
  });

  it('keeps the configured search projection optional and parameterizes full text fallback', async () => {
    const h = setup([]);
    const search = "ATA31' private";
    await h.service.wikiGuide({ rootSummaryId: root.summaryId, chapterSummaryId: chapter.summaryId, search }, actor as never);
    let query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[0][0] as SQL);
    expect(query.params).toContain(search);
    expect(query.params).toContain(chapter.summaryId);
    expect(query.sql).not.toContain(search);
    expect(query.sql).not.toContain('engineering_search_projection indexed');
    process.env.WL_ENGINEERING_SEARCH_PROJECTION = '1';
    await h.service.wikiGuide({ rootSummaryId: root.summaryId, search: 'ATA31' }, actor as never);
    query = new PgDialect().sqlToQuery(h.database.execute.mock.calls[1][0] as SQL);
    expect(query.sql).toContain('engineering_search_projection indexed');
    expect(query.sql).toContain('indexed.exact_revision_ref=work.work_ref');
  });

  it.each([{}, { rootSummaryId: 'root', limit: 21 }, { rootSummaryId: 'root', after: '' },
    { rootSummaryId: ['root', 'other'] }, { rootSummaryId: 'root', scope: 'ALL' },
    { rootSummaryId: 'root', tenantId: 'forged' }])('rejects invalid request %j before querying', async query => {
    const h = setup([]);
    await expect(h.service.wikiGuide(query, actor as never)).rejects.toThrow('WIKI_GUIDE_ISSUE_QUERY_INVALID');
    expect(h.database.execute).not.toHaveBeenCalled();
  });

  it('fails closed for an unavailable root/chapter or missing authentic read scope', async () => {
    const h = setup([]);
    h.database.execute.mockResolvedValue([{ scopeValid: false, items: [] }]);
    await expect(h.service.wikiGuide({ rootSummaryId: 'missing' }, actor as never))
      .rejects.toThrow('WIKI_GUIDE_ISSUE_SCOPE_UNAVAILABLE');
    await expect(h.service.wikiGuide({ rootSummaryId: root.summaryId }, { ...actor, tenantId: 'forged' } as never))
      .rejects.toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    const service = new EngineeringIssueSearchService({} as never, {} as never, {} as never);
    await expect(service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never))
      .rejects.toThrow('WIKI_GUIDE_READ_SCOPE_UNAVAILABLE');
  });

  it('does not turn a non-authorization reader failure into a successful partial page', async () => {
    const h = setup([candidate(1)]);
    h.jobAid.readBrowserRevision.mockRejectedValue(new Error('NATIVE_READER_UNAVAILABLE'));
    await expect(h.service.wikiGuide({ rootSummaryId: root.summaryId }, actor as never))
      .rejects.toThrow('NATIVE_READER_UNAVAILABLE');
  });
});
