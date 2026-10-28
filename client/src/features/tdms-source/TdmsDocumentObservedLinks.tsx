import { useCallback, useState } from 'react';
import { readTdmsDocumentObservedLinks } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import { TdmsRecordDetails } from './TdmsRecordDetails';
import { useTdmsReadResource } from './useTdmsReadResource';

/** Independent associations never assert that a child is directly bound to the DVI. */
export function TdmsDocumentObservedLinks({
  documentVersionId, rootRevisionRef, parentPath, sessionGeneration, enabled,
  onAccessRejected, monitorScopeKey, onRefresh, openDocument,
}: {
  documentVersionId: string;
  rootRevisionRef: string;
  parentPath: string[];
  sessionGeneration: number;
  enabled: boolean;
  onAccessRejected: () => void;
  monitorScopeKey: string;
  onRefresh: () => void;
  openDocument?: (documentVersionId: string) => void;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const pathKey = JSON.stringify(parentPath);
  const scope = JSON.stringify([documentVersionId, rootRevisionRef, pathKey, sessionGeneration, monitorScopeKey]);
  const [pagination, setPagination] = useState<{ scope: string; cursors: Array<string | undefined> }>(
    { scope: '', cursors: [undefined] },
  );
  const cursors = pagination.scope === scope ? pagination.cursors : [undefined];
  const after = cursors[cursors.length - 1];
  const load = useCallback((signal: AbortSignal) => readTdmsDocumentObservedLinks({
    documentVersionId, rootRevisionRef, parentPath: JSON.parse(pathKey) as string[],
    ...(after ? { after } : {}), limit: 12,
  }, signal), [documentVersionId, rootRevisionRef, pathKey, after]);
  const page = useTdmsReadResource(JSON.stringify([scope, after]), enabled && open, load, onAccessRejected);

  return <details className="tdms-observed-links" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>来源中观察到的关联</summary>
    <p className="tdms-source-notice">仅列已保留来源中的关联观察；适用性、当前性和完整性均未确认。</p>
    {page.loading ? <p role="status">正在核对来源关联…</p> : null}
    {page.error ? <p role="alert">{page.error}</p> : null}
    {page.value?.diagnostic === 'NO_OBSERVED_LINKS' ? <p>未取得可核对的来源关联。</p> : null}
    {page.value?.diagnostic === 'PARENT_BODY_WITHHELD' ? <p>此记录仅可读取元数据，关联正文未展开。</p> : null}
    {page.value?.gaps.includes('PARENT_METADATA_CAPTURE_NOT_RETAINED') ? <p role="status">
      对应的来源父观察尚未保留，暂不能确认此关联。
    </p> : null}
    {page.value?.links.map(link => <section key={`${link.evidence.candidateAssertionRef}:${link.evidence.childRevisionRef}`}>
      <p>来源观察 {link.evidence.parentObservedAt} → 子记录观察 {link.evidence.childObservedAt}</p>
      <p>来源位置 {link.evidence.tableId} · {link.evidence.occurrenceId} · 链接 {link.evidence.linkIndex + 1}</p>
      <TdmsRecordDetails read={link.child} openDocument={openDocument}
        monitorScopeKey={monitorScopeKey} onRefresh={onRefresh} />
      {parentPath.length < 4 && canReadTdmsSourceBody(link.child) ? <TdmsDocumentObservedLinks
        documentVersionId={documentVersionId} rootRevisionRef={rootRevisionRef}
        parentPath={[...parentPath, link.evidence.childRevisionRef]} sessionGeneration={sessionGeneration}
        enabled={enabled && open} onAccessRejected={onAccessRejected} monitorScopeKey={monitorScopeKey}
        onRefresh={onRefresh} openDocument={openDocument} /> : null}
    </section>)}
    {page.value ? <div className="tdms-source-pagination">
      {cursors.length > 1 ? <Button type="button" variant="outline" size="sm"
        onClick={() => setPagination({ scope, cursors: cursors.slice(0, -1) })}>上一页关联</Button> : null}
      {page.value.hasMore && page.value.nextAfter ? <Button type="button" variant="outline" size="sm"
        onClick={() => setPagination({ scope, cursors: [...cursors, page.value!.nextAfter!] })}>下一页关联</Button> : null}
    </div> : null}
  </details>;
}
