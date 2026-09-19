// Adapter to transform current graph data format to Suite's "matter" format
import type { GraphData } from '../types';

export interface MatterGroup {
  key: string;
  title: string;
  color: string;
  relation?: string;
  columns?: number;
  items: MatterItem[];
}

export interface MatterItem {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  isNew?: boolean;
  picture?: string;
}

export interface MatterRelation {
  id: string;
  source: string;
  target: string;
  kind: string;
  group: string;
  label?: string;
}

export interface Matter {
  id: string;
  title: string;
  code: string;
  picture?: string;
  groups: MatterGroup[];
  relations: MatterRelation[];
}

const COLOR_MAP: Record<string, string> = {
  document: 'blue',
  topic: 'green',
  person: 'amber',
  organization: 'rose',
  event: 'teal',
  location: 'purple',
};

const KIND_MAP: Record<string, string> = {
  document: 'document',
  file: 'file',
  record: 'record',
  chapter: 'chapter',
  topic: 'topic',
  component: 'component',
  question: 'question',
  work: 'work',
  event: 'event',
  discussion: 'discussion',
  configuration: 'configuration',
};

const GROUP_KEY_MAP: Record<string, string> = {
  document: 'documents',
  cluster: 'topics',
};

/**
 * Transform GraphData (React Flow format) to Matter (Cytoscape format)
 */
export function transformGraphDataToMatter(graphData: GraphData, workItemId: string = 'app_17bzc551rsg'): Matter {
  // Group nodes by type
  const groupMap = new Map<string, MatterItem[]>();
  const nodeGroupById = new Map<string, string>();
  const hubNode = graphData.nodes.find((node) => node.data.type === 'matter');

  graphData.nodes.forEach((node) => {
    // Skip special node types
    if (
      node.data.type === 'matter' ||
      node.data.type === 'more' ||
      node.data.type === 'documentGroup'
    ) {
      return;
    }

    // Determine group key from node type
    const groupKey = GROUP_KEY_MAP[node.data.type] ?? 'documents';
    nodeGroupById.set(node.id, groupKey);

    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, []);
    }

    const item: MatterItem = {
      id: node.id,
      title: 'title' in node.data ? String(node.data.title) : node.id,
      subtitle: 'brief' in node.data ? node.data.brief : '',
      kind: KIND_MAP[node.data.type as string] || 'document',
      isNew: false,
    };

    groupMap.get(groupKey)!.push(item);
  });

  // Build groups array
  const groups: MatterGroup[] = [];
  const groupTitles: Record<string, string> = {
    documents: '相关文档',
    topics: '关联主题',
    persons: '相关人员',
    organizations: '相关组织',
    events: '相关事件',
    locations: '相关地点',
  };

  groupMap.forEach((items, key) => {
    groups.push({
      key,
      title: groupTitles[key] || key,
      color: COLOR_MAP[key] || 'blue',
      relation: '关联',
      columns: 1,
      items,
    });
  });

  // Transform edges to relations
  const relations: MatterRelation[] = graphData.edges.map((edge, index) => ({
    id: edge.id || `rel_${index}`,
    source: edge.source,
    target: edge.target,
    kind: edge.data?.type || 'related',
    group:
      nodeGroupById.get(edge.target) ??
      nodeGroupById.get(edge.source) ??
      'documents',
    label: edge.label,
  }));

  return {
    id: hubNode?.id || workItemId,
    title: hubNode && 'title' in hubNode.data ? String(hubNode.data.title) : '关系图谱',
    code: workItemId,
    groups,
    relations,
  };
}
