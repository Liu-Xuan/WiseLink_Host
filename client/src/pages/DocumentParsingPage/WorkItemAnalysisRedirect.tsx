import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { Button } from '@client/src/components/ui/button';
import type { CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import { getCanonicalHostClientSessionGeneration, getCanonicalLibraryQuicklook,
  isCanonicalHostClientSessionAuthenticationRequired, subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';
import { getWorkbenchPanel } from './document-parsing-navigation';
import { documentVersionAnalysisRoute } from './document-analysis-route';

/** Compatibility entry only: resolve an existing authorized task, then replace the route. */
export default function WorkItemAnalysisRedirect() {
  const location = useLocation();
  const { workItemId = '' } = useParams<{ workItemId: string }>();
  const [session, setSession] = useState(getCanonicalHostClientSessionGeneration);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ scope: string; route?: string; error?: string } | null>(null);
  const scope: string = JSON.stringify([workItemId, location.search, session]);
  useEffect(() => subscribeCanonicalHostClientSession(() => {
    setState(null); setSession(getCanonicalHostClientSessionGeneration());
  }), []);
  useEffect(() => {
    const controller: AbortController = new AbortController();
    if (isCanonicalHostClientSessionAuthenticationRequired()) return;
    setState(null);
    const current = (): boolean => !controller.signal.aborted &&
      session === getCanonicalHostClientSessionGeneration() && !isCanonicalHostClientSessionAuthenticationRequired();
    void getCanonicalLibraryQuicklook(workItemId, controller.signal).then((association: CanonicalLibraryQuicklookResponse) => {
      if (!current()) return;
      if (association.document.workItemId !== workItemId) throw new Error('评估工作定位与读取结果不一致。');
      const params: URLSearchParams = new URLSearchParams(location.search);
      setState({ scope, route: documentVersionAnalysisRoute(association.document.documentVersionId,
        workItemId, getWorkbenchPanel(params), params) });
    }).catch((reason: unknown) => {
      if (current()) setState({ scope, error: reason instanceof Error ? reason.message : '评估关联暂未读回，请重试。' });
    });
    return () => controller.abort();
  }, [scope, workItemId, location.search, session, retry]);
  const visible = state?.scope === scope && session === getCanonicalHostClientSessionGeneration() &&
    !isCanonicalHostClientSessionAuthenticationRequired() ? state : null;
  if (visible?.route) return <Navigate replace to={`${visible.route}${location.hash}`} />;
  return <section aria-label="打开文档版本评估">
    {visible?.error ? <p role="alert">{visible.error}</p> : <p role="status">正在核对评估工作与文档版本…</p>}
    {visible?.error ? <Button variant="outline" onClick={() => setRetry((value: number) => value + 1)}>重试读取</Button> : null}
    <Button variant="ghost" asChild><Link to="/library?mode=tasks">返回资料库</Link></Button>
  </section>;
}
