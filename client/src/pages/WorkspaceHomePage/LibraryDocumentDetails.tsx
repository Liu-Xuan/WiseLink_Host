import { ArrowRight, FileSearch2, History } from 'lucide-react';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  byteLabel,
  documentLabel,
  libraryDateLabel,
} from './library-document-presentation';

interface LibraryDocumentDetailsProps {
  document: CanonicalLibraryDocumentSummary | null;
  onOpenVersion: (workItemId: string) => void;
  onViewTasks: (familyId: string) => void;
}

export function LibraryDocumentDetails({
  document,
  onOpenVersion,
  onViewTasks,
}: LibraryDocumentDetailsProps) {
  return (
    <aside
      className="library-quicklook-panel"
      aria-label="文档与版本"
      data-wl-material="g3"
    >
      <div className="library-panel-heading">
        <div>
          <span className="library-section-label">文档管理</span>
          <h2>文档与版本</h2>
        </div>
        <History aria-hidden="true" />
      </div>
      {!document ? (
        <div className="library-quicklook-empty" role="status">
          <FileSearch2 aria-hidden="true" />
          <strong>选择工程文档查看版本</strong>
          <p>同一文档的版本集中在这里，评估记录可在最近任务中查看。</p>
        </div>
      ) : (
        <div className="library-quicklook-scroll">
          <header className="library-quicklook-title">
            <div>
              <h3>{documentLabel(document)}</h3>
              <p>
                {document.issuerAuthority} · {document.normalizedFamily} ·{' '}
                {document.versions.length} 个可见版本
              </p>
            </div>
          </header>
          <p className="library-quicklook-note">
            版本状态以文档管理模块的登记为准。重复评估关联已有文档版本。
          </p>
          <ol className="library-version-list" aria-label="文档版本历史">
            {document.versions.map((version) => (
              <li key={version.documentVersionId}>
                <div className="library-version-heading">
                  <strong>{version.businessRevision || '版本未标注'}</strong>
                  <span
                    className={
                      version.selectedVersionIsCurrent
                        ? 'library-version-current'
                        : undefined
                    }
                  >
                    {version.selectedVersionIsCurrent ? '当前版本' : '历史版本'}
                  </span>
                </div>
                <dl className="library-quicklook-facts">
                  <div>
                    <dt>版本日期</dt>
                    <dd>{version.revisionDate || '未标注'}</dd>
                  </div>
                  <div>
                    <dt>入库时间</dt>
                    <dd>{libraryDateLabel(version.committedAt)}</dd>
                  </div>
                  <div>
                    <dt>原文</dt>
                    <dd>
                      {version.originalFilename} ·{' '}
                      {byteLabel(version.byteLength)}
                    </dd>
                  </div>
                  <div>
                    <dt>评估记录</dt>
                    <dd>{version.workItemCount} 个任务</dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenVersion(version.readerWorkItemId)}
                  aria-label={`打开 ${version.businessRevision || '未标注版本'} 原文`}
                >
                  打开原文 <ArrowRight aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
          <div className="library-quicklook-actions">
            <Button
              type="button"
              onClick={() => onViewTasks(document.familyId)}
            >
              查看评估任务（{document.workItemCount}）
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
