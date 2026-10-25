import type { JobAidWorkingReadModel } from '../../shared/jobaid-problem-assessment.interface';
import { adaptJobAidWorkingRead } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const context = {
  observedAt: '2026-10-25T06:00:00Z', environment: 'local unit fixture',
  scopeKey: 'session:work', label: '测试事项', mode: 'snapshot' as const,
};

function programRead(): JobAidWorkingReadModel {
  const read = jobAidReadingFixture();
  read.selectedExecution = {
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION', executionMode: 'PROGRAM_CONTROLLED_V1',
    attemptId: read.current!.actionAttemptId, attemptRef: 'AQ-program', status: 'RUNNING',
    createdAt: '2026-10-25T05:00:00Z', startedAt: '2026-10-25T05:01:00Z', completedAt: null,
  };
  read.overallStatus = 'NOT_AVAILABLE';
  read.overallBasedOnWorkRevisionRef = null;
  return read;
}

function research(read: JobAidWorkingReadModel) {
  return adaptJobAidWorkingRead(read, context)!.nodes.find(node => node.id === 'assessment.research')!;
}

it('shows a persisted full response before SAVE without claiming a saved work', () => {
  const read = programRead();
  read.current = null;
  read.selectedExecution!.programProgress = {
    phase: 'MODEL_RESPONSE_SAVED', checkpointRef: 'program-response', observedAt: '2026-10-25T05:02:00Z',
  };
  const node = research(read);
  expect(node.summary).toContain('已生成，尚未保存');
  expect(node.summary).toContain('本次未启用自主调查');
  expect(node.outputs).toEqual([]);
  expect(node.requests[0].lastProgressAt).toBe('2026-10-25T05:02:00Z');
  expect(node.requests[0].lastProgressAt).not.toBe(context.observedAt);
});

it('makes exact saved work readable before Overall and without ending the execution', () => {
  const read = programRead();
  read.current!.createdAt = '2026-10-25T05:04:00Z';
  read.selectedExecution!.programProgress = {
    phase: 'MODEL_RESPONSE_SAVED', checkpointRef: 'program-response', observedAt: '2026-10-25T05:03:00Z',
  };
  const runtime = adaptJobAidWorkingRead(read, context)!;
  expect(research(read).summary).toContain('工作已保存，综合待更新');
  const reading = runtime.nodes.find(node => node.id === 'surface.reading')!;
  expect(reading.outputs[0].ref).toBe(read.current!.workRevisionRef);
  expect(reading.summary).toContain('不等待综合更新或执行收尾');
  expect(runtime.edges.find(edge => edge.to === 'surface.reading')!.refs).toEqual([read.current!.workRevisionRef]);
  expect(runtime.edges.some(edge => edge.to === 'assessment.overall')).toBe(false);
  expect(read.selectedExecution!.status).toBe('RUNNING');
  expect(research(read).requests[0].lastProgressAt).toBe('2026-10-25T05:04:00Z');
});

it.each(['RUNNING', 'COMMITTING'])('distinguishes same-version readable work from %s execution closure', status => {
  const read = programRead();
  read.selectedExecution!.status = status;
  read.overallStatus = 'CURRENT';
  read.overallBasedOnWorkRevisionRef = read.current!.workRevisionRef;
  expect(research(read).summary).toContain('成果已可读，执行仍在收尾');
});

it('does not attribute an earlier saved work to this new response', () => {
  const read = programRead();
  read.selectedExecution!.attemptId = 'new-program-attempt';
  read.selectedExecution!.programProgress = {
    phase: 'MODEL_RESPONSE_SAVED', checkpointRef: 'program-response', observedAt: '2026-10-25T05:02:00Z',
  };
  expect(research(read).summary).toContain('已生成，尚未保存');
  expect(research(read).summary).not.toContain('工作已保存，综合待更新');
  expect(research(read).outputs[0].ref).toBe(read.current!.workRevisionRef);
});

it('keeps UNKNOWN pending original-result reconciliation and rejects an unrelated stop observation', () => {
  const read = programRead();
  read.activity = {
    attemptRef: 'AQ-program', candidateOnly: true, sourceReads: [], savedRevisions: [],
    consumerStopped: { sequence: 1, observedAt: '2026-10-25T05:03:00Z', modelRound: 1,
      errorCode: 'GATEWAY_UNKNOWN', upstreamOutcome: 'UNKNOWN' },
    omittedEarlierRecordCount: 0, unknownRecordCount: 0, malformedRecordCount: 0,
    hasEarlierSavedRevisions: false, error: null,
  };
  expect(research(read).summary).toContain('原请求结果待核');
  expect(research(read).summary).not.toContain('正在核对');
  expect(read.selectedExecution!.status).toBe('RUNNING');
  read.activity.attemptRef = 'AQ-another';
  expect(research(read).summary).not.toContain('原请求结果待核');
  read.activity.attemptRef = 'AQ-program';
  read.selectedExecution!.status = 'SUCCEEDED';
  expect(research(read).summary).not.toContain('原请求结果待核');
});

it('does not infer an execution mode or current model progress for legacy observations', () => {
  const read = programRead();
  delete read.selectedExecution!.executionMode;
  expect(research(read).summary).not.toContain('未启用自主调查');
  expect(research(read).requests[0].executionMode).toBeUndefined();
});

it('does not display analysis as running after a terminal attempt', () => {
  const read = programRead();
  read.current = null;
  read.selectedExecution!.status = 'TIMED_OUT';
  read.selectedExecution!.programProgress = {
    phase: 'MATERIALS_READY', checkpointRef: 'program-input', observedAt: '2026-10-25T05:02:00Z',
  };
  expect(research(read).summary).not.toContain('正在综合分析');
  expect(research(read).summary).not.toContain('正在准备');
});
