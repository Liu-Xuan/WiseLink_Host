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
import cytoscape, { type Core, type ElementDefinition, type EventObject, type StylesheetStyle } from 'cytoscape';
import { AlertTriangle, ClipboardList, Clock, Database, FileText, FolderOpen, Lightbulb, Network, type LucideIcon } from 'lucide-react';
import type { CytoscapeSuiteElement, SuiteGraphPresentation } from './suite-graph-model';
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

const GROUP_TONES: Record<string, string> = {
  fulfilled: '#25a06c',
  inputs: '#2a9d93',
  questions: '#d65c68',
  evidence: '#8b6fc9',
  claims: '#4f83d6',
  MEMBER: '#2a9d93',
  RELATED: '#64748b',
  EXPECTED: '#b45309',
  catalog: '#64748b',
  statements: '#b45309',
  matters: '#4f83d6',
  documents: '#25a06c',
  unclassified: '#8a8a8a',
};
const GROUP_ICONS: Record<string, LucideIcon> = {
  fulfilled: FileText,
  inputs: Database,
  questions: AlertTriangle,
  evidence: ClipboardList,
  claims: Lightbulb,
  MEMBER: FileText,
  RELATED: FolderOpen,
  EXPECTED: FolderOpen,
  catalog: FolderOpen,
  statements: Clock,
  matters: Network,
  documents: FileText,
  unclassified: FolderOpen,
};
const FALLBACK_TONE = '#4f83d6';
const NARROW_ENTRY_MAX_WIDTH = 760;
const NARROW_ENTRY_ZOOM = 0.85;
const NARROW_FOCUS_PADDING = 28;
const NARROW_READABLE_MIN_ZOOM = 0.55;
const NARROW_LAYOUT_QUERY = `(max-width: ${NARROW_ENTRY_MAX_WIDTH}px)`;

function clampZoom(level: number, cy: Core): number {
  return Math.max(cy.minZoom(), Math.min(cy.maxZoom(), level));
}

function isNarrowLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_LAYOUT_QUERY).matches;
}

function toneFor(groupKey: string, declaredTone: string): string {
  return declaredTone || GROUP_TONES[groupKey] || FALLBACK_TONE;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

interface ThemeTokens {
  ink: string;
  muted: string;
  faint: string;
  surface: string;
}

function readThemeTokens(scope?: HTMLElement): ThemeTokens {
  const computed = typeof getComputedStyle === 'function'
    ? getComputedStyle(scope ?? document.documentElement)
    : null;
  const read = (name: string, fallback: string): string => computed?.getPropertyValue(name).trim() || fallback;
  return {
    ink: read('--wl-ink', '#242424'),
    muted: read('--wl-muted', '#666666'),
    faint: read('--wl-faint', '#8a8a8a'),
    surface: read('--wl-surface-solid', '#ffffff'),
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
        'control-point-step-size': 70,
        'line-color': tokens.faint,
        'target-arrow-color': tokens.faint,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.55,
        opacity: 0.3,
        label: 'data(label)',
        color: tokens.muted,
        'font-size': '9.5px',
        'text-background-color': tokens.surface,
        'text-background-opacity': 0.8,
        'text-background-padding': '3px',
        'text-rotation': 'none',
        'overlay-opacity': 0,
      },
    },
    { selector: '.bundle-edge', style: { opacity: 0.62 } },
    { selector: '.business-edge', style: { width: 1.7, opacity: 0.68 } },
  ];
  Object.entries(GROUP_TONES).forEach(([key, tone]) => {
    sheets.push({
      selector: `edge[groupKey = "${key}"]`,
      style: { 'line-color': tone, 'target-arrow-color': tone, opacity: 0.68 },
    });
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

function asElements(elements: CytoscapeSuiteElement[]): ElementDefinition[] {
  return elements as ElementDefinition[];
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
  const tone = toneFor(groupKey, text(data.color));
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
  const Icon = GROUP_ICONS[groupKey] ?? FileText;
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

const SuiteGraphCanvas = forwardRef<SuiteGraphCanvasHandle, SuiteGraphCanvasProps>(function SuiteGraphCanvas(
  { presentation, initialViewport, selectedId, focusGroupKey, onSelect, onGroup, onOverflow, onInspectRelationships, onViewport, className, ariaLabel = '关系图谱' },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const callbacksRef = useRef({ onSelect, onGroup, onOverflow, onInspectRelationships, onViewport });
  const [overlayNodes, setOverlayNodes] = useState<OverlayNode[]>([]);
  const [camera, setCamera] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
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
      userCameraRef.current = true;
      cyRef.current?.fit(undefined, 24);
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
        }
      });
      cy.fit(undefined, 24);
    },
    setViewport: (viewport) => {
      const cy = cyRef.current;
      if (!cy) return;
      if (viewport && Number.isFinite(viewport.zoom) && Number.isFinite(viewport.pan?.x) && Number.isFinite(viewport.pan?.y)) {
        userCameraRef.current = true;
        cy.zoom(Math.max(cy.minZoom(), Math.min(cy.maxZoom(), viewport.zoom)));
        cy.pan({ x: viewport.pan.x, y: viewport.pan.y });
      } else {
        userCameraRef.current = false;
        cy.fit(undefined, 24);
      }
    },
    getCore: () => cyRef.current,
  }), []);

  const applyNarrowFocus = useCallback((cy: Core) => {
    const focusGroup = focusGroupKeyRef.current;
    if (focusGroup) {
      const collection = cy.nodes().filter((node) => String(node.data('groupKey')) === focusGroup || String(node.data('viewKind')) === 'hub');
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
    const currentSelection = selectedIdRef.current;
    const focus = (currentSelection
      ? elementsRef.current.find((element) => element.group === 'nodes' && (element.data.businessId === currentSelection || element.data.id === currentSelection))
      : undefined)
      ?? elementsRef.current.find((element) => element.group === 'nodes' && element.data.viewKind === 'hub')
      ?? elementsRef.current.find((element) => element.group === 'nodes');
    const node = focus ? cy.getElementById(String(focus.data.id)) : null;
    if (node && node.length) {
      cy.zoom(clampZoom(NARROW_ENTRY_ZOOM, cy));
      cy.center(node);
    } else {
      cy.fit(undefined, 24);
    }
  }, []);

  const applyAutoCamera = useCallback((cy: Core) => {
    internalCameraRef.current = true;
    if (isNarrowLayout()) applyNarrowFocus(cy);
    else cy.fit(undefined, 24);
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
    const sync = () => {
      const next = cy.nodes().map((node) => ({ id: node.id(), data: node.data() as Record<string, unknown>, position: node.renderedPosition() }));
      setOverlayNodes(next);
      const nextCamera = { zoom: cy.zoom(), pan: cy.pan() };
      setCamera(nextCamera);
      if (cameraReadyRef.current && !internalCameraRef.current) callbacksRef.current.onViewport?.(nextCamera);
    };
    cy.on('render resize pan zoom', sync);
    cy.on('tap', 'edge', (event: EventObject) => {
      const ids = event.target.data('relationshipIds');
      if (Array.isArray(ids)) callbacksRef.current.onInspectRelationships?.(ids.filter((id): id is string => typeof id === 'string'));
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
      themeObserver?.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      mount.removeEventListener('wheel', markUserCamera);
      mount.removeEventListener('pointerdown', markUserCamera);
      cy.removeAllListeners();
      cy.destroy();
      cyRef.current = null;
    };
  }, [applyAutoCamera]);

  useEffect(() => {
    userCameraRef.current = false;
  }, [focusGroupKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    cy.add(asElements(presentation.elements));
    elementsRef.current = presentation.elements;
    const positions = Object.fromEntries(presentation.elements.filter((element) => element.group === 'nodes').map((element) => [String(element.data.id), element.position]));
    if (motionDisabled()) {
      const elements = cy.elements();
      if (typeof elements.stop === 'function') elements.stop();
    }
    cy.layout({ name: 'preset', positions, fit: false, animate: !motionDisabled(), animationDuration: 320 }).run();
    internalCameraRef.current = true;
    const restore = initialViewportRef.current;
    if (!initialViewportAppliedRef.current && restore && Number.isFinite(restore.zoom) && Number.isFinite(restore.pan.x) && Number.isFinite(restore.pan.y)) {
      cy.zoom(Math.max(cy.minZoom(), Math.min(cy.maxZoom(), restore.zoom)));
      cy.pan({ x: restore.pan.x, y: restore.pan.y });
      initialViewportAppliedRef.current = true;
      userCameraRef.current = true;
    } else if (!userCameraRef.current) {
      applyAutoCamera(cy);
    }
    internalCameraRef.current = false;
    cameraReadyRef.current = true;
    callbacksRef.current.onViewport?.({ zoom: cy.zoom(), pan: cy.pan() });
  }, [presentation, applyAutoCamera]);

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
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    callbacksRef.current.onSelect?.(data, false);
  };
  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    const cy = cyRef.current;
    const mount = mountRef.current;
    if (!cy || !mount) return;
    const target = cy.getElementById(id);
    if (!target.length) return;
    const start = { x: event.clientX, y: event.clientY };
    dragRef.current = { id, moved: false };
    const move = (next: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (Math.hypot(next.clientX - start.x, next.clientY - start.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      suppressClickRef.current = true;
      const rect = mount.getBoundingClientRect();
      const pan = cy.pan();
      const zoom = cy.zoom();
      target.position({ x: (next.clientX - rect.left - pan.x) / zoom, y: (next.clientY - rect.top - pan.y) / zoom });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
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
