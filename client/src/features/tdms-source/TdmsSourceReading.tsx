import { useCallback, useEffect, useRef, useState } from 'react';
import type { TdmsCoverage, TdmsRecordKind } from '@shared/tdms-source.interface';
import { readTdmsSourceCatalogue, readTdmsSourceRecord, readTdmsSourceRelations, type TdmsSourceBrowserReadContext } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { useEngineeringMatterQueryIdentity } from '@client/src/features/matter/useEngineeringMatter';
import DeferredTdmsSourceRelationGraph from './DeferredTdmsSourceRelationGraph';
import { TdmsRecordDetails, TdmsSourceRelations } from './TdmsRecordDetails';
import { tdmsRawCodeLabel, tdmsRecordKindLabel, tdmsSourceVersionLabel } from './tdms-source-presentation';
import { useTdmsReadResource } from './useTdmsReadResource';
import './tdms-source-reading.css';

interface TdmsSourceReadingProps {
  context: TdmsSourceBrowserReadContext;
  enabled?: boolean;
  /**
   * Optional notification from a trusted Host/platform membership observer. It
   * is a cache/visibility invalidation token, never evidence of authorization.
   * Until that observer is connected, GETs remain the only permission check.
   */
  authorizationEpoch?: string | number | null;
  /** A trusted revocation notification hides this reader before any new GET. */
  authorizationDenied?: boolean;
  /** Existing graph pages start with relations; Wiki readers retain their record-first default. */
  graphFirst?: boolean;
  /** Pins must come from an authorized saved work, never from the current directory. */
  exactRevisionRefs?: string[];
  openDocument?: (documentVersionId: string) => void;
  /** Only authorization/missing-source denials trigger a parent saved-work recheck. */
  onAccessRejected?: () => void;
}

function Coverage({ value }: { value: TdmsCoverage }) {
  return <div className="tdms-source-coverage">
    <p>取得覆盖：{value.status === 'COMPLETE' ? '所声明范围完整' : value.status === 'PARTIAL' ? '部分' : '未知'} ·
      读回：{value.readback === 'CONSISTENT' ? '一致' : value.readback === 'NON_ATOMIC' ? '非原子观察，版本可能漂移' : '未核验'}</p>
    {value.gaps.length ? <ul>{value.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul> : null}
  </div>;
}

const recordKinds: TdmsRecordKind[] = ['PROCESSING_SHEET', 'ENGINEER_ASSESSMENT', 'COMMENT', 'ENGINEERING_FILE', 'MANUFACTURER_FILE', 'SOURCE_EVENT', 'OBSERVATION'];

/** Mounted inline by the real document and Matter Wiki consumers; browsing is GET-only. */
export default function TdmsSourceReading({ context, enabled = false, authorizationEpoch = null, authorizationDenied = false,
  graphFirst = false, exactRevisionRefs, openDocument, onAccessRejected }: TdmsSourceReadingProps) {
  const { sessionGeneration, authenticationRequired, currentUser } = useCurrentUserSession();
  const active = enabled && !authenticationRequired;
  const { identity, identityQuery } = useEngineeringMatterQueryIdentity(active, sessionGeneration);
  const contextKey = JSON.stringify([context.matterId ?? null, context.documentVersionId ?? null]);
  const scopeKey = JSON.stringify([identity?.appId, identity?.tenantId, identity?.actorId,
    currentUser.user_id, sessionGeneration, authorizationEpoch, contextKey, exactRevisionRefs ?? null, graphFirst]);
  const [deniedKey, setDeniedKey] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [after, setAfter] = useState<{ scope: string; cursors: Array<string | undefined> }>({ scope: '', cursors: [undefined] });
  const [selection, setSelection] = useState<{ scope: string; revisions: string[] }>({ scope: '', revisions: [] });
  const [relationsSelection, setRelationsSelection] = useState<string | null>(null);
  const [expandedGraphRecord, setExpandedGraphRecord] = useState<{ scope: string; root: string; revision: string } | null>(null);
  const [relationRetry, setRelationRetry] = useState(0);
  const [readRetry, setReadRetry] = useState(0);
  const allowed = active && !authorizationDenied && Boolean(identity) && !identityQuery.isFetching && !identityQuery.error && deniedKey !== scopeKey;
  const notifiedDenial = useRef<string | null>(null);
  const denialEpochKey = JSON.stringify([scopeKey, refresh]);
  const onDenied = useCallback(() => {
    setDeniedKey(scopeKey); setSelection({ scope: '', revisions: [] }); setRelationsSelection(null);
    if (notifiedDenial.current !== denialEpochKey) {
      notifiedDenial.current = denialEpochKey;
      onAccessRejected?.();
    }
  }, [scopeKey, denialEpochKey, onAccessRejected]);
  useEffect(() => {
    if (authorizationDenied) onDenied();
  }, [authorizationDenied, onDenied]);
  // A foregrounded, still-open reader revalidates through the Host before old
  // values can be shown again. An unmounted/re-expanded reader does the same.
  // This does not establish a maximum revocation window while the page is open.
  useEffect(() => {
    if (!allowed) return;
    const revalidate = () => setRefresh(value => value + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowed]);
  const cursors = after.scope === scopeKey ? after.cursors : [undefined];
  const cursor = cursors[cursors.length - 1];
  const revisions = selection.scope === scopeKey ? selection.revisions : [];
  const selected = revisions[revisions.length - 1] ?? null;
  const resourceKey = JSON.stringify([scopeKey, refresh, cursor]);
  const catalogueLoad = useCallback((signal: AbortSignal) => readTdmsSourceCatalogue(context, cursor, signal), [contextKey, cursor]);
  const catalogue = useTdmsReadResource(resourceKey, allowed && exactRevisionRefs === undefined, catalogueLoad, onDenied);
  const graphRecord = graphFirst && expandedGraphRecord?.scope === scopeKey && expandedGraphRecord.root === selected
    ? expandedGraphRecord.revision : null;
  const recordRevision = graphFirst ? graphRecord : selected;
  const detailKey = JSON.stringify([scopeKey, refresh, recordRevision, readRetry]);
  const detailLoad = useCallback((signal: AbortSignal) => readTdmsSourceRecord(recordRevision!, context, signal), [recordRevision, contextKey]);
  const details = useTdmsReadResource(detailKey, allowed && Boolean(recordRevision), detailLoad, onDenied);
  const relationKey = graphFirst ? JSON.stringify([scopeKey, refresh, selected, relationRetry, 'graph']) : `${detailKey}:relations`;
  const relationLoad = useCallback((signal: AbortSignal) => readTdmsSourceRelations(selected!, context, signal), [selected, contextKey]);
  const relations = useTdmsReadResource(relationKey,
    allowed && Boolean(selected) && (graphFirst ? !graphRecord : Boolean(details.value) && relationsSelection === detailKey), relationLoad, onDenied);
  const graphRootSummary = graphFirst ? catalogue.value?.records.find(record => record.sourceRevisionRef === selected) : details.value?.record;

  function reload() {
    setDeniedKey(null); setRefresh(value => value + 1);
    setSelection({ scope: scopeKey, revisions: [] }); setRelationsSelection(null);
    setAfter({ scope: scopeKey, cursors: [undefined] });
    setExpandedGraphRecord(null); setRelationRetry(0); setReadRetry(0);
    if (identityQuery.error) void identityQuery.refetch();
  }
  function openRevision(revision: string) {
    setSelection({ scope: scopeKey, revisions: [...revisions, revision] });
    setRelationsSelection(null); setReadRetry(0); setRelationRetry(0); setExpandedGraphRecord(null);
  }
  function openRecordRevision(revision: string) {
    if (!graphFirst) { openRevision(revision); return; }
    if (!selected) return;
    setExpandedGraphRecord({ scope: scopeKey, root: selected, revision });
    setReadRetry(0);
  }
  function openRecordRelations() {
    if (!graphFirst) {
      setRelationsSelection(relationsSelection === detailKey ? null : detailKey);
      return;
    }
    if (recordRevision && recordRevision !== selected)
      setSelection({ scope: scopeKey, revisions: [...revisions, recordRevision] });
    setExpandedGraphRecord(null); setRelationRetry(0);
  }
  function goBack() {
    if (graphFirst && graphRecord) {
      setExpandedGraphRecord(null); setReadRetry(0);
      return;
    }
    setSelection({ scope: scopeKey, revisions: revisions.slice(0, -1) });
    setRelationsSelection(null); setReadRetry(0); setRelationRetry(0); setExpandedGraphRecord(null);
  }

  return <section className="tdms-source-reading" aria-label="TDMS 来源记录">
    <header><h2>TDMS 来源记录与相关工程文件</h2>
      <button type="button" onClick={reload} disabled={!active}>重新读取来源目录</button></header>
    {context.documentVersionId ? <p>准确文档版本 {context.documentVersionId}</p> : null}
    {exactRevisionRefs !== undefined ? <p>已保存工作的来源引用</p> : null}
    {!active ? <p role="status">{authenticationRequired ? '请先登录，再读取来源。' : '当前来源读取已暂停，待重新核对权限。'}</p>
      : authorizationDenied || deniedKey === scopeKey || identityQuery.error ? <p role="alert">此来源暂不可读取，请重新核对来源与权限。原目录、正文与关系已清除。</p>
      : !allowed ? <p role="status">正在核对当前账户与来源读取范围…</p>
      : <>
        {catalogue.loading ? <p role="status">正在读取来源目录…</p> : null}
        {catalogue.error ? <p role="alert">{catalogue.error}</p> : null}
        {catalogue.value ? <>
          {catalogue.value.sourceStatus === 'DISABLED' ? <p>TDMS 来源尚未接入当前读取范围。</p>
            : !catalogue.value.records.length ? <p>暂无已取得的记录。</p> : null}
          {recordKinds.map(kind => {
            const records = catalogue.value!.records.filter(record => record.recordKind === kind);
            if (!records.length) return null;
            return <section className="tdms-source-directory" key={kind} aria-label={tdmsRecordKindLabel(kind)}>
              <h3>{tdmsRecordKindLabel(kind)} · 本页 {records.length} 条获准目录记录</h3>
              <ul>{records.map(record => <li key={record.sourceRevisionRef}>
                <button type="button" onClick={() => openRevision(record.sourceRevisionRef)}
                  aria-expanded={selected === record.sourceRevisionRef}>{record.title || record.sourceRecordId}</button>
                <p>{tdmsSourceVersionLabel(record.sourceVersion)} · Host 快照 {record.sourceRevisionRef}</p>
                <p>{record.businessVersion ? tdmsSourceVersionLabel(record.businessVersion, '业务文件') : '业务文件版次未取得，不由技术对象修订推定'}</p>
                <p>原始类型 {tdmsRawCodeLabel(record.fileType)} · 源处理状态 {tdmsRawCodeLabel(record.state)}</p>
                <p>观察时间 {record.observedAt} · Host 取得时间 {record.capturedAt} · 来源原生记录 {record.sourceRecordId}</p>
                <Coverage value={record.coverage} />
              </li>)}</ul>
            </section>;
          })}
          {catalogue.value.limitations.length ? <ul>{catalogue.value.limitations.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}
          {cursors.length > 1 ? <button type="button" onClick={() => { setAfter({ scope: scopeKey, cursors: cursors.slice(0, -1) }); setSelection({ scope: '', revisions: [] }); setRelationsSelection(null); }}>上一页来源</button> : null}
          {catalogue.value.hasMore && catalogue.value.nextAfter ? <button type="button" onClick={() => { setAfter({ scope: scopeKey, cursors: [...cursors, catalogue.value!.nextAfter!] }); setSelection({ scope: '', revisions: [] }); setRelationsSelection(null); }}>下一页来源</button> : null}
        </> : null}
        {exactRevisionRefs !== undefined ? exactRevisionRefs.length ? <ul className="tdms-source-directory">
          {exactRevisionRefs.map(ref => <li key={ref}><button type="button" onClick={() => openRevision(ref)}>{graphFirst ? '查看已保存引用的关系概览' : '展开已保存引用'} {ref}</button></li>)}
        </ul> : <p>此工作尚无已保存的原生 TDMS 来源引用。</p> : null}
        {selected ? <section className="tdms-source-expanded" aria-label="TDMS 来源展开">
          <header><h3>{graphFirst && !graphRecord ? '准确来源关系概览' : '准确来源修订'} {recordRevision ?? selected}</h3><button type="button" onClick={goBack}>{graphFirst && graphRecord ? '返回同一准确来源图谱' : revisions.length > 1 ? '返回上一准确来源' : '返回来源目录'}</button></header>
          {graphFirst && !graphRecord ? <>
            {relations.loading ? <p role="status">正在读取此准确修订的获准关系…</p> : null}
            {relations.error ? <p role="alert">{relations.error} <button type="button" onClick={() => setRelationRetry(value => value + 1)}>重试此准确关系</button></p> : null}
            {relations.value ? <>
              <DeferredTdmsSourceRelationGraph key={relationKey} enabled={allowed} reading={relations.value} rootRecord={graphRootSummary}
                onOpenEndpoint={endpoint => {
                  if (endpoint.kind === 'NATIVE_RECORD_REVISION') openRecordRevision(endpoint.sourceRevisionRef);
                  else if (endpoint.kind === 'DOCUMENT_VERSION') openDocument?.(endpoint.documentVersionId);
                }} />
            </> : null}
          </> : null}
          {details.loading ? <p role="status">正在授权读取此准确修订…</p> : null}
          {details.error ? <p role="alert">{details.error} <button type="button" onClick={() => { setReadRetry(value => value + 1); setRelationsSelection(null); }}>重试此修订</button></p> : null}
          {details.value ? <>
            <p className="tdms-source-read-receipt">此准确源记录已读回 · {details.value.receipt.readAt}</p>
            <Coverage value={details.value.record.coverage} />
            <TdmsRecordDetails read={details.value} openDocument={openDocument} />
            <button type="button" onClick={openRecordRelations}
              aria-expanded={!graphFirst && relationsSelection === detailKey}>{graphFirst ? '查看此准确记录的关系概览' : relationsSelection === detailKey ? '收起来源关系' : '授权读取此修订的来源关系'}</button>
            {relations.loading ? <p role="status">正在读取此准确修订的获准关系…</p> : null}
            {relations.error ? <p role="alert">{relations.error}</p> : null}
            {relations.value ? <>
              <DeferredTdmsSourceRelationGraph key={relationKey} enabled={allowed} reading={relations.value} rootRecord={details.value.record}
                onOpenEndpoint={endpoint => {
                  if (endpoint.kind === 'NATIVE_RECORD_REVISION') openRevision(endpoint.sourceRevisionRef);
                  else if (endpoint.kind === 'DOCUMENT_VERSION') openDocument?.(endpoint.documentVersionId);
                }}
                onClose={() => setRelationsSelection(null)} />
              <TdmsSourceRelations read={relations.value} onOpen={openRevision} openDocument={openDocument} />
            </> : null}
          </> : null}
        </section> : null}
      </>}
  </section>;
}
