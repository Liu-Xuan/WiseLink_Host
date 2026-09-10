import { FileText } from 'lucide-react';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import {
  documentLabel,
  libraryVersionLabel,
} from './library-document-presentation';
import { metadataValues } from './library-classification';

export default function LibraryDocumentRows({
  documents,
  selectedId,
  onSelect,
}: {
  documents: CanonicalLibraryDocumentSummary[];
  selectedId: string;
  onSelect(id: string): void;
}) {
  return (
    <div className="atlas-library-document-rows">
      <div className="atlas-library-columns" aria-hidden="true">
        <span>文件与主题</span>
        <span>库内版本</span>
        <span>资料与评估</span>
      </div>
      <ul className="atlas-library-rows" aria-label="工程文档">
        {documents.map((document) => {
          const current = document.versions.find(
            (version) => version.selectedVersionIsCurrent,
          );
          const title = metadataValues(current?.extractedMetadata?.title).join(
            ' / ',
          );
          return (
            <li
              key={document.familyId}
              className={selectedId === document.familyId ? 'is-selected' : ''}
            >
              <button
                className="atlas-library-select"
                type="button"
                aria-pressed={selectedId === document.familyId}
                onClick={() => onSelect(document.familyId)}
              >
                <span className="atlas-library-subject">
                  <FileText aria-hidden="true" />
                  <span>
                    <strong>{documentLabel(document)}</strong>
                    <small>{title || '当前版本标题尚未提取'}</small>
                  </span>
                </span>
                <span className="atlas-library-brief">
                  <strong>
                    {current ? libraryVersionLabel(current) : '当前版本未返回'}
                  </strong>
                  <small>{document.versions.length} 个可见版本</small>
                  <small>库内当前，不代表发布源最新版已核实</small>
                </span>
                <span className="atlas-library-progress">
                  <strong>{document.normalizedFamily}</strong>
                  <small>{document.workItemCount} 个评估任务</small>
                  <small>查看快览、版本及阅读入口</small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
