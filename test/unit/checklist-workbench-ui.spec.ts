import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedChecklist, TaskChecklist, ChecklistDefinitionPanel } from '../../client/src/features/checklist/ChecklistPanel';
import { buildJobAidChecklistBinding } from '../../server/modules/canonical-host/jobaid-checklist-binding';
import { currentChecklistDefinition, projectTaskChecklist } from '../../server/modules/canonical-host/jobaid-checklist-reading';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

function saved() {
  const revision = jobAidReadingFixture().current!;
  revision.content.checklistBinding = buildJobAidChecklistBinding({ workItemId: revision.workItemId,
    documentVersionId: revision.documentVersionId, basedOnWorkItemRevision: revision.basedOnWorkItemRevision });
  revision.content.checklistResults = [{ itemId: 'ENG-SCOPE-01', itemApplicability: 'UNDETERMINED', outcome: 'OPEN',
    resultRefs: [{ issueKey: revision.content.issues[0]!.issueKey, fieldPath: '/body' }], basisRefs: [] }];
  revision.content.issues[0]!.openQuestions = [{ question: '合成未决问题', affects: '合成影响', reason: '合成缺件', nextEvidence: '合成待补依据' }];
  return revision;
}

it('shows complete same-snapshot definition, frozen selection, actual results and unresolved detail without control fields', () => {
  const revision = saved();
  const binding = revision.content.checklistBinding!;
  binding.goal.workItemId = 'control-marker-not-for-page';
  binding.selection[0]!.reason = '封存时的本轮选择说明';
  const html = renderToStaticMarkup(createElement(SavedChecklist, { work: revision.content, workRef: 'work-exact-old' }));
  for (const item of binding.definition.items) {
    expect(html).toContain(item.title);
    expect(html).toContain(item.question);
    expect(html).toContain(item.trigger.unknownHandling);
    for (const text of item.minimumCompletion) expect(html).toContain(text);
  }
  expect(html).toContain('封存时的本轮选择说明');
  expect(html).toContain('data-checklist-work-ref="work-exact-old"');
  expect(html).toContain(binding.definitionContentHash);
  expect(html).toContain('合成未决问题');
  expect(html).toContain('合成待补依据');
  expect(html).toContain('适用条件未明');
  expect(html).toContain('data-outcome="OPEN"');
  expect(html).toContain('NOT_MACHINE_ASSESSED');
  expect(html).not.toMatch(/control-marker-not-for-page|通过率|已通过|tone="good"/u);
});

it('keeps a new task without a binding separate from readable previous work, without latest substitution', () => {
  const revision = saved();
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(TaskChecklist, { checklist: { status: 'NOT_PREPARED', snapshot: null } }),
    createElement(SavedChecklist, { work: revision.content, workRef: 'previous-revision' })));
  expect(html).toContain('本任务尚未封存');
  expect(html).toContain('previous-revision');
  expect(html.split('本任务封存检查单')[1]!.split('</details>')[0]).not.toContain(revision.content.checklistBinding!.definitionContentHash);
  const noBinding = { ...revision.content, checklistBinding: undefined, checklistResults: undefined };
  expect(renderToStaticMarkup(createElement(SavedChecklist, { work: noBinding, workRef: 'legacy-exact' })))
    .toContain('不以当前定义重建历史结果');
});

it('shows the actual task definition without inventing result rows, and separates the current release view', () => {
  const revision = saved(), binding = revision.content.checklistBinding!;
  const task = projectTaskChecklist({ prepared: true, workItemId: revision.workItemId, attemptId: 'ATT-new',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION', documentVersionId: revision.documentVersionId, binding },
  { workItemId: revision.workItemId, attemptId: 'ATT-new', taskType: 'OPENCLAW_DYNAMIC_EVALUATION' });
  const taskHtml = renderToStaticMarkup(createElement(TaskChecklist, { checklist: task }));
  expect(taskHtml).toContain('尚无本项保存结果');
  expect(taskHtml).not.toContain('合成未决问题');
  expect(taskHtml).not.toContain('data-outcome=');
  const management = renderToStaticMarkup(createElement(ChecklistDefinitionPanel, { definition: currentChecklistDefinition().current }));
  expect(management).toContain('没有某一任务的选择与验收范围');
  expect(management).not.toContain('data-outcome=');
});

it.each(['OPEN', 'CONFLICT', 'DEFERRED', 'ANSWERED'] as const)('does not turn %s into engineering approval', outcome => {
  const revision = saved(); revision.content.checklistResults![0]!.outcome = outcome;
  const html = renderToStaticMarkup(createElement(SavedChecklist, { work: revision.content, workRef: 'saved-exact' }));
  expect(html).toContain(`data-outcome="${outcome}"`);
  expect(html).toContain('不表示正式采用');
  expect(html).not.toMatch(/已通过|通过率|bg-green|text-green/u);
});
