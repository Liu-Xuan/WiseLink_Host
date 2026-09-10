import { initialKnowledgeEvidence } from '../../server/modules/canonical-host/initial-assessment-knowledge.service';
import { overallModelEvidenceRegistry, readStoredOverallEvidence } from '../../server/modules/canonical-host/overall-assessment-reading';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';

const scope = { tenantId: 'tenant', workItemId: 'WI-test', principalId: 'executor' };
const control = { attemptRef: 'AQ-test', leaseToken: 'lease', leaseGeneration: 1 };
const row = { attemptId: 'ATT-test', status: 'RUNNING', leaseOwner: scope.principalId,
  leaseToken: control.leaseToken, leaseGeneration: 1, leaseExpiresAt: new Date(Date.now()+60_000),
  deadlineAt: new Date(Date.now()+120_000), cancelRequestedAt: null };
const queryRow = { query_ref: '11111111-1111-4111-8111-111111111111', query_text: 'Find original directive',
  status: 'UNKNOWN', answer_text: 'Partial lead; verify the original', error_code: 'AILY_STREAM_RESULT_UNCONFIRMED', _created_at: '2026-09-10T00:00:00.000Z' };

function harness() {
  const work = { recordSourceRead: jest.fn().mockResolvedValue(undefined) };
  const evidence = initialKnowledgeEvidence(queryRow);
  const knowledge = { query: jest.fn().mockResolvedValue({ queryRef: queryRow.query_ref, status: 'UNKNOWN', evidence, candidateOnly: true, originalDocumentsVerified: false }) };
  const taskInput = { actorUserId: 'owner', sourceCatalog: [], sourceBindings: [],
    knowledgeBinding: { sessionId: 'bound-session', agentId: 'bound-agent' }, modelInput: {} };
  const authorized = { row: { ...row }, scope, task: { allowedConnectors: ['feishu-aily-user'] }, taskInput };
  const service = new CanonicalJobAidProblemService({} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,{} as never,work as never,knowledge as never);
  Object.assign(service, { authorizedAttempt: jest.fn().mockResolvedValue(authorized), assertSourcesAuthorized: jest.fn().mockResolvedValue(undefined) });
  return { service, work, knowledge, authorized, evidence };
}

test('terminal query provenance survives storage and model projection; running or empty results create no evidence', () => {
  const evidence = initialKnowledgeEvidence(queryRow);
  expect(readStoredOverallEvidence(evidence)).toEqual(evidence);
  expect(overallModelEvidenceRegistry(evidence)[0].queryProvenance).toEqual({ origin: 'AILY_RETRIEVAL', queryText: queryRow.query_text, status: 'UNKNOWN', originalDocumentsVerified: false });
  expect(initialKnowledgeEvidence({ ...queryRow, status: 'RUNNING' })).toEqual([]);
  expect(initialKnowledgeEvidence({ ...queryRow, status: 'FAILED', answer_text: null })).toEqual([]);
  expect(() => readStoredOverallEvidence([{ ...evidence[0], queryProvenance: { originalDocumentsVerified: true } }])).toThrow('OVERALL_QUERY_PROVENANCE_INVALID');
});

test('query uses exact attempt ID and binding, then records only actual delivered references', async () => {
  const h = harness();
  const result = await h.service.queryKnowledge({ ...control, requestKey: 'request', query: 'Find original directive' });
  expect(h.knowledge.query).toHaveBeenCalledWith({tenantId:'tenant',actorId:'owner',workItemId:'WI-test'},h.authorized.taskInput.knowledgeBinding,'ATT-test',expect.objectContaining({requestKey:'request'}));
  expect(result.status).toBe('UNKNOWN');
  expect(result.evidence).toEqual(overallModelEvidenceRegistry(h.evidence));
  expect(h.work.recordSourceRead).toHaveBeenLastCalledWith(expect.objectContaining({sourceRefs:[h.evidence[0].evidenceRef]}));
});

test('lost lease or requested cancellation prevents retrieval and source-read mutation', async () => {
  for (const change of [{leaseToken:'other'}, {cancelRequestedAt:new Date()}, {status:'CANCELLED'}]) {
    const h = harness(); Object.assign(h.authorized.row,change);
    await expect(h.service.queryKnowledge({...control,requestKey:'request',query:'query'})).rejects.toThrow('JOBAID_WORK_LEASE_FENCE_REJECTED');
    expect(h.knowledge.query).not.toHaveBeenCalled(); expect(h.work.recordSourceRead).not.toHaveBeenCalled();
  }
});

test('missing connector or expired user grant remains an explicit unavailable result', async () => {
  const h = harness(); h.authorized.task.allowedConnectors=[];
  expect((await h.service.queryKnowledge({...control,requestKey:'request',query:'query'})).status).toBe('UNAVAILABLE');
  expect(h.knowledge.query).not.toHaveBeenCalled();
  h.authorized.task.allowedConnectors=['feishu-aily-user'];
  h.knowledge.query.mockRejectedValue(new Error('AILY_USER_REAUTHORIZATION_REQUIRED'));
  expect((await h.service.queryKnowledge({...control,requestKey:'request',query:'query'})).status).toBe('UNAVAILABLE');
});
