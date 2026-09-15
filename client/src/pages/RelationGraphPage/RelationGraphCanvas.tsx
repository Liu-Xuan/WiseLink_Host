import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type {
  Core,
  ElementDefinition,
  EventObject,
  NodeSingular,
  StylesheetStyle,
} from 'cytoscape';
import type { CanonicalLibraryIndexNodeKind } from '@shared/api.interface';
import type { RelationGraphNodeData } from './relation-graph-data';
import './relation-graph.css';

export interface RelationGraphCanvasProps {
  elements: ElementDefinition[];
  onNodeOpen: (node: RelationGraphNodeData) => void;
}

type GraphNodeShape =
  | 'hexagon'
  | 'round-rectangle'
  | 'ellipse'
  | 'diamond'
  | 'octagon'
  | 'round-diamond'
  | 'barrel';

interface KindVisual {
  shape: GraphNodeShape;
  colorToken: string;
  size: number;
}

/* 中性色 + 语义令牌，按类型区分形状；禁止蓝色系。 */
const KIND_VISUALS: Record<CanonicalLibraryIndexNodeKind, KindVisual> = {
  WORK_ITEM: { shape: 'hexagon', colorToken: '--wl-accent', size: 48 },
  DOCUMENT: { shape: 'round-rectangle', colorToken: '--wl-accent-2', size: 44 },
  DOCUMENT_VERSION: { shape: 'round-rectangle', colorToken: '--wl-accent-2', size: 38 },
  PARSED_PACKAGE: { shape: 'ellipse', colorToken: '--wl-green', size: 40 },
  READER_QUERY: { shape: 'diamond', colorToken: '--wl-amber', size: 40 },
  DYNAMIC_EVALUATION: { shape: 'diamond', colorToken: '--wl-red', size: 40 },
  ENGINEER_REVIEW: { shape: 'octagon', colorToken: '--wl-purple', size: 38 },
  OVERALL_SYNTHESIS: { shape: 'round-diamond', colorToken: '--wl-accent', size: 40 },
  AEO_CANDIDATE: { shape: 'barrel', colorToken: '--wl-green', size: 38 },
};

function readToken(name: string, fallback: string): string {
  const value: string = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function buildStylesheet(): StylesheetStyle[] {
  const ink: string = readToken('--wl-ink', '#172033');
  const faint: string = readToken('--wl-faint', '#8c97aa');
  const borderStrong: string = readToken('--wl-border-strong', 'rgba(30, 55, 92, 0.16)');
  const surface: string = readToken('--wl-surface-solid', '#ffffff');
  const sheets: StylesheetStyle[] = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'font-size': '11px',
        color: ink,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'text-max-width': '150px',
        'text-wrap': 'wrap',
        'border-width': '2px',
        'border-color': borderStrong,
        'background-color': faint,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': borderStrong,
        'target-arrow-color': borderStrong,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        opacity: 0.9,
      },
    },
    {
      selector: 'node:active',
      style: { 'overlay-opacity': 0.08 },
    },
  ];
  (Object.keys(KIND_VISUALS) as CanonicalLibraryIndexNodeKind[]).forEach(
    (kind: CanonicalLibraryIndexNodeKind): void => {
      const visual: KindVisual = KIND_VISUALS[kind];
      sheets.push({
        selector: `node[kind = "${kind}"]`,
        style: {
          shape: visual.shape,
          width: `${visual.size}px`,
          height: `${visual.size}px`,
          'background-color': readToken(visual.colorToken, surface),
        },
      });
    },
  );
  return sheets;
}

function applyStylesheet(instance: Core): void {
  instance.style().clear().fromJson(buildStylesheet()).update();
}

/** 纯 props 驱动的 cytoscape 关系图容器：elements 外部传入，
 *  节点 click 通过 onNodeOpen 回传；主题切换（--wl-* 令牌）自动重着色。 */
export default function RelationGraphCanvas({
  elements,
  onNodeOpen,
}: RelationGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Core | null>(null);
  const onNodeOpenRef = useRef<(node: RelationGraphNodeData) => void>(onNodeOpen);
  onNodeOpenRef.current = onNodeOpen;

  useEffect(() => {
    const container: HTMLDivElement | null = containerRef.current;
    if (!container) return;
    const instance: Core = cytoscape({
      container,
      elements: [],
      style: buildStylesheet(),
      wheelSensitivity: 0.2,
      minZoom: 0.35,
      maxZoom: 2,
    });
    instance.on('tap', 'node', (event: EventObject): void => {
      const node: NodeSingular = event.target as NodeSingular;
      const data: RelationGraphNodeData = node.data() as RelationGraphNodeData;
      if (data && typeof data.id === 'string') onNodeOpenRef.current(data);
    });
    instanceRef.current = instance;
    const observer = new MutationObserver((): void => {
      applyStylesheet(instance);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-wl-theme'],
    });
    return () => {
      observer.disconnect();
      instance.destroy();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance: Core | null = instanceRef.current;
    if (!instance) return;
    instance.elements().remove();
    if (elements.length > 0) {
      instance.add(elements);
      instance.layout({
        name: 'cose',
        animate: false,
        padding: 48,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 110,
      }).run();
      instance.fit(undefined, 48);
    }
  }, [elements]);

  return <div ref={containerRef} className="rg-canvas" aria-label="对象关系图谱" />;
}
