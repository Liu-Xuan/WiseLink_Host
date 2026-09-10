import fixture from './data/example.json';
import { exampleUnderstanding } from './example-assessment';
import type {
  AtlasGraph,
  AtlasLocation,
  AtlasNode,
  AtlasEdge,
} from './atlas-model';

type ExampleNode = AtlasNode & {
  bucket: string;
  domainIds: string[];
  matterIds: string[];
  afterOnly?: boolean;
  detailOnly?: boolean;
  state: string;
  tier?: number;
  series?: string;
  standard?: string;
  familyId?: string;
  anchorEligible?: boolean;
};
export const exampleEdges = fixture.edges;
export const exampleNodes: ExampleNode[] = fixture.nodes;
export const exampleSources: Record<
  string,
  { title: string; text: string; section: string; revision: string }
> = fixture.sources;
export function readExample(location: AtlasLocation): AtlasGraph {
  const focus = location.focus || 'sb-r1';
  let nodes = exampleNodes.filter(
    (n) =>
      (!n.afterOnly || location.afterSnapshot) &&
      (!n.detailOnly || location.view === 'evidence') &&
      (location.showDiscoveries || n.state !== 'discovered'),
  );
  let edges: (AtlasEdge & { bucket?: string })[] = fixture.edges.filter(
    (e) =>
      (!('afterOnly' in e && e.afterOnly) || location.afterSnapshot) &&
      (!('beforeOnly' in e && e.beforeOnly) ||
        !location.afterSnapshot ||
        location.history) &&
      (!('detailOnly' in e && e.detailOnly) || location.view === 'evidence') &&
      (location.showDiscoveries || e.state !== 'discovered'),
  );
  if (location.view === 'documents' || location.view === 'source') {
    const ids = new Set([focus]);
    edges
      .filter(
        (e) =>
          (e.source === focus || e.target === focus) &&
          e.bucket === 'documents' &&
          (location.history || e.kind !== 'REVISES') &&
          e.kind !== 'HAS_VERSION' &&
          e.kind !== 'CONTAINS' &&
          e.kind !== 'CONCERNS' &&
          (location.showAttachments !== false || e.kind !== 'HAS_ATTACHMENT') &&
          (location.showDerived ||
            !['HAS_TRANSLATION', 'HAS_ASSESSMENT'].includes(e.kind)) &&
          (location.showMissing !== false ||
            exampleNodes.find((n) => n.id === e.target)?.kind !==
              'reference') &&
          (location.lens !== 'outgoing' || e.source === focus) &&
          (location.lens !== 'incoming' ||
            (e.target === focus && e.kind === 'REFERS_TO')),
      )
      .forEach((e) => {
        ids.add(e.source);
        ids.add(e.target);
      });
    nodes = nodes.filter((n) => ids.has(n.id));
  } else if (location.view === 'network') {
    const families = Object.values(fixture.families);
    nodes = families
      .map((f) => exampleNodes.find((n) => n.id === f.id))
      .filter((n): n is ExampleNode => !!n);
    const familyIds = new Set(nodes.map((n) => n.id));
    const aggregates = new Map<string, AtlasEdge>();
    for (const edge of edges.filter(
      (e) => e.kind === 'REFERS_TO' && e.bucket === 'documents',
    )) {
      const a = exampleNodes.find((n) => n.id === edge.source)?.familyId;
      const b = exampleNodes.find((n) => n.id === edge.target)?.familyId;
      if (!a || !b || a === b || !familyIds.has(a) || !familyIds.has(b))
        continue;
      const id = `projection:${a}:${b}`;
      const old = aggregates.get(id);
      if (old) {
        old.memberEdgeRefs?.push(edge.id);
        old.sourceRefs.push(...edge.sourceRefs);
      } else
        aggregates.set(id, {
          id,
          source: a,
          target: b,
          kind: 'FAMILY_REFERENCES',
          memberEdgeRefs: [edge.id],
          sourceRefs: [...edge.sourceRefs],
          explanation: '目录内版本级引用的显示聚合；展开核对确切版本。',
        });
    }
    edges = [...aggregates.values()];
  } else if (location.view === 'family') {
    const family = nodes.find((n) => n.id === focus)?.familyId;
    nodes = nodes.filter((n) => n.familyId === family || n.id === family);
    const ids = new Set(nodes.map((n) => n.id));
    edges
      .filter((e) => e.kind === 'HAS_ATTACHMENT' && ids.has(e.source))
      .forEach((e) => {
        const n = exampleNodes.find((n) => n.id === e.target);
        if (n) nodes.push(n);
      });
  } else if (location.view === 'domain')
    nodes = nodes.filter(
      (n) =>
        (n.domainIds.includes(location.domain) &&
          n.bucket !== 'documents' &&
          (!n.tier || location.expanded)) ||
        n.id === 'fmc' ||
        n.id === 'display',
    );
  else if (['matter', 'evidence'].includes(location.view)) {
    const matter = exampleNodes.some(
      (n) => n.kind === 'matter' && n.id === focus,
    )
      ? focus
      : 'mf-a';
    nodes = nodes.filter(
      (n) =>
        (n.id === matter || n.matterIds.includes(matter)) &&
        (!n.tier || location.expanded),
    );
    if (matter === 'mf-a')
      for (const id of ['sb-r1', 'assessment-r1', 'note-r1']) {
        const node = exampleNodes.find((n) => n.id === id);
        if (node && !nodes.some((n) => n.id === id)) nodes.push(node);
      }
  } else if (location.view !== 'panorama') nodes = [];
  if (location.view === 'evidence') {
    const claims = new Set(
      nodes.filter((n) => n.kind === 'insight').map((n) => n.id),
    );
    edges = edges.filter(
      (e) =>
        ['SUPPORTS', 'LIMITS', 'CHANGES', 'HAS_ASSESSMENT'].includes(e.kind) &&
        claims.has(e.target),
    );
    const evidenceIds = new Set(edges.flatMap((e) => [e.source, e.target]));
    nodes = exampleNodes.filter((n) => evidenceIds.has(n.id));
  }
  if (
    location.view === 'domain' &&
    location.center &&
    location.center !== location.domain
  ) {
    const allowed = new Set(nodes.map((n) => n.id));
    const direct = edges.filter(
      (e) =>
        (e.source === location.center || e.target === location.center) &&
        allowed.has(e.source) &&
        allowed.has(e.target),
    );
    const keep = new Set([
      location.center,
      location.domain,
      ...direct.flatMap((e) => [e.source, e.target]),
    ]);
    const matters = new Set(
      nodes
        .filter((n) => keep.has(n.id) && n.kind === 'matter')
        .map((n) => n.id),
    );
    nodes = nodes.filter(
      (n) => keep.has(n.id) || n.matterIds.some((id) => matters.has(id)),
    );
  }
  if (location.view === 'domain' && !location.expanded && !location.center) {
    const overview = new Set([
      'fmc',
      'display',
      'hw-a',
      'std-a',
      'std-b',
      'shared-note',
      'mf-a',
      'mf-b',
      'mf-c',
      'md-a',
      'record-a-node',
      'record-u-node',
      'claim-x',
      'doc-x',
      'doc-y',
      'display-doc',
      'display-claim',
    ]);
    nodes = nodes.filter((n) => overview.has(n.id));
  }
  if (location.view === 'panorama')
    nodes = nodes.filter(
      (n) =>
        n.bucket !== 'documents' ||
        ['document', 'family', 'reference'].includes(n.kind),
    );
  if (location.view === 'domain')
    nodes = nodes.filter((n) => {
      if (n.anchorEligible && n.kind === 'system') return true;
      let unknown = false;
      for (const [key, choice] of [
        ['series', location.series],
        ['standard', location.standard],
      ] as const) {
        if (!choice || choice === 'all') continue;
        const value = n[key];
        if (!value || value === 'UNKNOWN') unknown = true;
        else if (value !== 'BOTH' && value !== choice) return false;
      }
      return !unknown || location.includeUnknown !== false;
    });
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) =>
      n.id === 'mf-a'
        ? {
            ...n,
            summary: location.afterSnapshot
              ? exampleUnderstanding.revised
              : exampleUnderstanding.initial,
          }
        : n,
    ),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    notices: ['独立构造样例；不代表 OEM 指令、实际机队状态或已批准结论。'],
  };
}
