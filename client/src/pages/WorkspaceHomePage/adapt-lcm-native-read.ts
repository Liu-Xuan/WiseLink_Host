import type { LcmMatrixBinding, LcmMatrixResponse } from '@shared/lcm-matrix.interface';
import type { LcmNativeMatrixResponse } from '@shared/lcm-native-matrix.interface';
import type { ProjectionContext } from '../DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read';
import type { NavigationRequest, RuntimeNode, RuntimeProjection } from '../DocumentParsingPage/runtime-monitor/monitor-types';
import { lcmBindingKey } from './lcm-matrix-route';
import { lcmSnapshotStateDate } from './lcm-source-presentation';

export function lcmDiagnosticScopeKey(viewScope: string, binding: LcmMatrixBinding,
  aircraftRef: string | null): string {
  return JSON.stringify([viewScope, lcmBindingKey(binding), aircraftRef]);
}

/** Projects the existing native read and its local view, never inferring fleet completeness or execution. */
export function adaptLcmNativeRead(read: LcmNativeMatrixResponse, matrix: LcmMatrixResponse,
  aircraftRef: string | null, context: ProjectionContext): RuntimeProjection {
  if (lcmBindingKey(read.binding) !== lcmBindingKey(matrix.binding))
    throw new Error('LCM 诊断与当前阅读绑定不一致');
  const aircraft = aircraftRef ? matrix.aircraftIndex.find(item => item.aircraftRef === aircraftRef) : null;
  const selection = aircraftRef ? aircraft ? `当前单机 ${aircraft.tailNumber}` : '所选单机不在当前筛选范围'
    : `当前筛选 ${matrix.aircraftIndex.length} 架飞机、${matrix.softwareIndex.length} 项软件`;
  const snapshots = read.snapshots.map(snapshot => ({
    ref: snapshot.snapshotId,
    label: `已读取快照 ${snapshot.originalFileName} · 状态日 ${lcmSnapshotStateDate(snapshot) ?? '未识别'}（定位本页阅读）`,
  }));
  const outputs = [{ ref: read.binding.readSetRef, label: `定位当前${aircraftRef ? '单机' : '矩阵'}阅读及原有源记录入口` }];
  const configuration: RuntimeNode = {
    id: 'business.software_configuration', label: 'LCM 构型来源', group: '公司与机队事实', kind: 'fact',
    execution: '来源快照；本响应未提供执行记录', artifact: `已读取 ${read.snapshots.length} 个固定快照、${read.matrices.length} 张原生矩阵`,
    coverage: '仅当前获权读取集；完整性未核验',
    coverageScope: '有限快照与原生矩阵范围；不能据此推算全机队覆盖或来源实时状态',
    business: '来源候选；未实时核验，未形成正式采用',
    summary: `${selection}。沿用原生矩阵定义与原值；实装、允装、来源空白和未知分别展示。`,
    requestCoverage: '来源读取不提供业务请求或尝试集合', requestCompleteness: 'not_provided',
    requests: [], outputs, inputRefs: snapshots,
  };
  const reading: RuntimeNode = {
    id: 'surface.reading', label: aircraftRef ? '当前单机构型阅读' : '当前构型矩阵阅读', group: '阅读交付', kind: 'view',
    execution: '本地视图；无独立执行', artifact: selection,
    coverage: '使用同一准确读取集与权限绑定', coverageScope: '本地筛选、排序和视口不扩大 Host 获权来源范围',
    business: matrix.sourceMode === 'CANDIDATE' ? '候选阅读；不推导 AEO 实施或正式采用' : '业务采用状态未提供',
    summary: '本图仅记录快照读取集到当前阅读视图的关系；源记录继续由原矩阵或单机入口核对。',
    requestCoverage: '当前响应未提供请求时序、首次可读或 ACK 时间', requestCompleteness: 'not_provided',
    requests: [], outputs, inputRefs: [{ ref: read.binding.readSetRef, label: '当前获权读取集（定位本页阅读）' }],
  };
  return {
    schemaVersion: 1,
    meta: { mode: context.mode, observedAt: context.observedAt, environment: context.environment,
      scopeKey: context.scopeKey, readState: context.readState, readError: context.readError },
    scope: { id: read.binding.readSetRef, label: context.label, model: 'LCM · 已读取来源快照候选' },
    nodes: [configuration, reading],
    edges: [{ id: `${read.binding.readSetRef}:reading`, templateId: 'artifact.reading',
      from: configuration.id, to: reading.id, status: 'consumed',
      label: '当前本地阅读使用同一获权快照读取集', refs: [read.binding.readSetRef] }],
  };
}

/** Only focus the current authorized reading surface; no arbitrary ref can change scope or start work. */
export function lcmDiagnosticCanOpenReading(detail: NavigationRequest, runtime: RuntimeProjection,
  read: LcmNativeMatrixResponse, currentScopeKey: string): boolean {
  if (detail.scopeKey !== currentScopeKey || runtime.meta.scopeKey !== currentScopeKey ||
    runtime.scope.id !== read.binding.readSetRef || (detail.subjectRef && detail.subjectRef !== read.binding.readSetRef) ||
    detail.kind === 'request') return false;
  const node = runtime.nodes.find(item => item.id === detail.nodeId);
  const references = detail.kind === 'artifact' ? node?.outputs : detail.kind === 'source' ? node?.inputRefs : null;
  return Boolean(references?.some(item => item.ref === detail.ref) &&
    (detail.ref === read.binding.readSetRef || read.snapshots.some(item => item.snapshotId === detail.ref)));
}
