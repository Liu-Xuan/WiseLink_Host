import type { JobAidProblemWorkContent, JobAidWorkingReadModel } from '@shared/jobaid-problem-assessment.interface';
import { parseAssessmentTdmsEvidence, type AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import { tdmsSourceVersionLabel } from '@/features/tdms-source/tdms-source-presentation';
import type { ReadState, RuntimeEdge, RuntimeProjection, RuntimeNode } from './monitor-types';

/** Structural subset of the verified b37 JobAidWorkingReadModel. */
export interface JobAidWorkingObservation {
  schemaVersion: 'wiselink.jobaid-working-read.v2';
  enabled: boolean;
  workItemId: string;
  current: {
    workRevisionRef: string;
    workItemId: string;
    workRevision: number;
    requestId: string;
    actionAttemptId: string;
    basedOnWorkItemRevision: number;
    documentVersionId: string;
    createdAt: string;
    content?: Pick<JobAidProblemWorkContent, 'evidence'>;
  } | null;
  latestAttempt: { attemptId: string; status: string; inputRevision: number | null; createdAt?: string; startedAt?: string | null; firstSavedAt?: string | null; completedAt?: string | null } | null;
  selectedExecution?: JobAidWorkingReadModel['selectedExecution'];
  activity?: JobAidWorkingReadModel['activity'];
  executionStatus: string | null;
  currentInputChanged: boolean;
  overallStatus: 'NOT_AVAILABLE' | 'CURRENT' | 'STALE';
  overallBasedOnWorkRevisionRef: string | null;
}

export interface ProjectionContext {
  observedAt: string;
  environment: string;
  scopeKey: string;
  label: string;
  mode: 'snapshot' | 'live';
  readState?: ReadState;
  readError?: string | null;
}

export interface SavedNativeObservation {
  navigationRef: string;
  evidence: AssessmentTdmsNativeEvidence;
}

/** The parent read supplies authority. This validates saved carriers for display;
 * it never creates a read receipt or decides current source validity. */
export function savedNativeObservations(work: JobAidWorkingObservation['current']): {
  observations: SavedNativeObservation[];
  gaps: string[];
} {
  if (!work?.content) return { observations: [], gaps: [] };
  const candidates = new Map<string, SavedNativeObservation[]>();
  const gaps: string[] = [];
  for (const [index, item] of work.content.evidence.entries()) {
    if (item.kind !== 'TDMS_NATIVE_RECORD') continue;
    try {
      const evidence = parseAssessmentTdmsEvidence(item);
      // Ordinary tuple identity preserves the exact saved revision and receipt.
      const navigationRef = `saved-tdms:${encodeURIComponent(JSON.stringify([
        work.workRevisionRef, evidence.evidenceRef,
        evidence.nativeSource.sourceRevisionRef, evidence.nativeReadReceipt.receiptRef,
      ]))}`;
      const group = candidates.get(navigationRef) ?? [];
      group.push({ navigationRef, evidence });
      candidates.set(navigationRef, group);
    } catch {
      gaps.push(`第 ${index + 1} 条 TDMS 证据的源版本、批准依据或读取回执不完整，未建立读取关系`);
    }
  }
  const observations: SavedNativeObservation[] = [];
  for (const group of candidates.values()) {
    if (group.length !== 1) gaps.push('同一保存证据与回执出现重复，未建立该读取关系');
    else observations.push(group[0]!);
  }
  return { observations, gaps };
}

/** The parent read supplies typed execution observations; legacy status alone stays unassigned. */
export function adaptJobAidWorkingRead(
  read: JobAidWorkingObservation | null,
  context: ProjectionContext,
): RuntimeProjection | null {
  if (!read || !read.enabled) return null;
  if (read.schemaVersion !== 'wiselink.jobaid-working-read.v2' || !read.workItemId?.trim()) {
    throw new Error('JobAid 读模型身份或版本不匹配');
  }
  if (read.current && read.current.workItemId !== read.workItemId) {
    throw new Error('JobAid 保存工作不属于当前 WorkItem');
  }
  const work = read.current;
  const native = savedNativeObservations(work);
  const latest = read.latestAttempt;
  const selected = read.selectedExecution;
  const dynamic = selected?.actionType === 'OPENCLAW_DYNAMIC_EVALUATION' ? selected : null;
  const overallExecution = selected?.actionType === 'OPENCLAW_OVERALL_SYNTHESIS' ? selected : null;
  const researchAttempts: Array<NonNullable<JobAidWorkingObservation['latestAttempt']> |
    NonNullable<JobAidWorkingObservation['selectedExecution']>> = latest ? [latest] : [];
  if (dynamic) {
    if (latest?.attemptId === dynamic.attemptId) researchAttempts[0] = { ...latest, ...dynamic };
    else researchAttempts.unshift(dynamic);
  }
  const researchExecution = dynamic ?? latest;
  const agent: boolean = dynamic?.executionMode === 'PROGRAM_AGENT_V1';
  const program = dynamic?.executionMode === 'PROGRAM_CONTROLLED_V1' || agent;
  const ownWork = work?.actionAttemptId === dynamic?.attemptId ? work : null;
  const stopped = dynamic?.status !== 'SUCCEEDED' && read.activity?.attemptRef === dynamic?.attemptRef
    ? read.activity?.consumerStopped : null;
  const programProgress = program ? dynamic.programProgress : null;
  const programLastProgressAt = program
    ? [programProgress?.observedAt, ownWork?.createdAt, stopped?.observedAt, dynamic.completedAt]
      .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
    : undefined;
  const programState = !program ? null : stopped ? '原请求结果待核'
    : ownWork && read.overallStatus === 'CURRENT' &&
      read.overallBasedOnWorkRevisionRef === ownWork.workRevisionRef
      ? ['RUNNING', 'COMMITTING'].includes(dynamic.status)
        ? '成果已可读，执行仍在收尾' : '工作与综合同版可读'
      : ownWork ? '工作已保存，综合待更新'
        : programProgress?.phase === 'MODEL_RESPONSE_SAVED' ? '已生成，尚未保存'
          : programProgress?.phase === 'MATERIALS_READY' && dynamic.status === 'RUNNING'
            ? '材料已准备，正在综合分析'
            : dynamic.status === 'RUNNING' ? '正在准备本轮材料'
              : '按本次执行记录查看进展';
  const basedOn = read.overallBasedOnWorkRevisionRef;
  const differentWork = !!work && !!basedOn && work.workRevisionRef !== basedOn;
  const research: RuntimeNode = {
    id: 'assessment.research', label: 'JobAid 调查', group: '工程工作', kind: 'task',
    execution: researchExecution ? {label: researchExecution.status, status: researchExecution.status} : '未取得对应尝试',
    artifact: work ? {label: `工作 ${work.workRevision} 已保存`, tone: 'good'} : '尚无已保存工作',
    coverage: read.currentInputChanged ? {label:'Host 标记输入已有变化',tone:'wait'} : 'Host 未标记输入变化',
    coverageScope: '仅当前 JobAid 工作输入；本读模型不提供全部业务来源覆盖',
    business: '工程工作；正式意见另行读取',
    summary: [program
      ? `${agent ? '程序 Agent 评估' : '程序控制评估；本次未启用自主调查'}。${programState}` : '',
      work ? `已保存工作 ${work.workRevision}（请求 ${work.requestId}，尝试 ${work.actionAttemptId}），执行观察另列` : '尚未取得已保存工作'].filter(Boolean).join('。'),
    requestCoverage: dynamic ? '本次读取返回的调查尝试，有限观察' : '仅最新调查尝试，非完整请求集合',
    requestCompleteness: dynamic ? 'partial' : 'latest_only',
    requests: researchAttempts.map(attempt => ({
      id: attempt.attemptId, recordKind:'attempt', status:{label:attempt.status,status:attempt.status},
      artifact: work?.actionAttemptId === attempt.attemptId ? `工作 ${work.workRevision} 已保存` : '未取得此尝试对应的保存结果',
      next: program && attempt.attemptId === dynamic.attemptId
        ? `${programState}；查看本次评估及准确保存工作，该入口不重新生成`
        : `查看复核面板；本次尝试 ${attempt.attemptId}。该入口不定位单条尝试，也不自动重试`,
      navigationLabel: program && attempt.attemptId === dynamic.attemptId ? '查看评估工作' : '查看复核面板',
      ...(program && attempt.attemptId === dynamic.attemptId ? { executionMode: dynamic.executionMode } : {}),
      createdAt: attempt.createdAt,
      startedAt: attempt.startedAt ?? undefined,
      firstSavedAt: latest?.attemptId === attempt.attemptId ? latest.firstSavedAt ?? undefined : undefined,
      completedAt: attempt.completedAt ?? undefined,
      ...(program && attempt.attemptId === dynamic.attemptId && programLastProgressAt
        ? { lastProgressAt: programLastProgressAt } : {}),
    })),
    outputs: work ? [{label:`工作 ${work.workRevision}`,ref:work.workRevisionRef}] : [],
    inputRefs: work ? [{label:'该工作使用的资料版本',ref:work.documentVersionId}, ...native.observations.map(({ navigationRef, evidence }) => ({
      label: `已保存 TDMS 来源 · ${evidence.title} · 回执 ${evidence.nativeReadReceipt.receiptRef}`, ref: navigationRef,
    }))] : [],
  };
  const overall: RuntimeNode = {
    id:'assessment.overall',label:'综合建议',group:'工程工作',kind:'task',
    execution:overallExecution ? {label:overallExecution.status,status:overallExecution.status} : '未取得对应尝试',
    artifact:read.overallStatus === 'NOT_AVAILABLE' ? '尚无综合关系记录' : '已取得综合关系；正文由原入口读取',
    coverage:read.overallStatus === 'CURRENT' ? {label:'Host 判定采用当前工作',tone:'good'}
      : read.overallStatus === 'STALE' ? {label:'Host 判定综合关系需核对',tone:'wait'} : '尚无可比关系',
    business:'本视图未读取正式业务状态',
    coverageScope:'仅工作修订与综合消费关系；不代表全部业务事实已纳入',
    summary:differentWork ? '综合采用另一工作修订；下一步在评估入口核对差额及可用更新操作' : read.overallStatus === 'CURRENT' ? '综合与当前工作修订一致' : '综合关系按 Host 观察显示',
    requestCoverage:overallExecution ? '本次读取返回的综合尝试，有限观察' : '本次读取未提供综合尝试',
    requestCompleteness:overallExecution ? 'partial' : 'not_provided',
    requests:overallExecution ? [{
      id:overallExecution.attemptId,recordKind:'attempt',status:{label:overallExecution.status,status:overallExecution.status},
      artifact:'成果与采用关系另列',
      next:'查看综合面板；该入口不定位单条尝试，也不自动重试',navigationLabel:'查看综合面板',
      createdAt:overallExecution.createdAt,startedAt:overallExecution.startedAt ?? undefined,
      completedAt:overallExecution.completedAt ?? undefined,
    }] : [],outputs:[],inputRefs:basedOn ? [{label:'综合实际采用的工作',ref:basedOn}] : [],
  };
  const companyRecords: RuntimeNode = {
    id: 'business.company_records', label: 'TDMS 公司记录', group: '公司与机队事实', kind: 'fact',
    execution: native.observations.length ? '历史 READ 回执已随工作保存' : '未取得可核对的历史 READ 回执',
    artifact: `${native.observations.length} 条可核对的已保存原生证据`,
    coverage: { label: '当前有效性 UNKNOWN；最新性与完整覆盖未提供', tone: 'wait' },
    business: native.observations.length ? '源声明批准依据随证据保存；本回执未创建工程正式采用，执行未验证'
      : '未取得可核对的来源证据；工程采用与执行情况未提供',
    summary: [work ? `仅工作 ${work.workRevision}（${work.workRevisionRef}）保存的来源证据`
      : '尚无已保存工作可投影来源读取',
      !native.observations.length ? '本次响应没有可核对的原生读取证据，不能据此断言从未读取' : '',
      ...native.gaps].filter(Boolean).join('。'),
    coverageScope: '历史回执对应的精确源观察与字段；父页面读回时间不代表 TDMS 新读取或实时有效',
    requestCoverage: '源读取回执另列，不作为 JobAid 请求或尝试', requestCompleteness: 'not_provided',
    requests: [], outputs: work && native.observations.length ? [{ label: `保存这些证据的工作 ${work.workRevision}`, ref: work.workRevisionRef }] : [],
    inputRefs: native.observations.map(({ navigationRef, evidence }) => ({
      label: `${evidence.title} · ${tdmsSourceVersionLabel(evidence.nativeSource.sourceVersion)} · 历史 READ ${evidence.nativeReadReceipt.readAt} · 回执 ${evidence.nativeReadReceipt.receiptRef}`,
      ref: navigationRef,
    })),
  };
  const reading: RuntimeNode = {
    id: 'surface.reading', label: '工作阅读', group: '知识积累', kind: 'view',
    execution: '使用父页面同一次获权读回',
    artifact: work ? { label: `工作 ${work.workRevision} 正文可读`, tone: 'good' } : '尚无已保存评估',
    coverage: work ? `准确工作修订 ${work.workRevisionRef}` : '尚未取得工作修订',
    business: '工程评估阅读；批准与执行事实分别显示',
    summary: work ? '已保存工作独立可读，不等待综合更新或执行收尾。刷新和下钻只读。'
      : '尚未取得已保存评估，不能据此认定没有工程问题。',
    requestCoverage: '成果读取，不新建评估请求', requestCompleteness: 'not_provided',
    requests: [], outputs: work ? [{ label: `阅读工作 ${work.workRevision}`, ref: work.workRevisionRef }] : [],
    inputRefs: work ? [{ label: '实际读回的工作修订', ref: work.workRevisionRef }] : [],
  };
  const edges: RuntimeEdge[] = native.observations.map(({ navigationRef, evidence }) => ({
    id: navigationRef, templateId: 'company.research',
    from: companyRecords.id, to: research.id, status: 'consumed',
    label: `历史 READ ${evidence.nativeReadReceipt.readAt} · ${tdmsSourceVersionLabel(evidence.nativeSource.sourceVersion)} · 已保存于工作 ${work!.workRevision}`,
    refs: [evidence.nativeSource.sourceRevisionRef, evidence.nativeReadReceipt.receiptRef, evidence.evidenceRef, work!.workRevisionRef],
  }));
  if (basedOn) edges.push({
    id:`${read.workItemId}:overall:consumed:${basedOn}`,templateId:'research.overall',
    from:research.id,to:overall.id,status:work?.workRevisionRef === basedOn ? 'consumed' : 'unknown',
    label:work?.workRevisionRef === basedOn ? '综合实际采用当前工作' : '综合采用其他工作；该工作来源证据未在本次响应中提供',refs:[basedOn],
  });
  if (differentWork && work) edges.push({
    id:`${read.workItemId}:overall:pending:${work.workRevisionRef}`,templateId:'change.work',
    from:research.id,to:overall.id,status:'pending',label:'当前工作尚未纳入该综合',refs:[work.workRevisionRef],
  });
  if (work) edges.push({
    id: `${read.workItemId}:reading:${work.workRevisionRef}`, templateId: 'artifact.reading',
    from: research.id, to: reading.id, status: 'consumed',
    label: '已保存工作经本次获权读回可读', refs: [work.workRevisionRef],
  });
  return {
    schemaVersion:1,
    meta:{mode:context.mode,observedAt:context.observedAt,environment:context.environment,scopeKey:context.scopeKey,
      readState:context.readState,readError:context.readError},
    scope:{id:read.workItemId,label:context.label,model:'WorkItem · 已保存工作与综合关系',kind:'work_item'},
    nodes:[companyRecords,research,overall,reading],edges,
  };
}
