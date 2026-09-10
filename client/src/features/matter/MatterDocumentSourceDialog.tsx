import { useEffect, useState } from 'react';
import { readDocumentVersionSourcePage } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';
import { DocumentOriginalPreview } from '@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview';
import type { DocumentSourceReading } from '@shared/document-source-reading.interface';

export default function MatterDocumentSourceDialog({ documentVersionId, sourceRef, onClose }: {
  documentVersionId: string; sourceRef: string | null; onClose: () => void;
}) {
  const prefix = `DOCUMENT_VERSION:${documentVersionId}:page:`;
  const suffix = sourceRef?.startsWith(prefix) ? sourceRef.slice(prefix.length) : '';
  const anchor = /^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(Number(suffix)) ? Number(suffix) : null;
  const [page, setPage] = useState(anchor ?? 1);
  const [reading, setReading] = useState<DocumentSourceReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setReading(null);
    setError(null);
    void readDocumentVersionSourcePage(documentVersionId, page, request.signal).then((value) => {
      if (!request.signal.aborted) setReading(value);
    }).catch((reason: unknown) => {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : '读取未完成');
    });
    return () => request.abort();
  }, [documentVersionId, page, retry]);
  const currentReading = reading?.documentVersionId === documentVersionId && reading.pages[0]?.page === page ? reading : null;
  const selected = currentReading?.pages[0];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>事项材料原文</DialogTitle>
        <DialogDescription>按 PDF 实际页码读取所选版本。下方仅呈现文本层；图表、扫描内容及版面关系请打开原件核对。</DialogDescription>
      </DialogHeader>
      <DocumentOriginalPreview documentVersionId={documentVersionId} page={page}>打开原件第 {page} 页</DocumentOriginalPreview>
      {sourceRef && anchor === null ? <p className="text-sm">该依据没有可定位的页码，当前从第 1 页开始浏览。</p> : null}
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <span>第 {page} 页{currentReading ? ` / ${currentReading.pageCount} 页` : ''}</span>
        <Button variant="outline" disabled={!currentReading || page >= currentReading.pageCount} onClick={() => setPage(page + 1)}>下一页</Button>
      </div>
      {error ? <div role="alert"><p>正文读取失败：{error}</p><Button variant="outline" onClick={() => setRetry(retry + 1)}>重新读取</Button></div> : !currentReading ? <p role="status">正在读取正文…</p> : null}
      {selected ? <>
        {selected.textLayerStatus !== 'PRESENT' ? <p role="status" className="text-sm">本页文本层为空或包含尚未核实的视觉文字，不能据此认定本页没有相关内容。</p> : null}
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7">{selected.text || '未提取到文本，请核对原件。'}</pre>
      </> : null}
    </DialogContent>
  </Dialog>;
}
