import { PgDialect } from 'drizzle-orm/pg-core';
import type { DerivedSummaryMemberReading, DerivedSummaryScopeSelection } from '@shared/derived-summary.interface';
import { HierarchicalWikiCompletion } from '../../server/modules/canonical-host/hierarchical-wiki-completion';
import { DerivedSummaryService } from '../../server/modules/canonical-host/derived-summary.service';
import { emptyWikiDemand } from '../../server/modules/canonical-host/hierarchical-wiki-demand';
import { summaryRevision } from './fixtures/derived-summary';
import { buildSummaryMatterCatalog } from '../../server/modules/canonical-host/derived-summary-matter-catalog';

/** Exercises real metadata -> public read -> checkRevision. Storage and ACL
 * reads are local doubles; these cases do not establish physical RLS proof. */
function setup(kind = 'ATA2', sourceKind = 'MATTER') {
  const owner = {
    tenantId: 'saved-display-tenant',
    actorUserId: 'saved-display-actor',
  };
  const sourceKey =
    sourceKind === 'DOCUMENT' ? 'DOCUMENT_FAMILY:F-old' : 'MATTER:MAT-old';
  const member =
    sourceKind === 'DOCUMENT'
      ? {
          kind: 'DOCUMENT_READING' as const,
          documentVersionId: 'DV-old',
          parseRunId: 'PR-old',
          semanticRevision: 1,
          readingRunRef: 'DRR-old',
          readingRevision: 1,
        }
      : {
          kind: 'MATTER_WORK' as const,
          matterId: 'MAT-old',
          workRef: 'MWR-old',
          workRevision: 1,
          issueKeys: [],
        };
  const coarse = {
    ...summaryRevision().members[0]!,
    member,
    evidenceRef: 'coarse-saved',
    evidence: [],
    rootRefs: [],
  };
  const child = {
    ...coarse,
    member: {
      kind: 'DERIVED_SUMMARY' as const,
      summaryId: 'DS-child',
      summaryRef: 'DSR-child-old',
      summaryRevision: 1,
    },
    evidenceRef: 'child-saved',
    issues: [],
  };
  const state = {
    ...emptyWikiDemand(),
    firstDirtyAt: '2026-10-14T00:00:00Z',
    versions: { 'SUMMARY:DS-child': child.member },
    lastGenerated: { [sourceKey]: member, 'SUMMARY:DS-child': child.member },
    delivered: { [sourceKey]: member, 'SUMMARY:DS-child': child.member },
    waiting: [
      {
        kind: 'SUMMARY' as const,
        subjectId: 'DS-child',
        requestId: null,
        documentVersionId: null,
        status: 'PENDING',
      },
    ],
  };
  let retained = [
    {
      key: sourceKey,
      sourceKind,
      sourceId: sourceKind === 'DOCUMENT' ? 'F-old' : 'MAT-old',
    },
  ];
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const database = {
    execute: jest.fn(
      async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const query = dialect.sqlToQuery(statement);
        calls.push(query);
        if (query.sql.includes('FROM hierarchical_wiki_scope w LEFT JOIN'))
          return [
            {
              wikiId: 'WIKI-parent',
              scopeKind: kind,
              state,
              parentSummaryId: 'DS-fleet',
            },
          ];
        if (query.sql.includes('FROM hierarchical_wiki_membership'))
          return retained;
        throw new Error('UNEXPECTED_DISPLAY_QUERY');
      },
    ),
  };
  const revision = {
    ...summaryRevision(),
    scope: {
      ...summaryRevision().scope,
      kind: kind as DerivedSummaryScopeSelection['kind'],
      ata4: kind === 'ATA4' ? '46-00' : null,
      ata2: kind === 'FLEET' ? null : '46',
    },
    members: [coarse, child],
    evidence: [],
    usedEvidenceRefs: ['coarse-saved', 'child-saved'],
    content: {
      headline: '已保存认识',
      listBrief: '保留确切历史范围',
      body: '已有保存正文与原范围 [[coarse-saved]] [[child-saved]]',
      limitations: ['真实的原内容限制'],
    },
  };
  const repository = {
    readBrowser: jest.fn(async (_actor: unknown, operation: Function) =>
      operation(database, owner),
    ),
    head: jest.fn(async () => ({
      summaryId: revision.summaryId,
      ...owner,
      scopeJson: revision.scope,
      membersJson: revision.members.map((item) => item.member),
      currentSummaryRef: revision.summaryRef,
      currentRevision: revision.revision,
    })),
    saved: jest.fn(async () => revision),
    wikiMatterCatalog: jest.fn(async (selected: DerivedSummaryMemberReading[]) =>
      buildSummaryMatterCatalog(selected, [coarse], [])),
  };
  const members = {
    readAll: jest.fn(async () => structuredClone(revision.members)),
  };
  const completion = new HierarchicalWikiCompletion();
  const service = new DerivedSummaryService(
    repository as never,
    members as never,
    {} as never,
    completion,
  );
  return {
    service,
    revision,
    members,
    state,
    calls,
    completion,
    database,
    setRetained: (value: typeof retained) => {
      retained = value;
    },
    sourceKey,
  };
}

test.each(['ATA2', 'FLEET'])(
  'policy-only removal of a retained coarse matter key keeps the exact saved %s body visible',
  async (level) => {
    const f = setup(level),
      before = structuredClone(f.state);
    const result = await f.service.read(f.revision.summaryId, {} as never);
    expect(result.currentBodyStatus).toBe('AVAILABLE');
    expect(result.current!.content).toEqual(f.revision.content);
    expect(f.members.readAll).toHaveBeenCalledWith(
      f.revision.members.map((item) => item.member),
      expect.objectContaining({ actorUserId: 'saved-display-actor' }),
      f.database,
      new Set([f.revision.summaryId]),
    );
    expect(f.state).toEqual(before);
    expect(Object.keys(f.state.versions)).toEqual(['SUMMARY:DS-child']);
    const query = f.calls.find((call) =>
      call.sql.includes('FROM hierarchical_wiki_membership'),
    )!;
    expect(query.params).toEqual(['WIKI-parent']);
    expect(query.sql).toContain("classificationStatus'='CONFIRMED'");
  },
);

test('retained document-family classification keeps its older saved reading visible after parse/source changes', async () => {
  const f = setup('ATA2', 'DOCUMENT');
  const result = await f.service.read(f.revision.summaryId, {} as never);
  expect(result.current?.members[0]?.member).toMatchObject({
    documentVersionId: 'DV-old',
    readingRunRef: 'DRR-old',
  });
  expect(result.current?.content.body).toBe(f.revision.content.body);
  expect(result.memberNotices[0]?.current).toBe(false);
});

test('a revoked original is still rejected by the existing exact saved-body authorization path', async () => {
  const f = setup();
  f.members.readAll.mockRejectedValue(
    new Error('DERIVED_SUMMARY_SOURCE_UNAVAILABLE'),
  );
  await expect(
    f.service.read(f.revision.summaryId, {} as never),
  ).rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
  expect(f.members.readAll).toHaveBeenCalledTimes(1);
});

test('an excluded or deleted coarse classification still hides the mixed old current body', async () => {
  const f = setup();
  f.setRetained([]);
  const result = await f.service.read(f.revision.summaryId, {} as never);
  expect(result.currentBodyStatus).toBe('UPDATING_SCOPE');
  expect(result.current).toBeNull();
  expect(f.members.readAll).not.toHaveBeenCalled();
});

test('a removed saved child cannot be excused by a retained coarse classification', async () => {
  const f = setup();
  f.state.versions = {} as typeof f.state.versions;
  const result = await f.service.read(f.revision.summaryId, {} as never);
  expect(result.currentBodyStatus).toBe('UPDATING_SCOPE');
  expect(result.current).toBeNull();
});

test('an ATA4 membership removal keeps the existing scope-removal boundary', async () => {
  const f = setup('ATA4');
  const result = await f.service.read(f.revision.summaryId, {} as never);
  expect(result.currentBodyStatus).toBe('UPDATING_SCOPE');
  expect(result.current).toBeNull();
});

test('same-looking keys with a changed source identity are not retained membership proof', async () => {
  const f = setup();
  f.setRetained([
    { key: f.sourceKey, sourceKind: 'MATTER', sourceId: 'MAT-foreign' },
  ]);
  const result = await f.service.read(f.revision.summaryId, {} as never);
  expect(result.currentBodyStatus).toBe('UPDATING_SCOPE');
  expect(result.current).toBeNull();
});
