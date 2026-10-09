import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SuiteMatterGraphView from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import type { SuiteGraphCanvasProps } from '../../client/src/pages/RelationGraphPage/SuiteGraphCanvas';
import { appendSuiteGraphActivityStatements, buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { buildSuiteGraphTimeline } from '../../client/src/pages/RelationGraphPage/suite-graph-timeline';
import { graphActivityV2 } from './fixtures/graph-activity-v2';
import { libraryMatterFixture } from './fixtures/library-matter';
const { JSDOM } = require('jsdom');
let mockCanvasProps: SuiteGraphCanvasProps;
jest.mock('../../client/src/pages/RelationGraphPage/SuiteGraphCanvas', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: React.forwardRef((props: SuiteGraphCanvasProps, ref) => {
    mockCanvasProps = props; React.useImperativeHandle(ref, () => ({ getViewport: () => null, getLayout: () => null })); return null;
  }) };
});
jest.mock('../../client/src/pages/RelationGraphPage/suite-matter-graph-page.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: ({ variant: _variant, size: _size, ...props }: Omit<ComponentProps<'button'>, 'size'> & { variant?: string; size?: string }) => createElement('button', props) }));

test('actual graph view and knowledge panel render every v2 time row, preserve raw semantics, and expose exact document navigation', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const data = libraryMatterFixture();
  data.matter.materials = [{ kind: 'MEMBER', materialId: 'native', documentVersionId: 'dv-a', familyId: 'family-dv-a', scope: '', contribution: 'Exact source', basis: [], origin: 'ENGINEER', disposition: 'INCLUDED' }];
  const reading = graphActivityV2();
  const activities = new Map([['dv-a', { familyId: reading.familyId, candidate: reading.candidate }]]);
  const read = appendSuiteGraphActivityStatements(buildSuiteMatterGraph(data), activities);
  const events = buildSuiteGraphTimeline({ read, catalog: [{ document: { documentVersionId: 'dv-a' } }], activities, revision: null }).events;
  const opened = jest.fn();
  const container: HTMLDivElement = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(SuiteMatterGraphView, {
      read, revision: data.working.current, availablePerspectives: ['matter'], timelineEvents: events,
      initialState: { eventId: events[0].id, eventPins: events[0].pins! }, onOpenDocumentNeighborhood: opened,
    }))));
    const buttons = container.querySelectorAll<HTMLButtonElement>('.suite-graph-timeline-event-main');
    expect(buttons).toHaveLength(3);
    expect([...buttons].map(button => button.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Q4 2026'), expect.stringContaining('TBD'), expect.stringContaining('after approval'),
    ]));
    expect(container.querySelector('[data-testid="activity-statement-semantics"]')?.textContent).toContain('来源声称已完成');
    expect(container.textContent).toContain(' source reports completed\r\n');
    await act(async () => buttons[2].click());
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="activity-statement-semantics"]')?.textContent).toContain('LN 2024-2026');
    const material = [...read.targets.entries()].find(([, target]) => target.kind === 'material')!;
    await act(async () => mockCanvasProps.onSelect?.({ businessId: material[0] }, false));
    const neighborhood = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '相关资料与时间')!;
    expect(neighborhood).toBeDefined();
    await act(async () => neighborhood.click());
    expect(opened).toHaveBeenCalledWith(material[1]);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of prior) {
      if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
