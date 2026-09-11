import { useEffect, useRef, useState } from 'react';
import { getCanonicalHostClientSessionGeneration, readDocumentParseImage, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';

/** Image bytes travel through the same platform authorization client as document originals. */
export function DocumentParsedImage({ documentVersionId, parseRunId, path, alt }: {
  documentVersionId: string; parseRunId: string; path: string; alt: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '300px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setUrl(null); setError(false);
    if (!visible) return;
    const controller = new AbortController();
    const generation = getCanonicalHostClientSessionGeneration();
    let objectUrl: string | null = null;
    const clear = () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
    const unsubscribe = subscribeCanonicalHostClientSession(() => { clear(); setUrl(null); setError(true); });
    void readDocumentParseImage(documentVersionId, parseRunId, path, controller.signal).then(blob => {
      if (controller.signal.aborted || generation !== getCanonicalHostClientSessionGeneration()) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { clear(); unsubscribe(); };
  }, [documentVersionId, parseRunId, path, visible, retry]);
  return <span ref={element} className="document-parsed-image">
    {url ? <img src={url} alt={alt} /> : <span role="status">{error ? '图片读取失败，请刷新或检查访问权限。' : '图片正在加载…'}</span>}
    {error && <button type="button" onClick={() => setRetry(value => value + 1)}>重试图片</button>}
  </span>;
}
