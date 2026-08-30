import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
} from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Database,
  Plane,
  RefreshCw,
  Save,
} from 'lucide-react';

import { canonicalHost } from '@client/src/api';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
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
  onRefreshWorkspace: () => void;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const ApplicabilitySelectionPanel: FC<ApplicabilitySelectionPanelProps> = ({
  workItemId,
  onRefreshWorkspace,
}) => {
  const requestEpochRef = useRef<number>(0);
  const [selection, setSelection] =
    useState<CanonicalApplicabilitySelectionReadModel | null>(null);
  const [aircraftIdentifier, setAircraftIdentifier] = useState<string>('');
  const [asOf, setAsOf] = useState<string>('');
  const [loadState, setLoadState] =
    useState<ApplicabilitySelectionLoadState>('loading');
  const [saving, setSaving] = useState<boolean>(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const readSelection = useCallback(async (): Promise<void> => {
    const epoch: number = requestEpochRef.current + 1;
    requestEpochRef.current = epoch;
    setLoadState('loading');
    setSelection(null);
    setAircraftIdentifier('');
    setAsOf('');
    setErrorDetail(null);
    setSuccessMessage(null);
    try {
      const fresh: CanonicalApplicabilitySelectionReadModel =
        await canonicalHost.getApplicabilitySelection(workItemId);
      if (requestEpochRef.current !== epoch) return;
      setSelection(fresh);
      setAircraftIdentifier(fresh.aircraftIdentifier);
      setAsOf(fresh.asOf);
      setLoadState('ready');
    } catch (reason) {
      if (requestEpochRef.current !== epoch) return;
      setSelection(null);
      if (isApplicabilitySelectionUnconfigured(reason)) {
        setAircraftIdentifier('');
        setAsOf('');
        setLoadState('unconfigured');
        return;
      }
      setLoadState('error');
      setErrorDetail(presentApplicabilitySelectionError(reason, 'read'));
    }
  }, [workItemId]);

  useEffect(() => {
    void readSelection();
    return () => {
      requestEpochRef.current += 1;
    };
  }, [readSelection]);

  async function saveSelection(): Promise<void> {
    const normalizedAircraftIdentifier: string = aircraftIdentifier.trim();
    const normalizedAsOf: string = asOf.trim();
    if (!normalizedAircraftIdentifier || !normalizedAsOf) {
      setErrorDetail('飞机号与评估日期必须由工程师明确填写。');
      setSuccessMessage(null);
      return;
    }
    if (!ISO_DATE_PATTERN.test(normalizedAsOf)) {
      setErrorDetail('评估日期格式必须为 YYYY-MM-DD。');
      setSuccessMessage(null);
      return;
    }

    const epoch: number = requestEpochRef.current + 1;
    requestEpochRef.current = epoch;
    setSaving(true);
    setErrorDetail(null);
    setSuccessMessage(null);
    try {
      const readback: CanonicalApplicabilitySelectionReadModel =
        await canonicalHost.configureApplicabilitySelection(workItemId, {
          aircraftIdentifier: normalizedAircraftIdentifier,
          asOf: normalizedAsOf,
        });
      if (requestEpochRef.current !== epoch) return;
      setSelection(readback);
      setAircraftIdentifier(readback.aircraftIdentifier);
      setAsOf(readback.asOf);
      setLoadState('ready');
      setSuccessMessage('已保存并重新读取当前选择。');
    } catch (reason) {
      if (requestEpochRef.current !== epoch) return;
      setErrorDetail(presentApplicabilitySelectionError(reason, 'save'));
    } finally {
      if (requestEpochRef.current === epoch) setSaving(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void saveSelection();
  }

  function handleAircraftIdentifierChange(
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    setAircraftIdentifier(event.target.value);
    setSuccessMessage(null);
  }

  function handleAsOfChange(event: ChangeEvent<HTMLInputElement>): void {
    setAsOf(event.target.value);
    setSuccessMessage(null);
  }

  const isLoading: boolean = loadState === 'loading';
  const isBusy: boolean = isLoading || saving;
  const draftPresent: boolean = Boolean(
    aircraftIdentifier.trim() || asOf.trim(),
  );
  const draftMatchesReadback: boolean = Boolean(
    selection &&
    aircraftIdentifier.trim() === selection.aircraftIdentifier &&
    asOf.trim() === selection.asOf,
  );
  const presentation: ApplicabilitySelectionPresentation =
    presentApplicabilitySelection(loadState, selection);

  return (
    <section
      id="workspace-assessment"
      className="applicability-selection-panel"
      aria-label="飞机适用性选择"
      aria-busy={isBusy}
    >
      <header className="applicability-selection-header">
        <div className="applicability-selection-heading">
          <span className="applicability-selection-icon" aria-hidden="true">
            <Plane />
          </span>
          <div>
            <span>工程师受控输入</span>
            <h2>飞机适用性选择</h2>
            <p>
              仅保存工程师明确输入的飞机号与评估时点；浏览器不会生成飞机或构型事实。
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
          <Badge variant="outline">
            表单 ·{' '}
            {draftMatchesReadback
              ? '与读回一致'
              : draftPresent
                ? '未提交编辑'
                : '等待输入'}
          </Badge>
        </div>
      </header>

      {loadState === 'ready' ? (
        <p className="applicability-selection-guidance">
          {presentation.guidance}
        </p>
      ) : null}

      <div className="applicability-selection-controls">
        <label htmlFor="applicability-aircraft-identifier">
          <span>
            <Plane aria-hidden="true" /> 飞机号
          </span>
          <Input
            id="applicability-aircraft-identifier"
            type="text"
            value={aircraftIdentifier}
            maxLength={64}
            autoComplete="off"
            disabled={isBusy}
            placeholder="输入受控飞机号"
            onChange={handleAircraftIdentifierChange}
            onKeyDown={handleInputKeyDown}
          />
        </label>
        <label htmlFor="applicability-as-of">
          <span>
            <CalendarDays aria-hidden="true" /> 评估日期
          </span>
          <Input
            id="applicability-as-of"
            type="text"
            value={asOf}
            maxLength={10}
            inputMode="numeric"
            autoComplete="off"
            disabled={isBusy}
            placeholder="YYYY-MM-DD"
            aria-describedby="applicability-as-of-help"
            onChange={handleAsOfChange}
            onKeyDown={handleInputKeyDown}
          />
          <small id="applicability-as-of-help">
            评估日期用于冻结本次查询时点；资料版本由系统单独校验。
          </small>
        </label>
        <div className="applicability-selection-actions">
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => void readSelection()}
          >
            <RefreshCw
              className={isLoading ? 'applicability-selection-spin' : ''}
              aria-hidden="true"
            />
            读取已保存选择
          </Button>
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => void saveSelection()}
          >
            <Save aria-hidden="true" />
            {saving ? '提交并读回中…' : '提交并读回'}
          </Button>
        </div>
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
      {successMessage ? (
        <div
          className="applicability-selection-notice is-success"
          role="status"
        >
          <CheckCircle2 aria-hidden="true" />
          <p>{successMessage}</p>
          <Button type="button" variant="outline" onClick={onRefreshWorkspace}>
            刷新工作台其余结果
          </Button>
        </div>
      ) : null}

      {selection ? (
        <details className="applicability-selection-readback">
          <summary>
            <Database aria-hidden="true" />
            <span>查看来源绑定说明</span>
          </summary>
          <div className="applicability-selection-readback-content">
            <h3>当前选择与受控来源</h3>
            <dl>
              <div>
                <dt>飞机号</dt>
                <dd>{selection.aircraftIdentifier}</dd>
              </div>
              <div>
                <dt>评估日期</dt>
                <dd>{selection.asOf}</dd>
              </div>
              <div>
                <dt>选择状态</dt>
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
              这里仅展示工程师输入及来源绑定，不推断飞机适用性，也不构成正式工程结论。
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
};

export default ApplicabilitySelectionPanel;
