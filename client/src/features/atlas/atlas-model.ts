import type {
  CanonicalLibraryQuicklookResponse,
  CanonicalLibraryDocumentsResponse,
  CanonicalRelatedContextPreviewResponse,
} from '@shared/api.interface';

export type AtlasView =
  | 'network'
  | 'evidence'
  | 'anchors'
  | 'documents'
  | 'family'
  | 'panorama'
  | 'domain'
  | 'matter'
  | 'classification'
  | 'materials'
  | 'initial'
  | 'review'
  | 'synthesis'
  | 'library'
  | 'runtime'
  | 'source';
export type AtlasSpace = 'HOST' | 'EXAMPLE';
export interface AtlasNode {
  id: string;
  kind: string;
  title: string;
  code: string;
  version?: string;
  summary?: string;
  sourceRefs: string[];
  workItemId?: string;
  documentVersionId?: string;
  familyId?: string;
  bodyAvailable?: boolean;
  sourceText?: string;
  sourceLabel?: string;
}
export interface AtlasEdge {
  memberEdgeRefs?: string[];
  id: string;
  source: string;
  target: string;
  kind: string;
  explanation?: string;
  sourceRefs: string[];
}
export interface AtlasGraph {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  notices: string[];
}
export interface AtlasLocation {
  space: AtlasSpace;
  view: AtlasView;
  focus: string;
  selected: string;
  search: string;
  cursor: string;
  domain: string;
  history: boolean;
  sidebarOpen?: boolean;
  series?: 'all' | 'NG' | 'MAX';
  standard?: 'all' | 'A' | 'B';
  includeUnknown?: boolean;
  showDiscoveries?: boolean;
  afterSnapshot?: boolean;
  allLabels?: boolean;
  classificationNamespace?: 'all' | 'ispec' | 'jasc';
  classificationChapter?: string;
  classificationMode?: 'table' | 'graph' | 'compare';
  lens?: 'relations' | 'outgoing' | 'incoming';
  showMissing?: boolean;
  showAttachments?: boolean;
  showDerived?: boolean;
  expanded?: boolean;
  center?: string;
  layout?: 'auto' | 'concentric' | 'circle' | 'grid' | 'breadthfirst' | 'cose';
  effect: 'default' | 'highest' | 'compatible';
}
export interface AtlasSnapshot {
  theme?: 'light' | 'dark';
  inspectorOpen?: boolean;
  sourceRef?: string | null;
  inspectorScroll?: number;
  location: AtlasLocation;
  pan?: { x: number; y: number };
  zoom?: number;
  scroll: number;
  draft: string;
}
export const initialAtlasLocation: AtlasLocation = {
  space: 'HOST',
  view: 'documents',
  focus: '',
  selected: '',
  search: '',
  cursor: '',
  domain: 'fmc',
  history: false,
  effect: 'default',
};

export function catalogGraph(
  catalog: CanonicalLibraryDocumentsResponse,
): AtlasGraph {
  const nodes: AtlasNode[] = [];
  const edges: AtlasEdge[] = [];
  for (const family of catalog.items) {
    nodes.push({
      id: family.familyId,
      kind: 'family',
      code: family.documentCode,
      title: family.documentCode,
      sourceRefs: [],
      familyId: family.familyId,
    });
    for (const version of family.versions) {
      nodes.push({
        id: version.documentVersionId,
        kind: 'document',
        title: version.originalFilename,
        code: family.documentCode,
        version: version.businessRevision,
        sourceRefs: [],
        workItemId: version.readerWorkItemId,
        documentVersionId: version.documentVersionId,
        familyId: family.familyId,
        summary: version.selectedVersionIsCurrent
          ? '库内当前版本；不代表发布方最新版本'
          : '库内历史版本',
      });
      edges.push({
        id: `version:${version.documentVersionId}`,
        source: family.familyId,
        target: version.documentVersionId,
        kind: '文档族版本',
        sourceRefs: [],
      });
    }
  }
  return {
    nodes,
    edges,
    notices: [
      '仅显示当前授权目录页；版本来自 Host。附件归属和反向引用尚未接通。',
    ],
  };
}

export function documentGraph(
  quicklook: CanonicalLibraryQuicklookResponse,
  preview: CanonicalRelatedContextPreviewResponse | null,
): AtlasGraph {
  const document = quicklook.document;
  const central: AtlasNode = {
    id: document.documentVersionId,
    kind: 'document',
    title: document.originalFilename,
    code: document.documentCode,
    version: document.businessRevision,
    sourceRefs: [],
    workItemId: document.workItemId,
    documentVersionId: document.documentVersionId,
    familyId: document.familyId,
  };
  const graph: AtlasGraph = {
    nodes: [central],
    edges: [],
    notices: [
      '引用表示正文线索，不能证明措施实施或对象适用性。反向引用、版本附件尚未接通。',
    ],
  };
  if (!preview) return graph;
  if (
    preview.snapshot.workItemRef !== document.workItemId ||
    preview.revision !== document.revision ||
    preview.mentions.some(
      (m) => m.primaryDocumentVersionRef !== document.documentVersionId,
    )
  )
    throw new Error('文档引用读回的事项或版本不一致');
  for (const mention of preview.mentions) {
    const target = mention.targetResolution;
    // Only the Host's exact and authorized identity is navigable. Never match against a newer catalog version.
    const exact =
      target.status === 'RESOLVED_EXACT' &&
      mention.permissionState === 'AUTHORIZED'
        ? target
        : null;
    const id = exact?.documentVersionId ?? `mention:${mention.mentionId}`;
    if (!graph.nodes.some((n) => n.id === id))
      graph.nodes.push({
        id,
        kind: exact ? 'document' : 'reference',
        title: mention.citationText,
        code: mention.normalizedIdentity.documentNumber ?? mention.citationText,
        version: exact?.businessRevision ?? undefined,
        workItemId: exact?.workItemId,
        documentVersionId: exact?.documentVersionId,
        sourceRefs: mention.sourceRefIds,
        summary: exact
          ? '已解析到确切版本；目标正文尚未在此读取'
          : '仅引用出现位置；未取得可读取的确切目标正文',
      });
    graph.edges.push({
      id: mention.mentionId,
      source: central.id,
      target: id,
      kind: '显式引用',
      explanation: mention.matchedText,
      sourceRefs: mention.sourceRefIds,
    });
  }
  return graph;
}

const relationLabels: Record<string, string> = {
  REFERS_TO: '引用',
  REVISES: '修订',
  HAS_VERSION: '文档族版本',
  HAS_ATTACHMENT: '版本附件',
  HAS_TRANSLATION: '中文阅读',
  HAS_ASSESSMENT: '保存的评估',
  REQUIRES_CONCURRENT: '并行条件',
  LIMITS: '限定认识',
  SUPPORTS: '支持认识',
  CONCERNS: '关注范围',
  CONTAINS: '事项关联',
  DISCOVERY: '发现线索',
  CANDIDATE_MAPPING: '映射待核',
  SCOPED_CONCEPT: '技术范围',
  CROSS_DOMAIN: '跨领域资料',
  USED_BACKGROUND: '已用背景',
  MEMBER_OF: '事项材料',
  RECORDS: '记录状态',
  RELATED: '登记关联',
  OBSERVED_AT: '观察对象',
  IN_WINDOW: '观察窗口',
  CHANGES: '范围变化',
  ANSWERS: '回答问题',
  FAMILY_REFERENCES: '文档族引用聚合',
};
export const atlasRelationLabel = (kind: string) =>
  relationLabels[kind] ?? kind;
