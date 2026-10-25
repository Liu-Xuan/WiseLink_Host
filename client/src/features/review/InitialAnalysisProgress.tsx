import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import type {
  CanonicalInitialAnalysisReadModel,
  CanonicalTimelineProjection,
} from '@shared/api.interface';
import type { JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import {
  getInitialAnalysisStatus,
  type CanonicalHostClientError,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import TaskPills, { initialAnalysisNotes } from './TaskPills';
import InitialAnalysisContinueButton from './InitialAnalysisContinueButton';

interface Props {
  workItemId: string;
  sessionGeneration: number;
  initial?: CanonicalInitialAnalysisReadModel;
  working?: JobAidWorkingReadModel | null;
  timeline: CanonicalTimelineProjection;
  onRevisionChanged: () => void;
  onAccessLost: () => void;
}

export function shouldPollInitialAnalysis(
  value: CanonicalInitialAnalysisReadModel | undefined,
): boolean {
  return (
    value?.status === 'BUSY' ||
    value?.status === 'REQUIRED' ||
    (value?.status === 'WAITING_INPUT' && value.nextOperation !== null)
  );
}

/** Automatic polling only reads; continuation requires its own explicit click. */
export default function InitialAnalysisProgress(props: Props) {
  const [readback, setReadback] = useState({
    workItemId: props.workItemId,
    generation: props.sessionGeneration,
    value: props.initial,
    error: '',
    reading: false,
  });
  const latest = useRef(props);
  latest.current = props;
  const readEpoch = useRef(0);
  const notifiedRevision = useRef(props.initial?.workItemRevision ?? -1);
  const notifiedTranslation = useRef(
    JSON.stringify(props.initial?.translationWork ?? null),
  );
  const sameScope =
    readback.workItemId === props.workItemId &&
    readback.generation === props.sessionGeneration;
  const value = sameScope ? readback.value : props.initial;
  const error = sameScope ? readback.error : '';
  const selected = props.working?.selectedExecution;
  const resultPending: boolean =
    Boolean(
      props.working?.activity?.consumerStopped &&
      props.working.activity.attemptRef === selected?.attemptRef &&
      selected?.status !== 'SUCCEEDED',
    ) ||
    value?.stages.jobAid.terminalCode?.includes('UNKNOWN') === true ||
    props.working?.executionStatus === 'UNKNOWN';
  const assessmentBusy: boolean = props.working?.executionStatus
    ? [
        'REQUESTED',
        'QUEUED',
        'RUNNING',
        'RETRY_SCHEDULED',
        'COMMITTING',
      ].includes(props.working.executionStatus)
    : value?.stages.jobAid.status === 'BUSY';

  useEffect(() => {
    readEpoch.current += 1;
    notifiedRevision.current = props.initial?.workItemRevision ?? -1;
    notifiedTranslation.current = JSON.stringify(
      props.initial?.translationWork ?? null,
    );
    setReadback({
      workItemId: props.workItemId,
      generation: props.sessionGeneration,
      value: props.initial,
      error: '',
      reading: false,
    });
    return () => {
      readEpoch.current += 1;
    };
  }, [props.workItemId, props.sessionGeneration, props.initial]);

  async function refresh() {
    const scope = latest.current;
    const epoch = ++readEpoch.current;
    const isCurrent = () =>
      readEpoch.current === epoch &&
      latest.current.workItemId === scope.workItemId &&
      latest.current.sessionGeneration === scope.sessionGeneration;
    setReadback((previous) => ({ ...previous, reading: true }));
    try {
      const status = await getInitialAnalysisStatus(scope.workItemId);
      if (!isCurrent()) return;
      if (
        status.workItemId !== scope.workItemId ||
        (scope.initial &&
          status.documentVersionId !== scope.initial.documentVersionId)
      ) {
        throw new Error('INITIAL_ANALYSIS_SCOPE_CHANGED');
      }
      setReadback({
        workItemId: scope.workItemId,
        generation: scope.sessionGeneration,
        value: status,
        error: '',
        reading: false,
      });
      const translationVersion = JSON.stringify(status.translationWork ?? null);
      if (
        status.workItemRevision > notifiedRevision.current ||
        translationVersion !== notifiedTranslation.current
      ) {
        notifiedRevision.current = status.workItemRevision;
        notifiedTranslation.current = translationVersion;
        scope.onRevisionChanged();
      }
    } catch (reason) {
      if (!isCurrent()) return;
      const failure = reason as CanonicalHostClientError;
      const denied = [401, 403, 404].includes(failure.statusCode ?? 0);
      setReadback((previous) => ({
        ...previous,
        value: denied ? undefined : previous.value,
        reading: false,
        error: denied
          ? '当前事项已不可读取，正在核对访问权限。'
          : '进度暂未更新，仍显示上次读回状态。刷新只查询状态，不会重跑任务。',
      }));
      if (denied) scope.onAccessLost();
    }
  }

  useEffect(() => {
    if (error || !shouldPollInitialAnalysis(value)) return;
    const timer = setTimeout(() => {
      void refresh();
    }, 4000);
    return () => clearTimeout(timer);
  }, [value, error, props.workItemId, props.sessionGeneration]);

  return (
    <div className="parse-task-strip" aria-label="分析任务状态">
      <span className="parse-task-strip-label">分析进度</span>
      {value?.analysisModel ? (
        <span className="text-xs">
          事项绑定模型：{value.analysisModel.displayName}
        </span>
      ) : null}
      {value?.continuationOperations
        ?.filter(
          (operation) => operation !== 'EVALUATE_JOBAID' || !assessmentBusy,
        )
        .map((operation) => (
          <InitialAnalysisContinueButton
            key={operation}
            workItemId={props.workItemId}
            expectedRevision={value.workItemRevision}
            operation={operation}
            executionMode={
              operation === 'EVALUATE_JOBAID'
                ? 'PROGRAM_CONTROLLED_V1'
                : undefined
            }
            analysisModelName={value.analysisModel?.displayName}
            label={
              operation === 'TRANSLATE'
                ? value.stages.translation.status === 'SUCCEEDED'
                  ? '重新翻译中文'
                  : '继续中文翻译'
                : operation === 'EVALUATE_JOBAID'
                  ? '开始程序评估'
                  : '继续综合评估'
            }
            onQueued={() => {
              void refresh();
              props.onRevisionChanged();
            }}
            onAccessLost={props.onAccessLost}
          />
        ))}
      {resultPending ? (
        <p className="wl-initial-analysis-note" role="status">
          原请求结果待核。
          {value?.continuationOperations?.includes('EVALUATE_JOBAID') &&
          !assessmentBusy
            ? '本次程序评估会另建请求，保留原请求记录。'
            : '当前没有可发起的新评估范围。'}
        </p>
      ) : null}
      <TaskPills timeline={props.timeline} initialAnalysis={value} />
      {value?.continuationDiagnosticCode ===
      'OFFICIAL_OAUTH_SESSION_REQUIRED' ? (
        <p className="wl-initial-analysis-note" role="status">
          续办身份尚未验证，请先完成工作台身份验证。
        </p>
      ) : null}
      {props.initial ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="刷新分析进度"
          disabled={sameScope && readback.reading}
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw aria-hidden="true" />
          刷新进度
        </Button>
      ) : null}
      {value
        ? initialAnalysisNotes(value).map((note) => (
            <p className="wl-initial-analysis-note" key={note}>
              {note}
            </p>
          ))
        : null}
      {error ? (
        <p className="wl-initial-analysis-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
