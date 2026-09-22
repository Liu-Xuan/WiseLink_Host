import { useEffect, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { useWorkbenchPanelActive } from '@client/src/features/workbench/RetainedWorkbenchPanel';
import type { MatterAssessmentActivityItem } from '@shared/matter-assessment-activity.interface';
import { useMatterAssessmentActivity } from './useMatterAssessmentActivity';

const labels = {
  REGISTERED_SOURCES_READ: '已读取登记来源',
  SOURCE_PAGES_READ: '已读取原件页',
  ORIGINAL_BOUND: '已绑定原文版本',
  ORIGINAL_READ: '已读取原文片段',
  WORK_SAVED: '已保存候选工作',
  CORRECTION_STARTED: '已开始更正',
  CORRECTION_GENERATED: '已生成更正候选',
  CORRECTION_UNCHANGED: '更正核对后未改变工作',
};
const statuses: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '执行中',
  RETRY_SCHEDULED: '等待重试',
  COMMITTING: '保存中',
  SUCCEEDED: '执行完成',
  FAILED: '执行失败',
  TIMED_OUT: '执行超时',
  CANCELLED: '已取消',
  WAITING_INPUT: '等待补充信息',
  CONFLICT: '版本冲突',
  OBSOLETE: '已过期',
};

export default function MatterAssessmentActivity(props: {
  matterId: string;
  workRef: string;
  session: number;
  denied: boolean;
}) {
  const panelActive = useWorkbenchPanelActive();
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  if (!visible || !panelActive || props.denied) return null;
  return (
    <ActivityRead
      key={JSON.stringify([props.matterId, props.workRef, props.session])}
      {...props}
    />
  );
}

function ActivityRead({
  matterId,
  workRef,
  session,
}: {
  matterId: string;
  workRef: string;
  session: number;
}) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const { page, error, loading, refresh } = useMatterAssessmentActivity(
    matterId,
    session,
    { ...(workRef ? { workRef } : {}), cursor: cursors[cursors.length - 1] },
  );
  return (
    <section aria-label="已记录的评估活动" aria-busy={loading}>
      <h2>已记录的评估活动</h2>
      <p>
        {workRef
          ? '指定保存工作所关联执行轮的记录；不是保存时刻的状态快照。'
          : '当前活跃执行轮；没有活跃执行时显示最近一轮。'}
      </p>
      <p>读取与保存记录用于核查过程，不代表工程结论已正式采用。</p>
      {error ? <p role="alert">{error} 自动刷新已停止。</p> : null}
      {page?.attempt ? (
        <p>
          {statuses[page.attempt.status] ?? '执行状态待确认'} · 工作基线{' '}
          {page.attempt.baseWorkingRevision} · 输入 {page.attempt.inputCount} 项
        </p>
      ) : null}
      {page?.error ? (
        <p role="alert">
          部分活动记录不可读，已停止自动刷新；已保存正文独立保留。
        </p>
      ) : null}
      {!page && loading ? <p role="status">正在读取活动记录…</p> : null}
      {page && !page.items.length ? (
        <p>
          {page.attempt ? '本页没有可展示的活动记录。' : '没有关联的执行记录。'}
        </p>
      ) : null}
      <ol className="space-y-3">
        {page?.items.map((item) => (
          <li key={`${page.attempt?.attemptRef}:${item.sequence}`}>
            <strong>
              {item.sequence}. {labels[item.kind]}
            </strong>
            <p className="break-words">{details(item)}</p>
            <small>
              {item.occurredAt
                ? new Date(item.occurredAt).toLocaleString('zh-CN')
                : '记录未提供发生时间'}
            </small>
          </li>
        ))}
      </ol>
      {page &&
      (page.omittedEarlierCount > 0 ||
        page.unknownOmittedCount > 0 ||
        page.malformedCount > 0 ||
        page.duplicateOmittedCount > 0) ? (
        <p>
          本页前有 {page.omittedEarlierCount} 条记录；本页未展示未知类型{' '}
          {page.unknownOmittedCount} 条、损坏 {page.malformedCount}{' '}
          条、重复保存回执 {page.duplicateOmittedCount} 条。
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          刷新当前页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || cursors.length === 1}
          onClick={() => setCursors((value) => value.slice(0, -1))}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !page?.nextCursor}
          onClick={() => {
            if (page?.nextCursor)
              setCursors((value) => [...value, page.nextCursor!]);
          }}
        >
          下一页
        </Button>
        {cursors.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => setCursors([undefined])}
          >
            返回首屏记录
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function details(item: MatterAssessmentActivityItem): string {
  if (item.kind === 'SOURCE_PAGES_READ')
    return `文档版本 ${item.documentVersionId} · 原件第 ${item.pageStart}–${item.pageEnd} 页`;
  if (item.kind === 'ORIGINAL_READ')
    return `文档版本 ${item.documentVersionId} · 原文片段 ${Number(item.unitOffset) + 1} 起，共 ${item.unitCount} 项`;
  if (item.kind === 'REGISTERED_SOURCES_READ')
    return `来源 ${item.sourceCount} 项`;
  if (item.kind === 'WORK_SAVED' || item.kind === 'CORRECTION_UNCHANGED')
    return `工作引用：${item.workRef}`;
  if (item.kind === 'ORIGINAL_BOUND')
    return `文档版本 ${item.documentVersionId} · 解析版本 ${item.parseRunId}`;
  return '已持久化的执行回执';
}
