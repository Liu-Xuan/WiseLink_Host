import SuiteMatterGraphPage from './SuiteMatterGraphPage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CanonicalLibraryIndexNodeKind,
  CanonicalLibraryIndexReadResponse,
  EngineeringMatterCatalogEntry,
  EngineeringMatterDirectoryResponse,
} from '@shared/api.interface';
import type { ElementDefinition } from 'cytoscape';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  getLibraryIndex,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import { getEngineeringMatter, getEngineeringMatterDirectory } from '@client/src/api/engineering-matter';
import {
  activityReadingParams,
  revisionTextPin,
} from '@client/src/features/matter/reading-return';
import {
  activityEntryReason,
  validateActivityEntry,
} from '@client/src/pages/DocumentParsingPage/document-activity-entry';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { ButtonGroup } from '@client/src/components/ui/button-group';
import RelationGraphCanvas from './RelationGraphCanvas';
import { resolveWorkItemMatter } from './work-item-matter-resolver';
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

interface LegacyProjectionState {
  sessionGeneration: number;
  workItemId: string;
  value: CanonicalLibraryIndexReadResponse;
}

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

export function RelationGraphPage(props: RelationGraphPageProps) {
  const [params] = useSearchParams();
  const identity = graphIdentityState(params);
  if (props.injectedProjection) {
    return <LegacyRelationGraphPage {...props} />;
  }
  if (identity.kind === 'invalid') {
    return <p role="alert">{identity.message}</p>;
  }
  if (identity.kind === 'matter') {
    return <SuiteMatterGraphPage matterId={identity.matterId} />;
  }
  if (identity.kind === 'work-item') {
    return <WorkItemMatterResolver workItemId={identity.workItemId} />;
  }
  if (identity.kind === 'matter-dv') {
    return (
      <MatterGraphDvAssociation
        matterId={identity.matterId}
        documentVersionId={identity.documentVersionId}
        activityQuery={identity.activityQuery}
      />
    );
  }
  if (identity.kind === 'legacy') {
    return <LegacyRelationGraphPage {...props} />;
  }
  if (identity.kind === 'activity-dv') {
    return <Navigate to={`/activity-graph?${identity.activityQuery}`} replace />;
  }
  return <GraphDefaultMatterResolver />;
}

export default RelationGraphPage;

type GraphIdentityState =
  | { kind: 'invalid'; message: string }
  | { kind: 'matter'; matterId: string }
  | {
      kind: 'matter-dv';
      matterId: string;
      documentVersionId: string;
      activityQuery: string;
    }
  | { kind: 'legacy' }
  | { kind: 'work-item'; workItemId: string }
  | { kind: 'activity-dv'; activityQuery: string }
  | { kind: 'bare' };

/**
 * Validate every identity and candidate pin before any dispatch. A default directory
 * read happens only when every object and candidate pin is absent; an orphan,
 * duplicated, empty, illegal or conflicting pin is rejected with zero directory
 * requests, never repaired and never silently dropped.
 */
function graphIdentityState(params: URLSearchParams): GraphIdentityState {
  const injected = params.getAll('projection').length > 0;
  const matterPin = revisionTextPin(params, 'matterId');
  const workItemPin = revisionTextPin(params, 'workItemId');
  const documentPin = revisionTextPin(params, 'documentVersionId');
  const workRefPin = revisionTextPin(params, 'workRef');
  if (matterPin.state !== 'ok' && matterPin.state !== 'absent') {
    return { kind: 'invalid', message: '事项标识为空、重复或不合法，请从准确事项入口重新进入。' };
  }
  if (workItemPin.state !== 'ok' && workItemPin.state !== 'absent') {
    return { kind: 'invalid', message: '工作事项标识为空、重复或不合法，请从准确工作入口重新进入。' };
  }
  if (documentPin.state !== 'ok' && documentPin.state !== 'absent') {
    return { kind: 'invalid', message: '图谱对象参数为空、重复或不合法，请从准确入口重新进入。' };
  }
  if (workRefPin.state !== 'ok' && workRefPin.state !== 'absent') {
    return { kind: 'invalid', message: '工作身份为空、重复或不合法，请从准确工作入口重新进入。' };
  }
  if (matterPin.state === 'ok' && workItemPin.state === 'ok') {
    return { kind: 'invalid', message: '图谱对象身份不明确，请从事项或工作入口重新进入。' };
  }
  if (workItemPin.state === 'ok' && documentPin.state === 'ok') {
    return {
      kind: 'invalid',
      message: '工作事项与文档版本不能在此入口混用，请从准确对象重新进入。',
    };
  }
  if (workRefPin.state === 'ok' && matterPin.state !== 'ok') {
    return { kind: 'invalid', message: '工作身份缺少所属事项，请从准确事项入口重新进入。' };
  }
  if (workRefPin.state === 'ok' && documentPin.state === 'ok') {
    return {
      kind: 'invalid',
      message: '历史工作与文档活动不能在此入口混用，请从准确工作或文档重新进入。',
    };
  }
  const activityEntry = validateActivityEntry(params);
  if (!activityEntry.ok) {
    return {
      kind: 'invalid',
      message: activityEntryReason(activityEntry) ?? '候选参数不合法，请从准确入口重新进入。',
    };
  }
  const candidatePinned = activityEntry.parseRunId !== null;
  if (candidatePinned && documentPin.state !== 'ok') {
    return {
      kind: 'invalid',
      message: '解析版本、候选、声明或锚点缺少所属文档版本，请从准确文档入口重新进入。',
    };
  }
  if (candidatePinned && workItemPin.state === 'ok') {
    return {
      kind: 'invalid',
      message: '候选参数属于文档版本活动阅读，不能与工作事项图谱混用，请从准确入口重新进入。',
    };
  }
  if (matterPin.state === 'ok') {
    if (documentPin.state === 'ok') {
      return {
        kind: 'matter-dv',
        matterId: matterPin.value,
        documentVersionId: documentPin.value,
        activityQuery: activityQueryString(params, documentPin.value),
      };
    }
    return { kind: 'matter', matterId: matterPin.value };
  }
  if (injected) {
    return { kind: 'legacy' };
  }
  if (workItemPin.state === 'ok') {
    return { kind: 'work-item', workItemId: workItemPin.value };
  }
  if (documentPin.state === 'ok') {
    return {
      kind: 'activity-dv',
      activityQuery: activityQueryString(params, documentPin.value),
    };
  }
  return { kind: 'bare' };
}

/** Exact activity-reading query preserved through the graph handoff; only legal pins survive. */
function activityQueryString(params: URLSearchParams, documentVersionId: string): string {
  const query = activityReadingParams(params);
  query.set('documentVersionId', documentVersionId);
  return query.toString();
}

/**
 * matter+DV entry: the graph never guesses a matter/document association. The DV is
 * offered to the activity graph only when it is actually registered in this matter's
 * catalog; otherwise the entry is blocked, never silently redirected.
 */
function MatterGraphDvAssociation({
  matterId,
  documentVersionId,
  activityQuery,
}: {
  matterId: string;
  documentVersionId: string;
  activityQuery: string;
}) {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  type AssociationStatus = 'loading' | 'linked' | 'unlinked' | 'error';
  interface AssociationState {
    identity: string;
    status: AssociationStatus;
  }
  const identity = JSON.stringify([
    matterId,
    documentVersionId,
    sessionGeneration,
  ]);
  const [state, setState] = useState<AssociationState>({
    identity,
    status: 'loading',
  });
  const [reloadKey, setReloadKey] = useState(0);
  const generationRef = useRef(0);
  const status: AssociationStatus =
    state.identity === identity ? state.status : 'loading';

  useEffect(() => {
    if (authenticationRequired) return;
    const controller = new AbortController();
    const generation = ++generationRef.current;
    setState({ identity, status: 'loading' });
    void (async () => {
      try {
        const read = await getEngineeringMatter(matterId, controller.signal);
        if (controller.signal.aborted || generationRef.current !== generation) return;
        const linked = read.catalog.entries.some(
          (entry: EngineeringMatterCatalogEntry) =>
            entry.document.documentVersionId === documentVersionId,
        );
        setState({ identity, status: linked ? 'linked' : 'unlinked' });
      } catch (reason) {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        logger.error('事项与文档版本关联核对失败', reason);
        setState({ identity, status: 'error' });
      }
    })();
    return () => controller.abort();
  }, [matterId, documentVersionId, sessionGeneration, authenticationRequired, reloadKey]);

  if (authenticationRequired) {
    return (
      <section className="rg-panel">
        <h2 className="rg-panel-title">请先登录</h2>
        <p className="rg-panel-note">登录后才能核对该文档版本是否属于当前事项。</p>
      </section>
    );
  }
  if (status === 'loading') {
    return (
      <section className="rg-panel" role="status">
        <span className="rg-loading">正在核对该文档版本是否属于当前事项…</span>
      </section>
    );
  }
  if (status === 'error') {
    return (
      <section className="rg-panel rg-status-panel">
        <h2 className="rg-panel-title">关联核对受阻</h2>
        <p className="rg-panel-note">
          无法确认该文档版本与当前事项的关联，已停止而不是改用其他对象。
        </p>
        <Button variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
          重试
        </Button>
      </section>
    );
  }
  if (status === 'unlinked') {
    return (
      <section className="rg-panel" role="alert">
        <h2 className="rg-panel-title">该文档版本未登记在当前事项</h2>
        <p className="rg-panel-note">
          图谱不会猜测事项与文档的关联；请从该事项已登记资料或准确的文档入口重新进入。
        </p>
      </section>
    );
  }
  return <Navigate to={`/activity-graph?${activityQuery}`} replace />;
}

function WorkItemMatterResolver({ workItemId }: { workItemId: string }) {
  const navigate = useNavigate();
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const [state, setState] = useState<'loading' | 'empty' | 'ambiguous' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (authenticationRequired) return;
    const controller = new AbortController();
    setState('loading');
    void (async () => {
      try {
        const resolution = await resolveWorkItemMatter(
          workItemId,
          getEngineeringMatterDirectory,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (resolution.kind === 'ambiguous') {
          setState('ambiguous');
          return;
        }
        if (resolution.kind === 'unique') {
          const matterId = resolution.matterId;
          navigate(`/graph?${new URLSearchParams({ matterId })}`, { replace: true });
          return;
        }
        setState('empty');
      } catch (reason) {
        if (controller.signal.aborted) return;
        logger.error('按工作事项解析工程事项失败', reason);
        setState('error');
      }
    })();
    return () => controller.abort();
  }, [authenticationRequired, navigate, reloadKey, sessionGeneration, workItemId]);

  if (authenticationRequired) {
    return <section className="rg-panel"><h2 className="rg-panel-title">请先登录</h2>
      <p className="rg-panel-note">登录后才能核对该工作事项所属的工程事项。</p></section>;
  }
  if (state === 'loading') {
    return <section className="rg-panel" role="status"><span className="rg-loading">正在核对工作事项所属的工程事项…</span></section>;
  }
  if (state === 'empty') {
    return <section className="rg-panel" role="alert"><h2 className="rg-panel-title">工作事项尚未登记到工程事项</h2>
      <p className="rg-panel-note">没有取得明确的事项绑定，图谱不会猜测归属。请从资料库或已登记事项入口重新进入。</p></section>;
  }
  if (state === 'ambiguous') {
    return <section className="rg-panel" role="alert"><h2 className="rg-panel-title">工作事项对应多个工程事项</h2>
      <p className="rg-panel-note">当前入口无法唯一确定事项归属，图谱已停止读取。请从明确的 matterId 入口进入。</p></section>;
  }
  return <section className="rg-panel rg-status-panel"><h2 className="rg-panel-title">事项归属核对受阻</h2>
    <p className="rg-panel-note">无法确认工作事项与工程事项的登记关系。</p>
    <Button variant="outline" onClick={() => setReloadKey((value) => value + 1)}>重试</Button></section>;
}

function GraphDefaultMatterResolver() {
  const navigate = useNavigate();
  const { sessionGeneration, authenticationRequired } =
    useCurrentUserSession();
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (authenticationRequired) return;
    const controller = new AbortController();
    setState('loading');
    void (async () => {
      try {
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        while (!controller.signal.aborted) {
          const directory = await getEngineeringMatterDirectory(
            cursor ? { limit: 20, cursor } : { limit: 20 },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const first: EngineeringMatterDirectoryResponse['items'][number] | undefined =
            directory.items.find((item) => item.matterId.trim());
          if (first) {
            navigate(
              `/graph?${new URLSearchParams({ matterId: first.matterId })}`,
              { replace: true },
            );
            return;
          }
          if (!directory.nextCursor) break;
          if (seenCursors.has(directory.nextCursor)) {
            throw new Error('工程事项目录游标未推进。');
          }
          seenCursors.add(directory.nextCursor);
          cursor = directory.nextCursor;
        }
        setState('empty');
      } catch (reason) {
        if (controller.signal.aborted) return;
        logger.error('关系图谱默认事项目录读取失败', reason);
        setState('error');
      }
    })();
    return () => controller.abort();
  }, [authenticationRequired, sessionGeneration, reloadKey, navigate]);

  if (authenticationRequired) {
    return (
      <section className="rg-panel">
        <h2 className="rg-panel-title">请先登录</h2>
        <p className="rg-panel-note">
          登录后才能读取当前账号有权访问的工程事项，再打开关系图谱。
        </p>
      </section>
    );
  }
  if (state === 'loading') {
    return (
      <section className="rg-panel" role="status">
        <span className="rg-loading">
          正在读取当前账号可访问的工程事项目录…
        </span>
      </section>
    );
  }
  if (state === 'empty') {
    return (
      <section className="rg-panel">
        <h2 className="rg-panel-title">当前账号没有可打开的工程事项</h2>
        <p className="rg-panel-note">
          关系图谱基于单个事项的规范对象投影渲染。已完整读取当前账号有权访问的工程事项目录，
          没有发现可用于打开图谱的事项。
        </p>
        <div>
          <Button variant="outline" onClick={() => navigate('/library')}>
            去资料库
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section className="rg-panel rg-status-panel">
      <h2 className="rg-panel-title">目录读取受阻</h2>
      <p className="rg-panel-note">
        工程事项目录服务暂时不可用，请稍后重试。
      </p>
      <Button
        variant="outline"
        onClick={() => setReloadKey((value) => value + 1)}
      >
        重试
      </Button>
    </section>
  );
}

function LegacyRelationGraphPage({
  injectedProjection,
  onNodeSelect,
  highlightedNodeId,
}: RelationGraphPageProps) {
  if (injectedProjection) {
    return (
      <LegacyRelationGraphContent
        injectedProjection={injectedProjection}
        onNodeSelect={onNodeSelect}
        highlightedNodeId={highlightedNodeId}
        sessionGeneration={0}
        authenticationRequired={false}
      />
    );
  }
  return (
    <SessionBoundLegacyRelationGraphPage
      onNodeSelect={onNodeSelect}
      highlightedNodeId={highlightedNodeId}
    />
  );
}

function SessionBoundLegacyRelationGraphPage(
  props: Omit<RelationGraphPageProps, 'injectedProjection'>,
) {
  const { sessionGeneration, authenticationRequired } =
    useCurrentUserSession();
  return (
    <LegacyRelationGraphContent
      {...props}
      sessionGeneration={sessionGeneration}
      authenticationRequired={authenticationRequired}
    />
  );
}

interface LegacyRelationGraphContentProps extends RelationGraphPageProps {
  sessionGeneration: number;
  authenticationRequired: boolean;
}

function LegacyRelationGraphContent({
  injectedProjection,
  onNodeSelect,
  highlightedNodeId,
  sessionGeneration,
  authenticationRequired,
}: LegacyRelationGraphContentProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /* 与 WorkspaceHomePage 相同的取值方式：query 参数 workItemId */
  const workItemId: string = searchParams.get('workItemId')?.trim() ?? '';

  const [mode, setMode] = useState<RelationGraphMode>('document');
  const [projectionState, setProjectionState] =
    useState<LegacyProjectionState | null>(null);
  const [status, setStatus] = useState<LibraryStatus>('IDLE');
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [selectedNode, setSelectedNode] = useState<RelationGraphNodeData | null>(null);
  const requestGenerationRef = useRef<number>(0);
  const response: CanonicalLibraryIndexReadResponse | null =
    injectedProjection ?? (
      !authenticationRequired &&
      projectionState?.sessionGeneration === sessionGeneration &&
      projectionState.workItemId === workItemId
        ? projectionState.value
        : null
    );

  useEffect(() => {
    if (injectedProjection) {
      setProjectionState(null);
      setStatus('READY');
      return;
    }
    const requestGeneration: number = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    if (authenticationRequired) {
      setProjectionState(null);
      setSelectedNode(null);
      setStatus('IDLE');
      return;
    }
    if (!workItemId) {
      setProjectionState(null);
      setSelectedNode(null);
      setStatus('IDLE');
      return;
    }
    let cancelled: boolean = false;
    setStatus('LOADING');
    setProjectionState(null);
    void (async (): Promise<void> => {
      try {
        const fresh: CanonicalLibraryIndexReadResponse =
          await getLibraryIndex(workItemId);
        if (
          cancelled ||
          requestGenerationRef.current !== requestGeneration
        ) return;
        setProjectionState({
          sessionGeneration,
          value: fresh,
          workItemId,
        });
        setStatus('READY');
      } catch (reason: unknown) {
        if (
          cancelled ||
          requestGenerationRef.current !== requestGeneration
        ) return;
        logger.error('关系图谱读取 LibraryIndex 失败', reason);
        setStatus(isCanonicalObjectNotFound(reason) ? 'NOT_FOUND' : 'BLOCKED');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authenticationRequired,
    injectedProjection,
    reloadKey,
    sessionGeneration,
    workItemId,
  ]);

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
    if (authenticationRequired && !injectedProjection) return '需要登录';
    if (response) {
      const code: string = response.document.documentCode.trim();
      const revision: string = response.document.businessRevision.trim();
      if (code) return revision ? `${code} · ${revision}` : code;
      return response.libraryIndex.rootLabel;
    }
    if (workItemId) return workItemId;
    return '未选择事项';
  }, [authenticationRequired, injectedProjection, response, workItemId]);

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
    if (authenticationRequired && !injectedProjection) {
      return (
        <section className="rg-panel">
          <h2 className="rg-panel-title">请先登录</h2>
          <p className="rg-panel-note">
            登录后才能读取当前账号有权访问的工作事项关系图谱。
          </p>
        </section>
      );
    }
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
        <section className="rg-panel" role="alert">
          <h2 className="rg-panel-title">尚未取得这项工作的图谱投影</h2>
          <p className="rg-panel-note">
            当前入口没有可显示的授权对象。请从准确的事项或资料库入口重新打开，
            系统会沿用对应的工作身份读取文档、版本、来源与问题关系。
          </p>
          <Button onClick={() => navigate('/library')}>打开资料库</Button>
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
