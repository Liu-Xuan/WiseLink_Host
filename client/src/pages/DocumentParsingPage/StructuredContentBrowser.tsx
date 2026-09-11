import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { BookOpenText, ListTree, Search, TriangleAlert } from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import { Input } from '@client/src/components/ui/input';
import { StructuredDocumentArticle } from './StructuredDocumentArticle';
import { Button } from '@client/src/components/ui/button';
import type {
  CanonicalStructuredContentPageResponse,
  CanonicalStructuredContentSourceLocator,
  CanonicalStructuredContentUnit,
} from '@shared/api.interface';

import './structured-content-browser.css';

const STRUCTURED_CONTENT_PAGE_SIZE = 24;

interface StructuredContentBrowserProps {
  workItemId: string;
  workItemRevision: number;
  query: string;
  requestedSourceRef: string;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  onLocateSourceRef: (
    sourceRef: string,
    locator: CanonicalStructuredContentSourceLocator | undefined,
  ) => void;
  onRefresh: () => void;
}

function isOutlineUnit(unit: CanonicalStructuredContentUnit): boolean {
  return unit.outlineKind === 'SECTION' && unit.sectionTitle !== null;
}

function browseErrorLabel(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error ?? '');
  if (/REVISION|STALE|CHANGED|409/iu.test(message)) {
    return '当前事项已产生新版本，请刷新后继续浏览。';
  }
  if (/FORBIDDEN|UNAUTHORIZED|ACCESS_DENIED|401|403|404/iu.test(message)) {
    return '当前账户无法读取这份结构化内容。';
  }
  return '结构化内容暂时无法读取，请稍后重试。';
}

export function StructuredContentBrowser({
  workItemId,
  workItemRevision,
  query,
  requestedSourceRef,
  onQueryChange,
  onQuerySubmit,
  onLocateSourceRef,
  onRefresh,
}: StructuredContentBrowserProps) {
  const panelActive = useWorkbenchPanelActive();
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const continuationRef = useRef<HTMLDivElement | null>(null);
  const requestEpochRef = useRef<number>(0);
  const [page, setPage] =
    useState<CanonicalStructuredContentPageResponse | null>(null);
  const [units, setUnits] = useState<CanonicalStructuredContentUnit[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<number>(0);

  useEffect(() => {
    const epoch: number = requestEpochRef.current + 1;
    requestEpochRef.current = epoch;
    setPage(null);
    setUnits([]);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    void canonicalHost
      .getStructuredContentPage(workItemId, {
        limit: STRUCTURED_CONTENT_PAGE_SIZE,
        expectedRevision: workItemRevision,
      })
      .then((fresh: CanonicalStructuredContentPageResponse) => {
        if (requestEpochRef.current !== epoch) return;
        setPage(fresh);
        setUnits(fresh.units);
      })
      .catch((cause: unknown) => {
        if (requestEpochRef.current !== epoch) return;
        setError(browseErrorLabel(cause));
      })
      .finally(() => {
        if (requestEpochRef.current === epoch) setLoading(false);
      });
    return () => {
      requestEpochRef.current += 1;
    };
  }, [refreshToken, workItemId, workItemRevision]);

  useEffect(() => {
    if (!panelActive || loading || loadingMore || error || !page?.hasMore)
      return;
    const sentinel = continuationRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root: scrollRootRef.current, rootMargin: '240px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [page, loading, loadingMore, error, panelActive]);

  const outlineUnits: CanonicalStructuredContentUnit[] =
    units.filter(isOutlineUnit);
  const usable: boolean =
    page?.resultStatus === 'complete' && page.qualityStatus === 'PASS';

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (query.trim().length < 2) return;
    onQuerySubmit();
  }

  async function loadMore(): Promise<void> {
    if (!page?.nextCursor || loadingMore) return;
    const epoch: number = requestEpochRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const next: CanonicalStructuredContentPageResponse =
        await canonicalHost.getStructuredContentPage(workItemId, {
          cursor: page.nextCursor,
          limit: STRUCTURED_CONTENT_PAGE_SIZE,
          expectedRevision: page.revision,
        });
      if (requestEpochRef.current !== epoch) return;
      setPage(next);
      setUnits((current: CanonicalStructuredContentUnit[]) => [
        ...current,
        ...next.units,
      ]);
    } catch (cause) {
      if (requestEpochRef.current === epoch) {
        setError(browseErrorLabel(cause));
      }
    } finally {
      if (requestEpochRef.current === epoch) setLoadingMore(false);
    }
  }

  function refresh(): void {
    setRefreshToken((current: number) => current + 1);
    onRefresh();
  }

  if (loading) {
    return (
      <div
        className="structured-browser-state"
        role="status"
        aria-live="polite"
      >
        <BookOpenText aria-hidden="true" />
        <strong>正在打开结构化内容…</strong>
        <span>首批内容会按当前受控版本读取。</span>
      </div>
    );
  }

  if (page === null) {
    return (
      <div className="structured-browser-state is-error" role="alert">
        <TriangleAlert aria-hidden="true" />
        <strong>{error ?? '结构化内容暂不可用'}</strong>
        <Button type="button" variant="outline" onClick={refresh}>
          刷新当前事项
        </Button>
      </div>
    );
  }

  return (
    <section className="structured-browser" aria-label="结构化内容浏览器">
      <header className="structured-browser-header" data-wl-material="g3">
        <div>
          <span className="structured-browser-kicker">结构化内容</span>
          <h3>{usable ? '结构化内容可直接使用' : '部分内容需要人工处理'}</h3>
          <p>
            {usable
              ? '可直接浏览、搜索并用于辅助分析；工程师只需处理异常、冲突、不确定项和最终工程判断。'
              : '解析不完整或存在质量阻断，请优先处理标记项；无需逐条核对正常内容。'}
          </p>
        </div>
        <div
          className={`structured-browser-status${usable ? ' is-ready' : ''}`}
        >
          <strong>{page.totalSourceUnitCount.toLocaleString('zh-CN')}</strong>
          <span>源内容单元</span>
          <small>
            {usable ? '解析完整' : '存在解析阻断'} · 已加载{' '}
            {units.length.toLocaleString('zh-CN')} /{' '}
            {page.totalDisplayUnitCount.toLocaleString('zh-CN')} 个浏览项
          </small>
        </div>
      </header>

      <form
        className="structured-browser-search"
        data-wl-material="g3-soft"
        onSubmit={handleSearch}
      >
        <Search aria-hidden="true" />
        <label htmlFor="structured-content-search">搜索结构化内容</label>
        <Input
          id="structured-content-search"
          type="search"
          value={query}
          minLength={2}
          placeholder="输入术语、步骤或编号"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onQueryChange(event.target.value)
          }
        />
        <Button
          type="submit"
          variant="outline"
          disabled={query.trim().length < 2}
        >
          搜索
        </Button>
        <small>
          搜索会切换到真实 Reader 命中结果；当前区域始终按顺序浏览全部内容。
        </small>
      </form>

      <details
        className="structured-browser-mobile-outline"
        data-wl-material="g3-soft"
      >
        <summary>
          <ListTree aria-hidden="true" /> 已加载章节
        </summary>
        <OutlineList units={outlineUnits} />
      </details>

      <div
        ref={scrollRootRef}
        className="structured-browser-layout"
        tabIndex={0}
        aria-label="结构化正文与已加载章节"
      >
        <aside
          data-wl-material="g3-soft"
          className="structured-browser-outline"
          aria-label="已加载内容目录"
        >
          <div>
            <ListTree aria-hidden="true" />
            <strong>已加载章节</strong>
          </div>
          <OutlineList units={outlineUnits} />
        </aside>

        <div className="structured-browser-units">
          <StructuredDocumentArticle
            units={units}
            requestedSourceRef={requestedSourceRef}
            onLocateSourceRef={onLocateSourceRef}
          />

          {error ? (
            <div className="structured-browser-inline-error" role="alert">
              <TriangleAlert aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {page.hasMore ? (
            <div
              ref={continuationRef}
              className="structured-browser-continuation"
            >
              <Button
                type="button"
                variant="outline"
                className="structured-browser-more"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore
                  ? '正在接续正文…'
                  : error
                    ? '重试接续正文'
                    : '继续阅读'}
              </Button>
            </div>
          ) : (
            <p className="structured-browser-complete">
              已浏览到结构化内容末尾，共{' '}
              {page.totalDisplayUnitCount.toLocaleString('zh-CN')} 个浏览项。
              {page.omittedUnitCount > 0
                ? ` 另有 ${page.omittedUnitCount.toLocaleString('zh-CN')} 项窗口元数据未进入连续正文。`
                : ''}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function OutlineList({
  units,
}: {
  units: CanonicalStructuredContentUnit[];
}): ReactNode {
  if (units.length === 0) {
    return (
      <p className="structured-browser-outline-empty">
        当前已加载批次暂无章节锚点。
      </p>
    );
  }
  return (
    <nav>
      {units.map((unit: CanonicalStructuredContentUnit) => (
        <a
          href={`#structured-unit-${unit.ordinal}`}
          key={unit.ordinal}
          title={unit.sectionTitle ?? undefined}
          style={{
            paddingInlineStart: `${12 + ((unit.reading?.kind === 'heading' ? Math.min(unit.reading.level, 6) : 1) - 1) * 14}px`,
          }}
          onClick={(event) => {
            event.preventDefault();
            const target =
              event.currentTarget
                .closest(
                  '.structured-browser-layout, .structured-content-browser',
                )
                ?.querySelector<HTMLElement>(
                  `#structured-unit-${unit.ordinal}`,
                ) ?? document.getElementById(`structured-unit-${unit.ordinal}`);
            target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            target?.focus({ preventScroll: true });
          }}
        >
          <span>{unit.sectionTitle}</span>
        </a>
      ))}
    </nav>
  );
}
