import type { HierarchicalWikiStatus } from '@shared/hierarchical-wiki.interface';
import type { ProjectionContext } from '@client/src/pages/DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read';
import type { NavigationRequest, RuntimeNode, RuntimeProjection } from '@client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';
import { summaryMemberRoute, summaryMemberSavedRef, summaryMemberVersionLabel } from './summary-selection';
import { wikiSavedReadingRoute, wikiStatusLabels } from './hierarchical-wiki-presentation';

/** Only the parent directory's authorized snapshot is projected; no reads or transitions. */
export function adaptHierarchicalWikiStatus(
  read: HierarchicalWikiStatus,
  summaryId: string,
  context: ProjectionContext,
): RuntimeProjection {
  if (!summaryId.trim() || read.summaryId !== summaryId)
    throw new Error('Wiki 观察与当前范围不一致');
  const active = read.activeRequest;
  const hasCoverage = read.coveredMembers.length > 0 || read.completedGeneration > 0;
  const saved = read.savedRevision;
  const output = saved
    ? [{ label: `阅读保存修订 ${saved.revision}（重新核对正文与权限）`, ref: saved.summaryRef }]
    : read.savedRevision === undefined && hasCoverage
      ? [{ label: '阅读当前已保存 Wiki（重新核对版本）', ref: summaryId }] : [];
  const wait = read.waiting.map(item => `${item.kind} ${item.subjectId}：${item.status}`).join('；');
  const wiki: RuntimeNode = {
    id: 'knowledge.wiki', label: '本范围 Wiki 更新', group: '知识积累', kind: 'task',
    execution: active ? { label: active.status, status: active.status } : '当前目录未提供活跃执行',
    artifact: `Host 已报告覆盖 ${read.coveredMembers.length} 个保存成员`,
    coverage: { label: wikiStatusLabels[read.state], status: read.state },
    coverageScope: '仅本人已归类且获权的 Host 材料；发行方最新性未知。覆盖成员不是全部待纳入成员。',
    business: `分析候选；自动更新${read.enabled ? '已启用' : '已暂停'}`,
    summary: `目标代次 ${read.desiredGeneration}，完成代次 ${read.completedGeneration}；${read.inventoryComplete ? '本次资料盘点完成' : '资料盘点进行中'}。首次待更新 ${read.firstDirtyAt ?? '未提供'}；计划处理时间 ${read.dueAt ?? '未提供'}。${wait ? `等待：${wait}。` : '目录未列等待项。'}${read.errorCode ? `更新未完成：${read.errorCode}。` : ''}`,
    sourceObservedAt: read.lastCheckedAt ?? undefined,
    requestCompleteness: active ? 'partial' : 'not_provided',
    requestCoverage: '仅目录返回的活跃预留；完整请求历史未提供，等待项不推导成执行请求',
    requests: active ? [{
      id: active.requestId, recordKind: 'request', subjectRef: summaryId,
      status: { label: active.status, status: active.status },
      artifact: '本目录未提供该请求的保存修订',
      next: `尝试 ${active.attemptRef}；认领次数 ${active.claimCount ?? '未知'}。在原阅读页核对本次进度及保存版本。`,
      navigationLabel: '查看本次 Wiki 请求', waitingReason: wait || undefined,
    }] : [],
    outputs: output,
    inputRefs: read.coveredMembers.map(member => ({
      label: `已覆盖成员 · ${summaryMemberVersionLabel(member)}`,
      ref: summaryMemberSavedRef(member),
    })),
  };
  const reading: RuntimeNode = {
    id: 'surface.reading', label: '已保存 Wiki 阅读', group: '阅读交付', kind: 'view',
    execution: '阅读入口；本目录未读取正文',
    artifact: saved ? `已定位保存修订 ${saved.revision}；本目录未读取正文`
      : hasCoverage ? '已有覆盖记录；正文及保存版本由阅读页核对' : '目录尚未报告保存成员覆盖',
    coverage: saved ? `保存修订 ${saved.revision}；正文未读取` : '当前正文修订未在目录返回',
    coverageScope: '打开原阅读页后重新核对获权保存正文和成员',
    business: '辅助阅读候选；正式采用另行处理',
    summary: saved ? '入口固定到本次目录观察的保存引用；更新执行、覆盖代次与保存修订分别表达，正文消费尚未核对。'
      : '入口使用本范围 summaryId；当前目录没有 summaryRef，不能据此认定确切正文消费关系。',
    requestCompleteness: 'not_provided', requestCoverage: '阅读入口不创建更新请求',
    requests: [], outputs: output, inputRefs: [],
  };
  return {
    schemaVersion: 1,
    meta: { mode: context.mode, observedAt: context.observedAt, environment: context.environment,
      scopeKey: context.scopeKey, readState: context.readState, readError: context.readError },
    scope: { id: summaryId, label: context.label, model: `分层 Wiki · ${read.scope.kind}` },
    nodes: [wiki, reading],
    edges: [{ id: `${summaryId}:reading`, templateId: 'artifact.reading', from: wiki.id, to: reading.id,
      status: 'unknown', label: saved ? `已定位保存修订 ${saved.revision}；正文未在目录读取`
        : '当前保存正文由原阅读入口核对；确切修订未返回', refs: [saved?.summaryRef ?? summaryId] }],
  };
}

/** Navigate only references still present in this scope's current authorized snapshot. */
export function wikiDiagnosticRoute(
  detail: NavigationRequest,
  runtime: RuntimeProjection,
  read: HierarchicalWikiStatus,
): string | null {
  if (detail.scopeKey !== runtime.meta.scopeKey || runtime.scope.id !== read.summaryId ||
    (detail.subjectRef && detail.subjectRef !== read.summaryId)) return null;
  const node = runtime.nodes.find(item => item.id === detail.nodeId);
  if (!node) return null;
  const route = `/summaries/${encodeURIComponent(read.summaryId)}`;
  if (detail.kind === 'request') {
    const active = read.activeRequest;
    return active && detail.recordKind === 'request' && !detail.attemptId &&
      detail.requestId === active.requestId && detail.ref === active.requestId &&
      node.requests.some(request => request.recordKind === 'request' && request.id === active.requestId)
      ? `${route}?${new URLSearchParams({ attemptRef: active.attemptRef })}` : null;
  }
  if (detail.kind === 'artifact')
    return detail.ref === (read.savedRevision?.summaryRef ??
      (read.savedRevision === undefined ? read.summaryId : null)) &&
      node.outputs.some(item => item.ref === detail.ref) ? wikiSavedReadingRoute(read) : null;
  if (detail.kind !== 'source' || !node.inputRefs.some(item => item.ref === detail.ref)) return null;
  const member = read.coveredMembers.find(item => summaryMemberSavedRef(item) === detail.ref);
  return member ? summaryMemberRoute(member) : null;
}
