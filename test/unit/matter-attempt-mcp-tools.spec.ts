import { z } from 'zod/v4';

import { registerMatterAttemptMcpTools } from '../../server/modules/canonical-host/matter-attempt-mcp-tools';

function fixture(allowed = true, tool = 'matter_action_attempt') {
  const registerTool = jest.fn();
  const attempts = { nextForRuntime: jest.fn().mockResolvedValue({ matterId: 'MAT-one', next: null }), saveJobAidWork: jest.fn().mockResolvedValue({ workRevisionRef: 'MWR-one' }), finishJobAid: jest.fn().mockResolvedValue({ status: 'SUCCEEDED' }), reserveJobAid: jest.fn().mockResolvedValue({ task: { operationRef: 'AQ-new' }, row: { status: 'QUEUED' }, created: true }), claim: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
    read: jest.fn().mockResolvedValue({ status: 'RUNNING', errorCode: null, deadlineAt: null,
      leaseToken: 'private-token', taskEnvelopeJson: 'private-task' }),
    readStatus: jest.fn().mockResolvedValue({ row: { status: 'RUNNING', errorCode: null, deadlineAt: null,
      leaseToken: 'private-token', taskEnvelopeJson: 'private-task' }, audit: {
      matterRevisionId: 'MR-one', matterRevision: 2, baseWorkingRevision: 3,
      trigger: { kind: 'USER_REQUEST', requestId: 'request-one', instruction: 'Compare exact work' },
      priorWorkRef: 'MWREV-prior', inputs: [{ kind: 'DOCUMENT_VERSION', inputId: 'I-one', familyId: 'F-one',
        documentVersionId: 'DV-one', workItemId: null, workItemRevision: null, resultRef: null, resultRevision: null }],
      referenceWorks: [{ matterId: 'MAT-source', workRef: 'MWREV-source', issueKey: 'conditions',
        purpose: 'Compare conditions', evidenceRef: 'PRIOR_RESULT:source', overviewStatus: 'STALE',
        correctionNotices: [{ attemptRef: 'AQ-correction' }], overviewCorrectionNotices: [] }],
      savedWorkReceipts: [{ requestId: 'JA-save-one', expectedWorkRevision: 3, workRevisionRef: 'MWREV-four' }],
    } }),
    heartbeat: jest.fn(), cancel: jest.fn().mockResolvedValue({ status: 'CANCELLED' }), readOriginal: jest.fn(),
    readSourcePages: jest.fn().mockImplementation((input, reader) => reader(input.documentVersionId, { pageStart: input.pageStart, pageEnd: input.pageStart })),
    readSavedWork: jest.fn().mockResolvedValue({ matterWorkRevisionId: 'MWR-exact' }),
    readCurrentWork: jest.fn().mockResolvedValue({ matterId: 'MAT-one', matterRevisionId: 'MR-2', matterRevision: 2,
      workRef: 'MWR-2', workingRevision: 2, current: null, currentInputs: [], sourceCatalog: [],
      eligibleEvidenceRefs: [], activeAttempts: [] }) };
  const documents = { readDocumentSourcePagesForRuntime: jest.fn().mockResolvedValue({ pages: [] }) };
  const scope = { appId: 'app_17bzc551rsg', actorUserId: 'host-actor', tenantId: 'host-tenant',
    principalId: 'service:executor', matterId: 'MAT-one', attemptRef: 'AQ-one' };
  const authorizeOpenClawMatterAttempt = jest.fn().mockResolvedValue(scope);
  const authorizeOpenClawMatterRequest = jest.fn().mockResolvedValue(scope);
  const originalReader = { readDocumentOriginal: jest.fn() };
  registerMatterAttemptMcpTools({ registerTool } as never, attempts as never,
    allowed ? { authorizeOpenClawMatterAttempt, authorizeOpenClawMatterRequest } as never : {} as never, documents as never, originalReader as never);
  const [name, definition, handler] = registerTool.mock.calls.find(([name]) => name === tool)!;
  return { attempts, documents, originalReader, scope, expectedScope: { ...scope, authorizeReferenceMatter: expect.any(Function) }, authorizeOpenClawMatterAttempt, authorizeOpenClawMatterRequest, name, definition,
    call: (input: unknown) => handler(definition.inputSchema.parse(input)) };
}
const request = { operation: 'CLAIM', matterId: 'MAT-one', attemptRef: 'AQ-one' };

describe('Matter MCP existing attempt lifecycle', () => {
  it('requires the same principal, tenant and actor for a referenced Matter on every use', async () => {
    const f = fixture();
    await f.call(request);
    const sourceAuthorization = f.attempts.claim.mock.calls[0][0].authorizeReferenceMatter;
    f.authorizeOpenClawMatterRequest.mockResolvedValue({ ...f.scope, matterId: 'MAT-source' });
    await expect(sourceAuthorization('MAT-source')).resolves.toBeUndefined();
    for (const changed of [{ tenantId: 'other-tenant' }, { actorUserId: 'other-actor' },
      { principalId: 'other-principal' }, { matterId: 'MAT-other' }]) {
      f.authorizeOpenClawMatterRequest.mockResolvedValue({ ...f.scope, matterId: 'MAT-source', ...changed });
      await expect(sourceAuthorization('MAT-source')).rejects.toMatchObject({ statusCode: 503 });
    }
    f.authorizeOpenClawMatterRequest.mockRejectedValue(Object.assign(new Error('ACTION_ATTEMPT_NOT_FOUND'), { statusCode: 404 }));
    await expect(sourceAuthorization('MAT-source')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('accepts only reference identities and purpose, never caller-supplied A content or authorization', async () => {
    const f = fixture(true, 'begin_matter_assessment');
    const input = { matterId: 'MAT-one', expectedMatterRevisionId: 'MR-one', expectedMatterRevision: 2,
      expectedWorkingRevision: 3, requestId: 'reference-one', instruction: 'Compare the source conditions',
      referenceWorks: [{ matterId: 'MAT-source', workRef: 'MWREV-source', issueKey: 'conditions', purpose: 'Compare with this matter' }] };
    await f.call(input);
    expect(f.attempts.reserveJobAid).toHaveBeenCalledWith(expect.objectContaining({ referenceWorks: input.referenceWorks }));
    expect(() => f.call({ ...input, referenceWorks: [{ ...input.referenceWorks[0], body: 'forged source' }] })).toThrow();
    expect(() => f.call({ ...input, authorizeReferenceMatter: true })).toThrow();
  });
  it('reads original only with exact Host actor and fence, rejecting caller-selected parse runs', async () => {
    const f = fixture();
    const input = { ...request, operation: 'READ_ORIGINAL', documentVersionId: 'DV-one', offset: 0,
      limit: 20, purpose: '核对原文', leaseToken: 'f1111111-1111-4111-8111-111111111111', leaseGeneration: 1 };
    await f.call(input);
    expect(f.attempts.readOriginal).toHaveBeenCalledWith({ ...f.expectedScope, documentVersionId: 'DV-one', offset: 0,
      limit: 20, purpose: input.purpose, leaseToken: input.leaseToken, leaseGeneration: 1 }, f.originalReader);
    expect(() => f.call({ ...input, parseRunId: 'forged' })).toThrow();
    expect(() => f.call({ ...input, offset: -1 })).toThrow();
  });
  it('polls and creates automatic work only through the exact Host Matter scope', async () => {
    const f = fixture(true, 'next_matter_assessment');
    await f.call({ matterId: 'MAT-one' });
    expect(f.attempts.nextForRuntime).toHaveBeenCalledWith(f.expectedScope);
    expect(() => f.call({ matterId: 'MAT-one', actorUserId: 'forged' })).toThrow();
  });

  it('creates a Host-built JobAid request with exact CAS and no caller model context', async () => {
    const f = fixture(true, 'begin_matter_assessment');
    const input = { matterId: 'MAT-one', expectedMatterRevisionId: 'MR-one', expectedMatterRevision: 2,
      expectedWorkingRevision: 3, requestId: 'request-one', instruction: '复核新增资料' };
    await f.call(input);
    expect(f.attempts.reserveJobAid).toHaveBeenCalledWith({ tenantId: 'host-tenant', actorUserId: 'host-actor', authorizeReferenceMatter: expect.any(Function),
      matterId: 'MAT-one', expectedMatterRevisionId: 'MR-one', expectedMatterRevision: 2,
      expectedWorkingRevision: 3, idempotencyKey: 'matter:MAT-one:request-one',
      trigger: { kind: 'USER_REQUEST', requestId: 'request-one', instruction: '复核新增资料' } });
    expect(() => f.call({ ...input, modelInput: { forged: true } })).toThrow();
    await f.call({ ...input, recoveryAttemptRef: 'AQ-failed' });
    expect(f.attempts.reserveJobAid).toHaveBeenLastCalledWith(expect.objectContaining({
      recoveryAttemptRef: 'AQ-failed', actorUserId: 'host-actor', tenantId: 'host-tenant',
    }));
    expect(() => f.call({ ...input, recoveryAttemptRef: 'AQ-failed', recoveryCandidate: '{}' })).toThrow();
  });

  it('forwards a bounded overview correction and rejects malformed or oversized input', async () => {
    const f = fixture(true, 'begin_matter_assessment');
    const overviewCorrection = {
      kind: 'ENGINEERING_OVERVIEW_CORRECTION',
      expectedWorkRef: 'MWREV-current',
      correctionReason: '核对总体认识中的两处误读',
      evidenceRefs: ['DOCUMENT_PASSAGE:DV-1:page:1'],
    } as const;
    const input = { matterId: 'MAT-one', expectedMatterRevisionId: 'MR-one', expectedMatterRevision: 2,
      expectedWorkingRevision: 3, requestId: 'overview-correction', instruction: '核对总体认识', overviewCorrection };
    await f.call(input);
    expect(f.attempts.reserveJobAid).toHaveBeenCalledWith(expect.objectContaining({ overviewCorrection }));

    expect(() => f.call({ ...input, overviewCorrection: { ...overviewCorrection, correctionReason: '' } })).toThrow();
    expect(() => f.call({ ...input, overviewCorrection: { ...overviewCorrection, evidenceRefs: [] } })).toThrow();
    expect(() => f.call({ ...input, overviewCorrection: { ...overviewCorrection, evidenceRefs: Array.from({ length: 97 }, (_, index) => `E-${index}`) } })).toThrow();
    expect(() => f.call({ ...input, overviewCorrection: { ...overviewCorrection, unknown: true } })).toThrow();
  });

  it('reads physical sources through the fenced Matter service using Host actor scope', async () => {
    const f = fixture();
    await f.call({ ...request, operation: 'READ_SOURCES', documentVersionId: 'DV-one', pageStart: 2,
      purpose: '核对前提', leaseToken: 'f1111111-1111-4111-8111-111111111111', leaseGeneration: 1 });
    expect(f.documents.readDocumentSourcePagesForRuntime).toHaveBeenCalledWith('DV-one', { pageStart: 2, pageEnd: 2 }, f.expectedScope);
  });

  it('dispatches raw work and exact finish through the Host-authorized Matter processor', async () => {
    const f = fixture();
    const fence = { leaseToken: 'f1111111-1111-4111-8111-111111111111', leaseGeneration: 1 };
    await f.call({ ...request, ...fence, operation: 'SAVE_WORK', requestId: 'save-one', expectedWorkRevision: 0, workJson: '{}' });
    expect(f.attempts.saveJobAidWork).toHaveBeenCalledWith({ ...f.expectedScope, ...fence, requestId: 'save-one', expectedWorkRevision: 0, workJson: '{}' });
    const result = { status: 'SUCCEEDED', modelOutput: JSON.stringify({ workRevisionRef: 'MWR-one' }) };
    await f.call({ ...request, ...fence, operation: 'FINISH', result });
    expect(f.attempts.finishJobAid).toHaveBeenCalledWith({ ...f.expectedScope, ...fence, result });
  });

  it('passes only Host-authorized identity to the real Matter service', async () => {
    const f = fixture();
    expect(f.name).toBe('matter_action_attempt');
    await f.call(request);
    expect(f.attempts.claim).toHaveBeenCalledWith(f.expectedScope);
  });
  it('rejects injected identity fields and fences before dispatch', () => {
    const f = fixture();
    expect(() => f.call({ ...request, actorUserId: 'forged' })).toThrow();
    expect(() => f.call({ ...request, operation: 'HEARTBEAT', leaseGeneration: 1 })).toThrow();
    expect(f.authorizeOpenClawMatterAttempt).not.toHaveBeenCalled();
  });
  it('fails closed for older adapters with no Matter authorization', async () => {
    const f = fixture(false);
    await expect(f.call(request)).rejects.toMatchObject({ statusCode: 503 });
    expect(f.attempts.claim).not.toHaveBeenCalled();
  });
  it('rejects a scope returned for a different object or operation reference', async () => {
    const f = fixture();
    f.authorizeOpenClawMatterAttempt.mockResolvedValue({ ...f.scope, attemptRef: 'AQ-other' });
    await expect(f.call(request)).rejects.toMatchObject({ statusCode: 503 });
    expect(f.attempts.claim).not.toHaveBeenCalled();
  });
  it('projects status without leaking a lease token or task body', async () => {
    const f = fixture();
    const result = await f.call({ ...request, operation: 'STATUS' });
    expect(JSON.stringify(result)).not.toMatch(/private-token|private-task|leaseToken|taskEnvelopeJson/);
    expect(JSON.stringify(result)).toContain('RUNNING');
    expect(JSON.stringify(result)).toContain('MWREV-source');
    expect(JSON.stringify(result)).toContain('JA-save-one');
    expect(JSON.stringify(result)).toContain('AQ-correction');
  });
  it('reads the exact save request without claiming or creating another attempt', async () => {
    const f = fixture();
    await f.call({ ...request, operation: 'READ_SAVED_WORK', requestId: 'save-first' });
    expect(f.attempts.readSavedWork).toHaveBeenCalledWith({ ...f.expectedScope, requestId: 'save-first' });
    expect(f.attempts.claim).not.toHaveBeenCalled();
  });
  it('reports the recorded terminal failure when the separate error column is empty', async () => {
    const f = fixture();
    f.attempts.readStatus.mockResolvedValue({ row: { status: 'FAILED', errorCode: null,
      terminalReason: 'JOBAID_WORK_VALIDATION_FAILED', deadlineAt: null,
      leaseToken: 'private-token', taskEnvelopeJson: 'private-task' }, audit: {
      matterRevisionId: 'MR-one', matterRevision: 2, baseWorkingRevision: 3,
      trigger: { kind: 'SOURCE_CHANGE', inputIds: ['I-one'] }, priorWorkRef: null,
      inputs: [], referenceWorks: [], savedWorkReceipts: [],
    } } as never);
    const result = await f.call({ ...request, operation: 'STATUS' });
    expect(JSON.stringify(result)).toContain('JOBAID_WORK_VALIDATION_FAILED');
    expect(JSON.stringify(result)).not.toMatch(/private-token|private-task|leaseToken|taskEnvelopeJson/);
    expect(f.attempts.claim).not.toHaveBeenCalled();
  });
});

describe('read_matter_current_work', () => {
  it('registers a strict matterId-only schema with read-only annotations', () => {
    const f = fixture(true, 'read_matter_current_work');
    expect(f.definition.annotations).toEqual({
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const schema = z.toJSONSchema(f.definition.inputSchema) as {
      type?: string; additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown>;
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['matterId']);
    expect(Object.keys(schema.properties ?? {})).toEqual(['matterId']);
  });

  it('returns the read model through the authorized Host scope without any write', async () => {
    const f = fixture(true, 'read_matter_current_work');
    const result = await f.call({ matterId: 'MAT-one' });
    const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;
    expect(payload).toMatchObject({ matterId: 'MAT-one', workRef: 'MWR-2', workingRevision: 2 });
    expect(f.authorizeOpenClawMatterRequest).toHaveBeenCalledWith({ matterId: 'MAT-one' });
    expect(f.attempts.readCurrentWork).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'host-tenant', actorUserId: 'host-actor', principalId: 'service:executor',
      matterId: 'MAT-one', authorizeReferenceMatter: expect.any(Function) }));
    for (const write of [f.attempts.reserveJobAid, f.attempts.saveJobAidWork, f.attempts.finishJobAid,
      f.attempts.claim, f.attempts.heartbeat, f.attempts.cancel, f.attempts.nextForRuntime])
      expect(write).not.toHaveBeenCalled();
  });

  it('keeps reference-matter re-authorization for retained sources', async () => {
    const f = fixture(true, 'read_matter_current_work');
    await f.call({ matterId: 'MAT-one' });
    const { authorizeReferenceMatter } = f.attempts.readCurrentWork.mock.calls[0][0];
    f.authorizeOpenClawMatterRequest.mockResolvedValue({ ...f.scope, matterId: 'MAT-source' });
    await expect(authorizeReferenceMatter('MAT-source')).resolves.toBeUndefined();
    for (const changed of [{ tenantId: 'other-tenant' }, { actorUserId: 'other-actor' },
      { principalId: 'other-principal' }, { matterId: 'MAT-other' }]) {
      f.authorizeOpenClawMatterRequest.mockResolvedValue({ ...f.scope, matterId: 'MAT-source', ...changed });
      await expect(authorizeReferenceMatter('MAT-source')).rejects.toMatchObject({ statusCode: 503 });
    }
  });

  it('rejects caller-supplied identity, attempt or document fields before dispatch', () => {
    const f = fixture(true, 'read_matter_current_work');
    for (const forged of [{ matterId: 'MAT-one', actorUserId: 'forged' },
      { matterId: 'MAT-one', tenantId: 'tenant-forged' }, { matterId: 'MAT-one', principalId: 'principal-forged' },
      { matterId: 'MAT-one', attemptRef: 'AQ-forged' }, { matterId: 'MAT-one', documents: ['DV-1'] }])
      expect(() => f.call(forged)).toThrow();
    expect(f.authorizeOpenClawMatterRequest).not.toHaveBeenCalled();
    expect(f.attempts.readCurrentWork).not.toHaveBeenCalled();
  });

  it('fails closed on a mismatched app or matter scope and on empty principals', async () => {
    const f = fixture(true, 'read_matter_current_work');
    for (const mismatched of [{ ...f.scope, matterId: 'MAT-other' }, { ...f.scope, appId: 'app_other' },
      { ...f.scope, principalId: '' }, { ...f.scope, actorUserId: '' }]) {
      f.authorizeOpenClawMatterRequest.mockResolvedValue(mismatched);
      await expect(f.call({ matterId: 'MAT-one' })).rejects.toMatchObject({ statusCode: 503 });
    }
    expect(f.attempts.readCurrentWork).not.toHaveBeenCalled();
  });

  it('fails closed when Matter request authorization is unavailable', async () => {
    const f = fixture(false, 'read_matter_current_work');
    await expect(f.call({ matterId: 'MAT-one' })).rejects.toMatchObject({ statusCode: 503 });
    expect(f.attempts.readCurrentWork).not.toHaveBeenCalled();
  });
});
