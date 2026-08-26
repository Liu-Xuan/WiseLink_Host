import {
  BookOpenCheck,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileSearch2,
  GitCompareArrows,
  SearchCheck,
  UserCheck,
} from 'lucide-react';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { humanState } from '@client/src/features/navigation/treeMappers';

interface EngineeringReasoningTrailProps {
  data: CanonicalDocumentParsingPageResponse;
}

interface TrailStep {
  label: string;
  status: string;
  detail: string;
  state: 'done' | 'candidate' | 'pending';
  icon: typeof FileSearch2;
}

export function EngineeringReasoningTrail({
  data,
}: EngineeringReasoningTrailProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const dynamic = integrated?.baseRules ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const timeline = data.timeline;
  const sourceRefCount: number = data.workItem.package?.sourceRefCount ?? 0;
  const unresolvedCount: number = dynamic?.unresolvedCount ?? 0;
  const latestTimelineEvent =
    timeline.events[timeline.events.length - 1] ?? null;
  const steps: TrailStep[] = [
    {
      label: '锁定工程对象',
      status: '当前文件版本已绑定',
      detail: `${data.workItem.classification.normalizedFamily} · 当前受控文件`,
      state: 'done',
      icon: FileSearch2,
    },
    {
      label: '验证并建立来源定位',
      status: data.workItem.package ? '结构化原文可查看' : '等待解析结果',
      detail: data.workItem.package
        ? `${data.workItem.package.contentUnitCount} 个内容单元 · ${data.workItem.package.sourceRefCount} 条来源依据`
        : '尚无可读的结构化解析结果',
      state: data.workItem.package ? 'done' : 'pending',
      icon: BookOpenCheck,
    },
    {
      label: '执行当前规则集',
      status: humanState(dynamic?.status) ?? '等待逐项评估',
      detail: dynamic
        ? `${dynamic.evaluationItemCount}/${dynamic.criterionCount} 项 · ${dynamic.unresolvedCount} 项未闭合`
        : '当前尚未形成逐项评估结果',
      state: dynamic ? 'candidate' : 'pending',
      icon: SearchCheck,
    },
    {
      label: '比较证据、冲突与缺口',
      status: humanState(overall?.status) ?? '等待综合候选',
      detail: overall
        ? `${overall.findingCount} 项判断 · ${overall.gap ? '仍有待补信息' : '当前无明确缺口'} · ${humanState(overall.discoveryStatus) ?? '资料状态待确认'}`
        : '只有明确缺口时才查询相关资料来源',
      state: overall ? 'candidate' : 'pending',
      icon: GitCompareArrows,
    },
    {
      label: '工程师复核与下游编写',
      status:
        humanState(
          integrated?.overallForAeoConfirmation?.status ??
            (data.workItem.aeo ? data.workItem.aeo.status : undefined),
        ) ?? '等待工程师复核',
      detail: data.workItem.aeo
        ? `${data.workItem.aeo.artifacts.length} 个 AEO 候选产物；无自动批准`
        : '整体候选须显式确认后才可进入 AEO 候选',
      // 确认或编写后仍是候选，不使用“完成”视觉。
      state:
        integrated?.overallForAeoConfirmation || data.workItem.aeo
          ? 'candidate'
          : 'pending',
      icon: UserCheck,
    },
  ];

  return (
    <section
      className="engineering-reasoning-trail"
      id="workspace-reasoning"
      aria-label="可解释工程分析记录"
    >
      <header>
        <div>
          <span>候选形成过程</span>
          <h2>系统查阅了什么，以及候选如何形成</h2>
        </div>
        <div className="engineering-reasoning-header-meta">
          <p>
            只展示可核验的执行记录和证据链，不把模型不可审计的隐式思维草稿当作依据。
          </p>
          <div className="engineering-reasoning-summary" aria-label="查阅摘要">
            <span>
              <strong>{data.queryResults.length}</strong> 项当前查询结果
            </span>
            <span>
              <strong>{sourceRefCount}</strong> 条来源依据
            </span>
            <span>
              <strong>{unresolvedCount}</strong> 项未闭合
            </span>
          </div>
        </div>
      </header>
      <div className="engineering-reasoning-steps">
        {steps.map((step, index) => (
          <article className={`is-${step.state}`} key={step.label}>
            <div className="engineering-reasoning-step-index">
              {step.state === 'done' ? (
                <CheckCircle2 aria-hidden="true" />
              ) : step.state === 'candidate' ? (
                <CircleDashed aria-hidden="true" />
              ) : (
                <Circle aria-hidden="true" />
              )}
              <span>{String(index + 1).padStart(2, '0')}</span>
            </div>
            <step.icon aria-hidden="true" />
            <h3>{step.label}</h3>
            <strong>{step.status}</strong>
            <p>{step.detail}</p>
          </article>
        ))}
      </div>
      <div
        className="engineering-reasoning-summary"
        aria-label="时间线与投影摘要"
      >
        {latestTimelineEvent ? (
          <span>
            <strong>最近状态</strong>{' '}
            {humanState(latestTimelineEvent.status) ?? '状态待确认'}
          </span>
        ) : null}
      </div>
    </section>
  );
}
