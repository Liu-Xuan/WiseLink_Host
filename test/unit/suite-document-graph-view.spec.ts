import { act, createElement, useState, type ComponentProps, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SuiteDocumentGraphView, { type SuiteDocumentGraphViewProps } from '../../client/src/pages/RelationGraphPage/SuiteDocumentGraphView';
import type { SuiteGraphCanvasProps } from '../../client/src/pages/RelationGraphPage/SuiteGraphCanvas';
import type { SuiteGraphMatter } from '../../client/src/pages/RelationGraphPage/suite-graph-model';
import type { SuiteGraphReadingState } from '../../client/src/pages/RelationGraphPage/suite-graph-return';
import { activateGraphLayoutSession, type SuiteGraphLayoutSnapshot } from '../../client/src/pages/RelationGraphPage/suite-graph-layout-memory';
import { suiteGraphSourceEventId, type SuiteGraphTimelineEvent } from '../../client/src/pages/RelationGraphPage/suite-graph-timeline';

const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis };
let container: HTMLDivElement;
let root: Root;
let canvasProps: SuiteGraphCanvasProps;
let mockViewport: SuiteGraphReadingState['viewport'] | null = null;
let mockLayout: SuiteGraphLayoutSnapshot | null = null;
const mockFit = jest.fn();
const mockZoom = jest.fn();

jest.mock('../../client/src/pages/RelationGraphPage/SuiteGraphCanvas', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: SuiteGraphCanvasProps, ref) => {
      canvasProps = props;
      React.useImperativeHandle(ref, () => ({
        getViewport: () => mockViewport, getLayout: () => mockLayout, fit: mockFit, zoomBy: mockZoom,
      }));
      return React.createElement('div', { 'aria-label': props.ariaLabel, 'data-testid': 'canvas' },
        props.presentation.elements.filter((element) => element.group === 'nodes' && typeof element.data.businessId === 'string')
          .map((element) => React.createElement('button', {
            key: String(element.data.id), 'data-business-id': String(element.data.businessId),
            onClick: () => props.onSelect?.(element.data, false),
          }, String(element.data.title))));
    }),
  };
});
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, size: _size, variant: _variant, ...props }: ComponentProps<'button'> & { size?: string; variant?: string }) =>
    createElement('button', props, children),
}));
jest.mock('../../client/src/pages/RelationGraphPage/suite-matter-graph-page.css', () => ({}));
jest.mock('../../client/src/pages/RelationGraphPage/suite-document-graph-page.css', () => ({}));

const cameraA = { zoom: 1.2, pan: { x: 11, y: 22 } };
const cameraB = { zoom: 1.7, pan: { x: 33, y: 44 } };
const savedLayout: SuiteGraphLayoutSnapshot = {
  nodes: [{ id: 'sg:item:statement-0-0', base: { x: 1, y: 2 }, position: { x: 64, y: 82 }, w: 216, h: 84, baseW: 216, baseH: 84 }],
};
function graphFixture(groups = 2, items = 8): SuiteGraphMatter {
  return {
    id: 'document-root', title: '准确文档邻域', code: 'SB-01 / R02', rootKind: 'document',
    groups: Array.from({ length: groups }, (_, group) => ({
      key: `group-${group}`, title: `分组 ${group}`,
      items: Array.from({ length: items }, (_, item) => ({ id: `statement-${group}-${item}`, title: `声明 ${group}-${item}`, subtitle: '来源保存内容', kind: 'statement' })),
    })),
    relations: [
      { id: 'relation-one', source: 'document-root', target: 'statement-0-0', label: '声明', type: 'STATEMENT' },
      { id: 'relation-two', source: 'document-root', target: 'statement-0-1', label: '声明', type: 'STATEMENT' },
    ],
  };
}
const pins = { documentVersionId: 'version-one', familyId: 'family-one', parseRunId: 'parse-one', candidateRevision: 2, runRef: 'run-one', statementId: 'statement-one', anchorId: 'anchor-one' };
const timelineEvent: SuiteGraphTimelineEvent = {
  id: suiteGraphSourceEventId(pins), kind: 'source', date: '2026-10-01', sortKey: null,
  title: '执行期限声明', detail: '保存的期限原文', nodeId: 'statement-0-1', pins, statement: null, sourceLabel: 'SB-01',
};
function viewProps(overrides: Partial<SuiteDocumentGraphViewProps> = {}): SuiteDocumentGraphViewProps {
  return {
    graph: graphFixture(), detail: createElement('p', null, '中心文档详情'), notices: [], layoutScope: 'session-one/document-one/run-one',
    onStateChange: jest.fn(), onSelect: jest.fn(), timelineEvents: [timelineEvent],
    timelineSources: [{ documentVersionId: 'version-one', label: 'SB-01', status: 'skipped', notice: null }],
    timelineLoading: false, onSelectEvent: jest.fn(), onExpandTimelineSource: jest.fn(), onOpenEventTimeline: jest.fn(),
    onRefresh: jest.fn(), onOpenSource: jest.fn(), onBack: jest.fn(), ...overrides,
  };
}
async function render(props: SuiteDocumentGraphViewProps) {
  await act(async () => root.render(createElement(SuiteDocumentGraphView, props)));
}
async function click(text: string) {
  const button: HTMLButtonElement | undefined = [...container.querySelectorAll('button')]
    .find((candidate: HTMLButtonElement) => candidate.textContent === text || candidate.getAttribute('aria-label') === text);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
});
afterAll(() => dom.window.close());
beforeEach(() => {
  activateGraphLayoutSession(1, true);
  mockViewport = null; mockLayout = null; mockFit.mockClear(); mockZoom.mockClear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('selects exact business identities and inspects node and bundled-edge detail in place', async () => {
  const selected = jest.fn();
  function Harness() {
    const [id, setId] = useState('document-root');
    const [detail, setDetail] = useState<ReactNode>('中心文档详情');
    return createElement(SuiteDocumentGraphView, viewProps({ selectedId: id, detail,
      onSelect: (next, ids) => { selected(next, ids); setId(next); setDetail(ids ? ids.join('、') : `详情 ${next}`); },
    }));
  }
  await act(async () => root.render(createElement(Harness)));
  await click('声明 0-0');
  expect(selected).toHaveBeenLastCalledWith('statement-0-0', undefined);
  expect(container.querySelector('aside')?.textContent).toContain('详情 statement-0-0');
  expect(canvasProps.selectedId).toBe('statement-0-0');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => canvasProps.onSelect?.({ id: 'sg:bundle:display-id', relationshipIds: ['relation-two', 'relation-one'] }, true));
  expect(selected).toHaveBeenLastCalledWith('relation-two', ['relation-two', 'relation-one']);
  expect(container.querySelector('aside')?.textContent).toContain('relation-two、relation-one');
  await act(async () => canvasProps.onInspectRelationships?.(['relation-one', 'not-authorized', 'relation-one']));
  expect(selected).toHaveBeenLastCalledWith('relation-one', ['relation-one']);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  const previousCalls = selected.mock.calls.length;
  await act(async () => canvasProps.onSelect?.({ id: 'sg:group:visual-only', virtual: true }, false));
  expect(selected).toHaveBeenCalledTimes(previousCalls);
  await click('中心文档');
  expect(selected).toHaveBeenLastCalledWith('document-root', undefined);
});

it('keeps the real timeline unmounted until expanded, then selects exact events and reads a source', async () => {
  const props = viewProps();
  await render(props);
  expect(container.querySelector('.suite-graph-timeline')).toBeNull();
  const toggle: HTMLButtonElement = container.querySelector('[aria-controls]')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const eventButton: HTMLButtonElement = container.querySelector('.suite-graph-timeline-event-main')!;
  await act(async () => eventButton.click());
  expect(props.onSelectEvent).toHaveBeenLastCalledWith(timelineEvent);
  expect(canvasProps.selectedId).toBe(timelineEvent.nodeId);
  expect(props.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
    eventId: timelineEvent.id, eventPins: pins, selectedId: timelineEvent.nodeId,
  }));
  await click('读取该来源声明');
  expect(props.onExpandTimelineSource).toHaveBeenLastCalledWith('version-one');
  await act(async () => toggle.click());
  expect(container.querySelector('.suite-graph-timeline')).toBeNull();
});

it('bounds cards and groups and only mounts one six-item overflow page', async () => {
  await render(viewProps({ graph: graphFixture(8, 40), initialState: { density: 999 } }));
  expect(canvasProps.presentation.groups).toHaveLength(6);
  expect(canvasProps.presentation.groups.every((group) => group.visible <= 6)).toBe(true);
  expect(canvasProps.presentation.visibleItemIds).toHaveLength(36);
  expect(container.querySelector('.suite-document-graph-overflow')).toBeNull();
  await act(async () => canvasProps.onOverflow?.('group-0'));
  expect(container.querySelectorAll('.suite-document-graph-overflow-items button')).toHaveLength(6);
  expect(container.textContent).not.toContain('声明 0-39');
  await click('组内资料下一页');
  expect(container.querySelectorAll('.suite-document-graph-overflow-items button')).toHaveLength(6);
  expect(container.querySelector('.suite-document-graph-overflow-items')?.textContent).toContain('声明 0-6');
  expect(container.querySelector('.suite-document-graph-overflow-items')?.textContent).not.toContain('声明 0-0');
  await click('分组下一页');
  expect(canvasProps.presentation.groups).toHaveLength(2);
  expect(canvasProps.presentation.groups.map((group) => group.key)).toEqual(['group-6', 'group-7']);
  expect(container.querySelector('.suite-document-graph-overflow')).toBeNull();
});

it('preserves an off-page exact selection and initial camera without selecting a substitute', async () => {
  const props = viewProps({ graph: graphFixture(8), initialState: {
    selectedId: 'statement-0-7', density: 3, page: 1, relationMode: 'individual',
    layoutMode: 'reference', viewport: cameraA, hiddenGroups: ['group-1'],
  } });
  await render(props);
  expect(canvasProps.selectedId).toBe('statement-0-7');
  expect(canvasProps.initialViewport).toEqual(cameraA);
  expect(container.querySelector('aside')?.textContent).toContain('仍保留准确选择');
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(props.onStateChange).not.toHaveBeenCalled();
  await act(async () => canvasProps.onViewport?.(cameraB));
  expect(props.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
    selectedId: 'statement-0-7', density: 3, page: 1, relationMode: 'individual', viewport: cameraB,
    hiddenGroups: ['group-1'], layoutMode: 'reference',
  }));
});

it.each(['source', 'back', 'timeline', 'refresh'] as const)('synchronously flushes a pending camera and layout before %s navigation', async (target) => {
  let latest: SuiteGraphReadingState = {};
  const order: string[] = [];
  const open = jest.fn(() => { order.push('navigate'); expect(latest.viewport).toEqual(cameraB); expect(latest.layoutSnapshot).toMatch(/^gl-/); });
  const props = viewProps({ initialState: { viewport: cameraA },
    onStateChange: (next, beforeNavigation) => { latest = next; if (beforeNavigation) order.push('flush'); },
    onOpenSource: open, onBack: open, onOpenEventTimeline: open, onRefresh: open,
  });
  await render(props);
  mockViewport = cameraB; mockLayout = savedLayout;
  if (target === 'timeline') {
    await act(async () => (container.querySelector('[aria-controls]') as HTMLButtonElement).click());
    await click('完整时间轴 ');
    expect(open).toHaveBeenCalledWith(timelineEvent);
  } else await click(target === 'source' ? '确切原文' : target === 'refresh' ? '刷新' : '返回');
  expect(order).toEqual(['flush', 'navigate']);
  const initialState: SuiteGraphReadingState = latest;
  await act(async () => root.unmount());
  root = createRoot(container);
  await render({ ...props, initialState });
  expect(canvasProps.initialLayout).toEqual(savedLayout);
  expect(canvasProps.initialViewport).toEqual(cameraB);
  await act(async () => root.unmount());
  root = createRoot(container);
  await render({ ...props, initialState, layoutScope: 'session-one/different-document/run-one' });
  expect(canvasProps.initialLayout).toBeUndefined();
});

it('offers keyboard focus for the in-place inspector and returns overflow focus on Escape', async () => {
  await render(viewProps());
  await click('查看所选详情');
  expect(document.activeElement).toBe(container.querySelector('aside'));
  const opener: HTMLButtonElement = container.querySelector('[data-business-id="statement-0-0"]')!;
  opener.focus();
  await act(async () => canvasProps.onOverflow?.('group-0'));
  const panel: HTMLDivElement = container.querySelector('.suite-document-graph-overflow')!;
  expect(document.activeElement).toBe(panel);
  await act(async () => panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('.suite-document-graph-overflow')).toBeNull();
  expect(document.activeElement).toBe(opener);
  await click('适应画布'); expect(mockFit).toHaveBeenCalledTimes(1);
  await click('放大图谱'); expect(mockZoom).toHaveBeenLastCalledWith(1.25);
});

it('paginates expanded timeline events instead of mounting every event', async () => {
  await render(viewProps({ timelineEvents: Array.from({ length: 50 }, (_, index) => ({ ...timelineEvent, id: `event-${index}`, title: `时间声明 ${index}` })) }));
  await act(async () => (container.querySelector('[aria-controls]') as HTMLButtonElement).click());
  expect(container.querySelectorAll('.suite-graph-timeline-event')).toHaveLength(8);
  expect(container.textContent).not.toContain('时间声明 49');
  await click('时间声明下一页');
  expect(container.querySelectorAll('.suite-graph-timeline-event')).toHaveLength(8);
  expect(container.textContent).toContain('时间声明 8');
});

it('publishes a changed controlled selection without publishing identical parent rerenders', async () => {
  const props = viewProps({ selectedId: 'statement-0-0' });
  await render(props);
  expect(props.onStateChange).not.toHaveBeenCalled();
  await render({ ...props });
  expect(props.onStateChange).not.toHaveBeenCalled();
  await render({ ...props, selectedId: 'statement-1-2' });
  expect(canvasProps.selectedId).toBe('statement-1-2');
  expect(props.onStateChange).toHaveBeenCalledTimes(1);
  expect(props.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedId: 'statement-1-2' }));
});

it('opens the event page containing a restored exact timeline selection', async () => {
  const events: SuiteGraphTimelineEvent[] = Array.from({ length: 20 }, (_, index) => ({ ...timelineEvent, id: `event-${index}`, title: `时间声明 ${index}` }));
  await render(viewProps({ timelineEvents: events, initialState: { eventId: 'event-13' } }));
  expect(container.querySelector('.suite-graph-timeline')).toBeNull();
  await act(async () => (container.querySelector('[aria-controls]') as HTMLButtonElement).click());
  expect(container.querySelector('.suite-graph-timeline-event.is-selected')?.textContent).toContain('时间声明 13');
  expect(container.querySelectorAll('.suite-graph-timeline-event')).toHaveLength(8);
});


it('flushes the live camera before a supplied detail action runs, including icon and keyboard clicks', async () => {
  let latest: SuiteGraphReadingState = {};
  const order: string[] = [];
  const detailAction = jest.fn(() => { order.push('detail'); expect(latest.viewport).toEqual(cameraB); });
  const detail: ReactNode = createElement('div', null,
    createElement('button', { onClick: detailAction }, createElement('span', { 'data-testid': 'detail-icon' }, '定位来源')),
    createElement('a', { href: '#source', onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => { event.preventDefault(); detailAction(); } }, '进入保存来源'),
    createElement('p', { 'data-testid': 'detail-text' }, '只读描述'));
  const props = viewProps({ detail, initialState: { viewport: cameraA },
    onStateChange: (next, beforeNavigation) => { latest = next; if (beforeNavigation) order.push('flush'); },
  });
  await render(props);
  mockViewport = cameraB;
  await act(async () => (container.querySelector('[data-testid="detail-icon"]') as HTMLSpanElement).click());
  expect(order).toEqual(['flush', 'detail']);
  order.length = 0;
  const link: HTMLAnchorElement = container.querySelector('aside a')!;
  // Native keyboard activation dispatches a click with detail 0 as well.
  await act(async () => link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
  expect(order).toEqual(['flush', 'detail']);
  order.length = 0;
  await act(async () => (container.querySelector('[data-testid="detail-text"]') as HTMLParagraphElement).click());
  expect(order).toEqual([]);
});
