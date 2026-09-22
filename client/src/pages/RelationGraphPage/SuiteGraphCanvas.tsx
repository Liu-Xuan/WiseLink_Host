import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
  type NodeSingular,
  type StylesheetStyle,
} from 'cytoscape';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Database,
  FileText,
  Lightbulb,
  MessageSquareText,
  Network,
  Plane,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type {
  CytoscapeSuiteElement,
  CytoscapeSuiteNode,
  SuiteGraphPresentation,
} from './suite-graph-model';
import {
  suiteGraphAppearance,
  suiteGraphIconKind,
  type SuiteGraphIconKind,
  type SuiteGraphTone,
} from './suite-graph-appearance';
import './suite-graph-canvas.css';
import { Image } from '@client/src/components/ui/image';

export interface SuiteGraphCanvasProps {
  presentation: SuiteGraphPresentation;
  initialViewport?: { zoom: number; pan: { x: number; y: number } };
  selectedId?: string;
  focusGroupKey?: string | null;
  onSelect?: (data: Record<string, unknown>, isEdge: boolean) => void;
  onGroup?: (groupKey: string) => void;
  onOverflow?: (groupKey: string) => void;
  onInspectRelationships?: (relationshipIds: string[]) => void;
  onViewport?: (viewport: { zoom: number; pan: { x: number; y: number } }) => void;
  className?: string;
  ariaLabel?: string;
}

export interface SuiteGraphCanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** Apply an exact saved camera, or auto-fit when null (used on perspective switch). */
  setViewport: (viewport: { zoom: number; pan: { x: number; y: number } } | null) => void;
  getCore: () => Core | null;
}

interface OverlayNode {
  id: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

interface DragState {
  id: string;
  pointerId: number;
  moved: boolean;
  startPointer: { x: number; y: number };
  startPosition: { x: number; y: number };
  groupKey: string;
}

const ICONS: Record<SuiteGraphIconKind, LucideIcon> = {
  activity: Activity,
  book: BookOpen,
  claim: Lightbulb,
  component: CircleDot,
  configuration: SlidersHorizontal,
  document: FileText,
  input: Database,
  matter: Network,
  plane: Plane,
  question: AlertTriangle,
  record: ClipboardList,
  statement: Clock,
  topic: MessageSquareText,
  work: ClipboardCheck,
};
const NARROW_ENTRY_MAX_WIDTH = 760;
const NARROW_ENTRY_ZOOM = 0.85;
const NARROW_FOCUS_PADDING = 28;
const NARROW_READABLE_MIN_ZOOM = 0.55;
const DESKTOP_READABLE_MIN_ZOOM = 0.82;
const NARROW_LAYOUT_QUERY = `(max-width: ${NARROW_ENTRY_MAX_WIDTH}px)`;

function clampZoom(level: number, cy: Core): number {
  return Math.max(cy.minZoom(), Math.min(cy.maxZoom(), level));
}

function graphIntersectsViewport(cy: Core): boolean {
  const bounds = cy.elements().renderedBoundingBox();
  const width = cy.width();
  const height = cy.height();
  const measurements = [
    bounds.x1,
    bounds.y1,
    bounds.x2,
    bounds.y2,
    width,
    height,
  ];
  if (!measurements.every(Number.isFinite) || width <= 0 || height <= 0) return false;
  return bounds.x2 >= 0
    && bounds.y2 >= 0
    && bounds.x1 <= width
    && bounds.y1 <= height;
}

function isNarrowLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_LAYOUT_QUERY).matches;
}

function toneFor(groupKey: string, declaredTone: string, toneName: string): string {
  const normalizedColor = declaredTone.trim();
  const normalizedTone = toneName.trim();
  if (normalizedColor && !(['blue', 'green', 'amber', 'rose', 'teal', 'purple', 'neutral'] as string[]).includes(normalizedColor)) {
    return normalizedColor;
  }
  const appearance = suiteGraphAppearance(groupKey, normalizedTone || normalizedColor);
  return `var(--suite-graph-tone-${appearance.tone})`;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

interface ThemeTokens {
  ink: string;
  faint: string;
  surface: string;
  edgeLabel: string;
  fontFamily: string;
  tones: Record<SuiteGraphTone, string>;
}

function readThemeTokens(scope?: HTMLElement): ThemeTokens {
  const computed = typeof getComputedStyle === 'function'
    ? getComputedStyle(scope ?? document.documentElement)
    : null;
  const read = (name: string, fallback: string): string => computed?.getPropertyValue(name).trim() || fallback;
  return {
    ink: read('--wl-ink', '#242424'),
    faint: read('--wl-faint', '#8a8a8a'),
    surface: read('--wl-sheet', '#ffffff'),
    edgeLabel: read('--suite-graph-edge-label', '#7b8fa3'),
    fontFamily: read('--wl-font', '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'),
    tones: {
      blue: read('--suite-graph-tone-blue', '#3b7cd5'),
      green: read('--suite-graph-tone-green', '#249d89'),
      amber: read('--suite-graph-tone-amber', '#bb872f'),
      rose: read('--suite-graph-tone-rose', '#c9747b'),
      teal: read('--suite-graph-tone-teal', '#209ca9'),
      purple: read('--suite-graph-tone-purple', '#9578ce'),
      neutral: read('--suite-graph-tone-neutral', '#7d8ba1'),
    },
  };
}

function motionDisabled(): boolean {
  return document.documentElement.getAttribute('data-wl-motion') === 'off'
    || document.documentElement.getAttribute('data-wl-visual-mode') === 'compatible'
    || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function buildStyleSheet(tokens: ThemeTokens): StylesheetStyle[] {
  const sheets: StylesheetStyle[] = [
    {
      selector: 'node',
      style: {
        label: '',
        'background-opacity': 0,
        'border-width': 0,
        width: 'data(w)',
        height: 'data(h)',
        'overlay-opacity': 0,
      },
    },
    { selector: '.visual-group', style: { 'background-opacity': 0, 'border-width': 0, opacity: 0 } },
    { selector: '.matter-root', style: { shape: 'ellipse', 'background-opacity': 0 } },
    {
      selector: 'edge',
      style: {
        width: 1.15,
        'curve-style': 'unbundled-bezier',
        'control-point-distances': 'data(curvature)',
        'control-point-weights': 0.5,
        'line-color': tokens.faint,
        'target-arrow-color': tokens.faint,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.55,
        opacity: 0.3,
        label: 'data(label)',
        color: tokens.edgeLabel,
        'font-family': tokens.fontFamily,
        'font-size': '12px',
        'text-background-color': tokens.surface,
        'text-background-opacity': 0.88,
        'text-background-padding': '3px',
        'text-rotation': 'none',
        'text-margin-y': -5,
        'overlay-opacity': 0,
      },
    },
    { selector: '.bundle-edge', style: { width: 1.3, opacity: 0.68 } },
    { selector: '.business-edge', style: { width: 1, opacity: 0.28, 'font-size': '10px' } },
    { selector: '.suite-small-edge-label', style: { label: '' } },
  ];
  Object.entries(tokens.tones).forEach(([toneName, tone]) => {
    sheets.push({
      selector: `edge[tone = "${toneName}"]`,
      style: { 'line-color': tone, 'target-arrow-color': tone, opacity: 0.68 },
    });
  });
  sheets.push({
    selector: 'edge[color]',
    style: { 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', opacity: 0.68 },
  });
  sheets.push(
    { selector: '.suite-connected-edge', style: { width: 2.4, opacity: 0.92 } },
    { selector: '.suite-dimmed-edge', style: { opacity: 0.14 } },
    { selector: '.individual-edge', style: { display: 'none' } },
    { selector: '.individual-edge.suite-connected-edge', style: { display: 'element', opacity: 0.92 } },
    { selector: '.individual-edge.suite-dimmed-edge', style: { display: 'none', opacity: 0 } },
  );
  return sheets;
}

function cloneElements(elements: CytoscapeSuiteElement[]): ElementDefinition[] {
  return elements.map((element): ElementDefinition => element.group === 'nodes'
    ? {
      ...element,
      data: { ...element.data },
      position: { ...element.position },
    }
    : { ...element, data: { ...element.data } });
}

function finiteDimension(value: unknown): number {
  const dimension = Number(value);
  return Number.isFinite(dimension) ? dimension : 0;
}

function isSuiteNode(element: CytoscapeSuiteElement): element is CytoscapeSuiteNode {
  return element.group === 'nodes';
}

function updateGroupHalo(
  cy: Core,
  groupKey: string,
  baseline: CytoscapeSuiteElement[],
): void {
  if (!groupKey) return;
  const haloDefinition = baseline.find(
    (element) => element.group === 'nodes'
      && element.data.viewKind === 'halo'
      && element.data.groupKey === groupKey,
  );
  if (!haloDefinition || haloDefinition.group !== 'nodes') return;
  const baselineItems = baseline.filter(isSuiteNode).filter(
    (element) => element.data.viewKind === 'item' && element.data.groupKey === groupKey,
  );
  if (baselineItems.length === 0) return;
  const boundsFor = (
    items: Array<{ position: { x: number; y: number }; data: Record<string, unknown> }>,
  ) => items.reduce(
    (bounds, item) => {
      const halfWidth = finiteDimension(item.data.w) / 2;
      const halfHeight = finiteDimension(item.data.h) / 2;
      return {
        left: Math.min(bounds.left, item.position.x - halfWidth),
        right: Math.max(bounds.right, item.position.x + halfWidth),
        top: Math.min(bounds.top, item.position.y - halfHeight),
        bottom: Math.max(bounds.bottom, item.position.y + halfHeight),
      };
    },
    { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, top: Number.POSITIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY },
  );
  const baselineBounds = boundsFor(baselineItems);
  const haloHalfWidth = finiteDimension(haloDefinition.data.w) / 2;
  const haloHalfHeight = finiteDimension(haloDefinition.data.h) / 2;
  const insets = {
    left: baselineBounds.left - (haloDefinition.position.x - haloHalfWidth),
    right: haloDefinition.position.x + haloHalfWidth - baselineBounds.right,
    top: baselineBounds.top - (haloDefinition.position.y - haloHalfHeight),
    bottom: haloDefinition.position.y + haloHalfHeight - baselineBounds.bottom,
  };
  const liveItems: Array<{
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }> = [];
  cy.nodes().forEach((node: NodeSingular) => {
    if (node.data('viewKind') !== 'item' || node.data('groupKey') !== groupKey) return;
    liveItems.push({ position: node.position(), data: node.data() as Record<string, unknown> });
  });
  if (liveItems.length === 0) return;
  const liveBounds = boundsFor(liveItems);
  const left = liveBounds.left - insets.left;
  const right = liveBounds.right + insets.right;
  const top = liveBounds.top - insets.top;
  const bottom = liveBounds.bottom + insets.bottom;
  const halo = cy.getElementById(String(haloDefinition.data.id));
  if (!halo.length) return;
  halo.data('w', right - left);
  halo.data('h', bottom - top);
  halo.position({ x: (left + right) / 2, y: (top + bottom) / 2 });
}

function OverlayCard({
  node,
  selected,
  onSelect,
  onGroup,
  onOverflow,
  onDragStart,
}: {
  node: OverlayNode;
  selected: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>, data: Record<string, unknown>) => void;
  onGroup: (groupKey: string) => void;
  onOverflow: (groupKey: string) => void;
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>, id: string) => void;
}) {
  const data = node.data;
  const viewKind = text(data.viewKind);
  const groupKey = text(data.groupKey);
  const tone = toneFor(groupKey, text(data.color), text(data.tone));
  const title = text(data.title, viewKind === 'more' ? '展开全部' : '未命名');
  const subtitle = text(data.subtitle);
  const style = {
    '--tone': tone,
    '--suite-node-w': `${Number(data.w) || 120}px`,
    '--suite-node-h': `${Number(data.h) || 48}px`,
  } as CSSProperties;
  if (viewKind === 'halo') {
    return (
      <button type="button" className="suite-graph-overlay suite-graph-halo" style={style} onClick={() => onGroup(groupKey)} aria-label={`按 ${title} 过滤`}>
        <span className="suite-graph-cluster-heading">{title}<small>{Number(data.count) || 0}</small></span>
      </button>
    );
  }
  if (viewKind === 'more') {
    return (
      <button type="button" className="suite-graph-overlay suite-graph-more" style={style} onClick={() => onOverflow(groupKey)} aria-label={`展开全部，${Number(data.count) || 0} 项`}>
        <span aria-hidden="true">•••</span> 另有 {Number(data.count) || 0} 项 · 展开全部
      </button>
    );
  }
  if (viewKind === 'hub') {
    const picture = text(data.picture);
    return (
      <button type="button" className={`suite-graph-overlay suite-graph-hub${selected ? ' is-selected' : ''}`} style={style} onClick={(event) => onSelect(event, data)} aria-label={title}>
        <span className="suite-graph-hub-portrait" aria-hidden="true">{picture ? <Image src={picture} alt="" /> : <Network />}</span>
        <strong>{title}</strong>
        {text(data.code) && <small>{text(data.code)}</small>}
        <span className="suite-graph-hub-sub">工程事项 · 持续认识</span>
      </button>
    );
  }
  const Icon = ICONS[suiteGraphIconKind(text(data.kind), groupKey)];
  const picture = text(data.picture);
  return (
    <button
      type="button"
      className={`suite-graph-overlay suite-graph-node-card${data.compact ? ' is-compact' : ''}${selected ? ' is-selected' : ''}`}
      style={style}
      onPointerDown={(event) => onDragStart(event, node.id)}
      onClick={(event) => onSelect(event, data)}
      aria-label={subtitle ? `${title}，${subtitle}` : title}
    >
      {picture ? (
        <span className="suite-graph-node-picture" aria-hidden="true">
          <Image src={picture} alt="" />
        </span>
      ) : (
        <span className="suite-graph-node-icon" aria-hidden="true"><Icon /></span>
      )}
      <span className="suite-graph-node-copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
    </button>
  );
}

type GraphCamera = { zoom: number; pan: { x: number; y: number } };

function sameCamera(left: GraphCamera | null, right: GraphCamera): boolean {
  return left?.zoom === right.zoom && left.pan.x === right.pan.x && left.pan.y === right.pan.y;
}

function sameOverlayNodes(left: OverlayNode[], right: OverlayNode[]): boolean {
  return left.length === right.length && left.every((node, index) => {
    const next = right[index];
    return node.id === next.id && node.position.x === next.position.x
      && node.position.y === next.position.y
      && Object.keys(node.data).length === Object.keys(next.data).length
      && Object.keys(node.data).every((key) => Object.is(node.data[key], next.data[key]));
  });
}

const SuiteGraphCanvas = forwardRef<SuiteGraphCanvasHandle, SuiteGraphCanvasProps>(function SuiteGraphCanvas(
  { presentation, initialViewport, selectedId, focusGroupKey, onSelect, onGroup, onOverflow, onInspectRelationships, onViewport, className, ariaLabel = '关系图谱' },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const callbacksRef = useRef({ onSelect, onGroup, onOverflow, onInspectRelationships, onViewport });
  const [overlayNodes, setOverlayNodes] = useState<OverlayNode[]>([]);
  const [camera, setCamera] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const syncNowRef = useRef<(() => void) | null>(null);
  const publishedCameraRef = useRef<GraphCamera | null>(null);
  const publishViewport = useCallback((viewport: GraphCamera) => {
    if (sameCamera(publishedCameraRef.current, viewport)) return;
    publishedCameraRef.current = { zoom: viewport.zoom, pan: { ...viewport.pan } };
    callbacksRef.current.onViewport?.(viewport);
  }, []);
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<((cancelled: boolean) => void) | null>(null);
  const suppressClickRef = useRef<{ id: string; until: number } | null>(null);
  const internalCameraRef = useRef(false);
  const userCameraRef = useRef(false);
  const initialViewportAppliedRef = useRef(false);
  const initialViewportRef = useRef(initialViewport);
  const cameraReadyRef = useRef(false);
  const elementsRef = useRef<CytoscapeSuiteElement[]>([]);
  const selectedIdRef = useRef<string | undefined>(selectedId);
  const focusGroupKeyRef = useRef<string | null | undefined>(focusGroupKey);
  callbacksRef.current = { onSelect, onGroup, onOverflow, onInspectRelationships, onViewport };
  selectedIdRef.current = selectedId;
  focusGroupKeyRef.current = focusGroupKey;

  useImperativeHandle(ref, () => ({
    fit: () => {
      const cy = cyRef.current;
      if (!cy) return;
      userCameraRef.current = true;
      cy.resize();
      cy.fit(undefined, 24);
    },
    zoomBy: (factor) => {
      const cy = cyRef.current;
      if (!cy || !Number.isFinite(factor) || factor <= 0) return;
      userCameraRef.current = true;
      cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    },
    reset: () => {
      const cy = cyRef.current;
      if (!cy) return;
      userCameraRef.current = true;
      elementsRef.current.forEach((element) => {
        if (element.group !== 'nodes' || !element.position) return;
        const node = cy.getElementById(String(element.data.id));
        if (node.length && typeof node.position === 'function') {
          node.position(element.position);
          if (element.data.viewKind === 'halo') {
            node.data('w', element.data.w);
            node.data('h', element.data.h);
          }
        }
      });
      cy.resize();
      cy.fit(undefined, 24);
    },
    setViewport: (viewport) => {
      const cy = cyRef.current;
      if (!cy) return;
      if (viewport && Number.isFinite(viewport.zoom) && Number.isFinite(viewport.pan?.x) && Number.isFinite(viewport.pan?.y)) {
        cy.resize();
        cy.zoom(Math.max(cy.minZoom(), Math.min(cy.maxZoom(), viewport.zoom)));
        cy.pan({ x: viewport.pan.x, y: viewport.pan.y });
        if (graphIntersectsViewport(cy)) {
          userCameraRef.current = true;
        } else {
          userCameraRef.current = false;
          cy.fit(undefined, 24);
        }
      } else {
        userCameraRef.current = false;
        cy.resize();
        cy.fit(undefined, 24);
      }
    },
    getCore: () => cyRef.current,
  }), []);

  const applyNarrowFocus = useCallback((cy: Core) => {
    const focusGroup = focusGroupKeyRef.current;
    if (focusGroup) {
      const collection = cy.nodes().filter((node) => (
        node.data('viewKind') === 'item' && node.data('groupKey') === focusGroup
      ) || node.data('viewKind') === 'hub');
      if (collection.length > 0) {
        cy.fit(collection, NARROW_FOCUS_PADDING);
        const fitted = cy.zoom();
        if (!Number.isFinite(fitted) || fitted < NARROW_READABLE_MIN_ZOOM) {
          cy.zoom(clampZoom(NARROW_READABLE_MIN_ZOOM, cy));
          cy.center(collection);
        }
        return;
      }
    }
    const hub = elementsRef.current.find(
      (element) => element.group === 'nodes' && element.data.viewKind === 'hub',
    );
    const currentSelection = selectedIdRef.current;
    const focus = currentSelection
      ? elementsRef.current.find(
        (element) => element.group === 'nodes'
          && element.data.viewKind !== 'hub'
          && (element.data.businessId === currentSelection || element.data.id === currentSelection),
      )
      : undefined;
    const node = focus ? cy.getElementById(String(focus.data.id)) : null;
    if (node && node.length && currentSelection !== hub?.data.businessId) {
      cy.zoom(clampZoom(NARROW_ENTRY_ZOOM, cy));
      cy.center(node);
    } else {
      cy.fit(undefined, 24);
    }
  }, []);

  const applyAutoCamera = useCallback((cy: Core) => {
    internalCameraRef.current = true;
    if (isNarrowLayout()) applyNarrowFocus(cy);
    else {
      cy.fit(undefined, 24);
      if (cy.zoom() < DESKTOP_READABLE_MIN_ZOOM) {
        cy.zoom(clampZoom(DESKTOP_READABLE_MIN_ZOOM, cy));
        const selected = selectedIdRef.current;
        const focus = selected
          ? elementsRef.current.find((element) => element.group === 'nodes'
            && (element.data.businessId === selected || element.data.id === selected))
          : undefined;
        const node = focus
          ? cy.getElementById(String(focus.data.id))
          : cy.nodes('.matter-root');
        if (node.length) cy.center(node);
      }
    }
    internalCameraRef.current = false;
  }, [applyNarrowFocus]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const cy = cytoscape({
      container: mount,
      elements: [],
      layout: { name: 'preset', fit: false },
      minZoom: 0.16,
      maxZoom: 2.4,
      wheelSensitivity: 0.19,
      boxSelectionEnabled: false,
      style: buildStyleSheet(readThemeTokens(mount)),
    });
    let labelsHidden = false;
    let frame: number | null = null;
    let disposed = false;
    let lastNodes: OverlayNode[] = [];
    let lastCamera: GraphCamera | null = null;
    const sync = () => {
      if (disposed) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      const hideLabels = cy.zoom() < 0.9;
      if (labelsHidden !== hideLabels && typeof cy.edges === 'function') {
        labelsHidden = hideLabels;
        cy.edges().toggleClass('suite-small-edge-label', hideLabels);
      }
      // Cytoscape mutates data/positions in place; retain detached snapshots.
      const next = cy.nodes().map((node) => ({ id: node.id(), data: { ...node.data() } as Record<string, unknown>, position: { ...node.renderedPosition() } }));
      if (!sameOverlayNodes(lastNodes, next)) {
        lastNodes = next;
        setOverlayNodes(next);
      }
      const nextCamera = { zoom: cy.zoom(), pan: { ...cy.pan() } };
      if (!sameCamera(lastCamera, nextCamera)) {
        lastCamera = nextCamera;
        setCamera(nextCamera);
      }
      if (cameraReadyRef.current && !internalCameraRef.current) publishViewport(nextCamera);
    };
    const scheduleSync = () => {
      if (!disposed && frame === null) frame = window.requestAnimationFrame(sync);
    };
    syncNowRef.current = sync;
    cy.on('render resize pan zoom', scheduleSync);
    cy.on('tap', 'edge', (event: EventObject) => {
      const ids = event.target.data('relationshipIds');
      if (Array.isArray(ids)) callbacksRef.current.onInspectRelationships?.(ids.filter((id): id is string => typeof id === 'string'));
    });
    cy.on('tap', (event: EventObject) => {
      if (event.target !== cy || dragRef.current?.moved) return;
      const hub = elementsRef.current.find(
        (element) => element.group === 'nodes' && element.data.viewKind === 'hub',
      );
      if (hub) callbacksRef.current.onSelect?.(hub.data, false);
    });
    cyRef.current = cy;
    sync();
    const applyTheme = () => {
      if (motionDisabled()) {
        cy.stop();
        const elements = cy.elements();
        if (typeof elements.stop === 'function') elements.stop();
      }
      cy.style(buildStyleSheet(readThemeTokens(mount)));
    };
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(applyTheme)
      : null;
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-wl-theme', 'data-wl-visual-mode', 'data-wl-motion'] });
    const handleResize = () => { cy.resize(); if (!userCameraRef.current) applyAutoCamera(cy); };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    window.addEventListener('resize', handleResize);
    const markUserCamera = (event: Event) => { if ((event.target as HTMLElement | null)?.closest('.suite-graph-cy')) userCameraRef.current = true; };
    mount.addEventListener('wheel', markUserCamera, { passive: true });
    mount.addEventListener('pointerdown', markUserCamera, { passive: true });
    return () => {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      syncNowRef.current = null;
      cameraReadyRef.current = false;
      publishedCameraRef.current = null;
      dragCleanupRef.current?.(true);
      themeObserver?.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      mount.removeEventListener('wheel', markUserCamera);
      mount.removeEventListener('pointerdown', markUserCamera);
      cy.removeAllListeners();
      cy.destroy();
      cyRef.current = null;
    };
  }, [applyAutoCamera, publishViewport]);

  useEffect(() => {
    userCameraRef.current = false;
  }, [focusGroupKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    dragCleanupRef.current?.(true);
    cy.elements().remove();
    cy.add(cloneElements(presentation.elements));
    if (typeof cy.edges === 'function') {
      cy.edges().toggleClass('suite-small-edge-label', cy.zoom() < 0.9);
    }
    elementsRef.current = presentation.elements;
    const positions = Object.fromEntries(presentation.elements.filter((element) => element.group === 'nodes').map((element) => [String(element.data.id), element.position]));
    if (motionDisabled()) {
      const elements = cy.elements();
      if (typeof elements.stop === 'function') elements.stop();
    }
    cy.layout({ name: 'preset', positions, fit: false, animate: !motionDisabled(), animationDuration: 320 }).run();
    cy.resize();
    internalCameraRef.current = true;
    const restore = initialViewportRef.current;
    if (!initialViewportAppliedRef.current && restore && Number.isFinite(restore.zoom) && Number.isFinite(restore.pan.x) && Number.isFinite(restore.pan.y)) {
      cy.zoom(Math.max(cy.minZoom(), Math.min(cy.maxZoom(), restore.zoom)));
      cy.pan({ x: restore.pan.x, y: restore.pan.y });
      initialViewportAppliedRef.current = true;
      if (graphIntersectsViewport(cy)) {
        userCameraRef.current = true;
      } else {
        userCameraRef.current = false;
        cy.fit(undefined, 24);
      }
    } else if (!userCameraRef.current) {
      applyAutoCamera(cy);
    }
    internalCameraRef.current = false;
    cameraReadyRef.current = true;
    publishViewport({ zoom: cy.zoom(), pan: { ...cy.pan() } });
    syncNowRef.current?.();
  }, [presentation, applyAutoCamera, publishViewport]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('suite-selected');
    if (typeof cy.edges === 'function') {
      const edges = cy.edges();
      edges.removeClass('suite-connected-edge');
      edges.removeClass('suite-dimmed-edge');
    }
    const target = presentation.elements.find((element) => element.group === 'nodes' && (element.data.businessId === selectedId || element.data.id === selectedId));
    if (!target) return;
    cy.getElementById(String(target.data.id)).addClass('suite-selected');
    if (typeof cy.edges !== 'function') return;
    const targetGroupKey = target.data.groupKey;
    cy.edges().forEach((edge) => {
      const edgeKind = edge.data('viewKind');
      const connected = edgeKind === 'relationship'
          ? edge.source().id() === String(target.data.id)
            || edge.target().id() === String(target.data.id)
          : edgeKind === 'bundle'
          ? edge.source().id() === String(target.data.id)
            || edge.target().id() === String(target.data.id)
            || (typeof targetGroupKey === 'string'
              && (edge.source().data('groupKey') === targetGroupKey
                || edge.target().data('groupKey') === targetGroupKey))
          : edge.source().id() === String(target.data.id)
            || edge.target().id() === String(target.data.id);
      edge.addClass(connected ? 'suite-connected-edge' : 'suite-dimmed-edge');
    });
  }, [presentation, selectedId]);

  const handleOverlaySelect = (event: MouseEvent<HTMLButtonElement>, data: Record<string, unknown>) => {
    event.stopPropagation();
    const id = text(data.id);
    const suppressed = suppressClickRef.current;
    if (event.detail > 0 && suppressed?.id === id && Date.now() <= suppressed.until) {
      suppressClickRef.current = null;
      return;
    }
    suppressClickRef.current = null;
    callbacksRef.current.onSelect?.(data, false);
    const cy = cyRef.current;
    if (!cy || !id || data.viewKind === 'hub' || !isNarrowLayout() || userCameraRef.current) return;
    const target = cy.getElementById(id);
    if (!target.length) return;
    internalCameraRef.current = true;
    cy.zoom(clampZoom(NARROW_ENTRY_ZOOM, cy));
    cy.center(target);
    internalCameraRef.current = false;
    userCameraRef.current = true;
    publishViewport({ zoom: cy.zoom(), pan: { ...cy.pan() } });
    syncNowRef.current?.();
  };
  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    const cy = cyRef.current;
    const mount = mountRef.current;
    if (!cy || !mount) return;
    const target = cy.getElementById(id);
    if (!target.length) return;
    dragCleanupRef.current?.(true);
    const groupKey = text(target.data('groupKey'));
    const targetPosition = target.position();
    const drag: DragState = {
      id,
      pointerId: event.pointerId,
      moved: false,
      startPointer: { x: event.clientX, y: event.clientY },
      startPosition: { x: targetPosition.x, y: targetPosition.y },
      groupKey,
    };
    dragRef.current = drag;
    const move = (next: PointerEvent) => {
      const current = dragRef.current;
      if (!current || next.pointerId !== current.pointerId) return;
      if (Math.hypot(next.clientX - current.startPointer.x, next.clientY - current.startPointer.y) > 3) current.moved = true;
      if (!current.moved) return;
      const zoom = cy.zoom();
      target.position({
        x: current.startPosition.x + (next.clientX - current.startPointer.x) / zoom,
        y: current.startPosition.y + (next.clientY - current.startPointer.y) / zoom,
      });
      updateGroupHalo(cy, current.groupKey, elementsRef.current);
    };
    const finish = (cancelled: boolean) => {
      const current = dragRef.current;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      dragCleanupRef.current = null;
      if (!current) return;
      if (cancelled && current.moved) {
        target.position(current.startPosition);
        updateGroupHalo(cy, current.groupKey, elementsRef.current);
        suppressClickRef.current = null;
      } else if (current.moved) {
        suppressClickRef.current = { id: current.id, until: Date.now() + 250 };
      }
      dragRef.current = null;
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== dragRef.current?.pointerId) return;
      finish(false);
    };
    const cancel = (next: PointerEvent) => {
      if (next.pointerId !== dragRef.current?.pointerId) return;
      finish(true);
    };
    dragCleanupRef.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  };
  return (
    <div className={`suite-graph-canvas${className ? ` ${className}` : ''}`}>
      <div ref={mountRef} className="suite-graph-cy" role="img" aria-label={ariaLabel} />
      <div className="suite-graph-overlays">
        {overlayNodes.map((node) => (
          <div key={node.id} className="suite-graph-overlay-position" style={{ left: node.position.x, top: node.position.y, transform: `translate(-50%, -50%) scale(${camera.zoom})` }}>
            <OverlayCard
              node={node}
              selected={node.data.businessId === selectedId || node.id === selectedId}
              onSelect={handleOverlaySelect}
              onDragStart={handleDragStart}
              onGroup={(groupKey) => callbacksRef.current.onGroup?.(groupKey)}
              onOverflow={(groupKey) => callbacksRef.current.onOverflow?.(groupKey)}
            />
          </div>
        ))}
      </div>
      <div className="suite-graph-camera-status" aria-live="polite">{Math.round(camera.zoom * 100)}%</div>
    </div>
  );
});

export default SuiteGraphCanvas;
