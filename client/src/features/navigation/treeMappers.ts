import type {
  CanonicalLibraryIndexNode,
  CanonicalLibraryIndexNodeKind,
} from '@shared/api.interface';

/* ============================================================
 * WiseLink 3.1 · NavigatorTree 视图模型与映射（Spec R01 §3 / §8.1）
 * 目录树是整个系统的工作入口；两种模式读取同一 Host 数据，
 * 不建立两套目录，不伪造跨 WorkItem 聚合。
 * ============================================================ */

export type NavigatorMode = 'document' | 'matter';

export type NavigatorNodeKind =
  | 'group'
  | 'matter'
  | 'document'
  | 'version'
  | 'virtual'
  | 'package'
  | 'evaluation'
  | 'overall'
  | 'review'
  | 'aeo';

export interface NavigationNodeView {
  id: string;
  kind: NavigatorNodeKind;
  label: string;
  subtitle?: string;
  /** 状态徽标（解析状态、候选状态、有效性等），显示为 chip */
  badge?: string;
  /** 徽标语义色 */
  badgeTone?: 'accent' | 'green' | 'amber' | 'red' | 'muted';
  count?: number;
  children?: NavigationNodeView[];
  /** 点击行为：跳转目标（保留原 targetNode 语义） */
  targetNode?: string;
  /** 是否可选中（virtual 分组头不可选） */
  selectable: boolean;
}

/** 后端技术名词 → 用户语言（Spec R01 §2.3） */
const KIND_LABELS: Record<CanonicalLibraryIndexNodeKind, string> = {
  WORK_ITEM: '工程评估',
  DOCUMENT: '受控文件',
  DOCUMENT_VERSION: '当前文件版本',
  PARSED_PACKAGE: '解析结果',
  READER_QUERY: '结构化读取',
  DYNAMIC_EVALUATION: '关键判断',
  OVERALL_SYNTHESIS: '综合评估意见',
  ENGINEER_REVIEW: '复核记录',
  AEO_CANDIDATE: 'AEO 候选',
};

export function kindLabel(kind: CanonicalLibraryIndexNodeKind): string {
  return KIND_LABELS[kind] ?? kind;
}

function stateTone(
  state: string | undefined,
): NavigationNodeView['badgeTone'] {
  if (!state) return undefined;
  const upper = state.toUpperCase();
  if (upper.includes('FAILED') || upper.includes('CONFLICT')) return 'red';
  if (
    upper.includes('STALE') ||
    upper.includes('WAITING') ||
    upper.includes('REVIEW_REQUIRED')
  ) {
    return 'amber';
  }
  if (
    upper.includes('OBSOLETE') ||
    upper.includes('SUPERSEDED') ||
    upper.includes('CANCELLED')
  ) {
    return 'muted';
  }
  // 绿色只保留给正式系统回读；任务成功、候选就绪和人工确认都不是正式结论。
  if (upper.includes('FORMAL_READBACK')) return 'green';
  if (upper.includes('CANDIDATE') || upper.includes('HUMAN_CONFIRMED')) {
    return 'accent';
  }
  return 'muted';
}

const INTERNAL_TEXT_PATTERN =
  /OPENCLAW|ACTIONATTEMPT|SHA-?256|\b[0-9a-f]{40,64}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[A-Z][A-Z0-9_]{3,}\b/iu;

/** 节点人话化标签：优先去技术化 */
function humanLabel(node: CanonicalLibraryIndexNode): string {
  const label = node.label?.trim();
  if (label && INTERNAL_TEXT_PATTERN.test(label)) {
    return KIND_LABELS[node.kind] || '动态综合评估';
  }
  if (label && /document\s*version/i.test(label)) return '当前文件版本';
  if (label && /work\s*item/i.test(label)) return '当前工程评估';
  return label || KIND_LABELS[node.kind] || '资料节点';
}

function humanDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  if (INTERNAL_TEXT_PATTERN.test(detail)) return undefined;
  const translated = detail
    .replace(/\bunits?\b/gi, '个内容单元')
    .replace(/\bcriteria\b/gi, '个评估项')
    .replace(/\bfindings?\b/gi, '项判断')
    .replace(/\breviews?\b/gi, '条复核')
    .replace(/\brefs?\b/gi, '条依据')
    .replace(/\brevision\b/gi, '版本')
    .replace(/\bfrozen\./gi, '冻结版本 ');
  return INTERNAL_TEXT_PATTERN.test(translated) ? undefined : translated;
}

/* ── 模式 A：按文档分组（保留 Host 层级，parentId 组树） ── */

export function buildDocumentTree(
  nodes: CanonicalLibraryIndexNode[],
): NavigationNodeView[] {
  const byId = new Map<
    string,
    NavigationNodeView & { raw: CanonicalLibraryIndexNode }
  >();
  const roots: NavigationNodeView[] = [];

  for (const node of nodes) {
    byId.set(node.id, {
      id: node.id,
      kind: mapKind(node.kind),
      label: humanLabel(node),
      subtitle: humanDetail(node.detail) || KIND_LABELS[node.kind],
      badge: humanState(node.state),
      badgeTone: stateTone(node.state),
      targetNode: node.targetNode,
      selectable: true,
      children: [],
      raw: node,
    });
  }

  for (const node of nodes) {
    const view = byId.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children!.push(view);
    } else {
      roots.push(view);
    }
  }

  // 清理空 children 与内部字段
  const clean = (list: NavigationNodeView[]): NavigationNodeView[] =>
    list.map((item) => {
      const { ...rest } = item as NavigationNodeView & { raw?: unknown };
      const children = item.children?.length ? clean(item.children) : undefined;
      return { ...rest, children };
    });

  return clean(roots);
}

/* ── 模式 B：按事项聚合（以 WORK_ITEM 为根，语义分组聚合子节点） ── */

/** 事项树固定分组顺序（Spec R01 §3 模式 B） */
const MATTER_GROUPS: Array<{
  key: string;
  label: string;
  kinds: CanonicalLibraryIndexNodeKind[];
}> = [
  { key: 'overall', label: '综合评估意见', kinds: ['OVERALL_SYNTHESIS'] },
  {
    key: 'documents',
    label: '关联文件',
    kinds: ['DOCUMENT', 'DOCUMENT_VERSION'],
  },
  { key: 'evaluation', label: '关键判断', kinds: ['DYNAMIC_EVALUATION'] },
  { key: 'package', label: '解析结果', kinds: ['PARSED_PACKAGE'] },
  { key: 'review', label: '复核记录', kinds: ['ENGINEER_REVIEW'] },
  { key: 'aeo', label: 'AEO 候选', kinds: ['AEO_CANDIDATE'] },
];

export function buildMatterTree(
  nodes: CanonicalLibraryIndexNode[],
): NavigationNodeView[] {
  if (nodes.length === 0) return [];

  const workItemNodes = nodes.filter((n) => n.kind === 'WORK_ITEM');
  const others = nodes.filter((n) => n.kind !== 'WORK_ITEM');

  // Host 当前 scope 为 CURRENT_WORKITEM_ONLY：以 WORK_ITEM 节点为事项根。
  // 无 WORK_ITEM 节点时，以根标签构造单一事项占位（数据仍来自真实节点）。
  const matterRoots: NavigationNodeView[] = workItemNodes.map((wi) => ({
    id: wi.id,
    kind: 'matter' as const,
    label: humanLabel(wi),
    subtitle: humanDetail(wi.detail) || '工程评估',
    badge: humanState(wi.state),
    badgeTone: stateTone(wi.state),
    targetNode: wi.targetNode,
    selectable: true,
    children: [],
  }));

  const root =
    matterRoots[0] ??
    ({
      id: 'matter-root',
      kind: 'matter' as const,
      label: '当前工程评估',
      subtitle: '当前评估资料',
      selectable: true,
      children: [],
    } satisfies NavigationNodeView);

  for (const group of MATTER_GROUPS) {
    const members = others.filter((n) => group.kinds.includes(n.kind));
    // 只呈现 Host 实际返回的分组，避免把尚未开放的能力伪装成待办节点。
    if (members.length === 0) continue;
    root.children!.push({
      id: `${root.id}::${group.key}`,
      kind: 'virtual' as const,
      label: group.label,
      count: members.length,
      selectable: false,
      children: members.map((n) => ({
        id: n.id,
        kind: mapKind(n.kind),
        label: humanLabel(n),
        subtitle: humanDetail(n.detail) || KIND_LABELS[n.kind],
        badge: humanState(n.state),
        badgeTone: stateTone(n.state),
        targetNode: n.targetNode,
        selectable: true,
      })),
    });
  }

  // READER_QUERY 等未归组节点收进“其他结构化内容”
  const grouped = new Set(
    MATTER_GROUPS.flatMap((g) => g.kinds).concat('WORK_ITEM'),
  );
  const rest = others.filter((n) => !grouped.has(n.kind));
  if (rest.length > 0) {
    root.children!.push({
      id: `${root.id}::other`,
      kind: 'virtual' as const,
      label: '其他结构化内容',
      count: rest.length,
      selectable: false,
      children: rest.map((n) => ({
        id: n.id,
        kind: mapKind(n.kind),
        label: humanLabel(n),
        subtitle: humanDetail(n.detail) || KIND_LABELS[n.kind],
        badge: humanState(n.state),
        badgeTone: stateTone(n.state),
        targetNode: n.targetNode,
        selectable: true,
      })),
    });
  }

  return [root, ...matterRoots.slice(1)].map((item) => ({ ...item }));
}

function mapKind(kind: CanonicalLibraryIndexNodeKind): NavigatorNodeKind {
  switch (kind) {
    case 'WORK_ITEM':
      return 'matter';
    case 'DOCUMENT':
      return 'document';
    case 'DOCUMENT_VERSION':
      return 'version';
    case 'PARSED_PACKAGE':
      return 'package';
    case 'DYNAMIC_EVALUATION':
      return 'evaluation';
    case 'OVERALL_SYNTHESIS':
      return 'overall';
    case 'ENGINEER_REVIEW':
      return 'review';
    case 'AEO_CANDIDATE':
      return 'aeo';
    default:
      return 'virtual';
  }
}

/** Host state token → 用户语言（§2.3 映射表） */
export function humanState(state: string | undefined): string | undefined {
  if (!state) return undefined;
  const upper = state.toUpperCase();
  const exact: Record<string, string> = {
    QUEUED: '已排队',
    RUNNING: '进行中',
    WAITING_INPUT: '还需补充资料',
    REVIEW_REQUIRED: '待人工复核',
    STALE: '结论需更新',
    CONFLICT: '基于旧版本',
    OBSOLETE: '已被新版本替代',
    CANCELLED: '已取消',
    CANDIDATE_READY: '候选可复核',
    CANDIDATE_ONLY: '候选待确认',
    NEEDS_REVIEW: '待人工复核',
    HUMAN_CONFIRMED: '人工确认已记录',
    REVIEWED: '已记录复核',
    SUCCEEDED: '处理已结束，结果待复核',
    COMPLETED: '处理已结束',
    FAILED: '未完成',
    PASS: '通过候选',
    FAIL: '未通过候选',
    UNKNOWN: '信息不足',
    UNCERTAIN: '仍需确认',
  };
  if (exact[upper]) return exact[upper];
  const table: ReadonlyArray<readonly [string, string]> = [
    ['APPLICABLE_WITH_GAPS', '有条件适用'],
    ['INVESTIGATED_WITH_GAPS', '已分析，仍有缺口'],
    ['HUMAN_REVIEW_RECORDED', '已记录复核'],
    ['HUMAN_CONFIRMED', '人工确认已记录'],
    ['WAITING_INPUT', '还需补充资料'],
    ['REVIEW_REQUIRED', '待人工复核'],
    ['CANDIDATE_READY', '候选可复核'],
    ['CANDIDATE_ONLY', '候选待确认'],
    ['NOT_APPLICABLE', '不适用'],
    ['APPLICABLE', '适用'],
    ['CONFLICT', '基于旧版本'],
    ['STALE', '结论需更新'],
    ['OBSOLETE', '已被新版本替代'],
    ['SUPERSEDED', '已被替代'],
    ['CANCELLED', '已取消'],
    ['FAILED', '未完成'],
    ['RUNNING', '进行中'],
    ['QUEUED', '已排队'],
    ['SUCCEEDED', '处理已结束，结果待复核'],
    ['COMPLETED', '处理已结束'],
    ['CURRENT', '当前有效'],
    ['CANDIDATE', '候选待确认'],
    ['VERIFIED', '已回读验证'],
    ['AVAILABLE', '可查看'],
    ['BOUND', '已关联'],
    ['CONFIRMED', '已确认'],
    ['READY', '可继续'],
    ['UNAVAILABLE', '暂无数据'],
    ['NOT_CONNECTED', '未连接'],
    ['PENDING', '待处理'],
  ];
  for (const [token, label] of table) {
    if (upper.includes(token)) return label;
  }
  return /[\u3400-\u9fff]/u.test(state) ? state : '状态待确认';
}

/** 客户端搜索过滤：命中节点的祖先链保留 */
export function filterTree(
  nodes: NavigationNodeView[],
  query: string,
): NavigationNodeView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const walk = (list: NavigationNodeView[]): NavigationNodeView[] => {
    const out: NavigationNodeView[] = [];
    for (const node of list) {
      const children = node.children ? walk(node.children) : undefined;
      const self = `${node.label} ${node.subtitle ?? ''} ${node.badge ?? ''}`
        .toLowerCase()
        .includes(needle);
      if (self || (children && children.length > 0)) {
        out.push({
          ...node,
          children: children?.length ? children : undefined,
        });
      }
    }
    return out;
  };
  return walk(nodes);
}
