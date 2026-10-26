import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  CanonicalInitialAnalysisReadModel,
  CanonicalTaskModelOptions,
} from '@shared/api.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import InitialAnalysisContinueButton from '../../client/src/features/review/InitialAnalysisContinueButton';
import InitialAnalysisProgress from '../../client/src/features/review/InitialAnalysisProgress';
import { JobAidProblemReading } from '../../client/src/pages/DocumentParsingPage/JobAidProblemWorkspace';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const mockRequest = jest.fn();
const mockStatus = jest.fn();
let mockSession = 1;
const models: CanonicalTaskModelOptions = {
  defaultModelRef: 'miaoda/glm-5.3',
  options: [
    {
      modelRef: 'miaoda/glm-5.3',
      displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN',
      providerLabel: 'Hosted',
      available: true,
    },
    {
      modelRef: 'm3probe/minimax-m3',
      displayName: 'M3 Probe Large',
      providerKind: 'CUSTOM',
      providerLabel: 'Hosted',
      available: true,
    },
  ],
};
let mockCatalog: ReturnType<
  typeof import('../../client/src/features/review/TaskModelPicker').useTaskModelOptions
>;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  requestInitialAnalysisContinuation: (...args: unknown[]) =>
    mockRequest(...args),
  getInitialAnalysisStatus: (...args: unknown[]) => mockStatus(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    sessionGeneration: mockSession,
    authenticationRequired: false,
  }),
}));
jest.mock('../../client/src/features/review/TaskModelPicker', () => ({
  __esModule: true,
  ...jest.requireActual('../../client/src/features/review/TaskModelPicker'),
  useTaskModelOptions: () => mockCatalog,
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: Record<string, unknown>) => createElement('button', props),
}));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/pages/DocumentParsingPage/JobAidIssueArticle', () => ({
  JobAidIssueArticle: ({ issue }: { issue: { body: string } }) =>
    createElement('p', null, issue.body),
  JobAidEvidenceDetails: () => null,
  JobAidRequirement: () => null,
}));
jest.mock('@client/src/features/review/review-loop.css', () => ({}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css',
  () => ({}),
);
const { JSDOM } = require('jsdom');
const prior = new Map<string, PropertyDescriptor | undefined>();
let dom: InstanceType<typeof JSDOM>;
let container: HTMLDivElement;
let root: Root;
function initial(): CanonicalInitialAnalysisReadModel {
  const executionModel = {
    modelRef: 'm3probe/minimax-m3',
    displayName: 'M3 Probe Large',
    providerKind: 'CUSTOM' as const,
    settingsRevision: 0,
    selectedAt: '2026-10-24T00:00:00Z',
  };
  return {
    workItemId: 'WI-test',
    workItemRevision: 7,
    documentVersionId: 'DV-test',
    analysisModel: executionModel,
    status: 'FAILED',
    nextOperation: null,
    continuationOperations: ['EVALUATE_JOBAID'],
    candidateOnly: true,
    stages: {
      translation: { status: 'SUCCEEDED', terminalCode: null },
      applicability: { status: 'WAITING_INPUT', terminalCode: null },
      jobAid: {
        status: 'FAILED',
        terminalCode: 'INITIAL_GATEWAY_HTTP_400',
        executionModel,
      },
      overall: { status: 'PENDING', terminalCode: null },
    },
  };
}
function working(): JobAidWorkingReadModel {
  const value = jobAidReadingFixture();
  value.executionStatus = 'FAILED';
  return value;
}
function button(label: string): HTMLButtonElement {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function renderProblem(
  value = initial(),
  data = working(),
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(JobAidProblemReading, {
        data,
        initialAnalysis: value,
        onLocateDocument: jest.fn(),
        onContinue: jest.fn(),
      }),
    ),
  );
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
});
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
beforeEach(() => {
  mockSession = 1;
  mockRequest.mockReset();
  mockStatus.mockReset();
  mockStatus.mockResolvedValue(initial());
  mockCatalog = {
    data: structuredClone(models),
    loading: false,
    error: '',
    ready: true,
    refresh: jest.fn(),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('shows the fixed old WorkItem model alongside the real new program default without submitting during reading', async () => {
  await act(async () =>
    root.render(
      createElement(InitialAnalysisProgress, {
        workItemId: 'WI-test',
        sessionGeneration: 1,
        initial: initial(),
        working: working(),
        timeline: {
          schemaVersion: 'wiselink.3_1.timeline_projection.v0.candidate',
          workItemId: 'WI-test',
          events: [],
          boundary: { onlyServerObservedEvents: true, note: 'fixture' },
        },
        onRevisionChanged: jest.fn(),
        onAccessLost: jest.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain('事项绑定模型：M3 Probe Large');
  expect(container.textContent).toContain('本次将使用：GLM 5.3');
  expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe(
    'miaoda/glm-5.3',
  );
  expect(button('开始程序评估').disabled).toBe(false);
  expect(mockRequest).not.toHaveBeenCalled();
});

it.each(['loading', 'failed', 'unavailable'] as const)(
  'cannot submit a new program assessment when the model catalog is %s',
  async (state) => {
    if (state === 'loading')
      mockCatalog = { ...mockCatalog, data: null, ready: false, loading: true };
    if (state === 'failed')
      mockCatalog = {
        ...mockCatalog,
        data: null,
        ready: false,
        error: '模型目录读取失败，请刷新后再选择。未更改任务模型。',
      };
    if (state === 'unavailable')
      mockCatalog = {
        ...mockCatalog,
        data: {
          ...models,
          options: models.options.map((option) => ({
            ...option,
            available: false,
          })),
        },
      };
    await renderProblem();
    expect(button('开始程序评估').disabled).toBe(true);
    expect(container.textContent).toContain(
      state === 'failed' ? '模型目录读取失败' : '尚未选定可用模型',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  },
);

it('keeps one explicit model, UUID and payload after an uncertain response, a new default and a page revision', async () => {
  const saved = working();
  let reject!: (error: Error) => void;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await renderProblem(initial(), saved);
  await act(async () => {
    const action = button('开始程序评估');
    action.click();
    action.click();
  });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  const original = structuredClone(mockRequest.mock.calls[0]);
  expect(original).toEqual([
    saved.workItemId,
    {
      requestId: expect.any(String),
      expectedRevision: 7,
      operation: 'EVALUATE_JOBAID',
      executionMode: 'PROGRAM_CONTROLLED_V1',
      modelRef: 'miaoda/glm-5.3',
    },
  ]);
  expect(container.textContent).toContain(
    saved.current!.content.issues[0].body,
  );
  await act(async () =>
    reject(
      Object.assign(new Error('transport interrupted'), {
        code: 'ERR_NETWORK',
      }),
    ),
  );
  expect(container.textContent).toContain('原请求结果待核');
  expect(container.textContent).not.toContain('正在核对');
  mockCatalog = {
    ...mockCatalog,
    data: { ...models, defaultModelRef: 'm3probe/minimax-m3' },
    ready: false,
    error: '模型目录读取失败，请刷新后再选择。未更改任务模型。',
  };
  await renderProblem({ ...initial(), workItemRevision: 8 }, saved);
  expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe(
    'miaoda/glm-5.3',
  );
  expect(container.querySelector<HTMLSelectElement>('select')!.disabled).toBe(
    true,
  );
  expect(container.textContent).toContain('原请求模型：GLM 5.3');
  await act(async () => button('刷新模型').click());
  expect(mockCatalog.refresh).toHaveBeenCalledTimes(1);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  mockRequest.mockResolvedValueOnce({ status: 'QUEUED', replayed: true });
  await act(async () => button('核对原请求结果').click());
  expect(mockRequest.mock.calls[1]).toEqual(original);
  expect(button('请求已受理').disabled).toBe(true);
  expect(container.textContent).toContain(
    saved.current!.content.issues[0].body,
  );
});

it('submits the explicit selection made in the actual model picker', async () => {
  await renderProblem();
  const select = container.querySelector<HTMLSelectElement>('select')!;
  await act(async () => {
    select.value = 'm3probe/minimax-m3';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('本次将使用：M3 Probe Large');
  mockRequest.mockResolvedValueOnce({ status: 'QUEUED' });
  await act(async () => button('开始程序评估').click());
  expect(mockRequest.mock.calls[0][1]).toMatchObject({
    executionMode: 'PROGRAM_CONTROLLED_V1',
    modelRef: 'm3probe/minimax-m3',
  });
});

it.each(['RUNNING', 'UNKNOWN'])(
  'does not open a new program request while the original status is %s',
  async (status) => {
    const data = working();
    data.executionStatus = status;
    await renderProblem(
      status === 'UNKNOWN'
        ? { ...initial(), continuationOperations: [] }
        : initial(),
      data,
    );
    expect(container.querySelector('select')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some(
        (node) => node.textContent === '开始程序评估',
      ),
    ).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  },
);

it.each(['TIMED_OUT', 'CANCELLED'])(
  'offers only the Host-authorized new request after a stopped terminal %s',
  async (status) => {
    const data = working();
    data.executionStatus = status;
    data.selectedExecution = {
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      attemptId: 'ATT-old',
      attemptRef: 'AQ-old',
      status,
      createdAt: '2026-10-24T00:00:00Z',
      startedAt: '2026-10-24T00:00:00Z',
      completedAt: '2026-10-24T00:01:00Z',
    };
    data.activity = {
      attemptRef: 'AQ-old',
      candidateOnly: true,
      sourceReads: [],
      savedRevisions: [],
      consumerStopped: {
        sequence: 1,
        observedAt: '2026-10-24T00:00:30Z',
        modelRound: 1,
        errorCode: 'FIXTURE_STOPPED',
        upstreamOutcome: 'UNKNOWN',
      },
      omittedEarlierRecordCount: 0,
      unknownRecordCount: 0,
      malformedRecordCount: 0,
      hasEarlierSavedRevisions: false,
      error: null,
    };
    const allowed = initial();
    allowed.stages.jobAid.status = 'BUSY';
    await renderProblem(allowed, data);
    expect(container.textContent).toContain('原请求结果待核');
    expect(container.textContent).toContain('本次程序评估会另建请求');
    expect(container.textContent).not.toContain('任务正在等待系统收尾');
    expect(button('开始程序评估').disabled).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
    await renderProblem({ ...initial(), continuationOperations: [] }, data);
    expect(container.querySelector('select')).toBeNull();
  },
);

it('keeps a historical continuation model and ignores an old-session receipt', async () => {
  const onQueued = jest.fn();
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      createElement(InitialAnalysisContinueButton, {
        workItemId: 'WI-test',
        expectedRevision: 7,
        operation: 'TRANSLATE',
        label: '继续中文翻译',
        analysisModelName: 'M3 Probe Large',
        onQueued,
      }),
    ),
  );
  expect(container.textContent).toContain('将沿用本事项模型：M3 Probe Large');
  await act(async () => button('继续中文翻译').click());
  expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('executionMode');
  expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('modelRef');
  mockSession = 2;
  await act(async () => finish({ status: 'QUEUED' }));
  expect(onQueued).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('接续请求已保存');
});

function queuedInitial(): CanonicalInitialAnalysisReadModel {
  const value = initial();
  return {
    ...value,
    status: 'BUSY',
    continuationOperations: [],
    stages: { ...value.stages, jobAid: { status: 'BUSY', terminalCode: null } },
    queuedContinuationRequest: {
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'EVALUATE_JOBAID',
      executionMode: 'PROGRAM_CONTROLLED_V1',
      modelRef: 'miaoda/glm-5.3',
      modelName: 'GLM 5.3',
    },
  };
}

async function renderQueued(value = queuedInitial(), onQueued = jest.fn()): Promise<void> {
  const data = working();
  data.executionStatus = 'QUEUED';
  await act(async () => root.render(createElement(InitialAnalysisProgress, {
    workItemId: 'WI-test', sessionGeneration: mockSession, initial: value, working: data,
    timeline: { schemaVersion: 'wiselink.3_1.timeline_projection.v0.candidate', workItemId: 'WI-test',
      events: [], boundary: { onlyServerObservedEvents: true, note: 'fixture' } },
    onRevisionChanged: onQueued, onAccessLost: jest.fn(),
  })));
}

it.each(['PROGRAM_CONTROLLED_V1', 'PROGRAM_AGENT_V1'] as const)('resumes the Host-proven %s queued request with its original UUID and model', async executionMode => {
  mockCatalog = { ...mockCatalog, data: null, ready: false, error: 'unavailable' };
  const queued = queuedInitial();
  queued.queuedContinuationRequest!.executionMode = executionMode;
  await renderQueued(queued);
  expect(mockRequest).not.toHaveBeenCalled();
  expect(container.querySelector('select')).toBeNull();
  expect(container.textContent).toContain('已受理请求模型：GLM 5.3');
  expect(button('继续已受理请求').disabled).toBe(false);
  expect(container.textContent).not.toContain('开始程序评估');
  mockRequest.mockResolvedValueOnce({ status: 'QUEUED', replayed: true });
  mockStatus.mockResolvedValueOnce({ ...queuedInitial(), queuedContinuationRequest: undefined });
  await act(async () => { button('继续已受理请求').click(); button('继续已受理请求').click(); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls[0]).toEqual(['WI-test', {
    requestId: '11111111-1111-4111-8111-111111111111', expectedRevision: 7,
    operation: 'EVALUATE_JOBAID', executionMode, modelRef: 'miaoda/glm-5.3',
  }]);
  expect(container.textContent).not.toContain('继续已受理请求');
});

it('keeps the same queued payload after an uncertain resume response and revision change', async () => {
  mockRequest.mockRejectedValueOnce(new Error('transport interrupted'));
  await renderQueued();
  await act(async () => button('继续已受理请求').click());
  const original = structuredClone(mockRequest.mock.calls[0]);
  await renderQueued({ ...queuedInitial(), workItemRevision: 8 });
  expect(container.textContent).toContain('原请求结果待核');
  mockRequest.mockResolvedValueOnce({ status: 'QUEUED', replayed: true });
  await act(async () => button('核对原请求结果').click());
  expect(mockRequest.mock.calls[1]).toEqual(original);
  expect(mockRequest).toHaveBeenCalledTimes(2);
});

it('does not offer queue recovery without a Host hint and discards stale-session resume receipts', async () => {
  await renderQueued({ ...queuedInitial(), queuedContinuationRequest: undefined });
  expect(container.textContent).not.toContain('继续已受理请求');
  expect(mockRequest).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void;
  mockRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const onQueued = jest.fn();
  await renderQueued(queuedInitial(), onQueued);
  await act(async () => button('继续已受理请求').click());
  mockSession = 2;
  await act(async () => finish({ status: 'QUEUED', replayed: true }));
  expect(onQueued).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('已恢复原请求');
});
