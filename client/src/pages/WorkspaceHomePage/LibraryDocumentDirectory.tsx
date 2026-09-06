import type { FormEvent } from 'react';
import {
  ArrowRight,
  CircleAlert,
  FileBox,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';

import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  byteLabel,
  documentLabel,
  LIBRARY_PHASE_LABELS,
} from './library-document-presentation';
import type { useLibraryDocuments } from './useLibraryDocuments';

interface LibraryDocumentDirectoryProps {
  directory: ReturnType<typeof useLibraryDocuments>;
  authenticationRequired: boolean;
  search: string;
  searchText: string;
  selectedWorkItemId: string;
  quicklookLoading: boolean;
  onSearchTextChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onSelect: (workItemId: string) => void;
}

export function LibraryDocumentDirectory({
  directory,
  authenticationRequired,
  search,
  searchText,
  selectedWorkItemId,
  quicklookLoading,
  onSearchTextChange,
  onSearch,
  onRefresh,
  onSelect,
}: LibraryDocumentDirectoryProps) {
  return (
    <>
      <div className="library-panel-heading">
        <div>
          <span className="library-section-label">浏览资料</span>
          <h2>资料目录</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={directory.loading || authenticationRequired}
          aria-label="刷新资料目录与快览"
        >
          <RefreshCw
            className={directory.loading ? 'library-spin' : undefined}
            aria-hidden="true"
          />
        </Button>
      </div>
      <form className="library-catalog-search" onSubmit={onSearch}>
        <label htmlFor="library-catalog-query">搜索已登记资料</label>
        <div className="library-query-row">
          <div className="library-query-input">
            <Search aria-hidden="true" />
            <Input
              id="library-catalog-query"
              value={searchText}
              maxLength={200}
              onChange={(event) => onSearchTextChange(event.target.value)}
              placeholder="文档编号、文件名或资料类型"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={authenticationRequired}>
            搜索
          </Button>
        </div>
      </form>
      <p className="library-recent-boundary">
        按受理时间从新到旧显示当前账户的资料。目录与快览不会读取原文；来源在打开时核验。
      </p>
      {directory.error ? (
        <div className="library-catalog-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>资料目录未能更新</strong>
            <p>
              {directory.error.message}
              {directory.items.length ? ' 以下保留上次成功读取的目录。' : ''}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onRefresh}>
            重试
          </Button>
        </div>
      ) : null}
      <div className="library-tree-recent-wrapper">
        {directory.items.length ? (
          <ul className="library-recent-rows" aria-label="已登记的工程资料">
            {directory.items.map(
              (document: CanonicalLibraryDocumentSummary) => (
                <li
                  className={`library-recent-item${document.workItemId === selectedWorkItemId ? ' is-selected' : ''}`}
                  key={document.workItemId}
                >
                  <button
                    className="library-recent-open"
                    type="button"
                    aria-pressed={document.workItemId === selectedWorkItemId}
                    onClick={() => onSelect(document.workItemId)}
                  >
                    <FileText aria-hidden="true" />
                    <span>
                      <strong>{documentLabel(document)}</strong>
                      <small>
                        {document.normalizedFamily} ·{' '}
                        {document.businessRevision || '版本未标注'} ·{' '}
                        {LIBRARY_PHASE_LABELS[document.phase] ?? '状态待确认'}
                      </small>
                      <small>
                        {document.originalFilename} ·{' '}
                        {byteLabel(document.byteLength)}
                      </small>
                    </span>
                    {document.workItemId === selectedWorkItemId &&
                    quicklookLoading ? (
                      <LoaderCircle
                        className="library-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" />
                    )}
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : (
          <div className="library-tree-empty" role="status">
            {directory.loading ? (
              <LoaderCircle className="library-spin" aria-hidden="true" />
            ) : (
              <FileBox aria-hidden="true" />
            )}
            <strong>
              {directory.loading
                ? '正在读取资料目录…'
                : directory.error
                  ? '目录暂不可用'
                  : authenticationRequired
                    ? '请先登录'
                    : search
                      ? '没有匹配的资料'
                      : '尚无已登记资料'}
            </strong>
            <p>
              {authenticationRequired
                ? '登录后可读取当前账户的资料目录。'
                : search
                  ? '调整文档编号或文件名后重新搜索。'
                  : '可粘贴已有工作链接，或通过上方受理入口添加获准使用的资料。'}
            </p>
          </div>
        )}
      </div>
      {directory.nextCursor ? (
        <div className="library-catalog-more">
          <Button
            type="button"
            variant="outline"
            onClick={directory.loadMore}
            disabled={directory.loading}
          >
            {directory.loadingMore ? (
              <LoaderCircle className="library-spin" aria-hidden="true" />
            ) : null}
            {directory.loadingMore ? '正在加载…' : '加载更多资料'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
