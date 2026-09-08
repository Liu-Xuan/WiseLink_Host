import type { FC } from 'react';

import { Button } from '@client/src/components/ui/button';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';

import type { DocumentAssessmentEvidence } from './assessment-reading';

interface AssessmentEvidenceContextProps {
  evidence: AssessmentEvidence;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}

const ASSESSMENT_EVIDENCE_LABELS: Record<AssessmentEvidence['kind'], string> = {
  DOCUMENT_PASSAGE: '文档片段',
  ENGINEER_STATEMENT: '工程师陈述',
  HOST_FACT: 'Host 受控事实',
  QUERY_RECEIPT: '查询范围回执',
  PRIOR_RESULT: '历史候选认识',
};

const AssessmentEvidenceContext: FC<AssessmentEvidenceContextProps> = ({
  evidence,
  onLocateDocument,
}) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
      <span>{ASSESSMENT_EVIDENCE_LABELS[evidence.kind]}</span>
      {evidence.versionLabel ? <span>{evidence.versionLabel}</span> : null}
    </div>
    <h4 className="break-words text-sm font-medium">{evidence.title}</h4>
    <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-7">
      {evidence.excerpt || '该前提未附正文摘录。'}
    </blockquote>
    {evidence.kind === 'DOCUMENT_PASSAGE' ? (
      <div className="flex flex-wrap items-center gap-3">
        <span className="break-words text-xs text-muted-foreground">
          {evidence.locator}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onLocateDocument(evidence)}
        >
          前往这份文档的原文
        </Button>
      </div>
    ) : null}
    {evidence.kind === 'ENGINEER_STATEMENT' ? (
      <p className="text-xs leading-6 text-muted-foreground">
        记录于 {evidence.recordedAt}。这是工程师提供的陈述，不等于受控完成记录。
      </p>
    ) : null}
    {evidence.kind === 'HOST_FACT' ? (
      <p className="text-xs leading-6 text-muted-foreground">
        事实记录于 {evidence.recordedAt}，对象工作修订{' '}
        {evidence.workItemRevision}。
      </p>
    ) : null}
    {evidence.kind === 'QUERY_RECEIPT' ? (
      <div className="space-y-1 text-xs leading-6 text-muted-foreground">
        <p>实际核查范围：{evidence.checkedScope}</p>
        <p>
          {evidence.coverage === 'COMPLETE'
            ? '所声明范围核查完成'
            : '所声明范围仅部分核查'}
          · {evidence.queriedAt}
        </p>
        <p>未命中仅适用于以上实际核查范围，不代表其他范围不存在。</p>
      </div>
    ) : null}
    {evidence.kind === 'PRIOR_RESULT' ? (
      <p className="text-xs leading-6 text-muted-foreground">
        引自历史结果修订 {evidence.resultRevision}，关联{' '}
        {evidence.originalEvidenceRefs.length}
        项原始前提；历史意见用于上下文，不构成新的独立事实。
      </p>
    ) : null}
  </div>
);

export default AssessmentEvidenceContext;
