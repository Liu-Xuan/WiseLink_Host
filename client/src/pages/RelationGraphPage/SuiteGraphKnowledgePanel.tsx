import { memo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  House,
  Lightbulb,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import OverviewSourceWork from '@client/src/features/matter/OverviewSourceWork';
import OverviewCorrectionNotices from '@client/src/features/matter/OverviewCorrectionNotices';
import ReferenceWorkNotices from '@client/src/features/matter/ReferenceWorkNotices';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type { SuiteMatterGraphRead, SuiteMatterGraphTarget } from './suite-matter-graph';
import type { SuiteGraphTimelineEvent } from './suite-graph-timeline';

export type SuiteGraphKnowledgeTab = 'knowledge' | 'basis' | 'discussion';

export interface SuiteGraphKnowledgePanelProps {
  read: SuiteMatterGraphRead;
  revision: EngineeringMatterWorkingRevisionReadModel | null;
  selectedTarget: SuiteMatterGraphTarget | null;
  selectedEvent: SuiteGraphTimelineEvent | null;
  tab: SuiteGraphKnowledgeTab;
  onTabChange: (tab: SuiteGraphKnowledgeTab) => void;
  onLocateEvidence?: (evidence: DocumentAssessmentEvidence) => void;
  onOpenTarget?: (target: SuiteMatterGraphTarget) => void;
  onOpenWiki?: () => void;
  onClearSelection?: () => void;
}

const OVERVIEW_STATUS_LABELS: Record<string, string> = {
  CURRENT: '当前综合与所选工作范围一致',
  STALE: '综合可能滞后于新材料，需核对',
  NOT_AVAILABLE: '当前范围没有可展示综合',
};

const PREMISE_ROLE_LABELS: Record<string, string> = {
  SUPPORTS: '支持',
  LIMITS: '限定',
  CONTEXT: '背景',
  CONFLICTS: '冲突',
};

const TABS: Array<{ id: SuiteGraphKnowledgeTab; label: string }> = [
  { id: 'knowledge', label: '知识百科' },
  { id: 'basis', label: '依据资料' },
  { id: 'discussion', label: '交流' },
];

const whenText = (when: { kind: 'DUE_AT'; at: string } | { kind: 'ORIGINAL_CHANGED'; inputId: string; afterParseRunId: string } | null): string => {
  if (!when) return '';
  if (when.kind === 'DUE_AT') return `到期日 ${when.at}`;
  return `原材料 ${when.inputId} 变更后、解析运行 ${when.afterParseRunId} 之后`;
};

function EvidenceLines({ evidence, onLocate }: { evidence: AssessmentEvidence; onLocate?: (evidence: DocumentAssessmentEvidence) => void }) {
  const canLocate = evidence.kind === 'DOCUMENT_PASSAGE' && onLocate;
  return (
    <div className="suite-graph-evidence-item">
      <b>{evidence.title}</b>
      {evidence.versionLabel ? <span className="suite-graph-muted">{evidence.versionLabel}</span> : null}
      <p>{evidence.excerpt || '该依据未保存可读摘录。'}</p>
      {canLocate ? (
        <Button size="sm" variant="ghost" onClick={() => { if (evidence.kind === 'DOCUMENT_PASSAGE') onLocate?.(evidence); }}>打开确切原文 <ArrowRight aria-hidden="true" /></Button>
      ) : null}
    </div>
  );
}

function TargetDetail({ target, onLocateEvidence, onOpenTarget }: {
  target: SuiteMatterGraphTarget;
  onLocateEvidence?: (evidence: DocumentAssessmentEvidence) => void;
  onOpenTarget?: (target: SuiteMatterGraphTarget) => void;
}) {
  if (target.kind === 'claim') {
    return (
      <>
        <span className="suite-graph-target-kind">已保存认识</span>
        <p>{target.claim.text}</p>
        <p className="suite-graph-muted">{target.claim.basis === 'CONDITIONAL_INFERENCE' ? '有条件的推断 · 候选意见' : '来源陈述 · 待工程师核对'}</p>
        {target.claim.premises.map((premise) => (
          <p className="suite-graph-notice" key={`${premise.evidenceRef}-${premise.role}`}>
            {PREMISE_ROLE_LABELS[premise.role] ?? premise.role}：{premise.explanation}
            {premise.limitation ? `；限制：${premise.limitation}` : ''}（依据：{premise.evidenceRef}）
          </p>
        ))}
      </>
    );
  }
  if (target.kind === 'question') {
    return (
      <>
        <span className="suite-graph-target-kind">{target.item.when ? '复看条件' : '未决问题'}</span>
        <p>{target.item.text}</p>
        {target.item.when ? <p className="suite-graph-muted">复看时机：{whenText(target.item.when)}</p> : null}
        {onOpenTarget ? <Button variant="outline" onClick={() => onOpenTarget(target)}>查看保存正文 <ArrowRight aria-hidden="true" /></Button> : null}
      </>
    );
  }
  if (target.kind === 'evidence') {
    return (
      <>
        <span className="suite-graph-target-kind">认识依据</span>
        <h3>{target.evidence.title}</h3>
        {target.evidence.versionLabel ? <p className="suite-graph-muted">{target.evidence.versionLabel}</p> : null}
        <p>{target.evidence.excerpt || '该依据未保存可读摘录。'}</p>
        {target.evidence.kind === 'DOCUMENT_PASSAGE' && onLocateEvidence ? (
          <Button variant="outline" onClick={() => { if (target.evidence.kind === 'DOCUMENT_PASSAGE') onLocateEvidence(target.evidence); }}>打开确切原文 <ArrowRight aria-hidden="true" /></Button>
        ) : null}
      </>
    );
  }
  if (target.kind === 'material') {
    const material = target.material;
    if (material.kind === 'EXPECTED') {
      return (
        <>
          <span className="suite-graph-target-kind">预计资料</span>
          <h3>{material.expected.documentNumber || material.expected.description || '未命名预计资料'}</h3>
          <p>预期贡献：{material.expected.expectedContribution || '未注明'}；来源时点：{material.expected.sourceAsOf}。</p>
          <p className="suite-graph-muted">已取得 {material.expected.fulfilledBy.length} 份；预计资料不计为已取得。</p>
        </>
      );
    }
    return (
      <>
        <span className="suite-graph-target-kind">{material.kind === 'MEMBER' ? '事项资料' : '参考资料'}</span>
        <p>材料范围：{material.scope || '未注明'}；贡献：{material.contribution || '未单独保存'}。</p>
        <details className="suite-graph-governance-details">
          <summary>来源与版本</summary>
          <p className="suite-graph-muted">版本身份：{material.documentVersionId || '未返回'}</p>
          <p className="suite-graph-muted">依据：{material.basis.map((item) => `${item.documentVersionId}/${item.sourceRefId}`).join('、') || '未返回'}</p>
        </details>
        {material.documentVersionId && onOpenTarget ? (
          <Button variant="outline" onClick={() => onOpenTarget(target)}>打开确切原文 <ArrowRight aria-hidden="true" /></Button>
        ) : null}
      </>
    );
  }
  if (target.kind === 'catalog-document') {
    const { entry } = target;
    return (
      <>
        <span className="suite-graph-target-kind">{entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料'}</span>
        <h3>{entry.document.documentCode} · {entry.document.businessRevision}</h3>
        <details className="suite-graph-governance-details">
          <summary>来源与版本</summary>
          <p className="suite-graph-muted">版本身份：{entry.document.documentVersionId}</p>
          <p className="suite-graph-muted">家族：{entry.document.normalizedFamily}</p>
          <p className="suite-graph-muted">
            {entry.documentCurrentness.selectedVersionIsCurrent
              ? '该版本为家族当前版本。'
              : `该版本不是家族当前版本；当前版本：${entry.documentCurrentness.currentDocumentVersionId ?? '未返回'}。`}
          </p>
          <p className="suite-graph-muted">关联工作项状态：{entry.workItemStatus}</p>
        </details>
        {onOpenTarget ? <Button variant="outline" onClick={() => onOpenTarget(target)}>打开确切原文 <ArrowRight aria-hidden="true" /></Button> : null}
      </>
    );
  }
  if (target.kind === 'statement') {
    const { statement } = target;
    return (
      <>
        <span className="suite-graph-target-kind">来源声明</span>
        <h3>{statement.label}</h3>
        <p className="suite-graph-muted">时间表述：{statement.time?.raw ?? '时间未提取'}</p>
        {statement.statusRaw ? <p className="suite-graph-muted">状态：{statement.statusRaw}</p> : null}
        {statement.limitations.map((limitation) => <p className="suite-graph-notice" key={limitation}>限制：{limitation}</p>)}
        {statement.quotes.map((quote, index) => (
          <blockquote className="suite-graph-quote" key={`${quote.anchorId}-${index}`}>
            <p>{quote.text}</p>
            <cite>定位：{quote.anchorId}</cite>
          </blockquote>
        ))}
        <details className="suite-graph-governance-details">
          <summary>来源与版本</summary>
          <p className="suite-graph-muted">保存身份：{target.documentVersionId} · {target.parseRunId} · 候选修订 {target.candidateRevision}</p>
        </details>
        {onOpenTarget ? <Button variant="outline" onClick={() => onOpenTarget(target)}>查看完整时间轴 <ArrowRight aria-hidden="true" /></Button> : null}
      </>
    );
  }
  if (target.kind === 'matter-node') {
    return (
      <>
        <span className="suite-graph-target-kind">目录事项</span>
        <h3>{target.title}</h3>
        <p className="suite-graph-muted">事项身份：{target.matterId}</p>
        {target.status ? <p className="suite-graph-muted">综合状态：{OVERVIEW_STATUS_LABELS[target.status] ?? target.status}</p> : null}
        {onOpenTarget ? <Button variant="outline" onClick={() => onOpenTarget(target)}>打开该事项图谱 <ArrowRight aria-hidden="true" /></Button> : null}
      </>
    );
  }
  if (target.kind === 'document') {
    return (
      <>
        <span className="suite-graph-target-kind">已取得资料</span>
        <details className="suite-graph-governance-details">
          <summary>来源与版本</summary>
          <p className="suite-graph-muted">确切文档版本：{target.documentVersionId}</p>
        </details>
        {onOpenTarget ? <Button variant="outline" onClick={() => onOpenTarget(target)}>打开确切原文 <ArrowRight aria-hidden="true" /></Button> : null}
      </>
    );
  }
  if (target.kind === 'input') {
    return (
      <>
        <span className="suite-graph-target-kind">当时保存的输入</span>
        <details className="suite-graph-governance-details">
          <summary>来源与版本</summary>
          <p className="suite-graph-muted">保存输入绑定：{target.binding.documentVersionId}；工作版本：{target.workRef}。</p>
        </details>
        {onOpenTarget ? <Button variant="outline" onClick={() => onOpenTarget(target)}>查看保存正文 <ArrowRight aria-hidden="true" /></Button> : null}
      </>
    );
  }
  return <p>该对象的完整来源和身份保留在当前授权读取结果中。</p>;
}

/**
 * Right column: Suite knowledge organization. Without a selection it shows the same
 * revision's saved understanding, open questions and basis; with a selection it shows
 * that object's saved identity, decisive conditions and exact source. No new
 * summaries are generated from long text.
 */
const SuiteGraphKnowledgePanel = memo(function SuiteGraphKnowledgePanel({
  read,
  revision,
  selectedTarget,
  selectedEvent,
  tab,
  onTabChange,
  onLocateEvidence,
  onOpenTarget,
  onOpenWiki,
  onClearSelection,
}: SuiteGraphKnowledgePanelProps) {
  const result = revision?.state.substantiveResult ?? null;
  const problemWork = revision?.state.problemWork;
  const overviewStatus = problemWork?.overviewStatus ?? read.overviewStatus;
  const summaryUsesOverview = overviewStatus !== 'NOT_AVAILABLE' && Boolean(result?.content.lead);
  const summaryText = overviewStatus === 'NOT_AVAILABLE'
    ? problemWork?.understanding || problemWork?.listBrief
    : result?.content.lead || problemWork?.understanding || problemWork?.listBrief;
  const summaryLabel = summaryUsesOverview
    ? overviewStatus === 'STALE' ? '此前综合摘要' : '综合摘要'
    : problemWork?.understanding ? '问题理解' : '事项摘要';
  const evidenceList = [...new Map([...(result?.evidence ?? []), ...(problemWork?.evidence ?? [])].map(item => [item.evidenceRef, item])).values()];
  // Deduplicate the displayed question while retaining every saved issue's identity and scope.
  const pendingByText = new Map<string, { text: string; sources: Array<{ key: string; issueRef: string; question: string; affects: string; nextEvidence: string; reason: string }> }>();
  for (const item of revision?.state.openQuestions ?? []) {
    const key = item.text.trim();
    if (!pendingByText.has(key)) pendingByText.set(key, { text: item.text, sources: [] });
  }
  for (const issue of problemWork?.issues ?? []) {
    for (const [index, item] of issue.openQuestions.entries()) {
      const key = item.question.trim();
      const entry = pendingByText.get(key) ?? { text: item.question, sources: [] };
      entry.sources.push({ ...item, key: `${issue.issueRef}-${index}`, issueRef: issue.issueRef, question: issue.question });
      pendingByText.set(key, entry);
    }
  }
  const openQuestions = [...pendingByText.values()];
  const reviewConditions = revision?.state.reviewConditions ?? [];
  const renderTabContent = () => {
    if (tab === 'discussion') {
      return (
        <>
          <h2>继续核对</h2>
          {openQuestions.length === 0 && reviewConditions.length === 0 ? (
            <p className="suite-graph-muted">当前工作没有已保存的未决问题或复看条件。</p>
          ) : null}
          {openQuestions.map((item) => (
            <div className="suite-graph-notice" key={item.text.trim()}>
              <p>未决问题：{item.text}</p>
              {item.sources.map(source => (
                <div key={source.key}>
                  <p>所属问题：{source.question}（{source.issueRef}）</p>
                  {source.affects ? <p>影响：{source.affects}</p> : null}
                  {source.reason ? <p>原因：{source.reason}</p> : null}
                  {source.nextEvidence ? <p>下一证据：{source.nextEvidence}</p> : null}
                </div>
              ))}
            </div>
          ))}
          {reviewConditions.map((item) => (
            <p className="suite-graph-notice" key={item.itemId}>复看条件：{item.text}{item.when ? `（${whenText(item.when)}）` : ''}</p>
          ))}
          <p className="suite-graph-muted">复核交流在事项 Wiki 中进行，图谱页不新建保存。</p>
          {onOpenWiki ? <Button variant="outline" onClick={onOpenWiki}>前往事项 Wiki 复核 <ArrowRight aria-hidden="true" /></Button> : null}
        </>
      );
    }
    if (tab === 'basis') {
      if (selectedEvent?.statement) {
        const { statement } = selectedEvent;
        return (
          <>
            <h2>声明依据</h2>
            <p>{statement.label}</p>
            {statement.quotes.map((quote, index) => (
              <blockquote className="suite-graph-quote" key={`${quote.anchorId}-${index}`}>
                <p>{quote.text}</p>
                <cite>定位：{quote.anchorId}</cite>
              </blockquote>
            ))}
            <p className="suite-graph-muted">{selectedEvent.sourceLabel ?? ''} · 保存身份 {selectedEvent.pins?.parseRunId ?? ''}</p>
          </>
        );
      }
      if (selectedTarget) {
        if (selectedTarget.kind === 'material' && selectedTarget.material.kind !== 'EXPECTED') {
          return (
            <>
              <h2>材料依据</h2>
              {selectedTarget.material.basis.length === 0 ? <p className="suite-graph-muted">当前授权范围未返回材料依据。</p> : null}
              {selectedTarget.material.basis.map((item) => (
                <p className="suite-graph-notice" key={`${item.documentVersionId}-${item.sourceRefId}`}>{item.documentVersionId} / {item.sourceRefId}</p>
              ))}
            </>
          );
        }
        if (selectedTarget.kind === 'claim') {
          return (
            <>
              <h2>认识前提</h2>
              {selectedTarget.claim.premises.length === 0 ? <p className="suite-graph-muted">该认识未保存前提。</p> : null}
              {selectedTarget.claim.premises.map((premise) => (
                <p className="suite-graph-notice" key={`${premise.evidenceRef}-${premise.role}`}>
                  {PREMISE_ROLE_LABELS[premise.role] ?? premise.role}：{premise.explanation}（依据：{premise.evidenceRef}）
                </p>
              ))}
            </>
          );
        }
        return <p className="suite-graph-muted">所选对象没有单独保存的依据明细。</p>;
      }
      return (
        <>
          <h2>依据资料</h2>
          {evidenceList.length === 0 ? <p className="suite-graph-muted">当前工作没有已保存依据。</p> : null}
          {evidenceList.map((evidence) => (
            <EvidenceLines evidence={evidence} key={evidence.evidenceRef} onLocate={onLocateEvidence} />
          ))}
          {read.missingEvidenceRefs.length > 0 ? (
            <p className="suite-graph-notice">{read.missingEvidenceRefs.length} 条依据尚未在当前授权范围返回。</p>
          ) : null}
        </>
      );
    }
    if (selectedEvent?.statement && selectedEvent.pins) {
      return (
        <>
          <span className="suite-graph-target-kind">来源声明</span>
          <h2>{selectedEvent.statement.label}</h2>
          <p className="suite-graph-muted">{selectedEvent.sourceLabel ?? ''} · {selectedEvent.date}</p>
          <TargetDetail
            target={{
              kind: 'statement',
              statement: selectedEvent.statement,
              documentVersionId: selectedEvent.pins.documentVersionId,
              familyId: selectedEvent.pins.familyId,
              parseRunId: selectedEvent.pins.parseRunId,
              candidateRevision: selectedEvent.pins.candidateRevision,
              runRef: selectedEvent.pins.runRef,
            }}
            onLocateEvidence={onLocateEvidence}
            onOpenTarget={onOpenTarget}
          />
        </>
      );
    }
    if (selectedTarget) {
      return (
        <>
          {onClearSelection ? (
            <Button variant="ghost" className="suite-graph-back-to-matter" onClick={onClearSelection}>
              <ArrowLeft aria-hidden="true" /> 返回事项
            </Button>
          ) : null}
          <TargetDetail
            target={selectedTarget}
            onLocateEvidence={onLocateEvidence}
            onOpenTarget={onOpenTarget}
          />
        </>
      );
    }
    return (
      <>
        <h2>{read.graph.rootKind === 'display' ? '当前打开事项的已保存工作' : read.graph.title}</h2>
        {read.graph.code ? <small className="suite-graph-matter-code">{read.graph.code}</small> : null}
        {overviewStatus === 'STALE' ? <p className="suite-graph-notice">此前综合尚未覆盖本工作中的最新问题，只按原范围保留阅读。</p> : null}
        {overviewStatus === 'NOT_AVAILABLE' ? <p className="suite-graph-notice">问题工作已经保存，当前范围尚未形成综合认识。</p> : null}
        <section>
          <h3><House aria-hidden="true" />{summaryLabel}</h3>
          <p>{summaryText || '当前工作尚未保存问题理解或事项摘要。'}</p>
        </section>
        <section>
          <h3><Lightbulb aria-hidden="true" />{overviewStatus === 'STALE' ? '此前综合认识' : '当前认识'}</h3>
          {overviewStatus !== 'NOT_AVAILABLE' && result?.content.claims.length ? result.content.claims.map((claim) => (
            <p className="suite-graph-bullet" key={claim.claimId}>{claim.text}</p>
          )) : overviewStatus !== 'NOT_AVAILABLE' ? <p>当前工作尚未保存可供阅读的认识正文。</p> : null}
        </section>
        {problemWork?.issues.length ? <section>
          <h3><AlertTriangle aria-hidden="true" />正在分析的问题</h3>
          {problemWork?.issues.map((issue) => (
            <p className="suite-graph-bullet" key={`issue-question-${issue.issueRef}`}>{issue.question}</p>
          ))}
        </section> : null}
        <section>
          <h3><RotateCcw aria-hidden="true" />认识的变化</h3>
          <p>{revision?.changeSummary || '当前保存工作没有单独填写变化说明。'}</p>
          {problemWork?.overviewStatus === 'STALE' ? <p className="suite-graph-notice">综合尚未覆盖本工作中的问题更新。</p> : null}
          {problemWork?.overviewStatus === 'NOT_AVAILABLE' ? <p className="suite-graph-notice">问题正文已保存，当前综合尚未形成。</p> : null}
        </section>
        <section>
          <h3><AlertTriangle aria-hidden="true" />继续核对</h3>
          {openQuestions.map((item) => <p className="suite-graph-bullet" key={item.text.trim()}>{item.text}</p>)}
          {reviewConditions.map((item) => <p className="suite-graph-bullet" key={item.itemId}>{item.text}</p>)}
          {openQuestions.length === 0 && reviewConditions.length === 0 ? <p>当前工作没有已保存的未决问题或复看条件。</p> : null}
        </section>
        <section>
          <h3><FileText aria-hidden="true" />关键依据</h3>
          {evidenceList.slice(0, 4).map((evidence) => (
            <EvidenceLines evidence={evidence} key={evidence.evidenceRef} onLocate={onLocateEvidence} />
          ))}
          {evidenceList.length === 0 ? <p>当前工作没有已保存依据。</p> : null}
          {read.missingEvidenceRefs.length ? <p className="suite-graph-notice">{read.missingEvidenceRefs.length} 条依据尚未在当前授权范围返回。</p> : null}
        </section>
        {revision ? (
          <details className="suite-graph-governance-details">
            <summary>版本、综合与更正边界</summary>
            <OverviewSourceWork matterId={revision.matterId} source={revision.overviewSourceWork} overviewStatus={problemWork?.overviewStatus} />
            <OverviewCorrectionNotices matterId={revision.matterId} notices={revision.overviewCorrectionNotices} />
            {revision.correctionNotices?.map((notice) => <p key={notice.attemptRef} role="note">{notice.unchanged ? '已比较并保留：' : '问题更正记录：'}{notice.reason}</p>)}
            <ReferenceWorkNotices notices={revision.referenceWorkNotices} />
          </details>
        ) : null}
        {read.overviewStatus ? (
          <p className="suite-graph-status">当前综合状态：{OVERVIEW_STATUS_LABELS[read.overviewStatus] ?? read.overviewStatus}</p>
        ) : null}
        {read.notices.map((notice) => <p className="suite-graph-notice" key={notice}>{notice}</p>)}
        {onOpenWiki ? (
          <div className="suite-graph-knowledge-action">
            <Button variant="outline" onClick={onOpenWiki}>
              阅读完整事项 Wiki <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </>
    );
  };
  return (
    <div className="suite-graph-knowledge" aria-label="知识正文">
      <div className="suite-graph-knowledge-tabs" role="tablist" aria-label="知识面板页签">
        {TABS.map(({ id, label }) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''}
            key={id}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="suite-graph-knowledge-body" role="tabpanel">
        {renderTabContent()}
      </div>
    </div>
  );
});

export default SuiteGraphKnowledgePanel;
