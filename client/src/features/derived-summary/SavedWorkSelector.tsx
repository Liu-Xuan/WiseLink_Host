import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DerivedSummaryMember } from '@shared/derived-summary.interface';
import type { EngineeringKnowledgeIdentity, EngineeringKnowledgeRead, EngineeringKnowledgeScope } from '@shared/engineering-issue-search.interface';
import { readEngineeringKnowledgeCatalogue, readEngineeringKnowledgeWork, readDocumentParsingStatus, getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Checkbox } from '@client/src/components/ui/checkbox';
import EngineeringIssueBody from '@client/src/features/matter/EngineeringIssueBody';
import MatterDocumentSourceDialog from '@client/src/features/matter/MatterDocumentSourceDialog';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import { memberFromKnowledge } from './summary-selection';
import { useSummaryResource } from './useSummaryResource';
import { exactDocumentSourceRoute } from '@client/src/features/matter/matter-navigation';
import { knowledgeReadingIdentity } from '@client/src/features/matter/reading-return';

export interface SelectedSummaryMember { member: DerivedSummaryMember; headline: string; current: boolean | null; documentCurrent?: boolean }

export default function SavedWorkSelector({ session, candidateVersionIds, onAdd }: {
  session: number; candidateVersionIds: string[]; onAdd: (value: SelectedSummaryMember) => void;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [exactLink, setExactLink] = useState('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<EngineeringKnowledgeScope>('ALL');
  const [after, setAfter] = useState<string | undefined>();
  const [selected, setSelected] = useState<EngineeringKnowledgeRead | null>(null);
  const [document, setDocument] = useState<DocumentParsingStatus | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<DocumentAssessmentEvidence | null>(null);
  const load = useCallback((signal: AbortSignal) => readEngineeringKnowledgeCatalogue(search, scope, after, signal), [search, scope, after]);
  const catalogue = useSummaryResource(JSON.stringify([search, scope, after]), session, load);

  async function select(entry: EngineeringKnowledgeIdentity & { workRevision?: number }) {
    setSelected(null); setDocument(null); setSource(null); setKeys([]); setError(''); setReading(true);
    try {
      const value = await readEngineeringKnowledgeWork(entry);
      if (session !== getCanonicalHostClientSessionGeneration()) return;
      if (entry.workRevision !== undefined && value.entry.workRevision !== entry.workRevision) throw new Error('工作修订与所选目录身份不一致。');
      if (value.entry.subjectKind === 'WORK_ITEM') {
        const scope = value.reading?.scope;
        if (scope?.kind !== 'WORK_ITEM' || scope.workItemId !== value.entry.subjectId) throw new Error('保存工作的文档版本身份未能核对。');
        const metadata = await readDocumentParsingStatus(scope.documentVersionId);
        if (session !== getCanonicalHostClientSessionGeneration()) return;
        setDocument(metadata);
      }
      setSelected(value);
    } catch (reason) {
      if (session === getCanonicalHostClientSessionGeneration()) setError(reason instanceof Error ? reason.message : '确切工作无法读取。');
    } finally { if (session === getCanonicalHostClientSessionGeneration()) setReading(false); }
  }
  function add() {
    if (!selected) return;
    try { onAdd({ member: memberFromKnowledge(selected, keys), headline: selected.entry.headline, current: selected.entry.current, ...(document ? { documentCurrent: document.selectedVersionIsCurrent } : {}) }); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '成员身份无法核对。'); }
  }
  const documentId = selected?.reading?.scope.kind === 'WORK_ITEM' ? selected.reading.scope.documentVersionId : null;
  const route = selected ? `/knowledge?${new URLSearchParams({ subjectKind: selected.entry.subjectKind, subjectId: selected.entry.subjectId, workRef: selected.entry.workRef })}` : null;
  return <section className="space-y-4" aria-label="选择确切保存工作">
    <h2 className="text-lg font-semibold">选择保存工作与问题</h2>
    <details><summary className="cursor-pointer">直接读取已有确切保存链接（含历史工作）</summary>
      <form className="my-3 flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault();
        try {
          const identity = knowledgeReadingIdentity(new URL(exactLink.trim(), 'https://local.invalid').searchParams);
          if (identity.state !== 'ok') { setError('链接须包含唯一的工作类型、对象和确切 workRef。'); return; }
          void select(identity.identity);
        } catch { setError('确切保存链接无效，请从工程知识阅读页复制链接。'); }
      }}><Input aria-label="确切保存工作链接" value={exactLink} onChange={event => setExactLink(event.target.value)} placeholder="粘贴工程知识的确切保存版本链接" />
        <Button type="submit" variant="outline" disabled={reading || !exactLink.trim()}>读取这个确切版本</Button></form>
    </details>
    <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setSearch(text.trim()); setAfter(undefined); }}>
      <Input className="max-w-sm" aria-label="查找保存工作" placeholder="标题或问题关键词" value={text} maxLength={200} onChange={event => setText(event.target.value)} />
      <Button variant="outline" type="submit">查找</Button>
      <Button variant="ghost" type="button" onClick={catalogue.refresh}>刷新</Button>
    </form>
    <div className="flex flex-wrap gap-2" role="group" aria-label="保存工作现行性">
      {(['ALL', 'CURRENT', 'HISTORICAL'] as const).map(value => <Button key={value} size="sm" variant={scope === value ? 'default' : 'outline'}
        aria-pressed={scope === value} onClick={() => { setScope(value); setAfter(undefined); }}>{value === 'ALL' ? '当前与历史' : value === 'CURRENT' ? '当前工作' : '历史工作'}</Button>)}
    </div>
    {catalogue.loading ? <p role="status">正在读取保存工作…</p> : null}
    {catalogue.error ? <p role="alert">{catalogue.error}</p> : null}
    <ul className="space-y-2">{catalogue.data?.entries.map(entry => <li className="rounded-md border border-border p-3" key={`${entry.subjectKind}:${entry.subjectId}:${entry.workRef}`}>
      <strong>{entry.headline}</strong><p className="text-sm">{entry.subjectKind === 'WORK_ITEM' ? '评估任务' : '工程事项'} · {entry.current ? '当前工作' : '历史工作'} · 修订 {entry.workRevision}</p>
      <p className="break-all text-xs text-muted-foreground">{entry.subjectId} · {entry.workRef}</p>
      <Button variant="outline" size="sm" disabled={reading} onClick={() => void select(entry)}>展开并选取问题</Button>
    </li>)}</ul>
    {catalogue.data && !catalogue.data.entries.length ? <p>这批目录没有匹配的保存工作。</p> : null}
    {catalogue.data?.nextCursor ? <Button variant="outline" onClick={() => setAfter(catalogue.data!.nextCursor!)}>下一批保存工作</Button> : null}
    {reading ? <p role="status">正在读取保存工作…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {selected ? <div className="space-y-3 rounded-md border border-border p-4" data-work-ref={selected.entry.workRef}>
      <h3 className="font-semibold">{selected.entry.headline}</h3>
      <p>{selected.entry.current ? '当前保存工作' : '历史保存工作'} · 修订 {selected.entry.workRevision} · 综合{selected.content.overviewStatus === 'CURRENT' ? '已覆盖该工作' : selected.content.overviewStatus === 'STALE' ? '尚未覆盖新问题' : '尚未形成'}</p>
      {documentId ? <><p className="break-all text-sm">文档版本：{documentId}{candidateVersionIds.length ? candidateVersionIds.includes(documentId) ? ' · 当前节点候选' : ' · 节点外显式选取，需说明范围' : ''}</p>
        {document ? <p>{document.documentCode} · 业务版次 {document.businessRevision || '待核'} · {document.selectedVersionIsCurrent ? '库内当前文档版本' : '历史文档版本（新版本未自动纳入）'}</p> : null}
        <Link className="underline" to={`/document-versions/${encodeURIComponent(documentId)}`}>阅读这份确切文档版本</Link></> : null}
      {route ? <Link className="ml-3 underline" to={route}>阅读完整问题、措施与风险理由</Link> : null}
      <Button type="button" variant="outline" size="sm" onClick={() => setKeys([...new Set(selected.content.issues.map(issue => issue.issueKey))])}>明确选取全部问题</Button>
      {selected.content.issues.map(issue => <details key={issue.issueRef} className="border-t border-border pt-3">
        <summary className="cursor-pointer">{issue.question} · {issue.issueKey}</summary>
        <label className="my-3 flex items-center gap-2"><Checkbox checked={keys.includes(issue.issueKey)} onCheckedChange={checked => setKeys(prior => checked === true ? [...new Set([...prior, issue.issueKey])] : prior.filter(key => key !== issue.issueKey))} />将该问题加入范围</label>
        <EngineeringIssueBody body={issue.body} evidence={selected.content.evidence} onLocateDocument={value => {
          const exact = exactDocumentSourceRoute(value); if (exact) navigate(exact); else setSource(value);
        }} />
      </details>)}
      <Button disabled={!keys.length} onClick={add}>加入这份确切工作（{keys.length} 个问题）</Button>
    </div> : null}
    {source ? <MatterDocumentSourceDialog key={`${source.documentVersionId}:${source.sourceRefId}`} documentVersionId={source.documentVersionId} sourceRef={source.sourceRefId} onClose={() => setSource(null)} /> : null}
  </section>;
}
