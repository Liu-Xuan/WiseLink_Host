import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, RefreshCw, Search } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import type useMatterDirectory from '@client/src/features/matter/useMatterDirectory';
import type { useLibraryDocuments } from './useLibraryDocuments';
import { libraryDateLabel, libraryDistinctBrief, libraryMatterSourceAta } from './library-document-presentation';
import { LibrarySummaryText } from './LibrarySummaryText';
import LibraryMatterQuicklook from './LibraryMatterQuicklook';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { savedReadingSummary } from '@client/src/features/matter/AssessmentReadingListSummary';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { libraryMatterReadingRoute } from '@client/src/features/matter/reading-return';

export default function LibraryMatterDirectory({
  directory,
  documentDirectory,
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
  documentDirectory: ReturnType<typeof useLibraryDocuments>;
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
    <>
      <div className="atlas-library-list library-tree-panel">
        <form className="suite-table-toolbar" onSubmit={onSearch}>
          <label className="suite-table-query">
          <Search aria-hidden="true" />
          <Input
            aria-label="搜索工程事项"
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="查找工程问题或事项标题"
            maxLength={200}
          />
          </label>
          <Button
            type="submit"
            size="sm"
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
        <div {...paneScroll} className="suite-matter-list-scroll"><table className="suite-library-table suite-library-data-table suite-matter-table" aria-label="工程事项">
          <thead><tr><th>标题 / 事项 ID</th><th>工作修订</th><th>更新时间</th><th>关联资料 ATA</th><th>摘要</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{items.map(matter => <tr key={matter.matterId}
            className={matter.matterId === selectedId ? 'selected' : ''}
            data-result-ref={matter.result?.resultRef} data-result-revision={matter.result?.resultRevision}
            tabIndex={0} onClick={() => onSelect(matter.matterId)}
            onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') onSelect(matter.matterId); }}>
            <td><div className="suite-doc-cell"><span><b>{matter.title}</b><small className="suite-library-object-id" title={matter.matterId}>{matter.matterId}</small></span></div></td>
            <td data-label="工作修订"><b>{matter.workingRevision}</b>{matter.result?.roundCompletion === 'IN_PROGRESS' ? <small>分析进行中</small> : null}</td>
            <td data-label="更新时间">{libraryDateLabel(matter.updatedAt)}</td>
            <td data-label="关联资料 ATA" title="关联资料的原文 ATA">{libraryMatterSourceAta(selectedRead?.matter.matterId === matter.matterId ? selectedRead.matter : null,
              documentDirectory.items.filter(document => document.kind === 'DOCUMENT'))}</td>
            <td className="meaning"><LibrarySummaryText expandable={Boolean(matter.result?.listBrief) && matter.overallStatus !== 'NOT_AVAILABLE'} text={matter.overallStatus === 'NOT_AVAILABLE'
              ? '问题正文已保存，综合认识尚未形成。' : matter.result?.listBrief
                ? libraryDistinctBrief(matter.result.listBrief, matter.title) : '尚无已保存摘要'} />
              {matter.overallStatus === 'STALE' ? <small className="atlas-library-attention">问题已更新，综合尚未覆盖</small> : null}
              {matter.overallStatus !== 'NOT_AVAILABLE' && matter.result?.headline && matter.result.headline !== matter.title && matter.result.headline !== matter.result.listBrief
                ? <details className="suite-reading-more" onClick={event => event.stopPropagation()}><summary>已保存认识</summary><p>{matter.result.headline}</p></details> : null}</td>
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
      </div>
      {selected ? (
        <LibraryMatterQuicklook
          key={`${sessionGeneration}:${selected.matterId}`}
          matterId={selected.matterId}
          sessionGeneration={sessionGeneration}
          authenticationRequired={authenticationRequired}
          onRead={setSelectedRead}
          documents={documentDirectory.items.filter(document => document.kind === 'DOCUMENT')}
        />
      ) : <aside className="atlas-library-inspector"><h2>快速理解</h2><p>{selectedId ? '所选事项尚未在当前读取范围内返回，可加载更多或核对筛选。' : '选择一个事项，查看当前认识和关键条件。'}</p></aside>}
    </>
  );
}
