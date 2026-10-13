import { readLibraryMacro, LIBRARY_MACRO_BUDGET } from '@client/src/pages/RelationGraphPage/library-macro-read';
import { getCanonicalLibraryDocuments } from '@client/src/api/canonical-host';
import { getEngineeringMatterDirectory, getEngineeringMatter } from '@client/src/api/engineering-matter';
import { libraryDocuments } from './fixtures/canonical-library';
import { libraryMatterFixture } from './fixtures/library-matter';

jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalLibraryDocuments: jest.fn(), getCanonicalLibraryGraph: jest.fn(), summarizeCanonicalDocumentReadFailure: (reason: { statusCode?: number }) => ({ statusCode: reason?.statusCode }) }));
jest.mock('@client/src/api/engineering-matter', () => ({ getEngineeringMatterDirectory: jest.fn(), getEngineeringMatter: jest.fn() }));
const docs = jest.mocked(getCanonicalLibraryDocuments), directory = jest.mocked(getEngineeringMatterDirectory), matterRead = jest.mocked(getEngineeringMatter);
const request = { level: 'clusters', groupBy: 'ata' } as const;
beforeEach(() => {
  jest.resetAllMocks();
  docs.mockResolvedValue(libraryDocuments(['a']));
  directory.mockResolvedValue({ items: [], nextCursor: null, fileReadPerformed: false });
});
const load = () => readLibraryMacro(request, new AbortController().signal);
it('automatically reads every authorized catalog page without extracting references or running model tasks', async () => {
  docs.mockResolvedValueOnce(libraryDocuments(['a'], 'cursor-a')).mockResolvedValueOnce(libraryDocuments(['b']));
  const read = await load();
  expect(read.documents.map(document => document.familyId)).toEqual(['a', 'b']);
  expect(docs.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-a', limit: 50 });
  expect(read.coverage).toEqual({ documents: 'COMPLETE', matters: 'COMPLETE', references: 'NOT_INDEXED' });
  expect(matterRead).not.toHaveBeenCalled();
});
it('keeps raw ATA deep links intact and does not pass an old graph cursor to the different catalog endpoint', async () => {
  await readLibraryMacro({ level: 'families', groupBy: 'ata', clusterValue: '4600-00', cursor: 'legacy', search: 'SB' }, new AbortController().signal);
  expect(docs.mock.calls[0][0]).toEqual({ ata: '4600-00', search: 'SB', limit: 50, cursor: undefined });
});
it('preserves both the parent filter and raw cluster restriction instead of widening an intersected deep link', async () => {
  const page = libraryDocuments(['a']);
  page.items[0].versions[0].extractedMetadata = null;
  docs.mockResolvedValue(page);
  const read = await readLibraryMacro({ level: 'families', groupBy: 'ata', clusterValue: '34', ata: '3461' }, new AbortController().signal);
  expect(docs.mock.calls[0][0]).toMatchObject({ ata: '3461' });
  expect(read.documents).toEqual([]);
});
it('does not silently treat a pagination budget as a complete global catalog', async () => {
  for (let page = 0; page < LIBRARY_MACRO_BUDGET.documentPages; page++) docs.mockResolvedValueOnce(libraryDocuments([`page-${page}`], `cursor-${page}`));
  const read = await load();
  expect(read.coverage.documents).toBe('PARTIAL');
  expect(docs).toHaveBeenCalledTimes(LIBRARY_MACRO_BUDGET.documentPages);
  expect(read.issues.join(' ')).toContain('计数为当前画布对象数');
});
it('rejects mixed source identity and repeated cursors instead of fabricating or silently deduplicating versions', async () => {
  docs.mockResolvedValueOnce(libraryDocuments(['a'], 'repeat')).mockResolvedValueOnce(libraryDocuments(['b'], 'repeat'));
  await expect(load()).rejects.toThrow('读回不一致');
  docs.mockReset().mockResolvedValueOnce(libraryDocuments(['a'], 'next')).mockResolvedValueOnce(libraryDocuments(['a']));
  await expect(load()).rejects.toThrow('读回不一致');
});
it('reads the existing matter model only, verifies the directory revision, and reports a stale read', async () => {
  const matter = libraryMatterFixture().matter;
  directory.mockResolvedValue({ items: [{ matterId: matter.matterId, title: matter.title, primaryWorkItemId: null, createdAt: '', updatedAt: '', currentMatterRevisionId: 'stale', workingRevision: 1, result: null }], nextCursor: null, fileReadPerformed: false });
  matterRead.mockResolvedValue(matter);
  const read = await load();
  expect(read.matters).toEqual([]);
  expect(read.coverage.matters).toBe('READ_FAILED');
  expect(read.documents).toHaveLength(1);
});
it.each([403, 503])('expresses matter read failure %s separately from actual zero relationships', async statusCode => {
  directory.mockRejectedValue(Object.assign(new Error('failure'), { statusCode }));
  const read = await load();
  expect(read.coverage.matters).toBe(statusCode === 403 ? 'NOT_AUTHORIZED' : 'READ_FAILED');
  expect(read.documents).toHaveLength(1);
  expect(read.matters).toEqual([]);
});
it('clears the entire read on authentication expiry and propagates document access failure', async () => {
  directory.mockRejectedValue(Object.assign(new Error('expired'), { statusCode: 401 }));
  await expect(load()).rejects.toThrow('expired');
  docs.mockRejectedValue(Object.assign(new Error('denied'), { statusCode: 403 }));
  await expect(load()).rejects.toThrow('denied');
});
it('reports simultaneous access rejection and transport failure without turning them into an empty matter catalog', async () => {
  const matter = libraryMatterFixture().matter;
  directory.mockResolvedValue({ items: ['denied', 'failed'].map(matterId => ({ matterId, title: '', primaryWorkItemId: null, createdAt: '', updatedAt: '', currentMatterRevisionId: matter.currentRevision.matterRevisionId, workingRevision: 1, result: null })), nextCursor: null, fileReadPerformed: false });
  matterRead.mockRejectedValueOnce(Object.assign(new Error('403'), { statusCode: 403 })).mockRejectedValueOnce(Object.assign(new Error('503'), { statusCode: 503 }));
  const read = await load();
  expect(read.coverage.matters).toBe('PARTIAL');
  expect(read.matterFailures).toEqual({ unreadable: 1, failed: 1 });
  expect(read.issues.join(' ')).toContain('无权限'); expect(read.issues.join(' ')).toContain('读取失败');
});
it('stops a cancelled read before issuing further Host calls', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(readLibraryMacro(request, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(docs).not.toHaveBeenCalled();
});
