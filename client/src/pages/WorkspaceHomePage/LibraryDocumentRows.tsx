import { Fragment } from 'react';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { documentLabel, libraryVersionLabel } from './library-document-presentation';
import { metadataValues } from './library-classification';
import { DocumentVersionLink } from './DocumentVersionLink';

export default function LibraryDocumentRows({
  documents,
  selectedId,
  selectedDocumentVersionId,
  expandedFamilyIds,
  compact,
  sessionGeneration = 0,
  onSelect,
  onSelectVersion,
  onToggleFamily,
}: {
  documents: CanonicalLibraryDocumentSummary[];
  selectedId: string;
  selectedDocumentVersionId: string;
  expandedFamilyIds: string[];
  compact: boolean;
  sessionGeneration?: number;
  onSelect(id: string): void;
  onSelectVersion(familyId: string, documentVersionId: string): void;
  onToggleFamily(familyId: string): void;
}) {
  const scroll = useLibraryPaneScroll<HTMLDivElement>('listY', true, sessionGeneration);
  return (
    <div {...scroll} className={`suite-library-table-wrap${compact ? ' is-compact' : ''}`}>
      <table className="suite-library-table">
        <thead><tr><th>文件与主题</th><th>来源版本</th><th>解读与当前认识</th><th>范围 / 变化</th><th /></tr></thead>
        <tbody>
          {documents.map((document) => {
            const current = document.versions.find((version) => version.selectedVersionIsCurrent);
            const title = metadataValues(current?.extractedMetadata?.title).join(' / ');
            const expanded = expandedFamilyIds.includes(document.familyId);
            return (
              <Fragment key={document.familyId}>
                <tr className={selectedId === document.familyId && (!selectedDocumentVersionId || selectedDocumentVersionId === current?.documentVersionId) ? 'selected' : ''} tabIndex={0} onClick={() => onSelect(document.familyId)} onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && onSelect(document.familyId)}>
                  <td><div className="suite-doc-cell"><Button className="suite-expand-button" variant="ghost" size="icon" aria-label={`${expanded ? '收起' : '展开'}${documentLabel(document)}历史版本`} onClick={(event) => { event.stopPropagation(); onToggleFamily(document.familyId); }}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</Button><FileText aria-hidden="true" /><span><b>{title || documentLabel(document)}</b><small>{documentLabel(document)} · 文档族</small></span></div></td>
                  <td><b>{current ? libraryVersionLabel(current) : '当前版本未返回'}</b><small>{document.versions.length} 个可见版本</small></td>
                  <td className="meaning"><b>此版本解读待补齐</b><small>可打开原文核对主题与条件</small></td>
                  <td><span>{document.normalizedFamily || '主题待核'}</span><small>{document.workItemCount} 个评估任务</small></td>
                  <td>{current ? <DocumentVersionLink version={current} familyId={document.familyId}>打开</DocumentVersionLink> : null}</td>
                </tr>
                {expanded ? document.versions.filter((version) => !version.selectedVersionIsCurrent).map((version) => (
                  <tr className={selectedId === document.familyId && selectedDocumentVersionId === version.documentVersionId ? 'selected suite-version-row' : 'suite-version-row'} key={version.documentVersionId} tabIndex={0} onClick={() => onSelectVersion(document.familyId, version.documentVersionId)} onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && onSelectVersion(document.familyId, version.documentVersionId)}>
                    <td><div className="suite-doc-cell suite-version-cell"><span /><span><b>{libraryVersionLabel(version)}</b><small>{documentLabel(document)} · 该文件自己的历史版本</small></span></div></td>
                    <td><span>{version.revisionDate || version.sourceGeneratedDate || '版本日期未标注'}</span><small>{version.originalFilename}</small></td>
                    <td className="meaning"><span>此版本解读待补齐</span></td>
                    <td><span>{version.workItemCount} 个评估任务</span></td>
                    <td><DocumentVersionLink version={version} familyId={document.familyId}>打开</DocumentVersionLink></td>
                  </tr>
                )) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!documents.length ? <p className="suite-library-empty">当前读取范围内没有匹配文档。</p> : null}
    </div>
  );
}
