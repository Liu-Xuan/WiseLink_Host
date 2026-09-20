import { EngineeringIssueSearchService } from '../../server/modules/canonical-host/engineering-issue-search.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const actor = {
  userId: 'owner',
  tenantId: 'tenant-A',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'runtime',
  objectAccessActor: {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'owner' },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: 'tenant-A',
      version: 'miaoda-hosted-native-sso.v1',
      decidedAt: '2026-09-11T00:00:00Z',
    },
    tenantId: 'tenant-A',
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'runtime',
    platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  },
} as CanonicalHostActor;

function setup() {
  const saved = jobAidReadingFixture().current!;
  const identity = {
    subjectKind: 'WORK_ITEM' as const,
    subjectId: saved.workItemId,
    workRef: saved.workRevisionRef,
    issueKey: saved.content.issues[0].issueKey,
  };
  const db = { execute: jest.fn().mockResolvedValue([identity]) };
  const jobAid = {
    readBrowserRevision: jest.fn().mockImplementation(async (_id, ref) => {
      if (ref !== saved.workRevisionRef)
        throw Object.assign(new Error('JOBAID_WORK_NOT_FOUND'), {
          statusCode: 404,
        });
      return saved;
    }),
  };
  const matters = { readWorkingRevision: jest.fn() };
  return {
    saved,
    identity,
    db,
    jobAid,
    matters,
    service: new EngineeringIssueSearchService(
      db as never,
      jobAid as never,
      matters as never,
    ),
  };
}

describe('authorized engineering issue search and exact expansion', () => {
  it('returns saved overview coverage with exact expansion', async () => {
    const h = setup();
    h.saved.content.overviewStatus = 'STALE';
    const expanded = await h.service.read(h.identity, actor);
    expect(expanded.identity.overviewStatus).toBe('STALE');
    expect(expanded.identity.workRef).toBe(h.saved.workRevisionRef);
  });

  it('rebuilds pending rows through the actor-scoped exact revision reader', async () => {
    const h = setup();
    const projection = { rebuildPending: jest.fn().mockImplementation(async ({ load }: { load: (item: { ownerKind: 'USER'; revisionRef: string; ownerId: string; subjectId: string }) => Promise<unknown> }) => {
      const content = await load({ ownerKind: 'USER', revisionRef: h.saved.workRevisionRef, ownerId: actor.userId, subjectId: h.saved.workItemId });
      expect(content).toBe(h.saved.content);
      return { attempted: 1, rebuilt: 1, failed: 0 };
    }) };
    const service = new EngineeringIssueSearchService(h.db as never, h.jobAid as never, h.matters as never, projection as never);
    await expect(service.rebuildProjection(10, actor)).resolves.toEqual({ attempted: 1, rebuilt: 1, failed: 0 });
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledWith(h.saved.workItemId, h.saved.workRevisionRef, actor);
  });

  it('loads each matching work once within a search, but reauthorizes the next request', async () => {
    const h = setup();
    h.saved.content.issues.push({
      ...structuredClone(h.saved.content.issues[0]),
      issueKey: 'another-issue',
    });
    h.db.execute.mockResolvedValue([
      h.identity,
      { ...h.identity, issueKey: 'another-issue' },
    ]);
    expect((await h.service.search('工具', actor)).hits).toHaveLength(2);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(1);
    h.jobAid.readBrowserRevision.mockRejectedValue(
      new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'),
    );
    expect((await h.service.search('工具', actor)).hits).toHaveLength(0);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(2);
  });
  it('continues past a full page of revoked work to find later readable issues', async () => {
    const h = setup();
    const denied = Array.from({ length: 51 }, (_, n) => ({
      ...h.identity,
      workRef: 'revoked-work',
      issueKey: `revoked-${String(n).padStart(3, '0')}`,
    }));
    h.db.execute
      .mockResolvedValueOnce(denied)
      .mockResolvedValueOnce([h.identity]);
    const result = await h.service.search('工具', actor);
    expect(result.hits.map((hit) => hit.workRef)).toEqual([h.identity.workRef]);
    expect(result.hasMore).toBe(false);
    expect(h.db.execute).toHaveBeenCalledTimes(2);
    // One denied exact work read is shared across its issues, never exposed.
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(2);
  });

  it('counts only readable hits toward the result limit and hasMore', async () => {
    const h = setup();
    const issues = Array.from({ length: 51 }, (_, n) => ({
      ...structuredClone(h.saved.content.issues[0]),
      issueKey: `readable-${String(n).padStart(3, '0')}`,
    }));
    h.saved.content.issues = issues;
    h.db.execute
      .mockResolvedValueOnce(
        Array.from({ length: 51 }, (_, n) => ({
          ...h.identity,
          workRef: 'revoked-work',
          issueKey: `denied-${n}`,
        })),
      )
      .mockResolvedValueOnce(
        issues.map((issue) => ({ ...h.identity, issueKey: issue.issueKey })),
      );
    const result = await h.service.search('工具', actor);
    expect(result.hits).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.hits.every((hit) => hit.workRef === h.identity.workRef)).toBe(
      true,
    );
    expect(h.db.execute).toHaveBeenCalledTimes(2);
  });

  it('returns only authorized issue headers and expands the saved identity without asking for latest work', async () => {
    const h = setup();
    const found = await h.service.search('工具', actor);
    expect(found.hits).toHaveLength(1);
    expect(found.limitations).toEqual([
      '仅返回当前已保存且经授权展开的问题工作；结果不代表全量统计。',
    ]);
    expect(found.hits[0]).toMatchObject({
      kind: 'WORK',
      matchedRange: `issue:${h.identity.issueKey}`,
      reason: 'FULL_TEXT',
      rootRefs: expect.any(Array),
    });
    expect(found.hits[0]).not.toHaveProperty('issue');
    expect(found.hits[0]).not.toHaveProperty('reading');
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledWith(
      h.identity.subjectId,
      h.identity.workRef,
      actor,
    );
    const expanded = await h.service.read(found.hits[0], actor);
    expect(expanded.issue).toEqual(h.saved.content.issues[0]);
    expect(expanded.identity.workRef).toBe(h.saved.workRevisionRef);
    await expect(
      h.service.read({ ...h.identity, workRef: 'missing' }, actor),
    ).rejects.toThrow('JOBAID_WORK_NOT_FOUND');
  });

  it('does not disclose a question whose retained source authorization was revoked', async () => {
    const h = setup();
    h.jobAid.readBrowserRevision.mockRejectedValue(
      new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'),
    );
    expect((await h.service.search('工具', actor)).hits).toEqual([]);
    await expect(h.service.read(h.identity, actor)).rejects.toThrow(
      'JOBAID_SOURCE_AUTHORIZATION_CHANGED',
    );
  });

  it('reports infrastructure failures instead of describing them as no matches', async () => {
    const h = setup();
    h.jobAid.readBrowserRevision.mockRejectedValue(
      new Error('DATABASE_UNAVAILABLE'),
    );
    await expect(h.service.search('工具', actor)).rejects.toThrow(
      'DATABASE_UNAVAILABLE',
    );
  });

  it('uses the real Matter reader for a Matter work ref', async () => {
    const h = setup();
    h.saved.content.overviewStatus = 'STALE';
    const notice = { attemptRef: 'AQ-correction', issueKey: h.identity.issueKey,
      reason: '依赖尚未核实，不能据此认定确定无影响。', attemptStatus: 'FAILED', correctedWorkRef: null };
    const overviewNotice = { attemptRef: 'AQ-overview', targetWorkRef: 'MWR-1',
      reason: '总体认识仍需核对。', attemptStatus: 'SUCCEEDED', savedWorkRef: 'MWR-2', savedWorkingRevision: 8 };
    h.matters.readWorkingRevision.mockResolvedValue({
      matterId: 'MAT-1',
      matterWorkRevisionId: 'MWR-1',
      workingRevision: 7,
      overviewSourceWork: { workRef: 'MWR-overview-4', workingRevision: 4 },
      correctionNotices: [notice, { ...notice, issueKey: 'unrelated-issue', reason: 'Other scope' }],
      overviewCorrectionNotices: [overviewNotice],
      state: {
        problemWork: h.saved.content,
        substantiveResult: {
          ...(await h.service.read(h.identity, actor)).reading,
          scope: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-1' },
        },
      },
    });
    const identity = {
      ...h.identity,
      subjectKind: 'ENGINEERING_MATTER' as const,
      subjectId: 'MAT-1',
      workRef: 'MWR-1',
    };
    h.db.execute.mockResolvedValue([identity]);
    const found = await h.service.search('工具', actor);
    expect(found.hits[0].workRevision).toBe(7);
    expect(found.hits[0].overviewStatus).toBe('STALE');
    expect(found.hits[0].overviewSourceWork).toEqual({ workRef: 'MWR-overview-4', workingRevision: 4 });
    expect(found.hits[0].correctionNotices).toEqual([notice]);
    expect(found.hits[0].overviewCorrectionNotices).toEqual([overviewNotice]);
    const expanded = await h.service.read(identity, actor);
    expect(expanded.identity.correctionNotices).toEqual([notice]);
    expect(expanded.identity.overviewCorrectionNotices).toEqual([overviewNotice]);
    expect(expanded.identity.overviewSourceWork).toEqual(found.hits[0].overviewSourceWork);
    expect(expanded.issue.body).toBe(h.saved.content.issues[0].body);
    expect(h.matters.readWorkingRevision).toHaveBeenCalledWith(
      'MAT-1',
      'MWR-1',
      actor,
    );
  });

  it('rejects a missing or mismatched native actor before searching any rows', async () => {
    const h = setup();
    await expect(
      h.service.search('工具', { ...actor, userId: 'other' }),
    ).rejects.toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    await expect(
      h.service.search('工具', { ...actor, objectAccessActor: undefined }),
    ).rejects.toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    expect(h.db.execute).not.toHaveBeenCalled();
  });
});


describe('saved knowledge catalogue', () => {
  it('keeps overview evidence separate from updated problem evidence', async () => {
    const h = setup();
    h.saved.content.overviewStatus = 'STALE';
    const problemEvidence = structuredClone(h.saved.content.evidence);
    const currentReading = (await h.service.read(h.identity, actor)).reading!;
    const overviewEvidence = [{
      ...structuredClone(problemEvidence[0]),
      evidenceRef: 'overview-evidence',
      title: '旧综合独有依据',
    }];
    h.matters.readWorkingRevision.mockResolvedValue({
      matterId: 'MAT-STALE',
      matterWorkRevisionId: 'MW-STALE',
      workingRevision: 3,
      createdAt: '2026-09-17T00:00:00.000Z',
      correctionNotices: [],
      overviewCorrectionNotices: [],
      referenceWorkNotices: [],
      overviewSourceWork: { workRef: 'MW-OLDER', workingRevision: 2 },
      state: {
        problemWork: h.saved.content,
        substantiveResult: { ...currentReading, evidence: overviewEvidence },
      },
    });
    const identity = {
      subjectKind: 'ENGINEERING_MATTER' as const,
      subjectId: 'MAT-STALE',
      workRef: 'MW-STALE',
      issueKey: h.identity.issueKey,
    };
    h.db.execute.mockResolvedValue([{ ...identity, current: true }]);

    const knowledge = await h.service.readKnowledge({
      subjectKind: identity.subjectKind,
      subjectId: identity.subjectId,
      workRef: identity.workRef,
    }, actor);
    expect(knowledge.reading?.evidence).toEqual(overviewEvidence);
    expect(knowledge.content.evidence).toEqual(problemEvidence);

    const issue = await h.service.read(identity, actor);
    expect(issue.reading?.evidence).toEqual(overviewEvidence);
    expect(issue.evidence).toEqual(problemEvidence);
  });

  it('keeps authorized Matter problem work readable before an overview exists', async () => {
    const h = setup();
    h.saved.content.overviewStatus = 'NOT_AVAILABLE';
    const oldReading = (await h.service.read(h.identity, actor)).reading;
    h.matters.readWorkingRevision.mockResolvedValue({
      matterId: 'MAT-PROBLEM',
      matterWorkRevisionId: 'MW-PROBLEM',
      workingRevision: 1,
      createdAt: '2026-09-17T00:00:00.000Z',
      state: { problemWork: h.saved.content, substantiveResult: oldReading },
    });
    const identity = {
      subjectKind: 'ENGINEERING_MATTER' as const,
      subjectId: 'MAT-PROBLEM',
      workRef: 'MW-PROBLEM',
      issueKey: h.identity.issueKey,
    };
    h.db.execute.mockResolvedValue([{ ...identity, current: true }]);
    const page = await h.service.catalogue('', 'CURRENT', undefined, actor);
    expect(page.entries).toEqual([expect.objectContaining({
      subjectId: identity.subjectId,
      overviewStatus: 'NOT_AVAILABLE',
      headline: h.saved.content.headline,
    })]);
    const work = await h.service.readKnowledge({
      subjectKind: identity.subjectKind,
      subjectId: identity.subjectId,
      workRef: identity.workRef,
    }, actor);
    expect(work.reading).toBeNull();
    expect(work.content.issues[0].body).toBe(h.saved.content.issues[0].body);
    const issue = await h.service.read(identity, actor);
    expect(issue.reading).toBeNull();
    expect(issue.evidence).toEqual(h.saved.content.evidence);
    expect(h.matters.readWorkingRevision).toHaveBeenCalledWith(
      identity.subjectId, identity.workRef, actor,
    );
  });

  it('browses exact saved titles and briefs without a query and keeps overview coverage separate from currentness', async () => {
    const h = setup();
    h.saved.content.overviewStatus = 'STALE';
    h.db.execute.mockResolvedValue([{ ...h.identity, current: true }]);
    const page = await h.service.catalogue('', 'CURRENT', undefined, actor);
    expect(page.entries).toEqual([expect.objectContaining({ headline: h.saved.content.headline,
      listBrief: h.saved.content.listBrief, current: true, overviewStatus: 'STALE', workRef: h.saved.workRevisionRef })]);
    expect(page.entries[0]).not.toHaveProperty('content');
    expect(page.nextCursor).toBeNull();
    const read = await h.service.readKnowledge({ subjectKind: 'WORK_ITEM', subjectId: h.saved.workItemId, workRef: h.saved.workRevisionRef }, actor);
    expect(read.content).toBe(h.saved.content);
  });

  it('continues across denied work and never exposes denied identity metadata', async () => {
    const h = setup();
    h.db.execute.mockResolvedValueOnce(Array.from({ length: 40 }, (_, n) => ({ ...h.identity, workRef: `revoked-${n}`, current: false })))
      .mockResolvedValueOnce([{ ...h.identity, current: false }]);
    const page = await h.service.catalogue('', 'HISTORICAL', undefined, actor);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].current).toBe(false);
    expect(JSON.stringify(page)).not.toContain('revoked');
  });

  it('limits candidate scans and does not report an incomplete denied scan as an empty complete page', async () => {
    const h = setup();
    h.db.execute.mockResolvedValue(Array.from({ length: 40 }, (_, n) => ({ ...h.identity, workRef: `revoked-${n}`, current: false })));
    await expect(h.service.catalogue('', 'ALL', undefined, actor)).rejects.toThrow('ENGINEERING_KNOWLEDGE_SCAN_LIMIT');
    expect(h.db.execute).toHaveBeenCalledTimes(5);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(200);
  });

  it('uses the last visible identity for a 20-entry page cursor and rejects replay with another filter', async () => {
    const h = setup();
    const rows = Array.from({ length: 21 }, (_, n) => ({ ...h.identity, subjectId: `WI-${String(n).padStart(2, '0')}`, current: true }));
    h.db.execute.mockResolvedValue(rows);
    const page = await h.service.catalogue('工具', 'ALL', undefined, actor);
    expect(page.entries).toHaveLength(20);
    const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString());
    expect(cursor.identity.subjectId).toBe('WI-19');
    await expect(h.service.catalogue('另一关键词', 'ALL', page.nextCursor!, actor)).rejects.toThrow('ENGINEERING_KNOWLEDGE_CURSOR_INVALID');
    await expect(h.service.catalogue('工具', 'CURRENT', page.nextCursor!, actor)).rejects.toThrow('ENGINEERING_KNOWLEDGE_CURSOR_INVALID');
  });

  it('reauthorizes direct reads and propagates data failures instead of silently dropping them', async () => {
    const h = setup();
    h.jobAid.readBrowserRevision.mockRejectedValue(new Error('CORRUPT_SAVED_WORK'));
    await expect(h.service.catalogue('', 'CURRENT', undefined, actor)).rejects.toThrow('CORRUPT_SAVED_WORK');
    h.jobAid.readBrowserRevision.mockRejectedValue(Object.assign(new Error('REVOKED'), { statusCode: 403 }));
    await expect(h.service.readKnowledge({ subjectKind: 'WORK_ITEM', subjectId: h.saved.workItemId, workRef: h.saved.workRevisionRef }, actor)).rejects.toThrow('REVOKED');
  });

  it('keeps catalogue reads bounded at four in flight and preserves SQL row order regardless of completion order', async () => {
    const h = setup();
    const rows = Array.from({ length: 9 }, (_, n) => ({ ...h.identity, subjectId: `WI-${String(n).padStart(2, '0')}`, current: true }));
    h.db.execute.mockResolvedValue(rows);
    const flush = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    };
    let inFlight = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    h.jobAid.readBrowserRevision.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      let release!: () => void;
      const pending = new Promise((resolve) => {
        release = () => { inFlight -= 1; resolve(h.saved); };
      });
      resolvers.push(release);
      return pending;
    });
    const cataloguePromise = h.service.catalogue('', 'ALL', undefined, actor);
    await flush();
    expect(resolvers).toHaveLength(4);
    resolvers[2]();
    resolvers[0]();
    await flush();
    expect(resolvers).toHaveLength(4);
    resolvers[3]();
    resolvers[1]();
    await flush();
    expect(resolvers).toHaveLength(8);
    for (const release of resolvers.slice(4)) release();
    await flush();
    expect(resolvers).toHaveLength(9);
    resolvers[8]();
    const page = await cataloguePromise;
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(page.entries.map((entry) => entry.subjectId)).toEqual(rows.map((row) => row.subjectId));
    expect(page.nextCursor).toBeNull();
  });

  it('stops launching read groups once the page is complete and ignores speculative tail failures', async () => {
    const h = setup();
    const rows = Array.from({ length: 28 }, (_, n) => ({ ...h.identity, subjectId: `WI-${String(n).padStart(2, '0')}`, current: true }));
    h.db.execute.mockResolvedValue(rows);
    h.jobAid.readBrowserRevision.mockImplementation(async (id: string) => {
      if (['WI-21', 'WI-22', 'WI-23'].includes(id)) throw new Error('CORRUPT_SPECULATIVE_TAIL');
      return h.saved;
    });
    const page = await h.service.catalogue('', 'ALL', undefined, actor);
    expect(page.entries).toHaveLength(20);
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString()).identity.subjectId).toBe('WI-19');
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(24);
    expect(h.db.execute).toHaveBeenCalledTimes(1);
  });

  it('mixes denied and readable work across scan groups and continues the page from the last visible identity', async () => {
    const h = setup();
    const batch = Array.from({ length: 40 }, (_, n) => n % 4 === 3
      ? { ...h.identity, subjectId: `WI-DENIED-${String(n).padStart(2, '0')}`, workRef: `revoked-${n}`, current: true }
      : { ...h.identity, subjectId: `WI-OK-${String(n).padStart(2, '0')}`, current: true });
    const rest = Array.from({ length: 10 }, (_, n) => ({ ...h.identity, subjectId: `WI-OK-${String(28 + n).padStart(2, '0')}`, current: true }));
    h.db.execute.mockResolvedValueOnce(batch).mockResolvedValueOnce(rest);
    const page = await h.service.catalogue('', 'ALL', undefined, actor);
    expect(page.entries.map((entry) => entry.subjectId)).toEqual(
      batch.filter((_, n) => n % 4 !== 3).slice(0, 20).map((row) => row.subjectId));
    expect(page.entries.every((entry) => !entry.subjectId.includes('DENIED') && !entry.workRef.startsWith('revoked'))).toBe(true);
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString()).identity.subjectId).toBe('WI-OK-25');
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(28);
    expect(h.db.execute).toHaveBeenCalledTimes(1);
    const next = await h.service.catalogue('', 'ALL', page.nextCursor!, actor);
    expect(next.entries.map((entry) => entry.subjectId)).toEqual(rest.map((row) => row.subjectId));
    expect(next.nextCursor).toBeNull();
  });

  it('reads a duplicated exact identity once per request but reads the same workRef under another subject separately', async () => {
    const h = setup();
    h.matters.readWorkingRevision.mockResolvedValue({
      matterId: 'MAT-1', matterWorkRevisionId: h.saved.workRevisionRef, workingRevision: 7,
      createdAt: '2026-09-01T00:00:00.000Z',
      correctionNotices: [], overviewCorrectionNotices: [], referenceWorkNotices: [], overviewSourceWork: null,
      state: { problemWork: h.saved.content, substantiveResult: { sections: [] } },
    });
    h.db.execute.mockResolvedValue([
      { ...h.identity, current: true },
      { ...h.identity, current: true },
      { ...h.identity, subjectId: 'WI-OTHER', current: true },
      { ...h.identity, subjectKind: 'ENGINEERING_MATTER' as const, subjectId: 'MAT-1', current: true },
    ]);
    const page = await h.service.catalogue('', 'ALL', undefined, actor);
    expect(page.entries).toHaveLength(4);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(2);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledWith('WI-OTHER', h.saved.workRevisionRef, actor);
    expect(h.matters.readWorkingRevision).toHaveBeenCalledTimes(1);
  });

  it('reauthorizes catalogue reads on the next request and observes revocation', async () => {
    const h = setup();
    h.db.execute.mockResolvedValue([{ ...h.identity, current: true }]);
    expect((await h.service.catalogue('', 'ALL', undefined, actor)).entries).toHaveLength(1);
    h.jobAid.readBrowserRevision.mockRejectedValue(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'));
    expect((await h.service.catalogue('', 'ALL', undefined, actor)).entries).toHaveLength(0);
    expect(h.jobAid.readBrowserRevision).toHaveBeenCalledTimes(2);
  });

  it('propagates a consumed data failure from a mixed group instead of dropping it', async () => {
    const h = setup();
    h.db.execute.mockResolvedValue([
      { ...h.identity, subjectId: 'WI-OK-1', current: true },
      { ...h.identity, subjectId: 'WI-DENIED', workRef: 'revoked', current: true },
      { ...h.identity, subjectId: 'WI-CORRUPT', current: true },
      { ...h.identity, subjectId: 'WI-OK-2', current: true },
    ]);
    h.jobAid.readBrowserRevision.mockImplementation(async (id: string, ref: string) => {
      if (id === 'WI-CORRUPT') throw new Error('CORRUPT_SAVED_WORK');
      if (ref !== h.saved.workRevisionRef)
        throw Object.assign(new Error('JOBAID_WORK_NOT_FOUND'), { statusCode: 404 });
      return h.saved;
    });
    await expect(h.service.catalogue('', 'ALL', undefined, actor)).rejects.toThrow('CORRUPT_SAVED_WORK');
  });
});
