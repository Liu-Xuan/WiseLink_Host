import { useCallback, useEffect, useRef, useState } from 'react';
import type { LcmMatrixResponse, LcmMatrixQuery, LcmMatrixDetailRequest } from '@shared/lcm-matrix.interface';
import { readLcmNativeMatrixDetails, downloadLcmOriginal } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@client/src/components/ui/dialog';
import { LcmSnapshotRecords } from './LcmSnapshotRecords';
import { lcmModelLabel, lcmRecordPresentation, lcmSnapshotStateDate } from './lcm-source-presentation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@client/src/components/ui/select';
import { useLcmMatrixResource } from './useLcmMatrixResource';
import { lcmBindingKey, lcmMatrixAccessLost } from './lcm-matrix-route';
import type { LcmMatrixSelection } from './LcmMatrixGrid';

export function LcmEvidenceDrawer({ query, matrix, selection, onClose, onLost, onSort }: {
  query: LcmMatrixQuery; matrix: LcmMatrixResponse; selection: LcmMatrixSelection | null;
  onClose(): void; onLost(): void; onSort(ref: string): void;
}) {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const triggerRef = useRef<HTMLElement | null>(null);
  const key = JSON.stringify([sessionGeneration, lcmBindingKey(matrix.binding), query, selection]);
  const currentKey = useRef(key); currentKey.current = key;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [download, setDownload] = useState<{ key: string; busy: boolean; error: string } | null>(null);
  const [originalSelection, setOriginalSelection] = useState<{ key: string; snapshotId: string } | null>(null);
  const [page, setPage] = useState<{ key: string; cursors: Array<string | undefined> }>({ key: '', cursors: [undefined] });
  const cursors = page.key === key ? page.cursors : [undefined];
  const after = cursors[cursors.length - 1];
  const requestKey: string = JSON.stringify({
    query, binding: matrix.binding, softwareRef: selection?.softwareRef,
    ...(selection?.aircraftRef ? { aircraftRef: selection.aircraftRef } : {}),
    ...(selection?.partNumber === undefined ? {} : { partNumber: selection.partNumber }),
    ...(after ? { after } : {}),
  });
  // Matrix window responses recreate binding/selection objects. Their semantic request must stay
  // stable so a normal refresh does not abort and immediately reuse the same cancelled query.
  const load = useCallback((signal: AbortSignal) => readLcmNativeMatrixDetails(
    JSON.parse(requestKey) as LcmMatrixDetailRequest, signal), [requestKey]);
  const detail = useLcmMatrixResource(key + ':' + (after ?? ''), Boolean(selection) && !authenticationRequired, load, onLost);
  const software = matrix.softwareIndex.find(group => group.softwareRef === selection?.softwareRef);
  const snapshots = [...new Map(detail.value?.records.map(entry =>
    [entry.snapshot.snapshotId, entry.snapshot]) ?? []).values()];
  const originals = snapshots.filter(snapshot => snapshot.originalAvailability === 'HOST_FILE_SERVICE');
  const selectedOriginal = originals.find(snapshot => originalSelection?.key === key &&
    snapshot.snapshotId === originalSelection.snapshotId) ?? originals[0];
  async function original(snapshotId: string, filename: string): Promise<void> {
    const started: string = key;
    setDownload({ key: started, busy: true, error: '' });
    try {
      const blob: Blob = await downloadLcmOriginal(snapshotId);
      if (!mounted.current || currentKey.current !== started) return;
      const url: string = URL.createObjectURL(blob), link: HTMLAnchorElement = document.createElement('a');
      link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownload({ key: started, busy: false, error: '' });
    } catch (error: unknown) {
      if (!mounted.current || currentKey.current !== started) return;
      if (lcmMatrixAccessLost(error)) onLost();
      setDownload({ key: started, busy: false, error: '原件读取失败，可重新读取。' });
    }
  }
  return <Dialog open={Boolean(selection)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="mx-dialog mx-evidence" onOpenAutoFocus={() => {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }} onCloseAutoFocus={event => {
      // Virtualized triggers may leave the DOM while details are open.
      const target = triggerRef.current?.isConnected ? triggerRef.current
        : document.querySelector<HTMLElement>('[role="treegrid"], [aria-label="搜索 LCM 软件名称或完整件号"]');
      if (target) { event.preventDefault(); target.focus(); }
    }}>
      <DialogTitle>{software?.lcmSoftwareName ?? '软件名称未取得'}</DialogTitle>
      <DialogDescription>所选快照中的 PN、FIN、允装与实装记录。</DialogDescription>
      <div className="flex flex-wrap items-center gap-2">
        {software ? <Button variant="outline" size="sm" onClick={() => onSort(software.softwareRef)}>
          排列飞机列</Button> : null}
        {originals.length > 1 ? <Select value={selectedOriginal?.snapshotId}
          onValueChange={snapshotId => setOriginalSelection({ key, snapshotId })}>
          <SelectTrigger className="max-w-full" aria-label="选择原始 Excel"><SelectValue /></SelectTrigger>
          <SelectContent>{originals.map(snapshot => <SelectItem key={snapshot.snapshotId} value={snapshot.snapshotId}>
            {snapshot.originalFileName}</SelectItem>)}</SelectContent>
        </Select> : null}
        {selectedOriginal ? <Button variant="outline" size="sm" disabled={download?.key === key && download.busy}
          onClick={() => void original(selectedOriginal.snapshotId, selectedOriginal.originalFileName)}>
          下载原件</Button> : null}
      </div>
      {download?.key === key && download.error ? <p role="alert">{download.error}</p> : null}
      {detail.loading ? <p role="status">正在读取源记录…</p> : null}
      {detail.error ? <p role="alert">{detail.error}</p> : null}
      {detail.value ? <>
        <details className="mx-source-details"><summary>来源详情</summary>
          <p className="mx-pn mx-binding">{matrix.binding.readSetRef}</p>
          {software?.aliases.length ? <dl>{software.aliases.map(alias => <div key={alias.alias + alias.evidenceRef}>
            <dt>受控别名</dt><dd>{alias.alias} · {alias.evidenceRef}</dd></div>)}</dl> : null}
          {detail.value.originalUnavailableReason === 'LOCAL_REFERENCE_ONLY'
            ? <p>原件当前仅有本地来源引用。</p> : null}
          {snapshots.map(snapshot => <dl key={snapshot.snapshotId}>
            <div><dt>文件</dt><dd>{snapshot.originalFileName}</dd></div>
            <div><dt>快照状态日</dt><dd>{lcmSnapshotStateDate(snapshot) ?? '未识别'}</dd></div>
            <div><dt>源数据截止日期</dt><dd>{snapshot.sourceDataCutoffDate ?? '未取得'}</dd></div>
            <div><dt>来源观察</dt><dd>{snapshot.sourceObservedAt ?? snapshot.sourceObservedDate ?? '未取得'}
              {' · '}{snapshot.sourceTimePrecision} · {snapshot.sourceTimeZone ?? '时区未取得'}</dd></div>
            <div><dt>Host 接收时间</dt><dd>{snapshot.importedAt}</dd></div>
            <div><dt>来源 / 采集引用</dt><dd>{snapshot.sourceInstanceId} · {snapshot.collectionId}</dd></div>
            <div><dt>准确快照</dt><dd className="mx-pn">{snapshot.snapshotId}</dd></div>
            <div><dt>原件 SHA256</dt><dd className="mx-pn">{snapshot.originalSha256}</dd></div>
          </dl>)}
        </details>
        <div className="mx-evidence-records">{detail.value.records.map(entry => {
          const presentation = lcmRecordPresentation(entry.record);
          return <article className="library-lcm-record" data-lcm-record-id={entry.record.recordId}
            key={JSON.stringify([entry.snapshot.snapshotId, entry.record.recordId])}>
            <header><strong>{presentation.softwareName}</strong><span>{entry.record.partNumber ?? '软件件号未取得'}</span></header>
            <dl className="suite-library-key-facts">
              <div><dt>机型 / 机尾</dt><dd title={entry.record.aircraftModel}>{lcmModelLabel(entry.record.aircraftModel)} · {entry.record.tailNumber}</dd></div>
              <div><dt>FIN</dt><dd>{entry.record.fields['FIN号'] || '—'}</dd></div>
              <div><dt>允装</dt><dd>{presentation.allowed}</dd></div>
              <div><dt>实装</dt><dd>{presentation.installed}</dd></div>
              <div><dt>文件</dt><dd>{entry.snapshot.originalFileName}</dd></div>
            </dl>
            <details><summary>原始字段与行出处</summary><LcmSnapshotRecords records={[entry.record]} /></details>
          </article>;
        })}
          {!detail.value.records.length ? <p>没有匹配源记录。</p> : null}
        </div>
      </> : null}
      <div className="mx-pagination">
        {cursors.length > 1 ? <Button variant="outline" size="sm"
          onClick={() => setPage({ key, cursors: cursors.slice(0, -1) })}>上一页记录</Button> : null}
        {detail.value?.nextAfter ? <Button variant="outline" size="sm"
          onClick={() => setPage({ key, cursors: [...cursors, detail.value!.nextAfter!] })}>下一页记录</Button> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
