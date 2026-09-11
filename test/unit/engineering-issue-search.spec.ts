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
    h.matters.readWorkingRevision.mockResolvedValue({
      matterId: 'MAT-1',
      matterWorkRevisionId: 'MWR-1',
      workingRevision: 7,
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
