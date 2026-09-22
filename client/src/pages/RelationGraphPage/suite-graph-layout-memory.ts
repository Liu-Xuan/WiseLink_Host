import type { Core } from 'cytoscape';
import type { CytoscapeSuiteElement } from './suite-graph-model';

type Point = { x: number; y: number };
export interface SuiteGraphLayoutSnapshot {
  nodes: Array<{ id: string; base: Point; position: Point; w: number; h: number; baseW: number; baseH: number }>;
}
const entries = new Map<string, { scope: string; snapshot: SuiteGraphLayoutSnapshot; bytes: number; expires: number }>();
const MAX_BYTES = 1024 * 1024;
const TTL = 30 * 60 * 1000;
let activeSession: number | null = null;
const finitePoint = (point: Point) => [point.x, point.y].every(n => Number.isFinite(n) && Math.abs(n) <= 100000);

/** Display geometry only, never source data or an authorization decision. */
export function activateGraphLayoutSession(session: number, denied: boolean) {
  if (session !== activeSession || denied) entries.clear();
  activeSession = session;
}
export function saveGraphLayout(scope: string, snapshot: SuiteGraphLayoutSnapshot, previous?: string): string | undefined {
  for (const [key, entry] of entries) if (entry.expires <= Date.now()) entries.delete(key);
  if (!snapshot.nodes.length || snapshot.nodes.length > 512 || snapshot.nodes.some(node =>
    !node.id || node.id.length > 2048 || !finitePoint(node.base) || !finitePoint(node.position)
    || ![node.w, node.h, node.baseW, node.baseH].every(n => Number.isFinite(n) && n >= 0 && n <= 100000))) return undefined;
  const serialized = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > 256 * 1024) return undefined;
  const prior = previous ? entries.get(previous) : undefined;
  const key = previous && prior?.scope === scope && JSON.stringify(prior.snapshot) === serialized
    ? previous : `gl-${globalThis.crypto.randomUUID()}`;
  entries.delete(key);
  entries.set(key, { scope, snapshot: JSON.parse(serialized), bytes, expires: Date.now() + TTL });
  let total = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (entries.size > 8 || total > MAX_BYTES) {
    const oldest = entries.keys().next().value!;
    total -= entries.get(oldest)!.bytes;
    entries.delete(oldest);
  }
  return key;
}
export function readGraphLayout(key: string | undefined, scope: string): SuiteGraphLayoutSnapshot | undefined {
  if (!key) return undefined;
  const entry = entries.get(key);
  if (!entry || entry.scope !== scope) return undefined;
  if (entry.expires <= Date.now()) { entries.delete(key); return undefined; }
  entries.delete(key); entries.set(key, entry);
  return entry.snapshot;
}
export function captureGraphLayout(cy: Core, elements: CytoscapeSuiteElement[]): SuiteGraphLayoutSnapshot {
  return { nodes: elements.flatMap(element => {
    if (element.group !== 'nodes') return [];
    const live = cy.getElementById(String(element.data.id));
    if (!live.length) return [];
    return [{ id: String(element.data.id), base: { ...element.position }, position: { ...live.position() },
      w: Number(live.data('w') ?? 0), h: Number(live.data('h') ?? 0),
      baseW: Number(element.data.w ?? 0), baseH: Number(element.data.h ?? 0) }];
  }) };
}
export function restoreGraphLayout(cy: Core, elements: CytoscapeSuiteElement[], previous: CytoscapeSuiteElement[], snapshot: SuiteGraphLayoutSnapshot) {
  const existing = new Set(previous.map(element => String(element.data.id)));
  const saved = new Map(snapshot.nodes.map(node => [node.id, node]));
  const positions: Record<string, Point> = {};
  for (const element of elements) {
    if (element.group !== 'nodes' || existing.has(String(element.data.id))) continue;
    const node = saved.get(String(element.data.id));
    if (!node || node.base.x !== element.position.x || node.base.y !== element.position.y
      || node.baseW !== Number(element.data.w ?? 0) || node.baseH !== Number(element.data.h ?? 0)) continue;
    const live = cy.getElementById(node.id);
    if (!live.length) continue;
    positions[node.id] = { ...node.position };
    live.position(positions[node.id]);
    live.data('w', node.w); live.data('h', node.h);
  }
  return positions;
}
