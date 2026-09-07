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

import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  byteLabel,
  documentLabel,
  LIBRARY_PHASE_LABELS,
} from './library-document-presentation';
import type { useLibraryDocuments } from './useLibraryDocuments';
import { libraryEntryId } from './library-document-read';
import { libraryDateLabel } from './library-document-presentation';

interface LibraryDocumentDirectoryProps {
  directory: ReturnType<typeof useLibraryDocuments>;
  authenticationRequired: boolean;
  search: string;
  searchText: string;
  mode: 'document' | 'matter';
  selectedId: string;
  quicklookLoading: boolean;
  onSearchTextChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onSelect: (itemId: string) => void;
}

export function LibraryDocumentDirectory({
  directory,
  authenticationRequired,
  search,
  searchText,
  mode,
  selectedId,
  quicklookLoading,
  onSearchTextChange,
  onSearch,
  onRefresh,
  onSelect,
}: LibraryDocumentDirectoryProps) {
  const taskMode = mode === 'matter';
  const label = taskMode ? '评估任务' : '工程文档';
  return (
    <>
      <div className="library-panel-heading">
        <div>
          <span className="library-section-label">
            {taskMode ? '任务记录' : '文档管理'}
          </span>
          <h2>{taskMode ? '最近任务' : '工程文档'}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={directory.loading || authenticationRequired}
          aria-label={`刷新${label}`}
        >
          <RefreshCw
            className={directory.loading ? 'library-spin' : undefined}
            aria-hidden="true"
          />
        </Button>
      </div>
      <form className="library-catalog-search" onSubmit={onSearch}>
        <label htmlFor="library-catalog-query">搜索{label}</label>
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
        {taskMode
          ? '按创建时间显示当前账户的评估任务，同一文档可以有多次评估。'
          : '每个 family 显示一份工程文档，当前版本与历史版本由文档管理模块统一管理。'}
      </p>
      {directory.error ? (
        <div className="library-catalog-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>{label}未能更新</strong>
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
          <ul className="library-recent-rows" aria-label={label}>
            {directory.items.map((document) => {
              const itemId = libraryEntryId(document);
              const version =
                document.kind === 'DOCUMENT'
                  ? document.versions.find(
                      (item) => item.selectedVersionIsCurrent,
                    )
                  : null;
              return (
                <li
                  className={`library-recent-item${itemId === selectedId ? ' is-selected' : ''}`}
                  key={itemId}
                >
                  <button
                    className="library-recent-open"
                    type="button"
                    aria-pressed={itemId === selectedId}
                    onClick={() => onSelect(itemId)}
                  >
                    <FileText aria-hidden="true" />
                    <span>
                      <strong>{documentLabel(document)}</strong>
                      {document.kind === 'DOCUMENT' ? (
                        <>
                          <small>
                            {document.normalizedFamily} ·{' '}
                            {version
                              ? `当前版本 ${version.businessRevision || '未标注'}`
                              : '当前版本不可见'}{' '}
                            · {document.versions.length} 个可见版本
                          </small>
                          <small>
                            {document.issuerAuthority} ·{' '}
                            {document.workItemCount} 个评估任务
                          </small>
                        </>
                      ) : (
                        <>
                          <small>
                            {document.normalizedFamily} ·{' '}
                            {document.businessRevision || '版本未标注'} ·{' '}
                            {LIBRARY_PHASE_LABELS[document.phase] ??
                              '状态待确认'}
                          </small>
                          <small>
                            {libraryDateLabel(document.createdAt)} · 任务{' '}
                            {document.workItemId.slice(-8)} ·{' '}
                            {byteLabel(document.byteLength)}
                          </small>
                        </>
                      )}
                    </span>
                    {itemId === selectedId && quicklookLoading ? (
                      <LoaderCircle
                        className="library-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
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
                ? `正在读取${label}…`
                : directory.error
                  ? '目录暂不可用'
                  : authenticationRequired
                    ? '请先登录'
                    : search
                      ? `没有匹配的${label}`
                      : `尚无${label}`}
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
            {directory.loadingMore ? '正在加载…' : `加载更多${label}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}
