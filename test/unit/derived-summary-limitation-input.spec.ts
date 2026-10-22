import { PgDialect } from 'drizzle-orm/pg-core';
import type { DerivedSummaryMemberReading } from '@shared/derived-summary.interface';
import { deduplicateSummaryNotices } from '@shared/derived-summary-engineering-content';
import { DerivedSummaryService, type DerivedSummaryRuntimeTask } from '../../server/modules/canonical-host/derived-summary.service';
import { contextMemberNotices } from '../../server/modules/canonical-host/derived-summary-current-context';
import { summaryMemberRef } from '../../server/modules/canonical-host/derived-summary.validation';

test('strict notice identity retains distinct version refs, negation, scope and original first text', () => {
  const first = 'Café\ncondition A is unverified. [[source-v1]]';
  const same = '  Cafe\u0301 condition A is unverified. [[source-v1]]  ';
  const distinct = ['Café condition A is unverified. [[source-v2]]',
    'Café condition A is verified. [[source-v1]]', 'Café condition B is unverified. [[source-v1]]',
    'Only the first row was read; remaining rows were not assessed.'];
  const values = [first, same, ...distinct];
  expect(deduplicateSummaryNotices(values)).toEqual([first, ...distinct]);
  expect(values).toEqual([first, same, ...distinct]);
});

test('new reservation projects repeated lists once while raw context seals still reject a new notice', async () => {
  const owner = { tenantId: 'notice-tenant', actorUserId: 'notice-actor' };
  const member = { kind: 'DERIVED_SUMMARY' as const, summaryId: 'DS-child', summaryRef: 'DSR-child', summaryRevision: 1 };
  const raw: DerivedSummaryMemberReading = { member, evidenceRef: summaryMemberRef(member),
    headline: 'Saved child', body: 'Exact saved child body; configuration A remains unverified.',
    issues: [], evidence: [], rootRefs: [], leaves: [],
    limitations: ['仅适用于配置 A。', '仅适用于配置 A。', '配置 B 未覆盖。'],
    current: true, overviewStatus: 'CURRENT' };
  const before = JSON.stringify(raw);
  const tasks: DerivedSummaryRuntimeTask[] = [];
  const dialect = new PgDialect();
  const query = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };
  const database = { select: jest.fn().mockReturnValue(query),
    execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      for (const value of dialect.sqlToQuery(statement).params) {
        if (typeof value !== 'string' || !value.startsWith('{')) continue;
        const parsed = JSON.parse(value);
        if (parsed.taskType === 'OPENCLAW_DERIVED_SUMMARY') tasks.push(parsed);
      }
      return [];
    }) };
  const head = { summaryId: 'DS-parent', currentRevision: 0, currentSummaryRef: null };
  const repository = { head: jest.fn().mockResolvedValue(head), lockContext: jest.fn().mockResolvedValue(undefined),
    contextBasis: jest.fn(async (readings: DerivedSummaryMemberReading[]) => ({
      schemaVersion: 'wiselink.derived-summary-context.v1' as const, memberNotices: contextMemberNotices(readings),
      sources: [], workItems: [], matters: [], summaries: [], uncoordinatedDependencies: [],
    })), attempt: jest.fn(async () => ({ operationRef: tasks[0]!.operationRef, status: 'QUEUED' })) };
  const members = { readAll: jest.fn(async () => [structuredClone(raw)]) };
  const service = new DerivedSummaryService(repository as never, members as never,
    { authorizeOpenClawAutoWorkItemQueue: jest.fn().mockResolvedValue({ appId: 'app_17bzc551rsg',
      tenantId: owner.tenantId, principalId: 'notice-service' }) } as never);
  await service.reserve({ requestId: 'notice-request', expectedSummaryRevision: 0,
    scope: { kind: 'ATA2', title: 'Selected parent', fleetFamilyId: 'B787', fleetModelIds: [],
      ata2: '45', ata4: null, selectionReason: 'Exact saved child' }, members: [member],
    instruction: 'Use exact saved child once', modelRef: 'miaoda/glm-5.3' }, owner, head as never, database as never);
  expect(tasks).toHaveLength(1);
  const task = tasks[0]!;
  expect(task.modelInput.members[0]).toEqual({ ...raw, limitations: ['仅适用于配置 A。', '配置 B 未覆盖。'] });
  expect(task.modelInput.limitations.filter(value => value === raw.limitations[0])).toHaveLength(1);
  expect(task.contextBasis!.memberNotices[0]!.limitations).toEqual(raw.limitations);
  expect(JSON.stringify(raw)).toBe(before);
  await expect(service.checkTaskAccess(task, owner, database as never, { requireCurrentContext: true })).resolves.toHaveLength(1);
  raw.limitations.push('配置 A 的装机状态已变化，须重新核对。');
  await expect(service.checkTaskAccess(task, owner, database as never, { requireCurrentContext: true }))
    .rejects.toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
});
