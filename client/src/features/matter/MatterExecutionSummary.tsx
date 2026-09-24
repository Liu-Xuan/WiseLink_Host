import { useQuery } from '@tanstack/react-query';
import { getMatterExecutionSummary } from '@client/src/api/engineering-matter';
import type { MatterExecutionSummary as Summary } from '@shared/matter-execution-summary.interface';
import {
  ENGINEERING_MATTER_QUERY_ROOT,
  useEngineeringMatterQueryIdentity,
} from './useEngineeringMatter';

const labels: Record<Summary['state'], string> = {
  IDLE: '当前没有关联的自动执行轮',
  QUEUED: '等待执行',
  RUNNING: '执行中',
  RETRY_SCHEDULED: '等待重试',
  COMMITTING: '保存中',
  SUCCEEDED: '本轮执行完成',
  FAILED: '本轮执行失败',
  TIMED_OUT: '本轮执行超时',
  CANCELLED: '本轮已取消',
  WAITING_INPUT: '等待输入',
  CONFLICT: '本轮版本冲突',
  OBSOLETE: '本轮已过期',
};

const active = new Set<Summary['state']>([
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
]);

export default function MatterExecutionSummary({
  matterId,
  matterRevisionId,
  workingRevision,
  sessionGeneration,
}: {
  matterId: string;
  matterRevisionId: string;
  workingRevision: number;
  sessionGeneration: number;
}) {
  const { identity } = useEngineeringMatterQueryIdentity(
    true,
    sessionGeneration,
  );
  const query = useQuery({
    queryKey: [
      ...ENGINEERING_MATTER_QUERY_ROOT,
      'execution-summary',
      identity?.appId,
      identity?.tenantId,
      identity?.actorId,
      sessionGeneration,
      matterId,
      matterRevisionId,
      workingRevision,
    ],
    queryFn: ({ signal }) => getMatterExecutionSummary(matterId, signal),
    enabled: Boolean(identity),
    staleTime: 5_000,
    retry: false,
    refetchInterval: (current) =>
      current.state.data &&
      active.has(current.state.data.state) &&
      (typeof document === 'undefined' || !document.hidden)
        ? 5_000
        : false,
  });
  const summary = query.data;
  const matches =
    summary?.matterRevisionId === matterRevisionId &&
    summary.workingRevision === workingRevision;
  return (
    <section
      aria-label="事项自动执行摘要"
      className="space-y-2 border-b border-border pb-4 text-sm leading-6"
    >
      <h2 className="text-base font-semibold">自动执行摘要</h2>
      {query.error ? (
        <p role="alert">执行状态读取失败，请重新读取事项。</p>
      ) : null}
      {!query.error && (!summary || !matches) ? (
        <p role="status">
          {summary && !matches
            ? '事项版本已变化，请重新读取。'
            : '正在读取执行状态…'}
        </p>
      ) : null}
      {summary && matches && !query.error ? (
        <>
          <p>
            <strong>{labels[summary.state]}</strong> · 工作修订{' '}
            {summary.workingRevision}
          </p>
          <p>
            当前输入：工作项 {summary.inputs.workItems} 项，独立文档{' '}
            {summary.inputs.documents} 项；待核查 {summary.inputs.pending} 项。
          </p>
          {summary.attemptRef ? (
            <>
              <p>本轮：{summary.attemptRef}</p>
              <p>
                读取工具：登记来源
                {summary.tools.registeredSourcesRead
                  ? '已完成'
                  : '未见完成回执'}
                ；原件页
                {summary.tools.sourcePagesRead ? '已完成' : '未见完成回执'}
                ；原文{summary.tools.originalRead ? '已完成' : '未见完成回执'}。
              </p>
              <p>
                候选保存：
                {summary.tools.candidateSaved ? '已有保存回执' : '未见保存回执'}
                ；
                {summary.currentWorkSavedByAttempt
                  ? '当前工作来自本轮保存'
                  : '当前工作未关联本轮保存'}
                。
              </p>
              <p className="text-muted-foreground">
                {summary.startedAt
                  ? `开始 ${new Date(summary.startedAt).toLocaleString('zh-CN')} · `
                  : ''}
                {summary.completedAt
                  ? `结束 ${new Date(summary.completedAt).toLocaleString('zh-CN')} · `
                  : ''}
                {summary.updatedAt
                  ? `状态更新 ${new Date(summary.updatedAt).toLocaleString('zh-CN')} · `
                  : ''}
                核对于 {new Date(summary.observedAt).toLocaleString('zh-CN')}
                {query.isFetching ? '（正在更新）' : ''}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              待核查输入只说明来源状态，不表示任务已启动。
            </p>
          )}
          <p className="text-muted-foreground">
            此处显示候选执行记录；工程结论仍需正式审查与采用。
          </p>
        </>
      ) : null}
    </section>
  );
}
