import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CanonicalInitialAttemptProtectionReason, CanonicalInitialAttemptRead } from '@shared/api.interface';
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
      {value.reconciliation==='PROTECTED'?<p>当前不能结束：{protectionReason(value)}</p>:null}
      <details className="break-words"><summary>查看执行绑定与占用时间</summary>
        <p>事项：{value.workItemId}；修订：{value.workItemRevision}；文档版本：{value.documentVersionId}</p>
        <p>执行：{value.attemptId}；操作引用：{value.attemptRef}</p>
        <p>阶段请求：{value.stageRequestId}；录入请求：{value.intakeRequestId}</p>
        <p>输入修订：{value.inputRevision}；基础修订：{value.baseRevision}；本次执行代际（ATT）：{value.leaseGeneration}</p>
        {value.protectionDetails?.attemptLeaseExpiresAt!==undefined?
          <p>本次执行占用截止：{value.protectionDetails.attemptLeaseExpiresAt??'缺失，无法确认到期'}</p>:null}
        {value.protectionDetails?.grantLeaseExpiresAt!==undefined?
          <p>外层自动处理授权占用截止：{value.protectionDetails.grantLeaseExpiresAt??'未取得，无法确认到期'}</p>:null}
        {value.protectionDetails?.sealedGrantLeaseGeneration!==undefined?
          <p>外层自动处理授权代际：原封存 {value.protectionDetails.sealedGrantLeaseGeneration}；
            当前 {value.protectionDetails.currentGrantLeaseGeneration??'未取得'}</p>:null}
        {value.protectionDetails?.grantStatus!==undefined?
          <p>外层自动处理授权状态：{value.protectionDetails.grantStatus??'未取得'}</p>:null}
        <p>保护代码：{value.protectionCode??'无'}</p>
      </details>
      {value.reconciliation==='ALREADY_TIMED_OUT'?<p>该执行已按原期限结束；未创建新任务。</p>:null}
      {value.reconciliation==='ELIGIBLE'?<>
        <p>只结束这次执行。原响应、未知结果与保存记录保留，不重试评估。</p>
        <Button type="button" variant="outline" disabled={busy} onClick={reconcile}>结束已过期且未保存的执行</Button>
      </>:null}
    </div>:null}
  </details>;
}

function protectionReason(value:CanonicalInitialAttemptRead):string {
  if ((value.protectionCode==='LEASE_NOT_EXPIRED' || value.protectionCode==='GRANT_CHANGED_OR_ACTIVE') &&
      value.protectionDetails?.reasons.length)
    return value.protectionDetails.reasons.map((reason:CanonicalInitialAttemptProtectionReason) =>
      protectionReasons[reason]??'保护判据尚未核清，请保留原状态').join('；')+'。';
  switch(value.protectionCode) {
    case 'SAVED_OR_COMMITTING': return '已存在保存或提交记录，须保留原结果。';
    case 'DEADLINE_NOT_EXPIRED': return '原执行期限尚未到期。';
    case 'LEASE_NOT_EXPIRED': return '本次执行占用的到期或凭据依据尚未核清。';
    case 'GRANT_CHANGED_OR_ACTIVE': return '原自动处理授权的绑定、状态或到期依据不符合结束条件。';
    case 'WORK_ITEM_CHANGED': return '事项修订已变化，保留当前记录。';
    case 'SUCCESSOR_PRESENT': return '已有其他活动或后续执行，保留当前记录。';
    case 'NOT_RUNNING': return '当前记录不处于可结束的运行状态。';
    case 'ACTIVITY_UNKNOWN': return '执行活动记录尚未核清，保留原状态。';
    case 'STATE_UNKNOWN': return '执行存在完成或取消信息，须保留原状态。';
    default: return '保存或执行依据尚未核清，保留原状态。';
  }
}

const protectionReasons:Record<CanonicalInitialAttemptProtectionReason,string> = {
  ATTEMPT_LEASE_EXPIRY_MISSING:'本次执行占用缺少截止时间，无法确认到期',
  ATTEMPT_LEASE_ACTIVE:'本次执行占用尚未到期',
  ATTEMPT_LEASE_TOKEN_MISSING:'本次执行占用凭据缺失',
  ATTEMPT_LEASE_OWNER_MISSING:'本次执行占用缺少执行方绑定',
  GRANT_UNAVAILABLE:'当前获权读取未取得原自动处理授权，无法核实其绑定',
  GRANT_STATUS_CHANGED:'原自动处理授权已不处于已领取状态',
  GRANT_KIND_CHANGED:'原自动处理授权类型已变化',
  GRANT_SEALED_REQUEST_CHANGED:'原自动处理授权与封存的录入请求绑定不一致',
  GRANT_INTAKE_REQUEST_CHANGED:'原自动处理授权与事项当前录入请求绑定不一致',
  GRANT_GENERATION_CHANGED:'原自动处理授权代际与封存代际不一致',
  GRANT_LEASE_OWNER_MISSING:'原自动处理授权缺少执行方绑定',
  GRANT_LEASE_OWNER_CHANGED:'原自动处理授权的执行方绑定已变化',
  GRANT_ACTOR_CHANGED:'原自动处理授权与事项所属用户的绑定不一致',
  GRANT_DOCUMENT_CHANGED:'原自动处理授权的文档绑定已变化',
  GRANT_DOCUMENT_VERSION_CHANGED:'原自动处理授权的文档版本绑定已变化',
  GRANT_SOURCE_ARTIFACT_CHANGED:'原自动处理授权的来源文件绑定已变化',
  GRANT_SOURCE_HASH_CHANGED:'原自动处理授权的来源摘要已变化',
  GRANT_SOURCE_SIZE_CHANGED:'原自动处理授权的来源大小已变化',
  GRANT_LEASE_EXPIRY_MISSING:'原自动处理授权缺少占用截止时间，无法确认到期',
  GRANT_LEASE_ACTIVE:'原自动处理授权占用尚未到期',
  GRANT_COMPLETED:'原自动处理授权已记录完成',
  GRANT_BLOCKED:'原自动处理授权已记录阻断',
};
