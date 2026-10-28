import type { Root } from 'react-dom/client';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';

const { JSDOM } = require('jsdom');
const dom: { window: Window & typeof globalThis } = new JSDOM('<!doctype html><body></body>');
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: Record<string, unknown>) => require('react').createElement('button', props),
}));
jest.mock('@client/src/api/canonical-host', () => ({ getCanonicalHostClientSessionGeneration: () => 1 }));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
const { JobAidProblemReading }: typeof import('../../client/src/pages/DocumentParsingPage/JobAidProblemWorkspace') =
  require('../../client/src/pages/DocumentParsingPage/JobAidProblemWorkspace');
const scroll = jest.fn();
Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
let root: Root, container: HTMLElement;
beforeEach(() => {
  scroll.mockClear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it.each(['understanding', 'method', 'issues', 'investigation'] as const)(
  'locates the exact checklist issue after mounting from %s without losing the existing same-view path', async start => {
    const data = jobAidReadingFixture();
    const revision = data.current!;
    const target = { ...structuredClone(revision.content.issues[0]!), issueKey: 'issue-second',
      issueRef: 'issue-ref-second', question: '第二个准确问题' };
    revision.content.issues.push(target);
    revision.content.checklistBinding = buildJobAidChecklistBinding({ workItemId: revision.workItemId,
      documentVersionId: revision.documentVersionId, basedOnWorkItemRevision: revision.basedOnWorkItemRevision });
    revision.content.checklistResults = [{ itemId: 'ENG-SCOPE-01', itemApplicability: 'APPLICABLE', outcome: 'OPEN',
      resultRefs: [{ issueKey: target.issueKey, fieldPath: '/body' }], basisRefs: [] }];
    const selected = jest.fn();
    await act(async () => root.render(createElement(JobAidProblemReading, { data, onLocateDocument: jest.fn(),
      presentation: start === 'investigation' ? 'investigation' : 'default', onIssueSelect: selected })));
    if (start === 'understanding' || start === 'method') {
      const label = start === 'understanding' ? '当前认识' : '方法与要求';
      const button = [...container.querySelectorAll<HTMLButtonElement>('.wl-jobaid-tabs button')]
        .find(item => item.textContent === label)!;
      await act(async () => button.click());
      expect(container.querySelector(`[data-issue-key="${target.issueKey}"]`)).toBeNull();
    }
    const checklist = container.querySelector<HTMLDetailsElement>('[aria-label="已保存工作的检查单"]')!;
    for (const details of [checklist, ...checklist.querySelectorAll('details')]) details.open = true;
    const link = [...checklist.querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent === target.question)!;
    expect(link).toBeDefined();
    await act(async () => link.click());
    const article = container.querySelector<HTMLElement>(`[data-issue-key="${target.issueKey}"]`)!;
    expect(article).not.toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(article);
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' });
    expect(document.activeElement).toBe(article);
    expect(selected).toHaveBeenLastCalledWith(target.issueKey);
    // Repeating the same location while already mounted still scrolls/focuses.
    await act(async () => link.click());
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll.mock.contexts[1]).toBe(article);
    expect(document.activeElement).toBe(article);
  },
);
