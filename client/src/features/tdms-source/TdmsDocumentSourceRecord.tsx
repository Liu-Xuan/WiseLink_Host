import { useCallback, useState } from 'react';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import {
  readTdmsSourceHistory, readTdmsSourceRecord, readTdmsSourceRelations,
  type TdmsSourceBrowserReadContext,
} from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';
import { TdmsRecordDetails, TdmsSourceRelations } from './TdmsRecordDetails';
import { tdmsRawCodeLabel, tdmsRecordKindLabel, tdmsSourceVersionLabel } from './tdms-source-presentation';
import { useTdmsReadResource } from './useTdmsReadResource';

export function TdmsDocumentSourceRecord({ read, context, sessionGeneration, enabled, onAccessRejected }: {
  read: TdmsFileServiceRecordReadResponse;
  context: TdmsSourceBrowserReadContext;
  sessionGeneration: number;
  enabled: boolean;
  onAccessRejected: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [relationsOpen, setRelationsOpen] = useState<boolean>(false);
  const [historyCursors, setHistoryCursors] = useState<Array<string | undefined>>([undefined]);
  const [selectedRevision, setSelectedRevision] = useState<string>('');
  const [retry, setRetry] = useState<number>(0);
  const revision: string = read.record.sourceRevisionRef;
  const versionId: string = context.documentVersionId ?? '';
  const scope: string = JSON.stringify([versionId, revision, sessionGeneration, retry]);
  const after: string | undefined = historyCursors[historyCursors.length - 1];
  const historyLoad = useCallback((signal: AbortSignal) => readTdmsSourceHistory(
    revision, { documentVersionId: versionId }, after, signal,
  ), [revision, versionId, after]);
  const history = useTdmsReadResource(`${scope}:history:${after ?? ''}`,
    enabled && historyOpen, historyLoad, onAccessRejected);
  const recordLoad = useCallback(async (signal: AbortSignal): Promise<TdmsFileServiceRecordReadResponse> => {
    const result: TdmsFileServiceRecordReadResponse = await readTdmsSourceRecord(
      selectedRevision, { documentVersionId: versionId }, signal,
    );
    if (!result.record.relatedDocumentVersionIds.includes(versionId))
      throw new Error('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH');
    return result;
  }, [selectedRevision, versionId]);
  const historical = useTdmsReadResource(`${scope}:record:${selectedRevision}`,
    enabled && Boolean(selectedRevision), recordLoad, onAccessRejected);
  const relationsLoad = useCallback((signal: AbortSignal) => readTdmsSourceRelations(
    revision, { documentVersionId: versionId }, signal,
  ), [revision, versionId]);
  const relations = useTdmsReadResource(`${scope}:relations`, enabled && relationsOpen,
    relationsLoad, onAccessRejected);

  return <section className="tdms-document-record" aria-label={`${tdmsRecordKindLabel(read.record.recordKind)} ${read.record.title}`}>
    <TdmsRecordDetails read={read} />
    <details onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>该来源记录的修订历史</summary>
      {history.loading ? <p role="status">正在读取源修订历史…</p> : null}
      {history.error ? <p role="alert">{history.error}</p> : null}
      {history.value ? <>
        <ul>{history.value.versions.map(version => <li key={version.sourceRevisionRef}>
          <p>{tdmsSourceVersionLabel(version.sourceVersion)} · {tdmsRawCodeLabel(version.state)}</p>
          <p>{version.businessVersion ? tdmsSourceVersionLabel(version.businessVersion, '业务文件') : '业务版次未取得'}
            · 取得时间 {version.capturedAt}</p>
          {version.relatedDocumentVersionIds.includes(versionId) ? <Button type="button" variant="outline" size="sm"
            onClick={() => setSelectedRevision(version.sourceRevisionRef)}>
            阅读{version.selectedHead ? '选定' : '历史'}源修订
          </Button> : <p className="tdms-source-eligibility-notice">该修订未明确绑定所选版本，不作为本版意见展开。</p>}
        </li>)}</ul>
        <div className="tdms-source-pagination">
          {historyCursors.length > 1 ? <Button type="button" variant="outline" size="sm"
            onClick={() => { setHistoryCursors(historyCursors.slice(0, -1)); setSelectedRevision(''); }}>上一页历史</Button> : null}
          {history.value.hasMore && history.value.nextAfter ? <Button type="button" variant="outline" size="sm"
            onClick={() => { setHistoryCursors([...historyCursors, history.value!.nextAfter!]); setSelectedRevision(''); }}>下一页历史</Button> : null}
        </div>
      </> : null}
    </details>
    <details onToggle={event => setRelationsOpen(event.currentTarget.open)}>
      <summary>处理单、专业评估单与附件的来源关系</summary>
      {relations.loading ? <p role="status">正在读取准确来源关系…</p> : null}
      {relations.error ? <p role="alert">{relations.error}</p> : null}
      {relations.value ? <TdmsSourceRelations read={relations.value} onOpen={setSelectedRevision} /> : null}
    </details>
    {selectedRevision ? <section className="tdms-source-expanded" aria-label="所选来源修订">
      <header><h4>所选准确来源修订</h4><Button type="button" variant="ghost" size="sm"
        onClick={() => setSelectedRevision('')}>收起修订</Button></header>
      {historical.loading ? <p role="status">正在读取准确来源修订…</p> : null}
      {historical.error ? <p role="alert">{historical.error}</p> : null}
      {historical.value ? <TdmsRecordDetails read={historical.value} /> : null}
    </section> : null}
    {history.error || historical.error || relations.error ? <Button type="button" variant="outline" size="sm"
      onClick={() => setRetry((value: number) => value + 1)}>重试此记录</Button> : null}
  </section>;
}
