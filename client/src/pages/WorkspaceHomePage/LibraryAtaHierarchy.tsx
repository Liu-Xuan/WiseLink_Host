import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import type { CanonicalLibraryFleetCatalog } from '@shared/library-fleet.interface';
import { Button } from '@client/src/components/ui/button';
import { DocumentVersionLink } from './DocumentVersionLink';
import { documentLabel, libraryVersionLabel } from './library-document-presentation';
import { metadataValues, type LibraryCatalogFilters } from './library-classification';
import { ataDirectoryTitles, buildLibraryAtaDirectory, type AtaDirectoryNode, type AtaTitleScheme } from './library-ata-directory';

export function LibraryAtaHierarchy({ documents, fleetCatalog, filters, hasMore, scheme, onSchemeChange, onSelect }: {
  documents: CanonicalLibraryDocumentSummary[];
  fleetCatalog: CanonicalLibraryFleetCatalog | null;
  filters: LibraryCatalogFilters;
  hasMore: boolean;
  scheme: AtaTitleScheme;
  onSchemeChange: (scheme: AtaTitleScheme) => void;
  onSelect: (familyId: string) => void;
}) {
  const roots = buildLibraryAtaDirectory(documents, fleetCatalog, filters);
  function branches(nodes: AtaDirectoryNode[], path: string[] = []) {
    return <div className="library-category-tree" data-depth={path.length}>{nodes.map(node => {
      const key = [...path, `${node.level}:${node.key}`];
      const titles = node.level === 'ata2' || node.level === 'ata4' ? ataDirectoryTitles(node.key, scheme) : [];
      return <details key={node.key} data-reading-key={`ata:${JSON.stringify(key)}`} open={path.length === 0}>
        <summary><span className="library-branch-label"><strong>{node.label}</strong></span><small>已加载 {new Set(node.items.map(item => item.document.familyId)).size} 份 / {node.items.length} 个版本</small></summary>
        {node.level === 'ata2' || node.level === 'ata4' ? <div className="library-ata-titles">
          {titles.length ? titles.map(title => <details key={JSON.stringify([title.titleZH, title.titleEN])}>
            <summary>{title.titleZH || '中文标题待核'} · <span lang="en">{title.titleEN || '英文标题待核'}</span></summary>
            <ul>{title.sources.map(source => <li key={source}>{source}</li>)}</ul>
          </details>) : <p>附件未提供可核对的中英文标题</p>}
        </div> : null}
        {node.children.length ? branches(node.children, key) : <ul className="library-version-tree">{node.items.map(({ document, version }) => <li key={JSON.stringify([document.familyId, version.documentVersionId])}>
          <DocumentVersionLink version={version} familyId={document.familyId}><strong>{documentLabel(document)}</strong><span>{libraryVersionLabel(version)} · {version.selectedVersionIsCurrent ? '当前版本' : '历史版本'}</span><small>{metadataValues(version.extractedMetadata?.title).join(' / ') || '文档标题待核'}</small><small>原文 ATA 观察：{metadataValues(version.extractedMetadata?.ata).join(' / ') || '未提取'}</small></DocumentVersionLink>
          <Button size="sm" variant="ghost" onClick={() => onSelect(document.familyId)}>查看文档快览</Button>
        </li>)}</ul>}
      </details>;
    })}</div>;
  }
  return <section className="library-hierarchy library-ata-hierarchy" aria-label="机型与 ATA 目录">
    <h3>机型 → ATA2 → ATA4 → 文档版本</h3>
    <p className="library-classification-note">仅覆盖当前已加载的获权版本。机型提及与 ATA 取自同一版本的原文观察，均待核，不表示适用性。{hasMore ? '可在下方加载更多。' : ''}</p>
    <div role="group" aria-label="ATA 标题附件"><Button size="sm" variant="outline" aria-pressed={scheme === 'ispec'} onClick={() => onSchemeChange('ispec')}>iSpec 附件标题</Button><Button size="sm" variant="outline" aria-pressed={scheme === 'jasc'} onClick={() => onSchemeChange('jasc')}>JASC 附件标题</Button></div>
    <p className="library-classification-note">标题来自仓库已收录的 2026-09-10 附件摘录，可展开查看源行。附件版次及机型映射未核验；iSpec 与 JASC 同号不表示等同。</p>
    {roots.length ? branches(roots) : <p role="status">本批获权版本没有可显示的分类路径。</p>}
  </section>;
}
