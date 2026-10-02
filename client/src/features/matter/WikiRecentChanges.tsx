import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewConversationReadModel } from '@shared/api.interface';
import type { DocumentActivityReadingResponse } from '@shared/document-activity.interface';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import {
  getCanonicalHostClientSessionGeneration, getCurrentReviewConversation,
  readDocumentActivityReading, readDocumentParsingStatus,
} from '@client/src/api/canonical-host';
import { assertReviewConversationScope } from '@client/src/features/review/review-scope';
import DocumentActivityTimelineView from '@client/src/features/trinity/DocumentActivityTimelineView';
import type { ActivityTimelineWindow } from '@client/src/features/trinity/document-activity-timeline';
import { loadActivityEntry, validateActivityEntry } from '@client/src/pages/DocumentParsingPage/document-activity-entry';
import {
  buildWikiRecentChanges, wikiSourceBlocker, wikiWorkIdentity,
  type WikiSavedWork, type WikiTimelineSource, type WikiWorkMode,
} from './wiki-recent-changes';

export interface WikiRecentChangesProps {
  work: WikiSavedWork | null;
  mode: WikiWorkMode;
  /** Generation captured by the parent when it authorized the supplied work/sources. */
  authorizedSessionGeneration: number;
  reviewWorkItemId?: string | null;
  sources?: readonly WikiTimelineSource[];
  onOpenWork?: () => void;
}

const NO_SOURCES: readonly WikiTimelineSource[] = [];
const accessDenied = (error: unknown): boolean => !!error && typeof error === 'object' &&
  'statusCode' in error && [401, 403, 404].includes(Number(error.statusCode));

/** A Wiki embedding of existing Host reads; no production command or model call. */
export default function WikiRecentChanges(props: WikiRecentChangesProps) {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  if (authenticationRequired || sessionGeneration !== props.authorizedSessionGeneration)
    return <section aria-label="本工作实际变化"><h2>本工作实际变化</h2>
      <p role="status">请登录并重新读取该工作；当前登录下尚无可显示的授权记录。</p></section>;
  return <AuthorizedChanges key={JSON.stringify([sessionGeneration, props.mode,
    props.work ? wikiWorkIdentity(props.work) : null, props.reviewWorkItemId])} {...props} />;
}

function AuthorizedChanges({ work, mode, authorizedSessionGeneration, reviewWorkItemId,
  sources = NO_SOURCES, onOpenWork }: WikiRecentChangesProps) {
  const [conversation, setConversation] = useState<ReviewConversationReadModel | null>(null);
  const [reviewStatus, setReviewStatus] = useState('');
  const [blocked, setBlocked] = useState(false);
  const denyAccess = useCallback(() => setBlocked(true), []);
  const epoch = useRef(0);
  const workItemId = work?.kind === 'WORK_ITEM' ? work.revision.workItemId : reviewWorkItemId;
  const matterId = work?.kind === 'ENGINEERING_MATTER' ? work.revision.matterId : null;
  const hasWork = Boolean(work);
  useEffect(() => {
    if (mode !== 'CURRENT' || !hasWork || !workItemId) return;
    const ticket = ++epoch.current;
    let cancelled = false;
    const current = () => !cancelled && ticket === epoch.current &&
      authorizedSessionGeneration === getCanonicalHostClientSessionGeneration();
    setReviewStatus('正在读取当前讨论的保存回执…');
    const scope = matterId ? { kind: 'ENGINEERING_MATTER' as const, matterId }
      : { kind: 'WORK_ITEM' as const };
    void getCurrentReviewConversation(workItemId, scope).then(response => {
      if (!current()) return;
      assertReviewConversationScope(response.conversation, workItemId, scope);
      setConversation(response.conversation);
      setReviewStatus('仅核对当前账号、当前讨论中与此工作匹配的回执。');
    }).catch(error => {
      if (!current()) return;
      setConversation(null);
      if (accessDenied(error) || (error instanceof Error && error.message === 'REVIEW_CONVERSATION_OBJECT_NOT_FOUND')) {
        setBlocked(true);
      } else setReviewStatus('当前讨论回执读取失败；没有把回复或失败尝试算作工作变化。');
    });
    return () => { cancelled = true; epoch.current++; };
  }, [authorizedSessionGeneration, hasWork, matterId, mode, workItemId]);

  if (blocked) return <section aria-label="本工作实际变化"><h2>本工作实际变化</h2>
    <p role="alert">该工作或其来源的访问已失效，请重新读取；已停止展示保存记录。</p></section>;
  const model = buildWikiRecentChanges(work, mode, conversation);
  return <section className="space-y-4 border-t border-border pt-4" aria-label="本工作实际变化">
    <header><h2 className="text-base font-semibold">本工作实际变化</h2>
      <p className="text-xs leading-6 text-muted-foreground">只显示当前或选定工作的持久保存记录，覆盖范围不是全部历史。候选保存不代表正式采用或工程执行。</p></header>
    <ol className="space-y-4">
      {model.events.map(event => <li key={event.id} data-work-ref={event.workRef}>
        <strong>{event.updateLabel} · 工作修订 {event.revision}</strong>
        <p className="whitespace-pre-wrap text-sm leading-7">{event.changeSummary || '该工作未提供变化说明。'}</p>
        <p className="text-xs text-muted-foreground">工作保存时间：{event.savedAt ?? '未提供'}（不作为工程事件发生时间）</p>
        {event.receipts.map(receipt => <p key={receipt.reviewTurnId} className="text-xs text-muted-foreground"
          data-review-turn={receipt.reviewTurnId}>Review 回执完成时间：{receipt.completedAt ?? '未提供'}；确切工作保存已匹配。</p>)}
        <details><summary className="text-xs">查看记录来源与版本</summary>
          <p className="break-all text-xs">{event.subjectKind} · {event.subjectId} · {event.workRef} / r{event.revision}</p>
          <p className="break-all text-xs">文档版本：{event.documentVersionIds.join('、') || '未提供'}</p>
          <p className="break-all text-xs">保存尝试 ID：{event.actionAttemptId ?? '未提供'}；来源 Review：{event.sourceReviewTurnId ?? '未提供'}</p>
          {event.receipts.map(receipt => <p key={receipt.reviewTurnId} className="break-all text-xs">Review 操作引用：{receipt.operationRef}</p>)}
        </details>
      </li>)}
    </ol>
    {!model.events.length ? <p role="status">当前没有可核对的已保存工作，不用示例补齐。</p> : null}
    {reviewStatus ? <p role="status" className="text-xs text-muted-foreground">{reviewStatus}</p> : null}
    {model.receiptNotice ? <p className="text-xs text-muted-foreground">{model.receiptNotice}</p> : null}
    {onOpenWork && model.events.length ? <button type="button" onClick={onOpenWork}>定位该工作</button> : null}
    <SourceDeclarations mode={mode} sources={sources} sessionGeneration={authorizedSessionGeneration}
      onAccessDenied={denyAccess} />
  </section>;
}

function SourceDeclarations({ mode, sources, sessionGeneration, onAccessDenied }: {
  mode: WikiWorkMode; sources: readonly WikiTimelineSource[]; sessionGeneration: number;
  onAccessDenied: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('');
  const source = sources.find(item => JSON.stringify([item.documentVersionId, item.parseRunId,
    item.candidateRevision, item.runRef]) === selected);
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>来源活动解释候选</summary>
    <p className="text-xs leading-6 text-muted-foreground">原文声明与本工作实际保存分开阅读；计划、Target、TBD 不代表实际执行。请选择已登记的准确文档版本。</p>
    <p className="text-xs text-muted-foreground">当前来源声明候选可来自较新的解析或候选版本，不表示本工作当时使用或采用了这些内容。</p>
    <p className="text-xs text-muted-foreground">当前来源合同只提供资料声明；工程执行、运行观察与认识更新泳道尚无实际记录接入。</p>
    <label>登记来源 <select aria-label="时间声明来源" value={source ? selected : ''}
      onChange={event => setSelected(event.target.value)}>
      <option value="">请选择来源</option>
      {sources.map(item => { const key = JSON.stringify([item.documentVersionId, item.parseRunId,
        item.candidateRevision, item.runRef]); return <option key={key} value={key}>{item.label}</option>; })}
    </select></label>
    {mode === 'HISTORICAL' ? <p role="status">该历史工作未提供可核对归属的来源活动候选绑定；不会读取最新候选。</p>
      : !sources.length ? <p role="status">没有已授权登记来源可供选择。</p>
        : expanded && source ? <SourceReading key={selected} source={source} mode={mode}
          sessionGeneration={sessionGeneration} onAccessDenied={onAccessDenied} /> : null}
  </details>;
}

function SourceReading({ source, mode, sessionGeneration, onAccessDenied }: {
  source: WikiTimelineSource; mode: WikiWorkMode; sessionGeneration: number; onAccessDenied: () => void;
}) {
  const [reading, setReading] = useState<DocumentActivityReadingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStatement, setSelectedStatement] = useState<string | null>(null);
  const [window, setWindow] = useState<ActivityTimelineWindow>('all');
  const epoch = useRef(0);
  const { documentVersionId, parseRunId, candidateRevision, runRef } = source;
  useEffect(() => {
    const controller = new AbortController();
    const ticket = ++epoch.current;
    const current = () => !controller.signal.aborted && epoch.current === ticket &&
      sessionGeneration === getCanonicalHostClientSessionGeneration();
    const blocker = wikiSourceBlocker(mode, { label: '', documentVersionId });
    const query = new URLSearchParams();
    if (parseRunId !== undefined && parseRunId !== null) query.set('parseRunId', parseRunId);
    if (candidateRevision !== undefined) query.set('candidateRevision', String(candidateRevision));
    if (runRef !== undefined) query.set('runRef', runRef);
    setReading(null); setError(null); setLoading(true);
    if (blocker) { setError(blocker); setLoading(false); return () => controller.abort(); }
    void loadActivityEntry({ documentVersionId,
      entry: validateActivityEntry(query), baseParams: query,
      deps: { readParsingStatus: readDocumentParsingStatus, readActivityReading: readDocumentActivityReading },
      signal: controller.signal, current,
    }).then(result => {
      if (!current()) return;
      setReading(result.reading); setError(result.error ?? result.unreadable);
    }).catch(reason => {
      if (!current()) return;
      setReading(null);
      if (accessDenied(reason)) onAccessDenied();
      else setError(reason instanceof Error ? reason.message : '来源时间声明读取失败。');
    }).finally(() => { if (current()) setLoading(false); });
    return () => { controller.abort(); epoch.current++; };
  }, [candidateRevision, documentVersionId, mode, onAccessDenied, parseRunId, runRef, sessionGeneration]);
  const route = (statementId: string, anchorId?: string): string | null => {
    if (!reading?.candidate) return null;
    const query = new URLSearchParams({ documentVersionId: reading.binding.documentVersionId,
      parseRunId: reading.binding.parseRunId, candidateRevision: String(reading.candidate.candidateRevision),
      runRef: reading.candidate.runRef, statementId, window });
    if (anchorId) query.set('anchor', anchorId);
    return `/document-versions/${encodeURIComponent(reading.binding.documentVersionId)}/activities?${query}`;
  };
  const open = (statementId: string, anchorId?: string) => {
    const target = route(statementId, anchorId);
    if (target) globalThis.location.assign(target);
  };
  return <div className="mt-4"><DocumentActivityTimelineView reading={reading}
    selectedStatementId={selectedStatement} onSelectStatement={setSelectedStatement}
    onOpenReading={open} onOpenAnchor={open} loading={loading} error={error}
    hasExactSource={Boolean(source.parseRunId || reading)} window={window} onWindowChange={setWindow} />
    {reading?.candidate ? <a href={`/timeline?${new URLSearchParams({ documentVersionId: reading.binding.documentVersionId,
      parseRunId: reading.binding.parseRunId, candidateRevision: String(reading.candidate.candidateRevision),
      runRef: reading.candidate.runRef, window })}`}>打开独立时间轴</a> : null}</div>;
}
