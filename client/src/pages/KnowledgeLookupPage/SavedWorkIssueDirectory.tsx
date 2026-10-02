import type { EngineeringKnowledgeRead } from '@shared/engineering-issue-search.interface';
import type { JobAidProblemIssue } from '@shared/jobaid-problem-assessment.interface';
import { Button } from '@client/src/components/ui/button';
import { jobAidTreatmentLabels } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';

/** One exact saved work is already authorized by Host. Only repeated copies of
 * the same issue are collapsed; conflicting saved variants remain readable. */
export function savedWorkIssueRows(issues: JobAidProblemIssue[]) {
  const rows = new Map<string, { issueKey: string; variants: JobAidProblemIssue[] }>();
  for (const issue of issues) {
    const row = rows.get(issue.issueKey) ?? { issueKey: issue.issueKey, variants: [] };
    if (!row.variants.some(prior => JSON.stringify(prior) === JSON.stringify(issue))) row.variants.push(issue);
    rows.set(issue.issueKey, row);
  }
  return [...rows.values()];
}

export function SavedWorkIssueDirectory({ read, selectedIssueKey, onOpen }: {
  read: EngineeringKnowledgeRead;
  selectedIssueKey: string;
  onOpen: (issueKey: string) => void;
}) {
  const rows = savedWorkIssueRows(read.content.issues);
  if (!rows.length) return null;
  return <section className="knowledge-issue-directory" aria-label="已保存问题目录" data-work-ref={read.entry.workRef}>
    <h2>本工作的问题（{rows.length}）</h2>
    <p>以下均为已保存的候选分析，状态按该工作记录显示。</p>
    {selectedIssueKey ? <Button size="sm" variant="ghost" onClick={() => onOpen('')}>显示本工作全部问题</Button> : null}
    <div className="knowledge-issue-table-scroll"><table>
      <thead><tr><th scope="col">问题</th><th scope="col">要求处理</th><th scope="col">待核问题</th><th scope="col">阅读</th></tr></thead>
      <tbody>{rows.map(row => {
        const requirements = [...new Set(row.variants.flatMap(issue => issue.requirementHandling.map(item => jobAidTreatmentLabels[item.treatment])))];
        const questions = [...new Set(row.variants.flatMap(issue => issue.openQuestions.map(item => item.question)))];
        return <tr key={row.issueKey} data-issue-key={row.issueKey} aria-selected={selectedIssueKey === row.issueKey}>
          <th scope="row">{[...new Set(row.variants.map(issue => issue.question))].join(' / ')}{row.variants.length > 1 ? <p role="note">同一问题存在 {row.variants.length} 份不同保存内容，展开时全部保留。</p> : null}</th>
          <td>{requirements.join(' / ') || '未登记要求处理状态'}</td>
          <td>{questions.length ? <details><summary>{questions.length} 项待核</summary><ul>{questions.map(question => <li key={question}>{question}</li>)}</ul></details> : '未登记待核问题'}</td>
          <td><Button variant="ghost" size="sm" aria-pressed={selectedIssueKey === row.issueKey} onClick={() => onOpen(row.issueKey)}>展开完整问题</Button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}
