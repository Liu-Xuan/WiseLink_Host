import type {
  CanonicalLibraryIndexNode,
  CanonicalLibraryIndexNodeKind,
  CanonicalLibraryIndexReadResponse,
} from '@shared/api.interface';
import type { ElementDefinition } from 'cytoscape';

export type RelationGraphMode = 'document' | 'workItem' | 'domain' | 'panorama';

export interface RelationGraphModeOption {
  value: RelationGraphMode;
  label: string;
  connected: boolean;
}

export const RELATION_GRAPH_MODES: RelationGraphModeOption[] = [
  { value: 'document', label: '文档', connected: true },
  { value: 'workItem', label: '事项', connected: true },
];

export interface RelationGraphNodeData {
  id: string;
  kind: CanonicalLibraryIndexNodeKind;
  label: string;
  detail: string;
  state: string;
  sourceRef: string;
  documentVersionId: string;
}

export const RELATION_GRAPH_KIND_LABELS: Record<CanonicalLibraryIndexNodeKind, string> = {
  WORK_ITEM: '事项', DOCUMENT: '文档', DOCUMENT_VERSION: '文档版本',
  PARSED_PACKAGE: '解析包', READER_QUERY: '来源定位', DYNAMIC_EVALUATION: '问题评估',
  ENGINEER_REVIEW: '工程师复核', OVERALL_SYNTHESIS: '整体综合', AEO_CANDIDATE: 'AEO 候选',
};

const DOCUMENT_MODE_KINDS: ReadonlySet<CanonicalLibraryIndexNodeKind> =
  new Set<CanonicalLibraryIndexNodeKind>(['DOCUMENT', 'DOCUMENT_VERSION', 'PARSED_PACKAGE', 'READER_QUERY']);
const WORK_ITEM_MODE_KINDS: ReadonlySet<CanonicalLibraryIndexNodeKind> =
  new Set<CanonicalLibraryIndexNodeKind>(['WORK_ITEM', 'DOCUMENT', 'DYNAMIC_EVALUATION', 'ENGINEER_REVIEW', 'OVERALL_SYNTHESIS', 'AEO_CANDIDATE']);

/** 投影 → cytoscape elements：节点按模式过滤，边由节点树 parentId 推导。 */
export function buildGraphElements(
  response: CanonicalLibraryIndexReadResponse,
  mode: RelationGraphMode,
): ElementDefinition[] {
  const kinds: ReadonlySet<CanonicalLibraryIndexNodeKind> | null =
    mode === 'document' ? DOCUMENT_MODE_KINDS : mode === 'workItem' ? WORK_ITEM_MODE_KINDS : null;
  if (!kinds) return [];
  const visible: CanonicalLibraryIndexNode[] = response.libraryIndex.nodes.filter(
    (node: CanonicalLibraryIndexNode) => kinds.has(node.kind),
  );
  const visibleIds: ReadonlySet<string> = new Set(visible.map((node: CanonicalLibraryIndexNode) => node.id));
  const elements: ElementDefinition[] = visible.map(
    (node: CanonicalLibraryIndexNode): ElementDefinition => ({
      data: {
        id: node.id, kind: node.kind, label: node.label,
        detail: node.detail,
        state: node.state,
        sourceRef: '',
        documentVersionId: response.document.documentVersionId,
      },
    }),
  );
  for (const node of visible) {
    if (node.parentId && visibleIds.has(node.parentId)) {
      elements.push({
        data: { id: `edge-${node.parentId}-${node.id}`, source: node.parentId, target: node.id },
      });
    }
  }
  return elements;
}

const DEEP_LINK_TARGET: Partial<Record<CanonicalLibraryIndexNodeKind, { node: string; tab: string }>> = {
  DOCUMENT: { node: 'reader', tab: 'source' },
  DOCUMENT_VERSION: { node: 'reader', tab: 'source' },
  PARSED_PACKAGE: { node: 'reader', tab: 'source' },
  READER_QUERY: { node: 'reader', tab: 'source' },
  WORK_ITEM: { node: 'assessment', tab: 'assessment' },
  DYNAMIC_EVALUATION: { node: 'assessment', tab: 'assessment' },
  ENGINEER_REVIEW: { node: 'assessment', tab: 'assessment' },
  OVERALL_SYNTHESIS: { node: 'overall', tab: 'overall' },
  AEO_CANDIDATE: { node: 'aeo', tab: 'aeo' },
};

/** 节点深链：文档/版本/来源侧 → reader 节点 source 页；问题侧 → assessment 页。 */
export function buildNodeDeepLink(workItemId: string, node: RelationGraphNodeData): string | null {
  const target: { node: string; tab: string } | undefined = DEEP_LINK_TARGET[node.kind];
  if (!target) return null;
  const params = new URLSearchParams();
  params.set('node', target.node);
  params.set('tab', target.tab);
  if (
    node.documentVersionId &&
    (node.kind === 'DOCUMENT' ||
      node.kind === 'DOCUMENT_VERSION' ||
      node.kind === 'PARSED_PACKAGE' ||
      node.kind === 'READER_QUERY')
  ) {
    params.set('documentVersionId', node.documentVersionId);
  }
  if (node.sourceRef) params.set('sourceRef', node.sourceRef);
  return `/work-items/${encodeURIComponent(workItemId)}/documents?${params.toString()}`;
}
