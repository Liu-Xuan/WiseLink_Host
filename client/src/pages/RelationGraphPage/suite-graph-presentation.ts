import type {
  CytoscapeSuiteElement,
  SuiteGraphGroup,
  SuiteGraphGroupView,
  SuiteGraphMatter,
  SuiteGraphOverflow,
  SuiteGraphPresentation,
  SuiteGraphPresentationOptions,
  SuiteGraphRelation,
} from './suite-graph-model';
import { suiteGraphAppearance, type SuiteGraphAppearance } from './suite-graph-appearance';

const GROUP_ID = (key: string) => `sg:group:${key}`;
const ITEM_ID = (id: string) => `sg:item:${id}`;
const MORE_ID = (key: string) => `sg:more:${key}`;
const HUB_ID = (id: string) => `sg:hub:${id}`;
const HUB_POSITION = { x: 414, y: 329 };
const HUB_COLLISION_SIZE = 204;
const GROUP_COLLISION_GAP = 18;

function finiteInteger(value: number | undefined, fallback: number, minimum: number, maximum?: number): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.floor(value as number);
  if (maximum === undefined) return Math.max(minimum, integer);
  return Math.min(maximum, Math.max(minimum, integer));
}

const LAYOUTS: Record<number, Array<[number, number]>> = {
  1: [[702, 326]],
  2: [[128, 324], [702, 324]],
  3: [[414, 104], [128, 465], [702, 465]],
  4: [[128, 168], [702, 168], [128, 486], [702, 486]],
  5: [[128, 176], [414, 107], [702, 176], [244, 508], [626, 508]],
  6: [[128, 168], [414, 108], [702, 168], [128, 464], [414, 550], [702, 477]],
};

interface GroupForceBody {
  view: SuiteGraphGroupView;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function overlap(a: GroupForceBody, b: GroupForceBody): { x: number; y: number } {
  return {
    x: (a.view.w + b.view.w) / 2 + GROUP_COLLISION_GAP - Math.abs(a.x - b.x),
    y: (a.view.h + b.view.h) / 2 + GROUP_COLLISION_GAP - Math.abs(a.y - b.y),
  };
}

function pushApart(a: GroupForceBody, b: GroupForceBody, strength: number): boolean {
  const amount = overlap(a, b);
  if (amount.x <= 0 || amount.y <= 0) return false;
  if (amount.x < amount.y) {
    const direction = a.x === b.x ? (a.anchorX <= b.anchorX ? -1 : 1) : Math.sign(a.x - b.x);
    const force = (amount.x + 1) * strength;
    a.vx += direction * force;
    b.vx -= direction * force;
  } else {
    const direction = a.y === b.y ? (a.anchorY <= b.anchorY ? -1 : 1) : Math.sign(a.y - b.y);
    const force = (amount.y + 1) * strength;
    a.vy += direction * force;
    b.vy -= direction * force;
  }
  return true;
}

/**
 * Keep the reference composition while resolving dense groups as rectangular
 * force bodies. The center stays fixed and no relationship is interpreted as
 * a physics constraint.
 */
function relaxGroupViews(views: SuiteGraphGroupView[]): void {
  const bodies: GroupForceBody[] = views.map((view) => ({
    view,
    anchorX: view.x,
    anchorY: view.y,
    x: view.x,
    y: view.y,
    vx: 0,
    vy: 0,
  }));
  const hub: GroupForceBody = {
    view: {
      key: '__hub__', id: '__hub__', title: '', x: HUB_POSITION.x, y: HUB_POSITION.y,
      w: HUB_COLLISION_SIZE, h: HUB_COLLISION_SIZE, count: 1, visible: 1, overflow: 0,
    },
    anchorX: HUB_POSITION.x,
    anchorY: HUB_POSITION.y,
    x: HUB_POSITION.x,
    y: HUB_POSITION.y,
    vx: 0,
    vy: 0,
  };

  for (let tick = 0; tick < 120; tick += 1) {
    bodies.forEach((body) => {
      body.vx += (body.anchorX - body.x) * 0.025;
      body.vy += (body.anchorY - body.y) * 0.025;
    });
    for (let index = 0; index < bodies.length; index += 1) {
      for (let other = index + 1; other < bodies.length; other += 1) {
        pushApart(bodies[index], bodies[other], 0.12);
      }
      const body = bodies[index];
      const fixedHub = { ...hub };
      if (pushApart(body, fixedHub, 0.16)) {
        // The hub is pinned; transfer its equal-and-opposite response back.
        body.vx -= fixedHub.vx;
        body.vy -= fixedHub.vy;
      }
    }
    bodies.forEach((body) => {
      body.vx = Math.max(-18, Math.min(18, body.vx * 0.68));
      body.vy = Math.max(-18, Math.min(18, body.vy * 0.68));
      body.x += body.vx;
      body.y += body.vy;
    });
  }

  // Finish with deterministic non-penetration passes after the anchor springs.
  for (let pass = 0; pass < 40; pass += 1) {
    let moved = false;
    for (let index = 0; index < bodies.length; index += 1) {
      for (let other = index + 1; other < bodies.length; other += 1) {
        const a = bodies[index];
        const b = bodies[other];
        a.vx = a.vy = b.vx = b.vy = 0;
        if (pushApart(a, b, 0.5)) {
          a.x += a.vx;
          a.y += a.vy;
          b.x += b.vx;
          b.y += b.vy;
          moved = true;
        }
      }
      const body = bodies[index];
      const fixedHub = { ...hub };
      body.vx = body.vy = 0;
      if (pushApart(body, fixedHub, 1)) {
        body.x += body.vx - fixedHub.vx;
        body.y += body.vy - fixedHub.vy;
        moved = true;
      }
    }
    if (!moved) break;
  }

  bodies.forEach((body) => {
    body.view.x = Math.round(body.x);
    body.view.y = Math.round(body.y);
  });
}

function groupNode(group: SuiteGraphGroup, view: SuiteGraphGroupView): CytoscapeSuiteElement {
  const appearance = suiteGraphAppearance(group.key, group.color);
  return {
    group: 'nodes',
    data: {
      id: view.id,
      viewKind: 'halo',
      title: group.title,
      color: group.color,
      ...appearance,
      w: view.w,
      h: view.h,
      count: group.items.length,
      groupKey: group.key,
      rootKind: 'display',
      virtual: true,
    },
    position: { x: view.x, y: view.y },
    classes: 'visual-group',
    grabbable: false,
    selectable: false,
  };
}

function relationEdge(
  relation: SuiteGraphRelation,
  source: string,
  target: string,
  groupKey?: string,
  appearance: SuiteGraphAppearance = suiteGraphAppearance(groupKey ?? ''),
  curvature = 33,
): CytoscapeSuiteElement {
  return {
    group: 'edges',
    data: {
      id: `sg:relation:${relation.id}`,
      source,
      target,
      businessId: relation.id,
      businessSource: relation.source,
      businessTarget: relation.target,
      type: relation.type,
      label: relation.label,
      viewKind: 'relationship',
      groupKey,
      ...appearance,
      curvature,
      virtual: false,
      relationshipIds: [relation.id],
    },
    classes: 'business-edge',
  };
}

function validateSuiteGraph(matter: SuiteGraphMatter): void {
  const groupKeys = new Set<string>();
  const itemIds = new Set<string>();
  if (matter.id.length === 0) throw new Error('Suite graph matter id must not be empty');
  for (const group of matter.groups) {
    if (groupKeys.has(group.key)) throw new Error(`Ambiguous suite graph group key: ${group.key}`);
    groupKeys.add(group.key);
    for (const item of group.items) {
      if (itemIds.has(item.id)) throw new Error(`Ambiguous suite graph item id: ${item.id}`);
      if (item.id === matter.id) throw new Error(`Suite graph root/item id collision: ${item.id}`);
      itemIds.add(item.id);
    }
  }
  const relationIds = new Set<string>();
  for (const relation of matter.relations) {
    if (relationIds.has(relation.id)) throw new Error(`Ambiguous suite graph relation id: ${relation.id}`);
    relationIds.add(relation.id);
  }
}

export function buildSuiteGraphPresentation(
  matter: SuiteGraphMatter,
  options: SuiteGraphPresentationOptions = {},
): SuiteGraphPresentation {
  validateSuiteGraph(matter);
  const hidden = new Set(options.hiddenGroups ?? []);
  const pageSize = finiteInteger(options.maxGroups, 6, 1, 6);
  const eligible = matter.groups.filter((group) => group.items.length > 0 && !hidden.has(group.key));
  const pageCount = Math.max(1, Math.ceil(eligible.length / pageSize));
  const page = Math.min(pageCount - 1, finiteInteger(options.page, 0, 0));
  const pageStart = page * pageSize;
  const groups = eligible.slice(pageStart, pageStart + pageSize);
  const omittedGroupKeys = eligible.filter((group) => !groups.includes(group)).map((group) => group.key);
  const overflow: SuiteGraphOverflow = {
    page,
    pageSize,
    totalGroups: eligible.length,
    displayedGroups: groups.length,
    omittedGroupKeys,
    hasMore: pageStart + groups.length < eligible.length,
  };
  const coords = LAYOUTS[groups.length] ?? LAYOUTS[6];
  const density = finiteInteger(options.density, 4, 1);
  const elements: CytoscapeSuiteElement[] = [];
  const views: SuiteGraphGroupView[] = [];
  const visibleItems = new Map<string, { group: SuiteGraphGroup; item: SuiteGraphGroup['items'][number] }>();
  const itemGroup = new Map<string, string>();
  const groupByKey = new Map(groups.map((group) => [group.key, group]));

  groups.forEach((group, index) => {
    const appearance = suiteGraphAppearance(group.key, group.color);
    group.items.forEach((item) => itemGroup.set(item.id, group.key));
    const columns = group.columns ?? 1;
    const cap = columns === 2 ? 6 : density;
    const shown = group.items.slice(0, cap);
    const extra = group.items.length - shown.length;
    const cardH = columns === 2 ? 80 : 84;
    const cardW = columns === 2 ? 118 : 216;
    const gap = 12;
    const rows = Math.ceil(shown.length / columns);
    const [x, y] = coords[index];
    const h = 36 + rows * cardH + Math.max(0, rows - 1) * gap + (extra ? 38 : 0) + 10;
    const view: SuiteGraphGroupView = {
      key: group.key,
      id: GROUP_ID(group.key),
      title: group.title,
      color: group.color,
      x,
      y,
      w: columns === 2 ? 258 : 236,
      h,
      count: group.items.length,
      visible: shown.length,
      overflow: extra,
    };
    views.push(view);
    elements.push(groupNode(group, view));
    shown.forEach((item, itemIndex) => {
      const cx = columns === 2 ? x + (itemIndex % 2 ? 64 : -64) : x;
      const cy = y - h / 2 + 36 + cardH / 2 + Math.floor(itemIndex / columns) * (cardH + gap);
      const id = ITEM_ID(item.id);
      visibleItems.set(item.id, { group, item });
      itemGroup.set(item.id, group.key);
      elements.push({
        group: 'nodes',
        data: {
          ...item,
          id,
          businessId: item.id,
          viewKind: 'item',
          groupKey: group.key,
          color: group.color,
          ...appearance,
          w: cardW,
          h: cardH,
          compact: columns === 2,
          virtual: false,
        },
        position: { x: cx, y: cy },
        classes: 'business-node',
        grabbable: true,
      });
    });
    if (extra > 0) {
      elements.push({
        group: 'nodes',
        data: {
          id: MORE_ID(group.key),
          rootKind: 'display',
          viewKind: 'more',
          title: '展开全部',
          count: extra,
          groupKey: group.key,
          color: group.color,
          ...appearance,
          w: cardW,
          h: 32,
          virtual: true,
        },
        position: { x, y: y - h / 2 + h - 27 },
        classes: 'visual-more',
        grabbable: false,
        selectable: false,
      });
    }
  });

  const anchors = new Map(views.map((view, index) => [view.key, { x: coords[index][0], y: coords[index][1] }]));
  relaxGroupViews(views);
  elements.forEach((element) => {
    if (element.group !== 'nodes') return;
    const groupKey = typeof element.data.groupKey === 'string' ? element.data.groupKey : '';
    const view = views.find((candidate) => candidate.key === groupKey);
    const anchor = anchors.get(groupKey);
    if (!view || !anchor) return;
    element.position = {
      x: element.position.x + view.x - anchor.x,
      y: element.position.y + view.y - anchor.y,
    };
  });

  elements.push({
    group: 'nodes',
    data: { id: HUB_ID(matter.id), ...(matter.rootKind === 'matter' ? { businessId: matter.id } : {}), rootKind: matter.rootKind, viewKind: 'hub', title: matter.title, code: matter.code, picture: matter.picture, w: 180, h: 180, virtual: matter.rootKind === 'display' },
    position: HUB_POSITION,
    classes: 'matter-root',
    grabbable: false,
  });

  const rootBusinessId = matter.rootKind === 'matter' ? matter.id : undefined;
  const visibleBusinessIds = new Set([...(rootBusinessId ? [rootBusinessId] : []), ...visibleItems.keys()]);
  const displayedBusinessIds = new Set([...(rootBusinessId ? [rootBusinessId] : []), ...itemGroup.keys()]);
  const individualRelations = matter.relations.filter((relation) => visibleBusinessIds.has(relation.source) && visibleBusinessIds.has(relation.target));
  const aggregatedRelations = matter.relations.filter((relation) => displayedBusinessIds.has(relation.source) && displayedBusinessIds.has(relation.target));
  const allItemGroups = new Map(matter.groups.flatMap((group) => group.items.map((item) => [item.id, group.key] as const)));
  const eligibleItemGroups = new Map(eligible.flatMap((group) => group.items.map((item) => [item.id, group.key] as const)));
  const omittedRelationships: SuiteGraphPresentation['omittedRelationships'] = [];
  const relationMode = options.relationMode ?? 'aggregated';
  const representedRelations = relationMode === 'individual' ? individualRelations : aggregatedRelations;
  // In aggregated mode individual edges remain present as a hidden selection
  // layer, so they are represented even though the visible bundle carries the
  // default relationship count.
  const representedIds = new Set([
    ...representedRelations.map((relation) => relation.id),
    ...(relationMode === 'aggregated' ? individualRelations.map((relation) => relation.id) : []),
  ]);
  const appearanceForGroup = (groupKey?: string): SuiteGraphAppearance => {
    const group = groupKey ? groupByKey.get(groupKey) : undefined;
    return suiteGraphAppearance(groupKey ?? '', group?.color);
  };
  matter.relations.forEach((relation) => {
    if (representedIds.has(relation.id)) return;
    const endpointIds = [relation.source, relation.target];
    if (endpointIds.some((id) => id !== rootBusinessId && !allItemGroups.has(id))) {
      omittedRelationships.push({ id: relation.id, reason: 'missingEndpoint' });
      return;
    }
    const unavailableItemIds = endpointIds.filter((id) => id !== rootBusinessId && !displayedBusinessIds.has(id));
    if (unavailableItemIds.some((id) => !eligibleItemGroups.has(id))) {
      omittedRelationships.push({ id: relation.id, reason: 'hiddenGroup' });
      return;
    }
    if (unavailableItemIds.some((id) => !groups.some((group) => group.key === eligibleItemGroups.get(id)))) {
      omittedRelationships.push({ id: relation.id, reason: 'offPage' });
      return;
    }
    omittedRelationships.push({ id: relation.id, reason: 'cardOverflow' });
  });
  if (relationMode === 'individual') {
    individualRelations.forEach((relation) => {
      const source = relation.source === rootBusinessId ? HUB_ID(matter.id) : ITEM_ID(relation.source);
      const target = relation.target === rootBusinessId ? HUB_ID(matter.id) : ITEM_ID(relation.target);
      const groupKey = itemGroup.get(relation.source) ?? itemGroup.get(relation.target);
      const curvature = relation.source === rootBusinessId || relation.target === rootBusinessId ? 0 : 33;
      elements.push(relationEdge(relation, source, target, groupKey, appearanceForGroup(groupKey), curvature));
    });
  } else {
    const bundles = new Map<string, { source: string; target: string; relations: SuiteGraphRelation[]; groupKey?: string }>();
    aggregatedRelations.forEach((relation) => {
      const source = relation.source === rootBusinessId ? HUB_ID(matter.id) : GROUP_ID(itemGroup.get(relation.source)!);
      const target = relation.target === rootBusinessId ? HUB_ID(matter.id) : GROUP_ID(itemGroup.get(relation.target)!);
      const key = JSON.stringify([source, target]);
      const bundle = bundles.get(key) ?? { source, target, relations: [], groupKey: itemGroup.get(relation.target) ?? itemGroup.get(relation.source) };
      bundle.relations.push(relation);
      bundles.set(key, bundle);
    });
    bundles.forEach((bundle) => {
      const ids = bundle.relations.map((relation) => relation.id);
      const sourceGroup = views.find((view) => view.id === bundle.source);
      const targetGroup = views.find((view) => view.id === bundle.target);
      const relativeX = targetGroup
        ? targetGroup.x - 414
        : sourceGroup
          ? sourceGroup.x - 414
          : 0;
      const curvature = sourceGroup && targetGroup
        ? Math.sign(targetGroup.x - sourceGroup.x) * 22
        : Math.sign(relativeX) * 22;
      const labels = new Set(bundle.relations.map((relation) => relation.label));
      elements.push({
        group: 'edges',
        data: {
          id: `sg:bundle:${JSON.stringify(ids)}`,
          source: bundle.source,
          target: bundle.target,
          viewKind: 'bundle',
          label: labels.size === 1 ? bundle.relations[0].label : '资料关联',
          relationshipIds: ids,
          groupKey: bundle.groupKey,
          ...appearanceForGroup(bundle.groupKey),
          curvature,
          virtual: true,
        },
        classes: 'bundle-edge',
      });
    });
    // Keep exact business edges as a hidden interaction layer. The default view
    // stays aggregated; selecting a node reveals only its real adjacent edges.
    individualRelations.forEach((relation) => {
      const source = relation.source === rootBusinessId ? HUB_ID(matter.id) : ITEM_ID(relation.source);
      const target = relation.target === rootBusinessId ? HUB_ID(matter.id) : ITEM_ID(relation.target);
      elements.push({
        ...relationEdge(
          relation,
          source,
          target,
          itemGroup.get(relation.source) ?? itemGroup.get(relation.target),
          appearanceForGroup(itemGroup.get(relation.source) ?? itemGroup.get(relation.target)),
          relation.source === rootBusinessId || relation.target === rootBusinessId ? 0 : 33,
        ),
        classes: 'business-edge individual-edge',
      });
    });
  }

  return {
    elements,
    groups: views,
    visibleIds: [...visibleBusinessIds],
    visibleItemIds: [...visibleItems.keys()],
    overflow,
    counts: {
      loaded: { groups: matter.groups.length, items: matter.groups.reduce((count, group) => count + group.items.length, 0), relationships: matter.relations.length },
      eligible: { groups: eligible.length, items: eligible.reduce((count, group) => count + group.items.length, 0) },
      page: { index: page, size: pageSize, count: groups.length, pageCount },
      shown: { groups: groups.length, items: visibleItems.size, cards: visibleItems.size },
      represented: { relationships: representedRelations.length },
    },
    omittedRelationships,
    bounds: (() => {
      const x1 = Math.min(HUB_POSITION.x - 102, ...views.map((view) => view.x - view.w / 2)) - 20;
      const y1 = Math.min(HUB_POSITION.y - 102, ...views.map((view) => view.y - view.h / 2)) - 20;
      const x2 = Math.max(HUB_POSITION.x + 102, ...views.map((view) => view.x + view.w / 2)) + 20;
      const y2 = Math.max(HUB_POSITION.y + 102, ...views.map((view) => view.y + view.h / 2)) + 20;
      return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
    })(),
  };
}

export { GROUP_ID, HUB_ID, ITEM_ID, MORE_ID };
