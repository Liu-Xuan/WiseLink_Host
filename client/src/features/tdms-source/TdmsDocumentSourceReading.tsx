import { useCallback, useState } from 'react';
import {
  readTdmsDocumentSource,
  type TdmsSourceBrowserReadContext,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { TdmsDocumentSourceRecord } from './TdmsDocumentSourceRecord';
import { useTdmsReadResource } from './useTdmsReadResource';
import { useTdmsBrowserSession } from './useTdmsBrowserSession';

/** Exact-version browser reading is explicitly authorized by the Host on each GET. */
export function TdmsDocumentSourceReading({ documentVersionId, enabled = true, openDocument }: {
  documentVersionId: string;
  enabled?: boolean;
  openDocument?: (documentVersionId: string) => void;
}) {
  const { authenticationRequired, sessionGeneration } = useTdmsBrowserSession();
  const [refresh, setRefresh] = useState<number>(0);
  const scope: string = JSON.stringify([documentVersionId, sessionGeneration, refresh]);
  const [pagination, setPagination] = useState<{ scope: string; cursors: Array<string | undefined> }>(
    { scope: '', cursors: [undefined] },
  );
  const [deniedScope, setDeniedScope] = useState<string | null>(null);
  const cursors: Array<string | undefined> = pagination.scope === scope ? pagination.cursors : [undefined];
  const after: string | undefined = cursors[cursors.length - 1];
  const onDenied = useCallback((): void => setDeniedScope(scope), [scope]);
  const load = useCallback((signal: AbortSignal) => readTdmsDocumentSource({
    documentVersionId, ...(after ? { after } : {}), limit: 12,
  }, signal), [documentVersionId, after]);
  const active: boolean = enabled && !authenticationRequired && deniedScope !== scope;
  const page = useTdmsReadResource(JSON.stringify([scope, after]), active, load, onDenied);
  const context: TdmsSourceBrowserReadContext = { documentVersionId };
  const reload = (): void => setRefresh((value: number) => value + 1);

  return <section className="tdms-source-reading tdms-document-source-reading" aria-label="TDMS 原始意见与关联记录"
    data-document-version-id={documentVersionId}>
    <header><h3>TDMS 原始意见与关联记录</h3>
      <Button type="button" variant="ghost" size="sm" disabled={authenticationRequired || !enabled}
        onClick={reload}>重新读取</Button></header>
    {authenticationRequired ? <p role="alert">请先登录，再读取来源意见。</p>
      : deniedScope === scope ? <p role="alert">当前账户不能读取此版本的 TDMS 来源，原意见及关系已清除。</p>
        : <>
          {page.loading ? <p role="status">正在读取所选版本的 TDMS 原始记录…</p> : null}
          {page.error ? <p role="alert">{page.error}</p> : null}
          {page.value?.sourceStatus === 'NO_BOUND_RECORDS' ? <p role="status">
            所选版本尚无明确绑定的 TDMS 来源记录；目标未知的意见仍待绑定，不归入本版。
          </p> : null}
          {page.value ? <>
            {page.value.records.length ? <p className="tdms-source-notice">
              本页 {page.value.records.length} 条记录
            </p> : null}
            {page.value.records.map(read => <TdmsDocumentSourceRecord
              key={read.record.sourceRevisionRef} read={read} context={context}
              sessionGeneration={sessionGeneration} enabled={active} onAccessRejected={onDenied}
              monitorScopeKey={scope} onRefresh={reload} openDocument={openDocument} />)}
            <div className="tdms-source-pagination">
              {cursors.length > 1 ? <Button type="button" variant="outline" size="sm"
                onClick={() => setPagination({ scope, cursors: cursors.slice(0, -1) })}>上一页意见</Button> : null}
              {page.value.hasMore && page.value.nextAfter ? <Button type="button" variant="outline" size="sm"
                onClick={() => setPagination({ scope, cursors: [...cursors, page.value!.nextAfter!] })}>下一页意见</Button> : null}
            </div>
          </> : null}
        </>}
  </section>;
}
