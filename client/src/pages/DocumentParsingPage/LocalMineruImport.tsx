import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StartDocumentParseRequest } from '@shared/document-parsing.interface';
import { getCanonicalHostClientSessionGeneration, startDocumentParsing, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import { uploadFile } from '@client/src/components/business-ui/api/files/service';
import { Button } from '@client/src/components/ui/button';

/** An explicit maintenance import, not a second automatic consumer. */
export default function LocalMineruImport({ documentVersionId, expectedPublishedRevision, onImported }: {
  documentVersionId: string; expectedPublishedRevision: number; onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<StartDocumentParseRequest | null>(null);
  const requestId = useRef('');
  const inFlight = useRef<number | null>(null);
  const operation = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const reset = () => {
      operation.current += 1; inFlight.current = null;
      request.current = null; requestId.current = ''; setFile(null); setMessage(null); setError(null); setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    };
    reset();
    const unsubscribe = subscribeCanonicalHostClientSession(reset);
    return () => { mounted.current = false; operation.current += 1; inFlight.current = null; unsubscribe(); };
  }, [documentVersionId]);
  async function submit() {
    if (!file || inFlight.current) return;
    const submittedOperation = ++operation.current;
    inFlight.current = submittedOperation; setBusy(true); setError(null); setMessage(null);
    const generation = getCanonicalHostClientSessionGeneration();
    const current = () => mounted.current && submittedOperation === operation.current && generation === getCanonicalHostClientSessionGeneration();
    try {
      if (!request.current) {
        const uploaded = await uploadFile(file, { filePath: `wiselink/mineru-candidates/${requestId.current}.json`,
          contentType: 'application/json', upsert: false });
        if (!current()) return;
        request.current = { requestId: requestId.current, expectedPublishedRevision, mode: 'LOCAL_MINERU_IMPORT',
          selection: { bucketId: uploaded.bucketId, filePath: uploaded.filePath } };
      }
      const result = await startDocumentParsing(documentVersionId, request.current);
      if (!current()) return;
      if (result.status === 'FAILED') {
        setError(`本次解析已失败（${result.errorCode ?? 'DOCUMENT_PARSE_FAILED'}）。重新执行需选择候选包建立后继解析，已有记录保留。`);
        if (fileInput.current) fileInput.current.value = '';
        return;
      }
      if (result.status === 'PUBLISHED') setMessage(`备用解析已保存为阅读版本 ${result.parseRevision}。`);
      else if (result.status === 'RUNNING' || result.status === 'STAGING') setMessage('导入已受理，可核对同一请求的处理结果。');
      else { setError('导入状态无法确认，请核对同一请求。'); return; }
      onImported();
    } catch (reason: unknown) {
      if (current()) setError(reason instanceof Error ? reason.message : '导入尚未确认，请核对同一请求。');
    } finally {
      if (inFlight.current === submittedOperation) inFlight.current = null;
      if (current()) setBusy(false);
    }
  }
  return <details className="space-y-3 py-3">
    <summary>导入本机 MinerU 解析</summary>
    <p className="text-sm text-muted-foreground">选择本机助手生成的候选包。系统核对原件、解析来源和当前设置后保存；原有解析记录保留。</p>
    <input ref={fileInput} type="file" accept=".json,application/json" aria-label="选择本机 MinerU 候选包" disabled={busy}
      onChange={event => {
        const next = event.target.files?.[0];
        request.current = null; requestId.current = `mineru-${crypto.randomUUID()}`; setMessage(null); setError(null);
        if (!next || !next.name.endsWith('.json') || next.size < 1 || next.size > 64 * 1024 * 1024) {
          setFile(null); setError('请选择不超过 64 MB 的 MinerU JSON 候选包。'); return;
        }
        setFile(next);
      }} />
    <div className="flex items-center gap-3">
      <Button variant="outline" disabled={!file || busy} onClick={() => void submit()}>
        {busy ? '正在核验并保存…' : request.current ? '核对同一导入请求' : '导入解析结果'}
      </Button>
      <Link to="/settings/models" className="text-sm underline">解析设置</Link>
    </div>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
