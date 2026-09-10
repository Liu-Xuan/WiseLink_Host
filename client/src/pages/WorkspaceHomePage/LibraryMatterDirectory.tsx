import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, RefreshCw, Search } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import type useMatterDirectory from '@client/src/features/matter/useMatterDirectory';
import { matterOverviewRoute } from '@client/src/features/matter/matter-navigation';
import { libraryDateLabel } from './library-document-presentation';
import LibraryMatterQuicklook from './LibraryMatterQuicklook';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { savedReadingSummary } from '@client/src/features/matter/AssessmentReadingListSummary';

export default function LibraryMatterDirectory({
  directory,
  authenticationRequired,
  sessionGeneration,
  searchText,
  onSearchTextChange,
  onSearch,
  onRefresh,
  onCreateFromTask,
  filteredByWorkItem,
  onViewAll,
}: {
  directory: ReturnType<typeof useMatterDirectory>;
  authenticationRequired: boolean;
  sessionGeneration: number;
  searchText: string;
  onSearchTextChange(value: string): void;
  onSearch(event: FormEvent<HTMLFormElement>): void;
  onRefresh(): void;
  onCreateFromTask(): void;
  filteredByWorkItem: boolean;
  onViewAll(): void;
}) {
  const [selectedId, setSelectedId] = useState('');
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
        }
      : item;
  });
  const selected = directory.items.find((item) => item.matterId === selectedId);
  return (
    <section
      className={`atlas-library-browser${selected ? ' has-inspector' : ''}`}
      aria-label="工程事项目录"
      aria-busy={directory.loading}
    >
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
        <div className="atlas-library-columns" aria-hidden="true">
          <span>工程问题</span>
          <span>当前认识与决定性条件</span>
          <span>我方评估</span>
          <span>阅读</span>
        </div>
        <ul className="atlas-library-rows" aria-label="工程事项">
          {items.map((matter) => (
            <li
              key={matter.matterId}
              className={matter.matterId === selectedId ? 'is-selected' : ''}
              data-result-ref={matter.result?.resultRef}
              data-result-revision={matter.result?.resultRevision}
            >
              <button
                type="button"
                className="atlas-library-select"
                aria-pressed={matter.matterId === selectedId}
                onClick={() => setSelectedId(matter.matterId)}
              >
                <span className="atlas-library-subject">
                  <BookOpen aria-hidden="true" />
                  <span>
                    <strong>{matter.title}</strong>
                    <small>{libraryDateLabel(matter.updatedAt)}</small>
                  </span>
                </span>
                <span className="atlas-library-brief">
                  {matter.result ? (
                    <>
                      <strong>{matter.result.headline}</strong>
                      <span>{matter.result.listBrief}</span>
                      {matter.result.decisiveClaims.map((claim) => (
                        <span
                          key={claim.claimId}
                          className="atlas-library-decisive"
                        >
                          {claim.text}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span>
                      尚无已保存的事项综合认识。打开事项查看资料与问题。
                    </span>
                  )}
                </span>
                <span className="atlas-library-progress">
                  <strong>
                    {matter.result?.roundCompletion === 'IN_PROGRESS'
                      ? '分析进行中'
                      : matter.result
                        ? '已有候选认识'
                        : '待形成认识'}
                  </strong>
                  <small>工作修订 {matter.workingRevision}</small>
                  <small>实施与故障：未核实</small>
                </span>
              </button>
              <Link
                className="atlas-library-open"
                to={matterOverviewRoute(matter.matterId)}
                aria-label={`进入事项：${matter.title}`}
              >
                简报 <ArrowRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
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
          onClose={() => setSelectedId('')}
          onRead={setSelectedRead}
        />
      ) : null}
    </section>
  );
}
