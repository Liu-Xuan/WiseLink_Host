import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DocumentParsingSettingsPanel } from '../../client/src/pages/ModelSettingsPage/DocumentParsingSettingsPanel';
const read = jest.fn();
const update = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getDocumentParsingSettings: (...args: unknown[]) => read(...args),
  updateDocumentParsingSettings: (...args: unknown[]) => update(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({
    authenticationRequired: false,
    sessionGeneration: 1,
  }),
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ variant: _variant, ...props }: Record<string, unknown>) =>
    createElement('button', props),
}));
jest.mock('@client/src/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  }) =>
    createElement('button', {
      ...props,
      role: 'switch',
      'aria-checked': checked,
      onClick: () => onCheckedChange(!checked),
    }),
}));
const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis };
let container: HTMLDivElement;
let root: Root;
const saved = {
  revision: 2,
  localMineruFallbackEnabled: false,
  titleEnhancementEnabled: false,
  canManage: true,
  managementStatus: 'CONFIGURED',
  updatedAt: null,
  effectiveFor: 'NEW_LOCAL_DOCUMENT_PARSE_RUNS_ONLY',
};
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
  await act(async () =>
    root.render(createElement(DocumentParsingSettingsPanel)),
  );
}
it('disables both switches and save when role is unconfigured', async () => {
  read.mockResolvedValue({
    ...saved,
    canManage: false,
    managementStatus: 'ROLE_NOT_CONFIGURED',
  });
  await render();
  expect(container.textContent).toContain('管理角色尚未配置');
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].every(
      (e) => e.disabled,
    ),
  ).toBe(true);
  expect(
    [...container.querySelectorAll('button')].find(
      (e) => e.textContent === '保存解析设置',
    )!.disabled,
  ).toBe(true);
});
it('keeps persisted state visibly off until CAS save succeeds and preserves draft on failure', async () => {
  read.mockResolvedValue(saved);
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('#local-mineru-enabled')!
      .click(),
  );
  expect(container.textContent).toContain('有未保存更改');
  expect(container.querySelector('small')!.textContent).toBe('已保存：关闭');
  const save = [...container.querySelectorAll('button')].find(
    (e) => e.textContent === '保存解析设置',
  )!;
  update.mockRejectedValueOnce(
    Object.assign(new Error('conflict'), {
      code: 'DOCUMENT_PARSING_SETTINGS_REVISION_CONFLICT',
    }),
  );
  await act(async () => save.click());
  expect(container.textContent).toContain('请重新读取后保存');
  expect(container.querySelector('small')!.textContent).toBe('已保存：关闭');
  update.mockResolvedValue({
    ...saved,
    revision: 3,
    localMineruFallbackEnabled: true,
  });
  await act(async () => save.click());
  expect(update).toHaveBeenLastCalledWith({
    expectedRevision: 2,
    localMineruFallbackEnabled: true,
    titleEnhancementEnabled: false,
  });
  expect(container.querySelector('small')!.textContent).toBe('已保存：开启');
  expect(container.textContent).not.toContain('有未保存更改');
});
