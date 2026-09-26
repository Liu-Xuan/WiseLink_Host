import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import MemberSavedAssessmentReading from '../../client/src/features/matter/MemberSavedAssessmentReading';
import { compactReadingSummary } from '../../client/src/features/matter/compact-reading-summary';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const readWork = jest.fn();
let generation = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => generation,
  readJobAidAssessmentWork: (...args: unknown[]) => readWork(...args),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true, default: () => createElement('p', null, '完整正文与证据'),
}));
const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis };
let container: HTMLDivElement;
let root: Root;
function member(workItemId = 'work-item-test'): EngineeringMatterCatalogEntry {
  return { workItemId, relationRole: 'PRIMARY', linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1, workItemChangedSinceLink: false, workItemStatus: 'OPEN',
    document: { documentId: 'doc', documentVersionId: 'document-test',
      documentCode: workItemId === 'work-item-test' ? '工程资料甲' : '工程资料乙',
      businessRevision: 'R1', normalizedFamily: 'SB' },
    documentCurrentness: { familyId: 'family', currentDocumentVersionId: 'document-test',
      currentGeneration: 1, selectedVersionIsCurrent: true },
    sourceNavigation: { status: 'NOT_PARSED', sourceRefCount: 0, structuredContentPath: null } };

}
async function render(matterId = 'matter-a', members = [member()], sessionGeneration = generation) {
  await act(async () => root.render(createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    createElement(MemberSavedAssessmentReading, { matterId, members, sessionGeneration }))));
}
describe('member saved assessment reading', () => {
  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterAll(() => dom.window.close());
  beforeEach(() => {
    generation = 1; readWork.mockReset(); container = document.createElement('div');
    document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it('shows saved member knowledge without Matter work and links the exact revision, loading one member only', async () => {
    const saved = jobAidReadingFixture();
    readWork.mockResolvedValue(saved);
    await render('matter-a', [member(), member('member-b')]);
    expect(readWork).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(compactReadingSummary(saved.current!.content.headline, saved.current!.content.listBrief));
    expect(container.querySelector('[data-work-revision-ref]')?.getAttribute('data-work-revision-ref'))
      .toBe(saved.current!.workRevisionRef);
    const link = new URL(container.querySelector('a')!.href);
    expect(link.pathname).toBe('/knowledge');
    expect(link.searchParams.get('workRef')).toBe(saved.current!.workRevisionRef);
    expect(container.querySelector('details')?.open).toBe(false);
  });
  it('shows the saved engineering brief when the overall explanation is still unavailable', async () => {
    const saved = jobAidReadingFixture();
    saved.current!.content.understanding = '问题正文已保存；综合认识尚未形成。';
    saved.current!.content.listBrief = 'Gatelink 的 TLS 1.0 保留影响无线连接；升级时点仍需按原件核对。';
    readWork.mockResolvedValue(saved);
    await render();
    expect(container.textContent).toContain(saved.current!.content.listBrief);
    expect(container.textContent).not.toContain(saved.current!.content.understanding);
  });
  it('reports no saved result and explicit permission rejection without retained content', async () => {
    readWork.mockResolvedValue({ ...jobAidReadingFixture(), current: null });
    await render();
    expect(container.textContent).toContain('尚无已保存的评估');
    readWork.mockResolvedValue(jobAidReadingFixture());
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[data-work-revision-ref]')).not.toBeNull();
    readWork.mockRejectedValue(Object.assign(new Error('没有权限读取成员评估'), { statusCode: 403 }));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('没有权限');
    expect(container.querySelector('[data-work-revision-ref]')).toBeNull();
  });
  it('discards a late response after Matter identity changes', async () => {
    let resolveOld!: (value: JobAidWorkingReadModel) => void;
    readWork.mockImplementationOnce(() => new Promise<JobAidWorkingReadModel>(resolve => { resolveOld = resolve; }));
    await render('matter-a');
    const oldSignal = readWork.mock.calls[0][1] as AbortSignal;
    readWork.mockResolvedValue({ ...jobAidReadingFixture(), current: null });
    await render('matter-b');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => resolveOld(jobAidReadingFixture()));
    expect(container.textContent).toContain('尚无已保存的评估');
    expect(container.querySelector('[data-work-revision-ref]')).toBeNull();
  });
  it('rejects source drift and hides reads after session invalidation', async () => {
    const wrong = jobAidReadingFixture();
    wrong.current!.documentVersionId = 'another-version';
    readWork.mockResolvedValue(wrong);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('来源与当前资料不一致');
    generation = 2;
    await render('matter-a', [member()], 1);
    expect(container.textContent).toBe('');
  });
});
