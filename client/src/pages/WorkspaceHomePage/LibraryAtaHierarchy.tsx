import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import type { DerivedSummaryScopeSelection } from '@shared/derived-summary.interface';
import { LibraryDocumentTableHead, LibraryDocumentVersionRow } from './LibraryDocumentRows';
import { DocumentVersionLink } from './DocumentVersionLink';
import { documentLabel, libraryVersionLabel } from './library-document-presentation';
import { ataDirectoryLabel, buildLibraryAtaDirectory, libraryAtaChapterDirectory, libraryAtaScopeNodes, type AtaDirectoryNode, type AtaTitleScheme } from './library-ata-directory';
import type { LibraryCatalogFilters } from './library-classification';
import { libraryAtaSummaryParams } from './library-summary-entry';
import { libraryAircraftModelsQuery } from '@shared/library-aircraft-mentions';

export function LibraryAtaHierarchy({ documents, fleetCatalog, filters, hasMore, scheme, onSelect,
  selectedId = '', selectedDocumentVersionId = '', onSelectVersion, navigationOnly = false,
  fleetLoading = false, fleetError = null, wikiScopes = [], renderNodeActions, documentReadingRoute, showScopeActions = true }: {
  documents: CanonicalLibraryDocumentSummary[];
  fleetCatalog: CanonicalLibraryFleetCatalog | null;
  filters: LibraryCatalogFilters;
  hasMore: boolean;
  scheme?: AtaTitleScheme;
  onSchemeChange?: (scheme: AtaTitleScheme) => void;
  onSelect: (familyId: string) => void;
  selectedId?: string;
  selectedDocumentVersionId?: string;
  onSelectVersion?: (familyId: string, versionId: string) => void;
  navigationOnly?: boolean;
  fleetLoading?: boolean;
  fleetError?: string | null;
  wikiScopes?: DerivedSummaryScopeSelection[];
  renderNodeActions?: (node: AtaDirectoryNode, path: string[]) => ReactNode;
  documentReadingRoute?: (documentVersionId: string) => string;
  showScopeActions?: boolean;
}) {
  try { if (filters.aircraftModels) libraryAircraftModelsQuery(filters.aircraftModels); }
  catch { return <section className="library-ata-results" role="alert">机型筛选参数无效，请重新选择。</section>; }
  if (!navigationOnly && (filters.fleetFamily || filters.fleetModel) &&
      (fleetLoading || fleetError || fleetCatalog?.status !== 'AVAILABLE')) {
    return <section className="library-ata-results" aria-label="ATA 范围文档版本">
      {fleetLoading ? <p role="status">正在读取机队范围，暂不能判断匹配资料。</p> :
        <p role="alert">{fleetError ? '机队范围未能读取' : '机队范围暂不可用'}，暂不能判断匹配资料。{fleetError ? ` ${fleetError}` : ''}</p>}
    </section>;
  }
  const sourceRoots = buildLibraryAtaDirectory(documents, fleetCatalog, filters, wikiScopes);
  const roots = libraryAtaChapterDirectory(sourceRoots, wikiScopes);
  const fleetWikiNodes = libraryAtaScopeNodes(sourceRoots, wikiScopes).filter(entry =>
    entry.node.level === 'fleet' || entry.node.level === 'model');
  const items = [...new Map(roots.flatMap(node => node.items).map(item =>
    [JSON.stringify([item.document.familyId, item.version.documentVersionId]), item])).values()];
  if (!navigationOnly) return <section className="library-ata-results" aria-label="ATA 范围文档版本">
    {items.length ? <div className="suite-library-table-wrap"><table className="suite-library-table suite-library-data-table suite-document-table">
      <LibraryDocumentTableHead /><tbody>{items.map(({ document, version }) => (
        <LibraryDocumentVersionRow key={JSON.stringify([document.familyId, version.documentVersionId])}
          document={document} version={version}
          selected={selectedId === document.familyId && selectedDocumentVersionId === version.documentVersionId}
          onSelect={() => onSelectVersion ? onSelectVersion(document.familyId, version.documentVersionId) : onSelect(document.familyId)} />
      ))}</tbody>
    </table></div> : <p role="status">本批获权版本没有匹配资料。</p>}
  </section>;
  function branches(nodes: AtaDirectoryNode[], path: string[] = []) {
    return <div className="library-category-tree" data-depth={path.length}>{nodes.map(node => {
      const key = [...path, `${node.level}:${node.key}`];
      const directItems = node.directItems ?? (!node.children.length ? node.items : []);
      return <details key={node.key} data-reading-key={`ata:${JSON.stringify(key)}`} open={Boolean(filters.ata || filters.ata2)}>
        <summary><span className="library-branch-label"><strong>{node.level === 'ata2' || node.level === 'ata4' ? ataDirectoryLabel(node.key, scheme ?? 'ispec') : node.label}</strong></span>{node.items.length ? <small>{new Set(node.items.map(item => item.document.familyId)).size}</small> : null}</summary>
        {renderNodeActions && node.scopePaths?.length ? <div className="library-ata-node-actions">
          {node.scopePaths.map(scopePath => <div key={JSON.stringify(scopePath)}>{renderNodeActions(node, scopePath)}</div>)}
        </div> : null}
        {directItems.length ? <ul className="library-ata-navigation-docs">
          {directItems.map(({ document, version }) => <li key={JSON.stringify([document.familyId, version.documentVersionId])}>
            <button type="button" onClick={() => onSelectVersion ? onSelectVersion(document.familyId, version.documentVersionId) : onSelect(document.familyId)}>
              {documentLabel(document)} · {libraryVersionLabel(version)}
            </button>
            {documentReadingRoute ? <Link to={documentReadingRoute(version.documentVersionId)}>阅读</Link>
              : <DocumentVersionLink compact version={version} familyId={document.familyId}>阅读</DocumentVersionLink>}
          </li>)}
        </ul> : null}
        {node.children.length ? branches(node.children, key) : null}
        {showScopeActions && node.level === 'ata4' && /^\d{2}-\d{2}$/u.test(node.key) ?
          <details className="library-ata-node-more"><summary>范围操作</summary>
            <div className="library-ata-scope-actions">
              <Link to={`/summaries?${libraryAtaSummaryParams(node, [...(filters.fleetFamily ? [`fleet:${filters.fleetFamily}`] : []),
                ...(filters.fleetModel ? [`model:${filters.fleetModel}`] : []), ...path])}`}>已有资料综合</Link>
              <Link to={`/summaries/new?${libraryAtaSummaryParams(node, [...(filters.fleetFamily ? [`fleet:${filters.fleetFamily}`] : []),
                ...(filters.fleetModel ? [`model:${filters.fleetModel}`] : []), ...path])}`}>创建资料综合</Link>
            </div>
          </details> : null}
      </details>;
    })}</div>;
  }
  return <section className="library-hierarchy library-ata-hierarchy" aria-label="ATA 目录">
    <div className="library-ata-toolbar"><strong>ATA 目录</strong>{hasMore ? <span>可加载更多</span> : null}</div>
    {roots.some(node => node.level !== 'raw') ? branches(roots.filter(node => node.level !== 'raw')) : null}
    {roots.some(node => node.level === 'raw') ? <details className="library-directory-anomalies"><summary>未分类与待核</summary>
      {branches(roots.filter(node => node.level === 'raw'))}</details> : null}
    {fleetWikiNodes.length && renderNodeActions ? <details className="library-wiki-directory"><summary>机型 Wiki</summary>
      {fleetWikiNodes.map(entry => <div key={JSON.stringify(entry.path)}><strong>{entry.node.label}</strong>
        {renderNodeActions(entry.node, entry.path)}</div>)}</details> : null}
    {!roots.length && !fleetWikiNodes.length ? <p role="status">当前范围没有资料。</p> : null}
  </section>;
}
