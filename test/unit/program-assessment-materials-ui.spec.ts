import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ProgramAssessmentMaterials from '../../client/src/pages/DocumentParsingPage/ProgramAssessmentMaterials';
import { AssessmentProcessDetails } from '../../client/src/pages/DocumentParsingPage/WorkItemProcessWorkspace';
import {
  assessmentPageFixture,
  assessmentWorkingFixture,
} from './fixtures/document-assessment-workspace';
import { programAgentMaterialsFixture, programMaterialsFixture } from './fixtures/program-assessment-materials';
import type { JobAidProgramMaterialsRead } from '@shared/jobaid-problem-assessment.interface';

const mockIdentity = jest.fn(),
  mockRead = jest.fn();
const mockSessions = new Set<() => void>();
let mockSession = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockSessions.add(listener);
    return () => mockSessions.delete(listener);
  },
  getCanonicalHostIdentityContext: (...args: unknown[]) =>
    mockIdentity(...args),
  readProgramAssessmentMaterials: (...args: unknown[]) => mockRead(...args),
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
jest.mock('@client/src/pages/DocumentParsingPage/work-item-process-workspace.css', () => ({}));
const { JSDOM } = require('jsdom');
const prior = new Map<string, PropertyDescriptor | undefined>();
let dom: InstanceType<typeof JSDOM>, root: Root, container: HTMLDivElement;
let currentWorkItem = 'WI-material',
  currentAttempt = 'ATT-material';
function button(label: string): HTMLButtonElement {
  const node = [
    ...container.querySelectorAll<HTMLButtonElement>('button'),
  ].find((item) => item.textContent?.trim() === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  return node;
}
async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}
async function render(available = true): Promise<void> {
  await act(async () =>
    root.render(
      createElement(ProgramAssessmentMaterials, {
        workItemId: currentWorkItem,
        attemptId: currentAttempt,
        attemptRef: `AQ-${currentAttempt}`,
        available,
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
  mockRead.mockReset();
  mockIdentity.mockReset();
  mockIdentity.mockResolvedValue({ tenantId: 'tenant-A', userId: 'actor-A' });
  mockRead.mockResolvedValue(programMaterialsFixture());
  currentWorkItem = 'WI-material';
  currentAttempt = 'ATT-material';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  expect(mockSessions.size).toBe(0);
});

it.each(['PREPARED_NOT_CONFIRMED_SENT', 'RESPONSE_RECEIVED'] as const)(
  'lazily reads all five historical material groups and keeps %s truthful',
  async (submissionEvidence) => {
    mockRead.mockResolvedValueOnce({
      ...programMaterialsFixture(),
      submissionEvidence,
    });
    await render();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockIdentity).not.toHaveBeenCalled();
    await click('查看本次材料');
    expect(mockIdentity).toHaveBeenCalledWith({ fresh: true });
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(mockRead.mock.calls[0].slice(0, 2)).toEqual([
      'WI-material',
      'ATT-material',
    ]);
    for (const label of [
      '任务与范围',
      '连续原文',
      '对象与公司事实',
      '相关方法',
      '既有认识与变化',
    ])
      expect(container.textContent).toContain(label);
    expect(container.textContent).toContain(
      '准确旧版条款：除非构型已确认，否则不得认定适用。',
    );
    expect(container.textContent).toContain('表格：件号 | 单位 | 期限');
    expect(container.textContent).toContain('90日');
    expect(container.textContent).toContain('脚注：不包含已按例外批准的对象。');
    expect(container.textContent).toContain('批准意见限定于构型A。');
    expect(container.textContent).toContain('旧工作已保留，当前安装件号待核。');
    expect(container.textContent).not.toContain(
      'LATEST_MUST_NOT_REPLACE_HISTORIC_INPUT',
    );
    expect(container.textContent).toContain(
      submissionEvidence === 'RESPONSE_RECEIVED'
        ? '已记录模型响应；这不表示工程结论已采用。'
        : '材料已准备，尚未确认是否发送',
    );
    const technical = [...container.querySelectorAll('summary')].find(
      (node) => node.textContent === '技术细节：准确序列化原请求',
    )!;
    expect(technical.closest('details')!.open).toBe(false);
    expect(container.querySelector('a')).toBeNull();
  },
);

it.each(['PROGRAM_CONTROLLED_V1', 'PROGRAM_AGENT_V1'] as const)('connects the exact selected %s attempt to the actual process section without eager material reads', async (executionMode) => {
  const page = assessmentPageFixture(),
    working = assessmentWorkingFixture();
  working.selectedExecution = {
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    attemptId: 'ATT-selected',
    attemptRef: 'AQ-ATT-selected',
    executionMode,
    programMaterialsAvailable: true,
    status: 'RUNNING',
    createdAt: '2026-10-24T00:00:00Z',
    startedAt: null,
    completedAt: null,
  };
  mockRead.mockResolvedValueOnce(
    executionMode === 'PROGRAM_AGENT_V1'
      ? {
          ...programAgentMaterialsFixture(),
          workItemId: page.workItem.workItemId,
          attemptId: 'ATT-selected',
          attemptRef: 'AQ-ATT-selected',
        }
      : programMaterialsFixture(page.workItem.workItemId, 'ATT-selected'),
  );
  await act(async () =>
    root.render(
      createElement(AssessmentProcessDetails, { data: page, working }),
    ),
  );
  expect(mockRead).not.toHaveBeenCalled();
  if (executionMode === 'PROGRAM_AGENT_V1') {
    expect(container.textContent).toContain('程序 Agent 评估');
    expect(container.textContent).not.toContain('自主调查未启用');
  } else expect(container.textContent).toContain('程序评估 · 自主调查未启用');
  await click('查看本次材料');
  expect(mockRead.mock.calls[0].slice(0, 2)).toEqual([
    page.workItem.workItemId,
    'ATT-selected',
  ]);
  if (executionMode === 'PROGRAM_AGENT_V1')
    expect(container.textContent).toContain('本次资料目录');
});

it('does not invent materials without an available snapshot and shows the exact unavailable reason after an explicit read', async () => {
  await render(false);
  expect(container.textContent).toContain('尚未读到可查看的本次材料快照');
  expect(mockRead).not.toHaveBeenCalled();
  mockRead.mockRejectedValueOnce(
    Object.assign(new Error('unavailable'), {
      code: 'JOBAID_PROGRAM_MATERIALS_UNAVAILABLE',
      statusCode: 400,
    }),
  );
  await render();
  await click('查看本次材料');
  expect(container.textContent).toContain('本次执行没有可读取的合法材料快照');
  expect(container.querySelector('[aria-label="本次准确评估材料"]')).toBeNull();
});

it.each([403, 404, 409])(
  'clears a previously readable snapshot after a fresh source denial %s',
  async (statusCode) => {
    await render();
    await click('查看本次材料');
    expect(container.textContent).toContain('准确旧版条款');
    mockRead.mockRejectedValueOnce(
      Object.assign(new Error('private source detail'), { statusCode }),
    );
    await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
    expect(container.textContent).not.toContain('准确旧版条款');
    expect(container.textContent).not.toContain('private source detail');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  },
);

it.each(['workItem', 'attempt', 'session'] as const)(
  'invalidates old materials and ignores a late read after a %s change',
  async (change) => {
    let finish!: (value: JobAidProgramMaterialsRead) => void;
    mockRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await click('查看本次材料');
    const signal: AbortSignal = mockRead.mock.calls[0][2];
    if (change === 'workItem') currentWorkItem = 'WI-new';
    if (change === 'attempt') currentAttempt = 'ATT-new';
    if (change === 'session')
      await act(async () => {
        mockSession++;
        mockSessions.forEach((listener) => listener());
      });
    else await render();
    expect(signal.aborted).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(1);
    await act(async () => finish(programMaterialsFixture()));
    expect(container.textContent).not.toContain('准确旧版条款');
    expect(button('查看本次材料')).toBeDefined();
  },
);

it('clears material text while rechecking a new tenant and only accepts the new authorized snapshot', async () => {
  await render();
  await click('查看本次材料');
  let finish!: (value: JobAidProgramMaterialsRead) => void;
  mockIdentity.mockResolvedValueOnce({
    tenantId: 'tenant-B',
    userId: 'actor-A',
  });
  mockRead.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  expect(container.textContent).not.toContain('准确旧版条款');
  await act(async () =>
    finish(
      programMaterialsFixture(
        'WI-material',
        'ATT-material',
        '新租户当前允许的准确历史材料。',
      ),
    ),
  );
  expect(container.textContent).toContain('新租户当前允许的准确历史材料。');
  expect(container.textContent).not.toContain('准确旧版条款');
  expect(mockIdentity).toHaveBeenCalledTimes(2);
});

it('rejects an unrelated snapshot and keeps document text inert', async () => {
  mockRead.mockResolvedValueOnce(programMaterialsFixture('WI-other'));
  await render();
  await click('查看本次材料');
  expect(container.textContent).toContain('材料快照与当前事项或执行不一致');
  mockRead.mockResolvedValueOnce(
    programMaterialsFixture(
      'WI-material',
      'ATT-material',
      '<img src="invalid" onerror="write()">例外条款保持原文。',
    ),
  );
  await click('重新读取本次材料');
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain(
    '<img src="invalid" onerror="write()">',
  );
});

it('shows a saved Agent v2 private snapshot and keeps directory preparation distinct from actual reads', async () => {
  mockRead.mockResolvedValueOnce(programAgentMaterialsFixture());
  await render();
  await click('查看本次材料');
  expect(container.textContent).toContain('本次资料目录');
  expect(container.textContent).toContain('本次私有原文快照');
  expect(container.textContent).toContain('私有原文完整保留：例外条件尚未核实。');
  expect(container.textContent).toContain('目录和私有原文准备记录不表示已读取或已引用');
  expect(container.textContent).not.toContain('暂不能展示');
});
