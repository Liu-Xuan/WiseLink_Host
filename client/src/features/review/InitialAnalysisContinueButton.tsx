import { useEffect, useId, useRef, useState } from 'react';
import type {
  CanonicalAssessmentExecutionMode,
  CanonicalInitialAnalysisContinuationRequest,
  CanonicalInitialAnalysisReadModel,
} from '@shared/api.interface';
import {
  getCanonicalHostClientSessionGeneration,
  requestInitialAnalysisContinuation,
  type CanonicalHostClientError,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import TaskModelPicker, { useTaskModelOptions } from './TaskModelPicker';

interface Props {
  workItemId: string;
  expectedRevision: number;
  operation: CanonicalInitialAnalysisContinuationRequest['operation'];
  executionMode?: CanonicalAssessmentExecutionMode;
  analysisModelName?: string;
  blockIds?: string[];
  label: string;
  disabled?: boolean;
  onQueued: () => void;
  onAccessLost?: () => void;
  queuedRequest?: NonNullable<CanonicalInitialAnalysisReadModel['queuedContinuationRequest']>;
}

interface ProgramModelChoice {
  id: string;
  catalog: ReturnType<typeof useTaskModelOptions>;
  value: string;
  displayName: string | null;
  onChange(value: string): void;
}

interface ContinuationState {
  key: string;
  saving: boolean;
  checking: boolean;
  message: string;
  failed: boolean;
  confirmedRevision: number | null;
  modelRef: string | null;
  modelName: string | null;
}

/** New program requests choose a model; historical continuations keep their binding. */
export default function InitialAnalysisContinueButton(props: Props) {
  if (props.queuedRequest) return <ContinuationRequestButton {...props} />;
  return props.executionMode === 'PROGRAM_CONTROLLED_V1' &&
    props.operation === 'EVALUATE_JOBAID' ? (
    <ProgramContinuation {...props} />
  ) : (
    <ContinuationRequestButton {...props} />
  );
}

function ProgramContinuation(props: Props) {
  const catalog: ReturnType<typeof useTaskModelOptions> = useTaskModelOptions();
  const id: string = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const value: string = selected ?? catalog.data?.defaultModelRef ?? '';
  const model = catalog.data?.options.find(
    (option) => option.modelRef === value && option.available,
  );
  return (
    <ContinuationRequestButton
      {...props}
      modelChoice={{
        id,
        catalog,
        value,
        displayName: model?.displayName ?? null,
        onChange: setSelected,
      }}
    />
  );
}

/** Only an explicit click writes. An uncertain request keeps its exact UUID and payload. */
function ContinuationRequestButton(
  props: Props & { modelChoice?: ProgramModelChoice },
) {
  const session: number = getCanonicalHostClientSessionGeneration();
  const key: string = JSON.stringify([
    session,
    props.workItemId,
    props.operation,
    props.blockIds ?? [],
    props.executionMode ?? null,
    props.queuedRequest ?? null,
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const inFlight = useRef<string | null>(null);
  const pending = useRef<{
    key: string;
    input: CanonicalInitialAnalysisContinuationRequest;
    modelName: string | null;
  } | null>(null);
  const [state, setState] = useState<ContinuationState>({
    key,
    saving: false,
    checking: false,
    message: '',
    failed: false,
    confirmedRevision: null,
    modelRef: null,
    modelName: null,
  });
  const visible: ContinuationState =
    state.key === key
      ? state
      : {
          key,
          saving: false,
          checking: false,
          message: '',
          failed: false,
          confirmedRevision: null,
          modelRef: null,
          modelName: null,
        };
  const unresolved: boolean = pending.current?.key === key;
  const accepted: boolean =
    visible.confirmedRevision === props.expectedRevision;
  const modelReady: boolean =
    !props.modelChoice ||
    (props.modelChoice.catalog.ready && props.modelChoice.displayName !== null);

  async function send(): Promise<void> {
    if (
      props.disabled ||
      inFlight.current === key ||
      accepted ||
      (!unresolved && !modelReady)
    )
      return;
    if (!unresolved)
      pending.current = {
        key,
        input: {
          requestId: props.queuedRequest ? props.queuedRequest.requestId : crypto.randomUUID(),
          expectedRevision: props.expectedRevision,
          operation: props.operation,
          ...(props.queuedRequest
            ? {
                executionMode: props.queuedRequest.executionMode,
                modelRef: props.queuedRequest.modelRef,
              }
            : props.modelChoice
            ? {
                executionMode: 'PROGRAM_CONTROLLED_V1',
                modelRef: props.modelChoice.value,
              }
            : {}),
          ...(props.blockIds
            ? { retranslateBlockIds: [...props.blockIds] }
            : {}),
        },
        modelName:
          props.queuedRequest?.modelName ?? props.modelChoice?.displayName ?? props.analysisModelName ?? null,
      };
    const request = pending.current;
    if (!request) return;
    const current = (): boolean =>
      mounted.current &&
      currentKey.current === key &&
      session === getCanonicalHostClientSessionGeneration();
    inFlight.current = key;
    setState({
      key,
      saving: true,
      checking: unresolved,
      message: '',
      failed: false,
      confirmedRevision: null,
      modelRef: request.input.modelRef ?? null,
      modelName: request.modelName,
    });
    try {
      const receipt = await requestInitialAnalysisContinuation(
        props.workItemId,
        request.input,
      );
      if (!current()) return;
      const active: boolean = [
        'QUEUED',
        'RUNNING',
        'RETRY_SCHEDULED',
        'COMMITTING',
      ].includes(receipt.status);
      const ended: boolean = [
        'SUCCEEDED',
        'FAILED',
        'TIMED_OUT',
        'CANCELLED',
        'CONFLICT',
        'OBSOLETE',
        'WAITING_INPUT',
      ].includes(receipt.status);
      if (active || ended) pending.current = null;
      setState({
        key,
        saving: false,
        checking: false,
        failed: !active && !ended,
        confirmedRevision: active ? props.expectedRevision : null,
        modelRef: request.input.modelRef ?? null,
        modelName: request.modelName,
        message: active
          ? props.queuedRequest
            ? `已恢复原请求的等待流程，本次仍使用 ${request.modelName}。`
            : props.modelChoice
            ? `程序评估请求已保存，本次使用 ${request.modelName}；已保存工作继续可读。`
            : '接续请求已保存，将沿用本事项的模型继续；已保存内容仍保留。'
          : receipt.status === 'SUCCEEDED'
            ? '已核对原请求的成功回执。'
            : ended
              ? '已核对原请求已结束。原记录保留，可发起新一轮请求。'
              : '原请求结果待核；再次点击只核对同一请求，模型与输入保持不变。',
      });
      props.onQueued();
    } catch (error) {
      if (!current()) return;
      const failure = error as CanonicalHostClientError;
      const denied: boolean = [401, 403, 404].includes(failure.statusCode ?? 0);
      const rejected: boolean =
        denied || [400, 409].includes(failure.statusCode ?? 0);
      if (rejected) pending.current = null;
      setState({
        key,
        saving: false,
        checking: false,
        failed: true,
        confirmedRevision: null,
        modelRef: rejected ? null : (request.input.modelRef ?? null),
        modelName: rejected ? null : request.modelName,
        message: denied
          ? '当前事项已不可操作，请重新核对访问权限。'
          : rejected
            ? '当前版本或执行状态已变化，请刷新进度后再继续。'
            : '原请求结果待核；再次点击只核对同一请求，模型与输入保持不变。',
      });
      if (denied) props.onAccessLost?.();
    } finally {
      if (inFlight.current === key) inFlight.current = null;
    }
  }

  return (
    <div className="wl-initial-continuation">
      {props.modelChoice ? (
        <>
          <TaskModelPicker
            id={props.modelChoice.id}
            label="本次程序评估模型"
            value={
              (unresolved || accepted) && visible.modelRef
                ? visible.modelRef
                : props.modelChoice.value
            }
            onChange={props.modelChoice.onChange}
            catalog={props.modelChoice.catalog}
            disabled={
              props.disabled || visible.saving || unresolved || accepted
            }
          />
          <p className="wl-initial-analysis-note">
            {unresolved
              ? `原请求模型：${pending.current?.modelName ?? '已固定'}`
              : accepted
                ? `已受理请求模型：${visible.modelName ?? '已固定'}`
                : `本次将使用：${props.modelChoice.displayName ?? '尚未选定可用模型'}`}
            。 这次选择只用于新评估；首次提交另建请求，旧请求与历史成果保留。
          </p>
        </>
      ) : props.queuedRequest ? (
        <p className="wl-initial-analysis-note">
          已受理请求模型：{props.queuedRequest.modelName}。继续执行同一请求，原有记录保留。
        </p>
      ) : (
        <p className="wl-initial-analysis-note">
          将沿用本事项模型
          {props.analysisModelName
            ? `：${props.analysisModelName}`
            : '，具体模型以任务读回为准'}
          。
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={
          props.disabled ||
          visible.saving ||
          accepted ||
          (!unresolved && !modelReady)
        }
        onClick={() => {
          void send();
        }}
      >
        {visible.saving
          ? visible.checking
            ? '正在核对原请求…'
            : '正在保存请求…'
          : visible.failed && unresolved
            ? '核对原请求结果'
            : accepted
              ? '请求已受理'
              : props.label}
      </Button>
      {visible.message ? (
        <p
          className="wl-initial-analysis-note"
          role={visible.failed ? 'alert' : 'status'}
        >
          {visible.message}
        </p>
      ) : null}
    </div>
  );
}
