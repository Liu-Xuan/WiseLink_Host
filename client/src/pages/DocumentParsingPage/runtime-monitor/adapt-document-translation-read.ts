import type { DocumentTranslationReadingResponse } from '@shared/document-translation-reading.interface';
import type { NavigationRequest, RuntimeProjection, RuntimeNode } from './monitor-types';
import type { ProjectionContext } from './adapt-jobaid-working-read';

/** The existing authorized reading response is the only input; this view performs no reads. */
export function adaptDocumentTranslationRead(
  read: DocumentTranslationReadingResponse | null,
  documentVersionId: string,
  parseRunId: string,
  context: ProjectionContext,
): RuntimeProjection | null {
  if (!read) return null;
  if (read.documentVersionId !== documentVersionId || read.parseRunId !== parseRunId)
    throw new Error('译文观察与当前文档解析版本不一致');
  const semantic = read.translation.status === 'SEMANTIC_READING_AID_AVAILABLE' ? read.translation.reading : null;
  if (semantic && semantic.source.documentVersionId !== documentVersionId)
    throw new Error('译文成果来源与当前文档版本不一致');
  if (semantic?.source.originalBinding && semantic.source.originalBinding.parseRunId !== parseRunId)
    throw new Error('译文成果来源与当前解析版本不一致');
  const selected = semantic?.blocks.filter(block => block.readingStatus === 'READABLE' &&
    block.selected?.selectedForReading) ?? [];
  const outputs = selected.map(block => ({ label: `已选译文块 ${block.source.order + 1}`, ref: block.selected!.blockRevisionId }));
  const coverage = semantic?.coverage;
  const translation: RuntimeNode = {
    id: 'document.translation', label: '文档翻译', group: '阅读交付', kind: 'task',
    execution: read.execution ? { label: read.execution.status, status: read.execution.status } : '未取得对应执行',
    artifact: semantic ? `已选可读块 ${selected.length}；保存字数 ${coverage!.savedSourceCharacters}` : '本响应未提供语义块成果',
    coverage: semantic ? { label: `${semantic.completeness} · 可读 ${coverage!.readableSourceCharacters}/${coverage!.registeredSourceCharacters} 原文字数`,
      tone: semantic.completeness === 'COMPLETE' ? 'good' : 'wait' } : read.translation.status,
    coverageScope: '仅该解析版本的翻译计划；不代表工程调查、批准或适用范围',
    business: '辅助阅读候选；非正式批准',
    summary: semantic ? `缺块 ${coverage!.missingBlockCount}；待检查 ${coverage!.pendingCheckBlockCount}；阻塞 ${coverage!.blockedBlockCount}；未解析原文单元 ${coverage!.unresolvedSourceUnitCount}。执行结束与覆盖分别显示。`
      : '本视图未取得块检查和选用清单；请按当前阅读状态核对。',
    requestCompleteness: read.execution?.attemptId ? 'latest_only' : 'not_provided',
    requestCoverage: read.execution?.attemptId ? '仅本人在此解析版本的最新尝试；不是完整请求集合' : '当前响应未提供请求/尝试身份',
    requests: read.execution?.attemptId ? [{ id: read.execution.attemptId, recordKind: 'attempt',
      status: { label: read.execution.status, status: read.execution.status },
      artifact: `${selected.filter(block => block.selected?.provenance.originAttemptId === read.execution!.attemptId).length} 个当前选用块来自此尝试；其他块可沿用前序成果`,
      next: '查看本版译文续接入口；该入口会重新核对当前尝试，打开不会启动翻译', navigationLabel: '查看译文续接',
      createdAt: read.execution.createdAt, startedAt: read.execution.startedAt ?? undefined,
      completedAt: read.execution.completedAt ?? undefined,
    }] : [], outputs, inputRefs: [],
  };
  const reading: RuntimeNode = {
    id: 'surface.reading', label: '已保存中文阅读', group: '阅读交付', kind: 'view',
    execution: '读取视图，无独立执行', artifact: selected.length ? `${selected.length} 个已选块可定位` : '未取得可定位的语义块',
    coverage: semantic ? semantic.completeness : '语义块范围未提供', coverageScope: '仅本次实际返回并选为可读的块修订',
    business: '复用 Host 选用结果', summary: '点击已选块可定位同一保存修订；未检查或阻塞块不作为可读成果。',
    requestCompleteness: 'not_provided', requestCoverage: '读取不创建业务请求', requests: [], outputs: [], inputRefs: outputs,
  };
  return {
    schemaVersion: 1,
    meta: { mode: context.mode, observedAt: context.observedAt, environment: context.environment,
      scopeKey: context.scopeKey, readState: context.readState, readError: context.readError },
    scope: { id: documentVersionId, label: context.label, model: `文档翻译 · 解析 ${parseRunId}`, kind: 'document' },
    nodes: [translation, reading],
    edges: selected.length ? [{ id: `${semantic!.workspaceId}:${semantic!.rowVersion}:reading`, templateId: 'artifact.reading',
      from: translation.id, to: reading.id, status: 'consumed', label: '本次阅读实际选用的块修订', refs: outputs.map(item => item.ref) }] : [],
  };
}

/** Reject a stale/replaced block even if the enclosing document and scope still match. */
export function translationDiagnosticRevision(detail: NavigationRequest, runtime: RuntimeProjection): string | null {
  if (detail.scopeKey !== runtime.meta.scopeKey || (detail.subjectRef && detail.subjectRef !== runtime.scope.id)) return null;
  const node = runtime.nodes.find(item => item.id === detail.nodeId);
  const refs = detail.kind === 'artifact' ? node?.outputs : detail.kind === 'source' ? node?.inputRefs : null;
  return refs?.some(item => item.ref === detail.ref) ? detail.ref! : null;
}

export function translationDiagnosticAttempt(detail: NavigationRequest, runtime: RuntimeProjection): boolean {
  return detail.kind === 'request' && detail.scopeKey === runtime.meta.scopeKey &&
    (!detail.subjectRef || detail.subjectRef === runtime.scope.id) && detail.recordKind === 'attempt' &&
    !detail.requestId && detail.attemptId === detail.ref && runtime.nodes.some(node => node.id === detail.nodeId &&
      node.requests.some(request => request.recordKind === 'attempt' && request.id === detail.attemptId));
}
