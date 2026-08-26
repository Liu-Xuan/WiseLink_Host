import { useEffect, useState } from 'react';
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
  getDocumentParsingPage,
  isCanonicalObjectNotFound,
} from '@client/src/api/canonical-host';
import OverallAssessmentHero from '@client/src/features/workitem/OverallAssessmentHero';
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
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<WorkItemView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState(0);

  useEffect(() => {
    if (!workItemId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
    void (async () => {
      try {
        const fresh = await getDocumentParsingPage(workItemId, '');
        if (!cancelled) setView(toWorkItemView(fresh));
      } catch (reason) {
        if (!cancelled) {
          setError(
            isCanonicalObjectNotFound(reason)
              ? '该事项不存在或当前用户无权读取；请从资料库重新进入。'
              : '读取当前结果失败，请稍后重试。',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadSignal, workItemId]);

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

  if (loading) {
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

  if (!view) return null;

  return (
    <main className="wl-overview-page wl-workbench-enter">
      <AuthorityStrip view={view} />

      <OverallAssessmentHero
        view={view}
        onOpenWorkbench={openWorkbench}
        onViewEvidence={viewEvidence}
      />

      <div className="wl-overview-side">
        <section className="wl-side-panel" aria-label="关联资料">
          <h3>
            <FileText aria-hidden="true" /> 关联资料
          </h3>
          <ul className="wl-side-list">
            <li>
              <FileText aria-hidden="true" />
              <span>{view.documentLabel}</span>
              <small>当前受控文件版本</small>
            </li>
            <li>
              <Network aria-hidden="true" />
              <span>结构化解析结果</span>
              <small>
                {view.overall
                  ? `${view.overall.sourceCount} 条来源引用`
                  : '综合评估来源尚未形成'}
              </small>
            </li>
          </ul>
          <p className="wl-side-empty">
            关联资料以当前事项返回为准。
          </p>
        </section>

        <section className="wl-side-panel" aria-label="最近变化">
          <h3>
            <History aria-hidden="true" /> 最近变化
          </h3>
          {view.lastEvents.length > 0 ? (
            <ul className="wl-side-list">
              {view.lastEvents.map((event) => (
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
