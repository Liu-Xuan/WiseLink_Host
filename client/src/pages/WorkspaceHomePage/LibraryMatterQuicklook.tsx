import { useEffect } from 'react';
import { ArrowRight, BookOpen, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import useEngineeringMatter from '@client/src/features/matter/useEngineeringMatter';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import { matterOverviewRoute } from '@client/src/features/matter/matter-navigation';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { EngineeringMatterWorkspaceRead } from '@client/src/api/engineering-matter';

export function LibraryMatterQuicklookContent({
  data,
}: {
  data: EngineeringMatterWorkspaceRead;
}) {
  const navigate = useNavigate();
  const current = data.working.current;
  const result = current?.state.substantiveResult;
  return (
    <>
      <header className="atlas-library-inspector-title">
        <BookOpen aria-hidden="true" />
        <small>工程事项 · 工作修订 {data.working.currentWorkingRevision}</small>
        <h2>{data.matter.title}</h2>
        <p>{current?.state.focus.question || '当前问题描述尚未单独保存。'}</p>
      </header>
      <section className="atlas-library-reading-block">
        <h3>当前认识 · 我方候选意见</h3>
        {result ? (
          <SavedAssessmentReading
            result={result}
            onLocateDocument={(source: DocumentAssessmentEvidence) =>
              navigate(
                `/work-items/${encodeURIComponent(source.workItemId)}/documents?${new URLSearchParams({ node: 'reader', tab: 'reader', documentVersionId: source.documentVersionId, sourceRef: source.sourceRefId }).toString()}`,
              )
            }
          />
        ) : (
          <p>尚未形成已保存的事项综合认识。成员文档的意见不代替全事项结论。</p>
        )}
      </section>
      <section className="atlas-library-reading-block">
        <h3>背景资料</h3>
        <ul>
          {data.matter.catalog.entries.map((entry) => (
            <li key={entry.workItemId}>
              <Link
                to={`/work-items/${encodeURIComponent(entry.workItemId)}/documents?node=reader&tab=reader&documentVersionId=${encodeURIComponent(entry.document.documentVersionId)}`}
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
      <div className="atlas-library-inspector-actions">
        <Button asChild>
          <Link to={matterOverviewRoute(data.matter.matterId)}>
            进入事项简报 <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
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
  useEffect(() => {
    onRead(read.data);
  }, [read.data, onRead]);
  return (
    <aside className="atlas-library-inspector" aria-label="工程事项快览">
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
