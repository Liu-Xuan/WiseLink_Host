import { useLibraryPaneScroll } from './useLibraryPaneScroll';
import { useEffect } from 'react';
import { ArrowRight, BookOpen, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import useEngineeringMatter from '@client/src/features/matter/useEngineeringMatter';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import {
  matterDocumentRoute,
} from '@client/src/features/matter/matter-navigation';
import MatterProblemWork from '@client/src/features/matter/MatterProblemWork';
import OverviewCorrectionNotices from '@client/src/features/matter/OverviewCorrectionNotices';
import OverviewSourceWork from '@client/src/features/matter/OverviewSourceWork';
import ReferenceWorkNotices from '@client/src/features/matter/ReferenceWorkNotices';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';
import { savedReadingSummary } from '@client/src/features/matter/AssessmentReadingListSummary';
import { libraryDocumentReadingRoute, libraryMatterReadingRoute } from '@client/src/features/matter/reading-return';

export function LibraryMatterQuicklookContent({
  data,
}: {
  data: EngineeringMatterWorkspaceRead;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const current = data.working.current;
  const result = current?.state.substantiveResult;
  const problemWork = current?.state.problemWork;
  const summary = result ? savedReadingSummary(result) : null;
  const locateDocument = (source: DocumentAssessmentEvidence) =>
    navigate(matterDocumentRoute(data.matter.matterId, source, 'brief', current?.matterWorkRevisionId,
      new URLSearchParams(libraryMatterReadingRoute(data.matter.matterId, searchParams).split('?')[1])));
  return (
    <>
      <header className="atlas-library-inspector-title">
        <BookOpen aria-hidden="true" />
        <small>工程事项 · 工作修订 {data.working.currentWorkingRevision}</small>
        <h2>{problemWork?.headline || summary?.headline || data.matter.title}</h2>
      </header>
      <section className="atlas-library-reading-block atlas-library-summary-block">
        <h3>{problemWork?.overviewStatus === 'STALE' ? '已保存认识 · 综合待更新' : '当前认识'}</h3>
        {problemWork?.overviewStatus === 'STALE' ? <p className="atlas-library-attention">最新问题已更新，以下综合尚未覆盖这些变化。</p> : null}
        {data.working.pendingInputs.length ? <p className="atlas-library-attention">{data.working.pendingInputs.length} 项资料变化待核对。</p> : null}
        {current?.correctionNotices?.map(notice => <p key={notice.attemptRef} className="atlas-library-attention">{notice.unchanged ? '已核对并保留原认识' : notice.correctedWorkRef ? '已有后继更正，当前仍为原版本' : '更正待核对'}：{notice.reason}</p>)}
        {current?.overviewCorrectionNotices?.length ? <p className="atlas-library-attention">本综合存在更正记录，请展开核对其保存结果与覆盖范围。</p> : null}
        {summary && problemWork?.overviewStatus !== 'NOT_AVAILABLE' ? (
          <>
            <p><strong>{summary.listBrief}</strong></p>
            <h4>决定性条件</h4>
            <ul>
              {summary.decisiveClaims.map((claim) => (
                <li key={claim.claimId}>{claim.text}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>尚无已保存的事项综合认识。</p>
        )}
      </section>
      <ReferenceWorkNotices notices={current?.referenceWorkNotices} />
      <div className="atlas-library-inspector-actions">
        <Button asChild><Link to={`/matters/${encodeURIComponent(data.matter.matterId)}/posture`}>工程态势</Link></Button>
        <Button asChild>
          <Link to={libraryMatterReadingRoute(data.matter.matterId, searchParams)}>
            阅读事项 Wiki <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <details className="atlas-library-details">
        <summary>展开完整工作、依据与后续关注</summary>
      <section className="atlas-library-reading-block">
        <h3>已保存工作 · 我方候选意见</h3>
        {problemWork ? (
          <>
            <p>问题分析已保存；保存不代表综合已覆盖或已正式采用。</p>
            <MatterProblemWork
              revision={current}
              onLocateDocument={locateDocument}
              showReferenceNotices={false}
            />
          </>
        ) : null}
        {!problemWork ? (
          <OverviewSourceWork matterId={data.matter.matterId} source={current?.overviewSourceWork} overviewStatus={result ? undefined : 'NOT_AVAILABLE'} />
        ) : null}
        {!problemWork ? (
          <OverviewCorrectionNotices
            matterId={data.matter.matterId}
            notices={current?.overviewCorrectionNotices}
          />
        ) : null}

        {result && problemWork?.overviewStatus !== 'NOT_AVAILABLE' ? (
          <>
            <h4>
              {problemWork?.overviewStatus === 'STALE'
                ? '已保存意见 · 尚未覆盖当前问题更新'
                : '已保存意见及其范围'}
            </h4>
            <SavedAssessmentReading
              result={result}
              onLocateDocument={locateDocument}
            />
          </>
        ) : !result ? (
          <p>尚未取得已保存的事项阅读结果。成员文档的意见不代替全事项结论。</p>
        ) : null}
      </section>
      <section className="atlas-library-reading-block">
        <h3>背景资料</h3>
        <ul>
          {data.matter.catalog.entries.map((entry) => (
            <li key={entry.workItemId}>
              <Link
                to={libraryDocumentReadingRoute(entry.document.documentVersionId, searchParams)}
              >
                {entry.document.documentCode} ·{' '}
                {entry.document.businessRevision || '版本待核'}
              </Link>
              <small>
                {entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料'} ·{' '}
                {entry.workItemChangedSinceLink
                  ? '关联后已有变化'
                  : '已登记关联'}
              </small>
            </li>
          ))}
        </ul>
        <p className="atlas-library-muted">
          关联不代表已读取，核查范围以保存记录为准。
        </p>
      </section>
      <section className="atlas-library-reading-block">
        <h3>资料措施与前提</h3>
        <p>
          当前接口未单独返回资料措施与实施前提。请在上述原文及候选判断的依据中核对，不以我方建议代替资料原意。
        </p>
      </section>
      <section className="atlas-library-reading-block">
        <h3>我方评估进展</h3>
        <p>{current?.changeSummary || '尚无已保存的事项工作更新。'}</p>
        {data.working.pendingInputs.length ? (
          <p className="atlas-library-attention">
            {data.working.pendingInputs.length}{' '}
            项新增或变化的材料尚未覆盖；已有认识不冒充已纳入这些变化。
          </p>
        ) : (
          <p className="atlas-library-muted">
            本次未返回待覆盖输入；不表示评估完成或事实已全部核实。
          </p>
        )}
      </section>
      <section className="atlas-library-reading-block">
        <h3>真实实施与故障记录</h3>
        <p>
          未核实。当前读模型未返回实施、执行完成或故障记录，不能判断已完成、未实施或无故障。
        </p>
      </section>
      <section className="atlas-library-reading-block">
        <h3>后续关注</h3>
        {current &&
        (current.state.openQuestions.length ||
          current.state.reviewConditions.length) ? (
          <ul>
            {current.state.openQuestions.map((item) => (
              <li key={`question:${item.itemId}`}>{item.text}</li>
            ))}
            {current.state.reviewConditions.map((item) => (
              <li key={`review:${item.itemId}`}>复看条件：{item.text}</li>
            ))}
          </ul>
        ) : (
          <p>尚未单独保存待核问题或复看条件；不表示没有后续关注事项。</p>
        )}
      </section>

      </details>
    </>
  );
}

export default function LibraryMatterQuicklook({
  matterId,
  sessionGeneration,
  authenticationRequired,
  onClose,
  onRead,
}: {
  matterId: string;
  sessionGeneration: number;
  authenticationRequired: boolean;
  onClose(): void;
  onRead(data: EngineeringMatterWorkspaceRead | null): void;
}) {
  const read = useEngineeringMatter(
    matterId,
    sessionGeneration,
    authenticationRequired,
  );
  const paneScroll = useLibraryPaneScroll<HTMLElement>('quicklookY', Boolean(read.data), sessionGeneration);
  useEffect(() => {
    onRead(read.data);
  }, [read.data, onRead]);
  return (
    <aside {...paneScroll} className="atlas-library-inspector" aria-label="工程事项快览">
      <div className="atlas-library-inspector-heading">
        <span>这件事的工程要点</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭事项快览"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {read.loading ? <p role="status">正在读取已保存的事项认识…</p> : null}
      {read.error ? (
        <div role="alert">
          <p>
            {read.error}
            {read.data ? ' 以下保留上次读回。' : ''}
          </p>
          <Button
            variant="outline"
            onClick={() => void read.refresh().catch(() => undefined)}
          >
            重新读取
          </Button>
        </div>
      ) : null}
      {read.data ? (
        <LibraryMatterQuicklookContent data={read.data} />
      ) : !read.loading && !read.error ? (
        <p>选择一个事项查看其已保存认识。</p>
      ) : null}
    </aside>
  );
}
