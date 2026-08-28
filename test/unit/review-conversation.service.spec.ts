import { ReviewConversationService } from '../../server/modules/review-persistence/review-conversation.service';

const actor = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'actor-1' },
  tenantId: 'tenant-1',
  sessionProvenance: 'SERVER_OPAQUE_SESSION',
};
const session = { actor, session: { id: 'session-1' } };
const grant = {
  allowed: true,
  action: 'RECORD_ENGINEER_REVIEW',
  workItemId: 'WI-1',
  workItemRevision: 7,
  tenantId: 'tenant-1',
  actorUserId: 'actor-1',
};
const conversation = {
  reviewConversationId: 'RC-1',
  tenantId: 'tenant-1',
  actorId: 'actor-1',
  workItemId: 'WI-1',
  openClawAgentId: 'wiselink-engineering',
  openClawSessionKey: 'review:tenant-1:actor-1:WI-1:RC-1',
  startedAtRevision: 6,
  lastSyncedRevision: 7,
  status: 'ACTIVE',
  createdAt: new Date('2026-08-26T01:00:00.000Z'),
  lastActiveAt: new Date('2026-08-26T01:01:00.000Z'),
  closedAt: null,
};
const turn = {
  reviewTurnId: 'RT-1',
  reviewConversationId: 'RC-1',
  engineerSuppliedInputId: 'ESI-1',
  turnNo: 1,
  requestId: 'request-1',
  inputRevision: 7,
  userMessage: 'Engineer supplied context',
  inputType: 'ENGINEER_TEXT',
  adoptionStatus: 'CANDIDATE_UNADOPTED',
  candidateText: 'Engineer supplied context',
  attachmentBindings: [],
  assistantCandidate: null,
  createdAt: new Date('2026-08-26T01:02:00.000Z'),
};

describe('ReviewConversationService session and ACL boundary', () => {
  it('derives tenant, actor and revision only from session + fresh ACL', async () => {
    const setup = makeService();
    setup.conversations.createOrResume.mockResolvedValue({
      aggregate: { conversation, turns: [] },
      created: true,
    });
    const result = await setup.service.createOrResume('WI-1', {
      body: { actorId: 'forged', tenantId: 'forged' },
    } as never);
    expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'RECORD_ENGINEER_REVIEW',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
    expect(setup.conversations.createOrResume).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      workItemId: 'WI-1',
      currentRevision: 7,
    });
    expect(result.resumed).toBe(false);
    expect(JSON.stringify(result)).not.toContain('actor-1');
    expect(JSON.stringify(result)).not.toContain('openClawSessionKey');
  });

  it('fails before repository access without an OAuth session', async () => {
    const setup = makeService();
    setup.sessions.resolve.mockResolvedValue(null);
    await expect(
      setup.service.current('WI-1', {} as never),
    ).rejects.toMatchObject({ code: 'SESSION_REQUIRED', statusCode: 401 });
    expect(setup.objectAccess.freshRead).not.toHaveBeenCalled();
    expect(setup.conversations.loadCurrent).not.toHaveBeenCalled();
  });

  it('propagates fresh WorkItem ACL denial without reading conversation data', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead.mockResolvedValue({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    await expect(
      setup.service.current('WI-other', {} as never),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(setup.conversations.loadCurrent).not.toHaveBeenCalled();
  });

  it('uses read permission only for current conversation lookup', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead.mockResolvedValue({
      ...grant,
      action: 'READ_WORK_ITEM',
    });
    setup.conversations.loadCurrent.mockResolvedValue(null);

    await setup.service.current('WI-1', {} as never);

    expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
  });

  it.each(['append', 'close'] as const)(
    'stops denied %s before all review repository I/O',
    async (operation) => {
      const setup = makeService();
      setup.objectAccess.freshRead.mockResolvedValue({
        allowed: false,
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });

      const result =
        operation === 'append'
          ? setup.service.appendTextTurn(
              'WI-other',
              'RC-1',
              { requestId: 'request-1', userMessage: 'text' },
              {} as never,
            )
          : setup.service.close('WI-other', 'RC-1', {} as never);

      await expect(result).rejects.toMatchObject({
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });
      expect(setup.objectAccess.freshRead).toHaveBeenCalledWith({
        actor,
        action: 'RECORD_ENGINEER_REVIEW',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI-other' },
      });
      expect(setup.conversations.loadById).not.toHaveBeenCalled();
      expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
      expect(setup.conversations.close).not.toHaveBeenCalled();
    },
  );

  it('fails closed when an authorized WorkItem has another actor conversation', async () => {
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({
      conversation: { ...conversation, actorId: 'actor-2' },
      turns: [],
    });
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        { requestId: 'request-1', userMessage: 'text' },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_CONVERSATION_NOT_FOUND',
      statusCode: 404,
    });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('appends at the fresh WorkItem revision and returns idempotent replay state', async () => {
    const setup = makeService();
    setup.conversations.loadById
      .mockResolvedValueOnce({ conversation, turns: [] })
      .mockResolvedValueOnce({
        conversation: { ...conversation, lastActiveAt: turn.createdAt },
        turns: [turn],
      });
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn,
      replayed: true,
    });
    const result = await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      { requestId: 'request-1', userMessage: 'Engineer supplied context' },
      {} as never,
    );
    expect(setup.conversations.appendTextTurn).toHaveBeenCalledWith({
      conversation,
      requestId: 'request-1',
      userMessage: 'Engineer supplied context',
      currentRevision: 7,
      attachmentBindings: [],
    });
    expect(setup.sessions.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    );
    expect(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    ).toBeLessThan(setup.conversations.loadById.mock.invocationCallOrder[0]);
    expect(result.replayed).toBe(true);
    expect(result.turn).toMatchObject({
      turnNo: 1,
      inputRevision: 7,
      engineerSuppliedInput: {
        inputType: 'ENGINEER_TEXT',
        adoptionStatus: 'CANDIDATE_UNADOPTED',
      },
    });
    expect(JSON.stringify(result)).not.toContain('openClawSessionKey');
  });

  it('authorizes, ingests and publicly redacts an official-selection attachment', async () => {
    const setup = makeService();
    const attachment = {
      attachmentRef: 'ATTACHMENT-1',
      documentVersionId: 'DV-ATT-1',
      fileName: 'engineering-note.pdf',
      mediaType: 'application/pdf',
      byteLength: 321,
      selectionKey: 'default-bucket\nofficial-selection/engineering-note.pdf',
      parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact-internal-ref',
        sha256: 'a'.repeat(64),
        byteLength: 100,
      },
    };
    const attachedTurn = { ...turn, attachmentBindings: [attachment] };
    setup.objectAccess.freshRead
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({
        ...grant,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      })
      .mockResolvedValueOnce(grant);
    setup.conversations.loadById
      .mockResolvedValueOnce({ conversation, turns: [] })
      .mockResolvedValueOnce({ conversation, turns: [attachedTurn] });
    setup.attachments.ingest.mockResolvedValue(attachment);
    setup.conversations.appendTextTurn.mockResolvedValue({
      turn: attachedTurn,
      replayed: false,
    });

    const result = await setup.service.appendTextTurn(
      'WI-1',
      'RC-1',
      {
        requestId: 'request-1',
        userMessage: 'Engineer supplied context',
        attachmentSelection: {
          bucketId: 'default-bucket',
          filePath: 'official-selection/engineering-note.pdf',
        },
      },
      {} as never,
    );

    expect(setup.objectAccess.freshRead).toHaveBeenNthCalledWith(2, {
      actor,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
      expectedWorkItemRevision: 7,
    });
    expect(setup.attachments.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        conversation,
        session,
      }),
    );
    expect(result.turn.attachmentRefs).toEqual(['ATTACHMENT-1']);
    expect(JSON.stringify(result)).not.toContain('official-selection');
    expect(JSON.stringify(result)).not.toContain('artifact-internal-ref');
  });

  it('keeps ReviewTurn and EngineerSuppliedInput at zero writes when DM attachment ingestion fails', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({
        ...grant,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      });
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [],
    });
    setup.attachments.ingest.mockRejectedValue(
      Object.assign(new Error('Document identity is unresolved.'), {
        code: 'DOCUMENT_IDENTITY_UNRESOLVED',
      }),
    );

    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-attachment-failed',
          userMessage: 'Must not persist without an immutable version.',
          attachmentSelection: {
            bucketId: 'default-bucket',
            filePath: 'official-selection/engineering-note.pdf',
          },
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_IDENTITY_UNRESOLVED' });

    expect(setup.attachments.ingest).toHaveBeenCalledTimes(1);
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('keeps ReviewTurn and EngineerSuppliedInput at zero writes when post-ingest ACL reauthorization is denied', async () => {
    const setup = makeService();
    setup.objectAccess.freshRead
      .mockResolvedValueOnce(grant)
      .mockResolvedValueOnce({
        ...grant,
        action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      })
      .mockResolvedValueOnce({
        allowed: false,
        code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
        statusCode: 404,
      });
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [],
    });
    setup.attachments.ingest.mockResolvedValue({
      attachmentRef: 'ATTACHMENT-POST-ACL',
      documentVersionId: 'DV-POST-ACL',
      fileName: 'engineering-note.pdf',
      mediaType: 'application/pdf',
      byteLength: 321,
      selectionKey: 'default-bucket\nofficial-selection/engineering-note.pdf',
      parsedArtifact: {
        storeRole: 'UnifiedArtifactStoreCandidate',
        ref: 'artifact-internal-ref',
        sha256: 'a'.repeat(64),
        byteLength: 100,
      },
    });

    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-post-ingest-denied',
          userMessage: 'Must reauthorize before persistence.',
          attachmentSelection: {
            bucketId: 'default-bucket',
            filePath: 'official-selection/engineering-note.pdf',
          },
        },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });

    expect(setup.attachments.ingest).toHaveBeenCalledTimes(1);
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('rejects append after close and performs no turn write', async () => {
    const setup = makeService();
    setup.conversations.loadById.mockResolvedValue({
      conversation: {
        ...conversation,
        status: 'CLOSED',
        closedAt: new Date('2026-08-26T01:03:00.000Z'),
      },
      turns: [turn],
    });
    await expect(
      setup.service.appendTextTurn(
        'WI-1',
        'RC-1',
        { requestId: 'request-2', userMessage: 'too late' },
        {} as never,
      ),
    ).rejects.toMatchObject({
      code: 'REVIEW_CONVERSATION_CLOSED',
      statusCode: 409,
    });
    expect(setup.conversations.appendTextTurn).not.toHaveBeenCalled();
  });

  it('closes against fresh ACL revision without changing WorkItem state', async () => {
    const setup = makeService();
    const closedConversation = {
      ...conversation,
      status: 'CLOSED',
      closedAt: new Date('2026-08-26T01:03:00.000Z'),
    };
    setup.conversations.loadById.mockResolvedValue({
      conversation,
      turns: [turn],
    });
    setup.conversations.close.mockResolvedValue({
      aggregate: { conversation: closedConversation, turns: [turn] },
      alreadyClosed: false,
    });
    const result = await setup.service.close('WI-1', 'RC-1', {} as never);
    expect(setup.conversations.close).toHaveBeenCalledWith({
      conversation,
      currentRevision: 7,
    });
    expect(setup.sessions.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    );
    expect(
      setup.objectAccess.freshRead.mock.invocationCallOrder[0],
    ).toBeLessThan(setup.conversations.loadById.mock.invocationCallOrder[0]);
    expect(result.conversation.status).toBe('CLOSED');
    expect(result.conversation.currentWorkItemRevision).toBe(7);
  });
});

function makeService() {
  const sessions = { resolve: jest.fn().mockResolvedValue(session) };
  const objectAccess = { freshRead: jest.fn().mockResolvedValue(grant) };
  const conversations = {
    createOrResume: jest.fn(),
    loadCurrent: jest.fn(),
    loadById: jest.fn(),
    appendTextTurn: jest.fn(),
    close: jest.fn(),
  };
  const attachments = { ingest: jest.fn() };
  return {
    service: new ReviewConversationService(
      sessions as never,
      objectAccess as never,
      conversations as never,
      attachments as never,
    ),
    sessions,
    objectAccess,
    conversations,
    attachments,
  };
}
