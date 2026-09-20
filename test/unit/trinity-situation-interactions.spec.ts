import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

jest.mock('../../client/src/features/trinity/trinity.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/select', () => {
  const React = jest.requireActual('react');
  return {
    Select: ({ children }: { children?: unknown }) => React.createElement('div', {}, children),
    SelectTrigger: ({ children }: { children?: unknown }) => React.createElement('button', {}, children),
    SelectValue: () => React.createElement('span'),
    SelectContent: ({ children }: { children?: unknown }) => React.createElement('div', {}, children),
    SelectItem: ({ children, value }: { children?: unknown; value: string }) =>
      React.createElement('div', { 'data-value': value }, children),
  };
});
const toggleMotion = jest.fn();
jest.mock('@client/src/app/providers/ThemeProvider', () => ({
  useWlTheme: () => ({
    theme: 'light', visualMode: 'default', motionEnabled: true,
    motionPausedByUser: false, systemReducedMotion: false,
    documentHidden: false, setVisualMode: jest.fn(), toggleTheme: jest.fn(),
    toggleMotion,
  }),
}));

import TrinitySituationView from '../../client/src/features/trinity/TrinitySituationView';
import { TRINITY_SAMPLE_FIXTURE } from '../../client/src/features/trinity/trinity-fixture';
import type {
  TrinityLevel, TrinityNavigationTarget, TrinitySituationData,
} from '../../client/src/features/trinity/trinity-types';

const { JSDOM } = require('jsdom');
let dom: InstanceType<typeof JSDOM>;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();
type Recorded = { kind: string; value?: string; target?: TrinityNavigationTarget };
const recorded: Recorded[] = [];

function Harness({ data = TRINITY_SAMPLE_FIXTURE }: {
  data?: TrinitySituationData;
}) {
  const [level, setLevel] = useState<TrinityLevel>('macro');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState('');
  return createElement(TrinitySituationView, {
    data, level, focusMatterId: 'm1', selectedStageId: stage,
    selectedSourceId: source,
    onLevelChange: (value: TrinityLevel) => {
      recorded.push({ kind: 'level', value }); setLevel(value);
    },
    onSelectionChange: ({ stageId, sourceId }) => {
      recorded.push({ kind: 'selection', value: `${stageId}|${sourceId}` });
      setStage(stageId);
      setSource(sourceId);
    },
    onNavigate: (target: TrinityNavigationTarget) =>
      recorded.push({ kind: 'navigate', target }),
  });
}

function click(element: Element): void {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('source and assessment situation interactions', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.test/',
    });
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
      MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true, writable: true, value,
      });
    }
    recorded.length = 0;
    toggleMotion.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(Harness, {})));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove(); dom.window.close();
    for (const [key, descriptor] of oldGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    oldGlobals.clear();
  });

  it('toggles one assessment step and clears an existing source selection', () => {
    click(container.querySelector('[data-source-category="documents"]')!);
    recorded.length = 0;
    click(container.querySelector('[data-stage="conditions"]')!);
    expect(recorded).toContainEqual({ kind: 'selection', value: 'conditions|' });
    expect(container.querySelector('.stage-node.selected')).not.toBeNull();
    click(container.querySelector('[data-stage="conditions"]')!);
    expect(recorded).toContainEqual({ kind: 'selection', value: '|' });
  });

  it('opens exact source items through their stable source id', () => {
    click(container.querySelector('[data-source-category="documents"]')!);
    recorded.length = 0;
    const item = container.querySelector('[data-source="s1"]')!;
    click(item);
    expect(recorded).toContainEqual({
      kind: 'navigate', target: { type: 'source-item', sourceId: 's1' },
    });
  });

  it('switches to focus and presents current understanding without an empty page', () => {
    click(container.querySelector('[data-level="focus"]')!);
    expect(recorded).toContainEqual({ kind: 'level', value: 'focus' });
    expect(container.textContent).toContain('目前怎样理解');
    expect(container.textContent).toContain('会改变判断的条件');
  });

  it('navigates timeline, graph and the engineering agent', () => {
    click(container.querySelector('[data-view="timeline"]')!);
    click(container.querySelector('[data-view="graph"]')!);
    click(container.querySelector('.agent-core')!);
    expect(recorded).toContainEqual({ kind: 'navigate',
      target: { type: 'view', view: 'timeline' } });
    expect(recorded).toContainEqual({ kind: 'navigate',
      target: { type: 'view', view: 'graph' } });
    expect(recorded).toContainEqual({ kind: 'navigate',
      target: { type: 'agent' } });
  });

  it('uses the shared motion preference and exposes six walkthrough scenes', () => {
    click(container.querySelector('[data-action="motion"]')!);
    expect(toggleMotion).toHaveBeenCalledTimes(1);
    click(container.querySelector('[data-action="walkthrough"]')!);
    expect(container.textContent).toContain('流程演示 1 / 6');
    expect(container.querySelectorAll('.walk-dots button')).toHaveLength(6);
    click([...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '下一幕')!);
    expect(container.textContent).toContain('流程演示 2 / 6');
  });

  it('keeps every ring control keyboard-focusable', () => {
    const controls = container.querySelectorAll(
      '.stage-node, .source-node, .agent-core, .mobile-stage-grid button, .mobile-source-grid button',
    );
    expect(controls).toHaveLength(25);
    for (const control of controls) expect(control.getAttribute('type')).toBe('button');
    const first = controls[0] as HTMLButtonElement;
    act(() => first.focus());
    expect(document.activeElement).toBe(first);
  });
});
