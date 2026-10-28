import type {Root} from 'react-dom/client';
import type {CanonicalInitialAttemptProtectionDetails,CanonicalInitialAttemptRead} from '../../shared/api.interface';
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><body></body>'),prior=new Map<string,PropertyDescriptor|undefined>();
for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){
  prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
const {act,createElement}:typeof import('react')=require('react');
const {createRoot}:typeof import('react-dom/client')=require('react-dom/client');
const mockRead=jest.fn(),mockReconcile=jest.fn(),mockListeners=new Set<()=>void>();
let mockSession=1;
jest.mock('../../client/src/api/canonical-host',()=>({
  getCanonicalHostClientSessionGeneration:()=>mockSession,
  subscribeCanonicalHostClientSession:(listener:()=>void)=>{mockListeners.add(listener);return()=>mockListeners.delete(listener);},
  readInitialAttemptControl:(...args:unknown[])=>mockRead(...args),
  reconcileExpiredInitialAttempt:(...args:unknown[])=>mockReconcile(...args),
}));
jest.mock('../../client/src/components/ui/button',()=>({
  Button:({variant:_variant,...props}:Record<string,unknown>)=>require('react').createElement('button',props),
}));
const Control:typeof import('../../client/src/pages/DocumentParsingPage/InitialAttemptControl').default=
  require('../../client/src/pages/DocumentParsingPage/InitialAttemptControl').default;
const facts:CanonicalInitialAttemptRead={
  schemaVersion:'wiselink.initial-attempt-control.v1',observedAt:'2026-10-28T00:00:00.000Z',
  workItemId:'WI-synthetic',workItemRevision:3,documentVersionId:'DV-synthetic',attemptId:'ATT-synthetic',
  attemptRef:'AQ-synthetic',stageRequestId:'stage-synthetic',intakeRequestId:'intake-synthetic',inputRevision:3,baseRevision:3,
  deadline:'2026-10-27T00:00:00.000Z',leaseGeneration:4,status:'RUNNING',commitStartedAt:null,completedAt:null,
  terminalReason:null,hasPersistedResult:false,projectionApplied:false,savedWorks:[],consumerOutcome:'UNKNOWN',
  reconciliation:'ELIGIBLE',protectionCode:null,
};
let root:Root,container:HTMLElement;
const changed=jest.fn();
async function render(workItemId=facts.workItemId){await act(async()=>root.render(createElement(Control,{
  workItemId,attemptId:facts.attemptId,attemptRef:facts.attemptRef,onChanged:changed}))); }
async function click(label:string){const node=[...container.querySelectorAll('button')].find(b=>b.textContent===label);
  expect(node).toBeDefined();await act(async()=>node!.click());}
beforeEach(()=>{mockSession=1;mockRead.mockReset();mockReconcile.mockReset();changed.mockReset();
  mockRead.mockResolvedValue(facts);container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();expect(mockListeners.size).toBe(0);});
afterAll(()=>{dom.window.close();for(const [key,value] of prior)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);});

it('does not read or write on mount/refresh; explicit control uses only exact Host-returned fences',async()=>{
  await render();await render();expect(mockRead).not.toHaveBeenCalled();expect(mockReconcile).not.toHaveBeenCalled();
  expect(container.querySelectorAll('input,select,textarea')).toHaveLength(0);
  await click('核对本次执行');expect(mockRead).toHaveBeenCalledWith('WI-synthetic',
    {attemptId:'ATT-synthetic',attemptRef:'AQ-synthetic'},expect.objectContaining({aborted:false}));
  expect(mockReconcile).not.toHaveBeenCalled();expect(container.textContent).toContain('UNKNOWN');
  mockReconcile.mockResolvedValue({operation:'RECONCILE_EXPIRED',changed:true,attempt:{...facts,status:'TIMED_OUT',
    reconciliation:'ALREADY_TIMED_OUT',terminalReason:'ACTION_ATTEMPT_DEADLINE_EXCEEDED'}});
  await click('结束已过期且未保存的执行');
  expect(mockReconcile).toHaveBeenCalledTimes(1);
  expect(mockReconcile).toHaveBeenCalledWith('WI-synthetic',{operation:'RECONCILE_EXPIRED',attemptId:'ATT-synthetic',
    attemptRef:'AQ-synthetic',stageRequestId:'stage-synthetic',expectedRevision:3,expectedLeaseGeneration:4});
  expect(changed).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('UNKNOWN');
  expect(container.textContent).toContain('未创建新任务');
});
it('shows protected facts without offering a write and clears content on an actual denied reread',async()=>{
  mockRead.mockResolvedValueOnce({...facts,reconciliation:'PROTECTED',protectionCode:'SAVED_OR_COMMITTING',
    savedWorks:[{workRevisionRef:'JAWR-synthetic',workRevision:1,saveRequestId:'S-original'}]})
    .mockRejectedValueOnce(new Error('当前身份不能读取'));
  await render();await click('核对本次执行');
  expect(container.textContent).toContain('已存在保存或提交记录');
  expect([...container.querySelectorAll('button')].some(b=>b.textContent==='结束已过期且未保存的执行')).toBe(false);
  await click('核对本次执行');expect(container.textContent).not.toContain('Host 状态');
  expect(container.querySelector('[role=alert]')?.textContent).toContain('不能读取');expect(mockReconcile).not.toHaveBeenCalled();
});
it('drops old account/object results and aborts pending reads without issuing any control',async()=>{
  let finish:(value:CanonicalInitialAttemptRead)=>void=()=>{};
  mockRead.mockImplementationOnce(()=>new Promise<CanonicalInitialAttemptRead>(resolve=>{finish=resolve;}));
  await render();await click('核对本次执行');const signal=mockRead.mock.calls[0][2] as AbortSignal;
  await act(async()=>{mockSession++;for(const listener of mockListeners)listener();});
  expect(signal.aborted).toBe(true);await act(async()=>finish(facts));expect(container.textContent).not.toContain('Host 状态');
  await render('WI-other');expect(mockRead).toHaveBeenCalledTimes(1);expect(mockReconcile).not.toHaveBeenCalled();
});
it('rejects a mismatched Host target and never turns an unknown POST result into success',async()=>{
  mockRead.mockResolvedValueOnce({...facts,attemptRef:'AQ-other'}).mockResolvedValueOnce(facts);
  await render();await click('核对本次执行');expect(container.querySelector('[role=alert]')?.textContent).toContain('不匹配');
  expect(mockReconcile).not.toHaveBeenCalled();await click('核对本次执行');
  mockReconcile.mockRejectedValue(new Error('结果尚未确认'));
  await click('结束已过期且未保存的执行');expect(changed).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('Host 状态');expect(container.textContent).toContain('结果尚未确认');
});

interface ProtectedDisplayCase {
  name:string;code:string;details?:CanonicalInitialAttemptProtectionDetails;expected:string[];
}
const protectedDisplayCases:ProtectedDisplayCase[]=[
  {name:'active attempt lease',code:'LEASE_NOT_EXPIRED',details:{reasons:['ATTEMPT_LEASE_ACTIVE'],
    attemptLeaseExpiresAt:'2026-10-29T00:00:00.000Z'},expected:['本次执行占用尚未到期','2026-10-29T00:00:00.000Z']},
  {name:'missing attempt fields',code:'LEASE_NOT_EXPIRED',details:{reasons:['ATTEMPT_LEASE_EXPIRY_MISSING',
    'ATTEMPT_LEASE_TOKEN_MISSING','ATTEMPT_LEASE_OWNER_MISSING'],attemptLeaseExpiresAt:null},
    expected:['本次执行占用缺少截止时间','本次执行占用凭据缺失','本次执行占用缺少执行方绑定']},
  {name:'changed original grant bindings',code:'GRANT_CHANGED_OR_ACTIVE',details:{reasons:['GRANT_GENERATION_CHANGED',
    'GRANT_SEALED_REQUEST_CHANGED','GRANT_INTAKE_REQUEST_CHANGED','GRANT_LEASE_OWNER_CHANGED','GRANT_SOURCE_HASH_CHANGED'],
    grantLeaseExpiresAt:'2026-10-27T00:00:00.000Z',sealedGrantLeaseGeneration:17,currentGrantLeaseGeneration:18,grantStatus:'LEASED'},
    expected:['授权代际与封存代际不一致','与封存的录入请求绑定不一致','与事项当前录入请求绑定不一致',
      '执行方绑定已变化','来源摘要已变化','原封存 17； 当前 18']},
  {name:'unavailable original grant',code:'GRANT_CHANGED_OR_ACTIVE',details:{reasons:['GRANT_UNAVAILABLE'],
    grantLeaseExpiresAt:null,sealedGrantLeaseGeneration:17,currentGrantLeaseGeneration:null,grantStatus:null},
    expected:['当前获权读取未取得原自动处理授权','当前 未取得','无法确认到期']},
  {name:'missing original grant expiry',code:'GRANT_CHANGED_OR_ACTIVE',details:{reasons:['GRANT_LEASE_EXPIRY_MISSING'],
    grantLeaseExpiresAt:null},expected:['原自动处理授权缺少占用截止时间']},
  {name:'active original grant',code:'GRANT_CHANGED_OR_ACTIVE',details:{reasons:['GRANT_LEASE_ACTIVE'],
    grantLeaseExpiresAt:'2026-10-29T00:00:00.000Z'},expected:['原自动处理授权占用尚未到期','2026-10-29T00:00:00.000Z']},
  {name:'completed or blocked original grant',code:'GRANT_CHANGED_OR_ACTIVE',details:{reasons:['GRANT_STATUS_CHANGED',
    'GRANT_COMPLETED','GRANT_BLOCKED'],grantStatus:'BLOCKED'},expected:['已不处于已领取状态','授权已记录完成','授权已记录阻断']},
  {name:'old response without attempt detail',code:'LEASE_NOT_EXPIRED',expected:['本次执行占用的到期或凭据依据尚未核清']},
  {name:'old response without grant detail',code:'GRANT_CHANGED_OR_ACTIVE',expected:['原自动处理授权的绑定、状态或到期依据不符合结束条件']},
];
it.each(protectedDisplayCases)('shows exact protection reason for $name without offering control',async({code,details,expected}:ProtectedDisplayCase)=>{
  mockRead.mockResolvedValueOnce({...facts,leaseGeneration:1,reconciliation:'PROTECTED',protectionCode:code,
    ...(details?{protectionDetails:details}:{})});
  await render();await click('核对本次执行');
  for(const text of expected)expect(container.textContent).toContain(text);
  expect(container.textContent).not.toContain('执行占用尚有效或已发生变化');
  expect(container.textContent).toContain('本次执行代际（ATT）：1');
  const binding=container.querySelector('details details');expect(binding).not.toBeNull();
  expect(binding?.hasAttribute('open')).toBe(false);
  for(const id of [facts.workItemId,facts.documentVersionId,facts.attemptId,facts.attemptRef,
    facts.stageRequestId,facts.intakeRequestId])expect(binding?.textContent).toContain(id);
  expect(binding?.textContent).toContain(code);
  expect(container.querySelectorAll('input,select,textarea')).toHaveLength(0);
  expect([...container.querySelectorAll('button')].some(b=>b.textContent==='结束已过期且未保存的执行')).toBe(false);
  expect(mockRead).toHaveBeenCalledTimes(1);expect(mockReconcile).not.toHaveBeenCalled();
});
