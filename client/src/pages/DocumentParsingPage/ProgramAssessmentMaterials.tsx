import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalHostIdentityContext,
  readProgramAssessmentMaterials,
  subscribeCanonicalHostClientSession,
  type CanonicalHostClientError,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import type { JobAidProgramMaterialsRead } from '@shared/jobaid-problem-assessment.interface';

interface Props {
  workItemId: string;
  attemptId: string;
  attemptRef: string | null;
  available: boolean;
  executionModel?: CanonicalExecutionModelSelection | null;
  observationKey?: string;
}

const MATERIAL_GROUPS = [
  ['taskAndScope', '任务与范围'],
  ['continuousOriginal', '连续原文'],
  ['objectAndCompanyFacts', '对象与公司事实'],
  ['relevantMethods', '相关方法'],
  ['previousUnderstandingAndChanges', '既有认识与变化'],
] as const;

const MATERIAL_LABELS: Record<string, string> = {
  content: '正文',
  binding: '准确版本',
  title: '标题',
  question: '问题',
  query: '本轮请求',
  documentCode: '文件编号',
  normalizedFamily: '文件类别',
  revision: '修订',
  versionLabel: '版本',
  parseRevision: '解析修订',
  evidence: '已准备的依据内容',
  excerpt: '内容',
  kind: '资料类型',
  contextPackage: '本轮上下文',
  primaryDocument: '主要文件',
  supplementaryMaterials: '补充材料',
  status: '记录状态',
  reason: '原因',
  impact: '影响',
  coverage: '取得范围',
  findings: '读取发现',
  available: '可用性',
  limitation: '限制',
  limitations: '限制',
  conditions: '条件',
  sourceOrigins: '来源性质',
  methodBinding: '方法版本',
  sources: '方法来源',
  version: '版本',
  previousWork: '准确旧工作',
  discussion: '本轮讨论与更正',
  understanding: '已有综合认识',
  headline: '工程重点',
  listBrief: '摘要',
  issues: '问题分析',
  body: '分析正文',
  openQuestions: '待核问题',
  affects: '影响判断',
  nextEvidence: '下一步依据',
  changeSummary: '本轮变化',
  completionReason: '完成范围与理由',
  measures: '措施',
  text: '内容',
  requirementHandling: '方法要求的承接',
  requirement: '要求',
  explanation: '说明',
  treatment: '处理情况',
};
const TECHNICAL_MATERIAL_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'purpose',
  'executionMode',
  'sourceRefId',
  'sourceRefIds',
  'evidenceRef',
  'evidenceRefs',
  'ref',
  'workRevisionRef',
  'previousWorkRevisionRef',
  'actionAttemptId',
  'requestId',
  'workItemId',
  'spans',
  'sourceLocators',
  'readContext',
  'deliveredEvidenceRefs',
  'methodRef',
  'basisRefs',
  'premiseRefs',
]);

function materialRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Display every retained value; deeper structures remain exact text rather than being truncated. */
function MaterialValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (value === null || value === undefined) return <p>未提供</p>;
  if (typeof value !== 'object')
    return <p className="whitespace-pre-wrap break-words">{String(value)}</p>;
  if (depth >= 6)
    return (
      <pre className="whitespace-pre-wrap break-words">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  if (Array.isArray(value))
    return value.length ? (
      <ol className="grid gap-3 pl-5">
        {value.map((item: unknown, index: number) => (
          <li key={index}>
            <MaterialValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    ) : (
      <p>本次未记录此类内容</p>
    );
  const entries: Array<[string, unknown]> = Object.entries(value);
  const business: Array<[string, unknown]> = entries.filter(
    ([key]) => !TECHNICAL_MATERIAL_KEYS.has(key),
  );
  const technical: Array<[string, unknown]> = entries.filter(([key]) =>
    TECHNICAL_MATERIAL_KEYS.has(key),
  );
  return (
    <div className="grid gap-3">
      {business.length ? (
        <dl className="grid gap-3">
          {business.map(([key, item]) => (
            <div key={key}>
              <dt className="font-medium">{MATERIAL_LABELS[key] ?? key}</dt>
              <dd className="mt-1 pl-3">
                <MaterialValue value={item} depth={depth + 1} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {technical.length ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            来源、版本与关联记录
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {JSON.stringify(Object.fromEntries(technical), null, 2)}
          </pre>
        </details>
      ) : null}
      {!entries.length ? <p>本次未记录此类内容</p> : null}
    </div>
  );
}

export function ProgramMaterialsContent({
  read,
}: {
  read: JobAidProgramMaterialsRead;
}) {
  const materials: Record<string, unknown> | null = materialRecord(
    read.snapshot?.materials,
  );
  const request: Record<string, unknown> | null = materialRecord(
    read.snapshot?.modelRequest,
  );
  const input: Record<string, unknown> | null = materialRecord(
    materials?.modelInput,
  );
  if (
    !input ||
    !MATERIAL_GROUPS.every(([key]) => materialRecord(input[key])) ||
    typeof materialRecord(input.continuousOriginal)?.content !== 'string' ||
    typeof request?.body !== 'string'
  )
    return <p role="alert">本次快照缺少完整材料或准确原请求，暂不能展示。</p>;
  return (
    <section className="grid gap-4 text-sm" aria-label="本次准确评估材料">
      <header className="grid gap-2">
        <strong>本次模型：{read.executionModel.displayName}</strong>
        <p>
          材料准备记录时间：
          <time dateTime={read.preparedAt}>
            {new Date(read.preparedAt).toLocaleString('zh-CN')}
          </time>
        </p>
        <p role="status">
          {read.submissionEvidence === 'RESPONSE_RECEIVED'
            ? '已记录模型响应；这不表示工程结论已采用。'
            : '材料已准备，尚未确认是否发送；准备记录不能证明模型已处理。'}
        </p>
        <p>以下保留本次准备时的内容与版本，不跳转为最新资料。</p>
      </header>
      {MATERIAL_GROUPS.map(([key, label]) => (
        <details
          key={key}
          className="rounded-md border p-3"
          open={key === 'continuousOriginal'}
        >
          <summary className="cursor-pointer font-medium">{label}</summary>
          <div className="mt-3">
            <MaterialValue value={input[key]} />
          </div>
        </details>
      ))}
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">
          技术细节：准确序列化原请求
        </summary>
        <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
          {String(request.body)}
        </pre>
      </details>
    </section>
  );
}

function materialReadMessage(error: unknown): string {
  const failure: Partial<CanonicalHostClientError> =
    error !== null && typeof error === 'object' ? error : {};
  if (failure.code === 'JOBAID_PROGRAM_MATERIALS_UNAVAILABLE')
    return '本次执行没有可读取的合法材料快照。';
  if (failure.statusCode === 401 || failure.code?.includes('LOGIN_REQUIRED'))
    return '当前登录已失效，请重新验证身份后读取。';
  if (failure.statusCode === 403) return '当前无权读取本次材料或其中的来源。';
  if (failure.statusCode === 404) return '本次材料或其中的来源当前不可访问。';
  if (failure.statusCode === 409)
    return '本次材料的来源或版本核对未通过，请重新读取。';
  if (
    /JOBAID_PROGRAM_MATERIALS_.*(?:INVALID|MISMATCH)/u.test(failure.code ?? '')
  )
    return '本次材料快照的完整性或版本核对未通过，已停止展示。';
  if (failure.message === 'PROGRAM_ASSESSMENT_MATERIALS_BINDING_MISMATCH')
    return '材料快照与当前事项或执行不一致，已停止展示。';
  return '本次材料读取失败，请重新读取；未重新评估或调用模型。';
}

function materialDiagnosticCode(error: unknown): string | null {
  const failure: Partial<CanonicalHostClientError> =
    error !== null && typeof error === 'object' ? error : {};
  const code: string = failure.code ?? failure.message ?? '';
  return /^[A-Z][A-Z0-9_]{1,119}$/u.test(code) ? code : null;
}

function ProgramMaterialsRead({
  session,
  ...props
}: Props & { session: number }) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    scope: string;
    identityKey: string | null;
    data: JobAidProgramMaterialsRead | null;
    error: string | null;
    diagnostic?: string | null;
  }>({ scope: '', identityKey: null, data: null, error: null });
  const scope: string = JSON.stringify([
    session,
    props.workItemId,
    props.attemptId,
    props.attemptRef,
  ]);
  const epoch = useRef(0);
  const refresh = useCallback((): void => {
    setState({ scope, identityKey: null, data: null, error: null });
    setRetry((value: number) => value + 1);
  }, [scope]);
  useEffect(() => {
    const onFocus = (): void => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const currentEpoch: number = ++epoch.current;
    const current = (): boolean =>
      !controller.signal.aborted &&
      epoch.current === currentEpoch &&
      getCanonicalHostClientSessionGeneration() === session;
    setState({ scope, identityKey: null, data: null, error: null });
    void (async (): Promise<void> => {
      try {
        const identity = await getCanonicalHostIdentityContext({ fresh: true });
        if (!current()) return;
        const identityKey: string = JSON.stringify([
          session,
          identity.tenantId,
          identity.userId,
          props.workItemId,
          props.attemptId,
        ]);
        const read: JobAidProgramMaterialsRead =
          await readProgramAssessmentMaterials(
            props.workItemId,
            props.attemptId,
            controller.signal,
          );
        if (!current()) return;
        if (
          read.workItemId !== props.workItemId ||
          read.attemptId !== props.attemptId ||
          read.executionMode !== 'PROGRAM_CONTROLLED_V1' ||
          (props.attemptRef && read.attemptRef !== props.attemptRef) ||
          (props.executionModel &&
            read.executionModel.modelRef !== props.executionModel.modelRef)
        )
          throw new Error('PROGRAM_ASSESSMENT_MATERIALS_BINDING_MISMATCH');
        setState({ scope, identityKey, data: read, error: null });
      } catch (error) {
        if (current())
          setState({
            scope,
            identityKey: null,
            data: null,
            error: materialReadMessage(error),
            diagnostic: materialDiagnosticCode(error),
          });
      }
    })();
    return () => {
      controller.abort();
      epoch.current += 1;
    };
  }, [
    scope,
    session,
    props.workItemId,
    props.attemptId,
    props.attemptRef,
    props.executionModel?.modelRef,
    props.observationKey,
    retry,
  ]);
  const visible = state.scope === scope ? state : null;
  return (
    <div className="mt-3 grid gap-3">
      {!visible?.data && !visible?.error ? (
        <p role="status">正在读取本次材料并核对来源权限…</p>
      ) : null}
      {visible?.error ? <p role="alert">{visible.error}</p> : null}
      {visible?.error && visible.diagnostic ? (
        <details>
          <summary>读取诊断</summary>
          <code>{visible.diagnostic}</code>
        </details>
      ) : null}
      {visible?.data && visible.identityKey ? (
        <ProgramMaterialsContent read={visible.data} />
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={refresh}>
        重新读取本次材料
      </Button>
    </div>
  );
}

function ProgramMaterialsViewer(props: Props) {
  const session: number = useSyncExternalStore(
    subscribeCanonicalHostClientSession,
    getCanonicalHostClientSessionGeneration,
    getCanonicalHostClientSessionGeneration,
  );
  const scope: string = JSON.stringify([
    session,
    props.workItemId,
    props.attemptId,
    props.attemptRef,
  ]);
  const [expandedScope, setExpandedScope] = useState<string | null>(null);
  const open: boolean = expandedScope === scope;
  return (
    <div className="px-4 pb-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setExpandedScope(open ? null : scope)}
      >
        {open ? '收起本次材料' : '查看本次材料'}
      </Button>
      {open ? (
        <ProgramMaterialsRead key={scope} {...props} session={session} />
      ) : null}
    </div>
  );
}

export default function ProgramAssessmentMaterials(props: Props) {
  return props.available ? (
    <ProgramMaterialsViewer {...props} />
  ) : (
    <p className="px-4 pb-4 text-sm">尚未读到可查看的本次材料快照。</p>
  );
}
