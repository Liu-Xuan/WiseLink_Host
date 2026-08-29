import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Archive,
  ChevronRight,
  FileText,
  FolderTree,
  GitBranch,
  Network,
  PackageCheck,
  Search,
  MessageSquareText,
  ListChecks,
  Workflow,
} from 'lucide-react';
import { Input } from '@client/src/components/ui/input';

import type {
  NavigationNodeView,
  NavigatorMode,
} from '@client/src/features/navigation/treeMappers';
import {
  buildDocumentTree,
  buildMatterTree,
  filterTree,
} from '@client/src/features/navigation/treeMappers';
import type { CanonicalLibraryIndexNode } from '@shared/api.interface';

import './navigator-tree.css';

export interface NavigatorTreeProps {
  /** Host LibraryIndex 投影节点（唯一数据源） */
  nodes: CanonicalLibraryIndexNode[];
  mode: NavigatorMode;
  onModeChange: (mode: NavigatorMode) => void;
  selectedId?: string;
  onSelect: (node: NavigationNodeView) => void;
  /** 切换模式后保持当前对象上下文（§3.2） */
  searchPlaceholder?: string;
}

const KIND_ICONS: Record<string, typeof FolderTree> = {
  group: FolderTree,
  matter: Workflow,
  document: FileText,
  version: GitBranch,
  package: PackageCheck,
  evaluation: ListChecks,
  overall: Network,
  review: MessageSquareText,
  aeo: Archive,
  virtual: FolderTree,
};

export default function NavigatorTree({
  nodes,
  mode,
  onModeChange,
  selectedId,
  onSelect,
  searchPlaceholder = '搜索文件号、标题、事项或状态',
}: NavigatorTreeProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const idPrefix = useId().replace(/:/gu, '');
  const treeId = `${idPrefix}-tree`;

  /* §10.3 大目录虚拟化：避免一次渲染全部节点。
   * 行高可变且不引入新依赖，采用渐进窗口渲染：
   * 初始只渲染一批，滚动接近底部时由哨兵节点触发追加。 */
  const RENDER_BATCH = 80;
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  useEffect(() => {
    setRenderLimit(RENDER_BATCH);
  }, [mode, query]);

  const tree = useMemo<NavigationNodeView[]>(() => {
    const source =
      mode === 'document' ? buildDocumentTree(nodes) : buildMatterTree(nodes);
    return filterTree(source, query);
  }, [mode, nodes, query]);

  // 展开状态随查询变化：搜索时自动展开全部命中路径
  const effectiveCollapsed = useMemo(() => {
    if (query.trim()) return new Set<string>();
    return collapsed;
  }, [collapsed, query]);

  const flatVisible = useMemo(() => {
    const out: Array<{ node: NavigationNodeView; depth: number }> = [];
    const walk = (
      list: NavigationNodeView[] | undefined,
      depth: number,
    ): void => {
      if (!list) return;
      for (const node of list) {
        out.push({ node, depth });
        const isCollapsed = effectiveCollapsed.has(node.id);
        if (node.children?.length && !isCollapsed) {
          walk(node.children, depth + 1);
        }
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, effectiveCollapsed]);

  const treeRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const renderedItems = useMemo(
    () => flatVisible.slice(0, renderLimit),
    [flatVisible, renderLimit],
  );
  const hasMore = flatVisible.length > renderedItems.length;

  useEffect(() => {
    if (!focusId) return;
    const element = treeRef.current?.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(focusId)}"]`,
    );
    element?.focus();
  }, [focusId, renderLimit, renderedItems.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRenderLimit((limit) => limit + RENDER_BATCH);
        }
      },
      { root: treeRef.current, rootMargin: '320px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  function toggleCollapse(id: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const currentIndex = flatVisible.findIndex(
      (item) => item.node.id === focusId,
    );
    let nextIndex = currentIndex;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        nextIndex = Math.min(currentIndex + 1, flatVisible.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        nextIndex = Math.max(currentIndex - 1, 0);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (currentIndex >= 0) {
          const node = flatVisible[currentIndex].node;
          if (node.children?.length && effectiveCollapsed.has(node.id)) {
            toggleCollapse(node.id);
          } else if (node.children?.length) {
            nextIndex = Math.min(currentIndex + 1, flatVisible.length - 1);
          }
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (currentIndex >= 0) {
          const node = flatVisible[currentIndex].node;
          if (node.children?.length && !effectiveCollapsed.has(node.id)) {
            toggleCollapse(node.id);
          } else {
            const currentDepth = flatVisible[currentIndex].depth;
            if (currentDepth > 0) {
              for (let index = currentIndex - 1; index >= 0; index -= 1) {
                if (flatVisible[index].depth === currentDepth - 1) {
                  nextIndex = index;
                  break;
                }
              }
            }
          }
        }
        break;
      case 'Home':
        event.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        nextIndex = flatVisible.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (currentIndex >= 0) {
          const { node } = flatVisible[currentIndex];
          if (node.selectable) onSelect(node);
          else if (node.children?.length) toggleCollapse(node.id);
        }
        return;
      default:
        return;
    }

    if (nextIndex >= 0 && nextIndex < flatVisible.length) {
      // 键盘导航越过已渲染窗口时，同步扩容渐进渲染（§10.3）
      if (nextIndex >= renderLimit - 1) {
        setRenderLimit((limit) => Math.max(limit, nextIndex + RENDER_BATCH));
      }
      const next = flatVisible[nextIndex];
      setFocusId(next.node.id);
    }
  }

  function handleModeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: NavigatorMode,
  ): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextMode: NavigatorMode =
      event.key === 'ArrowLeft' || event.key === 'Home' ? 'document' : 'matter';
    if (nextMode !== currentMode) onModeChange(nextMode);
    window.requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-${nextMode}-mode`)?.focus();
    });
  }

  return (
    <div className="wl-navigator">
      <div className="wl-navigator-heading">
        <div>
          <strong>资料目录</strong>
          <small>按层级浏览当前受控内容</small>
        </div>
        <span aria-label={`当前显示 ${flatVisible.length} 个目录节点`}>
          {flatVisible.length} 项
        </span>
      </div>

      <div
        className="wl-navigator-mode"
        role="tablist"
        aria-label="目录模式切换"
      >
        <button
          id={`${idPrefix}-document-mode`}
          type="button"
          role="tab"
          aria-selected={mode === 'document'}
          aria-controls={treeId}
          tabIndex={mode === 'document' ? 0 : -1}
          className={`wl-navigator-mode-btn${mode === 'document' ? ' is-active' : ''}`}
          onClick={() => onModeChange('document')}
          onKeyDown={(event) => handleModeKeyDown(event, 'document')}
        >
          按文档
        </button>
        <button
          id={`${idPrefix}-matter-mode`}
          type="button"
          role="tab"
          aria-selected={mode === 'matter'}
          aria-controls={treeId}
          tabIndex={mode === 'matter' ? 0 : -1}
          className={`wl-navigator-mode-btn${mode === 'matter' ? ' is-active' : ''}`}
          onClick={() => onModeChange('matter')}
          onKeyDown={(event) => handleModeKeyDown(event, 'matter')}
        >
          按事项
        </button>
      </div>

      <label className="wl-navigator-search">
        <Search aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label="搜索目录"
        />
      </label>

      {mode === 'matter' ? (
        <p className="wl-navigator-scope-note">
          当前仅展示本事项的关联内容；跨事项汇总尚未开放。
        </p>
      ) : null}

      <div
        id={treeId}
        ref={treeRef}
        className="wl-navigator-tree"
        role="tree"
        aria-labelledby={`${idPrefix}-${mode}-mode`}
        aria-label={mode === 'document' ? '按文档浏览目录' : '按事项聚合目录'}
        onKeyDown={handleKeyDown}
      >
        {flatVisible.length === 0 ? (
          <p className="wl-navigator-empty">
            {nodes.length === 0
              ? '读取一个受控事项后，目录会出现在这里。'
              : '当前搜索没有匹配节点。'}
          </p>
        ) : (
          renderedItems.map(({ node, depth }) => {
            const Icon = KIND_ICONS[node.kind] ?? KIND_ICONS.document;
            const isCollapsed = effectiveCollapsed.has(node.id);
            const hasChildren = Boolean(node.children?.length);
            const isActive = node.id === selectedId;
            return (
              <button
                key={node.id}
                type="button"
                data-node-id={node.id}
                role="treeitem"
                aria-selected={node.selectable ? isActive : undefined}
                aria-expanded={hasChildren ? !isCollapsed : undefined}
                aria-level={depth + 1}
                tabIndex={
                  focusId === node.id || (!focusId && depth === 0) ? 0 : -1
                }
                className={[
                  'wl-navigator-node',
                  node.selectable ? '' : 'is-group',
                  isActive ? 'is-active' : '',
                  focusId === node.id ? 'is-focused' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`${node.label}${
                  node.subtitle ? `，${node.subtitle}` : ''
                }${node.badge ? `，${node.badge}` : ''}`}
                style={
                  {
                    '--node-depth': depth,
                    '--node-depth-capped': Math.min(depth, 4),
                  } as React.CSSProperties
                }
                title={
                  node.subtitle
                    ? `${node.label} — ${node.subtitle}`
                    : node.label
                }
                onClick={() => {
                  setFocusId(node.id);
                  if (node.selectable) onSelect(node);
                  else if (hasChildren) toggleCollapse(node.id);
                }}
              >
                {depth > 0 ? (
                  <span className="wl-navigator-guide" aria-hidden="true" />
                ) : null}
                <span className="wl-navigator-leading" aria-hidden="true">
                  {hasChildren ? (
                    <span
                      className="wl-navigator-caret"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                    >
                      <ChevronRight
                        style={{
                          transform: isCollapsed ? undefined : 'rotate(90deg)',
                        }}
                      />
                    </span>
                  ) : (
                    <span className="wl-navigator-caret-spacer" />
                  )}
                  <Icon />
                </span>
                <span className="wl-navigator-copy">
                  <strong>{node.label}</strong>
                  {node.subtitle ? (
                    <small title={node.subtitle}>{node.subtitle}</small>
                  ) : null}
                </span>
                {typeof node.count === 'number' || node.badge ? (
                  <span className="wl-navigator-meta">
                    {typeof node.count === 'number' ? (
                      <span className="wl-navigator-count">
                        {node.count} 项
                      </span>
                    ) : null}
                    {node.badge ? (
                      <span
                        className={`wl-navigator-badge is-${node.badgeTone ?? 'muted'}`}
                        title={node.badge}
                      >
                        {node.badge}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
        {hasMore ? (
          <div
            ref={sentinelRef}
            className="wl-navigator-more"
            aria-hidden="true"
          >
            正在加载更多节点…
          </div>
        ) : null}
      </div>

      <div className="wl-navigator-footer">
        <FolderTree aria-hidden="true" />
        <span>
          资料目录 · 内容与状态以当前事项为准
          {flatVisible.length > renderedItems.length
            ? ` · 已显示 ${renderedItems.length}/${flatVisible.length}`
            : ''}
        </span>
      </div>
    </div>
  );
}
