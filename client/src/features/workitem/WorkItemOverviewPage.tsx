import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CircleAlert,
  FileClock,
  FileText,
  History,
  Link2,
  Network,
  RefreshCw,
} from 'lucide-react';

import {
  getCanonicalHostClientSessionGeneration,
  getDocumentParsingPage,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import {
  useCurrentObjectContext,
  type CurrentObjectContextView,
} from '@client/src/app/providers/CurrentObjectContextProvider';
import { buildCurrentObjectContext } from '@client/src/features/navigation/contextual-navigation';
import OverallAssessmentHero from '@client/src/features/workitem/OverallAssessmentHero';
import { useOverallRegeneration } from '@client/src/features/workitem/useOverallRegeneration';
import AuthorityStrip from '@client/src/features/workitem/AuthorityStrip';
import type { WorkItemView } from '@client/src/services/viewModelMappers';
import { toWorkItemView } from '@client/src/services/viewModelMappers';
import { humanState } from '@client/src/features/navigation/treeMappers';

import '@client/src/features/workitem/workitem-overview.css';

/**
 * 工程事项综合评估首页（Spec R01 §4.1）。
 * 选择文档或事项后默认第一屏：先看综合候选意见，再下钻解析与原文。
 * 数据全部来自 getDocumentParsingPage fresh-read，不建第二真源。
 */
export default function WorkItemOverviewPage() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<WorkItemView | null>(null);
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
    view?.id === workItemId
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
    onSucceeded: (fresh) => {
      const current = currentScopeRef.current;
      if (
        current.authenticationRequired ||
        current.workItemId !== workItemId ||
        current.sessionGeneration !== sessionGeneration ||
        getCanonicalHostClientSessionGeneration() !== sessionGeneration ||
        fresh.workItem.workItemId !== workItemId ||
        (current.visibleView &&
          fresh.workItem.revision < current.visibleView.revision)
      ) {
        return;
      }
      loadEpochRef.current += 1;
      setView(toWorkItemView(fresh));
      setContextView(buildCurrentObjectContext(fresh, 'MATTER'));
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
        const fresh = await getDocumentParsingPage(workItemId, '');
        if (isCurrentSession()) {
          setView(toWorkItemView(fresh));
          setContextView(buildCurrentObjectContext(fresh, 'MATTER'));
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

  return (
    <main className="wl-overview-page wl-workbench-enter">
      <h1 className="wl-visually-hidden">当前工程事项综合评估</h1>
      <AuthorityStrip view={visibleView} />
      {loading ? (
        <p className="wl-projection-refresh" role="status">
          正在刷新当前结果…仍显示上次读回的内容，尚未确认最新状态。
        </p>
      ) : null}

      <OverallAssessmentHero
        view={visibleView}
        onOpenWorkbench={openWorkbench}
        onViewEvidence={viewEvidence}
        regeneration={{
          ...overallRegeneration,
          disabled: loading || overallRegeneration.disabled,
        }}
      />

      <div className="wl-overview-side">
        <section className="wl-side-panel" aria-label="关联资料">
          <h3>
            <FileText aria-hidden="true" /> 关联资料
          </h3>
          <ul className="wl-side-list">
            <li>
              <FileText aria-hidden="true" />
              <span>{visibleView.documentLabel}</span>
              <small>当前受控文件版本</small>
            </li>
            <li>
              <Network aria-hidden="true" />
              <span>结构化解析结果</span>
              <small>
                {visibleView.overall
                  ? `${visibleView.overall.sourceCount} 条来源引用`
                  : '综合评估来源尚未形成'}
              </small>
            </li>
          </ul>
          <p className="wl-side-empty">关联资料以当前事项返回为准。</p>
        </section>

        <section className="wl-side-panel" aria-label="最近变化">
          <h3>
            <History aria-hidden="true" /> 最近变化
          </h3>
          {visibleView.lastEvents.length > 0 ? (
            <ul className="wl-side-list">
              {visibleView.lastEvents.map((event) => (
                <li key={event.id}>
                  <FileClock aria-hidden="true" />
                  <span>{event.label}</span>
                  <small>{humanState(event.status) ?? '状态待确认'}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wl-side-empty">当前事项尚无进度记录。</p>
          )}
        </section>
      </div>
    </main>
  );
}
