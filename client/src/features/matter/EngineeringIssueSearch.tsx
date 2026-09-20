import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  searchEngineeringIssues,
  searchDocumentSources,
  readEngineeringIssue,
  referenceEngineeringIssue,
  readEngineeringIssueReferenceStatus,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';
import { getEngineeringMatterWorkspace } from '@client/src/api/engineering-matter';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { JobAidIssueArticle } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';
import type {
  EngineeringIssueRead,
  EngineeringIssueSearchResponse,
  EngineeringIssueReferenceRequest,
  EngineeringIssueReferenceReceipt,
  EngineeringIssueReferenceStatus,
} from '@shared/engineering-issue-search.interface';
import MatterDocumentSourceDialog from './MatterDocumentSourceDialog';
import ReferenceWorkNotices from './ReferenceWorkNotices';
import OverviewCorrectionNotices from './OverviewCorrectionNotices';
import OverviewSourceWork from './OverviewSourceWork';
import { exactDocumentSourceRoute, matterDocumentRoute } from './matter-navigation';
import {
  engineeringIssueReadingParams,
  readEngineeringIssueReadingState,
  type EngineeringIssueReadingState,
} from './engineering-issue-reading';
import type { DocumentSourceSearchResponse } from '@shared/document-source-search.interface';
import '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css';

type EngineeringIssueSearchProps =
  | { readOnly: true; matterId?: never; presentation?: 'search' | 'catalog' }
  | { readOnly?: false; matterId: string; presentation?: 'search' };

export default function EngineeringIssueSearch({
  matterId = '',
  readOnly: requestedReadOnly = false,
  presentation = 'search',
}: EngineeringIssueSearchProps) {
  const readOnly = requestedReadOnly || !matterId;
  const catalog = readOnly && presentation === 'catalog';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const issueReading = useMemo(
    () => readEngineeringIssueReadingState(params),
    [params],
  );
  const restored = issueReading.state === 'ok' ? issueReading.value : null;
  const referenceAttemptRef = readOnly ? null : params.get('referenceAttemptRef');
  const legacySourceWorkRef = readOnly ? null : params.get('sourceWorkRef');
  const legacySourceIssueKey = readOnly ? null : params.get('sourceIssueKey');
  const hasModernIssueState = [
    'issueSearchQuery',
    'issueSearchScope',
    'issueSubjectKind',
    'issueSubjectId',
    'issueWorkRef',
    'issueKey',
  ].some((key) => params.has(key));
  const sourceIdentity = readOnly
    ? null
    : restored?.selected ?? (
      !hasModernIssueState
        && legacySourceWorkRef
        && legacySourceIssueKey
        ? {
            subjectKind: 'ENGINEERING_MATTER' as const,
            subjectId: matterId,
            workRef: legacySourceWorkRef,
            issueKey: legacySourceIssueKey,
          }
        : null
    );
  const [query, setQuery] = useState(restored?.query ?? '');
  const [scope, setScope] = useState<'CURRENT' | 'HISTORY'>(
    restored?.scope ?? 'CURRENT',
  );
  const [results, setResults] = useState<EngineeringIssueSearchResponse | null>(
    null,
  );
  const [selected, setSelected] = useState<EngineeringIssueRead | null>(null);
  const [originals, setOriginals] = useState<DocumentSourceSearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('');
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceReceipt, setReferenceReceipt] = useState<EngineeringIssueReferenceReceipt | null>(null);
  const [referenceStatus, setReferenceStatus] = useState<EngineeringIssueReferenceStatus | null>(null);
  const [referenceStatusBusy, setReferenceStatusBusy] = useState(false);
  const statusEpoch = useRef(0);
  const pendingReference = useRef<EngineeringIssueReferenceRequest | null>(null);
  const [source, setSource] = useState<{
    documentVersionId: string;
    sourceRef: string | null;
  } | null>(null);
  const epoch = useRef(0);
  const issueReadEpoch = useRef(0);
  const automaticIssueIdentity = useRef('');
  const restoredRef = useRef(restored);
  restoredRef.current = restored;
  useEffect(() => {
    const clear = () => {
      epoch.current += 1; issueReadEpoch.current += 1;
      statusEpoch.current += 1;
      automaticIssueIdentity.current = '';
      setQuery(restoredRef.current?.query ?? '');
      setScope(restoredRef.current?.scope ?? 'CURRENT');
      setResults(null); setOriginals(null); setSelected(null); setSource(null);
      setError(null); setBusy(false); setPurpose(''); setReferenceReceipt(null); setReferenceStatus(null);
      setReferenceBusy(false); setReferenceStatusBusy(false); pendingReference.current = null;
    };
    clear();
    const unsubscribe = subscribeCanonicalHostClientSession(clear);
    return () => {
      epoch.current += 1;
      issueReadEpoch.current += 1;
      statusEpoch.current += 1;
      unsubscribe();
    };
  }, [matterId, readOnly]);
  useEffect(() => {
    const generation = ++statusEpoch.current;
    setReferenceStatus(null);
    if (!referenceAttemptRef) { setReferenceStatusBusy(false); return; }
    setReferenceStatusBusy(true);
    void readEngineeringIssueReferenceStatus(matterId, referenceAttemptRef).then(value => {
      if (generation === statusEpoch.current) setReferenceStatus(value);
    }).catch((cause: unknown) => {
      if (generation === statusEpoch.current) setError(cause instanceof Error ? cause.message : '处理状态读取失败');
    }).finally(() => { if (generation === statusEpoch.current) setReferenceStatusBusy(false); });
    return () => { statusEpoch.current += 1; };
  }, [matterId, referenceAttemptRef]);
  useEffect(() => {
    if (!sourceIdentity || issueReading.state === 'invalid') {
      automaticIssueIdentity.current = '';
      return;
    }
    const identityKey = JSON.stringify([
      sourceIdentity.subjectKind,
      sourceIdentity.subjectId,
      sourceIdentity.workRef,
      sourceIdentity.issueKey,
    ]);
    if (automaticIssueIdentity.current === identityKey) return;
    automaticIssueIdentity.current = identityKey;
    const request = ++issueReadEpoch.current;
    setBusy(true); setError(null); setSelected(null); setSource(null);
    void readEngineeringIssue(sourceIdentity).then(value => {
      if (request === issueReadEpoch.current) setSelected(value);
    }).catch((cause: unknown) => {
      if (request === issueReadEpoch.current) {
        setError(cause instanceof Error ? cause.message : '所引工作读取失败');
      }
    }).finally(() => {
      if (request === issueReadEpoch.current) setBusy(false);
    });
    return () => { issueReadEpoch.current += 1; };
  }, [
    issueReading.state,
    sourceIdentity?.subjectKind,
    sourceIdentity?.subjectId,
    sourceIdentity?.workRef,
    sourceIdentity?.issueKey,
  ]);

  const writeReadingState = (state: EngineeringIssueReadingState) => {
    const issueParams = engineeringIssueReadingParams({
      ...state,
      query: state.query.trim(),
    });
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of [
        'issueSearchQuery',
        'issueSearchScope',
        'issueSubjectKind',
        'issueSubjectId',
        'issueWorkRef',
        'issueKey',
      ]) next.delete(key);
      issueParams.forEach((value, key) => next.set(key, value));
      return next;
    }, { replace: true });
  };
  const loadSelectedIssue = (
    identity: Pick<
      EngineeringIssueSearchResponse['hits'][number],
      'subjectKind' | 'subjectId' | 'workRef' | 'issueKey'
    >,
  ) => {
    const request = ++issueReadEpoch.current;
    setBusy(true); setError(null); setSelected(null); setSource(null);
    void readEngineeringIssue(identity).then((value) => {
      if (request === issueReadEpoch.current) setSelected(value);
    }).catch((cause: unknown) => {
      if (request === issueReadEpoch.current) {
        setResults(null); setOriginals(null); setSource(null);
        setError(cause instanceof Error ? cause.message : '展开未完成');
      }
    }).finally(() => {
      if (request === issueReadEpoch.current) setBusy(false);
    });
  };
  useEffect(
    () => () => {
      epoch.current += 1;
      issueReadEpoch.current += 1;
    },
    [],
  );
  return (
    <section
      className={`mt-6 space-y-4 rounded-xl border border-border p-4${catalog ? ' knowledge-catalog' : ''}`}
      aria-label={readOnly ? '只读工程知识检索' : '查找已有问题'}
    >
      <h2 className="text-lg font-semibold">{catalog ? '统一知识查阅' : '查找原文与已有问题'}</h2>
      <p className="text-sm text-muted-foreground">
        按关键词查找有权阅读的已发布原文和已保存工作，展开后核对问题、前提和来源。
        每类最多展示 50 项，查找到的候选不会自动加入事项。
        {readOnly ? ' 此入口只读，不登记引用比较、不启动模型。范围是当前账户获准读取的资料，不依赖先选事项。' : ''}
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const request = ++epoch.current;
          setBusy(true);
          setError(null);
          setSelected(null);
          setResults(null);
          setOriginals(null);
          setSource(null);
          writeReadingState({ query: query.trim(), scope, selected: null });
          void Promise.all([searchEngineeringIssues(query, scope), searchDocumentSources(query, scope)])
            .then(([value, sources]) => {
              if (request === epoch.current) { setResults(value); setOriginals(sources); }
            })
            .catch((cause: unknown) => {
              if (request === epoch.current)
                setError(cause instanceof Error ? cause.message : '查找未完成');
            })
            .finally(() => {
              if (request === epoch.current) setBusy(false);
            });
        }}
      >
        <Input
          aria-label="问题关键词"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：冷启动、工具版本、验证条件"
        />
        <Button type="submit" disabled={busy || !query.trim()}>
          查找
        </Button>
        <select aria-label="检索版本范围" value={scope} disabled={busy}
          onChange={event => {
            const nextScope = event.target.value as 'CURRENT' | 'HISTORY';
            epoch.current += 1;
            setScope(nextScope); setResults(null); setOriginals(null);
            setSelected(null); setSource(null);
            writeReadingState({ query, scope: nextScope, selected: null });
          }}
          className="rounded-md border border-input bg-background px-2 text-sm">
          <option value="CURRENT">当前版本</option>
          <option value="HISTORY">包含历史</option>
        </select>
      </form>
      {referenceAttemptRef ? <div className="space-y-2 rounded border border-border p-3" aria-label="引用比较处理状态">
        <p role="status">{referenceStatus ? referenceStatusText(referenceStatus) : '尚未取得此引用请求的处理状态。'}</p>
        <Button variant="outline" size="sm" disabled={referenceStatusBusy} onClick={() => {
          const generation = ++statusEpoch.current;
          setReferenceStatusBusy(true); setError(null);
          void readEngineeringIssueReferenceStatus(matterId, referenceAttemptRef).then(value => {
            if (generation === statusEpoch.current) setReferenceStatus(value);
          }).catch((cause: unknown) => {
            if (generation === statusEpoch.current) setError(cause instanceof Error ? cause.message : '处理状态读取失败');
          }).finally(() => { if (generation === statusEpoch.current) setReferenceStatusBusy(false); });
        }}>{referenceStatusBusy ? '正在读取状态…' : '读取最新处理状态'}</Button>
      </div> : null}
      {busy ? <p role="status">正在读取…</p> : null}
      {issueReading.state === 'invalid' ? (
        <p role="alert">{issueReading.reason}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className={catalog ? 'knowledge-catalog-layout' : undefined}>
      <div className={catalog ? 'knowledge-catalog-results' : undefined}>
      <section aria-label="工程工作检索结果" className="space-y-3">
      <h3>已保存工程工作</h3>
      {results?.hits.length === 0 ? (
        <p>未找到可供当前账户阅读的匹配问题。</p>
      ) : null}
      {results?.limitations.map((limitation) => (
        <p key={limitation} className="text-xs text-muted-foreground">
          检索范围：{limitation}
        </p>
      ))}
      {results?.hits.map((hit) => (
        <div
          key={`${hit.subjectId}:${hit.workRef}:${hit.issueKey}`}
          className={`border-b border-border pb-3${catalog ? ' knowledge-catalog-row' : ''}`}
        >
          <Button
            variant="ghost"
            className="h-auto whitespace-normal px-0 text-left"
            onClick={() => {
              setError(null);
              setSource(null);
              const identity = {
                subjectKind: hit.subjectKind,
                subjectId: hit.subjectId,
                workRef: hit.workRef,
                issueKey: hit.issueKey,
              };
              const sameSelection = Boolean(
                sourceIdentity
                && sourceIdentity.subjectKind === identity.subjectKind
                && sourceIdentity.subjectId === identity.subjectId
                && sourceIdentity.workRef === identity.workRef
                && sourceIdentity.issueKey === identity.issueKey,
              );
              if (readOnly || sameSelection) loadSelectedIssue(identity);
              else writeReadingState({ query, scope, selected: identity });
            }}
          >
            {hit.question}
          </Button>
          <p className="text-xs text-muted-foreground">
            {hit.subjectKind === 'WORK_ITEM' ? '文档任务' : '工程事项'} ·
            工作修订 {hit.workRevision} · {hit.kind === 'WORK' ? '问题工作' : hit.kind === 'SOURCE' ? '来源片段' : '原生记录'} ·
            候选认识 · 命中 {hit.reason === 'EXACT_IDENTIFIER' ? '精确标识' : '全文'} ·
            范围 {hit.matchedRange} · 根来源 {hit.rootRefs.length} 项
          </p>
          {hit.subjectKind === 'ENGINEERING_MATTER' ? <>
            {hit.overviewStatus === 'STALE' ? <p className="text-sm">此工作保留的综合尚未覆盖本次问题更新。</p> : null}
            <OverviewSourceWork matterId={hit.subjectId} source={hit.overviewSourceWork} overviewStatus={hit.overviewStatus} />
          </> : null}
          {hit.correctionNotices?.map(notice => <p key={notice.attemptRef} role="note" className="text-sm">
            {notice.unchanged ? '已完成比较并保留原认识：' : notice.correctedWorkRef ? '所引旧工作已有后继更正：' : '所引工作存在待核更正：'}{notice.reason}
          </p>)}
          {hit.subjectKind === 'ENGINEERING_MATTER' ? (
            <OverviewCorrectionNotices
              matterId={hit.subjectId}
              notices={hit.overviewCorrectionNotices}
            />
          ) : null}
          <ReferenceWorkNotices notices={hit.referenceWorkNotices} />
        </div>
      ))}
      {results?.hasMore ? (
        <p className="text-sm">匹配较多，请补充关键词缩小范围。</p>
      ) : null}
      </section>
      <section aria-label="原文检索结果" className="space-y-3">
      <h3>已发布原文</h3>
      {originals?.hits.length === 0 ? <p>未找到可供当前账户阅读的匹配原文。</p> : null}
      {originals?.limitations.map(limitation => <p key={limitation} className="text-xs text-muted-foreground">{limitation}</p>)}
      {originals?.hits.map(hit => <details key={`${hit.parseRunId}:${hit.sourceRefId}`} className="rounded border border-border p-3">
        <summary className="cursor-pointer">原文 · 解析修订 {hit.parseRevision} · {hit.documentVersionId}</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm">{hit.originalText}</p>
        <p className="mt-2 text-xs text-muted-foreground">原文覆盖限制 {hit.coverage.unresolvedRanges.length} 项；命中不代表已完成评估。</p>
        <Button variant="ghost" onClick={() => {
          if (!readOnly) {
            navigate(matterDocumentRoute(matterId, {
              workItemId: null,
              documentVersionId: hit.documentVersionId,
              sourceRefId: hit.sourceRefId,
              locator: JSON.stringify({
                parseRunId: hit.parseRunId,
                sourceRefId: hit.sourceRefId,
              }),
            }, 'materials', '', params));
          } else {
            navigate(`/document-versions/${encodeURIComponent(hit.documentVersionId)}?${new URLSearchParams({ parseRunId: hit.parseRunId, sourceRef: hit.sourceRefId })}`);
          }
        }}>
          阅读确切原文与来源
        </Button>
      </details>)}
      {originals?.hasMore ? <p className="text-sm">原文匹配较多，请补充关键词。</p> : null}
      </section>
      </div>
      {selected ? (
        <aside className="wl-jobaid-article rounded-xl border border-border p-4 knowledge-catalog-inspector">
          <p className="mb-3 text-sm text-muted-foreground">
            已保存工作修订 {selected.identity.workRevision}
            ；此处始终读取所引用的确切版本。
          </p>
          {selected.identity.overviewStatus === 'STALE' ? <p role="note" className="mb-3 text-sm">
            此工作的问题正文可读；综合认识尚未覆盖本次问题更新。
          </p> : selected.identity.overviewStatus === 'NOT_AVAILABLE' ? <p role="note" className="mb-3 text-sm">
            此工作的问题正文可读；综合认识尚未形成。
          </p> : null}
          {selected.identity.subjectKind === 'ENGINEERING_MATTER' ? <OverviewSourceWork matterId={selected.identity.subjectId} source={selected.identity.overviewSourceWork} overviewStatus={selected.identity.overviewStatus} /> : null}
          {selected.identity.correctionNotices?.map(notice => <p key={notice.attemptRef} role="note" className="mb-3 text-sm">
            {notice.unchanged ? '已完成比较并保留原认识：' : notice.correctedWorkRef ? '此版本已有后继更正：' : '此版本存在待核更正：'}{notice.reason}
          </p>)}
          {selected.identity.subjectKind === 'ENGINEERING_MATTER' ? (
            <OverviewCorrectionNotices
              matterId={selected.identity.subjectId}
              notices={selected.identity.overviewCorrectionNotices}
              className="mb-3"
            />
          ) : null}
          <ReferenceWorkNotices notices={selected.identity.referenceWorkNotices} />
          {!readOnly && selected.identity.subjectKind === 'ENGINEERING_MATTER' && selected.identity.subjectId !== matterId ? (
            <div className="mb-4 space-y-2 rounded border border-border p-3">
              <p className="text-sm">将此工作交给本事项比较。保存本事项自己的条件判断，并保留所引工作和根来源。</p>
              <Input aria-label="引用比较用途" placeholder="说明要比较的条件或调查问题" maxLength={3000}
                value={purpose} disabled={referenceBusy} onChange={event => setPurpose(event.target.value)} />
              <Button disabled={busy || referenceBusy || !purpose.trim() || Boolean(referenceReceipt &&
                referenceReceipt.source.workRef === selected.identity.workRef && referenceReceipt.source.issueKey === selected.identity.issueKey)}
                onClick={() => {
                  const generation = ++epoch.current;
                  const identity = selected.identity;
                  setReferenceBusy(true); setError(null);
                  void (async () => {
                    let request = pendingReference.current;
                    if (!request || request.targetMatterId !== matterId || request.source.subjectId !== identity.subjectId ||
                        request.source.workRef !== identity.workRef || request.source.issueKey !== identity.issueKey || request.purpose !== purpose.trim()) {
                      const current = await getEngineeringMatterWorkspace(matterId);
                      if (generation !== epoch.current) return;
                      request = { targetMatterId: matterId, expectedMatterRevisionId: current.working.currentMatterRevisionId,
                        expectedMatterRevision: current.matter.currentRevision.revisionNo,
                        expectedWorkingRevision: current.working.currentWorkingRevision, requestId: `reference-${crypto.randomUUID()}`,
                        purpose: purpose.trim(), source: { subjectKind: 'ENGINEERING_MATTER', subjectId: identity.subjectId,
                          workRef: identity.workRef, issueKey: identity.issueKey } };
                      pendingReference.current = request;
                    }
                    const receipt = await referenceEngineeringIssue(request);
                    if (generation === epoch.current) {
                      setReferenceReceipt(receipt);
                      setParams(current => { const next = new URLSearchParams(current); next.set('referenceAttemptRef', receipt.attemptRef); return next; }, { replace: true });
                    }
                  })().catch((cause: unknown) => {
                    if (generation === epoch.current) setError(cause instanceof Error ? cause.message : '引用请求未取得回执，可重读同一请求。');
                  }).finally(() => setReferenceBusy(false));
                }}>
                {referenceBusy ? '正在登记…' : '引用并比较本事项'}
              </Button>
              {referenceReceipt && referenceReceipt.source.workRef === selected.identity.workRef &&
                referenceReceipt.source.issueKey === selected.identity.issueKey ? <p role="status" className="text-sm">
                  引用比较请求已登记；最新处理结果见上方状态，保存工作仍需核对。
                </p> : null}
            </div>
          ) : null}
          <JobAidIssueArticle
            issue={selected.issue}
            evidence={selected.evidence}
            onLocateDocument={(evidence) => {
              const exactRoute = exactDocumentSourceRoute(evidence);
              if (exactRoute && !readOnly) navigate(matterDocumentRoute(matterId, evidence, 'materials', '', params));
              else if (exactRoute && selected.identity.subjectKind === 'ENGINEERING_MATTER') navigate(matterDocumentRoute(selected.identity.subjectId, evidence, 'brief', selected.identity.workRef));
              else if (exactRoute) navigate(exactRoute);
              else if (!evidence.workItemId)
                setSource({
                  documentVersionId: evidence.documentVersionId,
                  sourceRef: evidence.sourceRefId ?? null,
                });
              else if (!readOnly)
                navigate(matterDocumentRoute(matterId, evidence, 'materials', '', params));
              else if (selected.identity.subjectKind === 'ENGINEERING_MATTER')
                navigate(matterDocumentRoute(selected.identity.subjectId, evidence, 'brief', selected.identity.workRef));
              else navigate(`/work-items/${encodeURIComponent(evidence.workItemId)}/documents?${new URLSearchParams({ node: 'reader', tab: 'reader', documentVersionId: evidence.documentVersionId, sourceRef: evidence.sourceRefId, returnWorkItemId: selected.identity.subjectId })}`);
            }}
          />
        </aside>
      ) : catalog ? (
        <aside className="knowledge-catalog-inspector knowledge-catalog-inspector-empty">
          <strong>知识详情</strong>
          <p>输入关键词后选择一项已保存工作，在此核对形成范围、当前性和根来源。</p>
        </aside>
      ) : null}
      </div>
      {source ? (
        <MatterDocumentSourceDialog
          key={`${source.documentVersionId}:${source.sourceRef}`}
          {...source}
          onClose={() => setSource(null)}
        />
      ) : null}
    </section>
  );
}

function referenceStatusText(status: EngineeringIssueReferenceStatus): string {
  if (status.status === 'SUCCEEDED') return '本次引用比较处理已完成，请重新读取事项核对保存结果。候选认识不代表正式采用。';
  if (status.status === 'FAILED') return status.errorCode === 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE'
    ? '本次处理失败：模型没有返回完整结果。已保存工作仍可阅读。'
    : '本次引用比较处理失败。请重新读取事项核对已有保存结果。';
  if (status.status === 'CANCELLED') return '本次请求已取消，已保存工作仍可阅读。';
  if (status.status === 'TIMED_OUT') return '本次处理已超时，请重新读取事项核对已有保存结果。';
  if (status.status === 'RUNNING' || status.status === 'COMMITTING') return '最近读取时仍在处理，尚不能按此状态确认新的保存结果。';
  return '引用请求已登记，最近读取时仍在等待处理。';
}
