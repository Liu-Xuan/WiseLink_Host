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
  const audit = data.workbenchAudit;
  const timeline = data.timeline;
  const unresolvedCount: number = integrated?.baseRules.unresolvedCount ?? 0;
  const candidateState: string = overall?.status ?? 'WAITING_CANDIDATE';
  const steps: ContextStep[] = [
    {
      label: '文件版本已绑定',
      done: Boolean(data.workItem.source.documentVersionId),
    },
    { label: '结构化原文', done: Boolean(data.workItem.package) },
    { label: '动态评估', done: Boolean(integrated?.baseRules) },
    {
      label: '整体候选',
      done: overall?.status === 'CANDIDATE_ONLY',
    },
    { label: 'AEO 候选（并行）', done: Boolean(data.workItem.aeo) },
  ];

  return (
    <aside className="workitem-context-dock" aria-label="当前工程事项摘要">
      <header>
        <div>
          <span>工程事项进度</span>
          <strong>{phaseLabel(data.workItem.phase)}</strong>
        </div>
        <small>当前版本 r{data.workItem.revision}</small>
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

      <details>
        <summary>运行与版本详情</summary>
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
          <div>
            <dt>审计步骤</dt>
            <dd>{audit.candidateFormationSteps.length}</dd>
          </div>
          <div>
            <dt>时间线事件</dt>
            <dd>{timeline.events.length}</dd>
          </div>
        </dl>
      </details>

      <Button
        type="button"
        variant="outline"
        disabled={refreshing}
        onClick={onRefresh}
        data-ai-section-type="button"
      >
        <RefreshCw aria-hidden="true" />
        {refreshing ? '正在读取最新结果…' : '刷新当前工程事项'}
      </Button>
      <Link
        to={`/external-discovery?workItemId=${encodeURIComponent(
          data.workItem.workItemId,
        )}`}
      >
        查看外部资料候选 <ArrowUpRight aria-hidden="true" />
      </Link>
      <p>此处仅展示当前事项的版本、权限、候选意见和人工确认边界。</p>
    </aside>
  );
}

function short(value: string): string {
  return value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-7)}` : value;
}

function phaseLabel(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes('BLOCK')) return '需要处理阻断';
  if (normalized.includes('RUN') || normalized.includes('PROCESS')) {
    return '分析进行中';
  }
  if (normalized.includes('WAIT') || normalized.includes('PENDING')) {
    return '等待必要输入';
  }
  if (normalized.includes('REVIEW')) return '等待工程师复核';
  if (normalized.includes('COMPLETE') || normalized.includes('CURRENT')) {
    return '当前结果可复核';
  }
  return '工程评估处理中';
}
