import { useEffect, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { getCanonicalHostClientSessionGeneration, getCanonicalLibraryQuicklook, readDocumentParsingStatus } from '@client/src/api/canonical-host';
import type { CanonicalLibraryQuicklookResponse, CanonicalReferenceMentionPreviewItem } from '@shared/api.interface';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';
import { documentNeighborhoodAccessRejected, type DocumentNeighborhoodRead } from './document-neighborhood-read';
import type { DocumentNeighborhoodProjection, DocumentNeighborhoodTarget } from './suite-document-neighborhood';
import type { SuiteGraphTimelineEvent } from './suite-graph-timeline';

type DocumentTarget = Extract<DocumentNeighborhoodTarget, {kind: 'document'}>;
function SavedReading({ quicklook }: { quicklook: CanonicalLibraryQuicklookResponse | null }) {
  const result = quicklook?.result;
  const content = result?.readingResult?.content;
  return <section aria-label="所选版本已保存认识">
    <h3>已保存认识</h3>
    {result ? <>
      <p>{result.status === 'STALE' ? '保存候选已滞后；不代表当前工程结论。' : '已保存候选；尚非正式采用。'}</p>
      {content ? <><strong>{content.headline}</strong><p>{content.lead || content.listBrief}</p></> : <p>未返回可读认识正文。</p>}
      {result.gap ? <p>{result.gap}</p> : null}
      <small>保存结果 {result.sourceResultId} · 修订 {result.revision}</small>
    </> : <p>{quicklook ? '该阅读工作未返回已保存认识；不代表资料无信息。' : '未提供关联阅读工作；文档自身保存解读尚未接通此栏。'}</p>}
  </section>;
}
function SelectedDocument({ target, read, session, onRejected, onCenter, onOpen }: {
  target: DocumentTarget; read: DocumentNeighborhoodRead; session: number;
  onRejected: () => void; onCenter: () => void; onOpen: () => void;
}) {
  const root = target.documentVersionId === read.document.documentVersionId;
  const key = JSON.stringify([target.documentVersionId, target.readerWorkItemId ?? null, session]);
  const [state, setState] = useState<{key: string; document: DocumentParsingStatus; quicklook: CanonicalLibraryQuicklookResponse | null} | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (root) return;
    const controller = new AbortController();
    setState(null); setError(null);
    const current = () => !controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session;
    void (async () => {
      const document = await readDocumentParsingStatus(target.documentVersionId, controller.signal);
      const quicklook = target.readerWorkItemId ? await getCanonicalLibraryQuicklook(target.readerWorkItemId, controller.signal) : null;
      if (document.documentVersionId !== target.documentVersionId
        || (quicklook && (quicklook.document.documentVersionId !== target.documentVersionId
          || quicklook.document.workItemId !== target.readerWorkItemId || quicklook.document.familyId !== document.familyId)))
        throw new Error('所选资料身份读回不一致。');
      if (current()) setState({key, document, quicklook});
    })().catch(reason => {
      if (!current()) return;
      if (documentNeighborhoodAccessRejected(reason)) onRejected();
      setError('所选资料读取受阻，未替换为其他版本。');
    });
    return () => controller.abort();
  }, [key, root, session, onRejected]);
  const selected = root ? {document: read.document, quicklook: read.quicklook} : state?.key === key ? state : null;
  if (!selected) return <p role={error ? 'alert' : 'status'}>{error || '正在读取所选准确版本的简要信息…'}</p>;
  return <>
    <h2>{selected.document.documentTitle || selected.document.originalFilename}</h2>
    <p>{selected.document.documentCode} · {selected.document.businessRevision}</p>
    <p>{selected.document.selectedVersionIsCurrent ? '库内当前版本；不证明发布方最新。' : '库内历史版本；没有跳到当前版本。'}</p>
    {target.candidate ? <p>此对象是 Host 按文号匹配的候选；它的版次尚未与引用原词核实。</p> : null}
    <p>版本日期：{selected.document.revisionDate || '未提供'}</p>
    <small>准确版本 {target.documentVersionId}</small>
    <SavedReading quicklook={selected.quicklook} />
    <div className="suite-document-graph-detail-actions">
      <Button variant="outline" onClick={onOpen}>打开确切原文</Button>
      {!root ? <Button variant="outline" onClick={onCenter}>以此版本为中心</Button> : null}
    </div>
  </>;
}
function RelationshipPicker({ ids, selectedId, projection, onSelect }: {
  ids: string[]; selectedId: string; projection: DocumentNeighborhoodProjection; onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const known = ids.filter(id => projection.relations.has(id));
  if (known.length < 2) return null;
  const currentPage = Math.min(page, Math.ceil(known.length / 6) - 1);
  return <section aria-label="独立关系记录"><p>此连接含 {known.length} 条独立记录；逐条核对来源。</p>
    {known.slice(currentPage * 6, currentPage * 6 + 6).map((id, index) => <Button key={id} size="sm" variant="ghost"
      aria-pressed={id === selectedId} onClick={() => onSelect(id)}>{currentPage * 6 + index + 1}. {projection.relations.get(id)?.mention?.citationText || projection.relations.get(id)?.label}</Button>)}
    <Button size="sm" variant="ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一组关系</Button>
    <Button size="sm" variant="ghost" disabled={(currentPage + 1) * 6 >= known.length} onClick={() => setPage(currentPage + 1)}>下一组关系</Button>
  </section>;
}
export default function DocumentNeighborhoodDetails(props: DocumentNeighborhoodDetailsProps) {
  return <><RelationshipPicker ids={props.relationshipIds} selectedId={props.selectedId} projection={props.projection} onSelect={props.onSelectRelationship} />
    <SelectedDetail {...props} /></>;
}
interface DocumentNeighborhoodDetailsProps {
  read: DocumentNeighborhoodRead; projection: DocumentNeighborhoodProjection; selectedId: string;
  event: SuiteGraphTimelineEvent | null; session: number; onRejected: () => void;
  relationshipIds: string[]; onSelectRelationship: (id: string) => void;
  onCenter: (target: DocumentTarget) => void; onOpen: (documentVersionId: string) => void;
  onMentionSource: (mention: CanonicalReferenceMentionPreviewItem, sourceRef: string) => void;
  onMatter: (matterId: string) => void;
}
function SelectedDetail({ read, projection, selectedId, event, session, onRejected, onCenter, onOpen, onMentionSource, onMatter }: DocumentNeighborhoodDetailsProps) {
  if (event?.statement) return <><h2>{event.title}</h2><p>{event.sourceLabel} · {event.date}</p>
    {event.statement.quotes.slice(0, 8).map((quote, index) => <p key={index}>引文 {index + 1}：{quote.text}</p>)}
    {event.statement.quotes.length > 8 ? <p>此处显示前 8 段引文，完整时间轴保留全部来源。</p> : null}
    {event.statement.limitations.slice(0, 8).map((limitation, index) => <p key={index}>限制：{limitation}</p>)}
    {event.statement.limitations.length > 8 ? <p>其余限制请在完整时间轴核对。</p> : null}
    <small>保存候选 {event.pins?.parseRunId} · {event.pins?.candidateRevision}；不代表实际执行。</small></>;
  const target = projection.targets.get(selectedId);
  const relation = projection.relations.get(selectedId);
  const mention = target?.kind === 'mention' ? target.mention : relation?.mention;
  const receipt = target?.kind === 'mention' ? target.receipt : relation?.receipt;
  if (mention) return <>
    <h2>{relation?.label ?? '正文引用出现位置'}</h2><p>{mention.citationText}</p><p>{mention.matchedText}</p>
    <p>提及不是已核实的被引版次，也不证明措施实施或适用性。</p>
    <small>独立引用 {mention.mentionRef || mention.mentionId} · 保存预览 {receipt?.snapshotRef}</small>
    {mention.sourceRefIds.slice(0, 8).map(ref => <Button key={ref} size="sm" variant="outline" onClick={() => onMentionSource(mention, ref)}>打开引用方原文位置</Button>)}
    {mention.sourceRefIds.length > 8 ? <p>此处显示前 8 个来源位置。</p> : null}
  </>;
  if (target?.kind === 'document') return <SelectedDocument key={selectedId} target={target} read={read} session={session}
    onRejected={onRejected} onCenter={() => onCenter(target)} onOpen={() => onOpen(target.documentVersionId)} />;
  if (target?.kind === 'family') return <><h2>文档族版本</h2><p>仅使用准确文档族身份连接；标题、ATA 相同不会产生关系。</p><small>{target.familyId}</small></>;
  if (target?.kind === 'matter') return <><h2>{target.matter.title}</h2><p>此阅读工作在事项当前版本中有登记；当前资料不注入历史保存工作。</p>
    <p>{target.matter.result?.headline || '该事项未返回简短认识。'}</p>
    {target.matter.result ? <small>已保存候选 {target.matter.result.resultRef} · 修订 {target.matter.result.resultRevision}；
      {target.matter.overallStatus === 'STALE' ? '综合已滞后' : target.matter.overallStatus === 'CURRENT' ? '综合覆盖当前工作' : '综合覆盖状态未提供'}；尚非正式采用。</small> : null}
    <Button variant="outline" onClick={() => onMatter(target.matter.matterId)}>查看事项资料与认识</Button></>;
  if (relation) return <><h2>{relation.label}</h2><p>Host 登记关系；不是文档之间的工程推论。</p></>;
  return <p>所选对象已不在本次授权邻域，不替换为其他对象。</p>;
}
