import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import WorkItemProcessWorkspace from '../../client/src/pages/DocumentParsingPage/WorkItemProcessWorkspace';
import { useJobAidWorkingRead } from '../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import {
  assessmentPageFixture,
  assessmentWorkingFixture,
} from './fixtures/document-assessment-workspace';

const mockRead = jest.fn();
const mockRefresh = jest.fn();
const mockListeners = new Set<() => void>();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
  readJobAidAssessmentWork: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  useWorkbenchPanelActive: () => true,
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: Record<string, unknown>) => createElement('button', props),
}));
jest.mock('@client/src/features/review/RevisionTimeline', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/work-item-process-workspace.css',
  () => ({}),
);
const { JSDOM } = require('jsdom');
const prior = new Map<string, PropertyDescriptor | undefined>();
let dom: InstanceType<typeof JSDOM>, container: HTMLDivElement, root: Root;
const proof = assessmentPageFixture();
function Parent({ process }: { process: boolean }) {
  const workingRead = useJobAidWorkingRead(proof.workItem.workItemId, proof);
  return process
    ? createElement(WorkItemProcessWorkspace, {
        data: proof,
        workingRead,
        onOpenAssessment: jest.fn(),
        onOpenReview: jest.fn(),
        onRefresh: mockRefresh,
      })
    : createElement('div', null, workingRead.data?.current?.content.headline);
}
async function render(process = true): Promise<void> {
  await act(async () => root.render(createElement(Parent, { process })));
}
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>');
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
});
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
beforeEach(() => {
  jest.useFakeTimers();
  mockRead.mockReset();
  mockRefresh.mockReset();
  mockRead.mockResolvedValue({
    ...assessmentWorkingFixture(),
    executionStatus: 'RUNNING',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
  expect(mockListeners.size).toBe(0);
});

it('shares the parent read with the actual legacy process view through remounts and one polling interval', async () => {
  await render();
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('正文可立即阅读');
  await render(false);
  await render(true);
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(6000);
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(mockRefresh).not.toHaveBeenCalled();
});
