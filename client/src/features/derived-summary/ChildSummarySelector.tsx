import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DerivedSummaryRevision } from '@shared/derived-summary.interface';
import { listDerivedSummaries, readDerivedSummaryRevision } from '@client/src/api/derived-summary';
import { getCanonicalHostClientSessionGeneration } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import type { SelectedSummaryMember } from './SavedWorkSelector';
import { summaryMemberRoute } from './summary-selection';
import { useSummaryResource } from './useSummaryResource';

export default function ChildSummarySelector({ session, initialId = '', initialRef = '', onAdd }: {
  session: number; initialId?: string; initialRef?: string; onAdd: (value: SelectedSummaryMember) => void;
}) {
  const [id, setId] = useState(initialId);
  const [ref, setRef] = useState(initialRef);
  const [exact, setExact] = useState<DerivedSummaryRevision | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback((signal: AbortSignal) => listDerivedSummaries(signal), []);
  const directory = useSummaryResource('summary-members', session, load);
  async function read(summaryId: string, summaryRef: string) {
    setExact(null); setError(''); setLoading(true);
    try {
      const value = await readDerivedSummaryRevision(summaryId, summaryRef);
      if (session === getCanonicalHostClientSessionGeneration()) { setId(summaryId); setRef(summaryRef); setExact(value); }
    } catch (reason) {
      if (session === getCanonicalHostClientSessionGeneration()) setError(reason instanceof Error ? reason.message : '子概述无法读取。');
    } finally { if (session === getCanonicalHostClientSessionGeneration()) setLoading(false); }
  }
  return <section className="space-y-3" aria-label="选择已有资料综合">
    <h2 className="text-lg font-semibold">加入已有资料综合</h2>
    {directory.error ? <p role="alert">{directory.error}</p> : null}
    {directory.loading ? <p role="status">正在读取资料综合目录…</p> : null}
    <ul className="space-y-2">{directory.data?.filter(item => item.currentSummaryRef).map(item => <li key={item.summaryId}>
      <Button variant="outline" disabled={loading} onClick={() => void read(item.summaryId, item.currentSummaryRef!)}>{item.scope.title} · 当前修订 {item.currentRevision}</Button>
    </li>)}</ul>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void read(id.trim(), ref.trim()); }}>
      <label className="block text-sm">资料综合 ID<Input disabled={loading} value={id} onChange={event => { setId(event.target.value); setExact(null); }} /></label>
      <label className="block text-sm">保存版本引用（summaryRef，可选历史版本）<Input disabled={loading} value={ref} onChange={event => { setRef(event.target.value); setExact(null); }} /></label>
      <Button type="submit" variant="outline" disabled={loading || !id.trim() || !ref.trim()}>读取保存版本</Button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">正在读取资料综合…</p> : null}
    {exact ? <div className="space-y-2 border border-border p-3"><strong>{exact.content.headline}</strong>
      <p>修订 {exact.revision} · {exact.members.length} 份选定资料</p>
      <ul className="list-disc pl-5">{exact.content.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>
      <Link className="underline" to={summaryMemberRoute({ kind: 'DERIVED_SUMMARY', summaryId: exact.summaryId, summaryRef: exact.summaryRef, summaryRevision: exact.revision })}>阅读正文与来源</Link>
      <Button onClick={() => onAdd({ member: { kind: 'DERIVED_SUMMARY', summaryId: exact.summaryId, summaryRef: exact.summaryRef, summaryRevision: exact.revision }, headline: exact.content.headline, current: null })}>加入这份资料综合</Button>
    </div> : null}
  </section>;
}
