import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import EngineeringIssueSearch from '../../client/src/features/matter/EngineeringIssueSearch';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('@client/src/api/canonical-host', () => ({
  searchEngineeringIssues: jest.fn(),
  searchDocumentSources: jest.fn(),
  readEngineeringIssue: jest.fn(),
  referenceEngineeringIssue: jest.fn(),
  readEngineeringIssueReferenceStatus: jest.fn(),
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterWorkspace: jest.fn(),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement('input', {
        ...props,
        onChange: undefined,
        onInput: props.onChange,
      }),
  };
});
jest.mock('@client/src/pages/DocumentParsingPage/JobAidIssueArticle', () => ({
  JobAidIssueArticle: () => createElement('article', null, '问题正文'),
}));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/ReferenceWorkNotices', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/OverviewCorrectionNotices', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/OverviewSourceWork', () => ({
  __esModule: true,
  default: () => null,
}));

const api = jest.requireMock('@client/src/api/canonical-host');
const mockSearchIssues = api.searchEngineeringIssues as jest.Mock;
const mockSearchSources = api.searchDocumentSources as jest.Mock;
const mockReadIssue = api.readEngineeringIssue as jest.Mock;

const selectedRead = {
  identity: {
    subjectKind: 'ENGINEERING_MATTER',
    subjectId: 'MAT-B',
    workRef: 'MW-old',
    workRevision: 2,
    issueKey: 'I-old',
    question: '旧问题',
    sourceRefs: [],
    kind: 'WORK',
    matchedRange: '历史工作',
    reason: 'FULL_TEXT',
    rootRefs: [],
  },
  issue: { issueKey: 'I-old', question: '旧问题' },
  reading: null,
  evidence: [],
};

const newHit = {
  subjectKind: 'WORK_ITEM',
  subjectId: 'WI-new',
  workRef: 'WW-new',
  workRevision: 4,
  issueKey: 'I-new',
  question: '新检索结果',
  sourceRefs: [],
  kind: 'WORK',
  matchedRange: '当前工作',
  reason: 'FULL_TEXT',
  rootRefs: [],
};

describe('EngineeringIssueSearch restored selection lifecycle', () => {
  let dom: InstanceType<typeof JSDOM>;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.test/',
    });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    mockSearchIssues.mockReset().mockResolvedValue({
      hits: [newHit],
      hasMore: false,
      limitations: [],
    });
    mockSearchSources.mockReset().mockResolvedValue({
      hits: [],
      hasMore: false,
      limitations: [],
    });
    mockReadIssue.mockReset().mockResolvedValue(selectedRead);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
  });

  async function mount(search: string, readOnly = false) {
    await act(async () => root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [`/matters/MAT-A?${search}`] },
        readOnly
          ? createElement(EngineeringIssueSearch, { readOnly: true })
          : createElement(EngineeringIssueSearch, { matterId: 'MAT-A' }),
      ),
    ));
  }

  async function searchFor(value: string) {
    const input = container.querySelector(
      'input[aria-label="问题关键词"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new dom.window.InputEvent('input', {
        bubbles: true,
        data: value,
        inputType: 'insertText',
      }));
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new dom.window.Event('submit', {
        bubbles: true,
        cancelable: true,
      }));
    });
  }

  it('can search again after restoring an exact historical issue', async () => {
    await mount(new URLSearchParams({
      panel: 'materials',
      issueSearchQuery: '旧检索',
      issueSearchScope: 'HISTORY',
      issueSubjectKind: 'ENGINEERING_MATTER',
      issueSubjectId: 'MAT-B',
      issueWorkRef: 'MW-old',
      issueKey: 'I-old',
    }).toString());
    expect(mockReadIssue).toHaveBeenCalledWith({
      subjectKind: 'ENGINEERING_MATTER',
      subjectId: 'MAT-B',
      workRef: 'MW-old',
      issueKey: 'I-old',
    });
    await searchFor('新条件');
    expect(mockSearchIssues).toHaveBeenCalledWith('新条件', 'HISTORY');
    expect(container.textContent).toContain('新检索结果');
    expect(container.textContent).not.toContain('正在读取…');
  });

  it('reads a legacy graph selection once and still allows a new search', async () => {
    await mount(new URLSearchParams({
      panel: 'materials',
      sourceWorkRef: 'MW-old',
      sourceIssueKey: 'I-old',
    }).toString());
    expect(mockReadIssue.mock.calls).toEqual([[{
      subjectKind: 'ENGINEERING_MATTER',
      subjectId: 'MAT-A',
      workRef: 'MW-old',
      issueKey: 'I-old',
    }]]);
    await searchFor('新条件');
    expect(mockSearchIssues).toHaveBeenCalledWith('新条件', 'CURRENT');
    expect(mockReadIssue.mock.calls).toEqual([[{
      subjectKind: 'ENGINEERING_MATTER',
      subjectId: 'MAT-A',
      workRef: 'MW-old',
      issueKey: 'I-old',
    }]]);
    expect(container.textContent).toContain('新检索结果');
    expect(container.textContent).not.toContain('正在读取…');
  });

  it('opens a hit in the read-only knowledge catalogue', async () => {
    await mount('', true);
    await searchFor('新条件');
    const result = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '新检索结果',
    )!;
    await act(async () => {
      result.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    expect(mockReadIssue).toHaveBeenCalledWith({
      subjectKind: 'WORK_ITEM',
      subjectId: 'WI-new',
      workRef: 'WW-new',
      issueKey: 'I-new',
    });
    expect(container.textContent).toContain('问题正文');
  });

  it('opens a hit after normalizing surrounding search whitespace', async () => {
    await mount('');
    await searchFor('  新条件  ');
    const result = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '新检索结果',
    )!;
    await act(async () => {
      result.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    expect(mockReadIssue).toHaveBeenCalledWith({
      subjectKind: 'WORK_ITEM',
      subjectId: 'WI-new',
      workRef: 'WW-new',
      issueKey: 'I-new',
    });
    expect(container.textContent).toContain('问题正文');
  });

  it('explicitly refreshes the same selected hit when its URL identity is unchanged', async () => {
    mockSearchIssues.mockResolvedValue({
      hits: [{ ...newHit, subjectKind: 'ENGINEERING_MATTER', subjectId: 'MAT-B',
        workRef: 'MW-old', issueKey: 'I-old' }],
      hasMore: false,
      limitations: [],
    });
    await mount('issueSearchScope=HISTORY');
    await searchFor('旧检索');
    const result = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '新检索结果',
    )!;
    await act(async () => {
      result.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    const before = mockReadIssue.mock.calls.length;
    await act(async () => {
      result.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    expect(mockReadIssue).toHaveBeenCalledTimes(before + 1);
    expect(container.textContent).toContain('问题正文');
  });
});
