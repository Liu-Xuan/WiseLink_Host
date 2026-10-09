import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SuiteMatterGraphView from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import type { SuiteGraphCanvasProps } from '../../client/src/pages/RelationGraphPage/SuiteGraphCanvas';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { buildSuitePanoramaGraph } from '../../client/src/pages/RelationGraphPage/suite-graph-perspectives';
import { libraryMatterFixture } from './fixtures/library-matter';

const { JSDOM } = require('jsdom');
let mockCanvasProps: SuiteGraphCanvasProps;
jest.mock('../../client/src/pages/RelationGraphPage/SuiteGraphCanvas', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: React.forwardRef((props: SuiteGraphCanvasProps, ref) => {
    mockCanvasProps = props;
    React.useImperativeHandle(ref, () => ({ getViewport: () => null, getLayout: () => null }));
    return React.createElement('div', { 'aria-label': props.ariaLabel });
  }) };
});
jest.mock('../../client/src/pages/RelationGraphPage/suite-matter-graph-page.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: Omit<ComponentProps<'button'>, 'size'> & { variant?: string; size?: string }) => createElement('button', props),
}));

describe('mounted display-root labels and counts', () => {
  let root: Root;
  let container: HTMLDivElement;
  let dom: InstanceType<typeof JSDOM>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><div id="root"></div>');
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = dom.window.document.getElementById('root');
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
    }
    previous.clear();
  });

  it('counts loaded membership and document nodes separately from the separately authorized current Matter and business relations', async () => {
    const data = libraryMatterFixture();
    data.matter.materials = [
      { kind: 'MEMBER', materialId: 'same-version-member', familyId: 'F1', documentVersionId: 'DV1',
        scope: '', contribution: '资料角色一', basis: [], origin: 'ENGINEER', disposition: 'INCLUDED' },
      { kind: 'RELATED', materialId: 'same-version-related', familyId: 'F1', documentVersionId: 'DV1',
        scope: '', contribution: '资料角色二', basis: [], origin: 'ENGINEER', disposition: 'INCLUDED' },
    ];
    const currentMatter = buildSuiteMatterGraph(data);
    const panorama = buildSuitePanoramaGraph({ currentMatter, currentMatterId: data.matter.matterId,
      directory: { items: ['loaded-one', 'loaded-two'].map(matterId => ({ matterId, title: matterId,
        primaryWorkItemId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        currentMatterRevisionId: `revision-${matterId}`, workingRevision: 1, result: null, overallStatus: 'CURRENT' as const })), nextCursor: 'not-loaded-yet' } });
    expect(panorama.graph.groups.find(group => group.key === 'matters')!.items).toHaveLength(3);
    expect(panorama.graph.groups.find(group => group.key === 'documents')!.items).toHaveLength(2);
    // Both loaded document-role nodes refer to one exact DV. The UI counts
    // expanded nodes, while the current Matter outside the page is not loaded membership.
    const read = { ...panorama, overviewStatus: 'CURRENT' as const, graph: { ...panorama.graph, code: 'DIRECTORY-CODE' } };
    await act(async () => root.render(createElement(MemoryRouter, null,
      createElement(SuiteMatterGraphView, { read, revision: data.working.current,
        perspective: 'panorama', availablePerspectives: ['panorama'] }))));
    expect(container.querySelector('.suite-graph-canvas-status')!.textContent)
      .toBe('已加载 2 个目录事项，当前仅展开 2 个资料节点 · 2 条目录展示连接 · 2 条已表达资料关联');
    expect(container.querySelector('.suite-graph-center-head h1')!.textContent).toBe('工程资料全景');
    expect(container.querySelector('.suite-graph-center-head')!.textContent).toContain('DIRECTORY-CODE');
    expect(container.querySelector('.suite-graph-center-head')!.textContent).not.toContain('工作修订');
    expect(container.querySelector('.suite-graph-center-head')!.textContent).not.toContain('当前综合已覆盖');
    expect(container.querySelector('.suite-graph-work-panel h2')!.textContent).toBe('当前打开事项的时间线');
    expect(mockCanvasProps.ariaLabel).toBe('当前目录关系图谱');
    expect(container.querySelector('aside[aria-label="当前目录范围"]')).not.toBeNull();
    expect(container.querySelector('aside[aria-label="已保存知识"]')).toBeNull();
    expect(container.textContent).toContain('目录还有更多事项未加载');
  });

  it('retains the current Matter title, code, saved badges, business status and accessible labels for a non-display graph', async () => {
    const data = libraryMatterFixture();
    const original = buildSuiteMatterGraph(data);
    const read = { ...original, overviewStatus: 'CURRENT' as const, graph: { ...original.graph, code: 'MATTER-CODE' } };
    await act(async () => root.render(createElement(MemoryRouter, null,
      createElement(SuiteMatterGraphView, { read, revision: data.working.current,
        perspective: 'matter', availablePerspectives: ['matter'] }))));
    const header = container.querySelector('.suite-graph-center-head')!;
    expect(header.querySelector('h1')!.textContent).toBe(data.matter.title);
    expect(header.textContent).toContain('MATTER-CODE');
    expect(header.textContent).toContain('工作修订 3');
    expect(header.textContent).toContain('当前综合已覆盖');
    expect(container.querySelector('.suite-graph-work-panel h2')!.textContent).toBe('工程时间线');
    expect(mockCanvasProps.ariaLabel).toBe('工程事项关系图谱');
    expect(container.querySelector('aside[aria-label="已保存知识"]')).not.toBeNull();
    expect(container.querySelector('aside[aria-label="当前目录范围"]')).toBeNull();
    expect(container.querySelector('.suite-graph-canvas-status')!.textContent).toMatch(/^\d+ 个可见对象 · \d+ 条已表达关系$/u);
    expect(container.querySelector('.suite-graph-canvas-status')!.textContent).not.toContain('目录展示连接');
  });
});
