import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TdmsRecordDetails, TdmsSourceRelations } from '@client/src/features/tdms-source/TdmsRecordDetails';
import { tdmsRecordKindLabel, tdmsSourceVersionLabel } from '@client/src/features/tdms-source/tdms-source-presentation';
import { appendSuiteTdmsSources } from './suite-tdms-source-projection';
import { useSuiteTdmsSources } from './useSuiteTdmsSources';
import type { SuiteTdmsSourceLayerProps } from './SuiteTdmsSourceLayer';

export default function EnabledSuiteTdmsSourceLayer(props: SuiteTdmsSourceLayerProps) {
  const [hold, setHold] = useState(false);
  const [sourceAccessEpoch, setSourceAccessEpoch] = useState(0);
  const active = useRef(true);
  const recheckEpoch = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; recheckEpoch.current++; };
  }, []);
  const rejected = useCallback(() => {
    setHold(true);
    const epoch = ++recheckEpoch.current;
    void props.onAccessRejected().then(() => {
      if (active.current && epoch === recheckEpoch.current) setHold(false);
    }, () => undefined);
  }, [props.onAccessRejected]);
  const tdms = useSuiteTdmsSources({ matterId: props.matterId, workRef: props.workRef,
    session: props.session, sourceAccessEpoch, enabled: !hold,
    allowCurrentSources: props.allowCurrentSources, onAccessRejected: rejected });
  const projected = useMemo(() => {
    if (hold || tdms.accessBlocked) return { read: props.read, failed: false };
    try {
      return { read: appendSuiteTdmsSources(props.read, {
        records: props.allowCurrentSources && tdms.catalogue.value?.sourceStatus === 'AVAILABLE' ? tdms.catalogue.value.records : [],
        relations: props.allowCurrentSources && tdms.relations.value ? [tdms.relations.value] : [],
      }), failed: false };
    } catch { return { read: props.read, failed: true }; }
  }, [props.read, props.allowCurrentSources, hold, tdms.accessBlocked, tdms.catalogue.value, tdms.relations.value]);
  if (hold) return <section role="alert">来源权限待核，相关图谱与正文已隐藏。
    <button onClick={rejected}>重新核权</button></section>;
  return <>
    {props.children(projected.read, tdms.readBody)}
    <section aria-label="TDMS 来源目录">
      {props.allowCurrentSources ? <button onClick={tdms.toggle} aria-expanded={tdms.opened}>
        {tdms.opened ? '收起 TDMS 来源目录' : '读取 TDMS 来源目录'}</button>
        : <p>已保存工作的来源引用</p>}
      {projected.failed ? <p role="alert">来源投影身份核对失败，已清除来源节点与关系。</p> : null}
      {tdms.accessBlocked ? <p role="alert">此来源暂不可读取，原来源节点与正文已清除。
        <button onClick={() => { setSourceAccessEpoch(value => value + 1); tdms.retryAccess(); }}>重新核权来源</button></p> : null}
      {tdms.unavailable ? <p role="status">{tdms.unavailableText}</p> : null}
      {tdms.catalogue.loading ? <p role="status">正在读取来源目录…</p> : null}
      {tdms.catalogue.error ? <p role="alert">{tdms.catalogue.error}</p> : null}
      {tdms.catalogue.value?.sourceStatus === 'DISABLED' ? <p>来源尚未接入此读取范围。</p> : null}
      {tdms.catalogue.value?.sourceStatus === 'AVAILABLE' ? <ul>{tdms.catalogue.value.records.map(record => <li key={record.sourceRevisionRef}>
        {record.title || record.sourceRecordId} · {tdmsRecordKindLabel(record.recordKind)} · {tdmsSourceVersionLabel(record.sourceVersion)}
        <button onClick={() => tdms.readRelations(record.sourceRevisionRef)}>读取此准确来源关系</button>
        <button onClick={() => tdms.readBody(record.sourceRevisionRef)}>读取此准确来源正文</button>
      </li>)}</ul> : null}
      {tdms.opened ? <>
        <button onClick={tdms.refreshCatalogue}>重新读取 TDMS 来源目录</button>
        {tdms.hasPrevious ? <button onClick={tdms.previousPage}>上一页 TDMS 来源</button> : null}
        {tdms.catalogue.value?.hasMore && tdms.catalogue.value.nextAfter ? <button onClick={tdms.nextPage}>下一页 TDMS 来源</button> : null}
      </> : null}
      {tdms.relations.loading ? <p role="status">正在读取准确来源关系…</p> : null}
      {tdms.relations.error ? <p role="alert">{tdms.relations.error}</p> : null}
      {tdms.relations.value ? <TdmsSourceRelations read={tdms.relations.value} onOpen={tdms.readBody} openDocument={props.openDocument} /> : null}
      {tdms.body.loading ? <p role="status">正在读取准确来源正文…</p> : null}
      {tdms.body.error ? <p role="alert">{tdms.body.error}</p> : null}
      {tdms.body.value ? <><TdmsRecordDetails read={tdms.body.value} openDocument={props.openDocument}
        monitorScopeKey={JSON.stringify([props.session, props.matterId, props.workRef, sourceAccessEpoch])}
        onRefresh={() => tdms.readBody(tdms.body.value!.record.sourceRevisionRef)} />
        <button onClick={tdms.closeBody}>收起准确来源正文</button></> : null}
    </section>
  </>;
}
