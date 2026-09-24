import type { Root } from 'react-dom/client';
import type { JobAidWorkingReadModel } from '../../shared/jobaid-problem-assessment.interface';
const { JSDOM } = require('jsdom');
const dom: { window: Window & typeof globalThis } = new JSDOM(
  '<!doctype html><body></body>',
);
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}
const { act, createElement }: typeof import('react') = require('react');
const {
  createRoot,
}: typeof import('react-dom/client') = require('react-dom/client');
let mockSession = 1;
let mockActive = true;
let hidden = false;
const mockListeners = new Set<() => void>();
const mockRead = jest.fn();
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
  readJobAidAssessmentWork: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('../../client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  useWorkbenchPanelActive: () => mockActive,
}));
const {
  useJobAidWorkingRead,
}: typeof import('../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead') = require('../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead');
let current: ReturnType<typeof useJobAidWorkingRead>;
let root: Root;
let container: HTMLElement;
function Probe({ id }: { id: string }) {
  current = useJobAidWorkingRead(id);
  return null;
}
function page(
  status: string | null = 'RUNNING',
  workItemId = 'WI-one',
): JobAidWorkingReadModel {
  return {
    schemaVersion: 'wiselink.jobaid-working-read.v2',
    enabled: true,
    workItemId,
    current: null,
    latestAttempt: null,
    executionStatus: status,
    currentInputChanged: false,
    overallStatus: 'NOT_AVAILABLE',
    overallBasedOnWorkRevisionRef: null,
  };
}
async function render(id = 'WI-one') {
  await act(async () => {
    root.render(createElement(Probe, { id }));
  });
}
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
async function visibility(value: boolean) {
  await act(async () => {
    hidden = value;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
  });
}
beforeEach(() => {
  mockSession = 1;
  mockActive = true;
  hidden = false;
  mockRead.mockReset();
  jest.useFakeTimers();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
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
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it('polls active execution and stops once the Host returns terminal status', async () => {
  mockRead
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page('SUCCEEDED'));
  await render();
  await advance(6000);
  await advance(60000);
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(current.data?.executionStatus).toBe('SUCCEEDED');
});
it.each([null, 'FAILED', 'CANCELLED', 'TIMED_OUT', 'WAITING_INPUT'])(
  'does not poll inactive status %s',
  async (status) => {
    mockRead.mockResolvedValue(page(status));
    await render();
    await advance(60000);
    expect(mockRead).toHaveBeenCalledTimes(1);
  },
);
it('aborts a hidden in-flight request, ignores its late result and reads afresh when visible', async () => {
  let resolve: (value: JobAidWorkingReadModel) => void = () => {};
  mockRead
    .mockImplementationOnce(
      () =>
        new Promise<JobAidWorkingReadModel>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(page('SUCCEEDED'));
  await render();
  const signal = mockRead.mock.calls[0][1] as AbortSignal;
  await visibility(true);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(page()));
  await advance(60000);
  expect(current.data).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(1);
  await visibility(false);
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(current.data?.executionStatus).toBe('SUCCEEDED');
});
it('failure preserves readable work and stays stopped across visibility and retained-panel switches until manual retry', async () => {
  const saved = page();
  mockRead
    .mockResolvedValueOnce(saved)
    .mockRejectedValueOnce(
      Object.assign(new Error('network failed'), { code: 'ERR_NETWORK' }),
    )
    .mockResolvedValue(page('SUCCEEDED'));
  await render();
  await advance(6000);
  expect(current.data).toBe(saved);
  await visibility(true);
  await visibility(false);
  mockActive = false;
  await render();
  mockActive = true;
  await render();
  await advance(60000);
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(current.error).toBe('network failed');
  await act(async () => current.refresh());
  expect(mockRead).toHaveBeenCalledTimes(3);
  expect(current.error).toBeNull();
});
it('drops saved work on an unclassified failure instead of treating it as network', async () => {
  mockRead
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(new Error('network failed'));
  await render();
  await advance(6000);
  expect(current.data).toBeNull();
  expect(current.temporaryError).toBe(false);
});
it('explicit denial removes prior content and an ordinary retry failure cannot restore it', async () => {
  mockRead
    .mockResolvedValueOnce(page())
    .mockRejectedValueOnce(
      Object.assign(new Error('denied'), { statusCode: 403 }),
    )
    .mockRejectedValueOnce(new Error('network failed'));
  await render();
  await advance(6000);
  expect(current.data).toBeNull();
  await act(async () => current.refresh());
  expect(current.data).toBeNull();
});
it('session or WorkItem change immediately hides previous data and rejects old in-flight results', async () => {
  let resolve: (value: JobAidWorkingReadModel) => void = () => {};
  mockRead
    .mockResolvedValueOnce(page())
    .mockImplementationOnce(
      () =>
        new Promise<JobAidWorkingReadModel>((done) => {
          resolve = done;
        }),
    )
    .mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => {
    mockSession++;
    for (const listener of mockListeners) listener();
  });
  expect(current.data).toBeNull();
  const signal = mockRead.mock.calls[1][1] as AbortSignal;
  await render('WI-two');
  expect(signal.aborted).toBe(true);
  expect(current.data).toBeNull();
  await act(async () => resolve(page('SUCCEEDED')));
  expect(current.data).toBeNull();
});
