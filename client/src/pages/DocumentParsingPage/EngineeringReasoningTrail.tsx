import {
  BookOpenCheck,
  CheckCircle2,
  CircleDashed,
  FileSearch2,
  GitCompareArrows,
  SearchCheck,
  UserCheck,
} from 'lucide-react';

import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';

interface EngineeringReasoningTrailProps {
  data: CanonicalDocumentParsingPageResponse;
}

interface TrailStep {
  label: string;
  status: string;
  detail: string;
  evidence: string;
  done: boolean;
  icon: typeof FileSearch2;
}

export function EngineeringReasoningTrail({
  data,
}: EngineeringReasoningTrailProps) {
  const integrated = data.workItem.integratedAssessment ?? null;
  const dynamic = integrated?.baseRules ?? null;
  const overall = integrated?.overallSynthesis ?? null;
  const steps: TrailStep[] = [
    {
      label: '锁定工程对象',
      status: 'DOCUMENT_VERSION_BOUND',
      detail: `${data.workItem.classification.normalizedFamily} · ${data.workItem.source.sourceByteLength.toLocaleString()} bytes`,
      evidence: data.workItem.source.documentVersionId,
      done: true,
      icon: FileSearch2,
    },
    {
      label: '验证并建立来源定位',
      status: data.workItem.package
        ? 'FROZEN_2_READER_READY'
        : 'WAITING_PACKAGE',
      detail: data.workItem.package
        ? `${data.workItem.package.contentUnitCount} units · ${data.workItem.package.sourceRefCount} sourceRefs`
        : '尚无可读 parsed package',
      evidence: data.workItem.package?.artifact.sha256 ?? 'NO_PACKAGE_ARTIFACT',
      done: Boolean(data.workItem.package),
      icon: BookOpenCheck,
    },
    {
      label: '执行当前规则集',
      status: dynamic?.status ?? 'WAITING_OPENCLAW_DYNAMIC_EVALUATION',
      detail: dynamic
        ? `${dynamic.evaluationItemCount}/${dynamic.criterionCount} 项 · ${dynamic.unresolvedCount} unresolved`
        : 'N 由当前规则集决定；不固定为 150',
      evidence: dynamic?.artifact.sha256 ?? 'NO_DYNAMIC_ARTIFACT',
      done: Boolean(dynamic),
      icon: SearchCheck,
    },
    {
      label: '比较证据、冲突与缺口',
      status: overall?.status ?? 'WAITING_OVERALL_CANDIDATE',
      detail: overall
        ? `${overall.findingCount} findings · gap ${overall.gap ?? 'NONE'} · discovery ${overall.discoveryStatus}`
        : '只有明确缺口才调用相关资料源 Skill',
      evidence: overall?.artifact.sha256 ?? 'NO_OVERALL_ARTIFACT',
      done: overall?.status === 'CANDIDATE_ONLY',
      icon: GitCompareArrows,
    },
    {
      label: '工程师复核与下游编写',
      status:
        integrated?.overallForAeoConfirmation?.status ??
        (data.workItem.aeo ? data.workItem.aeo.status : 'WAITING_HUMAN_REVIEW'),
      detail: data.workItem.aeo
        ? `${data.workItem.aeo.artifacts.length} 个 AEO 候选产物；无自动批准`
        : '整体候选须显式确认后才可进入 AEO 候选',
      evidence:
        integrated?.overallForAeoConfirmation?.actionAttemptId ??
        data.workItem.aeo?.actionAttemptId ??
        'NO_HUMAN_ACTION',
      done: Boolean(integrated?.overallForAeoConfirmation || data.workItem.aeo),
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
          <span>HOW THE CANDIDATE WAS FORMED</span>
          <h2>方法、依据、缺口与人工动作</h2>
        </div>
        <p>
          展示可核验的执行记录和证据链，不把模型不可审计的隐式思维草稿当作依据。
        </p>
      </header>
      <div className="engineering-reasoning-steps">
        {steps.map((step, index) => (
          <article className={step.done ? 'is-done' : ''} key={step.label}>
            <div className="engineering-reasoning-step-index">
              {step.done ? (
                <CheckCircle2 aria-hidden="true" />
              ) : (
                <CircleDashed aria-hidden="true" />
              )}
              <span>{String(index + 1).padStart(2, '0')}</span>
            </div>
            <step.icon aria-hidden="true" />
            <h3>{step.label}</h3>
            <strong>{step.status}</strong>
            <p>{step.detail}</p>
            <small title={step.evidence}>{short(step.evidence)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function short(value: string): string {
  return value.length > 36
    ? `${value.slice(0, 22)}…${value.slice(-10)}`
    : value;
}
