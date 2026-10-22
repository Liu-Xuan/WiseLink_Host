import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { CanonicalLibraryDocumentSummary, CanonicalLibraryDocumentsResponse } from '@shared/api.interface';
import { listHierarchicalWiki } from '@client/src/api/hierarchical-wiki';
import { Button } from '@client/src/components/ui/button';
import { useSummaryResource } from '@client/src/features/derived-summary/useSummaryResource';
import { wikiStatusLabels } from '@client/src/features/derived-summary/hierarchical-wiki-presentation';
import { LibraryAtaHierarchy } from '../WorkspaceHomePage/LibraryAtaHierarchy';
import { LibraryClassificationControls } from '../WorkspaceHomePage/LibraryClassificationControls';
import { LibraryFleetControls } from '../WorkspaceHomePage/LibraryFleetControls';
import type { LibraryCatalogFilters } from '../WorkspaceHomePage/library-classification';
import { ataDirectoryScopeMatches, type AtaTitleScheme } from '../WorkspaceHomePage/library-ata-directory';
import { useLibraryDocuments } from '../WorkspaceHomePage/useLibraryDocuments';
import { useLibraryFleetCatalog } from '../WorkspaceHomePage/useLibraryFleetCatalog';
import '../WorkspaceHomePage/library-hierarchy.css';

export default function KnowledgeAtaDirectory({
  kind, session, refreshRevision, sourceDirectory, sourceLoading, sourceError,
  filters, onFilterChange, scheme, onSchemeChange, onRefresh, onNextSourcePage,
  selectedDocumentVersionId, onSelectVersion, documentReadingRoute, wikiReadingRoute, onOpenWiki,
}: {
  kind: 'sources' | 'matters' | 'works';
  session: number;
  refreshRevision: number;
  sourceDirectory: CanonicalLibraryDocumentsResponse | null;
  sourceLoading: boolean;
  sourceError: string;
  filters: LibraryCatalogFilters;
  onFilterChange: (filters: LibraryCatalogFilters) => void;
  scheme: AtaTitleScheme;
  onSchemeChange: (scheme: AtaTitleScheme) => void;
  onRefresh: () => void;
  onNextSourcePage: (cursor: string) => void;
  selectedDocumentVersionId: string;
  onSelectVersion: (documentVersionId: string) => void;
  documentReadingRoute: (documentVersionId: string) => string;
  wikiReadingRoute: (summaryId: string) => string;
  onOpenWiki: (summaryId: string) => void;
}) {
  const navigation = useLibraryDocuments('', session, false, refreshRevision,
    'document', '', kind !== 'sources', filters);
  const fleet = useLibraryFleetCatalog(session, true, refreshRevision);
  const loadWiki = useCallback((signal: AbortSignal) => listHierarchicalWiki(signal), []);
  const wiki = useSummaryResource('knowledge-wiki-directory', session, loadWiki,
    { preserveWhileLoading: true, pollIntervalMs: 15_000 });
  const directory = kind === 'sources' ? sourceDirectory : navigation;
  const documents = (directory?.items ?? []).filter((item): item is CanonicalLibraryDocumentSummary => item.kind === 'DOCUMENT');
  const loading = kind === 'sources' ? sourceLoading : navigation.loading;
  const error = kind === 'sources' ? sourceError : navigation.error?.message;
  const nextCursor = directory?.nextCursor;
  const refresh = () => { onRefresh(); wiki.refresh(); };
  return <aside className="knowledge-directory-nav" aria-label="资料与 Wiki 目录">
    <div className="knowledge-directory-heading"><h2>资料与 Wiki</h2>
      <Button type="button" variant="ghost" size="sm" onClick={refresh}>刷新</Button></div>
    <LibraryFleetControls fleet={fleet} counts={directory?.aircraftModelCounts} filters={filters}
      onFilterChange={onFilterChange} disabled={loading} />
    <details className="knowledge-directory-filters"><summary>资料目录筛选</summary>
      <LibraryClassificationControls grouping="ata" showGrouping={false} showFleet={false} onGroupingChange={() => undefined}
        filters={filters} onFilterChange={onFilterChange} counts={directory ?? {}}
        fleet={fleet} disabled={loading} />
    </details>
    {error && kind !== 'sources' ? <p role="alert">{error}</p> : null}
    {wiki.error ? <p role="alert">{wiki.error}</p> : null}
    {loading || (wiki.loading && !wiki.data) ? <p role="status">正在读取目录…</p> : null}
    {documents.length || wiki.data?.items.length || (!loading && !wiki.loading && !error && !wiki.error) ? <LibraryAtaHierarchy navigationOnly
      documents={documents} fleetCatalog={fleet.catalog} filters={filters} hasMore={Boolean(nextCursor)}
      scheme={scheme} onSchemeChange={onSchemeChange} selectedDocumentVersionId={selectedDocumentVersionId}
      onSelect={familyId => {
        const version = documents.find(document => document.familyId === familyId)?.versions[0];
        if (version) onSelectVersion(version.documentVersionId);
      }}
      onSelectVersion={(_familyId, versionId) => onSelectVersion(versionId)} documentReadingRoute={documentReadingRoute}
      showScopeActions={false} wikiScopes={wiki.data?.items.map(item => item.scope)}
      renderNodeActions={(node, path) => <>{wiki.data?.items.filter(item => ataDirectoryScopeMatches(node, path, item.scope)).map(item =>
        <div className="knowledge-wiki-entry" key={item.summaryId}><Link className="knowledge-wiki-link" to={wikiReadingRoute(item.summaryId)} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); onOpenWiki(item.summaryId);
        }}>
          {node.level === 'ata4' ? 'ATA4 Wiki' : node.level === 'ata2' ? 'ATA2 Wiki' : '机型 Wiki'} · {wikiStatusLabels[item.state]}
        </Link>
          {item.waiting.length ? <small>{item.waiting.length}项下层更新待汇总</small> : null}
          {!item.inventoryComplete ? <small>资料盘点进行中</small> : null}
          {item.errorCode ? <p role="alert">更新未完成（{item.errorCode}）。</p> : null}
        </div>)}</>} /> : null}
    {nextCursor ? <Button type="button" variant="outline" size="sm" disabled={loading}
      onClick={() => kind === 'sources' ? onNextSourcePage(nextCursor) : navigation.loadMore()}>加载更多资料</Button> : null}
  </aside>;
}
