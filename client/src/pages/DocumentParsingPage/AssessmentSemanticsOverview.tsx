import {
  AlertTriangle,
  ClipboardCheck,
  FileCheck2,
  UserRoundCheck,
} from 'lucide-react';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

import {
  buildAssessmentSemantics,
  type AssessmentGap,
  type AssessmentSemantics,
} from './workbench-projection';

interface AssessmentSemanticsOverviewProps {
  data: Pick<
    CanonicalDocumentParsingPageResponse,
    'workItem' | 'engineerReviewContext' | 'workbenchAudit'
  >;
}

export function AssessmentSemanticsOverview({
  data,
}: AssessmentSemanticsOverviewProps) {
  const semantics: AssessmentSemantics = buildAssessmentSemantics({
    integratedAssessment: data.workItem.integratedAssessment ?? null,
    engineerReviewContext: data.engineerReviewContext ?? null,
    readerAudit: data.workbenchAudit.reader,
  });

  return (
    <section className="parse-assessment-semantics" aria-label="评估语义概览">
      <header>
        <div>
          <span>ASSESSMENT SEMANTICS · HOST PROJECTION</span>
          <h3>候选状态、依据与缺口</h3>
        </div>
        <strong>{semantics.candidateState}</strong>
      </header>
      <div className="parse-assessment-semantics-grid">
        <article>
          <ClipboardCheck aria-hidden="true" />
          <span>动态 N/N</span>
          <strong>
            {semantics.dynamic
              ? `${semantics.dynamic.evaluationItemCount}/${semantics.dynamic.criterionCount}`
              : '未生成'}
          </strong>
          <small>
            {semantics.dynamic
              ? `${semantics.dynamic.unresolvedCount} 项未闭合 · ${semantics.dynamic.sourceBoundCandidateCount} 项来源绑定`
              : '当前 WorkItem 没有动态评估 projection'}
          </small>
        </article>
        <article>
          <FileCheck2 aria-hidden="true" />
          <span>整体候选</span>
          <strong>{semantics.overall?.status ?? '等待候选'}</strong>
          <small>
            {semantics.overall
              ? `${semantics.overall.findingCount} findings · ${semantics.overall.candidateRefCount} refs`
              : '不会由页面自行生成综合结果'}
          </small>
        </article>
        <article>
          <UserRoundCheck aria-hidden="true" />
          <span>人工复核</span>
          <strong>{semantics.review.pendingCount} 项待处理</strong>
          <small>
            {semantics.review.recordedCount} 条已记录 · {semantics.review.itemCount} 项投影
          </small>
        </article>
      </div>
      <div className="parse-assessment-gap-list" aria-label="评估缺口">
        <div>
          <AlertTriangle aria-hidden="true" />
          <strong>仍需关注的输入或状态</strong>
        </div>
        {semantics.gaps.length > 0 ? (
          semantics.gaps.map((gap: AssessmentGap) => (
            <article key={gap.code}>
              <strong>{gap.label}</strong>
              <span>{gap.detail}</span>
              <small>{gap.authority}</small>
            </article>
          ))
        ) : (
          <p>Host 当前 projection 没有报告未闭合缺口。</p>
        )}
      </div>
      <p className="parse-assessment-boundary">{semantics.boundary}</p>
    </section>
  );
}

export type { AssessmentSemanticsOverviewProps };
