import { CanonicalHostOpenClawDynamicEvaluationService } from '../../server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service';

const original = {parseRunId:'PR-2',parseRevision:2};
const scope = {workItemId:'WI-original',tenantId:'tenant-original',appId:'app_17bzc551rsg',principalId:'service-original',authorizationFingerprint:'authorized'};
const impacted = {status:'CONFLICT',terminalCode:'DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED'};
function harness(overrides: Record<string, unknown> = {}) {
  const workItem = {workItemId:scope.workItemId,revision:2,classification:{normalizedFamily:'SB',status:'CONFIRMED'}};
  const stages = {translation:{status:'PENDING'},applicability:{status:'WAITING_INPUT'},jobAid:impacted,overall:impacted,...overrides};
  const authorization = {authorizeOpenClawWorkItem:jest.fn(async () => scope)};
  const project = jest.fn(async () => ({status:'CONFLICT',stages,applicabilityContextRef:'context-original'}));
  const applicability={enqueueOriginal:jest.fn(async()=>({status:'QUEUED',requestId:'original-2'}))};
  const problem = {enabledForNewTasks:() => true,readOriginalContinuationBinding:jest.fn(async () => original),
    enqueueOriginalContinuation:jest.fn(async () => ({status:'QUEUED',requestId:'original-2'}))};
  const service = new CanonicalHostOpenClawDynamicEvaluationService(
    {getTenantScopedByWorkItemId:async () => workItem} as never,{} as never,{} as never,{} as never,
    {} as never,{} as never,{} as never,authorization as never,{} as never,{} as never,problem as never,{project} as never,applicability as never);
  return {service,problem,authorization,project,workItem,applicability};
}

describe('Hosted original assessment continuation admission', () => {
  it('queues a changed JobAid original after authorized exact-version comparison', async () => {
    const h=harness();
    expect(await h.service.nextOriginalAssessment(scope.workItemId)).toMatchObject({status:'QUEUED'});
    expect(h.project).toHaveBeenCalledWith({workItem:h.workItem,tenantId:scope.tenantId,expectedOriginalParseRunId:original.parseRunId});
    expect(h.problem.enqueueOriginalContinuation).toHaveBeenCalledWith(h.workItem,scope,'INITIAL_PROBLEM_ASSESSMENT',original);
  });
  it('queues changed applicability first with the exact service identity and original',async()=>{
    const h=harness({applicability:impacted});
    expect(await h.service.nextOriginalAssessment(scope.workItemId)).toMatchObject({status:'QUEUED'});
    expect(h.applicability.enqueueOriginal).toHaveBeenCalledWith('context-original',{
      tenantId:scope.tenantId,workItemId:scope.workItemId,principalId:scope.principalId,...original});
    expect(h.problem.enqueueOriginalContinuation).not.toHaveBeenCalled();
  });
  it('requires Overall authority before a separate Overall successor', async () => {
    const h=harness({jobAid:{status:'SUCCEEDED'}});
    await h.service.nextOriginalAssessment(scope.workItemId);
    expect(h.authorization.authorizeOpenClawWorkItem).toHaveBeenLastCalledWith({operation:'BEGIN_OVERALL',workItemId:scope.workItemId});
    expect(h.problem.enqueueOriginalContinuation).toHaveBeenCalledWith(h.workItem,scope,'OVERALL_CONSISTENCY',original);
  });
  it.each([
    {jobAid:{status:'FAILED',terminalCode:'MODEL_FAILED'}},
    {jobAid:{status:'BUSY',attemptStatus:'RUNNING'}},
    {jobAid:{status:'PENDING',attemptStatus:'QUEUED',requestId:'explicit-existing'}},
    {applicability:impacted},
    {jobAid:{status:'SUCCEEDED'},overall:{status:'SUCCEEDED'}},
  ])('preserves existing ownership or prerequisites: %j', async overrides => {
    const h=harness(overrides);
    await h.service.nextOriginalAssessment(scope.workItemId);
    expect(h.problem.enqueueOriginalContinuation).not.toHaveBeenCalled();
  });
  it('does not enqueue if the publication changes during comparison', async () => {
    const h=harness(); h.project.mockRejectedValue(new Error('JOBAID_ORIGINAL_REQUEST_CHANGED'));
    await expect(h.service.nextOriginalAssessment(scope.workItemId)).rejects.toThrow('JOBAID_ORIGINAL_REQUEST_CHANGED');
    expect(h.problem.enqueueOriginalContinuation).not.toHaveBeenCalled();
  });
});
