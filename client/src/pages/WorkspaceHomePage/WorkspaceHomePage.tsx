import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import {
  ArrowRight,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileBox,
  FileClock,
  FileText,
  FolderTree,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  Shield,
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
  requireOfficialOauthSession,
  retryDevelopmentWorkItem,
} from '@client/src/api/canonical-host';
import NavigatorTree from '@client/src/features/navigation/NavigatorTree';
import type {
  NavigationNodeView,
  NavigatorMode,
} from '@client/src/features/navigation/treeMappers';
import { humanState } from '@client/src/features/navigation/treeMappers';
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
  CANDIDATE_READBACK_VERIFIED: '候选待复核',
  FAILED: '解析失败',
  RECORDING_FAILED: '记录失败',
};

function byteLabel(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '未返回';
  const bytes = Number(value);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

function relationRoleLabel(
  role: CanonicalRelatedDocumentRelation['relationRole'],
): string {
  if (role === 'SELECTED_DOCUMENT_VERSION') return '当前文件版本';
  if (role === 'PRODUCED_PARSED_PACKAGE') return '结构化解析结果';
  if (role === 'HAS_OVERALL_SYNTHESIS') return '综合评估候选';
  if (role === 'HAS_AEO_CANDIDATE') return '后续编写候选';
  return '关联资料';
}

function relationDisplayLabel(
  relation: CanonicalRelatedDocumentRelation,
): string {
  const label = relation.label?.trim() ?? '';
  if (
    !label ||
    /OPENCLAW|ACTIONATTEMPT|SHA-?256|DOCUMENT\s*VERSION|WORK\s*ITEM|\b[0-9a-f]{40,64}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[A-Z][A-Z0-9_]{3,}\b/iu.test(
      label,
    )
  ) {
    return relationRoleLabel(relation.relationRole);
  }
  return label;
}

function contentKindLabel(kind: string): string {
  const upper = kind.toUpperCase();
  if (upper.includes('TITLE') || upper.includes('HEADING')) return '标题';
  if (upper.includes('TABLE')) return '表格内容';
  if (upper.includes('LIST')) return '列表内容';
  if (upper.includes('PARAGRAPH') || upper.includes('TEXT')) return '正文';
  return '结构化内容';
}

function errorLabel(error: unknown): string {
  if (
    error instanceof Error &&
    /NOT_FOUND|无权|FORBIDDEN|403|404/iu.test(error.message)
  ) {
    return '无法找到该事项，或当前账户没有查看权限。';
  }
  return '当前连接无法读取资料，请稍后重试。';
}

function phaseTone(
  phase: CanonicalWorkItemProjection['phase'],
): 'candidate' | 'loading' | 'danger' | 'muted' {
  if (phase === 'CANDIDATE_READBACK_VERIFIED') return 'candidate';
  if (phase === 'PARSING' || phase === 'PARSE_REQUESTED') return 'loading';
  if (phase === 'FAILED' || phase === 'RECORDING_FAILED') return 'danger';
  return 'muted';
}

function relationToneClass(tone: RelationNode['tone']): string {
  return `library-graph-node--${tone}`;
}

function candidateStepCopy(
  label: string,
  summary: string,
): {
  label: string;
  summary: string;
} {
  const source = `${label} ${summary}`.toLowerCase();

  if (/document|version|source|bind|文件|版本|来源|绑定/u.test(source)) {
    return {
      label: '绑定当前受控文件',
      summary: '当前文件版本已关联到这次工程事项。',
    };
  }
  if (/parse|package|unit|解析|结构/u.test(source)) {
    return {
      label: '准备结构化内容',
      summary: '结构化内容已准备，可进入原文与解析结果复核。',
    };
  }
  if (/reader|query|reference|locator|检索|引用|定位/u.test(source)) {
    return {
      label: '定位资料依据',
      summary: '已从当前受控资料中定位可供复核的内容。',
    };
  }
  if (/dynamic|evaluation|criterion|评估|判断/u.test(source)) {
    return {
      label: '形成逐项判断',
      summary: '已形成待工程师核对的逐项判断。',
    };
  }
  if (/overall|synth|candidate|综合|候选/u.test(source)) {
    return {
      label: '汇总综合候选意见',
      summary: '已汇总当前资料，结果仍需工程师复核。',
    };
  }

  return {
    label: '记录候选形成步骤',
    summary: '该步骤已按当前资料状态记录，结果仍需工程师复核。',
  };
}

export default function WorkspaceHomePage() {
  const currentUser = useCurrentUserProfile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workItemId, setWorkItemId] = useState<string>('');
  const [data, setData] = useState<CanonicalDocumentParsingPageResponse | null>(
    null,
  );
  const [selection, setSelection] = useState<LibrarySelection>('work-item');
  const [treeMode, setTreeMode] = useState<NavigatorMode>(
    searchParams.get('mode') === 'matter' ? 'matter' : 'document',
  );
  const [recentWorkItems, setRecentWorkItems] = useState<
    RecentWorkItemReference[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [developmentIntakeAvailable, setDevelopmentIntakeAvailable] =
    useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    const deepLinkedWorkItemId = searchParams.get('workItemId')?.trim() ?? '';
    // 深链标识仅用于路由读取，不回显到用户输入框。
    setWorkItemId('');
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
  const retryableSourceBindingFailure =
    developmentIntakeAvailable &&
    projection?.phase === 'FAILED' &&
    projection.failure?.failureCode === 'SOURCE_BINDING_FAILED';
  const resumablePendingRetry =
    developmentIntakeAvailable && projection?.phase === 'PARSE_REQUESTED';
  const canResumeParse = retryableSourceBindingFailure || resumablePendingRetry;
  const nodes = useMemo(() => {
    if (!data) return [];
    return data.libraryIndex.nodes;
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

  const visibleRecentFamilies = recentFamilies;

  const relations = useMemo<RelationNode[]>(() => {
    if (!data) return [];
    return data.relatedDocuments.relations.map(
      (relation: CanonicalRelatedDocumentRelation): RelationNode => ({
        id: relation.toNodeId,
        label: relationDisplayLabel(relation),
        detail: relationRoleLabel(relation.relationRole),
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
    if (!targetNodeOverride) {
      navigate(`/work-items/${encodeURIComponent(projection.workItemId)}`);
      return;
    }
    const selectedNode: CanonicalLibraryIndexNode | undefined = nodes.find(
      (node: CanonicalLibraryIndexNode) => node.id === selection,
    );
    const targetNode: string =
      targetNodeOverride ?? selectedNode?.targetNode ?? 'assessment';
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
      navigate(`/work-items/${encodeURIComponent(projection!.workItemId)}`);
    }
  }

  function refresh(): void {
    const currentLocator =
      workItemId.trim() || searchParams.get('workItemId')?.trim();
    if (!currentLocator) return;
    setRefreshRevision((current) => current + 1);
  }

  async function retryExistingWorkItem(): Promise<void> {
    if (!projection || !canResumeParse || retrying) return;
    const expectedWorkItemId = projection.workItemId;
    const expectedDocumentVersionId = projection.source.documentVersionId;
    setRetryError(null);
    setRetrying(true);
    try {
      await requireOfficialOauthSession();
      const retried = await retryDevelopmentWorkItem(expectedWorkItemId);
      if (
        retried.workItemCreated ||
        !retried.workItemReused ||
        retried.result.status !== 'CANDIDATE_VERTICAL_VERIFIED' ||
        retried.result.workItem.workItemId !== expectedWorkItemId ||
        retried.result.workItem.source.documentVersionId !==
          expectedDocumentVersionId
      ) {
        throw new Error('CANONICAL_SAME_WORK_ITEM_RETRY_MISMATCH');
      }
      const readback = await getDocumentParsingPage(
        expectedWorkItemId,
        'applicability',
      );
      if (
        readback.workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
        readback.workItem.workItemId !== expectedWorkItemId ||
        readback.workItem.source.documentVersionId !== expectedDocumentVersionId
      ) {
        throw new Error('CANONICAL_SAME_WORK_ITEM_READBACK_MISMATCH');
      }
      setData(readback);
      navigate(
        `/work-items/${encodeURIComponent(expectedWorkItemId)}/documents?node=document&tab=source`,
      );
    } catch {
      setRetryError('重新解析未完成；原文件与事项已保留，请稍后再试。');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="library-home" aria-busy={loading}>
      <header className="library-home-header">
        <div>
          <p className="library-home-eyebrow">
            <span aria-hidden="true" /> 工程资料与综合评估
          </p>
          <h1>资料库</h1>
          <p className="library-home-lede">
            浏览受控资料与最近事项。打开资料后，先查看综合候选意见，再进入原文与证据复核。
          </p>
        </div>
      </header>

      <div
        className={`library-entry-grid${developmentIntakeAvailable ? ' has-intake' : ''}`}
      >
        <section
          className="library-query-band"
          aria-labelledby="library-query-title"
        >
          <div>
            <span className="library-section-label">已有工程事项</span>
            <h2 id="library-query-title">打开已有资料</h2>
            <p className="library-query-note">
              粘贴 WiseLink 工作链接，只按当前用户权限读取，不会改变现有结果。
            </p>
          </div>
          <form className="library-query-form" onSubmit={handleSubmit}>
            <label htmlFor="library-work-item-id">已有工作链接</label>
            <div className="library-query-row">
              <div className="library-query-input">
                <Search aria-hidden="true" />
                <Input
                  id="library-work-item-id"
                  value={workItemId}
                  onChange={(event) => setWorkItemId(event.target.value)}
                  placeholder="粘贴已有工作链接"
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

        {developmentIntakeAvailable ? <HostedDevelopmentIntake /> : null}
      </div>

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

      {loading || projection || recentWorkItems.length > 0 ? (
        <section
          className={`library-surface${projection ? ' has-projection' : ''}${!projection && !loading ? ' is-catalog-only' : ''}`}
          aria-label="资料库目录与预览"
        >
          <aside className="library-tree-panel">
            <div className="library-panel-heading">
              <div>
                <span className="library-section-label">浏览资料</span>
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
                                    `/work-items/${encodeURIComponent(reference.workItemId)}`,
                                  )
                                }
                              >
                                <FileText aria-hidden="true" />
                                <span>
                                  <strong>{reference.documentLabel}</strong>
                                  <small>当前受控文件版本</small>
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
                    <strong>从一个资料入口开始</strong>
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
          </aside>

          <section
            className="library-preview-panel"
            aria-label="资料预览与概述"
          >
            <div className="library-panel-heading">
              <div>
                <span className="library-section-label">当前选择</span>
                <h2>{projection ? '资料预览' : '预览与概述'}</h2>
              </div>
              {projection ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="library-mobile-catalog-return"
                  onClick={() => navigate('/library')}
                >
                  <FolderTree aria-hidden="true" /> 返回资料目录
                </Button>
              ) : null}
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
                  <span className="library-skeleton-hint">
                    正在读取最新资料…
                  </span>
                </div>
              ) : (
                <div className="library-preview-empty">
                  <FileText aria-hidden="true" />
                  <h3>选择左侧资料节点</h3>
                  <p>资料预览、来源绑定和候选状态会在最新资料返回后显示。</p>
                </div>
              )
            ) : (
              <>
                <div className="library-preview-title">
                  <div className="library-document-icon">
                    <FileText aria-hidden="true" />
                  </div>
                  <div>
                    <h3>
                      {projection.package?.documentIdentity?.documentCode ??
                        projection.package?.title ??
                        '当前工程事项'}
                    </h3>
                    <p>
                      {projection.classification.normalizedFamily} ·
                      当前受控版本
                    </p>
                  </div>
                  <div className="library-preview-actions">
                    {canResumeParse ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={retrying}
                        onClick={() => void retryExistingWorkItem()}
                      >
                        <RefreshCw
                          className={retrying ? 'library-spin' : undefined}
                          aria-hidden="true"
                        />
                        {retrying
                          ? '继续解析中…'
                          : resumablePendingRetry
                            ? '继续解析'
                            : '重新解析'}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openWorkbench()}
                    >
                      <Workflow aria-hidden="true" />
                      进入工作台
                    </Button>
                  </div>
                </div>
                {retryError ? (
                  <p className="library-inline-empty" role="alert">
                    {retryError}
                  </p>
                ) : null}
                <dl className="library-facts">
                  <div>
                    <dt>
                      <Shield aria-hidden="true" />
                      当前状态
                    </dt>
                    <dd>{phaseLabel}</dd>
                  </div>
                  <div>
                    <dt>
                      <Clock3 aria-hidden="true" />
                      文件版本
                    </dt>
                    <dd>当前受控版本</dd>
                  </div>
                  <div>
                    <dt>
                      <FileBox aria-hidden="true" />
                      文件大小
                    </dt>
                    <dd>{byteLabel(projection.source.sourceByteLength)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Network aria-hidden="true" />
                      可定位原文
                    </dt>
                    <dd>{projection.package?.sourceRefCount ?? 0} 处</dd>
                  </div>
                </dl>
                <details className="library-preview-details">
                  <summary>查看解析与来源摘要</summary>
                  <div className="library-preview-block">
                    <div className="library-block-heading">
                      <span>候选形成记录</span>
                      <strong>
                        {data.workbenchAudit.reader.queryResultCount} 条原文命中
                      </strong>
                    </div>
                    <div className="library-content-list">
                      {data.workbenchAudit.candidateFormationSteps.map(
                        (step) => {
                          const copy = candidateStepCopy(
                            step.label,
                            step.summary,
                          );
                          return (
                            <article key={step.id}>
                              <div>
                                <strong>{copy.label}</strong>
                                <span>
                                  {humanState(step.status) ?? '状态待确认'}
                                </span>
                              </div>
                              <p>{copy.summary}</p>
                            </article>
                          );
                        },
                      )}
                    </div>
                  </div>
                  <div className="library-preview-block">
                    <div className="library-block-heading">
                      <span>已绑定来源内容</span>
                      <strong>{data.queryResults.length} 个当前返回单元</strong>
                    </div>
                    {data.queryResults.length ? (
                      <div className="library-content-list">
                        {data.queryResults.slice(0, 4).map((result) => (
                          <article key={result.unitId}>
                            <div>
                              <strong>{contentKindLabel(result.kind)}</strong>
                            </div>
                            <p>{result.text}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="library-inline-empty">
                        当前没有可显示的来源内容。
                      </p>
                    )}
                  </div>
                </details>
                {relations.length > 0 ? (
                  <details className="library-mobile-relations">
                    <summary>查看关联资料（{relations.length}）</summary>
                    <ul>
                      {relations.map((relation) => (
                        <li key={relation.id}>
                          <strong>{relation.label}</strong>
                          <span>{relation.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
          </section>

          {projection || loading ? (
            <aside className="library-graph-panel" aria-label="关联文档图谱">
              <div className="library-panel-heading">
                <div>
                  <span className="library-section-label">资料关系</span>
                  <h2>关联资料</h2>
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
                  <p>当前未返回关联文档关系。</p>
                </div>
              ) : (
                <>
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
                </>
              )}
            </aside>
          ) : null}
        </section>
      ) : developmentIntakeAvailable ? null : (
        <section
          className="library-empty-stage"
          aria-labelledby="library-empty-title"
        >
          <FileText aria-hidden="true" />
          <div>
            <h2 id="library-empty-title">选择一份工程资料开始</h2>
            <p>从团队共享的工作链接进入，或在上方打开已有资料。</p>
          </div>
        </section>
      )}
    </main>
  );
}
