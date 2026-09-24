import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import JobAidProblemWorkspace from '../../client/src/pages/DocumentParsingPage/JobAidProblemWorkspace';
import {
  isTemporaryJobAidReadFailure,
  jobAidReadAfterFailure,
} from '../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
  readJobAidAssessmentWork: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({
  __esModule: true,
  default: 'button',
}));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: 'section',
}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));

let root: Root;
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

function disabledRead(workItemId: string): JobAidWorkingReadModel {
  return {
    ...jobAidReadingFixture(),
    workItemId,
    current: null,
    enabled: false,
  };
}

function enabledRead(workItemId: string): JobAidWorkingReadModel {
  const read: JobAidWorkingReadModel = jobAidReadingFixture();
  return {
    ...read,
    workItemId,
    current: read.current ? { ...read.current, workItemId } : null,
  };
}

async function renderWorkspace(
  workItemId: string,
  baseRevision: number,
  baseReadConfirmed = true,
  baseReadProof?: object,
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        JobAidProblemWorkspace,
        {
          workItemId,
          baseRevision,
          baseReadConfirmed,
          baseReadProof,
          onLocateDocument: jest.fn(),
        },
        createElement('p', {}, `原有评估 ${workItemId} 修订 ${baseRevision}`),
      ),
    );
  });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  container = dom.window.document.getElementById('root');
  root = createRoot(container);
  mockRead.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

it('shows confirmed base content on first 5xx, then switches to a successful retry', async () => {
  mockRead
    .mockRejectedValueOnce(Object.assign(new Error('服务暂不可用'), { statusCode: 503 }))
    .mockResolvedValueOnce(enabledRead('WI-A'));
  await renderWorkspace('WI-A', 3);
  expect(container.textContent).toContain('问题分析刷新失败');
  expect(container.textContent).toContain('原有评估 WI-A 修订 3');
  expect(container.textContent).toContain('问题分析尚未确认');
  await act(async () => {
    (container.querySelector('button') as HTMLButtonElement).click();
  });
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain('问题分析刷新失败');
  expect(container.textContent).not.toContain('原有评估 WI-A 修订 3');
  expect(container.querySelector('[data-work-revision-ref="work-current-test"]')).not.toBeNull();
});

it.each([401, 403, 404])('keeps the base hidden on %i authorization or object loss', async (statusCode) => {
  mockRead.mockRejectedValueOnce(
    Object.assign(new Error('无权读取'), { statusCode }),
  );
  await renderWorkspace('WI-A', 3);
  expect(container.textContent).toContain('问题分析刷新失败');
  expect(container.textContent).not.toContain('原有评估 WI-A');
  expect(isTemporaryJobAidReadFailure({ statusCode })).toBe(false);
  expect(jobAidReadAfterFailure(jobAidReadingFixture(), { statusCode })).toBeNull();
});

it.each([
  [403, 'ERR_NETWORK'],
  [404, 'SERVER_503'],
] as const)(
  'does not restore rejected base after %i then %s; a fresh base read can restore it',
  async (statusCode, nextFailure) => {
    const oldBaseRead = {};
    const freshBaseRead = {};
    const temporaryFailure =
      nextFailure === 'ERR_NETWORK'
        ? Object.assign(new Error('网络中断'), { code: 'ERR_NETWORK' })
        : Object.assign(new Error('服务暂不可用'), { statusCode: 503 });
    mockRead
      .mockRejectedValueOnce(Object.assign(new Error('拒绝读取'), { statusCode }))
      .mockRejectedValueOnce(temporaryFailure)
      .mockRejectedValueOnce(temporaryFailure);
    await renderWorkspace('WI-A', 3, true, oldBaseRead);
    expect(container.textContent).not.toContain('原有评估 WI-A');
    await act(async () => {
      (container.querySelector('button') as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain('问题分析刷新失败');
    expect(container.textContent).not.toContain('原有评估 WI-A');
    expect(container.textContent).not.toContain('当前身份与对象已读回');
    await renderWorkspace('WI-A', 3, false, freshBaseRead);
    expect(mockRead).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain('原有评估 WI-A');
    await renderWorkspace('WI-A', 3, true, freshBaseRead);
    expect(container.textContent).toContain('原有评估 WI-A 修订 3');
  },
);

it('rejects a mismatched object without showing the base as a fallback', async () => {
  mockRead.mockResolvedValueOnce(disabledRead('WI-other'));
  await renderWorkspace('WI-A', 3);
  expect(container.textContent).toContain('返回内容不属于当前文档对象');
  expect(container.textContent).not.toContain('原有评估 WI-A');
  expect(isTemporaryJobAidReadFailure({ code: 'JOBAID_READ_OBJECT_MISMATCH' })).toBe(false);
  expect(jobAidReadAfterFailure(jobAidReadingFixture(), { code: 'JOBAID_READ_OBJECT_MISMATCH' })).toBeNull();
});

it('does not show an unconfirmed base or carry a failed read across object and revision changes', async () => {
  mockRead
    .mockRejectedValueOnce(Object.assign(new Error('服务暂不可用'), { statusCode: 503 }))
    .mockRejectedValueOnce(Object.assign(new Error('服务暂不可用'), { statusCode: 503 }))
    .mockResolvedValueOnce(disabledRead('WI-B'));
  await renderWorkspace('WI-A', 3, false);
  expect(container.textContent).not.toContain('原有评估 WI-A');
  await renderWorkspace('WI-B', 3);
  expect(container.textContent).toContain('原有评估 WI-B 修订 3');
  expect(container.textContent).not.toContain('WI-A');
  await renderWorkspace('WI-B', 4);
  expect(container.textContent).toContain('原有评估 WI-B 修订 4');
  expect(container.textContent).not.toContain('问题分析刷新失败');
  expect(mockRead).toHaveBeenCalledTimes(3);
});

it('ignores a late JobAid response after the base revision changes', async () => {
  let resolveOld: (read: JobAidWorkingReadModel) => void = () => undefined;
  mockRead
    .mockImplementationOnce(
      () =>
        new Promise<JobAidWorkingReadModel>((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce(disabledRead('WI-A'));
  await renderWorkspace('WI-A', 3, true, {});
  const oldSignal: AbortSignal = mockRead.mock.calls[0][1];
  await renderWorkspace('WI-A', 4, true, {});
  expect(oldSignal.aborted).toBe(true);
  await act(async () => resolveOld(enabledRead('WI-A')));
  expect(container.textContent).toContain('原有评估 WI-A 修订 4');
  expect(container.querySelector('[data-work-revision-ref="work-current-test"]')).toBeNull();
});
