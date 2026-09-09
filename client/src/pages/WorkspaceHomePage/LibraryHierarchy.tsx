import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  documentLabel,
  libraryVersionLabel,
} from './library-document-presentation';
import {
  groupLibraryDocuments,
  type LibraryGrouping,
} from './library-classification';
import { DocumentVersionLink } from './DocumentVersionLink';
import { metadataValues } from './library-classification';

interface LibraryHierarchyProps {
  documents: CanonicalLibraryDocumentSummary[];
  selectedId: string;
  hasMore: boolean;
  onSelect: (familyId: string) => void;
  grouping?: LibraryGrouping;
  totalCount?: number;
}

export function LibraryHierarchy({
  documents,
  selectedId,
  hasMore,
  onSelect,
  grouping = 'category',
  totalCount,
}: LibraryHierarchyProps) {
  const groups = groupLibraryDocuments(documents, grouping);

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
                    <DocumentVersionLink version={version}>
                      <strong>{libraryVersionLabel(version)}</strong>
                      <span>
                        {version.selectedVersionIsCurrent
                          ? '当前版本'
                          : '历史版本'}
                      </span>
                      <small>{version.originalFilename}</small>
                      {version.extractedMetadata ? (
                        <small>
                          {metadataValues(version.extractedMetadata.title).join(
                            ' / ',
                          ) || '标题本次未检出'}
                          {' · 元数据待核'}
                        </small>
                      ) : (
                        <small>元数据未提取</small>
                      )}
                    </DocumentVersionLink>
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
            <span>已加载 {group.documents.length} 份文档</span>
          </summary>
          {documentRows(group.documents)}
        </details>
      ))}
    </div>
  );

  return (
    <section className="library-hierarchy" aria-label="文档分类目录">
      <h3>资料分类（含历史版本）</h3>
      <p className="library-classification-note">
        {totalCount === undefined
          ? '全量统计尚未取得。'
          : `当前搜索与筛选共 ${totalCount} 份文档。`}
        {`已加载 ${documents.length} 份；下方树节点数量仅覆盖已加载的搜索结果。`}
        {hasMore ? '可在下方加载更多。' : ''} 展开文档查看版本，或打开文档快览。
      </p>
      {grouping === 'ata' || grouping === 'aircraft' ? (
        <p className="library-classification-note">
          按各获权版本的原文观察值分类，全部待核；可能来自历史版本，不代表当前版本。
          {grouping === 'aircraft' ? '正文提及机型（非适用性）。' : ''}
          未分类包含尚未提取或本次文本未检出的版本；可在文档快览中查看依据或补提取。
        </p>
      ) : null}
      {grouping === 'all' ? documentRows(documents) : categories}
    </section>
  );
}
