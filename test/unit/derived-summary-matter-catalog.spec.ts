import { PgDialect } from 'drizzle-orm/pg-core';
import type { DerivedSummaryContent, DerivedSummaryContextBasis, DerivedSummaryMember,
  DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import type { MatterMaterialLink } from '@shared/matter-material.interface';
import { buildSummaryMatterCatalog, readSummaryMatterCatalog, authorizeSummaryMatterCatalog,
  assertSummaryMatterContent, summaryMatterInstruction, type SummaryMatterAssociation,
} from '@server/modules/canonical-host/derived-summary-matter-catalog';
import { assertSummaryContextUnchanged, publicSummaryRevision,
  summaryContextStatus } from '@server/modules/canonical-host/derived-summary-current-context';
import { summaryMemberRef } from '@server/modules/canonical-host/derived-summary.validation';
import { summaryRevision } from './fixtures/derived-summary';
import { EngineeringMatterRepository } from '@server/modules/canonical-host/engineering-matter.repository';
import { DerivedSummaryService } from '@server/modules/canonical-host/derived-summary.service';

const actor = { tenantId: 'tenant-matter-catalog', actorUserId: 'owner-matter-catalog' };
const dialect = new PgDialect();
const document = (id: string): DerivedSummaryMember => ({ kind: 'DOCUMENT_READING', documentVersionId: `DV-${id}`,
  parseRunId: `PARSE-${id}-r1`, semanticRevision: 2, readingRunRef: `DRR-${id}-r1`, readingRevision: 1 });
const work = (id: string, doc: string, revision = 1): DerivedSummaryMember => ({ kind: 'WORK_ITEM_WORK',
  workItemId: `WI-${id}`, documentVersionId: `DV-${doc}`, workRef: `JAWR-${id}-r${revision}`, workRevision: revision, issueKeys: [] });
function reading(member: DerivedSummaryMember, doc: string): DerivedSummaryMemberReading {
  return { member, evidenceRef: summaryMemberRef(member), headline: '同名工程问题', body: '仅构型 A，12 项未核；SB TBD。',
    issues: [], evidence: [{ kind: 'DOCUMENT_PASSAGE', evidenceRef: `source-${doc}-r1`, workItemId: null,
      documentVersionId: `DV-${doc}`, sourceRefId: `SR-${doc}`, locator: 'page 1', title: doc, versionLabel: '1.2',
      excerpt: '未关闭，SB TBD；不能用于构型 B。' }], rootRefs: [`source-${doc}-r1`],
    limitations: ['构型 B 不适用'], current: true, overviewStatus: 'CURRENT', leaves: [member] };
}
function material(doc: string, kind: 'MEMBER' | 'RELATED' = 'MEMBER', disposition: 'INCLUDED' | 'EXCLUDED' = 'INCLUDED'): MatterMaterialLink {
  return { materialId: `material-${doc}`, kind, familyId: `family-${doc}`, documentVersionId: `DV-${doc}`,
    disposition, scope: '仅配置 A；不是 13 项，12 项待核。', contribution: 'OPS 无设定日期，SB TBD。', basis: [], origin: 'ENGINEER' };
}
const association = (id: string, docs: string[], links: string[] = []): SummaryMatterAssociation => ({
  matterId: `MAT-${id}`, matterRevisionId: `MREV-${id}-r2`, title: '同名工程问题',
  materials: docs.map(doc => material(doc)), links: links.map(id => ({ workItemId: `WI-${id}`, documentVersionId: 'DV-FTD' })),
});
const content = (body: string): DerivedSummaryContent => ({ headline: 'B787 ATA 45', listBrief: 'SB TBD。', body, limitations: [] });
const context = (catalog?: ReturnType<typeof buildSummaryMatterCatalog>): DerivedSummaryContextBasis => ({
  schemaVersion: 'wiselink.derived-summary-context.v1', sources: [], memberNotices: [], workItems: [], matters: [], summaries: [],
  ...(catalog ? { wikiMatterCatalog: catalog } : {}), uncoordinatedDependencies: [],
});

it('uses one formal Matter for FTD, SL, SB, assessment and historical work without changing exact versions or evidence', () => {
  const leaves = [reading(document('FTD'), 'FTD'), reading(document('SL'), 'SL'), reading(document('SB'), 'SB'),
    reading(work('evaluation', 'FTD'), 'FTD'), reading(work('evaluation', 'FTD', 2), 'FTD')];
  const before = JSON.stringify(leaves);
  const catalog = buildSummaryMatterCatalog(leaves, leaves, [association('one', ['FTD', 'SL', 'SB'], ['evaluation'])]);
  expect(catalog.entries).toHaveLength(1);
  expect(catalog.entries[0].bindings).toHaveLength(5);
  expect(catalog.entries[0].bindings.map(binding => binding.leaf)).toEqual(expect.arrayContaining(leaves.map(item => item.member)));
  expect(catalog.unbound).toEqual([]);
  expect(JSON.stringify(leaves)).toBe(before);
  expect(new Set(catalog.entries.flatMap(entry => entry.bindings.flatMap(binding => binding.sourceRefs))).size).toBe(3);
});

it('keeps same-named Matter IDs separate even when their exact FTD source is shared', () => {
  const leaves = [reading(document('FTD'), 'FTD'), reading(work('A', 'FTD'), 'FTD'), reading(work('B', 'FTD'), 'FTD')];
  const catalog = buildSummaryMatterCatalog(leaves, leaves,
    [association('A', ['FTD'], ['A']), association('B', ['FTD'], ['B'])]);
  expect(catalog.entries.map(entry => entry.matterId)).toEqual(['MAT-A', 'MAT-B']);
  expect(catalog.entries[0].bindings.map(binding => binding.leaf)).not.toContainEqual(leaves[2].member);
  expect(catalog.entries[1].bindings.map(binding => binding.leaf)).not.toContainEqual(leaves[1].member);
  expect(catalog.entries.map(entry => [...new Set(entry.bindings.flatMap(binding => binding.sourceRefs))]))
    .toEqual([['source-FTD-r1'], ['source-FTD-r1']]);
});

it('never invents Matter ownership from a title, family, EXPECTED, RELATED, EXCLUDED or a newer version', () => {
  const leaves = ['FTD', 'SL', 'SB', 'old', 'expected'].map(doc => reading(document(doc), doc));
  const row = association('one', []);
  row.materials = [material('FTD', 'RELATED'), material('SL', 'MEMBER', 'EXCLUDED'), material('new'),
    { ...material('expected'), kind: 'EXPECTED', familyId: null, documentVersionId: null,
      expected: { issuer: null, documentNumber: null, description: 'SB TBD', expectedContribution: '未来最终措施',
        expectedDate: null, sourceAsOf: '2026-10-21', publicationStatus: 'UNKNOWN', acquisitionStatus: 'NOT_ACQUIRED', fulfilledBy: [] } }];
  const catalog = buildSummaryMatterCatalog(leaves, leaves, [row]);
  expect(catalog.entries).toEqual([]);
  expect(catalog.unbound).toHaveLength(leaves.length);
  expect(catalog.unbound.map(binding => binding.leaf)).toEqual(expect.arrayContaining(leaves.map(item => item.member)));
});

it('keeps FTD REFERENCE and its saved assessment inside an established SB Matter without treating reference as membership', () => {
  const ftd = reading(document('FTD'), 'FTD'), sb = reading(document('SB'), 'SB');
  const assessment = reading(work('evaluation', 'SB'), 'SB');
  assessment.evidence.push(...ftd.evidence);
  const row = association('one', ['SB'], ['evaluation']);
  row.links[0].documentVersionId = 'DV-SB'; row.materials.push(material('FTD', 'RELATED'));
  const catalog = buildSummaryMatterCatalog([ftd, sb, assessment], [ftd, sb, assessment], [row]);
  expect(catalog.entries).toHaveLength(1);
  expect(catalog.unbound).toEqual([]);
  expect(catalog.entries[0].bindings.find(binding => binding.leaf.kind === 'DOCUMENT_READING' &&
    binding.leaf.documentVersionId === 'DV-FTD')?.association).toEqual({ kind: 'REFERENCE_CONTEXT',
    material: material('FTD', 'RELATED'), supportingLeafRefs: [assessment.evidenceRef] });
  const noSavedReference = { ...assessment, evidence: sb.evidence };
  const unreferenced = buildSummaryMatterCatalog([ftd, sb, noSavedReference], [ftd, sb, noSavedReference], [row]);
  expect(unreferenced.unbound.map(binding => binding.leaf)).toEqual([ftd.member]);
});

it('keeps a shared reference in two independent Matter contexts and never uses that reference to merge them', () => {
  const ftd = reading(document('FTD'), 'FTD');
  const workA = reading(work('A', 'SB-A'), 'SB-A'), workB = reading(work('B', 'SB-B'), 'SB-B');
  workA.evidence.push(...ftd.evidence); workB.evidence.push(...ftd.evidence);
  const rows = [association('A', ['SB-A'], ['A']), association('B', ['SB-B'], ['B'])];
  rows.forEach(row => row.materials.push(material('FTD', 'RELATED')));
  const catalog = buildSummaryMatterCatalog([ftd, workA, workB], [ftd, workA, workB], rows);
  expect(catalog.entries).toHaveLength(2);
  for (const [index, entry] of catalog.entries.entries()) {
    const reference = entry.bindings.find(binding => binding.association.kind === 'REFERENCE_CONTEXT');
    expect(reference?.association).toMatchObject({ supportingLeafRefs: [index === 0 ? workA.evidenceRef : workB.evidenceRef] });
    expect(entry.bindings.filter(binding => binding.association.kind !== 'REFERENCE_CONTEXT')).toHaveLength(1);
  }
});

it('supports a pre-material exact WorkItem relation, and groups several saved child summaries by formal Matter', () => {
  const ftd = reading(document('FTD'), 'FTD'), assessment = reading(work('A', 'FTD'), 'FTD');
  const child = (id: string, leaf: DerivedSummaryMemberReading): DerivedSummaryMemberReading => ({ ...leaf,
    member: { kind: 'DERIVED_SUMMARY', summaryId: `DS-${id}`, summaryRef: `DSR-${id}-r3`, summaryRevision: 3 },
    evidenceRef: `DERIVED_SUMMARY:DS-${id}:DSR-${id}-r3`, leaves: [leaf.member] });
  const catalog = buildSummaryMatterCatalog([child('a', ftd), child('b', assessment)], [ftd, assessment], [association('one', [], ['A'])]);
  expect(catalog.entries).toHaveLength(1);
  expect(catalog.entries[0].bindings.map(binding => binding.association.kind)).toEqual(['LINKED_DOCUMENT', 'WORK_ITEM_LINK']);
  expect(catalog.entries[0].bindings.map(binding => binding.memberRef)).toEqual([
    'DERIVED_SUMMARY:DS-a:DSR-a-r3', 'DERIVED_SUMMARY:DS-b:DSR-b-r3']);
});

it('seals the formal directory as optional control metadata without rewriting old saved content', () => {
  const leaf = reading(document('FTD'), 'FTD');
  const catalog = buildSummaryMatterCatalog([leaf], [leaf], [association('one', ['FTD'])]);
  const old = context(), before = JSON.stringify(old);
  expect(summaryMatterInstruction('旧指令')).toBe('旧指令');
  expect(() => assertSummaryContextUnchanged(old, structuredClone(old))).not.toThrow();
  const saved = context(catalog);
  const changed = structuredClone(saved); changed.wikiMatterCatalog!.entries[0].matterRevisionId = 'MREV-one-r3';
  expect(() => assertSummaryContextUnchanged(saved, changed)).toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
  expect(summaryContextStatus(saved, changed).reasons).toContain('CHANGED_WIKIMATTERCATALOG');
  expect(JSON.stringify(old)).toBe(before);
  const revision = { ...summaryRevision(), contextBasis: saved };
  expect(publicSummaryRevision(revision)).not.toHaveProperty('contextBasis');
  expect(revision.contextBasis).toEqual(saved);
  const instruction = summaryMatterInstruction('工程阅读规则', catalog);
  expect(instruction).toContain('工程阅读规则\n\n<HOST_WIKI_MATTER_CATALOG>\n');
  expect(JSON.parse(instruction.split('<HOST_WIKI_MATTER_CATALOG>\n')[1].split('\n</HOST_WIKI_MATTER_CATALOG>')[0]))
    .toEqual(catalog);
});

it('accepts one attributed Matter section, preserves unknown/negative/TBD text and rejects model-selected membership or duplicate rows', () => {
  const leaves = [reading(document('FTD'), 'FTD'), reading(document('SB'), 'SB')];
  const catalog = buildSummaryMatterCatalog(leaves, leaves, [association('A', ['FTD']), association('B', ['SB'])]);
  const a = '## 事项：MAT-A | 同名工程问题\n### 当前状态\n未关闭，仅 12 项，SB TBD。 [[source-FTD-r1]]';
  const b = '## 事项：MAT-B | 同名工程问题\n### 当前状态\n未记载。 [[source-SB-r1]]';
  expect(() => assertSummaryMatterContent(content(a + '\n\n' + b), catalog)).not.toThrow();
  for (const body of [a, a + '\n\n' + a + '\n\n' + b, a.replace('MAT-A', 'MAT-invented') + '\n\n' + b,
    a.replace('source-FTD-r1', 'source-SB-r1') + '\n\n' + b,
    '```markdown\n' + a + '\n```\n\n' + b])
    expect(() => assertSummaryMatterContent(content(body), catalog)).toThrow();
});

it('does not use a shared child summary citation alone as Matter-specific support; unbound sources cannot be assigned', () => {
  const leaf = reading(document('FTD'), 'FTD'), extra = reading(document('unbound'), 'unbound');
  const child: DerivedSummaryMemberReading = { ...leaf, member: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-one',
    summaryRef: 'DSR-one', summaryRevision: 1 }, evidenceRef: 'DERIVED_SUMMARY:DS-one:DSR-one', leaves: [leaf.member] };
  const catalog = buildSummaryMatterCatalog([child, extra], [leaf, extra], [association('one', ['FTD'])]);
  const base = '## 事项：MAT-one | 工程问题\n未关闭。 [[DERIVED_SUMMARY:DS-one:DSR-one]]';
  const tail = '\n\n## 未归属资料\n[[source-unbound-r1]]';
  expect(() => assertSummaryMatterContent(content(base + tail), catalog)).toThrow('DERIVED_SUMMARY_MATTER_SOURCE_REQUIRED');
  expect(() => assertSummaryMatterContent(content(base + ' [[source-FTD-r1]]' + tail), catalog)).not.toThrow();
  expect(() => assertSummaryMatterContent(content(base + ' [[source-unbound-r1]]' + tail), catalog)).toThrow();
});

it('uses existing exact Matter revision authorization for runtime and shared browser read; denial releases no catalog', async () => {
  const leaf = reading(document('FTD'), 'FTD');
  const rows = [{ ...association('one', ['FTD']), materials: [JSON.stringify(material('FTD'))] }];
  const database = { execute: jest.fn().mockResolvedValue(rows) };
  const members = { readAll: jest.fn().mockResolvedValue([leaf]) };
  const matters = { authorizeRuntimeInputs: jest.fn().mockResolvedValue(undefined), authorizeReadInputs: jest.fn().mockResolvedValue(undefined) };
  const catalog = await readSummaryMatterCatalog([leaf], actor, database as never, members as never, matters as never);
  expect(matters.authorizeRuntimeInputs).toHaveBeenCalledWith({ ...actor, matterId: 'MAT-one', basedOnMatterRevisionId: 'MREV-one-r2' }, database);
  await authorizeSummaryMatterCatalog(catalog, { ...actor, readScope: 'TENANT' }, database as never, matters as never);
  expect(matters.authorizeReadInputs).toHaveBeenCalledWith({ ...actor, readScope: 'TENANT', matterId: 'MAT-one',
    basedOnMatterRevisionId: 'MREV-one-r2' }, database);
  const query = dialect.sqlToQuery(database.execute.mock.calls[0][0]);
  expect(query.sql).toContain("l.document_version_id=selected->>'documentVersionId'");
  expect(query.params.filter((value): value is string => typeof value === 'string' && value.startsWith('['))
    .map(value => JSON.parse(value))).toContainEqual([leaf.member]);
  matters.authorizeRuntimeInputs.mockRejectedValueOnce(new Error('MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE'));
  await expect(readSummaryMatterCatalog([leaf], actor, database as never, members as never, matters as never))
    .rejects.toThrow('MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE');
});

it.each(['create', 'link'] as const)('%s waits for the selected WorkItem source family before any Matter write (transaction double)', async operation => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const statements: string[] = [];
  const chain = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
  const database = { select: jest.fn().mockReturnValue(chain), insert: jest.fn(),
    execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = dialect.sqlToQuery(statement); statements.push(query.sql);
      expect(query.sql).toContain('FOR NO KEY UPDATE OF f');
      expect(query.sql).toContain('engineering_matter_work_item_owned_by_actor');
      expect(query.params).toContain(actor.actorUserId);
      await wait;
      // Stop at the permission boundary; no physical DB or mutation is used.
      return [];
    }), transaction: (callback: (transaction: unknown) => Promise<unknown>) => callback(database),
  };
  const repository = new EngineeringMatterRepository(database as never);
  const pending = operation === 'create' ? repository.create({ ...actor, title: '正式事项', requestId: 'create',
    primaryWorkItemId: 'WI-exact', primaryWorkItemRevision: 3 }) : repository.linkWorkItem({ ...actor,
    matterId: 'MAT-existing', requestId: 'link', expectedMatterRevision: 2, workItemId: 'WI-exact',
    workItemRevision: 3, changeSummary: '增加准确工作' });
  await Promise.resolve(); await Promise.resolve();
  expect(statements).toHaveLength(1);
  expect(database.insert).not.toHaveBeenCalled();
  const rejected = expect(pending).rejects.toThrow();
  release?.(); await rejected;
  expect(database.insert).not.toHaveBeenCalled();
});

it('material membership edits lock all old/new source families before Matter CAS, conflicting with a Wiki family SHARE seal', async () => {
  const queries: Array<ReturnType<PgDialect['sqlToQuery']>> = [];
  const database = { execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const query = dialect.sqlToQuery(statement); queries.push(query);
    if (queries.length === 2) throw new Error('STOP_BEFORE_MATTER_WRITE');
    return [];
  }), transaction: (operation: (transaction: unknown) => Promise<unknown>) => operation(database) };
  const repository = new EngineeringMatterRepository(database as never);
  await expect(repository.reviseMaterials({ ...actor, matterId: 'MAT-one', command: { requestId: 'edit',
    expectedMatterRevision: 2, changeSummary: '正式调整成员', upserts: [material('SB')] } }))
    .rejects.toThrow('STOP_BEFORE_MATTER_WRITE');
  expect(queries[0].sql).toContain('ORDER BY f.family_id FOR NO KEY UPDATE OF f');
  expect(queries[0].sql).toContain('engineering_matter_material_owned_by_actor');
  expect(queries[0].params).toContain(2);
  expect(queries[1].sql).toContain('FOR UPDATE');
});

it.each([false, true])('the real head/exact browser consumers distinguish saved input (%s) from current relation navigation', async sealed => {
  const saved = summaryRevision();
  const leaf = saved.members[0];
  const catalog = buildSummaryMatterCatalog([leaf], [leaf], [association('one', [], ['1'])]);
  saved.contextBasis = context(sealed ? catalog : undefined);
  const before = JSON.stringify(saved), database = {};
  const repository = { readBrowser: (_actor: unknown, operation: (db: unknown, owner: typeof actor) => Promise<unknown>) =>
    operation(database, actor), head: jest.fn().mockResolvedValue({ summaryId: saved.summaryId, currentSummaryRef: saved.summaryRef,
      currentRevision: saved.revision, scopeJson: saved.scope, membersJson: saved.members.map(item => item.member) }),
    saved: jest.fn().mockResolvedValue(saved), wikiMatterCatalog: jest.fn().mockResolvedValue(catalog),
    authorizeMatterCatalog: jest.fn().mockResolvedValue(undefined) };
  const service = new DerivedSummaryService(repository as never, { readAll: async () => [leaf] } as never,
    {} as never, { metadata: async () => ({ automaticWiki: true }) } as never);
  jest.spyOn(service, 'revisionContextStatus').mockResolvedValue(summaryContextStatus(undefined));
  const head = await service.read(saved.summaryId, {} as never);
  const exact = await service.readRevision(saved.summaryId, saved.summaryRef, {} as never);
  for (const result of [head, exact]) expect(result.matterCatalog).toEqual({ basis: sealed ? 'SAVED_INPUT' : 'CURRENT_RELATIONSHIPS', catalog });
  expect(head.current?.content).toEqual(saved.content);
  expect(exact.revision.content).toEqual(saved.content);
  expect(exact.revision).not.toHaveProperty('contextBasis');
  expect(JSON.stringify(saved)).toBe(before);
  if (sealed) {
    expect(repository.wikiMatterCatalog).not.toHaveBeenCalled();
    repository.authorizeMatterCatalog.mockRejectedValueOnce(new Error('MATTER_ACCESS_REVOKED'));
    await expect(service.readRevision(saved.summaryId, saved.summaryRef, {} as never)).rejects.toThrow('MATTER_ACCESS_REVOKED');
  } else expect(repository.wikiMatterCatalog).toHaveBeenCalledTimes(2);
});
