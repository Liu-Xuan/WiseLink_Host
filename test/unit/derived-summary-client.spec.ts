import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { readDerivedSummaryRevision, readDerivedSummary, readDerivedSummaryRequest, createDerivedSummary } from '@client/src/api/derived-summary';
import { memberFromKnowledge, summaryMemberKey, summaryMemberRoute, summaryScopeError, upperSummaryRoute } from '@client/src/features/derived-summary/summary-selection';
import { libraryAtaSummaryParams } from '@client/src/pages/WorkspaceHomePage/library-summary-entry';
import { summaryHead, summaryKnowledge, summaryRevision } from './fixtures/derived-summary';
import { libraryDocuments } from './fixtures/canonical-library';
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
  transport.mockResolvedValueOnce({ status: 200, data: summaryRevision('ref/a') } as never);
  await expect(readDerivedSummaryRevision('DS-1', 'ref/a')).resolves.toMatchObject({ summaryRef: 'ref/a' });
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/canonical-host/derived-summaries/DS-1/revisions/ref%2Fa', method: 'GET' }));
  transport.mockResolvedValueOnce({ status: 200, data: summaryRevision('different') } as never);
  await expect(readDerivedSummaryRevision('DS-1', 'ref/a')).rejects.toThrow('身份不一致');
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
