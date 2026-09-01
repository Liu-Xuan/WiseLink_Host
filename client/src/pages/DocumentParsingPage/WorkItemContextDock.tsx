import {
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@client/src/components/ui/button';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { humanState } from '@client/src/features/navigation/treeMappers';

interface WorkItemContextDockProps {
  data: CanonicalDocumentParsingPageResponse;
  refreshing: boolean;
  onRefresh: () => void;
}

interface ContextStep {
  label: string;
  state: 'done' | 'candidate' | 'pending';
}

export function WorkItemContextDock({
  data,
  refreshing,
  onRefresh,
}: WorkItemContextDockProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const unresolvedCount: number = integrated?.baseRules.unresolvedCount ?? 0;
  const steps: ContextStep[] = [
    {
      label: '文件版本已绑定',
      state: data.workItem.source.documentVersionId ? 'done' : 'pending',
    },
    {
      label: '结构化原文',
      state: data.workItem.package ? 'done' : 'pending',
    },
    {
      label: '动态评估候选',
      state: integrated?.baseRules ? 'candidate' : 'pending',
    },
    {
      label: '整体候选待复核',
      state: overall ? 'candidate' : 'pending',
    },
    {
      label: '后续编写候选',
      state: data.workItem.aeo ? 'candidate' : 'pending',
    },
  ];

  return (
    <aside className="workitem-context-dock" aria-label="当前工程评估摘要">
      <header>
        <div>
          <span>工程评估进度</span>
          <strong>{phaseLabel(data.workItem.phase)}</strong>
        </div>
        <small>当前受控事项</small>
      </header>

      <section className="workitem-context-steps" aria-label="事项阶段">
        {steps.map((step: ContextStep, index: number) => (
          <div className={`is-${step.state}`} key={step.label}>
            {step.state === 'done' ? (
              <CheckCircle2 aria-hidden="true" />
            ) : step.state === 'candidate' ? (
              <CircleDashed aria-hidden="true" />
            ) : (
              <Circle aria-hidden="true" />
            )}
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </section>

      <details>
        <summary>当前事项摘要</summary>
        <dl>
          <div>
            <dt>资料访问</dt>
            <dd>已按当前账户权限读取</dd>
          </div>
          <div>
            <dt>综合意见</dt>
            <dd>{humanState(overall?.status) ?? '尚未形成'}</dd>
          </div>
          <div>
            <dt>待补信息</dt>
            <dd>{unresolvedCount} 项未闭合</dd>
          </div>
          <div>
            <dt>人工确认</dt>
            <dd>
              {integrated?.overallForAeoConfirmation
                ? '已记录，不等于正式批准'
                : '等待工程师复核'}
            </dd>
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
        {refreshing ? '正在读取最新结果…' : '刷新当前工程评估'}
      </Button>
      <Link
        to={`/external-discovery?workItemId=${encodeURIComponent(
          data.workItem.workItemId,
        )}`}
      >
        查看外部资料候选 <ArrowUpRight aria-hidden="true" />
      </Link>
      <p>此处只展示当前资料、候选意见与人工复核边界。</p>
    </aside>
  );
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
