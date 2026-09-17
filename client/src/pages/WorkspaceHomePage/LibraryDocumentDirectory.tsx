import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
import AssessmentReadingListSummary, {
  savedReadingSummary,
} from '@client/src/features/matter/AssessmentReadingListSummary';
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
  libraryVersionLabel,
} from './library-document-presentation';
import type { useLibraryDocuments } from './useLibraryDocuments';
import type { LibraryFleetRead } from './useLibraryFleetCatalog';
import { libraryEntryId } from './library-document-read';
import { libraryDateLabel } from './library-document-presentation';
import { LibraryHierarchy } from './LibraryHierarchy';
import LibraryDocumentRows from './LibraryDocumentRows';
import { LibraryClassificationControls } from './LibraryClassificationControls';
import type {
  LibraryCatalogFilters,
  LibraryGrouping,
} from './library-classification';

interface LibraryDocumentDirectoryProps {
  directory: ReturnType<typeof useLibraryDocuments>;
  authenticationRequired: boolean;
  sessionGeneration?: number;
  search: string;
  searchText: string;
  mode: 'document' | 'tasks';
  selectedId: string;
  quicklookLoading: boolean;
  selectedReadingResult?: AssessmentReadingResult | null;
  onSearchTextChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
  onSelect: (itemId: string) => void;
  filters?: LibraryCatalogFilters;
  fleet?: LibraryFleetRead;
  onFilterChange?: (filters: LibraryCatalogFilters) => void;
  presentation?: { grouping: LibraryGrouping; view: 'list' | 'tree' };
  onPresentationChange?: (value: { grouping: LibraryGrouping; view: 'list' | 'tree' }) => void;
}

export function LibraryDocumentDirectory({
  directory,
  authenticationRequired,
  sessionGeneration = 0,
  search,
  searchText,
  mode,
  selectedId,
  quicklookLoading,
  selectedReadingResult,
  onSearchTextChange,
  onSearch,
  onRefresh,
  onSelect,
  filters = {},
  fleet,
  onFilterChange,
  presentation,
  onPresentationChange,
}: LibraryDocumentDirectoryProps) {
  const [localGrouping, setLocalGrouping] = useState<LibraryGrouping>('category');
  const [localView, setLocalView] = useState<'list' | 'tree'>('list');
  const [params, setParams] = useSearchParams();
  const expandedFamilyIds = (params.get('expandedFamilyIds') ?? '').split(',').filter(Boolean);
  const selectedDocumentVersionId = mode === 'document' ? params.get('selectedDocumentVersionId') ?? '' : '';
  const compact = params.get('density') === 'compact';
  const grouping = presentation?.grouping ?? localGrouping;
  const catalogView = presentation?.view ?? localView;
  const setGrouping = (value: LibraryGrouping) => onPresentationChange ? onPresentationChange({ grouping: value, view: catalogView }) : setLocalGrouping(value);
  const setCatalogView = (value: 'list' | 'tree') => onPresentationChange ? onPresentationChange({ grouping, view: value }) : setLocalView(value);
  const toggleFamily = (familyId: string) => {
    const next = expandedFamilyIds.includes(familyId)
      ? expandedFamilyIds.filter((id) => id !== familyId)
      : [...expandedFamilyIds, familyId];
    const nextParams = new URLSearchParams(params);
    if (next.length) nextParams.set('expandedFamilyIds', next.join(','));
    else nextParams.delete('expandedFamilyIds');
    setParams(nextParams);
  };
  const toggleDensity = () => {
    const nextParams = new URLSearchParams(params);
    if (compact) nextParams.delete('density');
    else nextParams.set('density', 'compact');
    setParams(nextParams);
  };
  const selectVersion = (familyId: string, documentVersionId: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('mode', 'document');
    nextParams.set('familyId', familyId);
    nextParams.set('selectedDocumentVersionId', documentVersionId);
    nextParams.delete('quicklookY');
    nextParams.delete('workItemId');
    setParams(nextParams);
  };
  const taskMode = mode === 'tasks';
  const filtered = Boolean(search || Object.values(filters).some(Boolean));
  const label = taskMode ? '评估任务' : '工程文档';
  return (
    <>
      <form className="suite-table-toolbar" onSubmit={onSearch}>
        <div className="suite-table-tabs"><strong>{taskMode ? '评估任务' : '工程文档'}</strong><button type="button" onClick={() => setParams({ mode: 'matter' })}>工程事项</button></div>
        <label className="suite-table-query"><Search aria-hidden="true" /><Input aria-label={`搜索${label}`} value={searchText} maxLength={200} onChange={event => onSearchTextChange(event.target.value)} placeholder="名称、主题与版本…" /></label>
        <Button type="submit" size="sm" variant="outline" disabled={authenticationRequired}>搜索</Button>
        <Button type="button" variant="ghost" size="icon" onClick={onRefresh} disabled={directory.loading || authenticationRequired} aria-label={`刷新${label}`}><RefreshCw aria-hidden="true" /></Button>
        {!taskMode ? <Button type="button" variant="ghost" size="sm" onClick={toggleDensity}>{compact ? '标准行距' : '紧凑行距'}</Button> : null}
      </form>
      {!taskMode ? <details className="atlas-library-filters suite-library-filters"><summary>筛选与目录</summary>
        <div className="atlas-library-view-switch"><Button variant="outline" aria-pressed={catalogView === 'list'} onClick={() => setCatalogView('list')}>文档列表</Button><Button variant="outline" aria-pressed={catalogView === 'tree'} onClick={() => setCatalogView('tree')}>分类目录</Button></div>
        <LibraryClassificationControls grouping={grouping} onGroupingChange={setGrouping} filters={filters} onFilterChange={onFilterChange ?? (() => undefined)} counts={directory} fleet={fleet} disabled={authenticationRequired || directory.loading || !onFilterChange} />
      </details> : null}
      {!taskMode &&
      !directory.items.length &&
      directory.totalCount !== undefined ? (
        <p className="library-classification-note">
          当前搜索与筛选共 {directory.totalCount} 份文档。
        </p>
      ) : null}
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
        {directory.items.length && !taskMode && catalogView === 'list' ? (
            <LibraryDocumentRows sessionGeneration={sessionGeneration}
            documents={directory.items.filter(
              (item) => item.kind === 'DOCUMENT',
            )}
            selectedId={selectedId}
              onSelect={onSelect}
              selectedDocumentVersionId={selectedDocumentVersionId}
              onSelectVersion={selectVersion}
              expandedFamilyIds={expandedFamilyIds}
              compact={compact}
              onToggleFamily={toggleFamily}
            />
        ) : directory.items.length && !taskMode ? (
          <LibraryHierarchy
            documents={directory.items.filter(
              (item) => item.kind === 'DOCUMENT',
            )}
            selectedId={selectedId}
            hasMore={Boolean(directory.nextCursor)}
            totalCount={directory.totalCount}
            grouping={grouping}
            filters={filters}
            fleetCatalog={fleet?.catalog ?? null}
            onFilterChange={onFilterChange}
            disabled={authenticationRequired || directory.loading}
            onSelect={onSelect}
          />
        ) : directory.items.length ? (
          <ul className="library-recent-rows" aria-label={label}>
            {directory.items.map((document) => {
              const itemId = libraryEntryId(document);
              const summary =
                document.kind === 'TASK'
                  ? selectedId === itemId &&
                    selectedReadingResult?.scope.kind === 'WORK_ITEM' &&
                    selectedReadingResult.scope.workItemId ===
                      document.workItemId &&
                    selectedReadingResult.scope.documentVersionId ===
                      document.documentVersionId
                    ? savedReadingSummary(
                        selectedReadingResult,
                        document.readingSummary,
                      )
                    : document.readingSummary
                  : null;
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
                              ? `当前版本 ${libraryVersionLabel(version)}`
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
                            {libraryVersionLabel(document)} ·{' '}
                            {LIBRARY_PHASE_LABELS[document.phase] ??
                              '状态待确认'}
                          </small>
                          <small>
                            {libraryDateLabel(document.createdAt)} · 任务{' '}
                            {document.workItemId.slice(-8)} ·{' '}
                            {byteLabel(document.byteLength)}
                          </small>
                          {summary ? (
                            <AssessmentReadingListSummary summary={summary} />
                          ) : null}
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
                    : filtered
                      ? `没有匹配的${label}`
                      : `尚无${label}`}
            </strong>
            <p>
              {authenticationRequired
                ? '登录后可读取当前账户的资料目录。'
                : filtered
                  ? '调整搜索内容或分类筛选后重试。'
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
