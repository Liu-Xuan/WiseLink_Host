import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleAlert, FileText, Link2, RefreshCw } from 'lucide-react';

import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalLibraryQuicklook,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import {
  useCurrentObjectContext,
  type CurrentObjectContextView,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import {
  buildLibraryObjectContext,
  buildLibraryEngineeringQuicklook,
} from '@client/src/features/navigation/contextual-navigation';
import EngineeringQuicklook from '@client/src/pages/WorkspaceHomePage/EngineeringQuicklook';
import TaskMatterActions from '@client/src/features/matter/TaskMatterActions';
import { Button } from '@client/src/components/ui/button';
import type { CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { useOverallRegeneration } from '@client/src/features/workitem/useOverallRegeneration';

import '@client/src/features/workitem/workitem-overview.css';

/**
 * 当前 WorkItem 的保存结果首页。首次 GET 只读数据库快览；
 * 原文、解析和正式处置通过明确入口按需打开，不充任独立 Matter 结果。
 */
export default function WorkItemOverviewPage() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<CanonicalLibraryQuicklookResponse | null>(
    null,
  );
  const [viewSessionGeneration, setViewSessionGeneration] = useState<
    number | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);
  const [contextView, setContextView] =
    useState<CurrentObjectContextView | null>(null);
  const visibleView =
    !authenticationRequired &&
    viewSessionGeneration === sessionGeneration &&
    view?.document.workItemId === workItemId
      ? view
      : null;
  const loadEpochRef = useRef(0);
  const currentScopeRef = useRef({
    workItemId,
    sessionGeneration,
    authenticationRequired,
    visibleView,
  });
  currentScopeRef.current = {
    workItemId,
    sessionGeneration,
    authenticationRequired,
    visibleView,
  };
  const overallRegeneration = useOverallRegeneration({
    workItemId,
    sessionGeneration,
    onSucceeded: async (fresh) => {
      const current = currentScopeRef.current;
      if (
        current.authenticationRequired ||
        current.workItemId !== workItemId ||
        current.sessionGeneration !== sessionGeneration ||
        getCanonicalHostClientSessionGeneration() !== sessionGeneration ||
        fresh.workItem.workItemId !== workItemId ||
        (current.visibleView &&
          fresh.workItem.revision < current.visibleView.document.revision)
      ) {
        return;
      }
      const saved: CanonicalLibraryQuicklookResponse =
        await getCanonicalLibraryQuicklook(workItemId);
      if (
        currentScopeRef.current.workItemId !== workItemId ||
        getCanonicalHostClientSessionGeneration() !== sessionGeneration
      )
        return;
      loadEpochRef.current += 1;
      setView(saved);
      setContextView(buildLibraryObjectContext(saved.document, 'WORK_ITEM'));
      setViewSessionGeneration(sessionGeneration);
      setError(null);
      setLoading(false);
    },
  });

  useEffect(() => {
    const epoch = ++loadEpochRef.current;
    const isCurrentSession = (): boolean =>
      loadEpochRef.current === epoch &&
      !currentScopeRef.current.authenticationRequired &&
      currentScopeRef.current.workItemId === workItemId &&
      currentScopeRef.current.sessionGeneration === sessionGeneration &&
      getCanonicalHostClientSessionGeneration() === sessionGeneration;
    setLoading(true);
    setError(null);
    if (!currentScopeRef.current.visibleView) {
      setView(null);
      setContextView(null);
      setViewSessionGeneration(null);
    }
    if (authenticationRequired) {
      setLoading(false);
      setError('请先登录，再读取当前账户可访问的事项。');
      return () => {
        loadEpochRef.current += 1;
      };
    }
    if (!workItemId) {
      setLoading(false);
      setError('当前事项标识缺失，请从资料库重新进入。');
      return () => {
        loadEpochRef.current += 1;
      };
    }
    void (async () => {
      try {
        const fresh = await getCanonicalLibraryQuicklook(workItemId);
        if (isCurrentSession()) {
          setView(fresh);
          setContextView(
            buildLibraryObjectContext(fresh.document, 'WORK_ITEM'),
          );
          setViewSessionGeneration(sessionGeneration);
        }
      } catch (reason) {
        if (isCurrentSession()) {
          setView(null);
          setContextView(null);
          setViewSessionGeneration(null);
          setError(
            isCanonicalObjectNotFound(reason)
              ? '该事项不存在或当前用户无权读取；请从资料库重新进入。'
              : '读取当前结果失败，请稍后重试。',
          );
        }
      } finally {
        if (isCurrentSession()) setLoading(false);
      }
    })();
    return () => {
      loadEpochRef.current += 1;
    };
  }, [authenticationRequired, reloadSignal, sessionGeneration, workItemId]);

  useEffect(() => {
    publishCurrentObject(visibleView ? contextView : null);
  }, [visibleView, contextView, publishCurrentObject]);

  function openWorkbench(): void {
    navigate(
      `/work-items/${encodeURIComponent(workItemId)}/documents?node=review&tab=review`,
    );
  }

  function viewEvidence(sourceRefId?: string): void {
    const sourceQuery = sourceRefId
      ? `&sourceRef=${encodeURIComponent(sourceRefId)}`
      : '';
    navigate(
      `/work-items/${encodeURIComponent(workItemId)}/documents?node=reader&tab=reader${sourceQuery}`,
    );
  }

  if (loading && visibleView === null) {
    return (
      <main className="wl-overview-page" aria-busy="true">
        <div className="wl-overview-loading wl-glass-content">
          <div className="skeleton-line skeleton-line--lg" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <span className="wl-overall-empty-note">正在读取当前结果…</span>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="wl-overview-page">
        <div className="wl-overview-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </div>
        <div className="wl-overview-error-actions">
          <button
            type="button"
            className="wl-btn wl-btn-primary"
            onClick={() => setReloadSignal((value) => value + 1)}
          >
            <RefreshCw aria-hidden="true" /> 重试读取
          </button>
          <button
            type="button"
            className="wl-btn"
            onClick={() => navigate('/library')}
          >
            <Link2 aria-hidden="true" /> 返回资料库
          </button>
        </div>
      </main>
    );
  }

  if (!visibleView) return null;

  function locateDocument(evidence: DocumentAssessmentEvidence): void {
    const params: URLSearchParams = new URLSearchParams({
      node: 'reader',
      tab: 'reader',
      documentVersionId: evidence.documentVersionId,
      sourceRef: evidence.sourceRefId,
      returnWorkItemId: workItemId,
    });
    navigate(
      `/work-items/${encodeURIComponent(evidence.workItemId)}/documents?${params.toString()}`,
    );
  }

  return (
    <main className="wl-overview-page wl-workbench-enter">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">
            当前评估任务 · 已保存结果
          </p>
          <h1 className="text-2xl font-semibold">
            {visibleView.document.documentCode ||
              visibleView.document.originalFilename}
          </h1>
        </div>
        <Button
          variant="outline"
          disabled={loading || overallRegeneration.disabled}
          onClick={overallRegeneration.run}
        >
          {overallRegeneration.label}
        </Button>
      </header>
      {loading ? (
        <p className="wl-projection-refresh" role="status">
          正在刷新当前结果…仍显示上次读回的内容，尚未确认最新状态。
        </p>
      ) : null}

      {overallRegeneration.message ? (
        <p className="wl-projection-refresh" role="status">
          {overallRegeneration.message}
        </p>
      ) : null}
      <EngineeringQuicklook
        title={
          visibleView.document.documentCode ||
          visibleView.document.originalFilename
        }
        quicklook={buildLibraryEngineeringQuicklook(visibleView)}
        loading={loading}
        onOpenWorkbench={() => viewEvidence()}
        onContinueReview={openWorkbench}
        onOpenFamily={() =>
          navigate(
            `/work-items/${encodeURIComponent(workItemId)}/documents?node=document&tab=source`,
          )
        }
        onLocateEvidence={viewEvidence}
        onLocateDocument={locateDocument}
      />

      <div className="wl-overview-side">
        <section className="wl-side-panel" aria-label="任务与文档范围">
          <h3>
            <FileText aria-hidden="true" /> 任务与文档范围
          </h3>
          <ul className="wl-side-list">
            <li>
              <FileText aria-hidden="true" />
              <span>{visibleView.document.documentCode}</span>
              <small>
                {visibleView.document.businessRevision || '版本未标注'} ·{' '}
                {visibleView.document.selectedVersionIsCurrent
                  ? '当前登记版本'
                  : '历史登记版本'}
              </small>
            </li>
          </ul>
          <p className="wl-side-empty">
            当前结果只属于此评估任务。相同文档的其他任务、不同对象和跨资料事项的认识分别保存。
          </p>
          <TaskMatterActions
            workItemId={workItemId}
            documentLabel={
              visibleView.document.documentCode ||
              visibleView.document.originalFilename
            }
            disabled={loading}
          />
        </section>

        <section className="wl-side-panel" aria-label="单独核对与正式处置入口">
          <h3>单独核对与正式处置</h3>
          <p className="wl-side-empty">
            查看逐项评估、历史与人工处置时再进入任务工作台。打开简报不会执行模型或正式采用。
          </p>
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                `/work-items/${encodeURIComponent(workItemId)}/documents?node=assessment&tab=assessment`,
              )
            }
          >
            查看逐项评估
          </Button>
        </section>
      </div>
    </main>
  );
}
