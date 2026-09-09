import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  documentLabel,
  libraryVersionLabel,
} from './library-document-presentation';
import {
  groupLibraryDocuments,
  LIBRARY_GROUPINGS,
  type LibraryGrouping,
} from './library-classification';

interface LibraryHierarchyProps {
  documents: CanonicalLibraryDocumentSummary[];
  selectedId: string;
  hasMore: boolean;
  onSelect: (familyId: string) => void;
}

export function LibraryHierarchy({
  documents,
  selectedId,
  hasMore,
  onSelect,
}: LibraryHierarchyProps) {
  const [grouping, setGrouping] = useState<LibraryGrouping>('category');
  const groups = groupLibraryDocuments(documents);
  const missingDimension: string | null =
    grouping === 'ata' ? 'ATA 章节' : grouping === 'aircraft' ? '机型' : null;

  function documentRows(items: CanonicalLibraryDocumentSummary[]) {
    return (
      <ul className="library-family-tree">
        {items.map((document) => (
          <li key={document.familyId}>
            <details
              className={document.familyId === selectedId ? 'is-selected' : ''}
            >
              <summary>
                <span>{documentLabel(document)}</span>
                <small>{document.versions.length} 个可见版本</small>
              </summary>
              <div className="library-family-actions">
                <span>
                  {document.issuerAuthority} · {document.workItemCount}{' '}
                  个评估任务
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelect(document.familyId)}
                  aria-pressed={document.familyId === selectedId}
                >
                  查看文档快览
                </Button>
              </div>
              <ul
                className="library-version-tree"
                aria-label={`${documentLabel(document)} 版本`}
              >
                {document.versions.map((version) => (
                  <li key={version.documentVersionId}>
                    <Link
                      to={`/work-items/${encodeURIComponent(version.readerWorkItemId)}/documents?node=reader&tab=reader`}
                    >
                      <strong>{libraryVersionLabel(version)}</strong>
                      <span>
                        {version.selectedVersionIsCurrent
                          ? '当前版本'
                          : '历史版本'}
                      </span>
                      <small>{version.originalFilename}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    );
  }

  const categories = (
    <div className="library-category-tree">
      {groups.map((group) => (
        <details key={group.key} open>
          <summary>
            <strong>{group.label}</strong>
            <span>{group.documents.length} 份文档</span>
          </summary>
          {documentRows(group.documents)}
        </details>
      ))}
    </div>
  );

  return (
    <section className="library-hierarchy" aria-label="文档分类目录">
      <div
        className="library-grouping-controls"
        role="group"
        aria-label="资料分组方式"
      >
        {LIBRARY_GROUPINGS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={grouping === option.value ? 'default' : 'outline'}
            aria-pressed={grouping === option.value}
            onClick={() => setGrouping(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="library-classification-note">
        {hasMore
          ? `已加载 ${documents.length} 份；以下分组与数量仅覆盖已加载的搜索结果，可在下方加载更多。`
          : `当前搜索结果共 ${documents.length} 份文档。`}{' '}
        展开文档查看版本，或打开文档快览。
      </p>
      {missingDimension ? (
        <>
          <p className="library-classification-note" role="status">
            当前目录尚未登记{missingDimension}
            。以下文档均为未分类，不从文件名、文档编号或评估对象推断。
          </p>
          <details className="library-unclassified-group" open>
            <summary>
              未分类 · {missingDimension}
              <span>{documents.length} 份文档</span>
            </summary>
            {categories}
          </details>
        </>
      ) : grouping === 'all' ? (
        documentRows(documents)
      ) : (
        categories
      )}
    </section>
  );
}
