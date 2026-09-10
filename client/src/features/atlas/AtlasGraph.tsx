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
const styles = (dark: boolean, compatible: boolean): StylesheetJson => [
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
];
export default function AtlasGraph({
  graph,
  location,
  onSelect,
  onReady,
  onCamera,
  api,
}: {
  graph: Graph;
  location: AtlasLocation;
  onSelect: (id: string) => void;
  onReady: (ready: boolean) => void;
  onCamera: (pan: { x: number; y: number }, zoom: number) => void;
  api: React.MutableRefObject<Core | null>;
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
    const positions =
      location.space === 'EXAMPLE' && location.view === 'panorama'
        ? layouts.panorama.positions
        : location.space === 'EXAMPLE' && location.view === 'network'
          ? layouts['document-network'].positions
          : null;
    const cy = cytoscape({
      container: container.current,
      style: styles(theme === 'dark', location.effect === 'compatible'),
      elements: [
        ...graph.nodes.map((n) => ({
          data: {
            ...n,
            label:
              ('exactDocument' in n && n.exactDocument) ||
              (location.space === 'HOST' && n.kind === 'document')
                ? `${n.code}\n${n.version ?? ''}`
                : n.title,
            shape:
              ((icons.categories as Record<string, { shape: string }>)[n.kind]
                ?.shape === 'circle'
                ? 'ellipse'
                : (icons.categories as Record<string, { shape: string }>)[
                    n.kind
                  ]?.shape) ?? 'round-rectangle',
            color: palette[n.kind] ?? '#8d9eae',
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
            : {}),
        })),
        ...graph.edges.map((e) => ({
          data: { ...e, label: atlasRelationLabel(e.kind) },
        })),
      ],
      layout: { name: 'preset' },
      wheelSensitivity: 0.25,
      minZoom: 0.035,
      maxZoom: 3,
      pixelRatio:
        location.effect === 'highest'
          ? Math.min(window.devicePixelRatio, 2)
          : 1,
    });
    api.current = cy;
    cy.on('tap', 'node,edge', (e) => callbacks.current.onSelect(e.target.id()));
    cy.on('pan zoom', () => callbacks.current.onCamera(cy.pan(), cy.zoom()));
    cy.one('layoutstop', () => {
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
                  nodeRepulsion: () => 1800,
                  idealEdgeLength: () => 50,
                  gravity: 1.1,
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
      aria-label="工程关系图；右侧提供等价对象与关系列表"
      data-atlas-target="graph"
    />
  );
}
