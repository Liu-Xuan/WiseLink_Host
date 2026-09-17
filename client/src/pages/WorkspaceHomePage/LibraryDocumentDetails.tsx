import { ArrowRight, FileSearch2, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { saveReadingLocation } from '@client/src/features/matter/reading-location';
import {
  libraryReadingParams,
  libraryReadingScope,
  revisionReadingParams,
} from '@client/src/features/matter/reading-return';
import { captureReadingLocation } from '@client/src/features/matter/useReadingLocation';
import { DocumentVersionLink } from './DocumentVersionLink';
import { LibraryMetadata } from './LibraryMetadata';
import LinkDocumentMatterMaterial from '@client/src/features/matter/LinkDocumentMatterMaterial';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { metadataValues } from './library-classification';
import {
  byteLabel,
  documentLabel,
  libraryDateLabel,
  libraryVersionLabel,
  projectLibraryDocumentReading,
} from './library-document-presentation';

interface LibraryDocumentDetailsProps {
  document: CanonicalLibraryDocumentSummary | null;
  onRefresh: () => void;
  onViewTasks: (familyId: string) => void;
  linkMatterId?: string;
  selectionPending?: boolean;
}

export function LibraryDocumentDetails({
  document,
  onRefresh,
  onViewTasks,
  linkMatterId,
  selectionPending = false,
}: LibraryDocumentDetailsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [baseline, setBaseline] = useState('');
  const [compare, setCompare] = useState('');
  const [revisionNote, setRevisionNote] = useState<string | null>(null);
  const paneScroll = useLibraryPaneScroll<HTMLDivElement>('quicklookY', Boolean(document), getCanonicalHostClientSessionGeneration());
  const selectedVersionPin = searchParams.get('selectedDocumentVersionId');
  const selectedVersion = searchParams.has('selectedDocumentVersionId')
    ? searchParams.getAll('selectedDocumentVersionId').length === 1
      ? document?.versions.find(version => version.documentVersionId === selectedVersionPin)
      : undefined
    : document?.versions.find(version => version.selectedVersionIsCurrent);
  const selectedReading = selectedVersion
    ? projectLibraryDocumentReading(selectedVersion)
    : null;

  useEffect(() => {
    if (!document) {
      setBaseline('');
      setCompare('');
      setRevisionNote(null);
      return;
    }
    setBaseline(document.versions[0]?.documentVersionId ?? '');
    setCompare(document.versions[1]?.documentVersionId ?? '');
    setRevisionNote(null);
  }, [document]);

  const openRevisionComparison = () => {
    if (!document) return;
    if (baseline === compare) {
      setRevisionNote('请选择两个不同的版本。');
      return;
    }
    setRevisionNote(null);
    const query = new URLSearchParams({ before: baseline, after: compare });
    const familyId = document.familyId.trim();
    const libraryContext = new URLSearchParams(searchParams);
    if (familyId) libraryContext.set('familyId', familyId);
    query.set(
      'returnLibraryQuery',
      libraryReadingParams(libraryContext).toString(),
    );
    saveReadingLocation(
      libraryReadingScope(libraryContext),
      captureReadingLocation({
        claim: null,
        focusClaimId: null,
        discussionClaimId: null,
      }),
      getCanonicalHostClientSessionGeneration(),
    );
    navigate(`/document-revisions?${revisionReadingParams(query).toString()}`);
  };

  return (
    <aside
      className="library-quicklook-panel"
      aria-label="文档与版本"
      data-wl-material="g3"
    >
      <div className="library-panel-heading">
        <div>
          <span className="library-section-label">来源资料</span>
          <h2>快速理解</h2>
        </div>
        <History aria-hidden="true" />
      </div>
      {!document ? (
        <div className="library-quicklook-empty" role="status">
          <FileSearch2 aria-hidden="true" />
          <strong>{selectionPending ? '原选择尚未在当前读取范围内加载' : '选择工程文档查看版本'}</strong>
          <p>{selectionPending ? '已保留原文档选择。可加载更多目录或核对筛选与访问范围；未出现在本次读取中不代表资料不存在，也不会自动改选首行。' : '同一文档的版本集中在这里，评估记录可在最近任务中查看。'}</p>
        </div>
      ) : (
        <div {...paneScroll} className="library-quicklook-scroll">
          <header className="library-quicklook-title">
            <div>
              <h3>{metadataValues(selectedVersion?.extractedMetadata?.title).join(' / ') || documentLabel(document)}</h3>
              <p>
                {document.issuerAuthority} · {document.normalizedFamily} ·{' '}
                {document.versions.length} 个可见版本
              </p>
            </div>
          </header>
          {selectedVersion && selectedReading ? <section className="library-selected-version" data-document-version-id={selectedVersion.documentVersionId}>
            <p>{libraryVersionLabel(selectedVersion)} · {selectedVersion.selectedVersionIsCurrent ? '库内当前版本' : '历史版本'}</p>
            <h4>简明解读</h4>
            {selectedReading.brief ? (
              <div
                className="library-quicklook-reading"
                data-reading-run-ref={selectedReading.readingRunRef ?? undefined}
                data-reading-revision={selectedReading.readingRevision ?? undefined}
              >
                <strong className="library-quicklook-headline">{selectedReading.headline}</strong>
                <p className="library-quicklook-brief">{selectedReading.brief}</p>
                {selectedReading.coverageStatus === 'PARTIAL_DELIVERY' ? (
                  <p className="library-quicklook-note">
                    部分覆盖：已送达 {selectedReading.deliveredUnitCount}/{selectedReading.totalUnitCount}，仅代表已送达范围，不代表完整理解。
                  </p>
                ) : null}
              </div>
            ) : (
              <p>{selectedReading.note}</p>
            )}
            {selectedReading.criticalConditions.length > 0 ||
            selectedReading.limitations.length > 0 ||
            selectedReading.sourceLimitations.length > 0 ? (
              <div className="library-quicklook-conditions">
                <h4>关键条件与阅读限制</h4>
                <ul>
                  {selectedReading.criticalConditions.map((condition) => (
                    <li key={`condition:${condition}`}>{condition}</li>
                  ))}
                  {selectedReading.limitations.map((limitation) => (
                    <li key={`limitation:${limitation}`}>{limitation}</li>
                  ))}
                  {selectedReading.sourceLimitations.map((sourceLimitation) => (
                    <li key={`source:${sourceLimitation}`}>{sourceLimitation}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <DocumentVersionLink version={selectedVersion} familyId={document.familyId}>进入精读工作台</DocumentVersionLink>
          </section> : <p role="status">所选版本未在当前读取范围内返回，未替换为其他版本。</p>}
          <p className="library-quicklook-note">
            版本状态以文档管理模块的登记为准。重复评估关联已有文档版本。
          </p>
          {linkMatterId ? (
            <LinkDocumentMatterMaterial
              key={`${linkMatterId}:${document.familyId}`}
              matterId={linkMatterId}
              document={document}
            />
          ) : null}
          <details className="library-quicklook-history">
            <summary>改版比较与全部版本（{document.versions.length}）</summary>
          <div className="library-revision-picker">
            <p className="library-revision-picker-note">
              选择两个不同的版本进行只读改版比较。「基线端」与「比较目标端」只表示本次比较的两端，不代表厂家先后、正式采用或最新。
            </p>
            <div className="library-revision-picker-fields">
              <label>
                基线端
                <select
                  value={baseline}
                  onChange={(event) => setBaseline(event.target.value)}
                >
                  {document.versions.map((version) => (
                    <option
                      key={version.documentVersionId}
                      value={version.documentVersionId}
                    >
                      {libraryVersionLabel(version)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                比较目标端
                <select
                  value={compare}
                  onChange={(event) => setCompare(event.target.value)}
                >
                  {document.versions.map((version) => (
                    <option
                      key={version.documentVersionId}
                      value={version.documentVersionId}
                    >
                      {libraryVersionLabel(version)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {revisionNote ? (
              <p className="library-revision-picker-error" role="alert">
                {revisionNote}
              </p>
            ) : null}
            {document.versions.length < 2 ? (
              <p className="library-revision-picker-single">
                该文档只有一个可见版本，暂无法进行改版比较。
              </p>
            ) : (
              <div className="library-quicklook-actions">
                <Button type="button" onClick={openRevisionComparison}>
                  进入改版比较 <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
          <ol className="library-version-list" aria-label="文档版本历史">
            {document.versions.map((version) => (
              <li key={version.documentVersionId}>
                <div className="library-version-heading">
                  <strong>{libraryVersionLabel(version)}</strong>
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
                    <dt>
                      {version.revisionDate ? '版本日期' : '来源生成日期'}
                    </dt>
                    <dd>
                      {version.revisionDate ||
                        version.sourceGeneratedDate ||
                        '未标注'}
                    </dd>
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
                <DocumentVersionLink version={version} familyId={document.familyId}>
                  打开原文 <ArrowRight aria-hidden="true" />
                </DocumentVersionLink>
                <LibraryMetadata version={version} onRefresh={onRefresh} />
              </li>
            ))}
          </ol>
          </details>
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
