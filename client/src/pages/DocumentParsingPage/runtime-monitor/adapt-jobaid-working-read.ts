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
  } | null;
  latestAttempt: { attemptId: string; status: string; inputRevision: number | null; createdAt?: string; startedAt?: string | null; firstSavedAt?: string | null; completedAt?: string | null } | null;
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

/** Pure WorkItem adapter. executionStatus lacks actionType and is not assigned to a node. */
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
  const latest = read.latestAttempt;
  const basedOn = read.overallBasedOnWorkRevisionRef;
  const differentWork = !!work && !!basedOn && work.workRevisionRef !== basedOn;
  const research: RuntimeNode = {
    id: 'assessment.research', label: 'JobAid 调查', group: '工程工作', kind: 'task',
    execution: latest ? {label: latest.status, status: latest.status} : '未取得对应尝试',
    artifact: work ? {label: `工作 ${work.workRevision} 已保存`, tone: 'good'} : '尚无已保存工作',
    coverage: read.currentInputChanged ? {label:'Host 标记输入已有变化',tone:'wait'} : 'Host 未标记输入变化',
    coverageScope: '仅当前 JobAid 工作输入；本读模型不提供全部业务来源覆盖',
    business: '工程工作；正式意见另行读取',
    summary: work ? `已保存工作 ${work.workRevision}（请求 ${work.requestId}，尝试 ${work.actionAttemptId}），执行观察另列` : '尚未取得已保存工作',
    requestCoverage: '仅最新调查尝试，非完整请求集合',
    requestCompleteness: 'latest_only',
    requests: latest ? [{
      id: latest.attemptId, recordKind:'attempt', status:{label:latest.status,status:latest.status},
      artifact: work?.actionAttemptId === latest.attemptId ? `工作 ${work.workRevision} 已保存` : '未取得此尝试对应的保存结果',
      next: `查看复核面板；本次尝试 ${latest.attemptId}。该入口不定位单条尝试，也不自动重试`,
      navigationLabel: '查看复核面板',
      createdAt: latest.createdAt,
      startedAt: latest.startedAt ?? undefined,
      firstSavedAt: latest.firstSavedAt ?? undefined,
      completedAt: latest.completedAt ?? undefined,
    }] : [],
    outputs: work ? [{label:`工作 ${work.workRevision}`,ref:work.workRevisionRef}] : [],
    inputRefs: work ? [{label:'该工作使用的资料版本',ref:work.documentVersionId}] : [],
  };
  const overall: RuntimeNode = {
    id:'assessment.overall',label:'综合建议',group:'工程工作',kind:'task',
    execution:'未取得对应尝试',
    artifact:read.overallStatus === 'NOT_AVAILABLE' ? '尚无综合关系记录' : '已取得综合关系；正文由原入口读取',
    coverage:read.overallStatus === 'CURRENT' ? {label:'Host 判定采用当前工作',tone:'good'}
      : read.overallStatus === 'STALE' ? {label:'Host 判定综合关系需核对',tone:'wait'} : '尚无可比关系',
    business:'本视图未读取正式业务状态',
    coverageScope:'仅工作修订与综合消费关系；不代表全部业务事实已纳入',
    summary:differentWork ? '综合采用另一工作修订；下一步在评估入口核对差额及可用更新操作' : read.overallStatus === 'CURRENT' ? '综合与当前工作修订一致' : '综合关系按 Host 观察显示',
    requestCoverage:'此读模型不提供 Overall 尝试集合',
    requestCompleteness:'not_provided',
    requests:[],outputs:[],inputRefs:basedOn ? [{label:'综合实际采用的工作',ref:basedOn}] : [],
  };
  const edges: RuntimeEdge[] = [];
  if (basedOn) edges.push({
    id:`${read.workItemId}:overall:consumed:${basedOn}`,templateId:'research.overall',
    from:research.id,to:overall.id,status:'consumed',label:'综合实际采用的工作',refs:[basedOn],
  });
  if (differentWork && work) edges.push({
    id:`${read.workItemId}:overall:pending:${work.workRevisionRef}`,templateId:'change.work',
    from:research.id,to:overall.id,status:'pending',label:'当前工作尚未纳入该综合',refs:[work.workRevisionRef],
  });
  return {
    schemaVersion:1,
    meta:{mode:context.mode,observedAt:context.observedAt,environment:context.environment,scopeKey:context.scopeKey,
      readState:context.readState,readError:context.readError},
    scope:{id:read.workItemId,label:context.label,model:'WorkItem · 已保存工作与综合关系',kind:'work_item'},
    nodes:[research,overall],edges,
  };
}
