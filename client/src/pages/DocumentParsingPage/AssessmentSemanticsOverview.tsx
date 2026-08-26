import {
  AlertTriangle,
  ClipboardList,
  FileSearch2,
  UserRound,
} from 'lucide-react';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { humanState } from '@client/src/features/navigation/treeMappers';

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
          <span>当前评估进度</span>
          <h3>结果、依据与待补信息</h3>
        </div>
        <strong>{humanState(semantics.candidateState) ?? '待评估'}</strong>
      </header>
      <div className="parse-assessment-semantics-grid">
        <article>
          <ClipboardList aria-hidden="true" />
          <span>逐项评估</span>
          <strong>
            {semantics.dynamic
              ? `${semantics.dynamic.evaluationItemCount}/${semantics.dynamic.criterionCount}`
              : '未生成'}
          </strong>
          <small>
            {semantics.dynamic
              ? `${semantics.dynamic.unresolvedCount} 项未闭合 · ${semantics.dynamic.sourceBoundCandidateCount} 项来源绑定`
              : '当前文件尚无逐项评估结果'}
          </small>
        </article>
        <article>
          <FileSearch2 aria-hidden="true" />
          <span>整体候选</span>
          <strong>
            {humanState(semantics.overall?.status) ?? '等待综合意见'}
          </strong>
          <small>
            {semantics.overall
              ? `${semantics.overall.findingCount} 项判断 · ${semantics.overall.candidateRefCount} 条依据`
              : '完成必要评估后自动显示'}
          </small>
        </article>
        <article>
          <UserRound aria-hidden="true" />
          <span>人工复核</span>
          <strong>{semantics.review.pendingCount} 项待处理</strong>
          <small>
            {semantics.review.recordedCount} 条已记录 ·{' '}
            {semantics.review.itemCount} 项投影
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
              <small>以当前受控资料为准</small>
            </article>
          ))
        ) : (
          <p>当前结果没有报告未闭合缺口。</p>
        )}
      </div>
      <p className="parse-assessment-boundary">{semantics.boundary}</p>
    </section>
  );
}

export type { AssessmentSemanticsOverviewProps };
