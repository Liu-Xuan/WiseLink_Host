import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import {
  AlertTriangle,
  Database,
  MessageSquareText,
  Plane,
  RefreshCw,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import type { CanonicalApplicabilitySelectionReadModel } from '@shared/api.interface';
import type { CanonicalConfigurationEvidenceStatusReadModel } from '@shared/api.interface';

import {
  isApplicabilitySelectionUnconfigured,
  presentApplicabilitySelection,
  presentApplicabilitySelectionError,
  type ApplicabilitySelectionLoadState,
  type ApplicabilitySelectionPresentation,
} from './applicability-selection-presentation';
import './applicability-selection-panel.css';

interface ApplicabilitySelectionPanelProps {
  workItemId: string;
  workItemRevision: number;
  workItemRefreshing?: boolean;
  onOpenInteractiveReview: () => void;
  onConfigurationEvidenceAdopted: () => Promise<void>;
}

const ApplicabilitySelectionPanel: FC<ApplicabilitySelectionPanelProps> = ({
  workItemId,
  workItemRevision,
  workItemRefreshing = false,
  onOpenInteractiveReview,
  onConfigurationEvidenceAdopted,
}) => {
  const requestEpochRef = useRef<number>(0);
  const evidenceRequestEpochRef = useRef<number>(0);
  const [selection, setSelection] =
    useState<CanonicalApplicabilitySelectionReadModel | null>(null);
  const [loadState, setLoadState] =
    useState<ApplicabilitySelectionLoadState>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [evidenceStatus, setEvidenceStatus] =
    useState<CanonicalConfigurationEvidenceStatusReadModel | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState<boolean>(true);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [adoptingEvidence, setAdoptingEvidence] = useState<boolean>(false);

  const readSelection = useCallback(async (): Promise<void> => {
    const epoch: number = requestEpochRef.current + 1;
    requestEpochRef.current = epoch;
    setLoadState('loading');
    setSelection(null);
    setErrorDetail(null);
    try {
      const fresh: CanonicalApplicabilitySelectionReadModel =
        await canonicalHost.getApplicabilitySelection(workItemId);
      if (requestEpochRef.current !== epoch) return;
      setSelection(fresh);
      setLoadState('ready');
    } catch (reason) {
      if (requestEpochRef.current !== epoch) return;
      setSelection(null);
      if (isApplicabilitySelectionUnconfigured(reason)) {
        setLoadState('unconfigured');
        return;
      }
      setLoadState('error');
      setErrorDetail(presentApplicabilitySelectionError(reason));
    }
  }, [workItemId]);

  const readEvidenceStatus = useCallback(async (): Promise<void> => {
    const epoch: number = evidenceRequestEpochRef.current + 1;
    evidenceRequestEpochRef.current = epoch;
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const fresh: CanonicalConfigurationEvidenceStatusReadModel =
        await canonicalHost.getConfigurationEvidenceStatus(workItemId);
      if (evidenceRequestEpochRef.current !== epoch) return;
      setEvidenceStatus(fresh);
    } catch (reason) {
      if (evidenceRequestEpochRef.current !== epoch) return;
      setEvidenceStatus(null);
      setEvidenceError(
        reason instanceof Error
          ? reason.message
          : '构型证据状态暂时不可用，请刷新后重试。',
      );
    } finally {
      if (evidenceRequestEpochRef.current === epoch) {
        setEvidenceLoading(false);
      }
    }
  }, [workItemId]);

  useEffect(() => {
    void readSelection();
    void readEvidenceStatus();
    return () => {
      requestEpochRef.current += 1;
      evidenceRequestEpochRef.current += 1;
    };
  }, [readEvidenceStatus, readSelection, workItemRevision]);

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([readSelection(), readEvidenceStatus()]);
  }, [readEvidenceStatus, readSelection]);

  const adoptEvidence = useCallback(async (): Promise<void> => {
    const latest = evidenceStatus?.latestQuery;
    if (workItemRefreshing || adoptingEvidence || !latest?.adoptionEligible)
      return;
    setAdoptingEvidence(true);
    setEvidenceError(null);
    try {
      await canonicalHost.adoptConfigurationEvidenceCandidate(
        workItemId,
        latest.candidateEvidenceRef,
        latest.inputRevision,
      );
      await onConfigurationEvidenceAdopted();
    } catch (reason) {
      setEvidenceError(
        reason instanceof Error
          ? reason.message
          : '构型证据候选采纳未完成，请刷新后重试。',
      );
    } finally {
      setAdoptingEvidence(false);
    }
  }, [
    adoptingEvidence,
    evidenceStatus?.latestQuery,
    onConfigurationEvidenceAdopted,
    workItemId,
    workItemRefreshing,
  ]);

  const isLoading: boolean = loadState === 'loading' || evidenceLoading;
  const presentation: ApplicabilitySelectionPresentation =
    presentApplicabilitySelection(loadState, selection);

  return (
    <section
      id="workspace-assessment"
      className="applicability-selection-panel"
      aria-label="适用性自动评估范围"
      aria-busy={isLoading}
    >
      <header className="applicability-selection-header">
        <div className="applicability-selection-heading">
          <span className="applicability-selection-icon" aria-hidden="true">
            <Plane />
          </span>
          <div>
            <span>系统自动评估</span>
            <h2>适用性范围</h2>
            <p>
              初始分析由 Host
              自动冻结评估对象、时点和受控构型事实，不要求工程师先填写或确认。
            </p>
          </div>
        </div>
        <div className="applicability-selection-statuses">
          <Badge
            variant={
              presentation.state === 'error'
                ? 'destructive'
                : presentation.state === 'success'
                  ? 'secondary'
                  : 'outline'
            }
          >
            {presentation.selectionLabel}
          </Badge>
          <Badge
            variant={
              selection?.frozenSourceBinding.status === 'READY'
                ? 'secondary'
                : 'outline'
            }
          >
            {presentation.sourceLabel}
          </Badge>
          <Badge variant="outline">缺失事实保持 UNKNOWN</Badge>
        </div>
      </header>

      {loadState === 'ready' ? (
        <p className="applicability-selection-guidance">
          {presentation.guidance}
        </p>
      ) : null}

      <div className="applicability-selection-actions">
        <Button
          type="button"
          variant="outline"
          disabled={isLoading}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={isLoading ? 'applicability-selection-spin' : ''}
            aria-hidden="true"
          />
          刷新自动范围
        </Button>
        <Button type="button" onClick={onOpenInteractiveReview}>
          <MessageSquareText aria-hidden="true" />
          在交互式复核中补充
        </Button>
      </div>

      <div className="configuration-evidence-status" aria-live="polite">
        <div className="configuration-evidence-status-heading">
          <div>
            <span>构型事件证据</span>
            <h3>查询、候选采纳与 P0B 重算</h3>
          </div>
          <Badge
            variant={
              evidenceStatus?.source.configured ? 'secondary' : 'outline'
            }
          >
            {evidenceLoading
              ? '正在读取事件源'
              : evidenceStatus?.source.configured
                ? '事件源已接通'
                : evidenceStatus
                  ? '事件源未接通'
                  : '事件源状态不可用'}
          </Badge>
        </div>
        <p>{configurationEvidenceGuidance(evidenceStatus)}</p>
        {evidenceStatus?.latestQuery ? (
          <dl className="configuration-evidence-query-summary">
            <div>
              <dt>最近查询</dt>
              <dd>
                {configurationEvidenceQueryLabel(
                  evidenceStatus.latestQuery.terminalStatus,
                )}
              </dd>
            </div>
            <div>
              <dt>受控记录</dt>
              <dd>{evidenceStatus.latestQuery.sourceRecordCount} 条</dd>
            </div>
            <div>
              <dt>候选状态</dt>
              <dd>
                {evidenceStatus.latestQuery.adoptionStatus === 'ADOPTED'
                  ? '已采纳'
                  : evidenceStatus.latestQuery.adoptionEligible
                    ? '可采纳'
                    : '不可采纳'}
              </dd>
            </div>
          </dl>
        ) : null}
        {evidenceStatus?.reevaluation ? (
          <div className="configuration-evidence-stages">
            {(
              [
                ['适用性', evidenceStatus.reevaluation.stages.applicability],
                ['逐项规则', evidenceStatus.reevaluation.stages.jobAid],
                ['综合评估', evidenceStatus.reevaluation.stages.overall],
              ] as const
            ).map(([label, stage]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{configurationEvidenceStageLabel(stage.status)}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {evidenceStatus?.current ? (
          <p className="configuration-evidence-current">
            当前构型证据版本 {evidenceStatus.current.configurationRevision}：
            TRUE {evidenceStatus.current.truthSummary.trueCount} · FALSE{' '}
            {evidenceStatus.current.truthSummary.falseCount} · UNKNOWN{' '}
            {evidenceStatus.current.truthSummary.unknownCount} · CONFLICT{' '}
            {evidenceStatus.current.truthSummary.conflictCount}
          </p>
        ) : null}
        {evidenceStatus?.latestQuery?.adoptionEligible ? (
          <Button
            type="button"
            disabled={workItemRefreshing || adoptingEvidence}
            onClick={() => void adoptEvidence()}
          >
            {adoptingEvidence ? '正在采纳并重算…' : '采纳构型证据候选'}
          </Button>
        ) : null}
      </div>

      {evidenceError ? (
        <div className="applicability-selection-notice is-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{evidenceError}</p>
        </div>
      ) : null}

      {loadState === 'unconfigured' ? (
        <div
          className="applicability-selection-notice is-warning"
          role="status"
        >
          <AlertTriangle aria-hidden="true" />
          <p>{presentation.guidance}</p>
        </div>
      ) : null}
      {errorDetail ? (
        <div className="applicability-selection-notice is-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>{errorDetail}</p>
        </div>
      ) : null}
      {selection ? (
        <details className="applicability-selection-readback">
          <summary>
            <Database aria-hidden="true" />
            <span>查看来源绑定说明</span>
          </summary>
          <div className="applicability-selection-readback-content">
            <h3>Host 冻结的评估范围</h3>
            <dl>
              <div>
                <dt>评估对象</dt>
                <dd>{selection.aircraftIdentifier}</dd>
              </div>
              <div>
                <dt>评估时点</dt>
                <dd>{selection.asOf}</dd>
              </div>
              <div>
                <dt>冻结状态</dt>
                <dd>{presentation.selectionLabel}</dd>
              </div>
              <div>
                <dt>来源绑定</dt>
                <dd>{presentation.sourceLabel}</dd>
              </div>
              <div>
                <dt>来源更新时间</dt>
                <dd>{selection.fleetSource.sourceAsOf}</dd>
              </div>
              <div>
                <dt>受控匹配范围</dt>
                <dd>
                  {selection.frozenSourceBinding.sourceExpressionCount} 条范围 ·{' '}
                  {selection.frozenSourceBinding.assignmentCount} 条飞机分配
                </dd>
              </div>
            </dl>
            <p>
              {presentation.guidance}
              飞机、部件、设备与软件构型条件由 Host
              的受控事实和三值求值器自动判断；如需补充或纠正事实，在交互式复核中与智能体对话，形成候选输入后再由
              Host 校验和增量重算。
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
};

function configurationEvidenceQueryLabel(
  status: NonNullable<
    CanonicalConfigurationEvidenceStatusReadModel['latestQuery']
  >['terminalStatus'],
): string {
  const labels: Record<typeof status, string> = {
    RUNNING: '查询中',
    SUCCEEDED_EVIDENCE: '已取得受控记录',
    SUCCEEDED_NO_RECORD: '未查到受控记录',
    NOT_CONNECTED: '事件源未接通',
    ACCESS_DENIED: '事件源拒绝访问',
    CONFLICT: '记录存在冲突',
    FAILED_VALIDATION: '查询结果未通过校验',
    TIMEOUT: '查询超时',
    CANCELED: '查询已取消',
  };
  return labels[status];
}

function configurationEvidenceGuidance(
  status: CanonicalConfigurationEvidenceStatusReadModel | null,
): string {
  const latest = status?.latestQuery;
  if (!status || !latest) {
    return '尚无构型事件查询记录；缺失事实继续保持 UNKNOWN。';
  }
  if (latest.terminalStatus === 'NOT_CONNECTED') {
    return '构型事件源未接通；本次真实查询未取得受控安装记录，缺失事实继续保持 UNKNOWN。';
  }
  if (latest.terminalStatus === 'SUCCEEDED_NO_RECORD') {
    return '事件源未查到受控记录；这不自动代表不适用，也不会把事实判定为 FALSE。';
  }
  if (latest.adoptionBlockReason === 'WORK_ITEM_REVISION_CHANGED') {
    return '事项已更新，旧候选不可采纳；请基于当前版本重新查询。';
  }
  if (status.reevaluation?.servingCurrentPreserved) {
    return 'P0B 正在按适用性、逐项规则、综合评估顺序重算；全部成功前继续提供原当前结果。';
  }
  if (latest.adoptionEligible) {
    return '查询候选已就绪；采纳后将启动适用性、逐项规则、综合评估的完整重算。';
  }
  if (latest.adoptionStatus === 'ADOPTED') {
    return '构型证据候选已采纳，当前状态已由 Host 记录。';
  }
  return '查询未形成可采纳候选；缺失事实继续保持 UNKNOWN。';
}

function configurationEvidenceStageLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: '待开始',
    RUNNING: '运行中',
    SUCCEEDED: '已完成',
    FAILED: '失败',
    WAITING_INPUT: '等待输入',
    CONFLICT: '存在冲突',
  };
  return labels[status] ?? status;
}

export default ApplicabilitySelectionPanel;
