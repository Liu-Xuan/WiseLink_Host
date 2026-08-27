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

import './applicability-selection-panel.css';

interface ApplicabilitySelectionPanelProps {
  workItemId: string;
  onRefreshWorkspace: () => void;
}

type SelectionLoadState = 'loading' | 'ready' | 'unconfigured' | 'error';

const UNCONFIGURED_CODE = 'APPLICABILITY_CONTROLLED_SELECTION_NOT_CONFIGURED';
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function requestErrorDetail(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim();
  }
  const detail: string = String(reason ?? '').trim();
  return detail || fallback;
}

const ApplicabilitySelectionPanel: FC<ApplicabilitySelectionPanelProps> = ({
  workItemId,
  onRefreshWorkspace,
}) => {
  const requestEpochRef = useRef<number>(0);
  const [selection, setSelection] =
    useState<CanonicalApplicabilitySelectionReadModel | null>(null);
  const [aircraftIdentifier, setAircraftIdentifier] = useState<string>('');
  const [asOf, setAsOf] = useState<string>('');
  const [loadState, setLoadState] = useState<SelectionLoadState>('loading');
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
      const detail: string = requestErrorDetail(
        reason,
        'APPLICABILITY_SELECTION_UNAVAILABLE',
      );
      setSelection(null);
      if (detail.includes(UNCONFIGURED_CODE)) {
        setAircraftIdentifier('');
        setAsOf('');
        setLoadState('unconfigured');
        return;
      }
      setLoadState('error');
      setErrorDetail(detail);
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
      setErrorDetail('飞机号与 as-of 必须由工程师明确填写。');
      setSuccessMessage(null);
      return;
    }
    if (!ISO_DATE_PATTERN.test(normalizedAsOf)) {
      setErrorDetail('as-of 格式必须为 YYYY-MM-DD。');
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
      setSuccessMessage('已提交，并完成 authenticated Host GET readback。');
    } catch (reason) {
      if (requestEpochRef.current !== epoch) return;
      setErrorDetail(
        requestErrorDetail(reason, 'APPLICABILITY_SELECTION_SAVE_FAILED'),
      );
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
  const sourceBindingReady: boolean =
    selection?.frozenSourceBinding.status === 'READY';
  const draftPresent: boolean = Boolean(
    aircraftIdentifier.trim() || asOf.trim(),
  );
  const draftMatchesReadback: boolean = Boolean(
    selection &&
    aircraftIdentifier.trim() === selection.aircraftIdentifier &&
    asOf.trim() === selection.asOf,
  );

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
            <span>Host 受控输入</span>
            <h2>飞机适用性选择</h2>
            <p>
              仅保存工程师明确输入的飞机号与评估时点；浏览器不会生成飞机或构型事实。
            </p>
          </div>
        </div>
        <div className="applicability-selection-statuses">
          <Badge
            variant={
              selection?.currentness === 'STALE' ? 'destructive' : 'outline'
            }
          >
            {selection
              ? `currentness · ${selection.currentness}`
              : 'currentness · 未读回'}
          </Badge>
          <Badge variant={sourceBindingReady ? 'secondary' : 'outline'}>
            frozen source · {selection?.frozenSourceBinding.status ?? '未读回'}
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
            <CalendarDays aria-hidden="true" /> as-of
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
            评估时点与 Fleet source currentness 分开保存。
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
            读取当前选择
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
          <p>
            当前 WorkItem 尚未配置飞机适用性选择。
            <code>{UNCONFIGURED_CODE}</code>
          </p>
        </div>
      ) : null}
      {errorDetail ? (
        <div className="applicability-selection-notice is-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <p>
            Host 返回：<code>{errorDetail}</code>
          </p>
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
        <div className="applicability-selection-readback">
          <div className="applicability-selection-readback-title">
            <Database aria-hidden="true" />
            <div>
              <span>authenticated GET readback</span>
              <h3>当前 Host 选择与来源绑定</h3>
            </div>
          </div>
          <dl>
            <div>
              <dt>飞机号 / as-of</dt>
              <dd>
                {selection.aircraftIdentifier} · {selection.asOf}
              </dd>
            </div>
            <div>
              <dt>WorkItem revision</dt>
              <dd>{selection.workItemRevision}</dd>
            </div>
            <div>
              <dt>selection revision</dt>
              <dd>{selection.selectionRevision}</dd>
            </div>
            <div>
              <dt>DocumentVersion</dt>
              <dd>{selection.documentVersionId}</dd>
            </div>
            <div>
              <dt>Fleet source revision</dt>
              <dd>{selection.fleetSource.sourceRevisionKey}</dd>
            </div>
            <div>
              <dt>Fleet authority revision</dt>
              <dd>{selection.fleetSource.authorityRevision}</dd>
            </div>
            <div>
              <dt>Fleet source as-of</dt>
              <dd>{selection.fleetSource.sourceAsOf}</dd>
            </div>
            <div>
              <dt>frozen source binding</dt>
              <dd>
                {selection.frozenSourceBinding.status} ·{' '}
                {selection.frozenSourceBinding.sourceExpressionCount} 条表达式 /{' '}
                {selection.frozenSourceBinding.assignmentCount} 条分配
              </dd>
            </div>
          </dl>
          <p>
            此读回只证明 Host
            已冻结选择与来源绑定；不代表构型事实完整，也不构成正式适用性结论。
          </p>
        </div>
      ) : null}
    </section>
  );
};

export default ApplicabilitySelectionPanel;
