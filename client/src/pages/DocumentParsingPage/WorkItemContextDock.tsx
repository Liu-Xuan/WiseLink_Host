import { ArrowUpRight, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

interface WorkItemContextDockProps {
  data: CanonicalDocumentParsingPageResponse;
  refreshing: boolean;
  onRefresh: () => void;
}

export function WorkItemContextDock({
  data,
  refreshing,
  onRefresh,
}: WorkItemContextDockProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const steps = [
    {
      label: 'DocumentVersion',
      done: Boolean(data.workItem.source.documentVersionId),
    },
    { label: 'frozen.2 + Reader', done: Boolean(data.workItem.package) },
    { label: 'OpenClaw 动态 N', done: Boolean(integrated?.baseRules) },
    {
      label: '整体候选',
      done: integrated?.overallSynthesis?.status === 'CANDIDATE_ONLY',
    },
    { label: 'AEO 候选', done: Boolean(data.workItem.aeo) },
  ];

  return (
    <aside className="workitem-context-dock" aria-label="当前工程事项摘要">
      <header>
        <span>当前工程事项</span>
        <strong>{data.workItem.phase}</strong>
        <small>WorkItem revision {data.workItem.revision}</small>
      </header>

      <section className="workitem-context-steps">
        {steps.map((step, index) => (
          <div className={step.done ? 'is-done' : ''} key={step.label}>
            {step.done ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <Circle aria-hidden="true" />
            )}
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </section>

      <dl>
        <div>
          <dt>读取授权</dt>
          <dd>{data.readAuthorization.action}</dd>
        </div>
        <div>
          <dt>权限快照</dt>
          <dd>{short(data.readAuthorization.permissionSnapshotVersion)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{data.status}</dd>
        </div>
      </dl>

      <button type="button" disabled={refreshing} onClick={onRefresh}>
        <RefreshCw aria-hidden="true" />
        {refreshing ? '正在 fresh-read…' : '刷新当前 WorkItem'}
      </button>
      <Link to="/external-discovery">
        查看外部资料候选 <ArrowUpRight aria-hidden="true" />
      </Link>
      <p>
        页面吸收了历史工作台的目录、阅读与任务摘要布局；所有状态仍来自唯一妙搭
        WorkItem，不承接旧应用状态。
      </p>
    </aside>
  );
}

function short(value: string): string {
  return value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-7)}` : value;
}
