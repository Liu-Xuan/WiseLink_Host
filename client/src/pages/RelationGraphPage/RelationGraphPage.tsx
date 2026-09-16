import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CanonicalLibraryIndexNodeKind,
  CanonicalLibraryIndexReadResponse,
} from '@shared/api.interface';
import type { ElementDefinition } from 'cytoscape';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  getLibraryIndex,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { ButtonGroup } from '@client/src/components/ui/button-group';
import RelationGraphCanvas from './RelationGraphCanvas';
import {
  buildGraphElements,
  buildNodeDeepLink,
  RELATION_GRAPH_KIND_LABELS,
  RELATION_GRAPH_MODES,
} from './relation-graph-data';
import type {
  RelationGraphMode,
  RelationGraphModeOption,
  RelationGraphNodeData,
} from './relation-graph-data';
import './relation-graph.css';

export interface RelationGraphPageProps {
  /** 隔离样本复用：注入投影时跳过 fetch（供 /dev-preview 等场景）。 */
  injectedProjection?: CanonicalLibraryIndexReadResponse;
  /** 隔离样本复用：传入时节点点击改走该回调，不执行生产深链导航。 */
  onNodeSelect?: (node: RelationGraphNodeData) => void;
  /** 隔离样本复用：外部指定高亮节点。 */
  highlightedNodeId?: string;
}

type LibraryStatus = 'IDLE' | 'LOADING' | 'READY' | 'NOT_FOUND' | 'BLOCKED';

const KIND_DOT_CLASS: Record<CanonicalLibraryIndexNodeKind, string> = {
  WORK_ITEM: 'rg-dot-work-item',
  DOCUMENT: 'rg-dot-document',
  DOCUMENT_VERSION: 'rg-dot-document',
  PARSED_PACKAGE: 'rg-dot-package',
  READER_QUERY: 'rg-dot-source',
  DYNAMIC_EVALUATION: 'rg-dot-issue',
  ENGINEER_REVIEW: 'rg-dot-review',
  OVERALL_SYNTHESIS: 'rg-dot-overall',
  AEO_CANDIDATE: 'rg-dot-package',
};

export default function RelationGraphPage({
  injectedProjection,
  onNodeSelect,
  highlightedNodeId,
}: RelationGraphPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /* 与 WorkspaceHomePage 相同的取值方式：query 参数 workItemId */
  const workItemId: string = searchParams.get('workItemId')?.trim() ?? '';

  const [mode, setMode] = useState<RelationGraphMode>('document');
  const [response, setResponse] =
    useState<CanonicalLibraryIndexReadResponse | null>(null);
  const [status, setStatus] = useState<LibraryStatus>('IDLE');
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [selectedNode, setSelectedNode] = useState<RelationGraphNodeData | null>(null);

  useEffect(() => {
    if (injectedProjection) {
      setResponse(injectedProjection);
      setStatus('READY');
      return;
    }
    if (!workItemId) {
      setResponse(null);
      setStatus('IDLE');
      return;
    }
    let cancelled: boolean = false;
    setStatus('LOADING');
    setResponse(null);
    void (async (): Promise<void> => {
      try {
        const fresh: CanonicalLibraryIndexReadResponse =
          await getLibraryIndex(workItemId);
        if (cancelled) return;
        setResponse(fresh);
        setStatus('READY');
      } catch (reason: unknown) {
        if (cancelled) return;
        logger.error('关系图谱读取 LibraryIndex 失败', reason);
        setStatus(isCanonicalObjectNotFound(reason) ? 'NOT_FOUND' : 'BLOCKED');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workItemId, injectedProjection, reloadKey]);

  const elements: ElementDefinition[] = useMemo<ElementDefinition[]>(() => {
    if (!response) return [];
    return buildGraphElements(response, mode);
  }, [response, mode]);

  const effectiveWorkItemId: string = response?.workItem.workItemId ?? workItemId;

  const visibleNodes: RelationGraphNodeData[] = useMemo(() => elements.flatMap((element) => {
    const data = element.data as Partial<RelationGraphNodeData> & { source?: string };
    return data.source || !data.id || !data.kind ? [] : [data as RelationGraphNodeData];
  }), [elements]);
  const inspectedNode = visibleNodes.find((node) => node.id === highlightedNodeId)
    ?? visibleNodes.find((node) => node.id === selectedNode?.id)
    ?? visibleNodes[0]
    ?? null;

  const currentWorkItemName: string = useMemo<string>(() => {
    if (response) {
      const code: string = response.document.documentCode.trim();
      const revision: string = response.document.businessRevision.trim();
      if (code) return revision ? `${code} · ${revision}` : code;
      return response.libraryIndex.rootLabel;
    }
    if (workItemId) return workItemId;
    return '未选择事项';
  }, [response, workItemId]);

  const legendKinds: CanonicalLibraryIndexNodeKind[] = useMemo(() => {
    const seen: CanonicalLibraryIndexNodeKind[] = [];
    for (const element of elements) {
      const data = element.data as Partial<RelationGraphNodeData>;
      if (data.kind && !seen.includes(data.kind)) seen.push(data.kind);
    }
    return seen;
  }, [elements]);

  function handleNodeOpen(node: RelationGraphNodeData): void {
    if (onNodeSelect) {
      onNodeSelect(node);
      return;
    }
    setSelectedNode(node);
  }

  function openInspectedNode(): void {
    if (!inspectedNode) return;
    if (onNodeSelect) {
      onNodeSelect(inspectedNode);
      return;
    }
    if (injectedProjection) return;
    const link: string | null = buildNodeDeepLink(effectiveWorkItemId, inspectedNode);
    if (!link) return;
    navigate(link);
  }

  function renderModeContent() {
    const option: RelationGraphModeOption | undefined =
      RELATION_GRAPH_MODES.find((item) => item.value === mode);
    if (option && !option.connected) {
      return (
        <section className="rg-panel" aria-live="polite">
          <span className="rg-not-connected-badge">NOT_CONNECTED</span>
          <h2 className="rg-panel-title">「{option.label}」模式尚未接通</h2>
          <p className="rg-panel-note">
            该模式的全景真实数据尚未接通，为避免误导判断，这里不展示任何
            伪造节点。请先使用「工程文档」或「工程事项」模式查看当前事项已接通的
            对象关系。
          </p>
        </section>
      );
    }
    if (status === 'LOADING') {
      return (
        <section className="rg-panel">
          <span className="rg-loading">正在读取资料库投影…</span>
        </section>
      );
    }
    if (status === 'NOT_FOUND') {
      return (
        <section className="rg-panel">
          <h2 className="rg-panel-title">事项不存在</h2>
          <p className="rg-panel-note">
            未找到该事项或其资料库投影，请回到资料库重新选择。
          </p>
          <Button variant="outline" onClick={() => navigate('/library')}>
            去资料库
          </Button>
        </section>
      );
    }
    if (status === 'BLOCKED') {
      return (
        <section className="rg-panel rg-status-panel" aria-live="assertive">
          <h2 className="rg-panel-title">目录读取受阻</h2>
          <p className="rg-panel-note">
            资料库目录服务暂时不可用（可能为 503），请稍后重试。
          </p>
          <Button variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
            重试
          </Button>
        </section>
      );
    }
    if (!response) {
      return (
        <section className="rg-panel">
          <h2 className="rg-panel-title">请先在资料库选择事项</h2>
          <p className="rg-panel-note">
            关系图谱基于单个事项的规范对象投影渲染。请先在资料库中选择一个
            事项，再回到本页查看文档、版本、来源与问题之间的关系。
          </p>
          <Button onClick={() => navigate('/library')}>去资料库</Button>
        </section>
      );
    }
    if (elements.length === 0) {
      return (
        <section className="rg-panel">
          <h2 className="rg-panel-title">当前模式暂无已接通对象</h2>
          <p className="rg-panel-note">
            该事项的投影中没有属于当前模式的节点，可切换其他模式查看。
          </p>
        </section>
      );
    }
    return <div className="rg-workspace">
      <section className="rg-canvas-shell">
          <RelationGraphCanvas
            elements={elements}
            onNodeOpen={handleNodeOpen}
            selectedNodeId={highlightedNodeId ?? inspectedNode?.id}
          />
          {legendKinds.length > 0 ? (
            <div className="rg-legend">
              {legendKinds.map((kind: CanonicalLibraryIndexNodeKind) => (
                <span key={kind} className="rg-legend-item">
                  <span className={`rg-dot ${KIND_DOT_CLASS[kind]}`} />
                  {RELATION_GRAPH_KIND_LABELS[kind]}
                </span>
              ))}
              <strong>{visibleNodes.length} 个对象 · {elements.length - visibleNodes.length} 条投影关系</strong>
            </div>
          ) : null}
      </section>
      <aside className="rg-inspector" aria-label="当前关系对象">
        <span className="rg-inspector-eyebrow">当前选择 · Host 投影</span>
        {inspectedNode ? <>
          <h2>{inspectedNode.label}</h2>
          <p className="rg-inspector-lead">{inspectedNode.detail || '当前投影没有补充说明。'}</p>
          <dl>
            <dt>对象类型</dt><dd>{RELATION_GRAPH_KIND_LABELS[inspectedNode.kind]}</dd>
            <dt>对象标识</dt><dd>{inspectedNode.id}</dd>
            <dt>保存状态</dt><dd>{inspectedNode.state || '未提供'}</dd>
            <dt>文档版本</dt><dd>{inspectedNode.documentVersionId || '不适用或未提供'}</dd>
          </dl>
          {onNodeSelect
            ? <Button size="sm" onClick={openInspectedNode}>查看样例对象</Button>
            : injectedProjection
              ? <p className="rg-inspector-note">隔离投影不提供生产深链。</p>
              : buildNodeDeepLink(effectiveWorkItemId, inspectedNode)
                ? <Button size="sm" onClick={openInspectedNode}>打开准确对象</Button>
                : <p className="rg-inspector-note">当前对象没有可验证的生产深链。</p>}
        </> : <><h2>选择一个对象</h2><p className="rg-inspector-lead">选择画布节点后，在这里核对其身份、状态与准确入口。</p></>}
        <p className="rg-inspector-boundary">当前边只表达 LibraryIndex 已保存的父子投影；布局、距离和连通性不证明归属、因果、风险或正式采用。</p>
      </aside>
    </div>;
  }

  return (
    <div className="rg-page">
      <header className="rg-header">
        <div className="rg-heading">
          <h1 className="rg-title">关系图谱</h1>
          <p className="rg-description">从文档、事项、技术领域和全景核对有据关联；未接通的观察尺度保持明确。</p>
          <span className="rg-subtitle" title={currentWorkItemName}>
            当前事项：{currentWorkItemName}
          </span>
        </div>
        <div className="rg-controls" data-ai-section-type="button">
          <ButtonGroup aria-label="图谱模式切换">
            {RELATION_GRAPH_MODES.map((item: RelationGraphModeOption) => (
              <Button
                key={item.value}
                size="sm"
                variant={mode === item.value ? 'default' : 'outline'}
                aria-pressed={mode === item.value}
                title={item.connected ? undefined : '当前 Host 尚未提供该范围的真实关系'}
                onClick={() => setMode(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </header>
      {renderModeContent()}
    </div>
  );
}
