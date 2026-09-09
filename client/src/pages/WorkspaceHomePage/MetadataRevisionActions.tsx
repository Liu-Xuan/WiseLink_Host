import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DocumentExtractedMetadata } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  getCanonicalHostClientSessionGeneration,
  readDocumentVersionMetadata,
  reextractDocumentVersionMetadata,
  summarizeCanonicalDocumentReadFailure,
  type DocumentMetadataReadReceipt,
  type DocumentMetadataReadQuery,
} from '@client/src/api/canonical-host';

interface MetadataRevisionActionsProps {
  documentVersionId: string;
  metadataRevision: number | null;
  onRefresh: () => void;
  renderMetadata: (metadata: DocumentExtractedMetadata) => ReactNode;
}

export function MetadataRevisionActions({
  documentVersionId, metadataRevision, onRefresh, renderMetadata,
}: MetadataRevisionActionsProps) {
  const [latest, setLatest] = useState<DocumentMetadataReadReceipt | null>(null);
  const [history, setHistory] = useState<DocumentMetadataReadReceipt | null>(null);
  const [submission, setSubmission] = useState<{requestId: string; expectedMetadataRevision: number} | null>(null);
  const [conflict, setConflict] = useState(false);
  const [sourceBlocked, setSourceBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const revision = Math.max(metadataRevision ?? 0, latest?.metadataRevision ?? 0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function run(action: 'reextract' | 'latest' | 'check' | 'history', requestedRevision?: number) {
    if (inFlight.current || (action === 'reextract' && (submission || conflict || sourceBlocked || revision < 1))) return;
    const generation = getCanonicalHostClientSessionGeneration();
    const current = () => mounted.current && generation === getCanonicalHostClientSessionGeneration();
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (action === 'reextract') {
        // The server requires a UUID; never substitute a weaker correlation ID.
        if (!globalThis.crypto?.randomUUID) throw new Error('当前浏览器无法生成请求 UUID，请使用安全连接和受支持的浏览器。');
        const input = { expectedMetadataRevision: revision, requestId: globalThis.crypto.randomUUID() };
        setSubmission(input);
        const receipt = await reextractDocumentVersionMetadata(documentVersionId, input);
        if (!current()) return;
        setLatest(receipt);
        setSubmission(null);
        setMessage(`已确认元数据修订 ${receipt.metadataRevision}（${receipt.disposition === 'IDEMPOTENT_REPLAY' ? '复用本次回执，未重复追加' : '已追加'}）。旧提取记录保留，文档版本与评估任务未改变。`);
        onRefresh();
      } else {
        if (action === 'check' && !submission) return;
        const query: DocumentMetadataReadQuery | undefined = action === 'history' ? { revision: requestedRevision! }
          : action === 'check' ? { requestId: submission!.requestId } : undefined;
        const receipt = await readDocumentVersionMetadata(documentVersionId, query);
        if (!current()) return;
        if (action === 'history') {
          setHistory(receipt);
          return;
        }
        if (action === 'check' && receipt.metadataId === null) {
          setMessage('尚未读到本次请求的提交回执，不能据此认定未提交。请稍后再次只读核对；不会自动重复提取。');
          return;
        }
        if (action === 'check' && receipt.metadataRevision !== Number(submission?.expectedMetadataRevision) + 1) {
          throw new Error('本次请求回执与预期元数据修订不符，请联系管理员核对，不能继续追加。');
        }
        setLatest(receipt);
        if (action === 'check' || conflict) {
          setSubmission(null);
          setConflict(false);
        }
        setMessage(action === 'check'
          ? `本次请求已确认保存为元数据修订 ${receipt.metadataRevision}，未重复提交。`
          : sourceBlocked
            ? '已读取最新元数据；原件来源异常仍需管理员处理，重新提取保持锁定。'
            : submission && !conflict
            ? `已刷新最新元数据修订 ${receipt.metadataRevision ?? '未提取'}；本次提交仍待按请求编号核对，重新提取保持锁定。`
            : `已刷新最新元数据修订 ${receipt.metadataRevision ?? '未提取'}，请核对后决定是否重新提取。`);
        onRefresh();
      }
    } catch (reason: unknown) {
      if (!current()) return;
      const summary = summarizeCanonicalDocumentReadFailure(reason);
      if (action === 'reextract' && summary.code === 'DOCUMENT_METADATA_REVISION_CONFLICT') {
        setConflict(true);
        setError('元数据修订发生冲突，本次未确认追加。请刷新最新元数据并核对后，再主动重新提取。');
      } else if (action === 'reextract' && ['DOCUMENT_METADATA_SOURCE_MISMATCH', 'DOCUMENT_METADATA_FILL_CONFLICT'].includes(summary.code ?? '')) {
        setSourceBlocked(true);
        setSubmission(null);
        setError('原件与文档版本的来源核对未通过，本次未保存元数据。已停止重新提取，请联系管理员核对原件；刷新不会解除此限制。');
      } else {
        setError(`${action === 'reextract' ? '重新提取未确认完成' : '读取元数据失败'}：${reason instanceof Error ? reason.message : '请求失败'}。${action === 'reextract' ? '如已发送请求，请先只读核对本次请求，不要重复提交。' : '未替换当前显示的提取结果。'}`);
      }
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }

  return (
    <section aria-label="元数据修订管理">
      <p>元数据修订：{revision || '尚未读取'}。重新提取仅追加元数据记录，保留旧提取结果，不新建文档版本或评估任务。</p>
      <div className="library-grouping-controls">
        <Button variant="outline" size="sm" disabled={busy || Boolean(submission) || conflict || sourceBlocked || revision < 1} onClick={() => { void run('reextract'); }}>重新提取元数据</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run('latest'); }}>刷新最新元数据</Button>
        {submission && !conflict ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run('check'); }}>只读核对本次请求</Button> : null}
        {revision > 1 ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void run('history', revision - 1); }}>查看上一修订证据</Button> : null}
      </div>
      {submission ? <p className="library-classification-note">本次请求编号：{submission.requestId}；预期元数据修订：{submission.expectedMetadataRevision}</p> : null}
      {sourceBlocked ? <p role="alert">原件来源核对异常：重新提取已锁定，请联系管理员。旧元数据记录仍保留。</p> : null}
      {busy ? <p role="status">正在处理元数据请求…</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {latest?.extractedMetadata ? <details><summary>已核对的元数据修订 {latest.metadataRevision} 证据</summary>{renderMetadata(latest.extractedMetadata)}</details> : null}
      {history?.extractedMetadata ? <section aria-label="历史元数据证据">
        <h5>历史元数据修订 {history.metadataRevision}（仅查看，不恢复为最新）</h5>
        {renderMetadata(history.extractedMetadata)}
        <div className="library-grouping-controls">
          <Button variant="ghost" size="sm" disabled={busy || Number(history.metadataRevision) <= 1} onClick={() => { void run('history', Number(history.metadataRevision) - 1); }}>更早修订</Button>
          <Button variant="ghost" size="sm" disabled={busy || Number(history.metadataRevision) >= revision - 1} onClick={() => { void run('history', Number(history.metadataRevision) + 1); }}>较新历史修订</Button>
          <Button variant="ghost" size="sm" onClick={() => setHistory(null)}>收起历史证据</Button>
        </div>
      </section> : null}
    </section>
  );
}
