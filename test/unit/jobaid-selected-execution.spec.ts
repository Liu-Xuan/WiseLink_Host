import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import { adaptJobAidWorkingRead } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const context = { observedAt: '2026-10-23T12:00:00Z', environment: 'synthetic',
  scopeKey: '1:work-item-test', label: 'synthetic', mode: 'snapshot' as const };
function selected(actionType: NonNullable<JobAidWorkingReadModel['selectedExecution']>['actionType']) {
  return { actionType, attemptId: 'selected-attempt', attemptRef: 'persisted-operation', status: 'RUNNING',
    createdAt: '2026-10-23T01:00:00Z', startedAt: '2026-10-23T01:01:00Z', completedAt: null };
}
function nodes(read: JobAidWorkingReadModel) {
  const runtime = adaptJobAidWorkingRead(read, context)!;
  return { runtime, research: runtime.nodes.find(item => item.id === 'assessment.research')!,
    overall: runtime.nodes.find(item => item.id === 'assessment.overall')! };
}

it.each(['RUNNING', 'COMMITTING', 'SUCCEEDED', 'FAILED'])('assigns selected Overall %s to Overall without changing work or coverage', status => {
  const read = jobAidReadingFixture();
  read.latestAttempt = { attemptId: 'latest-dynamic', status: 'SUCCEEDED', inputRevision: 2,
    createdAt: '2026-10-22T01:00:00Z', firstSavedAt: '2026-10-22T01:02:00Z' };
  read.executionStatus = status;
  read.selectedExecution = { ...selected('OPENCLAW_OVERALL_SYNTHESIS'), status,
    completedAt: status === 'SUCCEEDED' || status === 'FAILED' ? '2026-10-23T01:03:00Z' : null };
  const before = structuredClone(read);
  const { research, overall } = nodes(read);
  expect(research.execution).toEqual({ label: 'SUCCEEDED', status: 'SUCCEEDED' });
  expect(research.requests.map(item => item.id)).toEqual(['latest-dynamic']);
  expect(research.outputs[0].ref).toBe(read.current!.workRevisionRef);
  expect(overall.execution).toEqual({ label: status, status });
  expect(overall.requestCompleteness).toBe('partial');
  expect(overall.requests).toEqual([expect.objectContaining({ id: 'selected-attempt', recordKind: 'attempt',
    createdAt: read.selectedExecution.createdAt, startedAt: read.selectedExecution.startedAt,
    completedAt: read.selectedExecution.completedAt ?? undefined, navigationLabel: '查看综合面板' })]);
  expect(overall.requests[0].firstSavedAt).toBeUndefined();
  expect(overall.requests[0]).not.toHaveProperty('requestId');
  expect(overall.coverage).toEqual({ label: 'Host 判定综合关系需核对', tone: 'wait' });
  expect(overall.business).toBe('本视图未读取正式业务状态');
  expect(read).toEqual(before);
});

it('retains an older selected active dynamic and a different latest terminal without borrowing its save or times', () => {
  const read = jobAidReadingFixture();
  read.selectedExecution = selected('OPENCLAW_DYNAMIC_EVALUATION');
  read.latestAttempt = { attemptId: read.current!.actionAttemptId, status: 'SUCCEEDED', inputRevision: 2,
    createdAt: '2026-10-23T02:00:00Z', startedAt: '2026-10-23T02:01:00Z',
    firstSavedAt: '2026-10-23T02:02:00Z', completedAt: '2026-10-23T02:03:00Z' };
  const { research, overall } = nodes(read);
  expect(research.execution).toEqual({ label: 'RUNNING', status: 'RUNNING' });
  expect(research.requestCompleteness).toBe('partial');
  expect(research.requests.map(item => item.id)).toEqual(['selected-attempt', read.latestAttempt.attemptId]);
  expect(research.requests[0]).toMatchObject({ createdAt: read.selectedExecution.createdAt,
    startedAt: read.selectedExecution.startedAt, artifact: '未取得此尝试对应的保存结果' });
  expect(research.requests[0].firstSavedAt).toBeUndefined();
  expect(research.requests[0].completedAt).toBeUndefined();
  expect(research.requests[1]).toMatchObject({ firstSavedAt: read.latestAttempt.firstSavedAt,
    artifact: `工作 ${read.current!.workRevision} 已保存` });
  expect(overall.execution).toBe('未取得对应尝试');
  expect(overall.requestCompleteness).toBe('not_provided');
});

it('deduplicates the same dynamic attempt while retaining its exact first save', () => {
  const read = jobAidReadingFixture();
  read.selectedExecution = selected('OPENCLAW_DYNAMIC_EVALUATION');
  read.latestAttempt = { ...read.selectedExecution, inputRevision: 2, firstSavedAt: '2026-10-23T01:02:00Z' };
  const { research } = nodes(read);
  expect(research.requests).toHaveLength(1);
  expect(research.requests[0].firstSavedAt).toBe(read.latestAttempt.firstSavedAt);
});

it.each([undefined, null])('keeps legacy missing/null selected observations unknown for Overall', observation => {
  const read = { ...jobAidReadingFixture(), selectedExecution: observation, executionStatus: 'RUNNING' };
  const { research, overall } = nodes(read);
  expect(research.requestCompleteness).toBe('latest_only');
  expect(overall.execution).toBe('未取得对应尝试');
  expect(overall.requests).toEqual([]);
  expect(overall.requestCompleteness).toBe('not_provided');
});
