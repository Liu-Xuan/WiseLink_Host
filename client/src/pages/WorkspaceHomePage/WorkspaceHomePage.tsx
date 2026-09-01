import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpenCheck,
  ChevronRight,
  CircleAlert,
  FileSearch2,
  FolderTree,
  LoaderCircle,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';

import type {
  EngineeringQuicklookProjection,
  LibraryCatalogProjection,
  LibraryItemSummary,
} from '@shared/api.interface';
import {
  getCanonicalHostIdentityContext,
  getEngineeringQuicklook,
  getLibraryCatalog,
} from '@client/src/api/canonical-host';
import { useCurrentObjectContext } from '@client/src/app/providers/CurrentObjectContextProvider';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  buildCatalogCurrentObjectContext,
  buildCatalogEngineeringQuicklook,
  buildQuicklookCurrentObjectContext,
} from '@client/src/features/navigation/contextual-navigation';

import EngineeringQuicklook from './EngineeringQuicklook';
import { HostedDevelopmentIntake } from './HostedDevelopmentIntake';
import './workspace-home.css';

type CatalogView = 'document' | 'assessment';

const PHASE_LABELS: Record<string, string> = {
  PARSE_REQUESTED: '等待解析',
  PARSING: '解析中',
  CANDIDATE_READBACK_VERIFIED: '候选待复核',
  FAILED: '解析未完成',
  RECORDING_FAILED: '记录未完成',
};

export default function WorkspaceHomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const { publishCurrentObject } = useCurrentObjectContext();
  const view: CatalogView =
    searchParams.get('view') === 'assessment' ||
    searchParams.get('mode') === 'matter'
      ? 'assessment'
      : 'document';
  const query = searchParams.get('q')?.trim() ?? '';
  const family = searchParams.get('family')?.trim() ?? '';
  const selected =
    searchParams.get('selected')?.trim() ??
    searchParams.get('workItemId')?.trim() ??
    '';
  const [queryDraft, setQueryDraft] = useState(query);
  const [catalog, setCatalog] = useState<LibraryCatalogProjection | null>(null);
  const [items, setItems] = useState<LibraryItemSummary[]>([]);
  const [quicklook, setQuicklook] =
    useState<EngineeringQuicklookProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [quicklookLoading, setQuicklookLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [developmentIntakeAvailable, setDevelopmentIntakeAvailable] =
    useState(false);

  useEffect(() => setQueryDraft(query), [query]);

  useEffect(() => {
    let current = true;
    setCatalog(null);
    setItems([]);
    setQuicklook(null);
    setDevelopmentIntakeAvailable(false);
    if (authenticationRequired) {
      setLoading(false);
      setError('登录状态已失效，请重新登录后读取授权资料。');
      return () => {
        current = false;
      };
    }
    setLoading(true);
    setError(null);
    void getLibraryCatalog({ view, query, family, limit: 24 })
      .then((nextCatalog) => {
        if (!current) return;
        setCatalog(nextCatalog);
        setItems(nextCatalog.items);
        setLoading(false);
        if (!selected && nextCatalog.items[0]) {
          updateParams(
            { selected: nextCatalog.items[0].workItemId, workItemId: null },
            true,
          );
        }
      })
      .catch(() => {
        if (!current) return;
        setLoading(false);
        setError('当前无法读取授权资料目录，请稍后重试。');
      });
    void getCanonicalHostIdentityContext()
      .then((identity) => {
        if (current) {
          setDevelopmentIntakeAvailable(
            identity.developmentIntakeAvailable === true,
          );
        }
      })
      .catch(() => {
        if (current) setDevelopmentIntakeAvailable(false);
      });
    return () => {
      current = false;
    };
    // URL state owns catalog identity. updateParams is intentionally omitted
    // so its function identity cannot issue duplicate Host reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticationRequired, family, query, sessionGeneration, view]);

  useEffect(() => {
    let current = true;
    setQuicklook(null);
    if (!selected) {
      setQuicklookLoading(false);
      return () => {
        current = false;
      };
    }
    setQuicklookLoading(true);
    void getEngineeringQuicklook(selected)
      .then((projection) => {
        if (!current) return;
        setQuicklook(projection);
        setQuicklookLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setQuicklookLoading(false);
      });
    return () => {
      current = false;
    };
  }, [selected, sessionGeneration]);

  const selectedItem = useMemo(
    () => items.find((item) => item.workItemId === selected) ?? null,
    [items, selected],
  );
  const quicklookView = useMemo(
    () => (quicklook ? buildCatalogEngineeringQuicklook(quicklook) : null),
    [quicklook],
  );

  useEffect(() => {
    publishCurrentObject(
      selectedItem
        ? buildCatalogCurrentObjectContext(
            selectedItem,
            view === 'document' ? 'DOCUMENT' : 'WORKITEM',
          )
        : quicklook
          ? buildQuicklookCurrentObjectContext(
              quicklook,
              view === 'document' ? 'DOCUMENT' : 'WORKITEM',
            )
          : null,
    );
    return () => publishCurrentObject(null);
  }, [publishCurrentObject, quicklook, selectedItem, view]);

  function updateParams(
    values: Record<string, string | null>,
    replace = false,
  ): void {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace });
  }

  function submitSearch(event: FormEvent): void {
    event.preventDefault();
    updateParams({ q: queryDraft.trim(), selected: null, workItemId: null });
  }

  async function loadMore(): Promise<void> {
    if (!catalog?.page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getLibraryCatalog({
        view,
        query,
        family,
        cursor: catalog.page.nextCursor,
        limit: catalog.page.limit,
      });
      setItems((current) => [
        ...current,
        ...next.items.filter(
          (candidate) =>
            !current.some((item) => item.workItemId === candidate.workItemId),
        ),
      ]);
      setCatalog(next);
    } catch {
      setError('后续资料暂时无法读取，已保留当前目录。');
    } finally {
      setLoadingMore(false);
    }
  }

  function selectItem(item: LibraryItemSummary): void {
    updateParams({ selected: item.workItemId, workItemId: null });
  }

  function openWorkspace(item: LibraryItemSummary | null): void {
    if (item) navigate(item.routes.workspace);
  }

  return (
    <main className="library-home library-catalog-home" aria-busy={loading}>
      <header className="library-home-header">
        <div>
          <p className="library-home-eyebrow">
            <span aria-hidden="true" /> 工程资料与综合评估
          </p>
          <h1>资料库</h1>
          <p className="library-home-lede">
            这里展示 Host 按当前登录用户责任关系返回的受控资料与工程评估；
            不使用浏览器最近访问记录推断权限。
          </p>
        </div>
        <div className="library-read-state">
          <ShieldCheck aria-hidden="true" />
          <div>
            <strong>{catalog?.scope.label ?? '我的负责范围'}</strong>
            <span>
              {catalog?.dataAsOf
                ? `截至 ${formatTime(catalog.dataAsOf)}`
                : '正在读取'}
            </span>
          </div>
        </div>
      </header>

      {developmentIntakeAvailable ? (
        <details className="library-entry-disclosure">
          <summary>
            <span>新建工程评估</span>
            <small>选择或上传受控 PDF</small>
          </summary>
          <HostedDevelopmentIntake />
        </details>
      ) : null}

      <form className="library-catalog-toolbar" onSubmit={submitSearch}>
        <div className="library-catalog-view" aria-label="资料库视图">
          <button
            type="button"
            className={view === 'document' ? 'is-active' : ''}
            aria-pressed={view === 'document'}
            onClick={() =>
              updateParams({
                view: 'document',
                mode: null,
                selected: null,
                workItemId: null,
              })
            }
          >
            <FolderTree aria-hidden="true" /> 文档族
          </button>
          <button
            type="button"
            className={view === 'assessment' ? 'is-active' : ''}
            aria-pressed={view === 'assessment'}
            onClick={() =>
              updateParams({
                view: 'assessment',
                mode: null,
                selected: null,
                workItemId: null,
              })
            }
          >
            <Waypoints aria-hidden="true" /> 工程评估
          </button>
        </div>
        <label className="library-catalog-search" id="library-search">
          <Search aria-hidden="true" />
          <Input
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="搜索文档编号、文件名、机型或状态"
            aria-label="搜索授权资料"
          />
        </label>
        <Button type="submit" variant="outline">
          搜索
        </Button>
      </form>

      {error ? (
        <div className="library-alert" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>资料目录读取提示</strong>
            <span>{error}</span>
          </div>
        </div>
      ) : null}

      <section className="library-catalog-grid">
        <aside className="library-catalog-filters" aria-label="责任与筛选">
          <div className="library-panel-heading">
            <div>
              <span className="library-section-label">责任范围</span>
              <h2>目录与筛选</h2>
            </div>
            <ShieldCheck aria-hidden="true" />
          </div>
          <button type="button" className="library-scope-option is-active">
            <span>我的负责范围</span>
            <small>事项创建者关系</small>
          </button>
          <button type="button" className="library-scope-option" disabled>
            <span>全部授权范围</span>
            <small>Host 尚未开放</small>
          </button>
          <div className="library-filter-group">
            <strong>机型 / 资料族</strong>
            <button
              type="button"
              className={family === '' ? 'is-active' : ''}
              onClick={() => updateParams({ family: null, selected: null })}
            >
              全部
            </button>
            {(catalog?.facets.documentFamilies ?? []).map((value) => (
              <button
                key={value}
                type="button"
                className={family === value ? 'is-active' : ''}
                onClick={() => updateParams({ family: value, selected: null })}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="library-catalog-boundary">
            {catalog?.completeness.note ??
              '团队共享与全部授权目录需由 Host 责任关系扩展后开放。'}
          </p>
        </aside>

        <section className="library-catalog-list" aria-label="授权资料列表">
          <div className="library-panel-heading">
            <div>
              <span className="library-section-label">授权对象</span>
              <h2>{view === 'document' ? '文档族' : '工程评估'}</h2>
            </div>
            <span>{items.length} 项</span>
          </div>
          {loading && items.length === 0 ? (
            <div className="library-catalog-empty" role="status">
              <LoaderCircle className="library-spin" aria-hidden="true" />
              <strong>正在读取授权资料</strong>
              <p>目录将按当前登录用户的 Host 责任关系返回。</p>
            </div>
          ) : items.length === 0 ? (
            <div className="library-catalog-empty">
              <FileSearch2 aria-hidden="true" />
              <strong>当前范围没有匹配资料</strong>
              <p>可清除搜索或切换资料族；不会使用本地历史补齐结果。</p>
            </div>
          ) : (
            <div className="library-catalog-rows">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.workItemId}
                  className={`library-catalog-row${selected === item.workItemId ? ' is-active' : ''}`}
                  aria-pressed={selected === item.workItemId}
                  onClick={() => selectItem(item)}
                  onDoubleClick={() => openWorkspace(item)}
                >
                  <span className="library-catalog-row-main">
                    <strong>{item.displayCode}</strong>
                    <span>{item.title}</span>
                  </span>
                  <span>
                    {view === 'document'
                      ? `${item.document.businessRevision} · ${item.document.family}`
                      : `${PHASE_LABELS[item.assessment.phase] ?? '当前评估'} · ${freshnessLabel(item.assessment.freshness)}`}
                  </span>
                  <span>
                    {item.assessment.jobAid
                      ? `Job-Aid ${item.assessment.jobAid.completed}/${item.assessment.jobAid.total}`
                      : 'Job-Aid 尚未形成'}
                  </span>
                  <time dateTime={item.updatedAt}>
                    {formatTime(item.updatedAt)}
                  </time>
                  <ChevronRight aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {catalog?.page.hasMore ? (
            <Button
              type="button"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? (
                <LoaderCircle className="library-spin" aria-hidden="true" />
              ) : (
                <ArrowRight aria-hidden="true" />
              )}
              继续加载
            </Button>
          ) : null}
        </section>

        <div className="library-catalog-quicklook-wrap">
          {quicklookLoading ? (
            <div className="library-quicklook-loading" role="status">
              <LoaderCircle className="library-spin" aria-hidden="true" />
              正在读取工程快览…
            </div>
          ) : null}
          <EngineeringQuicklook
            title={selectedItem?.title ?? '工程快览'}
            quicklook={quicklookView}
            onOpenWorkbench={() => openWorkspace(selectedItem)}
            onContinueReview={() => {
              if (selectedItem) navigate(buildRoute(selectedItem, 'review'));
            }}
            onOpenFamily={() => {
              if (selectedItem) navigate(buildRoute(selectedItem, 'document'));
            }}
            onLocateEvidence={(sourceRefId) => {
              if (!selectedItem) return;
              navigate(
                buildRoute(selectedItem, 'reader') +
                  `&readerMode=source&sourceRef=${encodeURIComponent(sourceRefId)}`,
              );
            }}
          />
        </div>
      </section>

      <footer className="library-home-footer">
        <span>
          <BookOpenCheck aria-hidden="true" />
          选择只更新 URL 与工程快览；双击进入统一工作台
        </span>
      </footer>
    </main>
  );
}

function buildRoute(
  item: LibraryItemSummary,
  node: 'document' | 'reader' | 'review',
): string {
  const base = `/work-items/${encodeURIComponent(item.workItemId)}/documents`;
  if (node === 'document') return `${base}?node=document&tab=source`;
  if (node === 'review') return `${base}?node=review&tab=review`;
  return `${base}?node=reader&tab=reader`;
}

function freshnessLabel(
  freshness: LibraryItemSummary['assessment']['freshness'],
): string {
  if (freshness === 'STALE') return '结论需更新';
  if (freshness === 'SUPERSEDED') return '历史文件版本';
  return '当前有效';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未返回';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
