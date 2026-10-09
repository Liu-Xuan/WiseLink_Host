import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { readDerivedSummaryExact, readDerivedSummaryRevision, readDerivedSummary, readDerivedSummaryRequest, createDerivedSummary, updateDerivedSummary } from '@client/src/api/derived-summary';
import { memberFromKnowledge, summaryMemberKey, summaryMemberRoute, summaryScopeError, upperSummaryRoute } from '@client/src/features/derived-summary/summary-selection';
import { libraryAtaSummaryParams } from '@client/src/pages/WorkspaceHomePage/library-summary-entry';
import { summaryExact, summaryHead, summaryKnowledge, summaryRevision } from './fixtures/derived-summary';
import { libraryDocuments } from './fixtures/canonical-library';
import { readPendingSummaryRequest, storePendingSummaryRequest, summaryPendingKey } from '@client/src/features/derived-summary/summary-pending-request';
import type { CreateDerivedSummaryRequest, RequestDerivedSummaryUpdate } from '@shared/derived-summary.interface';
import { requireCanonicalHostClientAuthentication } from '@client/src/api/canonical-host';
let session = 1;
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: jest.fn() }));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => session, requireCanonicalHostClientAuthentication: jest.fn() }));
const transport = jest.mocked(axiosForBackend);
beforeEach(() => { jest.clearAllMocks(); session = 1; });

test('WI selection fixes saved document, work revision and explicit issue keys', () => {
  const work = summaryKnowledge();
  const keys = [work.content.issues[0].issueKey];
  const member = memberFromKnowledge(work, keys);
  expect(member).toMatchObject({ kind: 'WORK_ITEM_WORK', workItemId: work.entry.subjectId, workRef: work.entry.workRef, workRevision: work.entry.workRevision,
    documentVersionId: work.reading?.scope.kind === 'WORK_ITEM' ? work.reading.scope.documentVersionId : '' , issueKeys: keys });
  expect(summaryMemberRoute(member)).toContain(`workRef=${work.entry.workRef}`);
  expect(() => memberFromKnowledge(work, [])).toThrow('请选择');
  expect(() => memberFromKnowledge(work, ['missing'])).toThrow('请选择');
  expect(() => memberFromKnowledge({ ...work, reading: null }, keys)).toThrow('版本身份');
});
test('Matter selection preserves its subject and exact historical work', () => {
  const work = summaryKnowledge(); work.entry.subjectKind = 'ENGINEERING_MATTER'; work.entry.subjectId = 'M-1';
  expect(memberFromKnowledge(work, [work.content.issues[0].issueKey])).toMatchObject({ kind: 'MATTER_WORK', matterId: 'M-1', workRef: work.entry.workRef });
});
test('coverage identities distinguish issue subsets and child summary exact refs', () => {
  const member = summaryRevision().members[0].member;
  if (member.kind === 'DERIVED_SUMMARY') throw new Error('fixture');
  expect(summaryMemberKey(member)).not.toBe(summaryMemberKey({ ...member, issueKeys: ['other'] }));
  const route = upperSummaryRoute('DS-1', 'DSR-old', summaryRevision().scope);
  const params = new URL(route, 'https://test.invalid').searchParams;
  expect(params.get('fromSummaryRef')).toBe('DSR-old'); expect(params.get('kind')).toBe('ATA2');
  expect(params.has('members')).toBe(false);
});
test('ATA entry carries candidate DV window without selecting WI, issues or current versions', () => {
  const document = libraryDocuments(['FAM-1']).items[0];
  const params = libraryAtaSummaryParams({ key: '46-00', level: 'ata4', label: 'ATA4', children: [], items: document.versions.map(version => ({ document, version })) }, ['fleet:B787', 'model:B787-9', 'ata2:46']);
  expect(params.getAll('documentVersionId')).toEqual(document.versions.map(version => version.documentVersionId));
  expect(params.has('workRef')).toBe(false); expect(params.has('issueKeys')).toBe(false);
  expect(summaryScopeError(summaryRevision().scope, [])).toContain('明确加入');
});
test('exact GET encodes the saved ref and rejects cross identity readback', async () => {
  transport.mockResolvedValueOnce({ status: 200, data: summaryExact('ref/a') } as never);
  await expect(readDerivedSummaryRevision('DS-1', 'ref/a')).resolves.toMatchObject({ summaryRef: 'ref/a' });
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/canonical-host/derived-summaries/DS-1/revisions/ref%2Fa', method: 'GET' }));
  transport.mockResolvedValueOnce({ status: 200, data: summaryExact('different') } as never);
  await expect(readDerivedSummaryRevision('DS-1', 'ref/a')).rejects.toThrow('身份不一致');
});
test('exact wrapper exposes owned pointer metadata and notices for the selected historical revision without current GET', async () => {
  const exact = summaryExact();
  exact.revision.members[0].current = true;
  exact.memberNotices[0].current = false;
  transport.mockResolvedValueOnce({ status: 200, data: exact } as never);
  await expect(readDerivedSummaryExact('DS-1', 'DSR-1')).resolves.toMatchObject({ currentSummaryRef: 'DSR-2',
    revision: { summaryRef: 'DSR-1' }, memberNotices: [{ current: false }] });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).not.toHaveBeenCalledWith(expect.objectContaining({ url: '/api/canonical-host/derived-summaries/DS-1' }));
});
test('head and attempt status reject mismatched saved pointers', async () => {
  transport.mockResolvedValueOnce({ status: 200, data: { ...summaryHead(), currentSummaryRef: 'other' } } as never);
  await expect(readDerivedSummary('DS-1')).rejects.toThrow('不一致');
  transport.mockResolvedValueOnce({ status: 200, data: { summaryId: 'DS-1', attemptRef: 'other' } } as never);
  await expect(readDerivedSummaryRequest('DS-1', 'AQ-1')).rejects.toThrow('不一致');
});
test.each([403, 404])('source or member denial %s fails closed without returning cached body', async status => {
  transport.mockRejectedValueOnce({ response: { status, data: { error: { code: 'SOURCE_DENIED', stack: 'secret' } } } });
  await expect(readDerivedSummary('DS-1')).rejects.toThrow('停止展示正文');
});
test('login invalidation and concurrent session changes invalidate readback', async () => {
  transport.mockResolvedValueOnce({ status: 401, data: {} } as never);
  await expect(readDerivedSummary('DS-1')).rejects.toThrow('请先登录');
  expect(requireCanonicalHostClientAuthentication).toHaveBeenCalledWith(1);
  transport.mockImplementationOnce(async () => { session++; return { status: 200, data: summaryHead() } as never; });
  await expect(readDerivedSummary('DS-1')).rejects.toThrow('登录状态已变化');
});
test('create POST carries only explicit scope/members and the captured Hosted model', async () => {
  const revision = summaryRevision();
  const input = { requestId: 'REQ-fixed', scope: revision.scope, members: revision.members.map(item => item.member), instruction: '有限综合', modelRef: 'miaoda/glm-5.3' };
  transport.mockResolvedValueOnce({ status: 200, data: { summaryId: 'DS-1', attemptRef: 'AQ-1', created: true, status: 'QUEUED' } } as never);
  await createDerivedSummary(input);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', data: input }));
});

// UI payload/storage compatibility only; Host admission and current/prior authorization are separate.
const pendingInput = (): CreateDerivedSummaryRequest => ({ requestId: 'REQ-fixed', scope: summaryRevision().scope,
  members: summaryRevision().members.map(item => item.member), instruction: '明确修改目标', modelRef: 'miaoda/glm-5.3' });
function withPendingStorage(run: (values: Map<string, string>) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  } });
  try { run(values); } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
}
test.each(['SYNTHESIZE', 'REVISE_SAVED_SUMMARY'] as const)('update POST forwards the exact %s command without inventing prior body/ref', async purpose => {
  const input: RequestDerivedSummaryUpdate = { ...pendingInput(), purpose, expectedSummaryRevision: 2 };
  transport.mockResolvedValueOnce({ status: 200, data: { summaryId: 'DS-1', attemptRef: 'AQ-1', created: true, status: 'QUEUED' } } as never);
  await updateDerivedSummary('DS-1', input);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/canonical-host/derived-summaries/DS-1/requests', method: 'POST', data: input }));
  expect((transport.mock.calls[0][0] as unknown as { data: RequestDerivedSummaryUpdate }).data).toBe(input);
  expect(Object.keys(input).sort()).toEqual(['requestId', 'scope', 'members', 'instruction', 'modelRef', 'purpose', 'expectedSummaryRevision'].sort());
});
test('legacy pending preserves its original serialized object without adding default purpose', () => withPendingStorage(values => {
  const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1');
  const legacy = { ...pendingInput(), expectedSummaryRevision: 2 };
  const text = JSON.stringify(legacy); values.set(key, text);
  const restored = readPendingSummaryRequest(key, 'DS-1');
  expect(restored).toEqual(legacy); expect(restored).not.toHaveProperty('purpose');
  storePendingSummaryRequest(key, restored!); expect(values.get(key)).toBe(text);
}));
test('purpose participates in the preserved command identity under the same pending slot', () => withPendingStorage(values => {
  const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1');
  const original: RequestDerivedSummaryUpdate = { ...pendingInput(), purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 2 };
  storePendingSummaryRequest(key, original);
  expect(readPendingSummaryRequest(key, 'DS-1')).toEqual(original);
  expect(values.get(key)).not.toBe(JSON.stringify({ ...original, purpose: 'SYNTHESIZE' }));
  expect(summaryPendingKey('tenant-1', 'actor-2', 'DS-1')).not.toBe(key);
  expect(summaryPendingKey('tenant-2', 'actor-1', 'DS-1')).not.toBe(key);
  expect(summaryPendingKey('tenant-1', 'actor-1')).not.toBe(key);
}));
test.each([
  { purpose: 'OTHER', expectedSummaryRevision: 2 },
  { purpose: null, expectedSummaryRevision: 2 },
  { purpose: 'REVISE_SAVED_SUMMARY' },
  { purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 0 },
  { purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: -1 },
  { purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 1.5 },
  { purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: '2' },
  { purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 2147483647 },
  { purpose: 'SYNTHESIZE', expectedSummaryRevision: -1 },
  { purpose: 'SYNTHESIZE' },
])('invalid update pending fails closed without rewriting the stored command: %j', delta => withPendingStorage(values => {
  const key = summaryPendingKey('tenant-1', 'actor-1', 'DS-1'); const text = JSON.stringify({ ...pendingInput(), ...delta });
  values.set(key, text); expect(() => readPendingSummaryRequest(key, 'DS-1')).toThrow('无法读取'); expect(values.get(key)).toBe(text);
}));
test.each([
  { purpose: 'REVISE_SAVED_SUMMARY', expectedSummaryRevision: 2 },
  { expectedSummaryRevision: 0 },
  { purpose: 'REVISE_SAVED_SUMMARY' },
])('new-summary pending rejects revision/update commands: %j', delta => withPendingStorage(values => {
  const key = summaryPendingKey('tenant-1', 'actor-1'); values.set(key, JSON.stringify({ ...pendingInput(), ...delta }));
  expect(() => readPendingSummaryRequest(key)).toThrow('无法读取');
}));
test.each([undefined, 'SYNTHESIZE'] as const)('ordinary pending remains compatible with purpose %s', purpose => withPendingStorage(values => {
  const key = summaryPendingKey('tenant-1', 'actor-1'); const input = { ...pendingInput(), ...(purpose ? { purpose } : {}) };
  values.set(key, JSON.stringify(input)); expect(readPendingSummaryRequest(key)).toEqual(input);
}));
