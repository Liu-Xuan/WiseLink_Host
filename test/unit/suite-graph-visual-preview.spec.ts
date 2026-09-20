import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import SuiteGraphVisualPreviewPage from '../../client/src/pages/GraphRelationPreviewPage/SuiteGraphVisualPreviewPage';
import { SUITE_GRAPH_VISUAL_READS } from '../../client/src/pages/GraphRelationPreviewPage/suite-graph-visual-fixture';

var capturedProps: Record<string, unknown> = {};
jest.mock('../../client/src/pages/RelationGraphPage/SuiteMatterGraphView', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    capturedProps = props;
    const change = props.onPerspectiveChange as (value: string) => void;
    return createElement(
      'div',
      null,
      ['matter', 'documents', 'domain', 'panorama'].map((value) =>
        createElement('button', { key: value, onClick: () => change(value) }, value)),
    );
  },
}));

describe('SuiteGraphVisualPreviewPage', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const network = jest.fn();

  beforeEach(async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>');
    const nextGlobals = {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
      fetch: network,
    };
    for (const [key, value] of Object.entries(nextGlobals)) {
      originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    container = document.getElementById('root')!;
    capturedProps = {};
    network.mockClear();
    root = createRoot(container);
    await act(async () => root.render(createElement(SuiteGraphVisualPreviewPage)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originalGlobals.clear();
  });

  it('switches among four different production-built graph reads without wiring production callbacks', async () => {
    expect(capturedProps.read).toBe(SUITE_GRAPH_VISUAL_READS.matter);
    for (const perspective of ['documents', 'domain', 'panorama'] as const) {
      const button = Array.from(container.querySelectorAll('button')).find(
        (item) => item.textContent === perspective,
      );
      await act(async () => button!.click());
      expect(capturedProps.read).toBe(SUITE_GRAPH_VISUAL_READS[perspective]);
    }
    expect(capturedProps.onOpenTarget).toBeUndefined();
    expect(capturedProps.onLocateEvidence).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps perspective identities and relations explicit', () => {
    expect(SUITE_GRAPH_VISUAL_READS.documents.graph.groups.map((group) => group.key))
      .toEqual(['documents']);
    expect(SUITE_GRAPH_VISUAL_READS.domain.graph.groups.map((group) => group.key))
      .toEqual(['ata:32', 'ata:34', 'unclassified']);
    expect([...SUITE_GRAPH_VISUAL_READS.domain.relationDetails.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ATA_CLASSIFICATION', value: '32', status: 'PENDING_REVIEW' }),
        expect.objectContaining({ kind: 'ATA_CLASSIFICATION', value: '34', status: 'PENDING_REVIEW' }),
      ]),
    );
    expect(SUITE_GRAPH_VISUAL_READS.panorama.graph.rootKind).toBe('display');
    expect(SUITE_GRAPH_VISUAL_READS.panorama.graph.groups.find((group) => group.key === 'matters')?.items)
      .toHaveLength(3);
    const otherMatterIds = new Set(['preview:hydraulic', 'preview:fmc'].map((id) => JSON.stringify(['matter', id])));
    expect(SUITE_GRAPH_VISUAL_READS.panorama.graph.relations.filter(
      (relation) => otherMatterIds.has(relation.source) && relation.type !== 'DIRECTORY_MEMBERSHIP',
    )).toEqual([]);
    const panoramaCurrentMatterId = JSON.stringify(['matter', 'preview:gear']);
    expect(SUITE_GRAPH_VISUAL_READS.panorama.graph.relations.filter(
      (relation) => relation.type !== 'DIRECTORY_MEMBERSHIP',
    ).every((relation) => relation.source === panoramaCurrentMatterId)).toBe(true);
    const limitingRelation = SUITE_GRAPH_VISUAL_READS.matter.graph.relations.find(
      (relation) => relation.id === 'preview:relation:record-limits-question',
    );
    expect(limitingRelation).toMatchObject({
      source: 'g-r1',
      target: 'g-q1',
      type: 'LIMITS',
    });
    expect(SUITE_GRAPH_VISUAL_READS.matter.relationDetails.get(
      'preview:relation:record-limits-question',
    )).toMatchObject({
      role: 'LIMITS',
      evidenceRef: 'preview:evidence:taxi-condition',
    });
    const documentTargets = [...SUITE_GRAPH_VISUAL_READS.matter.targets.values()].filter(
      (target) => target.kind === 'document',
    );
    const domainTargets = [...SUITE_GRAPH_VISUAL_READS.domain.targets.values()].filter(
      (target) => target.kind === 'catalog-document',
    );
    expect(domainTargets.map((target) => target.kind === 'catalog-document'
      ? target.entry.documentCurrentness.familyId
      : '')).toEqual(documentTargets.map((target) => target.kind === 'document'
      ? target.familyId
      : ''));
  });
});
