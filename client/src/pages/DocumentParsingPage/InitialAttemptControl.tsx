import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CanonicalInitialAttemptRead } from '@shared/api.interface';
import { getCanonicalHostClientSessionGeneration, subscribeCanonicalHostClientSession,
  readInitialAttemptControl, reconcileExpiredInitialAttempt } from '@client/src/api/canonical-host';
import { Button } from '@client/src/components/ui/button';

/** Reads and writes only on separate explicit clicks. Never reconciles while polling. */
export default function InitialAttemptControl({workItemId,attemptId,attemptRef,onChanged}: {
  workItemId:string;attemptId:string;attemptRef:string;onChanged?:()=>void;
}) {
  const session = useSyncExternalStore(subscribeCanonicalHostClientSession,getCanonicalHostClientSessionGeneration,
    getCanonicalHostClientSessionGeneration);
  const scope = `${session}:${workItemId}:${attemptId}:${attemptRef}`;
  const live = useRef(scope); live.current = scope;
  const pending = useRef<AbortController|null>(null);
  const [read,setRead] = useState<{scope:string;value:CanonicalInitialAttemptRead}|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  useEffect(()=>{setRead(null);setError(null);setBusy(false);
    return ()=>{pending.current?.abort();};},[scope]);
  const value = read?.scope === scope ? read.value : null;
  function valid(value:CanonicalInitialAttemptRead) {
    if(value.schemaVersion!=='wiselink.initial-attempt-control.v1' || value.workItemId!==workItemId ||
      value.attemptId!==attemptId || value.attemptRef!==attemptRef || !Number.isFinite(Date.parse(value.observedAt)))
      throw new Error('执行记录不匹配，未执行结束操作。');
    return value;
  }
  async function inspect() {
    const key=scope; const controller=new AbortController();pending.current?.abort();pending.current=controller;
    setBusy(true);setError(null);
    try {const value=valid(await readInitialAttemptControl(workItemId,{attemptId,attemptRef},controller.signal));
      if(live.current===key&&!controller.signal.aborted)setRead({scope:key,value});
    } catch(error) {if(live.current===key&&!controller.signal.aborted){setRead(null);setError(error instanceof Error?error.message:'核对未完成。');}}
    finally {if(live.current===key&&!controller.signal.aborted)setBusy(false);}
  }
  async function reconcile() {
    if(!value || value.reconciliation!=='ELIGIBLE' || busy)return;
    const key=scope;setBusy(true);setError(null);
    try {const receipt=await reconcileExpiredInitialAttempt(workItemId,{operation:'RECONCILE_EXPIRED',attemptId,attemptRef,
      stageRequestId:value.stageRequestId,expectedRevision:value.workItemRevision,expectedLeaseGeneration:value.leaseGeneration});
      const current=valid(receipt.attempt);
      if(live.current===key){setRead({scope:key,value:current});onChanged?.();}
    } catch(error) {if(live.current===key){setRead(null);setError(error instanceof Error?error.message:'结束操作未确认，请重新核对。');}}
    finally {if(live.current===key)setBusy(false);}
  }
  return <details className="wl-process-detail"><summary>本次执行核对与结束</summary>
    <p>核对原请求的保存与提交记录。只有已过原期限且尚未保存或提交的执行，才可由本人明确结束。</p>
    <Button type="button" variant="outline" disabled={busy} onClick={inspect}>{busy?'处理中…':'核对本次执行'}</Button>
    {error?<p role="alert">{error}</p>:null}
    {value?<div><p>Host 状态：{value.status}；原截止：{value.deadline}</p>
      <p>本次已保存工作：{value.savedWorks.length}；提交已开始：{value.commitStartedAt?'是':'否'}；持久结果：{value.hasPersistedResult?'有':'无'}</p>
      <p>核对时间：{value.observedAt}</p>
      {value.consumerOutcome==='UNKNOWN'?<p>调用方记录仍为 UNKNOWN；结束 Host 期限不会把它改为成功或失败。</p>:null}
      {value.reconciliation==='PROTECTED'?<p>当前不能结束：{protectionReason(value.protectionCode)}</p>:null}
      {value.reconciliation==='ALREADY_TIMED_OUT'?<p>该执行已按原期限结束；未创建新任务。</p>:null}
      {value.reconciliation==='ELIGIBLE'?<>
        <p>只结束这次执行。原响应、未知结果与保存记录保留，不重试评估。</p>
        <Button type="button" variant="outline" disabled={busy} onClick={reconcile}>结束已过期且未保存的执行</Button>
      </>:null}
    </div>:null}
  </details>;
}

function protectionReason(code:string|null):string {
  switch(code) {
    case 'SAVED_OR_COMMITTING': return '已存在保存或提交记录，须保留原结果。';
    case 'DEADLINE_NOT_EXPIRED': return '原执行期限尚未到期。';
    case 'LEASE_NOT_EXPIRED':
    case 'GRANT_CHANGED_OR_ACTIVE': return '执行占用尚有效或已发生变化。';
    case 'WORK_ITEM_CHANGED':
    case 'SUCCESSOR_PRESENT': return '事项或后续执行已变化，保留当前记录。';
    case 'NOT_RUNNING': return '当前记录不处于可结束的运行状态。';
    default: return '保存或执行依据尚未核清，保留原状态。';
  }
}
