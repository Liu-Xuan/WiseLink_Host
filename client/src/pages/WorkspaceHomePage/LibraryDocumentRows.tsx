import { Fragment, type ReactNode } from 'react';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CanonicalLibraryDocumentSummary, CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  documentIdentityPresentation, libraryDateLabel, libraryDistinctBrief, libraryPublicationPresentation,
  projectLibraryDocumentReading,
} from './library-document-presentation';
import { DocumentVersionLink } from './DocumentVersionLink';
import { LibrarySummaryText } from './LibrarySummaryText';
import { libraryCurrentVersion } from './library-document-selection';
import { librarySourceStatus } from './library-source-status';
import { metadataValues } from './library-classification';
import { LibraryDocumentNumber } from './LibraryDocumentNumber';

export function LibraryDocumentTableHead() {
  return <thead><tr><th>文档编号</th><th>标题</th><th>版本</th><th>颁发时间</th><th>ATA</th><th>摘要</th><th><span className="sr-only">操作</span></th></tr></thead>;
}

/** The main list and ATA leaves use the same exact-version fields. */
export function LibraryDocumentVersionRow({ document, version, selected, onSelect, leading }: {
  document: CanonicalLibraryDocumentSummary;
  version: CanonicalLibraryDocumentVersionSummary | null;
  selected?: boolean;
  onSelect(): void;
  leading?: ReactNode;
}) {
  const identity = documentIdentityPresentation({ documentCode: document.documentCode,
    extractedMetadata: version?.extractedMetadata });
  const title = identity.documentTitle;
  const publication = libraryPublicationPresentation(version);
  const reading = version ? projectLibraryDocumentReading(version) : null;
  const sourceStatus = version ? librarySourceStatus(version) : null;
  return <tr className={`${selected ? 'selected ' : ''}${version && !version.selectedVersionIsCurrent ? 'suite-version-row' : ''}`}
    data-document-version-id={version?.documentVersionId} tabIndex={0} onClick={onSelect}
    onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') onSelect(); }}>
    <td data-column="number"><div className="suite-doc-cell">{leading}<LibraryDocumentNumber value={document.documentCode} /></div></td>
    <td data-column="title" className="suite-doc-title"><LibrarySummaryText text={title} label="标题" expandable={identity.hasDocumentTitle} /></td>
    <td data-column="version" data-label="版本"><b>{version ? version.businessRevision || '未标注' : '当前版本待确认'}</b>
      {version ? <small>{version.selectedVersionIsCurrent ? '当前' : '历史'}</small> : null}</td>
    <td data-column="issued" data-label="颁发时间" title="原文颁发时间">{publication.issueDate}</td>
    <td data-column="ata" data-label="ATA" title="原文 ATA">{publication.ata}</td>
    <td data-column="summary" className="meaning">
      <div data-reading-run-ref={reading?.readingRunRef ?? undefined}
        data-reading-revision={reading?.readingRevision ?? undefined}>
        <LibrarySummaryText key={version?.documentVersionId ?? document.familyId}
          expandable={Boolean(reading?.brief)}
          text={reading?.brief ? libraryDistinctBrief(reading.brief, title, identity.documentNumber)
            : reading?.note || '暂无已保存解读'} />
        {reading?.status === 'AVAILABLE' ? (
          <details className="suite-reading-more" onClick={event => event.stopPropagation()}>
            <summary>{reading.conditionLines.length ? `条件与限制 ${reading.conditionLines.length}` : '保存与来源'}</summary>
            {reading.headline && reading.headline !== title && reading.headline !== reading.brief ? <p>{reading.headline}</p> : null}
            <div className="suite-conditions">{reading.conditionLines.map(line => <span key={line}>{line}</span>)}</div>
            <p>已读取 {reading.deliveredUnitCount}/{reading.totalUnitCount} 个来源单元 · 来源解析版本 {reading.sourceBinding?.original.parseRevision}</p>
            <p>保存时间：{libraryDateLabel(reading.savedAt)}</p>
          </details>
        ) : null}
      </div>
      {sourceStatus && version ? <details className="suite-reading-more" onClick={event => event.stopPropagation()}>
        <summary>{sourceStatus.received} · {sourceStatus.original} · {sourceStatus.parsing}</summary>
        <p>类型 {document.normalizedFamily || '待分类'} · 机型 {metadataValues(version.extractedMetadata?.mentionedAircraftModels).join(' / ') || '待分类'}</p>
        <p>{sourceStatus.opinions} · {sourceStatus.assessment}</p>
        <p>{sourceStatus.sourceModified} · {sourceStatus.synchronized}</p>
      </details> : null}
    </td>
    <td data-column="action">{version ? <DocumentVersionLink version={version} familyId={document.familyId} compact>打开</DocumentVersionLink> : null}</td>
  </tr>;
}

export default function LibraryDocumentRows({
  documents, selectedId, selectedDocumentVersionId, expandedFamilyIds, compact,
  sessionGeneration = 0, onSelect, onSelectVersion, onToggleFamily,
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
  return <div {...scroll} className={`suite-library-table-wrap${compact ? ' is-compact' : ''}`}>
    <table className="suite-library-table suite-library-data-table suite-document-table" aria-label="工程文档">
      <LibraryDocumentTableHead />
      <tbody>{documents.map(document => {
        const current = libraryCurrentVersion(document);
        const expanded = expandedFamilyIds.includes(document.familyId);
        return <Fragment key={document.familyId}>
          <LibraryDocumentVersionRow document={document} version={current}
            selected={selectedId === document.familyId && (!selectedDocumentVersionId || selectedDocumentVersionId === current?.documentVersionId)}
            onSelect={() => onSelect(document.familyId)}
            leading={<Button className="suite-expand-button" variant="ghost" size="icon"
              aria-label={`${expanded ? '收起' : '展开'}${document.documentCode}历史版本`}
              title={`${document.versions.length} 个可见版本`}
              onClick={event => { event.stopPropagation(); onToggleFamily(document.familyId); }}>
              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </Button>} />
          {expanded ? document.versions.filter(version => !version.selectedVersionIsCurrent).map(version => (
            <LibraryDocumentVersionRow key={version.documentVersionId} document={document} version={version}
              selected={selectedId === document.familyId && selectedDocumentVersionId === version.documentVersionId}
              onSelect={() => onSelectVersion(document.familyId, version.documentVersionId)} />
          )) : null}
        </Fragment>;
      })}</tbody>
    </table>
    {!documents.length ? <p className="suite-library-empty">当前读取范围内没有匹配文档。</p> : null}
  </div>;
}
