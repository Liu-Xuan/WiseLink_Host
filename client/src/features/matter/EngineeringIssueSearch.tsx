import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  searchEngineeringIssues,
  searchDocumentSources,
  readEngineeringIssue,
  referenceEngineeringIssue,
  readEngineeringIssueReferenceStatus,
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
import { matterDocumentRoute } from './matter-navigation';
import type { DocumentSourceSearchResponse } from '@shared/document-source-search.interface';
import '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css';

export default function EngineeringIssueSearch({
  matterId,
}: {
  matterId: string;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const referenceAttemptRef = params.get('referenceAttemptRef');
  const sourceWorkRef = params.get('sourceWorkRef');
  const sourceIssueKey = params.get('sourceIssueKey');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'CURRENT' | 'HISTORY'>('CURRENT');
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
    if (!sourceWorkRef || !sourceIssueKey) return;
    const request = ++epoch.current;
    setBusy(true); setError(null); setSelected(null); setSource(null);
    void readEngineeringIssue({ subjectKind: 'ENGINEERING_MATTER', subjectId: matterId,
      workRef: sourceWorkRef, issueKey: sourceIssueKey }).then(value => {
      if (request === epoch.current) setSelected(value);
    }).catch((cause: unknown) => {
      if (request === epoch.current) setError(cause instanceof Error ? cause.message : '所引工作读取失败');
    }).finally(() => { if (request === epoch.current) setBusy(false); });
    return () => { epoch.current += 1; };
  }, [matterId, sourceWorkRef, sourceIssueKey]);
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  return (
    <section
      className="mt-6 space-y-4 rounded-xl border border-border p-4"
      aria-label="查找已有问题"
    >
      <h2 className="text-lg font-semibold">查找原文与已有问题</h2>
      <p className="text-sm text-muted-foreground">
        按关键词查找有权阅读的已发布原文和已保存工作，展开后核对问题、前提和来源。
        每类最多展示 50 项，查找到的候选不会自动加入本事项。
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
          onChange={event => { setScope(event.target.value as 'CURRENT' | 'HISTORY'); setResults(null); setOriginals(null); setSelected(null); }}
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
      {error ? <p role="alert">{error}</p> : null}
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
          className="border-b border-border pb-3"
        >
          <Button
            variant="ghost"
            className="h-auto whitespace-normal px-0 text-left"
            onClick={() => {
              const request = ++epoch.current;
              setBusy(true);
              setError(null);
              setSelected(null);
              setSource(null);
              void readEngineeringIssue(hit)
                .then((value) => {
                  if (request === epoch.current) setSelected(value);
                })
                .catch((cause: unknown) => {
                  if (request === epoch.current)
                    setError(
                      cause instanceof Error ? cause.message : '展开未完成',
                    );
                })
                .finally(() => {
                  if (request === epoch.current) setBusy(false);
                });
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
          {hit.correctionNotices?.map(notice => <p key={notice.attemptRef} role="note" className="text-sm">
            {notice.correctedWorkRef ? '所引旧工作已有后继更正：' : '所引工作存在待核更正：'}{notice.reason}
          </p>)}
          <ReferenceWorkNotices notices={hit.referenceWorkNotices} />
        </div>
      ))}
      {results?.hasMore ? (
        <p className="text-sm">匹配较多，请补充关键词缩小范围。</p>
      ) : null}
      {originals?.limitations.map(limitation => <p key={limitation} className="text-xs text-muted-foreground">{limitation}</p>)}
      {originals?.hits.map(hit => <details key={`${hit.parseRunId}:${hit.sourceRefId}`} className="rounded border border-border p-3">
        <summary className="cursor-pointer">原文 · 解析修订 {hit.parseRevision} · {hit.documentVersionId}</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm">{hit.originalText}</p>
        <p className="mt-2 text-xs text-muted-foreground">原文覆盖限制 {hit.coverage.unresolvedRanges.length} 项；命中不代表已完成评估。</p>
        <Button variant="ghost" onClick={() => navigate(`/document-versions/${encodeURIComponent(hit.documentVersionId)}?${new URLSearchParams({ parseRunId: hit.parseRunId, sourceRef: hit.sourceRefId })}`)}>
          阅读确切原文与来源
        </Button>
      </details>)}
      {originals?.hasMore ? <p className="text-sm">原文匹配较多，请补充关键词。</p> : null}
      {selected ? (
        <div className="wl-jobaid-article rounded-xl border border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            已保存工作修订 {selected.identity.workRevision}
            ；此处始终读取所引用的确切版本。
          </p>
          {selected.identity.overviewStatus === 'STALE' ? <p role="note" className="mb-3 text-sm">
            此工作的问题正文可读；综合认识尚未覆盖本次问题更新。
          </p> : selected.identity.overviewStatus === 'NOT_AVAILABLE' ? <p role="note" className="mb-3 text-sm">
            此工作的问题正文可读；综合认识尚未形成。
          </p> : null}
          {selected.identity.correctionNotices?.map(notice => <p key={notice.attemptRef} role="note" className="mb-3 text-sm">
            {notice.correctedWorkRef ? '此版本已有后继更正：' : '此版本存在待核更正：'}{notice.reason}
          </p>)}
          <ReferenceWorkNotices notices={selected.identity.referenceWorkNotices} />
          {selected.identity.subjectKind === 'ENGINEERING_MATTER' && selected.identity.subjectId !== matterId ? (
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
            reading={selected.reading}
            onLocateDocument={(evidence) => {
              if (!evidence.workItemId)
                setSource({
                  documentVersionId: evidence.documentVersionId,
                  sourceRef: evidence.sourceRefId ?? null,
                });
              else
                navigate(matterDocumentRoute(matterId, evidence, 'materials'));
            }}
          />
        </div>
      ) : null}
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
