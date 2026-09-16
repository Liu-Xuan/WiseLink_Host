import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@client/src/components/ui/button';
import {
  getCanonicalHostClientSessionGeneration,
  readDocumentVersionOriginal,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

function useDocumentOriginalUrl(documentVersionId: string) {
  const [preview, setPreview] = useState<{url: string; documentVersionId: string; generation: number} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const url = preview?.documentVersionId === documentVersionId &&
    preview.generation === getCanonicalHostClientSessionGeneration() ? preview.url : null;

  useEffect(() => {
    mounted.current = true;
    setPreview(null);
    setBusy(false);
    setError(null);
    const clear = () => {
      controller.current?.abort();
      controller.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
    const unsubscribe = subscribeCanonicalHostClientSession(() => {
      clear();
      setPreview(null);
      setBusy(false);
      setError('登录状态已变化，请重新读取原件。');
    });
    return () => { mounted.current = false; clear(); unsubscribe(); };
  }, [documentVersionId]);

  async function prepare() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const generation = getCanonicalHostClientSessionGeneration();
    const current = () => mounted.current && !request.signal.aborted &&
      controller.current === request && generation === getCanonicalHostClientSessionGeneration();
    setBusy(true);
    setError(null);
    try {
      const pdf = await readDocumentVersionOriginal(documentVersionId, request.signal);
      if (!current()) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const next = URL.createObjectURL(pdf);
      objectUrl.current = next;
      setPreview({ url: next, documentVersionId, generation });
    } catch (reason: unknown) {
      if (current()) setError(`原件读取失败：${reason instanceof Error ? reason.message : '请求未完成'}。没有打开文件，请重试或检查访问权限。`);
    } finally {
      if (current()) { controller.current = null; setBusy(false); }
    }
  }
  return { url, busy, error, prepare };
}

export function DocumentOriginalPreview({
  documentVersionId, children, page,
}: { documentVersionId: string; children: ReactNode; page?: number }) {
  const { url, busy, error, prepare } = useDocumentOriginalUrl(documentVersionId);

  return (
    <span className="library-original-preview" data-document-version-id={documentVersionId}>
      {url ? <>
        <a href={page && Number.isSafeInteger(page) && page > 0 ? `${url}#page=${page}` : url} target="_blank" rel="noopener noreferrer">{children}</a>
        <span role="status">原件已读取，请点击链接在新标签页打开。</span>
      </> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void prepare(); }}>
        {busy ? '正在读取原件…' : '读取原件以预览'}
      </Button>}
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}

export function DocumentOriginalInlinePreview({ documentVersionId, page = 1 }: { documentVersionId: string; page?: number }) {
  const { url, busy, error, prepare } = useDocumentOriginalUrl(documentVersionId);
  return <section className="document-original-inline" aria-label="PDF 原件">
    {url ? <>
      <div className="document-original-inline-label">受控原件 · 第 {page} 页</div>
      <iframe title={`PDF 原件第 ${page} 页`} src={`${url}#page=${page}&view=FitH`} />
      <a href={`${url}#page=${page}`} target="_blank" rel="noopener noreferrer">在新标签页打开第 {page} 页</a>
    </> : <div className="document-original-inline-empty">
      <strong>原件按需读取</strong>
      <p>读取后在此显示同一 DocumentVersion 的 PDF；未取得原件时不生成替代页面。</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { void prepare(); }}>
        {busy ? '正在读取原件…' : '读取受控原件'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </div>}
  </section>;
}
