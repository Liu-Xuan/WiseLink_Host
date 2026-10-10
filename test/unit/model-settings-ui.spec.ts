import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ModelSettingsPage from '../../client/src/pages/ModelSettingsPage/ModelSettingsPage';
const read = jest.fn();
const update = jest.fn();
const publish = jest.fn();
let generation = 1;
let authenticationRequired = false;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalModelSettings: (...args: unknown[]) => read(...args),
  updateCanonicalModelSettings: (...args: unknown[]) => update(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    authenticationRequired,
    sessionGeneration: generation,
  }),
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ publishCurrentObject: publish }),
}));
jest.mock('@client/src/features/review/TaskModelPicker', () => ({
  useTaskModelOptions: () => ({
    data: saved,
    loading: false,
    refresh: jest.fn(),
  }),
}));
jest.mock(
  '../../client/src/pages/ModelSettingsPage/DocumentParsingSettingsPanel',
  () => ({ DocumentParsingSettingsPanel: () => null }),
);
jest.mock(
  '../../client/src/pages/ModelSettingsPage/model-settings.css',
  () => ({}),
);
jest.mock('react-router-dom', () => ({
  Link: ({ to, ...props }: Record<string, unknown>) =>
    createElement('a', { href: to, ...props }),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ variant: _variant, ...props }: Record<string, unknown>) =>
    createElement('button', props),
}));
const { JSDOM } = require('jsdom');
const saved = {
  status: 'CONFIGURED',
  revision: 2,
  selectedModelRef: 'm3probe/minimax-m3',
  defaultModelRef: 'm3probe/minimax-m3',
  options: [
    {
      modelRef: 'm3probe/minimax-m3',
      displayName: 'M3 Probe Large',
      providerKind: 'CUSTOM',
      providerLabel: '妙搭 Hosted',
      available: true,
    },
    {
      modelRef: 'miaoda/glm-5.3',
      displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN',
      providerLabel: '妙搭',
      available: true,
    },
  ],
  updatedAt: null,
  canManage: true,
  managementStatus: 'CONFIGURED',
  effectiveFor: 'NEW_ANALYSIS_TASKS_ONLY',
};
let dom: { window: Window & typeof globalThis };
let container: HTMLDivElement;
let root: Root;
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});
afterAll(() => dom.window.close());
beforeEach(() => {
  generation = 1;
  authenticationRequired = false;
  read.mockReset();
  update.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(createElement(ModelSettingsPage)));
}
function save() {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (e) => e.textContent === '保存模型设置',
  )!;
}
it('reads authoritative management status and disables save without an existing role', async () => {
  read.mockResolvedValue({
    ...saved,
    canManage: false,
    managementStatus: 'ROLE_NOT_CONFIGURED',
  });
  await render();
  expect(read).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('模型管理角色尚未配置');
  expect(save().disabled).toBe(true);
  expect(update).not.toHaveBeenCalled();
});
it('keeps the saved model unchanged until a successful exact-revision save', async () => {
  read.mockResolvedValue(saved);
  await render();
  const select =
    container.querySelector<HTMLSelectElement>('#configured-model')!;
  expect(select).not.toBeNull();
  await act(async () => {
    select.value = 'miaoda/glm-5.3';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('已保存：M3 Probe Large');
  update.mockRejectedValueOnce(
    Object.assign(new Error('conflict'), {
      code: 'MODEL_SETTINGS_REVISION_CONFLICT',
    }),
  );
  await act(async () => save().click());
  expect(container.textContent).toContain('请重新读取后保存');
  expect(container.textContent).toContain('已保存：M3 Probe Large');
  update.mockResolvedValue({
    ...saved,
    revision: 3,
    selectedModelRef: 'miaoda/glm-5.3',
  });
  await act(async () => save().click());
  expect(update).toHaveBeenLastCalledWith({
    expectedRevision: 2,
    modelRef: 'miaoda/glm-5.3',
  });
  expect(container.textContent).toContain('已保存：GLM 5.3');
});
it('does not expose old settings after a session change or accept a late old response', async () => {
  let resolve!: (v: unknown) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  generation = 2;
  authenticationRequired = true;
  await render();
  await act(async () => resolve(saved));
  expect(container.querySelector('#configured-model')).toBeNull();
  expect(update).not.toHaveBeenCalled();
});

it('submits once on repeated clicks and ignores a late save after a session change', async () => {
 read.mockResolvedValue(saved); await render();
 const select = container.querySelector<HTMLSelectElement>('#configured-model')!;
 await act(async () => { select.value = 'miaoda/glm-5.3'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
 let finish!: (value: unknown) => void;
 update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 await act(async () => { const button = save(); button.click(); button.click(); });
 expect(update).toHaveBeenCalledTimes(1);
 generation = 2; authenticationRequired = true; await render();
 await act(async () => finish({ ...saved, selectedModelRef: 'miaoda/glm-5.3', revision: 3 }));
 expect(container.querySelector('#configured-model')).toBeNull();
 expect(container.textContent).not.toContain('模型设置已保存');
});
