import {
  isDocumentActivityStatementV2, type AnyDocumentActivityStatement as DocumentActivityStatement, type DocumentActivityStatementV2,
} from '@shared/document-activity.interface';

const MODALITY_CANDIDATE_EXPLANATIONS: Record<
  NonNullable<DocumentActivityStatementV2['modality']>['meaning'], string
> = {
  REQUIRED: '来源表述的要求；须结合否定线索和完整引文',
  RECOMMENDED: '来源表述的建议',
  PLANNED: '来源明确表述的意图或计划；预测或预期本身不能确认计划',
  POSSIBLE: '来源表述的发生可能性；许可或能力本身不能确认发生可能性',
  REPORTED: '来源报告的事件或状态',
  UNKNOWN: '本候选未分类；不表示来源事实未知',
};

/** Saved v2 cues only. This block never derives a new summary or scope decision. */
export default function DocumentActivityStatementSemantics({ statement }: { statement: DocumentActivityStatement }) {
  if (!isDocumentActivityStatementV2(statement)) return null;
  const missing = '本候选未捕获';
  const quoteIndex = (index: number) => `引文 #${index + 1}`;
  return <section data-testid="activity-statement-semantics" className="space-y-1 text-xs text-muted-foreground">
    <h3>来源解释候选 · v2</h3>
    <p>以下仅展示保存的来源原词与候选字段；未捕获不表示原文没有。</p>
    <dl className="whitespace-pre-wrap">
      <dt>主体原词</dt><dd>{statement.subject ? `${statement.subject.raw} · ${quoteIndex(statement.subject.quoteIndex)}` : missing}</dd>
      <dt>动作原词</dt><dd>{statement.action ? `${statement.action.raw} · ${quoteIndex(statement.action.quoteIndex)}` : missing}</dd>
      <dt>情态原词</dt><dd>{statement.modality ? `${statement.modality.raw} · ${statement.modality.meaning} · ${quoteIndex(statement.modality.quoteIndex)}` : missing}</dd>
      <dt>情态候选分类说明</dt><dd>{statement.modality ? MODALITY_CANDIDATE_EXPLANATIONS[statement.modality.meaning] : missing}</dd>
      <dt>否定线索</dt><dd>{statement.modality?.negationQuoteIndexes.length
        ? statement.modality.negationQuoteIndexes.map((index) => `${quoteIndex(index)}：${statement.quotes[index]?.text ?? '对应引文未返回'}`).join('；') : missing}</dd>
      <dt>状态候选</dt><dd>{statement.status ? `${statement.status.raw} · ${statement.status.meaning} · ${quoteIndex(statement.status.quoteIndex)}` : missing}</dd>
    </dl>
    <p>固定类别仅为候选解释，不能完整表达所有来源含义；请结合原词、完整引文与限制阅读。</p>
    {statement.status?.meaning === 'SOURCE_REPORTED_COMPLETED' ? <p>来源声称已完成；不表示我方已执行，也不证明验证有效或正式采用。</p> : null}
    <h4>技术编号原词（不是发生时间）</h4>
    {statement.technicalIds.length ? <ul className="whitespace-pre-wrap">{statement.technicalIds.map((cue, index) =>
      <li key={index}>{cue.raw} · {cue.kind} · {quoteIndex(cue.quoteIndex)}</li>)}</ul> : <p>{missing}</p>}
    <h4>条件与限制原词</h4>
    {statement.scope.conditions.length ? <ul className="whitespace-pre-wrap">{statement.scope.conditions.map((cue, index) =>
      <li key={index}>{cue.raw} · {cue.kind} · {cue.appliesTo} · {quoteIndex(cue.quoteIndex)}{cue.sectionIds.length ? ` · 章节 ${cue.sectionIds.join('、')}` : ''}</li>)}</ul> : <p>{missing}</p>}
    <p>候选章节范围：{statement.scope.sectionIds.join('、') || missing} · 捕获范围标记：{statement.scope.completeness}</p>
    <p>范围字段只表示本候选捕获，不证明全文完整、已读取或已审核。</p>
  </section>;
}
