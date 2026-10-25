import {
  isJobAidProblemProjection,
  type JobAidWorkingReadModel,
} from '@shared/jobaid-problem-assessment.interface';
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
  working?: JobAidWorkingReadModel | null;
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
  working,
}: EngineeringReasoningTrailProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const dynamic =
    working !== undefined && working?.enabled !== false
      ? null
      : (integrated?.baseRules ?? null);
  const overall = integrated?.overallSynthesis ?? null;
  const timeline = data.timeline;
  const sourceRefCount: number | null =
    data.workItem.package?.sourceRefCount ?? null;
  const originalReady: boolean =
    data.initialAnalysis != null && data.initialAnalysis.status !== 'NOT_READY';
  const current = working?.current ?? null;
  const overallNeedsUpdate: boolean =
    !!current &&
    (!overall ||
      overall.status !== 'CANDIDATE_ONLY' ||
      overall.staleReason !== null ||
      overall.basedOnJobAidWorkRevisionRef !== current.workRevisionRef ||
      working?.overallStatus !== 'CURRENT' ||
      working.overallBasedOnWorkRevisionRef !== current.workRevisionRef);
  const unresolvedCount: number | null = current
    ? current.content.issues.reduce(
        (count, issue) => count + issue.openQuestions.length,
        0,
      )
    : isJobAidProblemProjection(dynamic)
      ? dynamic.openQuestionCount
      : (dynamic?.unresolvedCount ?? null);
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
      status: data.workItem.package
        ? '结构化原文可查看'
        : originalReady
          ? '已发布原文可查看'
          : '等待解析结果',
      detail: data.workItem.package
        ? `${data.workItem.package.contentUnitCount} 个内容单元 · ${data.workItem.package.sourceRefCount} 条来源目录定位；实际读取另见本轮记录`
        : originalReady
          ? '已发布原文可用于后续评估；实际读取另见本轮记录'
          : '尚无可读的结构化解析结果',
      state: data.workItem.package || originalReady ? 'done' : 'pending',
      icon: BookOpenCheck,
    },
    {
      label:
        current || isJobAidProblemProjection(dynamic)
          ? '形成问题评估'
          : '执行当前规则集',
      status: current
        ? `已保存工作第 ${current.workRevision} 版`
        : (humanState(dynamic?.status) ?? '尚无已保存评估'),
      detail: current
        ? `${current.content.issues.length} 个问题 · ${unresolvedCount} 项待确认；工作可立即阅读`
        : dynamic
          ? isJobAidProblemProjection(dynamic)
            ? `${dynamic.issueCount} 个问题 · ${dynamic.openQuestionCount} 项待确认`
            : `${dynamic.evaluationItemCount}/${dynamic.criterionCount} 项 · ${dynamic.unresolvedCount} 项未闭合`
          : '问题数量与待确认范围尚未知',
      state: current || dynamic ? 'candidate' : 'pending',
      icon: SearchCheck,
    },
    {
      label: '比较证据、冲突与缺口',
      status: overallNeedsUpdate
        ? '工作已保存，综合待更新'
        : (humanState(overall?.status) ??
          (current ? '工作已保存，综合待更新' : '尚无已保存综合')),
      detail:
        overall && overallNeedsUpdate
          ? '此前综合另行保留；尚未确认与当前保存工作版本一致。'
          : overall
            ? `${overall.findingCount} 项判断 · ${overall.gap ? '仍有待补信息' : '当前无明确缺口'} · ${humanState(overall.discoveryStatus) ?? '资料状态待确认'}`
            : current
              ? '已保存的判断和问题分析可直接阅读，无需等待综合更新'
              : '尚无可核对的综合结果',
      state: overall ? 'candidate' : 'pending',
      icon: GitCompareArrows,
    },
    {
      label: '工程师复核与下游编写',
      status:
        humanState(
          integrated?.overallForAeoConfirmation?.status ??
            (data.workItem.aeo ? data.workItem.aeo.status : undefined),
        ) ?? '尚无人工确认记录',
      detail: data.workItem.aeo
        ? `${data.workItem.aeo.artifacts.length} 个 AEO 候选产物；无自动批准`
        : overall
          ? '整体候选须显式确认后才可进入 AEO 候选'
          : '当前尚未形成可确认的整体候选',
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
      aria-label="可解释工程分析记录"
    >
      <header>
        <div>
          <span>评估过程</span>
          <h2>可用材料与已保存评估</h2>
        </div>
        <div className="engineering-reasoning-header-meta">
          <p>
            只展示可核验的执行记录和证据链，不把模型不可审计的隐式思维草稿当作依据。
          </p>
          <div
            className="engineering-reasoning-summary"
            aria-label="材料与评估摘要"
          >
            <span>
              <strong>{data.queryResults.length}</strong> 项当前查询结果
            </span>
            {sourceRefCount === null ? (
              <span>
                {originalReady
                  ? '已发布原文可查看，实际读取另见本轮记录'
                  : '尚无可计数的来源目录'}
              </span>
            ) : (
              <span>
                <strong>{sourceRefCount}</strong> 条来源目录定位
              </span>
            )}
            {unresolvedCount === null ? (
              <span>待确认数量未知，尚无已保存评估</span>
            ) : (
              <span>
                <strong>{unresolvedCount}</strong> 项待确认
              </span>
            )}
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
