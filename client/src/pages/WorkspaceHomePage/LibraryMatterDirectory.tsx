import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, RefreshCw, Search } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import type useMatterDirectory from '@client/src/features/matter/useMatterDirectory';
import { libraryDateLabel } from './library-document-presentation';
import LibraryMatterQuicklook from './LibraryMatterQuicklook';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { savedReadingSummary } from '@client/src/features/matter/AssessmentReadingListSummary';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { libraryMatterReadingRoute } from '@client/src/features/matter/reading-return';

export default function LibraryMatterDirectory({
  directory,
  authenticationRequired,
  sessionGeneration,
  searchText,
  selectedId,
  onSearchTextChange,
  onSearch,
  onRefresh,
  onCreateFromTask,
  filteredByWorkItem,
  onViewAll,
  onSelect,
}: {
  directory: ReturnType<typeof useMatterDirectory>;
  authenticationRequired: boolean;
  sessionGeneration: number;
  searchText: string;
  selectedId: string;
  onSearchTextChange(value: string): void;
  onSearch(event: FormEvent<HTMLFormElement>): void;
  onRefresh(): void;
  onCreateFromTask(): void;
  filteredByWorkItem: boolean;
  onViewAll(): void;
  onSelect(matterId: string): void;
}) {
  const [searchParams] = useSearchParams();
  const paneScroll = useLibraryPaneScroll<HTMLDivElement>('listY', !directory.loading && !authenticationRequired, sessionGeneration);
  const [selectedRead, setSelectedRead] =
    useState<EngineeringMatterWorkspaceRead | null>(null);
  const items = directory.items.map((item) => {
    const result =
      selectedRead?.matter.matterId === item.matterId &&
      item.matterId === selectedId
        ? selectedRead.working.current?.state.substantiveResult
        : null;
    return result
      ? {
          ...item,
          result: savedReadingSummary(result, item.result),
          workingRevision: selectedRead!.working.currentWorkingRevision,
          overallStatus: selectedRead!.working.current?.state.problemWork?.overviewStatus ?? null,
        }
      : item;
  });
  const selected = directory.items.find((item) => item.matterId === selectedId);
  return (
    <section
      className="atlas-library-browser suite-matter-browser"
      aria-label="工程事项目录"
      aria-busy={directory.loading}
    >
      <aside className="suite-library-folder" aria-label="事项分组">
        <div className="suite-folder-head"><strong>资料分组</strong></div>
        <button type="button" className="suite-folder-row active" onClick={onViewAll}>工程事项 <small>已读取 {directory.items.length}</small></button>
        {filteredByWorkItem ? <p>当前按关联任务筛选。</p> : null}
        <div className="suite-folder-separator">阅读范围</div>
        <p>按当前账户可读取的事项展示。</p>
      </aside>
      <div className="atlas-library-list">
        <form className="atlas-library-search" onSubmit={onSearch}>
          <Search aria-hidden="true" />
          <Input
            aria-label="搜索工程事项"
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="查找工程问题或事项标题"
            maxLength={200}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={authenticationRequired}
          >
            搜索
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={directory.loading || authenticationRequired}
            onClick={onRefresh}
            aria-label="刷新事项目录"
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </form>
        {filteredByWorkItem ? (
          <p>
            仅显示关联所选任务的事项。
            <Button variant="ghost" onClick={onViewAll}>
              查看全部事项
            </Button>
          </p>
        ) : null}
        {directory.error ? (
          <p role="alert">
            {directory.error}
            {directory.items.length ? ' 保留上次成功读回的目录。' : ''}
          </p>
        ) : null}
        <div {...paneScroll} className="suite-matter-list-scroll"><table className="suite-library-table" aria-label="工程事项">
          <thead><tr><th>工程事项</th><th>当前工作</th><th>解读与当前认识</th><th>范围 / 变化</th><th /></tr></thead>
          <tbody>{items.map(matter => <tr key={matter.matterId}
            className={matter.matterId === selectedId ? 'selected' : ''}
            data-result-ref={matter.result?.resultRef} data-result-revision={matter.result?.resultRevision}
            tabIndex={0} onClick={() => onSelect(matter.matterId)}
            onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') onSelect(matter.matterId); }}>
            <td><div className="suite-doc-cell"><BookOpen aria-hidden="true" /><span><b>{matter.result?.headline || matter.title}</b><small>工程事项</small></span></div></td>
            <td><b>工作修订 {matter.workingRevision}</b><small>{matter.result?.roundCompletion === 'IN_PROGRESS' ? '分析进行中' : matter.result ? '已有保存认识' : '认识待形成'}</small></td>
            <td className="meaning">{matter.overallStatus === 'NOT_AVAILABLE' ? '问题正文已保存，综合认识尚未形成。' : matter.result?.listBrief || '尚无已保存的事项综合认识。'}{matter.overallStatus === 'STALE' ? <small className="atlas-library-attention">问题已更新，综合尚未覆盖</small> : null}</td>
            <td><span>{libraryDateLabel(matter.updatedAt)}</span><small>更新日期 · 具体范围见正文</small></td>
            <td><Link to={libraryMatterReadingRoute(matter.matterId, searchParams)} onClick={event => event.stopPropagation()} aria-label={`进入事项：${matter.result?.headline || matter.title}`}>打开 <ArrowRight aria-hidden="true" /></Link></td>
          </tr>)}</tbody>
        </table></div>
        {!directory.items.length ? (
          <div className="atlas-library-empty" role="status">
            <BookOpen aria-hidden="true" />
            <h2>
              {authenticationRequired
                ? '请先登录'
                : directory.loading
                  ? '正在读取工程事项…'
                  : directory.error
                    ? '目录暂不可用'
                    : '尚未找到工程事项'}
            </h2>
            <p>
              工程事项围绕真实问题组织资料和已保存认识。没有事项时，仍可通过“工程文档”浏览资料。
            </p>
            <Button
              variant="outline"
              disabled={authenticationRequired}
              onClick={onCreateFromTask}
            >
              查看已有任务
            </Button>
          </div>
        ) : null}
        {directory.nextCursor ? (
          <Button
            variant="outline"
            disabled={directory.loading}
            onClick={directory.loadMore}
          >
            {directory.loadingMore ? '正在加载…' : '加载更多事项'}
          </Button>
        ) : null}
        <p className="atlas-library-footnote">
          列表与事项详情读取同一份已保存结果。资料措施、候选意见和真实实施记录分别核对。
        </p>
      </div>
      {selected ? (
        <LibraryMatterQuicklook
          key={`${sessionGeneration}:${selected.matterId}`}
          matterId={selected.matterId}
          sessionGeneration={sessionGeneration}
          authenticationRequired={authenticationRequired}
          onRead={setSelectedRead}
        />
      ) : <aside className="atlas-library-inspector"><h2>快速理解</h2><p>{selectedId ? '所选事项尚未在当前读取范围内返回，可加载更多或核对筛选。' : '选择一个事项，查看当前认识和关键条件。'}</p></aside>}
    </section>
  );
}
