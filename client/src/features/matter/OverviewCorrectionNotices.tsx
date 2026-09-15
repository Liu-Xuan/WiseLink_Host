import { Link } from 'react-router-dom';
import type { EngineeringMatterOverviewCorrectionNotice } from '@shared/matter-working.interface';
import { matterWorkRoute } from './matter-navigation';

const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  QUEUED: '已排队',
  RUNNING: '处理中',
  RETRY_SCHEDULED: '等待重试',
  COMMITTING: '正在保存',
  SUCCEEDED: '已完成',
  WAITING_INPUT: '等待补充输入',
  FAILED: '未完成',
  TIMED_OUT: '已超时',
  CANCELLED: '已取消',
  CONFLICT: '发生版本冲突',
  OBSOLETE: '已失效',
};

function outcomeText(
  notice: EngineeringMatterOverviewCorrectionNotice,
): string {
  const status: string =
    ATTEMPT_STATUS_LABELS[notice.attemptStatus] ??
    `待核实（${notice.attemptStatus}）`;
  const saved: string = notice.savedWorkRef
    ? '已保存后续工作；保存不等于错误已消除或已正式采用。'
    : '尚未读到保存后的后续工作；原工作仍可阅读。';
  return `请求状态：${status}。${saved}`;
}

export default function OverviewCorrectionNotices({
  matterId,
  notices,
  className = '',
}: {
  matterId: string;
  notices?: EngineeringMatterOverviewCorrectionNotice[];
  className?: string;
}) {
  if (!notices?.length) return null;
  return (
    <div
      role="note"
      className={`space-y-2 text-sm leading-7 ${className}`.trim()}
    >
      <p className="font-medium">综合核对请求记录</p>
      {notices.map((notice) => (
        <p key={notice.attemptRef}>
          已登记针对原工作的综合核对请求：{notice.reason}{' '}
          {outcomeText(notice)}
          <Link
            className="ml-2 underline"
            to={matterWorkRoute(matterId, notice.targetWorkRef)}
          >
            阅读原工作
          </Link>
          {notice.savedWorkRef ? (
            <Link
              className="ml-2 underline"
              to={matterWorkRoute(matterId, notice.savedWorkRef)}
            >
              阅读已保存后续工作
            </Link>
          ) : null}
        </p>
      ))}
    </div>
  );
}
