import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  ListTree,
  LocateFixed,
  Search,
  TriangleAlert,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
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

function unitKindLabel(
  displayKind: CanonicalStructuredContentUnit['displayKind'],
): string {
  if (displayKind === 'section') return '章节';
  if (displayKind === 'unavailable') return '结构化记录';
  return '正文';
}

function isOutlineUnit(unit: CanonicalStructuredContentUnit): boolean {
  return unit.outlineKind === 'SECTION' && unit.sectionTitle !== null;
}

function locatorLabel(
  locator: CanonicalStructuredContentSourceLocator | undefined,
  index: number,
): string {
  if (locator?.pageStart !== null && locator?.pageStart !== undefined) {
    const pageEnd: number = locator.pageEnd ?? locator.pageStart;
    return pageEnd === locator.pageStart
      ? `第 ${locator.pageStart} 页`
      : `第 ${locator.pageStart}–${pageEnd} 页`;
  }
  return `来源 ${index + 1}`;
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
  const requestEpochRef = useRef<number>(0);
  const [page, setPage] =
    useState<CanonicalStructuredContentPageResponse | null>(null);
  const [units, setUnits] = useState<CanonicalStructuredContentUnit[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const [expandedOrdinals, setExpandedOrdinals] = useState<Set<number>>(
    new Set(),
  );

  useEffect(() => {
    const epoch: number = requestEpochRef.current + 1;
    requestEpochRef.current = epoch;
    setPage(null);
    setUnits([]);
    setError(null);
    setExpandedOrdinals(new Set());
    setLoading(true);
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

  const outlineUnits: CanonicalStructuredContentUnit[] =
    units.filter(isOutlineUnit);
  const usable: boolean =
    page?.resultStatus === 'complete' && page.qualityStatus === 'PASS';

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (query.trim().length < 2) return;
    onQuerySubmit();
  }

  function toggleExpanded(ordinal: number): void {
    setExpandedOrdinals((current: Set<number>) => {
      const next: Set<number> = new Set(current);
      if (next.has(ordinal)) next.delete(ordinal);
      else next.add(ordinal);
      return next;
    });
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
      <header className="structured-browser-header">
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

      <form className="structured-browser-search" onSubmit={handleSearch}>
        <Search aria-hidden="true" />
        <label htmlFor="structured-content-search">搜索结构化内容</label>
        <input
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

      <details className="structured-browser-mobile-outline">
        <summary>
          <ListTree aria-hidden="true" /> 已加载章节
        </summary>
        <OutlineList units={outlineUnits} />
      </details>

      <div className="structured-browser-layout">
        <aside
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
          {units.map((unit: CanonicalStructuredContentUnit) => {
            const expanded: boolean = expandedOrdinals.has(unit.ordinal);
            const longText: boolean = unit.displayText.length > 360;
            return (
              <article
                className={`structured-browser-unit${
                  unit.sourceRefIds.includes(requestedSourceRef)
                    ? ' is-selected'
                    : ''
                }`}
                id={`structured-unit-${unit.ordinal}`}
                key={unit.ordinal}
              >
                <div className="structured-browser-unit-meta">
                  <span>{unitKindLabel(unit.displayKind)}</span>
                  <small>内容 {unit.ordinal}</small>
                </div>
                <p
                  id={`structured-unit-text-${unit.ordinal}`}
                  className={longText && !expanded ? 'is-collapsed' : undefined}
                >
                  {unit.displayText}
                </p>
                <div className="structured-browser-unit-actions">
                  {longText ? (
                    <button
                      type="button"
                      className="structured-browser-expand"
                      onClick={() => toggleExpanded(unit.ordinal)}
                      aria-expanded={expanded}
                      aria-controls={`structured-unit-text-${unit.ordinal}`}
                    >
                      {expanded ? (
                        <ChevronDown aria-hidden="true" />
                      ) : (
                        <ChevronRight aria-hidden="true" />
                      )}
                      {expanded ? '收起内容' : '展开全文'}
                    </button>
                  ) : null}
                  {unit.sourceRefIds.map((sourceRef: string, index: number) => {
                    const locator = unit.sourceLocators.find(
                      (item: CanonicalStructuredContentSourceLocator) =>
                        item.sourceRefId === sourceRef,
                    );
                    return (
                      <button
                        type="button"
                        className={
                          requestedSourceRef === sourceRef ? 'is-selected' : ''
                        }
                        key={`${unit.ordinal}-${index}`}
                        onClick={() => onLocateSourceRef(sourceRef, locator)}
                        title={locator?.quote ?? locatorLabel(locator, index)}
                      >
                        <LocateFixed aria-hidden="true" />
                        {locatorLabel(locator, index)}
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}

          {error ? (
            <div className="structured-browser-inline-error" role="alert">
              <TriangleAlert aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {page.hasMore ? (
            <Button
              type="button"
              variant="outline"
              className="structured-browser-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? '正在继续读取…' : '继续加载下一批'}
            </Button>
          ) : (
            <p className="structured-browser-complete">
              已浏览到结构化内容末尾，共{' '}
              {page.totalDisplayUnitCount.toLocaleString('zh-CN')} 个浏览项。
              {page.omittedUnitCount > 0
                ? ` 另有 ${page.omittedUnitCount.toLocaleString('zh-CN')} 项窗口元数据未作为正文卡片显示。`
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
        >
          <span>{unit.sectionTitle}</span>
          <small>{unit.ordinal}</small>
        </a>
      ))}
    </nav>
  );
}
