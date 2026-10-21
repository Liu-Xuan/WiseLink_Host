import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  DerivedSummaryContextBasis, DerivedSummaryMember, DerivedSummaryMemberReading, DerivedSummaryRevision,
} from '@shared/derived-summary.interface';
import { canonicalJson, canonicalSha256 } from '../../server/modules/action-attempt/action-attempt-envelope';
import { taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import {
  DerivedSummaryMembersService, mergeSummaryEvidence,
} from '../../server/modules/canonical-host/derived-summary-members.service';
import { contextMemberNotices } from '../../server/modules/canonical-host/derived-summary-current-context';
import { DerivedSummaryRepository } from '../../server/modules/canonical-host/derived-summary.repository';
import { DerivedSummaryService } from '../../server/modules/canonical-host/derived-summary.service';
import { DerivedSummaryRuntimeService } from '../../server/modules/canonical-host/derived-summary-runtime.service';
import { buildSummaryMatterCatalog, summaryMatterInstruction } from '../../server/modules/canonical-host/derived-summary-matter-catalog';

const actor = { tenantId: 'tenant-document-nested', actorUserId: 'owner-document-nested' };
const runtimeScope = { appId: 'app_17bzc551rsg', tenantId: actor.tenantId, principalId: 'runtime-document-nested',
  authorizationFingerprint: 'synthetic-runtime-document-nested' };
const documentVersionId = 'document_version_nested';
const original: Extract<AssessmentEvidence, { kind: 'DOCUMENT_PASSAGE' }> = {
  kind: 'DOCUMENT_PASSAGE', evidenceRef: `DOCUMENT_ORIGINAL:${documentVersionId}:PRUN-nested:PRUN-nested:u1:p0`,
  workItemId: 'WI-A', documentVersionId, sourceRefId: 'PRUN-nested:u1:p0',
  title: 'Synthetic original', versionLabel: 'PRUN-nested', excerpt: 'Same exact synthetic original condition.',
  locator: '{"parseRunId":"PRUN-nested","sourceRefId":"PRUN-nested:u1:p0"}',
};
const leaf = (id: string): DerivedSummaryMember => ({ kind: 'WORK_ITEM_WORK', workItemId: id,
  documentVersionId, workRef: `JAWR-${id}`, workRevision: id === 'WI-A' ? 13 : 18, issueKeys: [] });
const nested = (id: string): DerivedSummaryMember => ({ kind: 'DERIVED_SUMMARY', summaryId: id,
  summaryRef: `DSR-${id}`, summaryRevision: 1 });
const selection: DerivedSummaryRevision['scope'] = { kind: 'ATA4', title: 'Synthetic selected ATA45-00',
  fleetFamilyId: 'B787', fleetModelIds: [], ata2: '45', ata4: '45-00', selectionReason: 'Exact selected fixture' };

interface SelectChain {
  orderBy(): SelectChain;
  innerJoin(): SelectChain;
  where(predicate: unknown): SelectChain;
  limit(): SelectChain;
  for(): SelectChain;
  then(resolve: (rows: Array<Record<string, unknown>>) => unknown): Promise<unknown>;
}

/** Real recursive members, summary task checks and runtime SAVE; metadata/storage
 * and transaction transport are synthetic. Original artifact IO is observed, not
 * replaced by source text or connected to a model/physical DB. */
async function fixture(options: {
  savedLimitations?: string[]; taskLimitations?: string[]; submittedLimitations?: string[]; leafCurrent?: boolean;
  matterCount?: 1 | 2;
} = {}) {
  const dialect = new PgDialect();
  const saved = new Map<string, DerivedSummaryRevision>();
  const inserted: DerivedSummaryRevision[] = [];
  const authorizationInputs: string[][] = [];
  let secondRevoked = false;
  let revokeAfterOriginalIo = false;
  const database = {
    transaction: async <T>(operation: (transaction: unknown) => Promise<T>): Promise<T> => operation(database),
    execute: jest.fn(async (statement: unknown) => {
      const { sql, params } = dialect.sqlToQuery(statement as never);
      if (!sql.includes('engineering_matter_work_item_owned_by_actor')) return [{ allowed: true }];
      const ids = JSON.parse(String(params[0])) as string[];
      authorizationInputs.push(ids);
      return [{ allowed: !secondRevoked || !ids.includes('WI-B') }];
    }),
    select: jest.fn(() => ({ from: (table: unknown) => {
      const name = getTableName(table as never);
      let params: unknown[] = [];
      const rows = (): Array<Record<string, unknown>> => {
        if (name === 'identity_subject_mapping') return [{ id: 'mapping-document-nested' }];
        if (name === 'dm_document_version') return [{ documentVersionId, currentDocumentVersionId: documentVersionId }];
        if (name === 'derived_summary') return [...saved].filter(([id]) => params.includes(id)).map(([id, content]) => ({
          ...actor, summaryId: id, currentRevision: content.revision, currentSummaryRef: content.summaryRef,
        }));
        if (name === 'derived_summary_revision') return [...saved].filter(([id, content]) =>
          params.includes(id) && (params.includes(content.summaryRef) || params.includes(content.requestId)))
          .map(([, contentJson]) => ({ ...actor, revision: contentJson.revision, contentJson,
            attemptId: contentJson.attemptRef === 'AQ-target' ? 'ATT-target' : `ATT-${contentJson.summaryId}` }));
        return [];
      };
      const query: SelectChain = {
        orderBy: () => query, innerJoin: () => query,
        where: predicate => { params = dialect.sqlToQuery(predicate as never).params; return query; },
        limit: () => query, for: () => query,
        then: resolve => Promise.resolve(rows()).then(resolve),
      };
      return query;
    } })),
    insert: jest.fn(() => ({ values: async (row: { contentJson: DerivedSummaryRevision }) => {
      const revision = structuredClone(row.contentJson);
      inserted.push(revision);
      saved.set(revision.summaryId, revision);
    } })),
    update: jest.fn(() => ({ set: () => ({ where: () => ({
      returning: async () => [{ id: 'DS-target' }],
      then: (resolve: (value: undefined) => unknown) => Promise.resolve(undefined).then(resolve),
    }) }) })),
  };
  const jobAid = { readSummaryMemberInTransaction: jest.fn(async ({ workItemId }: { workItemId: string }) => ({
    current: options.leafCurrent ?? true, revision: { workRevision: workItemId === 'WI-A' ? 13 : 18, documentVersionId,
      content: { headline: `Saved ${workItemId}`, understanding: `Exact saved understanding ${workItemId}`,
        issues: [], overviewStatus: 'CURRENT', evidence: [{ ...original, workItemId }] } },
  })) };
  const matterAuthorization = { authorizeRuntimeInputs: jest.fn().mockResolvedValue(undefined),
    authorizeReadInputs: jest.fn().mockResolvedValue(undefined) };
  const members = new DerivedSummaryMembersService(jobAid as never, matterAuthorization as never);
  const put = (id: string, readings: DerivedSummaryMemberReading[]) => saved.set(id, {
    summaryId: id, summaryRef: `DSR-${id}`, revision: 1, scope: selection, classificationStatus: 'CANDIDATE',
    members: structuredClone(readings), evidence: mergeSummaryEvidence(readings.flatMap(item => item.evidence)),
    usedEvidenceRefs: readings.map(item => item.evidenceRef),
    coverage: readings.map(item => ({ member: item.member, evidenceRef: item.evidenceRef,
      delivered: true, used: true, rootRefs: item.rootRefs, limitation: 'Synthetic saved scope' })),
    content: { headline: `Saved ${id}`, listBrief: 'Saved synthetic summary', body: `Exact saved ${id}`,
      limitations: [...(options.savedLimitations ?? [])] },
    requestId: `request-${id}`, attemptRef: `AQ-${id}`, createdAt: '2026-10-17T00:00:00Z', candidateOnly: true,
  });
  const children = await members.readAll([leaf('WI-A'), leaf('WI-B')], actor, database as never);
  put('S1', children);
  const [s1] = await members.readAll([nested('S1')], actor, database as never);
  put('S2', [s1!]);
  const [s2] = await members.readAll([nested('S2')], actor, database as never);
  const catalog = options.matterCount ? buildSummaryMatterCatalog([s2!], children,
    Array.from({ length: options.matterCount }, (_, index) => ({ matterId: `MAT-${index}`, matterRevisionId: `MREV-${index}`,
      title: '相同名称的工程事项', materials: [], links: (options.matterCount === 1 ? children : [children[index]!])
        .map(item => ({ workItemId: item.member.kind === 'WORK_ITEM_WORK' ? item.member.workItemId : '', documentVersionId })) }))) : undefined;
  let currentCatalog = catalog;
  const basis: DerivedSummaryContextBasis = { schemaVersion: 'wiselink.derived-summary-context.v1',
    memberNotices: contextMemberNotices([s2!]), sources: [], workItems: [], matters: [], summaries: [],
    ...(catalog ? { wikiMatterCatalog: catalog } : {}),
    uncoordinatedDependencies: ['SYNTHETIC_METADATA_STORAGE'] };
  const transactions = { withActorTransaction: jest.fn(async (_owner: string,
    operation: (input: { database: typeof database }) => Promise<unknown>) => operation({ database })) };
  const repository = new DerivedSummaryRepository(
    { execute: async () => [{ actorUserId: actor.actorUserId }] } as never, transactions as never, members);
  const taskSelection = options.matterCount ? { ...selection, kind: 'ATA2', ata4: null } : selection;
  const instruction = 'Synthesize exact selected work';
  const taskBasis = { schemaVersion: 'wiselink.derived-summary-task.v1', taskType: 'OPENCLAW_DERIVED_SUMMARY',
    subject: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-target' }, expectedSummaryRevision: 0,
    requestId: 'request-target', actionAttemptId: 'ATT-target', operationRef: 'AQ-target', deadlineAt: '2099-01-01T00:00:00.000Z',
    executionModel: taskModelSelection('miaoda/glm-5.3', new Date('2026-10-17T00:00:00Z')), contextBasis: basis,
    modelInput: { scope: taskSelection, classificationStatus: 'CANDIDATE', instruction: summaryMatterInstruction(instruction, catalog),
      ...(catalog ? { wikiLevel: 'ATA2' } : {}),
      members: [s2!], evidence: [original], limitations: [...(options.taskLimitations ?? [])] } };
  const task = { ...taskBasis, taskInputHash: canonicalSha256(taskBasis) };
  const attempt = { ...actor, summaryId: 'DS-target', attemptId: task.actionAttemptId, operationRef: task.operationRef,
    delegatedPrincipalId: runtimeScope.principalId, status: 'RUNNING', leaseOwner: runtimeScope.principalId,
    leaseToken: 'fixture-lease', leaseGeneration: 1, leaseExpiresAt: new Date('2099-01-01T00:00:00Z'),
    deadlineAt: new Date(task.deadlineAt), triggerRequestId: task.requestId, baseRevision: 0, inputRevision: 0,
    taskEnvelopeJson: canonicalJson(task), taskInputHash: task.taskInputHash, executionModelJson: canonicalJson(task.executionModel),
    requestCommandJson: canonicalJson({ requestId: task.requestId, expectedSummaryRevision: 0, scope: taskSelection,
      members: [s2!.member], instruction, modelRef: task.executionModel.modelRef }),
    reviewActivityJson: canonicalJson([{ kind: 'DERIVED_SUMMARY_MEMBERS_READ', evidenceRefs: [s2!.evidenceRef] }]) };
  const readHead = repository.head.bind(repository);
  jest.spyOn(repository, 'head').mockImplementation((id, owner, db, lock) => id === task.subject.summaryId
    ? Promise.resolve({ ...actor, summaryId: id, currentRevision: saved.get(id)?.revision ?? 0 } as never)
    : readHead(id, owner, db, lock));
  jest.spyOn(repository, 'attempt').mockResolvedValue(attempt as never);
  jest.spyOn(repository, 'contextBasis').mockImplementation(async (_readings, _actor, _database, selectedCatalog) => ({
    ...basis, ...(selectedCatalog ? { wikiMatterCatalog: selectedCatalog } : {}),
  }));
  jest.spyOn(repository, 'wikiMatterCatalog').mockImplementation(async () => currentCatalog!);
  const authorizeCatalog = jest.spyOn(repository, 'authorizeMatterCatalog').mockResolvedValue(undefined);
  jest.spyOn(repository, 'lockContext').mockResolvedValue(undefined);
  const summaries = new DerivedSummaryService(repository, members, {} as never);
  const runtime = new DerivedSummaryRuntimeService(repository, members, summaries);
  const originalIo = jest.spyOn(members, 'verifyOriginalEvidence').mockImplementation(async () => {
    if (revokeAfterOriginalIo) secondRevoked = true;
  });
  const target = { summaryId: task.subject.summaryId, attemptRef: task.operationRef, scope: runtimeScope,
    leaseToken: 'fixture-lease', leaseGeneration: 1, requestId: task.requestId, expectedSummaryRevision: 0,
    contentJson: canonicalJson({ headline: 'Synthetic synthesis', listBrief: 'Exact selected work',
      body: catalog ? catalog.entries.map(entry => `## 事项：${entry.matterId} | ${entry.title}\n\n`
        + `### 当前状态\n未关闭，SB TBD，11/04/2027 不是完成日期。 [[${original.evidenceRef}]] [[${s2!.evidenceRef}]]`).join('\n\n')
        : `Synthesized [[${s2!.evidenceRef}]]`, limitations: [...(options.submittedLimitations ?? [])] }) };
  authorizationInputs.length = 0;
  return { members, database, saved, inserted, children, s2: s2!, runtime, target, originalIo, authorizationInputs, catalog, authorizeCatalog,
    summaries, task, matterAuthorization,
    changeAssociation: () => { currentCatalog = structuredClone(currentCatalog!); currentCatalog.entries[0]!.matterRevisionId += '-changed'; },
    revokeSecond: () => { secondRevoked = true; }, revokeAfterIo: () => { revokeAfterOriginalIo = true; } };
}

it.each([1, 2] as const)('SAVE and readback retain %i formal Matters, exact shared roots, versions and sealed associations', async matterCount => {
  const f = await fixture({ matterCount });
  const originalSelected = structuredClone(f.s2);
  const submitted = JSON.parse(f.target.contentJson);
  await expect(f.runtime.save(f.target)).resolves.toMatchObject({ replay: false, revision: 1 });
  expect(f.inserted[0].contextBasis?.wikiMatterCatalog).toEqual(f.catalog);
  expect(f.inserted[0].content.body).toBe(submitted.body);
  expect(f.inserted[0].members[0]).toEqual(originalSelected);
  expect(f.inserted[0].evidence).toEqual([original]);
  const result = await f.runtime.readSaved(f.target);
  expect(result.summary.content.body).toBe(submitted.body);
  expect(result.summary).not.toHaveProperty('contextBasis');
  expect(f.authorizeCatalog).toHaveBeenCalledWith(f.catalog, actor, f.database);
  // Mutating today's association after save changes fresh notices, never the
  // historical catalog or saved body, and still allows exact historical read.
  f.changeAssociation();
  const reread = await f.runtime.readSaved(f.target);
  expect(reread.contextStatus?.reasons).toContain('CHANGED_WIKIMATTERCATALOG');
  expect(f.inserted[0].contextBasis?.wikiMatterCatalog).toEqual(f.catalog);
  expect(reread.summary.content.body).toBe(submitted.body);
  const selected = { kind: 'DERIVED_SUMMARY' as const, summaryId: f.inserted[0].summaryId,
    summaryRef: f.inserted[0].summaryRef, summaryRevision: f.inserted[0].revision };
  await expect(f.members.readAll([selected], actor, f.database as never)).resolves.toHaveLength(1);
  expect(f.matterAuthorization.authorizeRuntimeInputs).toHaveBeenCalledWith({ ...actor,
    matterId: 'MAT-0', basedOnMatterRevisionId: 'MREV-0' }, f.database);
  f.matterAuthorization.authorizeRuntimeInputs.mockRejectedValueOnce(new Error('MATTER_ACCESS_REVOKED'));
  await expect(f.members.readAll([selected], actor, f.database as never)).rejects.toThrow('MATTER_ACCESS_REVOKED');
  expect(f.inserted[0].contextBasis?.wikiMatterCatalog).toEqual(f.catalog);
});

it('SAVE rejects a model-created Matter, a duplicate Matter and an unrelated source before any revision insert', async () => {
  const f = await fixture({ matterCount: 1 });
  const saved = JSON.parse(f.target.contentJson);
  for (const body of [saved.body.replace('MAT-0', 'MAT-invented'), saved.body + '\n\n' + saved.body,
    saved.body.replace(original.evidenceRef, 'UNREGISTERED-SOURCE')]) {
    await expect(f.runtime.save({ ...f.target, contentJson: canonicalJson({ ...saved, body }) })).rejects.toThrow();
    expect(f.inserted).toHaveLength(0);
  }
});

it('a formal relationship changed during original IO fences SAVE and retains the exact selected task and prior history', async () => {
  const f = await fixture({ matterCount: 1 });
  const history = canonicalJson([...f.saved]);
  f.originalIo.mockImplementation(async () => { f.changeAssociation(); });
  await expect(f.runtime.save(f.target)).rejects.toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
  expect(f.inserted).toHaveLength(0);
  expect(canonicalJson([...f.saved])).toBe(history);
  expect(f.task.contextBasis.wikiMatterCatalog).toEqual(f.catalog);
});

it('depth-2 nested reading retains both original WI carriers, exact leaves and immutable registry bytes', async () => {
  const f = await fixture();
  expect(f.children.map(item => item.evidence[0]!.kind === 'DOCUMENT_PASSAGE' && item.evidence[0]!.workItemId))
    .toEqual(['WI-A', 'WI-B']);
  expect(f.s2.evidence).toEqual([original, { ...original, workItemId: 'WI-B' }]);
  expect(f.s2.leaves).toEqual([leaf('WI-A'), leaf('WI-B')]);
  expect(f.saved.get('S1')!.evidence).toEqual([original]);
  expect(f.saved.get('S2')!.members[0]!.evidence).toEqual(f.s2.evidence);
  const before = canonicalJson([...f.saved]);
  f.revokeSecond();
  await expect(f.members.readAll([nested('S2')], actor, f.database as never))
    .rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
  expect(f.authorizationInputs).toEqual([['WI-A'], ['WI-B']]);
  expect(canonicalJson([...f.saved])).toBe(before);
});

it('delivers an inherited saved list once while retaining fresh notices and exact raw snapshots', async () => {
  const limits = ['仅适用于配置 A。', '配置 B 尚未比较，不得按无影响处理。'];
  const f = await fixture({ savedLimitations: limits, leafCurrent: false });
  const before = canonicalJson([...f.saved]);
  const raw = structuredClone(f.s2);
  expect(raw.limitations.filter(value => value === limits[0]).length).toBeGreaterThan(1);
  const delivered = await f.runtime.readMemberWork({ ...f.target, evidenceRefs: [f.s2.evidenceRef],
    purpose: 'Read exact saved child for parent synthesis' });
  const reading = delivered.members[0]!;
  expect(reading.limitations.filter(value => value === limits[0])).toHaveLength(1);
  expect(reading.limitations).toContain(limits[1]);
  expect(reading.limitations.filter(value => value === '固定成员已有较新的保存工作；本次仍使用明确选取的版本。'))
    .toHaveLength(1);
  expect({ ...reading, limitations: raw.limitations }).toEqual(raw);
  expect(f.s2).toEqual(raw);
  expect(canonicalJson([...f.saved])).toBe(before);
});

it('saves identical inherited notice text once without merging different conditions or near paraphrases', async () => {
  const inherited = ['Only configuration A; outcome unverified.', 'Café condition not established.'];
  const different = ['Only configuration B; outcome unverified.', 'Do not infer no impact for configuration A.',
    'Configuration A alone; the outcome remains unverified.'];
  const f = await fixture({ taskLimitations: [...inherited, inherited[0]!],
    submittedLimitations: ['  Only configuration A; outcome unverified.  ', 'Cafe\u0301 condition not established.', ...different] });
  await expect(f.runtime.save(f.target)).resolves.toMatchObject({ replay: false });
  expect(f.inserted[0]!.content.limitations).toEqual([...inherited, ...different]);
  expect(f.inserted[0]!.members[0]).toEqual(f.s2);
  expect(f.inserted[0]!.content.body).toBe(JSON.parse(f.target.contentJson).body);
});

it('replays a legacy Set-saved request byte-for-byte and rejects changed conditions under that request', async () => {
  const first = 'Only configuration A; outcome unverified.';
  const spaced = 'Only  configuration A; outcome unverified.';
  const f = await fixture({ taskLimitations: [first], submittedLimitations: [spaced] });
  await f.runtime.save(f.target);
  const stored = f.saved.get('DS-target')!;
  stored.content.limitations = [first, spaced]; // An existing pre-fix Set serialization.
  const before = canonicalJson([...f.saved]);
  await expect(f.runtime.save(f.target)).resolves.toMatchObject({ replay: true });
  expect(canonicalJson([...f.saved])).toBe(before);
  expect(f.inserted).toHaveLength(1);
  const changed = { ...JSON.parse(f.target.contentJson), limitations: ['Only configuration B; outcome unverified.'] };
  await expect(f.runtime.save({ ...f.target, contentJson: canonicalJson(changed) }))
    .rejects.toThrow('DERIVED_SUMMARY_SAVE_REQUEST_ID_REUSED');
  expect(canonicalJson([...f.saved])).toBe(before);
  expect(f.inserted).toHaveLength(1);
});

it('actual runtime SAVE preserves both nested WI carriers and exact leaf snapshots, with one aggregate body', async () => {
  const f = await fixture();
  await expect(f.runtime.save(f.target)).resolves.toMatchObject({ summaryId: 'DS-target', revision: 1, replay: false });
  expect(f.inserted).toHaveLength(1);
  expect(f.inserted[0]!.evidence).toEqual([original]);
  expect(f.inserted[0]!.members[0]!.evidence).toEqual([original, { ...original, workItemId: 'WI-B' }]);
  expect(f.inserted[0]!.members[0]!.leaves).toEqual([leaf('WI-A'), leaf('WI-B')]);
  expect(f.originalIo.mock.calls[0]![0]).toEqual([original, { ...original, workItemId: 'WI-B' }]);
  f.revokeSecond();
  await expect(f.runtime.readSaved(f.target)).rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
  expect(f.inserted).toHaveLength(1);
});

it('actual runtime SAVE rechecks a nonfirst WI revoked during original IO and inserts no revision', async () => {
  const f = await fixture();
  f.revokeAfterIo();
  await expect(f.runtime.save(f.target)).rejects.toThrow('DERIVED_SUMMARY_SOURCE_UNAVAILABLE');
  expect(f.originalIo).toHaveBeenCalledTimes(1);
  expect(f.authorizationInputs.at(-1)).toEqual(['WI-B']);
  expect(f.database.insert).not.toHaveBeenCalled();
  expect(f.saved.has('DS-target')).toBe(false);
});
