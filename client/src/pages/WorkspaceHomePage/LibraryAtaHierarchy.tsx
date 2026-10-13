import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Link } from 'react-router-dom';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { Button } from '@client/src/components/ui/button';
import { LibraryDocumentTableHead, LibraryDocumentVersionRow } from './LibraryDocumentRows';
import { DocumentVersionLink } from './DocumentVersionLink';
import { documentLabel, libraryVersionLabel } from './library-document-presentation';
import { ataDirectoryLabel, ataDirectoryTitles, buildLibraryAtaDirectory, type AtaDirectoryNode, type AtaTitleScheme } from './library-ata-directory';
import type { LibraryCatalogFilters } from './library-classification';
import { libraryAtaSummaryParams } from './library-summary-entry';

export function LibraryAtaHierarchy({ documents, fleetCatalog, filters, hasMore, scheme, onSchemeChange, onSelect,
  selectedId = '', selectedDocumentVersionId = '', onSelectVersion, navigationOnly = false,
  fleetLoading = false, fleetError = null }: {
  documents: CanonicalLibraryDocumentSummary[];
  fleetCatalog: CanonicalLibraryFleetCatalog | null;
  filters: LibraryCatalogFilters;
  hasMore: boolean;
  scheme: AtaTitleScheme;
  onSchemeChange: (scheme: AtaTitleScheme) => void;
  onSelect: (familyId: string) => void;
  selectedId?: string;
  selectedDocumentVersionId?: string;
  onSelectVersion?: (familyId: string, versionId: string) => void;
  navigationOnly?: boolean;
  fleetLoading?: boolean;
  fleetError?: string | null;
}) {
  if (!navigationOnly && (filters.fleetFamily || filters.fleetModel) &&
      (fleetLoading || fleetError || fleetCatalog?.status !== 'AVAILABLE')) {
    return <section className="library-ata-results" aria-label="ATA 范围文档版本">
      {fleetLoading ? <p role="status">正在读取机队范围，暂不能判断匹配资料。</p> :
        <p role="alert">{fleetError ? '机队范围未能读取' : '机队范围暂不可用'}，暂不能判断匹配资料。{fleetError ? ` ${fleetError}` : ''}</p>}
    </section>;
  }
  const roots = buildLibraryAtaDirectory(documents, fleetCatalog, filters);
  const items = [...new Map(roots.flatMap(node => node.items).map(item =>
    [JSON.stringify([item.document.familyId, item.version.documentVersionId]), item])).values()];
  if (!navigationOnly) return <section className="library-ata-results" aria-label="ATA 范围文档版本">
    {items.length ? <div className="suite-library-table-wrap"><table className="suite-library-table suite-library-data-table">
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
      const titles = node.level === 'ata2' || node.level === 'ata4' ? ataDirectoryTitles(node.key, scheme) : [];
      const leafTitles = [...titles, ...path.filter(segment => segment.startsWith('ata2:'))
        .flatMap(segment => ataDirectoryTitles(segment.slice(5), scheme))];
      return <details key={node.key} data-reading-key={`ata:${JSON.stringify(key)}`} open={path.length === 0 || Boolean(filters.ata)}>
        <summary><span className="library-branch-label"><strong>{node.level === 'ata2' || node.level === 'ata4' ? ataDirectoryLabel(node.key, scheme) : node.label}</strong></span><small>{new Set(node.items.map(item => item.document.familyId)).size} 份 · {node.items.length} 版</small></summary>
        {node.children.length ? branches(node.children, key) : <ul className="library-ata-navigation-docs">
          {node.items.map(({ document, version }) => <li key={JSON.stringify([document.familyId, version.documentVersionId])}>
            <button type="button" onClick={() => onSelectVersion ? onSelectVersion(document.familyId, version.documentVersionId) : onSelect(document.familyId)}>
              {documentLabel(document)} · {libraryVersionLabel(version)}
            </button>
            <DocumentVersionLink compact version={version} familyId={document.familyId}>阅读</DocumentVersionLink>
          </li>)}
        </ul>}
        {!node.children.length && (leafTitles.length || node.level === 'ata4') ? <details className="library-ata-node-more">
          <summary>章节来源与范围操作</summary>
          <div className="library-ata-titles">{leafTitles.map(title => <div key={JSON.stringify([title.titleZH, title.titleEN])}>
            <p lang="en">{title.titleEN || '英文标题待核'}</p>
            <ul>{title.sources.map(source => <li key={source}>{source}</li>)}</ul>
          </div>)}</div>
          {node.level === 'ata4' && /^\d{2}-\d{2}$/u.test(node.key) ? <div className="library-ata-scope-actions">
            <Link to={`/summaries?${libraryAtaSummaryParams(node, path)}`}>已有概述</Link>
            <Link to={`/summaries/new?${libraryAtaSummaryParams(node, path)}`}>形成概述</Link>
          </div> : null}
        </details> : null}
      </details>;
    })}</div>;
  }
  return <section className="library-hierarchy library-ata-hierarchy" aria-label="机型与 ATA 目录">
    <div className="library-ata-toolbar">
      <strong>机型 / ATA</strong>
      <div role="group" aria-label="ATA 标题附件">
        <Button type="button" size="sm" variant="ghost" aria-pressed={scheme === 'ispec'} onClick={() => onSchemeChange('ispec')}>iSpec</Button>
        <Button type="button" size="sm" variant="ghost" aria-pressed={scheme === 'jasc'} onClick={() => onSchemeChange('jasc')}>JASC</Button>
      </div>
      <details className="library-ata-guide"><summary>目录说明</summary>
        <div>
          <p>机型 → ATA2 → ATA4 → 文档版本</p>
          {hasMore ? <p>可在下方加载更多版本。</p> : null}
          <details><summary>章节与机型来源</summary>
            <p>机型提及与 ATA 取自同一文档版本。章节标题来自已收录的 2026-09-10 附件摘录，可展开查看源行；附件版次、机型及 iSpec/JASC 对应关系尚未核验。</p>
            <p>含分隔符的标注保留在“原始 ATA 标注”中，含义尚未确认。</p>
          </details>
        </div>
      </details>
    </div>
    {roots.length ? branches(roots) : <p role="status">本批获权版本没有可显示的分类路径。</p>}
  </section>;
}
