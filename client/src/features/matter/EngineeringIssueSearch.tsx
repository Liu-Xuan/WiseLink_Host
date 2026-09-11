import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  searchEngineeringIssues,
  readEngineeringIssue,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { JobAidIssueArticle } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';
import type {
  EngineeringIssueRead,
  EngineeringIssueSearchResponse,
} from '@shared/engineering-issue-search.interface';
import MatterDocumentSourceDialog from './MatterDocumentSourceDialog';
import { matterDocumentRoute } from './matter-navigation';
import '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css';

export default function EngineeringIssueSearch({
  matterId,
}: {
  matterId: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EngineeringIssueSearchResponse | null>(
    null,
  );
  const [selected, setSelected] = useState<EngineeringIssueRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{
    documentVersionId: string;
    sourceRef: string | null;
  } | null>(null);
  const epoch = useRef(0);
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
      <h2 className="text-lg font-semibold">查找已有问题</h2>
      <p className="text-sm text-muted-foreground">
        按关键词查找有权阅读的已保存工作，展开后核对问题、前提和来源。每次最多展示
        50 项，请用具体问题或条件检索。查找到的候选不会自动加入本事项。
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
          setSource(null);
          void searchEngineeringIssues(query)
            .then((value) => {
              if (request === epoch.current) setResults(value);
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
      </form>
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
        </div>
      ))}
      {results?.hasMore ? (
        <p className="text-sm">匹配较多，请补充关键词缩小范围。</p>
      ) : null}
      {selected ? (
        <div className="wl-jobaid-article rounded-xl border border-border p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            已保存工作修订 {selected.identity.workRevision}
            ；此处始终读取搜索命中的确切版本。
          </p>
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
