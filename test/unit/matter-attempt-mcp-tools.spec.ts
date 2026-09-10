import { registerMatterAttemptMcpTools } from '../../server/modules/canonical-host/matter-attempt-mcp-tools';

function fixture(allowed = true, tool = 'matter_action_attempt') {
  const registerTool = jest.fn();
  const attempts = { reserveJobAid: jest.fn().mockResolvedValue({ task: { operationRef: 'AQ-new' }, row: { status: 'QUEUED' }, created: true }), claim: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
    read: jest.fn().mockResolvedValue({ status: 'RUNNING', errorCode: null, deadlineAt: null,
      leaseToken: 'private-token', taskEnvelopeJson: 'private-task' }),
    heartbeat: jest.fn(), cancel: jest.fn().mockResolvedValue({ status: 'CANCELLED' }),
    readSourcePages: jest.fn().mockImplementation((input, reader) => reader(input.documentVersionId, { pageStart: input.pageStart, pageEnd: input.pageStart })),
    readSavedWork: jest.fn().mockResolvedValue({ matterWorkRevisionId: 'MWR-exact' }) };
  const documents = { readDocumentSourcePagesForRuntime: jest.fn().mockResolvedValue({ pages: [] }) };
  const scope = { appId: 'app_17bzc551rsg', actorUserId: 'host-actor', tenantId: 'host-tenant',
    principalId: 'service:executor', matterId: 'MAT-one', attemptRef: 'AQ-one' };
  const authorizeOpenClawMatterAttempt = jest.fn().mockResolvedValue(scope);
  const authorizeOpenClawMatterRequest = jest.fn().mockResolvedValue(scope);
  registerMatterAttemptMcpTools({ registerTool } as never, attempts as never,
    allowed ? { authorizeOpenClawMatterAttempt, authorizeOpenClawMatterRequest } as never : {} as never, documents as never);
  const [name, definition, handler] = registerTool.mock.calls.find(([name]) => name === tool)!;
  return { attempts, documents, scope, authorizeOpenClawMatterAttempt, name,
    call: (input: unknown) => handler(definition.inputSchema.parse(input)) };
}
const request = { operation: 'CLAIM', matterId: 'MAT-one', attemptRef: 'AQ-one' };

describe('Matter MCP existing attempt lifecycle', () => {
  it('creates a Host-built JobAid request with exact CAS and no caller model context', async () => {
    const f = fixture(true, 'begin_matter_assessment');
    const input = { matterId: 'MAT-one', expectedMatterRevisionId: 'MR-one', expectedMatterRevision: 2,
      expectedWorkingRevision: 3, requestId: 'request-one', instruction: '复核新增资料' };
    await f.call(input);
    expect(f.attempts.reserveJobAid).toHaveBeenCalledWith({ tenantId: 'host-tenant', actorUserId: 'host-actor',
      matterId: 'MAT-one', expectedMatterRevisionId: 'MR-one', expectedMatterRevision: 2,
      expectedWorkingRevision: 3, idempotencyKey: 'matter:MAT-one:request-one',
      trigger: { kind: 'USER_REQUEST', requestId: 'request-one', instruction: '复核新增资料' } });
    expect(() => f.call({ ...input, modelInput: { forged: true } })).toThrow();
  });

  it('reads physical sources through the fenced Matter service using Host actor scope', async () => {
    const f = fixture();
    await f.call({ ...request, operation: 'READ_SOURCES', documentVersionId: 'DV-one', pageStart: 2,
      purpose: '核对前提', leaseToken: 'f1111111-1111-4111-8111-111111111111', leaseGeneration: 1 });
    expect(f.documents.readDocumentSourcePagesForRuntime).toHaveBeenCalledWith('DV-one', { pageStart: 2, pageEnd: 2 }, f.scope);
  });

  it('passes only Host-authorized identity to the real Matter service', async () => {
    const f = fixture();
    expect(f.name).toBe('matter_action_attempt');
    await f.call(request);
    expect(f.attempts.claim).toHaveBeenCalledWith(f.scope);
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
  });
  it('reads the exact save request without claiming or creating another attempt', async () => {
    const f = fixture();
    await f.call({ ...request, operation: 'READ_SAVED_WORK', requestId: 'save-first' });
    expect(f.attempts.readSavedWork).toHaveBeenCalledWith({ ...f.scope, requestId: 'save-first' });
    expect(f.attempts.claim).not.toHaveBeenCalled();
  });
});
