import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileBox,
  FileClock,
  FileText,
  FolderTree,
  GitBranch,
  Hash,
  Link2,
  LoaderCircle,
  Network,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Workflow,
} from 'lucide-react';

import type {
  CanonicalDocumentParsingPageResponse,
  CanonicalLibraryIndexNode,
  CanonicalRelatedDocumentRelation,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  getCanonicalHostIdentityContext,
  getDocumentParsingPage,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import NavigatorTree from '@client/src/features/navigation/NavigatorTree';
import type {
  NavigationNodeView,
  NavigatorMode,
} from '@client/src/features/navigation/treeMappers';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  forgetRecentWorkItem,
  readRecentWorkItems,
  rememberRecentWorkItem,
  type RecentWorkItemReference,
  workItemIdFromLocator,
} from '@client/src/utils/recent-work-items';

import './workspace-home.css';
import { HostedDevelopmentIntake } from './HostedDevelopmentIntake';

type LibrarySelection = string;

interface LibraryNode {
  id: LibrarySelection;
  kind: CanonicalLibraryIndexNode['kind'];
  label: string;
  detail: string;
  icon: typeof FolderTree;
  state?: string;
  targetNode: string;
}

interface RelationNode {
  id: LibrarySelection;
  label: string;
  detail: string;
  icon: typeof FolderTree;
  tone: 'blue' | 'teal' | 'amber' | 'purple' | 'slate';
}

const PHASE_LABELS: Record<CanonicalWorkItemProjection['phase'], string> = {
  PARSE_REQUESTED: '等待解析',
  PARSING: '解析中',
  CANDIDATE_READBACK_VERIFIED: '候选已回读',
  FAILED: '解析失败',
  RECORDING_FAILED: '记录失败',
};

function shortHash(value: string | null | undefined, length = 18): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '未返回';
  return normalized.length > length
    ? `${normalized.slice(0, length)}…`
    : normalized;
}

function byteLabel(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '未返回';
  return `${Number(value).toLocaleString('zh-CN')} bytes`;
}

function errorLabel(error: unknown): string {
  if (
    error instanceof Error &&
    /NOT_FOUND|无权|FORBIDDEN|403|404/iu.test(error.message)
  ) {
    return '无法找到该事项，或当前账户没有查看权限。';
  }
  return 'UNAVAILABLE · 当前连接无法读取资料，请稍后重试。';
}

function phaseTone(
  phase: CanonicalWorkItemProjection['phase'],
): 'ready' | 'loading' | 'danger' | 'muted' {
  if (phase === 'CANDIDATE_READBACK_VERIFIED') return 'ready';
  if (phase === 'PARSING' || phase === 'PARSE_REQUESTED') return 'loading';
  if (phase === 'FAILED' || phase === 'RECORDING_FAILED') return 'danger';
  return 'muted';
}

function relationToneClass(tone: RelationNode['tone']): string {
  return `library-graph-node--${tone}`;
}

function iconForLibraryKind(
  kind: CanonicalLibraryIndexNode['kind'],
): typeof FolderTree {
  switch (kind) {
    case 'WORK_ITEM':
      return Workflow;
    case 'DOCUMENT':
      return FileText;
    case 'DOCUMENT_VERSION':
      return GitBranch;
    case 'PARSED_PACKAGE':
      return PackageCheck;
    case 'READER_QUERY':
      return Search;
    case 'DYNAMIC_EVALUATION':
      return CheckCircle2;
    case 'OVERALL_SYNTHESIS':
      return Network;
    case 'ENGINEER_REVIEW':
      return ShieldCheck;
    case 'AEO_CANDIDATE':
      return Archive;
    default:
      return FolderTree;
  }
}

export default function WorkspaceHomePage() {
  const currentUser = useCurrentUserProfile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workItemId, setWorkItemId] = useState<string>(
    searchParams.get('workItemId') ?? '',
  );
  const [data, setData] = useState<CanonicalDocumentParsingPageResponse | null>(
    null,
  );
  const [selection, setSelection] = useState<LibrarySelection>('work-item');
  const [treeMode, setTreeMode] = useState<NavigatorMode>(
    searchParams.get('mode') === 'matter' ? 'matter' : 'document',
  );
  const [catalogFilter, setCatalogFilter] = useState<string>('');
  const [recentWorkItems, setRecentWorkItems] = useState<
    RecentWorkItemReference[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [developmentIntakeAvailable, setDevelopmentIntakeAvailable] =
    useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    const deepLinkedWorkItemId = searchParams.get('workItemId')?.trim() ?? '';
    setWorkItemId(deepLinkedWorkItemId);
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);
    setRecentWorkItems([]);
    setDevelopmentIntakeAvailable(false);
    void (async () => {
      const identity = await getCanonicalHostIdentityContext();
      if (cancelled) return;
      setDevelopmentIntakeAvailable(
        identity.developmentIntakeAvailable === true,
      );
      setRecentWorkItems(readRecentWorkItems(identity));
      if (!deepLinkedWorkItemId) {
        setSelection('work-item');
        return;
      }
      try {
        const fresh = await getDocumentParsingPage(deepLinkedWorkItemId, '');
        if (cancelled) return;
        setData(fresh);
        setSelection('work-item');
        rememberRecentWorkItem(identity, {
          workItemId: fresh.workItem.workItemId,
          family: fresh.workItem.classification.normalizedFamily,
          documentLabel:
            fresh.workItem.package?.documentIdentity?.documentCode ??
            fresh.workItem.package?.title ??
            fresh.workItem.source.documentId,
          documentVersionId: fresh.workItem.source.documentVersionId,
        });
        setRecentWorkItems(readRecentWorkItems(identity));
      } catch (reason) {
        if (cancelled) return;
        if (isCanonicalObjectNotFound(reason)) {
          forgetRecentWorkItem(identity, deepLinkedWorkItemId);
          setRecentWorkItems(readRecentWorkItems(identity));
        }
        setData(null);
        setError(errorLabel(reason));
      }
    })()
      .catch((reason: unknown) => {
        if (!cancelled) {
          setData(null);
          setRecentWorkItems([]);
          setError(errorLabel(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser.user_id, refreshRevision, searchParams]);

  const projection = data?.workItem ?? null;
  const phaseLabel = projection
    ? PHASE_LABELS[projection.phase]
    : '尚未选择工程事项';
  const tone = projection ? phaseTone(projection.phase) : 'muted';
  const nodes = useMemo(() => {
    if (!data) return [];
    return data.libraryIndex.nodes;
  }, [data]);
  const visibleNodes = useMemo<LibraryNode[]>(() => {
    if (!data) return [];
    return data.libraryIndex.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      detail: node.detail,
      icon: iconForLibraryKind(node.kind),
      state: node.state,
      targetNode: node.targetNode,
    }));
  }, [data]);

  const recentFamilies = useMemo<
    Array<{ family: string; documents: RecentWorkItemReference[] }>
  >(() => {
    const grouped: Map<string, RecentWorkItemReference[]> = new Map();
    recentWorkItems.forEach((reference: RecentWorkItemReference): void => {
      grouped.set(reference.family, [
        ...(grouped.get(reference.family) ?? []),
        reference,
      ]);
    });
    return Array.from(grouped.entries()).map(
      ([family, documents]: [string, RecentWorkItemReference[]]) => ({
        family,
        documents,
      }),
    );
  }, [recentWorkItems]);

  const visibleRecentFamilies = useMemo(() => {
    const filter: string = catalogFilter.trim().toLowerCase();
    if (!filter) return recentFamilies;
    return recentFamilies
      .map(
        (group: { family: string; documents: RecentWorkItemReference[] }) => ({
          family: group.family,
          documents: group.documents.filter(
            (reference: RecentWorkItemReference): boolean =>
              `${reference.family} ${reference.documentLabel} ${reference.documentVersionId} ${reference.workItemId}`
                .toLowerCase()
                .includes(filter),
          ),
        }),
      )
      .filter(
        (group: {
          family: string;
          documents: RecentWorkItemReference[];
        }): boolean => group.documents.length > 0,
      );
  }, [catalogFilter, recentFamilies]);

  const relations = useMemo<RelationNode[]>(() => {
    if (!data) return [];
    return data.relatedDocuments.relations.map(
      (relation: CanonicalRelatedDocumentRelation): RelationNode => ({
        id: relation.toNodeId,
        label: relation.label,
        detail: `${relation.relationRole} · ${shortHash(relation.sourceLocator)}`,
        icon: FolderTree,
        tone:
          relation.relationRole === 'SELECTED_DOCUMENT_VERSION'
            ? 'blue'
            : relation.relationRole === 'PRODUCED_PARSED_PACKAGE'
              ? 'amber'
              : relation.relationRole === 'HAS_OVERALL_SYNTHESIS'
                ? 'purple'
                : relation.relationRole === 'HAS_AEO_CANDIDATE'
                  ? 'slate'
                  : 'teal',
      }),
    );
  }, [data]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = workItemIdFromLocator(workItemId);
    if (!normalized) return;
    navigate(`/library?workItemId=${encodeURIComponent(normalized)}`);
  }

  function openWorkbench(targetNodeOverride?: string): void {
    if (!projection) return;
    const selectedNode: CanonicalLibraryIndexNode | undefined = nodes.find(
      (node: CanonicalLibraryIndexNode) => node.id === selection,
    );
    const targetNode: string =
      targetNodeOverride ?? selectedNode?.targetNode ?? 'reader';
    const targetTab: string =
      targetNode === 'document'
        ? 'source'
        : targetNode === 'package'
          ? 'source'
          : targetNode;
    navigate(
      `/work-items/${encodeURIComponent(projection.workItemId)}/documents?node=${encodeURIComponent(targetNode)}&tab=${encodeURIComponent(targetTab)}`,
    );
  }

  function handleTreeModeChange(mode: NavigatorMode): void {
    setTreeMode(mode);
    // 深链同步：仅替换 URL 查询参数，不触发数据重读
    const params = new URLSearchParams(window.location.search);
    params.set('mode', mode);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?${params.toString()}`,
    );
  }

  function handleTreeSelect(node: NavigationNodeView): void {
    setSelection(node.id);
    if (
      (node.kind === 'matter' ||
        node.kind === 'document' ||
        node.kind === 'version') &&
      node.targetNode
    ) {
      openWorkbench(node.targetNode);
    }
  }

  function selectLibraryNode(node: LibraryNode): void {
    setSelection(node.id);
    if (
      node.kind === 'WORK_ITEM' ||
      node.kind === 'DOCUMENT' ||
      node.kind === 'DOCUMENT_VERSION'
    ) {
      openWorkbench(node.targetNode);
    }
  }

  function refresh(): void {
    if (!workItemId.trim()) return;
    setRefreshRevision((current) => current + 1);
  }

  return (
    <main className="library-home" aria-busy={loading}>
      <header className="library-home-header">
        <div>
          <p className="library-home-eyebrow">
            <span aria-hidden="true" /> WISELINK 3.1 / DOCUMENT LIBRARY
          </p>
          <h1>资料库</h1>
          <p className="library-home-lede">
            从资料目录、版本来源和关联链路开始；打开具体事项后，再进入同一
            工程事项的解析、评估与候选编写工作台。
          </p>
        </div>
        <div className="library-read-state" aria-label="资料读取状态">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>当前资料</strong>
            <span>目录、预览和关系只显示实际返回内容</span>
          </div>
        </div>
      </header>

      {developmentIntakeAvailable ? <HostedDevelopmentIntake /> : null}

      <section
        className="library-query-band"
        aria-labelledby="library-query-title"
      >
        <div>
          <span className="library-section-label">START FROM THE LIBRARY</span>
          <h2 id="library-query-title">从资料目录进入工作台</h2>
          <p className="library-query-note">
            先按族群、文档和修订浏览；选择具体资料后，系统会自动打开同一
            工程事项。输入已有任务链接只做只读定位，不会改变权限或评估版本。
          </p>
        </div>
        <form className="library-query-form" onSubmit={handleSubmit}>
          <label htmlFor="library-work-item-id">已有任务链接（次级定位）</label>
          <div className="library-query-row">
            <div className="library-query-input">
              <Search aria-hidden="true" />
              <Input
                id="library-work-item-id"
                value={workItemId}
                onChange={(event) => setWorkItemId(event.target.value)}
                placeholder="粘贴已有事项链接或事项 ID"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={!workItemId.trim() || loading}
              data-ai-section-type="button"
            >
              {loading ? (
                <LoaderCircle className="library-spin" aria-hidden="true" />
              ) : (
                <ArrowRight aria-hidden="true" />
              )}
              {loading ? '读取中…' : '定位资料'}
            </Button>
          </div>
        </form>
      </section>

      {error ? (
        <div className="library-alert" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>当前事项无法读取</strong>
            <span>{error}</span>
          </div>
          <Button type="button" variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            重试
          </Button>
        </div>
      ) : null}

      <section className="library-surface" aria-label="资料库目录与预览">
        <aside className="library-tree-panel">
          <div className="library-panel-heading">
            <div>
              <span className="library-section-label">CATALOG TREE</span>
              <h2>资料目录</h2>
            </div>
            <FolderTree aria-hidden="true" />
          </div>
          {nodes.length === 0 ? (
            <div className="library-tree-recent-wrapper">
              {recentWorkItems.length > 0 ? (
                <div
                  className="library-recent-list"
                  role="tree"
                  aria-label="最近访问的受控事项"
                >
                  <div className="library-recent-heading">
                    <FileClock aria-hidden="true" />
                    <span>最近访问的受控事项</span>
                  </div>
                  {visibleRecentFamilies.map((group) => (
                    <section
                      className="library-recent-group"
                      key={group.family}
                    >
                      <h3>
                        <FolderTree aria-hidden="true" /> {group.family}
                      </h3>
                      {group.documents.map(
                        (reference: RecentWorkItemReference) => (
                          <div
                            className="library-recent-item"
                            key={reference.workItemId}
                          >
                            <button
                              className="library-recent-open"
                              type="button"
                              onClick={() =>
                                navigate(
                                  `/work-items/${encodeURIComponent(reference.workItemId)}/documents?node=assessment&tab=assessment`,
                                )
                              }
                            >
                              <FileText aria-hidden="true" />
                              <span>
                                <strong>{reference.documentLabel}</strong>
                                <small>
                                  {reference.documentVersionId ||
                                    reference.workItemId}
                                </small>
                              </span>
                              <ChevronRight aria-hidden="true" />
                            </button>
                            <button
                              className="library-recent-preview"
                              type="button"
                              title="预览资料"
                              aria-label={`预览 ${reference.documentLabel}`}
                              onClick={() =>
                                navigate(
                                  `/library?workItemId=${encodeURIComponent(reference.workItemId)}`,
                                )
                              }
                            >
                              <Search aria-hidden="true" />
                            </button>
                          </div>
                        ),
                      )}
                    </section>
                  ))}
                  {visibleRecentFamilies.length === 0 ? (
                    <p className="library-recent-no-result">
                      当前筛选没有匹配资料。
                    </p>
                  ) : null}
                  <p className="library-recent-boundary">
                    最近访问仅用于导航，不保存资料内容、权限或候选状态。
                  </p>
                </div>
              ) : (
                <div className="library-tree-empty">
                  <FileBox aria-hidden="true" />
                  <strong>从一个真实资料入口开始</strong>
                  <p>
                    从团队工作伙伴的任务链接进入一次后，资料会出现在这里；后续点击资料即可回到同一工作台。
                  </p>
                </div>
              )}
            </div>
          ) : (
            <NavigatorTree
              nodes={nodes}
              mode={treeMode}
              onModeChange={handleTreeModeChange}
              selectedId={selection}
              onSelect={handleTreeSelect}
            />
          )}
          <div className="library-tree-footer">
            <Link2 aria-hidden="true" />
            <span>只读目录 · 不在此处新建或改变工程事项</span>
          </div>
        </aside>

        <section className="library-preview-panel" aria-label="资料预览与概述">
          <div className="library-panel-heading">
            <div>
              <span className="library-section-label">PREVIEW / OVERVIEW</span>
              <h2>{projection ? '资料预览' : '预览与概述'}</h2>
            </div>
            {projection ? (
              <span className={`library-phase library-phase--${tone}`}>
                {phaseLabel}
              </span>
            ) : null}
          </div>
          {!projection ? (
            loading ? (
              <div
                className="library-preview-skeleton"
                role="status"
                aria-live="polite"
              >
                <div className="skeleton-line skeleton-line--lg" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-grid">
                  <div className="skeleton-block" />
                  <div className="skeleton-block" />
                  <div className="skeleton-block" />
                </div>
                <div className="skeleton-line" />
                <span className="library-skeleton-hint">正在读取最新资料…</span>
              </div>
            ) : (
              <div className="library-preview-empty">
                <FileText aria-hidden="true" />
                <h3>选择左侧资料节点</h3>
                <p>
                  资料预览、来源绑定和候选状态会在最新资料返回后显示；目录不会创建或猜测工程事项。
                </p>
              </div>
            )
          ) : (
            <>
              <div className="library-preview-title">
                <div className="library-document-icon">
                  <FileText aria-hidden="true" />
                </div>
                <div>
                  <h3>{data.libraryIndex.rootLabel}</h3>
                  <p>
                    {projection.classification.normalizedFamily} ·{' '}
                    {projection.source.documentVersionId}
                  </p>
                </div>
                <Button type="button" size="sm" onClick={() => openWorkbench()}>
                  <Workflow aria-hidden="true" />
                  进入工作台
                </Button>
              </div>
              <dl className="library-facts">
                <div>
                  <dt>
                    <Hash aria-hidden="true" />
                    事项标识
                  </dt>
                  <dd>{projection.workItemId}</dd>
                </div>
                <div>
                  <dt>
                    <Clock3 aria-hidden="true" />
                    评估版本
                  </dt>
                  <dd>{projection.revision}</dd>
                </div>
                <div>
                  <dt>
                    <FileBox aria-hidden="true" />
                    原始字节
                  </dt>
                  <dd>{byteLabel(projection.source.sourceByteLength)}</dd>
                </div>
                <div>
                  <dt>
                    <GitBranch aria-hidden="true" />
                    来源 SHA
                  </dt>
                  <dd title={projection.source.sourceFileSha256}>
                    {shortHash(projection.source.sourceFileSha256)}
                  </dd>
                </div>
                <div>
                  <dt>
                    <ShieldCheck aria-hidden="true" />
                    权限快照
                  </dt>
                  <dd>{projection.permissionSnapshotVersion}</dd>
                </div>
                <div>
                  <dt>
                    <Network aria-hidden="true" />
                    解析单元
                  </dt>
                  <dd>
                    {projection.package
                      ? `${projection.package.contentUnitCount} units / ${projection.package.sourceRefCount} refs`
                      : '尚未形成解析结果'}
                  </dd>
                </div>
                <div>
                  <dt>
                    <FolderTree aria-hidden="true" />
                    资料节点
                  </dt>
                  <dd>{data.libraryIndex.nodes.length} nodes</dd>
                </div>
                <div>
                  <dt>
                    <Link2 aria-hidden="true" />
                    资料关系
                  </dt>
                  <dd>{data.relatedDocuments.relations.length} relations</dd>
                </div>
                <div>
                  <dt>
                    <GitBranch aria-hidden="true" />
                    候选形成记录
                  </dt>
                  <dd>
                    {data.workbenchAudit.candidateFormationSteps.length} steps
                  </dd>
                </div>
                <div>
                  <dt>
                    <Clock3 aria-hidden="true" />
                    变化记录
                  </dt>
                  <dd>{data.timeline.events.length} events</dd>
                </div>
              </dl>
              <div className="library-preview-block">
                <div className="library-block-heading">
                  <span>候选形成记录</span>
                  <strong>
                    {data.workbenchAudit.reader.queryResultCount} 条原文命中
                  </strong>
                </div>
                <div className="library-content-list">
                  {data.workbenchAudit.candidateFormationSteps.map((step) => (
                    <article key={step.id}>
                      <div>
                        <strong>{step.label}</strong>
                        <span>{step.status}</span>
                      </div>
                      <p>{step.summary}</p>
                      <small title={step.evidenceRef}>
                        {shortHash(step.evidenceRef)}
                      </small>
                    </article>
                  ))}
                </div>
              </div>
              <div className="library-preview-block">
                <div className="library-block-heading">
                  <span>已绑定来源内容</span>
                  <strong>
                    {data?.queryResults.length ?? 0} 个当前返回单元
                  </strong>
                </div>
                {data?.queryResults.length ? (
                  <div className="library-content-list">
                    {data.queryResults.slice(0, 4).map((result) => (
                      <article key={result.unitId}>
                        <div>
                          <strong>{result.unitId}</strong>
                          <span>{result.kind}</span>
                        </div>
                        <p>{result.text}</p>
                        <small>
                          {result.sourceRefIds.join(' · ') || '无原文定位'}
                        </small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="library-inline-empty">
                    当前没有返回内容单元；页面不会用样本填充预览。
                  </p>
                )}
              </div>
              {selection !== 'work-item' ? (
                <p className="library-selection-note">
                  当前选中：
                  {nodes.find((node) => node.id === selection)?.label ??
                    '资料节点'}
                  。右侧概述随最新资料更新。
                </p>
              ) : null}
            </>
          )}
        </section>

        <aside className="library-graph-panel" aria-label="关联文档图谱">
          <div className="library-panel-heading">
            <div>
              <span className="library-section-label">RELATION GRAPH</span>
              <h2>关联文档图谱</h2>
            </div>
            <Network aria-hidden="true" />
          </div>
          {!projection ? (
            loading ? (
              <div
                className="library-graph-skeleton"
                role="status"
                aria-live="polite"
              >
                <Network aria-hidden="true" />
                <h3>正在读取关系图谱…</h3>
                <p>最新资料返回后将展示来源链。</p>
              </div>
            ) : (
              <div className="library-graph-empty">
                <Network aria-hidden="true" />
                <h3>等待资料关系</h3>
                <p>
                  读取事项后展示来源资料、版本、解析结果和候选状态之间的关系。
                </p>
              </div>
            )
          ) : relations.length === 0 ? (
            <div className="library-graph-empty">
              <Network aria-hidden="true" />
              <h3>当前无关联资料</h3>
              <span className="library-unavailable-badge">暂无数据</span>
              <p>当前未返回任何关联文档关系；页面不补造外部文档关系。</p>
            </div>
          ) : (
            <>
              <div className="library-graph-note">
                <GitBranch aria-hidden="true" />
                <span>
                  当前展示的是已返回的来源链，不补造未返回的外部文档关系。
                </span>
              </div>
              <div className="library-graph-flow">
                {relations.map((node, index) => {
                  const NodeIcon = node.icon;
                  return (
                    <div key={node.id} className="library-graph-step">
                      <button
                        type="button"
                        className={`library-graph-node ${relationToneClass(node.tone)}`}
                        onClick={() => setSelection(node.id)}
                      >
                        <NodeIcon aria-hidden="true" />
                        <span>
                          <strong>{node.label}</strong>
                          <small>{node.detail}</small>
                        </span>
                      </button>
                      {index < relations.length - 1 ? (
                        <div className="library-graph-edge">
                          <span>资料关系</span>
                          <ArrowRight aria-hidden="true" />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="library-graph-boundary">
                <CircleAlert aria-hidden="true" />
                <span>
                  外部资料节点必须由实际数据明确返回；当前没有关系时保持空，不以候选替代事实。
                </span>
              </div>
            </>
          )}
        </aside>
      </section>

      <footer className="library-home-footer">
        <span>
          <ShieldCheck aria-hidden="true" />
          当前资料与版本均来自受控服务
        </span>
        <span>预览仅读 · 候选不等于工程结论</span>
      </footer>
    </main>
  );
}
