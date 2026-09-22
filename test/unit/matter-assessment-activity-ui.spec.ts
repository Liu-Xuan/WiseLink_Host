import type { Root } from 'react-dom/client';
import type { QueryClient as Client } from '@tanstack/react-query';
import type { MatterAssessmentActivityPage } from '../../shared/matter-assessment-activity.interface';

// Install the DOM before Query's browser/server detection; restore every owned global.
const { JSDOM } = require('jsdom');
const dom: { window: Window & typeof globalThis } = new JSDOM(
  '<!doctype html><body></body>',
  { pretendToBeVisual: true },
);
const prior = new Map<string, PropertyDescriptor | undefined>();
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
const { act, createElement }: typeof import('react') = require('react');
const {
  createRoot,
}: typeof import('react-dom/client') = require('react-dom/client');
const {
  QueryClient,
  QueryClientProvider,
}: typeof import('@tanstack/react-query') = require('@tanstack/react-query');
const mockRead = jest.fn();
jest.mock('../../client/src/api/engineering-matter', () => ({
  getMatterAssessmentActivity: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('../../client/src/components/ui/button', () => ({
  Button: (props: import('react').ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props),
}));
jest.mock('../../client/src/features/matter/useEngineeringMatter', () => ({
  ENGINEERING_MATTER_QUERY_ROOT: ['canonical-host', 'engineering-matter'],
  useEngineeringMatterQueryIdentity: (
    _enabled: boolean,
    sessionGeneration: number,
  ) => ({
    identity: {
      appId: 'app',
      tenantId: 'tenant',
      actorId: 'actor',
      sessionGeneration,
    },
    identityQuery: { isFetching: false, error: null },
  }),
}));
const Activity: typeof import('../../client/src/features/matter/MatterAssessmentActivity').default =
  require('../../client/src/features/matter/MatterAssessmentActivity').default;

function page(active = true): MatterAssessmentActivityPage {
  return {
    matterId: 'm',
    selection: 'CURRENT',
    workRef: null,
    candidateOnly: true,
    attempt: {
      attemptRef: 'a',
      status: active ? 'RUNNING' : 'SUCCEEDED',
      active,
      matterRevisionId: 'mr',
      baseWorkingRevision: 2,
      inputCount: 3,
    },
    items: [
      {
        sequence: 1,
        kind: 'WORK_SAVED',
        occurredAt: null,
        requestId: 'r',
        workRef: 'saved',
      },
    ],
    omittedEarlierCount: 0,
    unknownOmittedCount: 0,
    malformedCount: 0,
    duplicateOmittedCount: 0,
    error: null,
    nextCursor: null,
    hasMore: false,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let root: Root;
let client: Client;
let container: HTMLDivElement;
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
}
async function render(
  props: Partial<Parameters<typeof Activity>[0]> = {},
  copies = 1,
) {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        ...Array.from({ length: copies }, (_, index) =>
          createElement(Activity, {
            key: index,
            matterId: 'm',
            workRef: '',
            session: 1,
            denied: false,
            ...props,
          }),
        ),
      ),
    ),
  );
  await settle();
}
function button(label: string) {
  return [...container.querySelectorAll('button')].find(
    (element) => element.textContent === label,
  )!;
}
beforeEach(() => {
  jest.useFakeTimers();
  mockRead.mockReset();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  jest.useRealTimers();
});
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe('visible Matter activity consumer', () => {
  it('shares one slow request, polls only after completion and stops at terminal status', async () => {
    const pending = deferred<MatterAssessmentActivityPage>();
    mockRead
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page(false));
    await render({}, 2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_000);
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(page()));
    await settle();
    expect(container.textContent).toContain('已保存候选工作');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4_001);
    });
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('执行完成');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_000);
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
  it('stops on failure, retains readable content and resumes only on manual refresh', async () => {
    mockRead
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(page(false));
    await render();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4_001);
    });
    await settle();
    expect(container.textContent).toContain('network');
    expect(container.textContent).toContain('已保存候选工作');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_000);
    });
    expect(mockRead).toHaveBeenCalledTimes(2);
    await act(async () => button('刷新当前页').click());
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain('执行完成');
  });
  it('keeps a denied page hidden even if the next manual request fails with a network error', async () => {
    mockRead
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(
        Object.assign(new Error('denied'), { statusCode: 403 }),
      )
      .mockRejectedValueOnce(new Error('network'));
    await render();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4_001);
    });
    await settle();
    expect(container.textContent).not.toContain('已保存候选工作');
    await act(async () => button('刷新当前页').click());
    await settle();
    expect(container.textContent).not.toContain('已保存候选工作');
    expect(container.textContent).toContain('denied');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_000);
    });
    expect(mockRead).toHaveBeenCalledTimes(3);
  });
  it('aborts when hidden and does not accept the late result into another identity', async () => {
    const pending = deferred<MatterAssessmentActivityPage>();
    mockRead
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(page(false));
    await render();
    const signal: AbortSignal = mockRead.mock.calls[0][2];
    await act(async () => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });
    expect(signal.aborted).toBe(true);
    expect(container.textContent).toBe('');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    await act(async () =>
      document.dispatchEvent(new dom.window.Event('visibilitychange')),
    );
    await render({ session: 2 });
    await act(async () =>
      pending.resolve({
        ...page(),
        items: [
          {
            sequence: 1,
            kind: 'WORK_SAVED',
            occurredAt: null,
            workRef: 'late-private',
          },
        ],
      }),
    );
    await settle();
    expect(container.textContent).not.toContain('late-private');
  });
  it('pins historical pages, never polls history, and navigates bounded pages without accumulating duplicates', async () => {
    const first = {
      ...page(),
      selection: 'EXACT_WORK' as const,
      workRef: 'historical',
      nextCursor: 'next',
      hasMore: true,
    };
    mockRead.mockResolvedValueOnce(first).mockResolvedValue({
      ...first,
      nextCursor: null,
      hasMore: false,
      items: [
        {
          sequence: 51,
          kind: 'ORIGINAL_BOUND',
          occurredAt: null,
          parseRunId: 'old-parse',
        },
      ],
      omittedEarlierCount: 50,
    });
    await render({ workRef: 'historical' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_000);
    });
    expect(mockRead).toHaveBeenCalledTimes(1);
    await act(async () => button('下一页').click());
    await settle();
    expect(mockRead.mock.calls[1][1]).toEqual({
      workRef: 'historical',
      cursor: 'next',
    });
    expect(container.textContent).toContain('old-parse');
    expect(container.textContent).not.toContain('已保存候选工作');
    expect(button('下一页').disabled).toBe(true);
  });
  it('shares explicit refusal across pages of the same selector without reviving a cached earlier page', async () => {
    mockRead
      .mockResolvedValueOnce({
        ...page(false),
        nextCursor: 'second',
        hasMore: true,
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('source-revoked'), { statusCode: 403 }),
      )
      .mockResolvedValue(page(false));
    await render();
    await act(async () => button('下一页').click());
    await settle();
    expect(container.textContent).toContain('source-revoked');
    await act(async () => button('上一页').click());
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('已保存候选工作');
    expect(container.textContent).toContain('source-revoked');
    await act(async () => button('刷新当前页').click());
    await settle();
    expect(container.textContent).toContain('已保存候选工作');
  });
  it('cancels only after the last observer unmounts', async () => {
    const pending = deferred<MatterAssessmentActivityPage>();
    mockRead.mockReturnValue(pending.promise);
    await render({}, 2);
    const signal: AbortSignal = mockRead.mock.calls[0][2];
    await render({}, 1);
    expect(signal.aborted).toBe(false);
    await render({ denied: true });
    expect(signal.aborted).toBe(true);
  });
});
