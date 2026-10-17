import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { readWikiGuideNavigation, searchWikiGuideIssues } from '@client/src/api/wiki-guide';
import { requireCanonicalHostClientAuthentication } from '@client/src/api/canonical-host';
import type { WikiGuideNode } from '@shared/wiki-guide.interface';

let generation = 1;
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: jest.fn() }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => generation,
  requireCanonicalHostClientAuthentication: jest.fn(),
}));
const transport = jest.mocked(axiosForBackend);
const root: WikiGuideNode = {
  summaryId: 'DS-root', wikiId: 'wiki-root', parentSummaryId: null, currentSummaryRef: 'DSR-one', currentRevision: 1,
  scope: { kind: 'FLEET', title: 'B787 Wiki', fleetFamilyId: 'B787', fleetModelIds: [], ata2: null, ata4: null, selectionReason: '' },
  enabled: true, state: 'CURRENT', currentBodyStatus: 'AVAILABLE', path: [],
};
root.path = [{ summaryId: root.summaryId, parentSummaryId: null, scope: root.scope,
  currentSummaryRef: root.currentSummaryRef, currentRevision: root.currentRevision }];

beforeEach(() => { jest.clearAllMocks(); generation = 1; });

test('navigation is one pure metadata GET and preserves opaque continuation', async () => {
  transport.mockResolvedValueOnce({ status: 200, data: { items: [root], nextCursor: 'cursor/+=' } } as never);
  await expect(readWikiGuideNavigation({ parentSummaryId: 'DS/parent', after: 'cursor/+=', limit: 20 }))
    .resolves.toMatchObject({ items: [{ currentSummaryRef: 'DSR-one' }], nextCursor: 'cursor/+=' });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET',
    url: '/api/canonical-host/hierarchical-wiki/navigation?parentSummaryId=DS%2Fparent&after=cursor%2F%2B%3D&limit=20' }));
});

test('issue discovery returns metadata and exact paths through a single paged GET', async () => {
  const hit = { subjectKind: 'WORK_ITEM', subjectId: 'WI-1', workRef: 'JAWR-2', workRevision: 2,
    issueKey: 'problem-1', question: '已保存问题', documentVersionId: 'DV-1', paths: [root.path] };
  transport.mockResolvedValueOnce({ status: 200, data: { items: [hit], nextCursor: null, coverage: 'CONFIRMED_WIKI_MEMBERS' } } as never);
  await expect(searchWikiGuideIssues({ rootSummaryId: 'DS-root', search: 'ATA 31', scope: 'CURRENT' }))
    .resolves.toMatchObject({ items: [{ workRef: 'JAWR-2', paths: [[{ summaryId: 'DS-root' }]] }] });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/engineering-issues/wiki-guide?') }));
});

test.each([401, 403, 404])('resolved %s never becomes discovery data', async status => {
  transport.mockResolvedValueOnce({ status, data: { items: [root], nextCursor: null } } as never);
  await expect(readWikiGuideNavigation()).rejects.toMatchObject({ statusCode: status });
  expect(requireCanonicalHostClientAuthentication).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});

test('rejected unauthorized request invalidates the exact initiating login generation', async () => {
  transport.mockRejectedValueOnce({ response: { status: 401 } });
  await expect(readWikiGuideNavigation()).rejects.toThrow('请先登录');
  expect(requireCanonicalHostClientAuthentication).toHaveBeenCalledWith(1);
});

test('response crossing a login change is discarded', async () => {
  transport.mockImplementationOnce(async () => { generation++; return { status: 200, data: { items: [root], nextCursor: null } } as never; });
  await expect(readWikiGuideNavigation()).rejects.toThrow();
});

test('malformed pointer payload is rejected and an aborted request remains aborted', async () => {
  transport.mockResolvedValueOnce({ status: 200, data: { items: [{ ...root, currentSummaryRef: 42 }], nextCursor: null } } as never);
  await expect(readWikiGuideNavigation()).rejects.toThrow();
  const control = new AbortController(); control.abort();
  const abort = new Error('aborted'); transport.mockRejectedValueOnce(abort);
  await expect(readWikiGuideNavigation({}, control.signal)).rejects.toBe(abort);
});
