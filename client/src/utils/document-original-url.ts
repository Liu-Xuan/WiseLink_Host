import { readReusableDocumentOriginal } from './document-original-memory';
import { useEffect, useRef, useState } from 'react';
import {
  getCanonicalHostClientSessionGeneration,
  subscribeCanonicalHostClientSession,
} from '@client/src/api/canonical-host';

export function useDocumentOriginalUrl(documentVersionId: string) {
  const [preview, setPreview] = useState<{
    url: string;
    documentVersionId: string;
    generation: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const url = preview?.documentVersionId === documentVersionId
    && preview.generation === getCanonicalHostClientSessionGeneration()
    ? preview.url
    : null;

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
    return () => {
      mounted.current = false;
      clear();
      unsubscribe();
    };
  }, [documentVersionId]);

  async function prepare() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const generation = getCanonicalHostClientSessionGeneration();
    const current = () => mounted.current && !request.signal.aborted
      && controller.current === request
      && generation === getCanonicalHostClientSessionGeneration();
    setBusy(true);
    setError(null);
    try {
      const pdf = await readReusableDocumentOriginal(documentVersionId, request.signal);
      if (!current()) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const next = URL.createObjectURL(pdf);
      objectUrl.current = next;
      setPreview({ url: next, documentVersionId, generation });
    } catch (reason: unknown) {
      if (current()) setError(`原件读取失败：${reason instanceof Error ? reason.message : '请求未完成'}。没有打开文件，请重试或检查访问权限。`);
    } finally {
      if (current()) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return { url, busy, error, prepare };
}

