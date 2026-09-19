import { useEffect, type ReactNode } from 'react';
import { Button } from '@client/src/components/ui/button';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { useDocumentOriginalUrl } from '../../utils/document-original-url';
export { useDocumentOriginalUrl } from '../../utils/document-original-url';

export function DocumentOriginalPreview({
  documentVersionId, children, page,
}: { documentVersionId: string; children: ReactNode; page?: number }) {
  const { url, busy, error, prepare } = useDocumentOriginalUrl(documentVersionId);

  return (
    <span className="library-original-preview" data-document-version-id={documentVersionId}>
      {url ? <>
        <UniversalLink to={page && Number.isSafeInteger(page) && page > 0 ? `${url}#page=${page}` : url} target="_blank" rel="noopener noreferrer">{children}</UniversalLink>
        <span role="status">原件已读取，请点击链接在新标签页打开。</span>
      </> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void prepare(); }}>
        {busy ? '正在读取原件…' : '读取原件以预览'}
      </Button>}
      {error ? <span role="alert">{error}</span> : null}
    </span>
  );
}

export function DocumentOriginalInlinePreview({ documentVersionId, page = 1, autoLoad = false }: { documentVersionId: string; page?: number; autoLoad?: boolean }) {
  const { url, busy, error, prepare } = useDocumentOriginalUrl(documentVersionId);

  useEffect(() => {
    if (autoLoad && !url) void prepare();
    // prepare() has a controller guard; deps stay coarse so page-only changes never refetch.
  }, [autoLoad, documentVersionId]);

  return <section className="document-original-inline" aria-label="PDF 原件">
    {url ? <>
      <div className="document-original-inline-label">受控原件 · 第 {page} 页</div>
      <iframe title={`PDF 原件第 ${page} 页`} src={`${url}#page=${page}&view=FitH`} />
      <UniversalLink to={`${url}#page=${page}`} target="_blank" rel="noopener noreferrer">在新标签页打开第 {page} 页</UniversalLink>
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
