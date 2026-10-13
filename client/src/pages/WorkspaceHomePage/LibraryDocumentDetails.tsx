import { documentGraphReadingParams } from '@client/src/pages/RelationGraphPage/suite-graph-return';
import { ArrowRight, FileSearch2, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { LibrarySummaryText } from './LibrarySummaryText';
import { LibraryMetadata } from './LibraryMetadata';
import type { useLibraryQuicklook } from './useLibraryQuicklook';
import LinkDocumentMatterMaterial from '@client/src/features/matter/LinkDocumentMatterMaterial';
import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import {
  byteLabel,
  documentIdentityPresentation,
  libraryDateLabel,
  libraryVersionLabel,
  libraryPublicationPresentation,
  libraryDistinctBrief,
  projectLibraryDocumentReading,
} from './library-document-presentation';

interface LibraryDocumentDetailsProps {
  document: CanonicalLibraryDocumentSummary | null;
  assessmentQuicklook: ReturnType<typeof useLibraryQuicklook>;
  onRefresh: () => void;
  onViewTasks: (familyId: string) => void;
  linkMatterId?: string;
  selectionPending?: boolean;
}

export function LibraryDocumentDetails({
  document,
  assessmentQuicklook,
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
  const matchingAssessment = selectedVersion &&
    assessmentQuicklook.data?.document.documentVersionId === selectedVersion.documentVersionId &&
    assessmentQuicklook.data.document.workItemId === selectedVersion.readerWorkItemId
      ? assessmentQuicklook.data
      : null;
  const assessmentBrief = matchingAssessment?.result?.readingResult?.content.listBrief?.trim() ?? '';
  const readingConditionCount = selectedReading
    ? selectedReading.criticalConditions.length +
      selectedReading.limitations.length +
      selectedReading.sourceLimitations.length
    : 0;
  const selectedIdentity = document ? documentIdentityPresentation({ documentCode: document.documentCode,
    extractedMetadata: selectedVersion?.extractedMetadata }) : null;
  const selectedPublication = libraryPublicationPresentation(selectedVersion ?? null);

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
          <h2>文档详情</h2>
        </div>
        <History aria-hidden="true" />
      </div>
      {!document ? (
        <div className="library-quicklook-empty" role="status">
          <FileSearch2 aria-hidden="true" />
          <strong>{selectionPending ? '原选择尚未在当前读取范围内加载' : '选择工程文档查看版本'}</strong>
          <p>{selectionPending ? '所选文档未在当前目录页中，可加载更多或调整筛选。' : '同一文档的版本集中在这里，评估记录可在最近任务中查看。'}</p>
        </div>
      ) : (
        <div {...paneScroll} className="library-quicklook-scroll">
          <header className="library-quicklook-title">
            <div>
              <h3>{selectedIdentity?.hasDocumentTitle ? selectedIdentity.documentTitle : selectedIdentity?.documentNumber}</h3>
            </div>
          </header>
          {selectedVersion && selectedReading ? <section className="library-selected-version" data-document-version-id={selectedVersion.documentVersionId}>
            <dl className="suite-library-key-facts">
              {selectedIdentity?.documentTitle !== selectedIdentity?.documentNumber && selectedIdentity?.hasDocumentTitle
                ? <div><dt>编号</dt><dd>{selectedIdentity.documentNumber}</dd></div> : null}
              <div><dt>版本</dt><dd>{selectedVersion.businessRevision || '未标注'} · {selectedVersion.selectedVersionIsCurrent ? '当前' : '历史'}</dd></div>
              <div><dt>颁发时间</dt><dd>{selectedPublication.issueDate}</dd></div>
              <div><dt>ATA</dt><dd>{selectedPublication.ata}</dd></div>
            </dl>
            <h4>{!selectedReading.brief && assessmentBrief ? '关联评估短认识' : '摘要'}</h4>
            {selectedReading.brief ? (
              <div
                className="library-quicklook-reading"
                data-reading-run-ref={selectedReading.readingRunRef ?? undefined}
                data-reading-revision={selectedReading.readingRevision ?? undefined}
              >
                <LibrarySummaryText key={selectedVersion.documentVersionId}
                  text={libraryDistinctBrief(selectedReading.brief, selectedIdentity?.documentTitle ?? '', selectedIdentity?.documentNumber)} />
                {selectedReading.coverageStatus === 'PARTIAL_DELIVERY' ? (
                  <details><summary>保存与来源</summary>
                    <p>已保存阅读范围 {selectedReading.deliveredUnitCount}/{selectedReading.totalUnitCount}</p>
                    {selectedReading.savedAt ? <p>保存时间：{selectedReading.savedAt}</p> : null}
                  </details>
                ) : null}
              </div>
            ) : !assessmentBrief ? (
              <p>{selectedReading.note}</p>
            ) : null}
            {!selectedReading.brief && selectedVersion.readerWorkItemId ? (
              <section className="library-quicklook-assessment" aria-label="同版本已保存评估">
                {!assessmentBrief ? <h4>关联工程评估</h4> : null}
                {assessmentQuicklook.error ? (
                  <div role="alert">
                    <p>{assessmentQuicklook.error.message}</p>
                    <Button type="button" variant="outline" size="sm" onClick={onRefresh}>重试读取</Button>
                  </div>
                ) : assessmentQuicklook.loading ? (
                  <p role="status">正在核对同版本已保存工作…</p>
                ) : assessmentBrief && matchingAssessment ? (
                  <>
                    <p className="library-quicklook-assessment-status">{matchingAssessment.result?.jobAidRoundCompletion === 'IN_PROGRESS'
                      ? '已保存的部分问题工作；综合结论尚待完成。'
                      : matchingAssessment.result?.overallStatus === 'CURRENT'
                        ? '已保存的问题工作；综合候选当前有效。'
                        : '已保存的问题工作；综合状态请进入工作台核对。'}</p>
                    <LibrarySummaryText key={selectedVersion.documentVersionId} text={assessmentBrief} />
                    <Link to={`/work-items/${encodeURIComponent(matchingAssessment.document.workItemId)}/analysis?panel=assessment`}>查看完整评估与来源</Link>
                  </>
                ) : (
                  <p>该版本已有评估任务，尚无可显示的已保存问题摘要。</p>
                )}
              </section>
            ) : null}
            {readingConditionCount > 0 ? (
              <details
                key={selectedVersion.documentVersionId}
                className="library-quicklook-conditions"
              >
                <summary>
                  关键条件与阅读限制（{readingConditionCount} 项）
                </summary>
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
              </details>
            ) : null}
            <DocumentVersionLink version={selectedVersion} familyId={document.familyId}>进入精读工作台</DocumentVersionLink>
            <Link to={`/graph?${documentGraphReadingParams(selectedVersion.documentVersionId, selectedVersion.readerWorkItemId || undefined, {})}`}>文档关系图谱与时间</Link>
          </section> : <p role="status">所选版本未在当前读取范围内返回，未替换为其他版本。</p>}
          {linkMatterId ? (
            <LinkDocumentMatterMaterial
              key={`${linkMatterId}:${document.familyId}`}
              matterId={linkMatterId}
              document={document}
            />
          ) : null}
          <details className="library-quicklook-history">
            <summary>改版比较与全部版本（{document.versions.length}）</summary>
          <p className="library-quicklook-note">版本状态以文档管理模块的登记为准。重复评估关联已有文档版本。颁发时间与 ATA 为原文观察值，待核；修订、生成及入库日期分别保留。</p>
          <div className="library-revision-picker">
            <p className="library-revision-picker-note">
              选择基线版本与比较目标版本，查看改版差异。
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
