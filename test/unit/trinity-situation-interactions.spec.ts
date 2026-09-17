import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

jest.mock('../../client/src/features/trinity/trinity.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/select', () => {
  const React = jest.requireActual('react');
  return {
    Select: ({ children }: { children?: unknown }) =>
      React.createElement('div', { 'data-mock': 'select' }, children),
    SelectTrigger: ({ children, className }: { children?: unknown; className?: string }) =>
      React.createElement('button', { 'data-mock': 'select-trigger', className }, children),
    SelectValue: () => React.createElement('span', { 'data-mock': 'select-value' }),
    SelectContent: ({ children }: { children?: unknown }) =>
      React.createElement('div', { 'data-mock': 'select-content' }, children),
    SelectItem: ({ children, value }: { children?: unknown; value: string }) =>
      React.createElement('div', { 'data-mock': 'select-item', 'data-value': value }, children),
  };
});

import TrinitySituationView from '../../client/src/features/trinity/TrinitySituationView';
import { TRINITY_SAMPLE_FIXTURE } from '../../client/src/features/trinity/trinity-fixture';
import type {
  TrinityLevel,
  TrinityNavigationTarget,
  TrinitySituationData,
} from '../../client/src/features/trinity/trinity-types';

const { JSDOM } = require('jsdom');
let dom: InstanceType<typeof JSDOM>;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

type Recorded =
  | { kind: 'level'; value: TrinityLevel }
  | { kind: 'stage'; value: string }
  | { kind: 'knowledge'; value: string }
  | { kind: 'navigate'; target: TrinityNavigationTarget };

const recorded: Recorded[] = [];

function Harness({ data = TRINITY_SAMPLE_FIXTURE }: {
  data?: TrinitySituationData;
}): ReturnType<typeof createElement> {
  const [level, setLevel] = useState<TrinityLevel>('macro');
  const [stage, setStage] = useState('');
  const [knowledge, setKnowledge] = useState('');
  return createElement(TrinitySituationView, {
    data,
    level,
    selectedStageId: stage,
    selectedKnowledgeId: knowledge,
    onLevelChange: (l: TrinityLevel): void => {
      recorded.push({ kind: 'level', value: l });
      setLevel(l);
    },
    onSelectStage: (s: string): void => {
      recorded.push({ kind: 'stage', value: s });
      setStage(s);
    },
    onSelectKnowledge: (k: string): void => {
      recorded.push({ kind: 'knowledge', value: k });
      setKnowledge(k);
    },
    onNavigate: (target: TrinityNavigationTarget): void => {
      recorded.push({ kind: 'navigate', target });
    },
  });
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Trinity situation view interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      MouseEvent: dom.window.MouseEvent,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    recorded.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(Harness, {}));
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    oldGlobals.clear();
  });

  function stageButtons(id: string): NodeListOf<Element> {
    return container.querySelectorAll(`[data-stage="${id}"]`);
  }

  it('selects a stage on click and cancels on repeated click', () => {
    click(stageButtons('track')[0]);
    expect(recorded).toContainEqual({ kind: 'stage', value: 'track' });
    expect(container.querySelector('.stage-node.selected')).not.toBeNull();

    click(stageButtons('track')[0]);
    expect(recorded).toContainEqual({ kind: 'stage', value: '' });
  });

  it('clears the knowledge selection when a stage is chosen, and vice versa', () => {
    click(stageButtons('track')[0]);
    recorded.length = 0;

    click(container.querySelector('[data-kstage="acquire"]') as Element);
    expect(recorded).toContainEqual({ kind: 'knowledge', value: 'acquire' });
    expect(recorded).toContainEqual({ kind: 'stage', value: '' });
  });

  it('clears both selections when switching level', () => {
    click(stageButtons('track')[0]);
    recorded.length = 0;

    click(container.querySelector('[data-level="focus"]') as Element);
    expect(recorded).toContainEqual({ kind: 'level', value: 'focus' });
    expect(recorded).toContainEqual({ kind: 'stage', value: '' });
  });

  it('navigates through the three view entries', () => {
    click(container.querySelector('[data-view="timeline"]') as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'view', view: 'timeline' },
    });

    recorded.length = 0;
    click(container.querySelector('[data-view="graph"]') as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'view', view: 'graph' },
    });
  });

  it('keeps the agent core reachable without long-form context text', () => {
    click(container.querySelector('.agent-core') as Element);
    expect(recorded).toContainEqual({ kind: 'navigate', target: { type: 'agent' } });
  });

  it('routes matter rows from the stage panel into focus with accurate ids', () => {
    click(stageButtons('track')[0]);
    recorded.length = 0;

    const first = container.querySelector('.phase-matter') as HTMLElement;
    expect(first).not.toBeNull();
    click(first);
    const nav = recorded.find((r) => r.kind === 'navigate') as
      { kind: 'navigate'; target: TrinityNavigationTarget } | undefined;
    expect(nav).toBeDefined();
    expect(nav?.target).toEqual({
      type: 'focus-matter',
      matterId: first.getAttribute('data-focus'),
    });
  });

  it('routes the full matter table to the library view', () => {
    click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('表格查看全部事项')) as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate', target: { type: 'view', view: 'library' },
    });
  });

  it('routes a selected stage table to its stage library', () => {
    click(container.querySelector('[data-stage="track"]') as Element);
    recorded.length = 0;
    click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('表格查看')) as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate', target: { type: 'stage-library', stageId: 'track' },
    });
  });

  it('routes attention rows and bottom cards to their reading entries', () => {
    const attention = container.querySelector('.attention-item') as HTMLElement;
    click(attention);
    expect(recorded.some((r) =>
      r.kind === 'navigate' && r.target.type === 'focus-matter')).toBe(true);

    recorded.length = 0;
    click(container.querySelector('.bottom-card [data-view="timeline"]') ??
      [...container.querySelectorAll('.bottom-card button')].find(
        (b) => b.textContent?.includes('完整时间轴')) as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'view', view: 'timeline' },
    });

    recorded.length = 0;
    click([...container.querySelectorAll('.bottom-card button')].find(
      (b) => b.textContent?.includes('查阅知识')) as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'knowledge-view' },
    });
  });

  it('exposes every ring control as a keyboard-focusable button', () => {
    const controls = container.querySelectorAll(
      '.stage-node, .knowledge-node, .agent-core, .mobile-stage-grid button, .mobile-knowledge button',
    );
    expect(controls.length).toBeGreaterThanOrEqual(29);
    for (const control of controls) {
      expect(control.tagName).toBe('BUTTON');
      expect(control.getAttribute('type')).toBe('button');
    }
    const first = controls[0] as HTMLButtonElement;
    act(() => {
      first.focus();
    });
    expect(document.activeElement).toBe(first);
  });

  it('navigates to matter reading from the focus strip', () => {
    click(container.querySelector('[data-level="focus"]') as Element);
    recorded.length = 0;

    click([...container.querySelectorAll('.focus-strip button')].find(
      (b) => b.textContent?.includes('阅读事项')) as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'matter-reading', matterId: 'm1' },
    });

    recorded.length = 0;
    click([...container.querySelectorAll('.focus-strip button')].find(
      (b) => b.textContent?.includes('查看历程')) as Element);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'matter-timeline', matterId: 'm1' },
    });
  });

  function rerender(data: TrinitySituationData): void {
    act(() => {
      root.unmount();
    });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(Harness, { data }));
    });
  }

  it('lists saved review conditions as candidate work and opens the exact owning work revision', () => {
    rerender({
      ...TRINITY_SAMPLE_FIXTURE,
      reviewConditions: [
        { itemId: 'rc-1', text: '构型记录到达后重新核对。', basisRefs: ['basis-a'],
          when: { kind: 'DUE_AT', at: '2026-12-31' },
          matterId: 'm1', matterWorkRevisionId: 'work-rev-7', workingRevision: 7 },
        { itemId: 'rc-2', text: '原文变化后复看该条件。', basisRefs: [],
          when: { kind: 'ORIGINAL_CHANGED', inputId: 'input-4', afterParseRunId: null },
          matterId: 'm1', matterWorkRevisionId: 'work-rev-7', workingRevision: 7 },
      ],
    });
    click(stageButtons('improve')[0]);
    expect(container.textContent).toContain('已保存复看条件');
    expect(container.textContent).toContain('候选工作内容，不是正式改进记录');
    expect(container.textContent).toContain('构型记录到达后重新核对。');
    expect(container.textContent).toContain('期限：2026-12-31（保存原文，未判断是否逾期）');
    expect(container.textContent).toContain('输入 input-4 · 其后解析 未固定');
    expect(container.textContent).toContain('保存的依据引用标识：basis-a');
    expect(container.textContent).toContain('保存的依据引用标识：无');
    recorded.length = 0;
    const open = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('打开所属工作修订')) as Element;
    expect(open).toBeDefined();
    click(open);
    expect(recorded).toContainEqual({
      kind: 'navigate',
      target: { type: 'matter-work', matterId: 'm1', workRef: 'work-rev-7' },
    });
  });

  it('shows exact empty states for missing current work and for an empty saved condition list', () => {
    rerender({ ...TRINITY_SAMPLE_FIXTURE, reviewConditions: null });
    click(stageButtons('improve')[0]);
    expect(container.textContent).toContain('尚无当前已保存工作');
    expect(container.textContent).not.toContain('打开所属工作修订');

    rerender({ ...TRINITY_SAMPLE_FIXTURE, reviewConditions: [] });
    click(stageButtons('improve')[0]);
    expect(container.textContent).toContain('当前已保存工作未单独保存复看条件');
    expect(container.textContent).not.toContain('打开所属工作修订');
  });

  it('does not project saved review conditions without focus scope', () => {
    click(stageButtons('improve')[0]);
    expect(container.textContent).toContain('不投影保存的复看条件');
    expect(container.textContent).not.toContain('打开所属工作修订');
  });
});
