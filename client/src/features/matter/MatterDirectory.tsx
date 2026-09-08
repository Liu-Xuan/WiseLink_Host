import type { FC, FormEvent } from 'react';
import { ArrowRight, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { libraryDateLabel } from '@client/src/pages/WorkspaceHomePage/library-document-presentation';
import AssessmentReadingListSummary from './AssessmentReadingListSummary';
import { matterOverviewRoute } from './matter-navigation';
import type useMatterDirectory from './useMatterDirectory';

interface MatterDirectoryProps {
  directory: ReturnType<typeof useMatterDirectory>;
  authenticationRequired: boolean;
  search: string;
  searchText: string;
  filteredByWorkItem: boolean;
  onSearchTextChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onCreateFromTask: () => void;
  onViewAll: () => void;
}

const MatterDirectory: FC<MatterDirectoryProps> = ({
  directory,
  authenticationRequired,
  search,
  searchText,
  filteredByWorkItem,
  onSearchTextChange,
  onSearch,
  onRefresh,
  onCreateFromTask,
  onViewAll,
}) => (
  <section
    className="library-tree-panel"
    aria-label="工程事项目录"
    aria-busy={directory.loading}
  >
    <div className="library-panel-heading">
      <div>
        <span className="library-section-label">跨材料的工作认识</span>
        <h2>工程事项</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={onCreateFromTask}
          disabled={authenticationRequired}
        >
          从已有任务建立事项
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="刷新事项目录"
          onClick={onRefresh}
          disabled={directory.loading || authenticationRequired}
        >
          <RefreshCw
            aria-hidden="true"
            className={directory.loading ? 'library-spin' : undefined}
          />
        </Button>
      </div>
    </div>
    <form className="library-catalog-search" onSubmit={onSearch}>
      <label htmlFor="matter-catalog-query">搜索工程事项</label>
      <div className="library-query-row">
        <div className="library-query-input">
          <Search aria-hidden="true" />
          <Input
            id="matter-catalog-query"
            value={searchText}
            maxLength={200}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="事项标题"
          />
        </div>
        <Button type="submit" disabled={authenticationRequired}>
          搜索
        </Button>
      </div>
    </form>
    <p className="library-recent-boundary">
      每行是一个真实工程事项；摘要来自其已保存综合结果，不会把成员任务的结果拼成事项认识。
    </p>
    {filteredByWorkItem ? (
      <p className="library-recent-boundary">
        仅显示关联所选任务的事项。
        <Button variant="ghost" onClick={onViewAll}>
          查看全部事项
        </Button>
      </p>
    ) : null}
    {directory.error ? (
      <div className="library-catalog-error" role="alert">
        <p>
          {directory.error}
          {directory.items.length ? ' 以下保留上次成功读取的目录。' : ''}
        </p>
        <Button variant="outline" onClick={onRefresh}>
          重试
        </Button>
      </div>
    ) : null}
    {directory.items.length ? (
      <ul className="library-recent-rows" aria-label="工程事项">
        {directory.items.map((matter) => (
          <li key={matter.matterId} className="library-recent-item">
            <Link
              className="library-recent-open"
              to={matterOverviewRoute(matter.matterId)}
            >
              <span>
                <strong className="library-saved-list-brief">
                  {matter.title}
                </strong>
                <small>
                  {libraryDateLabel(matter.updatedAt)} · 工作修订{' '}
                  {matter.workingRevision}
                </small>
                {matter.result ? (
                  <AssessmentReadingListSummary summary={matter.result} />
                ) : (
                  <small className="library-saved-list-brief">
                    尚未形成事项综合认识，可进入简报继续核对。
                  </small>
                )}
              </span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    ) : (
      <div className="library-tree-empty" role="status">
        {directory.loading ? (
          <LoaderCircle className="library-spin" aria-hidden="true" />
        ) : null}
        <strong>
          {authenticationRequired
            ? '请先登录'
            : directory.loading
              ? '正在读取工程事项…'
              : directory.error
                ? '目录暂不可用'
                : search
                  ? '没有匹配的工程事项'
                  : '尚无工程事项'}
        </strong>
        <p>
          选择一个已有任务作为主要材料，即可建立工程事项。后续可继续关联资料并核对其贡献。
        </p>
      </div>
    )}
    {directory.nextCursor ? (
      <div className="library-catalog-more">
        <Button
          variant="outline"
          onClick={directory.loadMore}
          disabled={directory.loading}
        >
          {directory.loadingMore ? '正在加载…' : '加载更多事项'}
        </Button>
      </div>
    ) : null}
  </section>
);

export default MatterDirectory;
