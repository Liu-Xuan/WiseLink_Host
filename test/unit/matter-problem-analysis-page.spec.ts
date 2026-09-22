jest.mock('../../client/src/features/matter/MatterAssessmentActivity', () => ({__esModule: true, default: (props: {matterId: string; workRef: string}) => createElement('section', {'data-activity-matter': props.matterId, 'data-activity-work': props.workRef})}));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MatterProblemAnalysisPage from '../../client/src/features/matter/MatterProblemAnalysisPage';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { graphReadingParams } from '../../client/src/pages/RelationGraphPage/suite-graph-return';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';

jest.mock('../../client/src/components/ui/button', () => ({Button: ({children, ...props}: any) => createElement('button', props, children)}));

const workspace = libraryMatterFixture();
workspace.working.current!.state.problemWork = jobAidReadingFixture().current!.content;
const navigate = jest.fn();
const readHistory = jest.fn();
jest.mock('react-router-dom', () => ({...jest.requireActual('react-router-dom'), useNavigate: () => navigate}));
jest.mock('../../client/src/app/providers/CurrentUserSessionProvider', () => ({useCurrentUserSession: () => ({sessionGeneration: 1, authenticationRequired: false})}));
jest.mock('../../client/src/features/matter/useEngineeringMatter', () => ({__esModule: true, default: () => ({data: workspace, loading: false, error: null, refresh: jest.fn()})}));
jest.mock('../../client/src/api/engineering-matter', () => ({getEngineeringMatterWorkingRevision: (...args: unknown[]) => readHistory(...args)}));
jest.mock('../../client/src/features/matter/MatterProblemWork', () => ({__esModule: true, default: ({revision, onLocateDocument}: any) => createElement('section', {'data-work': revision?.matterWorkRevisionId}, createElement('button', {onClick: () => onLocateDocument({kind: 'DOCUMENT_PASSAGE', evidenceRef: 'e', title: '源', versionLabel: 'R1', excerpt: '文本', workItemId: null, documentVersionId: 'dv-a', sourceRefId: 'src', locator: JSON.stringify({parseRunId: 'run-a', sourceRefId: 'src'})})}, '定位来源'))}));
jest.mock('../../client/src/features/matter/MatterWorkingDetails', () => ({__esModule: true, default: () => createElement('aside', null, '工作详情')}));
jest.mock('../../client/src/features/matter/matter-problem-analysis.css', () => ({}));

const {JSDOM} = require('jsdom');
let dom: {window: Window & typeof globalThis};
let container: HTMLDivElement;
let root: Root;

describe('MatterProblemAnalysisPage', () => {
  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', {url: 'https://example.test/'});
    Object.assign(globalThis, {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true});
  });
  afterAll(() => dom.window.close());
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); navigate.mockReset(); readHistory.mockReset(); });
  afterEach(() => { act(() => root?.unmount()); container.remove(); });
  async function render(path: string) {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(MemoryRouter, {initialEntries: [path]}, createElement(Routes, null, createElement(Route, {path: '/matters/:matterId/process', element: createElement(MatterProblemAnalysisPage)}))));
    });
    await act(async () => { await Promise.resolve(); });
  }
  it('renders the current saved problem work and opens an exact source with the same work identity', async () => {
    const graph = graphReadingParams('ui-test-matter', 'test-working-3', {perspective: 'documents', density: 5});
    const query = new URLSearchParams({workRef: 'test-working-3', returnGraphQuery: graph.toString(), returnGraphTargetMatterId: 'ui-test-matter', returnGraphTargetWorkRef: 'test-working-3'});
    await render(`/matters/ui-test-matter/process?${query}`);
    expect(container.querySelector('[data-work]')?.getAttribute('data-work')).toBe('test-working-3');
    const locate = [...container.querySelectorAll('button')].find(button => button.textContent === '定位来源') as HTMLButtonElement;
    act(() => locate.click());
    const route = new URL(navigate.mock.calls.at(-1)![0], 'https://example.test');
    expect(route.pathname).toBe('/document-versions/dv-a');
    expect(route.searchParams.get('parseRunId')).toBe('run-a');
    expect(route.searchParams.get('returnMatterWorkRef')).toBe('test-working-3');
    const back = readingReturnTarget(route.searchParams, 'dv-a', 'run-a', 'ui-test-matter');
    expect(back?.route).toContain('/matters/ui-test-matter?');
    const matter = new URL(back!.route, 'https://example.test');
    expect(matter.searchParams.get('workRef')).toBe('test-working-3');
    expect(readingReturnTarget(matter.searchParams, undefined, null, 'ui-test-matter')?.route).toBe(`/graph?${graph}`);
  });
  it('loads an exact historical work and never substitutes the current revision', async () => {
    const historical = structuredClone(workspace.working.current!);
    historical.matterWorkRevisionId = 'history-2'; historical.workingRevision = 2;
    readHistory.mockResolvedValue(historical);
    await render('/matters/ui-test-matter/process?workRef=history-2');
    expect(readHistory).toHaveBeenCalledWith('ui-test-matter', 'history-2', expect.any(AbortSignal));
    expect(container.querySelector('[data-work]')?.getAttribute('data-work')).toBe('history-2');
    expect(container.querySelector('[data-activity-work]')?.getAttribute('data-activity-work')).toBe('history-2');
    expect(container.querySelector('[data-activity-matter]')?.getAttribute('data-activity-matter')).toBe('ui-test-matter');
    expect(container.textContent).toContain('指定工作修订 2');
  });
  it('does not show current work when the requested historical revision cannot be read', async () => {
    readHistory.mockRejectedValue(new Error('历史工作不存在'));
    await render('/matters/ui-test-matter/process?workRef=missing');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-work]')).toBeNull();
    expect(container.textContent).toContain('指定工作尚未准确读回');
  });
  it('rejects duplicate or empty work identities before reading', async () => {
    await render('/matters/ui-test-matter/process?workRef=a&workRef=b');
    expect(container.textContent).toContain('指定工作身份无效');
    expect(readHistory).not.toHaveBeenCalled();
  });
});
