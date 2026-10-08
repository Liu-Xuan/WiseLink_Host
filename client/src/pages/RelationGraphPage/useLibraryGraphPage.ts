import { useEffect, useState } from 'react';
import type { CanonicalLibraryGraphRequest, CanonicalLibraryGraphResponse } from '@shared/library-graph.interface';
import { getCanonicalHostClientSessionGeneration, summarizeCanonicalDocumentReadFailure } from '@client/src/api/canonical-host';
import { libraryReadErrorPresentation } from '@client/src/pages/WorkspaceHomePage/library-read-error';
import { readLibraryGraphPage } from './library-graph-read';
export function useLibraryGraphPage(request:CanonicalLibraryGraphRequest,session:number,denied:boolean) {
  const [retry,setRetry] = useState(0);
  const key = JSON.stringify([request,session,denied,retry]);
  const [state,setState] = useState<{key:string;page:CanonicalLibraryGraphResponse|null;error:string|null;cursorInvalid:boolean}>({key:'',page:null,error:null,cursorInvalid:false});
  useEffect(() => {
    if (denied) return;
    const controller = new AbortController();
    setState({key,page:null,error:null,cursorInvalid:false});
    const current = () => !controller.signal.aborted && getCanonicalHostClientSessionGeneration() === session;
    void readLibraryGraphPage(request,controller.signal).then(page => {
      if (current()) setState({key,page,error:null,cursorInvalid:false});
    }).catch(reason => {
      if (!current()) return;
      const code = summarizeCanonicalDocumentReadFailure(reason).code ?? (reason instanceof Error ? reason.message : '');
      const cursorInvalid = code === 'LIBRARY_GRAPH_CURSOR_INVALID';
      const deniedScope = ['CANONICAL_WORK_ITEM_NOT_FOUND','FORBIDDEN'].includes(code);
      setState({key,page:null,cursorInvalid,error:cursorInvalid
        ? '分页范围已变化或游标不可用。旧页已清除，请重新读取同一范围首页。'
        : deniedScope ? '当前账户无法读取此目录范围。已清除本页对象，请重新核对授权。' : libraryReadErrorPresentation(reason).message});
    });
    return () => controller.abort();
  },[key,session,denied]);
  const visible = !denied && state.key === key ? state : null;
  return {page:visible?.page ?? null,error:denied ? '请先登录，再读取当前账户可访问的资料。' : visible?.error ?? null,
    cursorInvalid:visible?.cursorInvalid ?? false, refresh:() => setRetry(value => value+1)};
}
