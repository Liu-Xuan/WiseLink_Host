import type {Root} from 'react-dom/client';
import type {CanonicalInitialAttemptRead} from '../../shared/api.interface';
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
