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
  onOpenInteractiveReview: () => void;
}

const ApplicabilitySelectionPanel: FC<ApplicabilitySelectionPanelProps> = ({
  workItemId,
  onOpenInteractiveReview,
}) => {
  const requestEpochRef = useRef<number>(0);
  const [selection, setSelection] =
    useState<CanonicalApplicabilitySelectionReadModel | null>(null);
  const [loadState, setLoadState] =
    useState<ApplicabilitySelectionLoadState>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

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

  useEffect(() => {
    void readSelection();
    return () => {
      requestEpochRef.current += 1;
    };
  }, [readSelection]);

  const isLoading: boolean = loadState === 'loading';
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
          onClick={() => void readSelection()}
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

export default ApplicabilitySelectionPanel;
