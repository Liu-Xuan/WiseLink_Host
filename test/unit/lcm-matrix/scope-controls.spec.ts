import { act, createElement, type InputHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { lcmFilenameStateDate, lcmSnapshotStateDate } from '@client/src/pages/WorkspaceHomePage/lcm-source-presentation';
import { snapshot } from '../tdms-p1-frontend/fixtures';
import type { LcmMatrixResponse } from '@shared/lcm-matrix.interface';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return { Input: ({ onChange, ...props }: InputHTMLAttributes<HTMLInputElement>) =>
    react.createElement('input', { ...props, onInput: onChange }) };
});
jest.mock('@client/src/components/ui/checkbox', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return { Checkbox: ({ checked, onCheckedChange, ...props }: {
    checked: boolean; onCheckedChange(value: boolean): void;
  }) => react.createElement('button', { ...props, role: 'checkbox', 'aria-checked': checked,
    onClick: () => onCheckedChange(!checked) }) };
});
jest.mock('@client/src/components/ui/dialog', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const frame = ({ children }: { children?: ReactNode }) => react.createElement('div', null, children);
  return { Dialog: frame, DialogContent: frame, DialogTitle: frame, DialogDescription: frame };
});
jest.mock('@client/src/components/ui/select', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const frame = ({ children }: { children?: ReactNode }) => react.createElement('div', null, children);
  return { Select: frame, SelectContent: frame, SelectItem: frame, SelectTrigger: frame, SelectValue: frame };
});
import { LcmMatrixToolbar } from '@client/src/pages/WorkspaceHomePage/LcmMatrixToolbar';
import { LcmMatrixScopeDialog } from '@client/src/pages/WorkspaceHomePage/LcmMatrixScopeDialog';

describe('filename state day remains a display fact', () => {
  it.each([
    ['构型统计_B737-800_2026108161327.xls', '2026-10-08'],
    ['构型统计_A320-200_2026108165301.xls', '2026-10-08'],
    ['构型统计_B737-8_20261008161327.xlsx', '2026-10-08'],
    ['构型统计_LOCAL_2026108.xls', '2026-10-08'],
    ['构型统计_A320-200_2026-10-08_16-53-01.xlsx', '2026-10-08'],
    ['构型统计_B787_2026-10-08.xls', '2026-10-08'],
    ['构型统计_B787_20260229161327.xls', null],
    ['构型统计_B787_2026138161327.xls', null],
    ['构型统计_B787_2026108241327.xls', null],
    ['构型统计_B787_2026108166027.xls', null],
    ['构型统计_B787_2026108161360.xls', null],
    ['unknown.xls', null],
  ])('%s → %s', (filename, expected) => {
    expect(lcmFilenameStateDate(filename)).toBe(expected);
  });
  it('preserves explicit dates, original metadata and unknown effectivity', () => {
    const value = { ...snapshot(), originalFileName: '构型统计_B737-8_2026108161327.xls',
      sourceDataCutoffDate: null, sourceObservedDate: null };
    const before = structuredClone(value);
    expect(lcmSnapshotStateDate(value)).toBe('2026-10-08');
    expect(value).toEqual(before); expect(value.sourceEffectiveAt).toBeNull();
    expect(lcmSnapshotStateDate({ ...value, sourceDataCutoffDate: '2026-10-07', sourceObservedDate: '2026-10-09' })).toBe('2026-10-08');
    expect(lcmSnapshotStateDate({ ...value, originalFileName: 'unknown.xls' })).toBeNull();
  });
});

describe('actual date and multi-model controls', () => {
  let dom: JSDOM, root: Root, container: HTMLDivElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  async function click(text: string): Promise<void> {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === text);
    expect(button).toBeDefined(); await act(async () => button!.click());
  }
  async function changeDate(value: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type=date]')!;
    input.value = value;
    await act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })));
  }
  it('shows ordered multi-select buttons and a permanent actual display day, including an empty scope', async () => {
    const onModel = jest.fn(), noop = jest.fn();
    const source = { ...snapshot(), coveredAircraftModels: ['E190', 'C919', 'A320-200', 'B737-800', 'B737-8'],
      sourceDataCutoffDate: null, sourceObservedDate: null, originalFileName: '构型统计_B737-8_2026108161327.xls' };
    const props = { query: { snapshotIds: [source.snapshotId], aircraftModels: ['B737-8', 'A320-200'] },
      snapshots: [source], readSetSnapshots: [source], search: '', fullscreen: false, stateDate: '2026-10-08', loading: false,
      onSearch: noop, onField: noop, onExpand: noop, onAircraftScope: noop, onReadSet: noop, onFullscreen: noop, onModel };
    const matrix = { snapshots: [source], aircraftOrder: ['plane'], softwareIndex: [{ ata: [] }] } as unknown as LcmMatrixResponse;
    await act(async () => root.render(createElement(LcmMatrixToolbar, { ...props, matrix })));
    const buttons = [...container.querySelectorAll('[role=group] button')];
    expect(buttons.map(value => value.textContent)).toEqual(['全部机型', 'B737-8', 'B737-800', 'A320-200', 'C919', 'E190']);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[3].getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('当前快照日：2026-10-08');
    await click('B737-800'); expect(onModel).toHaveBeenLastCalledWith('B737-800');
    await click('全部机型'); expect(onModel).toHaveBeenLastCalledWith(null);
    await act(async () => root.render(createElement(LcmMatrixToolbar, { ...props, stateDate: null,
      matrix: { ...matrix, snapshots: [], aircraftOrder: [] } })));
    expect(container.textContent).toContain('当前快照日：2026-10-08（0 结果）');
    await act(async () => root.render(createElement(LcmMatrixToolbar, { ...props, matrix: null, loading: true, stateDate: '2026-10-09' })));
    expect(container.textContent).toContain('当前快照日：2026-10-09 · 读取中');
    expect(container.textContent).not.toContain('当前快照日：2026-10-08');
  });
  const options = [
    { value: 'a'.repeat(64), label: 'B737 original Oct08', date: '2026-10-08' },
    { value: 'b'.repeat(64), label: 'A320 original Oct08', date: '2026-10-08' },
    { value: 'c'.repeat(64), label: 'B737 original Oct09', date: '2026-10-09' },
  ];
  it('selects exact existing IDs for one calendar day and keeps an empty selected day explicit', async () => {
    const apply = jest.fn();
    await act(async () => root.render(createElement(LcmMatrixScopeDialog, {
      kind: 'snapshots', options, selected: [options[2].value], selectedDate: null, onClose: jest.fn(), onApply: apply,
    })));
    expect(container.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe('2026-10-09');
    await changeDate('2026-10-08'); await click('应用范围');
    expect(apply).toHaveBeenLastCalledWith([options[0].value, options[1].value], '2026-10-08');
    await changeDate('2026-10-10'); await click('应用范围');
    expect(apply).toHaveBeenLastCalledWith([], '2026-10-10');
    expect(container.textContent).toContain('已选 0 个快照');
  });
  it('retains original-file selection and removes a single-day label for a mixed historical read set', async () => {
    const apply = jest.fn();
    await act(async () => root.render(createElement(LcmMatrixScopeDialog, {
      kind: 'snapshots', options, selected: [options[0].value], selectedDate: '2026-10-08', onClose: jest.fn(), onApply: apply,
    })));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="B737 original Oct09"]')!.click());
    await click('应用范围');
    expect(apply).toHaveBeenLastCalledWith([options[0].value, options[2].value], '');
    expect(container.querySelector<HTMLInputElement>('input[type=date]')?.value).toBe('');
  });
});
