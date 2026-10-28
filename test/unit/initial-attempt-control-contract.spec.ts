import {initialAttemptReadSchema,initialAttemptReconcileSchema} from '../../server/modules/canonical-host/canonical-initial-attempt-control.service';
import {CanonicalInitialAnalysisContinuationController} from '../../server/modules/canonical-host/canonical-initial-analysis-continuation.controller';
import {CanonicalHostController} from '../../server/modules/canonical-host/canonical-host.controller';
import type {Request} from 'express';
const read={view:'attempt-control',attemptId:'ATT-exact',attemptRef:'AQ-exact'};
const command={operation:'RECONCILE_EXPIRED',attemptId:'ATT-exact',attemptRef:'AQ-exact',
  stageRequestId:'stage-original',expectedRevision:3,expectedLeaseGeneration:17};
const request={headers:{},userContext:{userId:'owner-synthetic',tenantId:'tenant-synthetic',
  appId:'app_17bzc551rsg',roles:[],env:'runtime'}} as unknown as Request;
const before=process.env.SANDBOX_ID;
beforeAll(()=>{process.env.SANDBOX_ID='unit-native-provenance';});
afterAll(()=>{if(before===undefined)delete process.env.SANDBOX_ID;else process.env.SANDBOX_ID=before;});
function harness(){
  const ordinary={request:jest.fn().mockResolvedValue({status:'QUEUED'})},control={
    read:jest.fn().mockResolvedValue({status:'RUNNING'}),reconcile:jest.fn().mockResolvedValue({changed:false})};
  const sessions={
    withNativeBrowserIdentity:jest.fn(async(_request:unknown,operation:(identity:{oauthSession:null})=>Promise<unknown>)=>operation({oauthSession:null})),
    withVerifiedNativeBrowserSql:jest.fn(async(operation:()=>Promise<unknown>)=>operation()),
  },jobAid={readBrowser:jest.fn().mockResolvedValue({current:null})};
  return {ordinary,control,sessions,jobAid,
    writer:new CanonicalInitialAnalysisContinuationController(ordinary as never,sessions as never,control as never),
    reader:new CanonicalHostController({} as never,{} as never,{} as never,{} as never,{} as never,
      undefined,undefined,jobAid as never,sessions as never,control as never)};
}
it.each(['actor','tenantId','leaseToken','saveRequestId','deadline','requestId'])('rejects caller-injected %s and never requires a made-up S',key=>{
  expect(initialAttemptReadSchema.safeParse({...read,[key]:'forged'}).success).toBe(false);
  expect(initialAttemptReconcileSchema.safeParse({...command,[key]:'forged'}).success).toBe(false);
  expect(initialAttemptReconcileSchema.parse(command)).toEqual(command);
});
it('uses the original native identity wrapper and keeps the ordinary continuation consumer separate',async()=>{
  const h=harness();await h.writer.request('WI-exact',command,request);
  expect(h.control.reconcile).toHaveBeenCalledWith('WI-exact',command,expect.objectContaining({
    userId:'owner-synthetic',tenantId:'tenant-synthetic',objectAccessActor:expect.objectContaining({transport:'MIAODA_AUTHENTICATED_HTTP'})}));
  expect(h.ordinary.request).not.toHaveBeenCalled();expect(h.sessions.withNativeBrowserIdentity).toHaveBeenCalledTimes(1);
  const next={operation:'EVALUATE_JOBAID',requestId:'00000000-0000-4000-8000-000000000001',expectedRevision:3};
  await h.writer.request('WI-exact',next,request);expect(h.ordinary.request).toHaveBeenCalledWith(
    'WI-exact',next,expect.any(Object),null,request);expect(h.control.reconcile).toHaveBeenCalledTimes(1);
});
it('keeps exact control GET read-only and preserves the existing work GET consumer',async()=>{
  const h=harness();await h.reader.assessmentWork('WI-exact',request,read);
  expect(h.control.read).toHaveBeenCalledWith('WI-exact',read,expect.objectContaining({userId:'owner-synthetic'}));
  expect(h.control.reconcile).not.toHaveBeenCalled();expect(h.ordinary.request).not.toHaveBeenCalled();
  await h.reader.assessmentWork('WI-exact',request);expect(h.jobAid.readBrowser).toHaveBeenCalledTimes(1);
  expect(h.control.read).toHaveBeenCalledTimes(1);
});
it('never reaches either consumer after native identity rejection',async()=>{
  const h=harness();h.sessions.withNativeBrowserIdentity.mockRejectedValueOnce(new Error('NATIVE_BROWSER_IDENTITY_REQUIRED'));
  await expect(h.writer.request('WI-exact',command,request)).rejects.toThrow('NATIVE_BROWSER_IDENTITY_REQUIRED');
  expect(h.control.reconcile).not.toHaveBeenCalled();expect(h.ordinary.request).not.toHaveBeenCalled();
});
