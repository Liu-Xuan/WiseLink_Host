import { ArrowUpRight, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@client/src/components/ui/button';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

interface WorkItemContextDockProps {
  data: CanonicalDocumentParsingPageResponse;
  refreshing: boolean;
  onRefresh: () => void;
}

interface ContextStep {
  label: string;
  done: boolean;
}

export function WorkItemContextDock({
  data,
  refreshing,
  onRefresh,
}: WorkItemContextDockProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const unresolvedCount: number = integrated?.baseRules.unresolvedCount ?? 0;
  const candidateState: string = overall?.status ?? 'WAITING_CANDIDATE';
  const steps: ContextStep[] = [
    {
      label: 'DocumentVersion',
      done: Boolean(data.workItem.source.documentVersionId),
    },
    { label: 'frozen.2 + Reader', done: Boolean(data.workItem.package) },
    { label: 'OpenClaw 动态 N', done: Boolean(integrated?.baseRules) },
    {
      label: '整体候选',
      done: overall?.status === 'CANDIDATE_ONLY',
    },
    { label: 'AEO 候选', done: Boolean(data.workItem.aeo) },
  ];

  return (
    <aside className="workitem-context-dock" aria-label="当前工程事项摘要">
      <header>
        <div>
          <span>WORK ITEM INSPECTOR</span>
          <strong>{data.workItem.phase}</strong>
        </div>
        <small>revision {data.workItem.revision}</small>
      </header>

      <section className="workitem-context-steps" aria-label="事项阶段">
        {steps.map((step: ContextStep, index: number) => (
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
          <dd title={data.readAuthorization.permissionSnapshotVersion}>
            {short(data.readAuthorization.permissionSnapshotVersion)}
          </dd>
        </div>
        <div>
          <dt>候选状态</dt>
          <dd>{candidateState}</dd>
        </div>
        <div>
          <dt>缺口 / 未闭合</dt>
          <dd>{unresolvedCount}</dd>
        </div>
        <div>
          <dt>页面状态</dt>
          <dd>{data.status}</dd>
        </div>
      </dl>

      <Button
        type="button"
        variant="outline"
        disabled={refreshing}
        onClick={onRefresh}
        data-ai-section-type="button"
      >
        <RefreshCw aria-hidden="true" />
        {refreshing ? '正在 fresh-read…' : '刷新当前 WorkItem'}
      </Button>
      <Link
        to={`/external-discovery?workItemId=${encodeURIComponent(
          data.workItem.workItemId,
        )}`}
      >
        查看外部资料候选 <ArrowUpRight aria-hidden="true" />
      </Link>
      <p>
        检查器只呈现 Host 的 revision、权限、候选和人工边界；不承接旧应用状态。
      </p>
    </aside>
  );
}

function short(value: string): string {
  return value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-7)}` : value;
}
