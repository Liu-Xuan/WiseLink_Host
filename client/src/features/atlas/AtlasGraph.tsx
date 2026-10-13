import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type StylesheetJson } from 'cytoscape';
import type { AtlasGraph as Graph, AtlasLocation } from './atlas-model';
import { atlasRelationLabel } from './atlas-model';
import layouts from './data/layouts.json';
import icons from './data/icons.json';
function nodeIcon(kind: string, palette: Record<string, string>) {
  const paths: Record<string, string> = icons.paths;
  return (
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${palette[kind] ?? '#a2b5c7'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[kind] ?? paths.document}</svg>`,
    )
  );
}
const styles = (dark: boolean, compatible: boolean, macro: boolean): StylesheetJson => [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      shape: (node) => node.data('shape') as cytoscape.Css.NodeShape,
      width: 55,
      height: 58,
      'background-color': dark ? '#2b2d27' : '#fdfdfa',
      'background-image': 'data(icon)',
      'background-width': '52%',
      'background-height': '52%',
      'border-width': 1.5,
      'border-color': 'data(color)',
      color: dark ? '#dce0d2' : '#404738',
      'font-size': 15,
      'text-wrap': 'wrap',
      'text-max-width': '150px',
      'text-valign': 'bottom',
      'text-margin-y': 12,
      'text-background-color': dark ? '#181916' : '#f7f8f1',
      'text-background-opacity': 0.82,
      'text-background-padding': '3px',
      'background-fill': compatible ? 'solid' : 'linear-gradient',
      'background-gradient-stop-colors': dark
        ? ['#393b33', '#262820']
        : ['#ffffff', '#eeeee9'],
      'background-gradient-direction': 'to-bottom',
      'min-zoomed-font-size': 7,
    },
  },
  {
    selector: 'node[kind="matter"]',
    style: {
      shape: 'ellipse',
      width: 78,
      height: 78,
      'border-width': 2.5,
      'border-style': 'double',
      'font-size': 17,
      'background-color': dark ? '#35382f' : '#f2f3ea',
    },
  },
  {
    selector: '.domain-detail',
    style: {
      'font-size': 22,
      'text-max-width': '170px',
      width: 68,
      height: 68,
    },
  },
  {
    selector: 'node[kind="system"]',
    style: { width: 72, height: 72 },
  },
  {
    selector: 'node[kind="reference"], node.unknown',
    style: { 'border-style': 'dashed', 'background-opacity': 0.4 },
  },
  {
    selector: 'edge',
    style: {
      width: 1.1,
      'line-color': dark ? '#717965' : '#adb6a2',
      'target-arrow-color': dark ? '#717965' : '#adb6a2',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      opacity: 0.5,
    },
  },
  {
    selector: '.primary',
    style: {
      width: 96,
      height: 116,
      'border-width': 3,
      'border-color': '#d4b67a',
      'font-size': 19,
      'text-max-width': '220px',
      'background-color': dark ? '#363a2e' : '#f0f2e7',
    },
  },
  {
    selector: ':selected',
    style: {
      'border-width': 4,
      'border-color': '#f5d49a',
      'overlay-opacity': 0.1,
      label: 'data(label)',
      color: dark ? '#fff1d4' : '#514621',
    },
  },
  {
    selector: 'edge:selected',
    style: {
      label: 'data(label)',
      'font-size': 12,
      color: '#f5d49a',
      'text-background-color': dark ? '#22221f' : '#fcfcfa',
      'text-background-opacity': 1,
      'text-background-padding': '5px',
      width: 3,
      opacity: 1,
    },
  },
  {
    selector: '.panorama',
    style: {
      width: 15,
      height: 15,
      shape: 'ellipse',
      label: '',
      'background-color': 'data(color)',
      'background-image-opacity': 0,
    },
  },
  {
    selector: '.panorama[kind="matter"], .panorama[kind="system"]',
    style: {
      width: 60,
      height: 60,
      label: 'data(panoramaLabel)',
      'font-size': 52,
      'min-zoomed-font-size': 0,
      'background-image-opacity': 1,
      'background-color': dark ? '#292d24' : '#f6f7ed',
    },
  },
  { selector: '.dim', style: { opacity: 0.15 } },
  { selector: 'edge.near', style: { opacity: 0.9, width: 2 } },
  { selector: 'node.near', style: { opacity: 1, label: 'data(label)' } },
  {
    selector: 'edge[kind="REVISES"]',
    style: {
      'line-style': 'dashed',
      'line-color': '#b29d79',
      'target-arrow-color': '#b29d79',
    },
  },
  {
    selector: 'edge[kind="LIMITS"], edge[kind="REQUIRES_CONCURRENT"]',
    style: {
      'line-color': '#bb9667',
      'target-arrow-color': '#bb9667',
      'line-style': 'dashed',
      width: 2,
    },
  },
  {
    selector: 'node[kind="family"]',
    style: { 'background-opacity': 0.3, 'border-style': 'dashed' },
  },
  { selector: '.named', style: { label: 'data(label)' } },
  {
    selector: '.panorama:selected',
    style: { label: 'data(label)', width: 45, height: 45, 'font-size': 15 },
  },
  ...(macro ? [
    { selector: 'node', style: {
      shape: 'ellipse' as const, width: 'data(macroSize)', height: 'data(macroSize)',
      'background-color': 'data(color)', 'background-fill': 'solid' as const,
      'background-image-opacity': 0, 'border-width': 0, 'background-opacity': 1,
      label: '', 'font-size': 11, 'text-margin-y': 6, 'text-max-width': '135px',
      'min-zoomed-font-size': 7, 'text-background-opacity': 0.65,
    } },
    { selector: 'node[kind="classification"], node[kind="matter"], node.named, node.near, node.hovered', style: { label: 'data(label)' } },
    { selector: 'node:selected, node.hovered', style: { 'border-width': 2, 'border-color': dark ? '#e4ebf5' : '#2e4771', label: 'data(label)' } },
    { selector: 'edge', style: { width: 1, opacity: 0.4, 'target-arrow-shape': 'none' as const, 'curve-style': 'bezier' as const } },
    { selector: 'edge[kind="CLASSIFIED_AS"], edge[kind="ATA_SUBCHAPTER"]', style: { 'line-style': 'dashed' as const, opacity: 0.32 } },
    { selector: 'edge[kind="MATTER_MATERIAL"], edge[kind="RELATED_MATERIAL"], edge[kind="WORK_ITEM_MEMBERSHIP"]', style: { 'line-color': '#369e8a', opacity: 0.7, width: 1.4 } },
    { selector: 'edge.dim', style: { opacity: 0.055, width: 0.8 } },
    { selector: 'edge.near, edge.hovered', style: { opacity: 1, width: 2 } },
  ] : []),
];
export default function AtlasGraph({
  graph,
  location,
  onSelect,
  onReady,
  onCamera,
  api,
  variant = 'default',
  ariaLabel = '工程关系图；右侧提供等价对象与关系列表',
}: {
  graph: Graph;
  location: AtlasLocation;
  onSelect: (id: string) => void;
  onReady: (ready: boolean) => void;
  onCamera: (pan: { x: number; y: number }, zoom: number) => void;
  api: React.MutableRefObject<Core | null>;
  /** Shared renderer; the macro caller supplies only authorized Host objects. */
  variant?: 'default' | 'macro';
  ariaLabel?: string;
}) {
  const { theme } = useWlTheme();
  const container = useRef<HTMLDivElement>(null);
  const layoutReady = useRef(false);
  const callbacks = useRef({ onSelect, onReady, onCamera });
  callbacks.current = { onSelect, onReady, onCamera };
  useEffect(() => {
    if (!container.current) return;
    layoutReady.current = false;
    callbacks.current.onReady(false);
    const start = performance.now();
    const palette = Object.fromEntries(
      Object.entries(icons.categories).map(([kind, value]) => [
        kind,
        value[theme],
      ]),
    );
    if (variant === 'macro') Object.assign(palette, theme === 'dark'
      ? { classification: '#d5b17b', family: '#b4b9cf', document: '#a2c6e2', matter: '#64c4b0' }
      : { classification: '#b78e55', family: '#8c91a7', document: '#6e99bb', matter: '#369e8a' });
    const degree = new Map<string, number>();
    graph.edges.forEach(edge => {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    });
    const positions =
      location.space === 'EXAMPLE' && location.view === 'panorama'
        ? layouts.panorama.positions
        : location.space === 'EXAMPLE' && location.view === 'network'
          ? layouts['document-network'].positions
          : null;
    const cy = cytoscape({
      container: container.current,
      style: styles(theme === 'dark', location.effect === 'compatible', variant === 'macro'),
      elements: [
        ...graph.nodes.map((n, index) => ({
          data: {
            ...n,
            label:
              ('exactDocument' in n && n.exactDocument) ||
              (location.space === 'HOST' && n.kind === 'document')
                ? `${n.code}${n.version ? `${variant === 'macro' ? ' · ' : '\n'}${n.version}` : ''}`
                : n.title,
            shape:
              ((icons.categories as Record<string, { shape: string }>)[n.kind]
                ?.shape === 'circle'
                ? 'ellipse'
                : (icons.categories as Record<string, { shape: string }>)[
                    n.kind
                  ]?.shape) ?? 'round-rectangle',
            color: palette[n.kind] ?? '#8d9eae',
            macroSize: 12 + Math.sqrt(Math.min(60, degree.get(n.id) ?? 0)) * 4,
            panoramaLabel: [
              'NAV-03',
              'ENG-04',
              'COM-05',
              'ELC-09',
              'FUEL-12',
              'APU-14',
              'FMC-01',
              'DSP-01',
            ].includes(n.code)
              ? n.code
              : '',
            icon: nodeIcon(n.kind, palette),
          },
          classes:
            (location.view === 'domain' ? 'domain-detail ' : '') +
            (location.view === 'domain' &&
            ((location.series &&
              location.series !== 'all' &&
              'series' in n &&
              n.series === 'UNKNOWN') ||
              (location.standard &&
                location.standard !== 'all' &&
                'standard' in n &&
                n.standard === 'UNKNOWN'))
              ? 'unknown '
              : '') +
            (location.view === 'panorama'
              ? 'panorama'
              : n.id === (location.focus || 'sb-r1') ||
                  n.workItemId === location.focus ||
                  (location.view === 'matter' && n.id === 'mf-a') ||
                  (location.view === 'domain' &&
                    n.id === (location.center || location.domain))
                ? 'primary'
                : ''),
          ...(positions && n.id in positions
            ? { position: positions[n.id as keyof typeof positions] }
            : variant === 'macro' ? { position: { x: Math.cos(index * 2.399963) * Math.sqrt(index + 1) * 45,
              y: Math.sin(index * 2.399963) * Math.sqrt(index + 1) * 45 } } : {}),
        })),
        ...graph.edges.map((e) => ({
          data: { ...e, label: atlasRelationLabel(e.kind) },
        })),
      ],
      layout: { name: 'preset' },
      wheelSensitivity: variant === 'macro' ? 1 : 0.25,
      minZoom: variant === 'macro' ? 0.05 : 0.035,
      maxZoom: 3,
      pixelRatio:
        location.effect === 'highest'
          ? Math.min(window.devicePixelRatio, 2)
          : 1,
    });
    api.current = cy;
    cy.on('tap', 'node,edge', (e) => callbacks.current.onSelect(e.target.id()));
    cy.on('pan zoom', () => { if (variant !== 'macro' || layoutReady.current) callbacks.current.onCamera(cy.pan(), cy.zoom()); });
    if (variant === 'macro') {
      cy.on('mouseover', 'node', event => event.target.closedNeighborhood().addClass('hovered'));
      cy.on('mouseout', 'node', () => cy.elements().removeClass('hovered'));
    }
    cy.one('layoutstop', () => {
      if (variant === 'macro' && cy.width() > cy.height()) {
        const bounds = cy.nodes().boundingBox({ includeLabels: false });
        // Orient the existing force result to the canvas. This only rotates
        // display coordinates; it never creates or hides a relation.
        if (bounds.h > bounds.w) {
          const cx = (bounds.x1 + bounds.x2) / 2, centerY = (bounds.y1 + bounds.y2) / 2;
          cy.batch(() => cy.nodes().forEach(node => {
            const position = node.position(); node.position({ x: position.y - centerY, y: cx - position.x });
          }));
          cy.fit(undefined, 45);
        }
      }
      container.current?.setAttribute(
        'data-render-ms',
        String(Math.round(performance.now() - start)),
      );
      layoutReady.current = true;
      callbacks.current.onReady(true);
    });
    cy.layout(
      location.layout && location.layout !== 'auto'
        ? {
            name: location.layout,
            animate: false,
            fit: true,
            padding: 55,
            nodeDimensionsIncludeLabels: true,
          }
        : positions
          ? { name: 'preset', fit: true, padding: 45 }
          : location.view === 'domain' && !location.expanded
            ? {
                name: 'concentric',
                fit: true,
                padding: 36,
                nodeDimensionsIncludeLabels: true,
                minNodeSpacing: 25,
                concentric: (n) =>
                  n.hasClass('primary')
                    ? 100
                    : n.data('kind') === 'matter'
                      ? 70
                      : 40,
                levelWidth: () => 30,
              }
            : ['documents', 'source', 'family'].includes(location.view)
              ? {
                  name: 'concentric',
                  fit: true,
                  padding: 45,
                  nodeDimensionsIncludeLabels: true,
                  minNodeSpacing: 30,
                  concentric: (n) => (n.hasClass('primary') ? 100 : 50),
                  levelWidth: () => 50,
                }
              : {
                  name: 'cose',
                  animate: false,
                  randomize: false,
                  nodeRepulsion: () => variant === 'macro' ? 8500 : 1800,
                  idealEdgeLength: () => variant === 'macro' ? 90 : 50,
                  gravity: variant === 'macro' ? 0.5 : 1.1,
                  componentSpacing: 75,
                  fit: true,
                  padding: 55,
                  nodeDimensionsIncludeLabels: true,
                  numIter: location.effect === 'compatible' ? 100 : 350,
                },
    ).run();
    if (!graph.nodes.length) {
      layoutReady.current = true;
      callbacks.current.onReady(true);
    }
    const resize = new ResizeObserver(() => cy.resize());
    resize.observe(container.current);
    return () => {
      layoutReady.current = false;
      callbacks.current.onReady(false);
      resize.disconnect();
      cy.stop();
      cy.destroy();
      api.current = null;
    };
  }, [
    graph,
    location.space,
    location.view,
    location.effect,
    location.layout,
    theme,
    api,
    variant,
  ]);
  useEffect(() => onReady(layoutReady.current), [onReady]);
  useEffect(() => {
    const cy = api.current;
    if (!cy) return;
    cy.elements().unselect();
    cy.elements().removeClass('dim near');
    if (location.selected) {
      const target: cytoscape.CollectionReturnValue = cy
        .elements()
        .filter((element) => element.id() === location.selected);
      target.select();
      if (target.length) {
        const neighborhood = target
          .nodes()
          .closedNeighborhood()
          .union(target)
          .union(target.edges().connectedNodes());
        cy.elements().difference(neighborhood).addClass('dim');
        neighborhood.addClass('near');
      }
    }
  }, [location.selected, graph, theme, api]);
  useEffect(() => {
    api.current?.elements().toggleClass('named', !!location.allLabels);
  }, [location.allLabels, graph, theme, api]);
  return (
    <div
      className="atlas-graph"
      ref={container}
      role="img"
      tabIndex={0}
      onPointerDown={(event) => event.currentTarget.focus()}
      aria-label={ariaLabel}
      data-atlas-target="graph"
    />
  );
}
