import { Fragment, useState } from 'react';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  documentIdentityPresentation,
  libraryVersionLabel,
  projectLibraryDocumentReading,
} from './library-document-presentation';
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
  const [expandedBriefKeys, setExpandedBriefKeys] = useState<Record<string, boolean>>({});
  return (
    <div {...scroll} className={`suite-library-table-wrap${compact ? ' is-compact' : ''}`}>
      <table className="suite-library-table">
        <thead><tr><th>文件与主题</th><th>来源版本</th><th>解读与当前认识</th><th>关键条件与覆盖</th><th /></tr></thead>
        <tbody>
          {documents.map((document) => {
            const current = document.versions.find((version) => version.selectedVersionIsCurrent);
            const identity = documentIdentityPresentation({ documentCode: document.documentCode,
              extractedMetadata: current?.extractedMetadata });
            const expanded = expandedFamilyIds.includes(document.familyId);
            const currentReading = current ? projectLibraryDocumentReading(current) : null;
            return (
              <Fragment key={document.familyId}>
                <tr className={selectedId === document.familyId && (!selectedDocumentVersionId || selectedDocumentVersionId === current?.documentVersionId) ? 'selected' : ''} tabIndex={0} onClick={() => onSelect(document.familyId)} onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && onSelect(document.familyId)}>
                  <td><div className="suite-doc-cell"><Button className="suite-expand-button" variant="ghost" size="icon" aria-label={`${expanded ? '收起' : '展开'}${identity.documentNumber}历史版本`} onClick={(event) => { event.stopPropagation(); onToggleFamily(document.familyId); }}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</Button><FileText aria-hidden="true" /><span><b>{identity.documentNumber}</b><small>{identity.documentTitle} · {document.normalizedFamily}</small></span></div></td>
                  <td><b>{current ? libraryVersionLabel(current) : '当前版本未返回'}</b><small>{document.versions.length} 个可见版本</small></td>
                  <td className="meaning">
                    {currentReading?.brief ? (
                      <div
                        className={`suite-reading${compact && !expandedBriefKeys[document.familyId] ? ' is-folded' : ''}`}
                        data-reading-run-ref={currentReading.readingRunRef ?? undefined}
                        data-reading-revision={currentReading.readingRevision ?? undefined}
                      >
                        <b className="suite-reading-headline">{currentReading.headline}</b>
                        <span className="suite-reading-brief">{currentReading.brief}</span>
                      </div>
                    ) : (
                      <span className="suite-reading-note">{currentReading?.note ?? '当前版本未返回，暂无版本解读'}</span>
                    )}
                    {compact && currentReading?.brief ? (
                      <button
                        type="button"
                        className="suite-reading-toggle"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedBriefKeys((prior) => ({
                            ...prior,
                            [document.familyId]: !prior[document.familyId],
                          }));
                        }}
                      >
                        {expandedBriefKeys[document.familyId] ? '收起' : '展开全文'}
                      </button>
                    ) : null}
                  </td>
                  <td>
                    {currentReading && currentReading.conditionLines.length ? (
                      <div
                        className={`suite-conditions${compact && !expandedBriefKeys[`conditions:${document.familyId}`] ? ' is-folded' : ''}`}
                      >
                        {currentReading.conditionLines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </div>
                    ) : (
                      <span>—</span>
                    )}
                    {compact && currentReading && currentReading.conditionLines.length > 2 ? (
                      <button
                        type="button"
                        className="suite-reading-toggle"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedBriefKeys((prior) => ({
                            ...prior,
                            [`conditions:${document.familyId}`]:
                              !prior[`conditions:${document.familyId}`],
                          }));
                        }}
                      >
                        {expandedBriefKeys[`conditions:${document.familyId}`] ? '收起' : '展开全部条件'}
                      </button>
                    ) : null}
                    <small>{document.workItemCount} 个评估任务</small>
                  </td>
                  <td>{current ? <DocumentVersionLink version={current} familyId={document.familyId}>打开</DocumentVersionLink> : null}</td>
                </tr>
                {expanded ? document.versions.filter((version) => !version.selectedVersionIsCurrent).map((version) => {
                  const versionReading = projectLibraryDocumentReading(version);
                  const versionIdentity = documentIdentityPresentation({ documentCode: document.documentCode,
                    extractedMetadata: version.extractedMetadata });
                  return (
                  <tr className={selectedId === document.familyId && selectedDocumentVersionId === version.documentVersionId ? 'selected suite-version-row' : 'suite-version-row'} key={version.documentVersionId} tabIndex={0} onClick={() => onSelectVersion(document.familyId, version.documentVersionId)} onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && onSelectVersion(document.familyId, version.documentVersionId)}>
                    <td><div className="suite-doc-cell suite-version-cell"><span /><span><b>{versionIdentity.documentNumber}</b><small>{versionIdentity.documentTitle} · {libraryVersionLabel(version)}</small></span></div></td>
                    <td><span>{version.revisionDate || version.sourceGeneratedDate || '版本日期未标注'}</span><small>{version.originalFilename}</small></td>
                    <td className="meaning">
                      {versionReading.brief ? (
                        <div
                          className="suite-reading"
                          data-reading-run-ref={versionReading.readingRunRef ?? undefined}
                          data-reading-revision={versionReading.readingRevision ?? undefined}
                        >
                          <b className="suite-reading-headline">{versionReading.headline}</b>
                          <span className="suite-reading-brief">{versionReading.brief}</span>
                        </div>
                      ) : (
                        <span className="suite-reading-note">{versionReading.note}</span>
                      )}
                    </td>
                    <td>
                      {versionReading.conditionLines.length ? (
                        <div
                          className={`suite-conditions${compact && !expandedBriefKeys[`conditions:${version.documentVersionId}`] ? ' is-folded' : ''}`}
                        >
                          {versionReading.conditionLines.map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </div>
                      ) : (
                        <span>—</span>
                      )}
                      {compact && versionReading.conditionLines.length > 2 ? (
                        <button
                          type="button"
                          className="suite-reading-toggle"
                          onClick={(event) => {
                            event.stopPropagation();
                            setExpandedBriefKeys((prior) => ({
                              ...prior,
                              [`conditions:${version.documentVersionId}`]:
                                !prior[`conditions:${version.documentVersionId}`],
                            }));
                          }}
                        >
                          {expandedBriefKeys[`conditions:${version.documentVersionId}`] ? '收起' : '展开全部条件'}
                        </button>
                      ) : null}
                      <small>{version.workItemCount} 个评估任务</small>
                    </td>
                    <td><DocumentVersionLink version={version} familyId={document.familyId}>打开</DocumentVersionLink></td>
                  </tr>
                  );
                }) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!documents.length ? <p className="suite-library-empty">当前读取范围内没有匹配文档。</p> : null}
    </div>
  );
}
