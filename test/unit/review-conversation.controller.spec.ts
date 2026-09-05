import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return {
    ...actual,
    Body: noOp,
    Controller: noOp,
    Get: noOp,
    Param: noOp,
    Post: noOp,
    Req: noOp,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

import { ReviewConversationController } from '../../server/modules/review-persistence/review-conversation.controller';

describe('ReviewConversationController request boundary', () => {
  it('accepts automatic execution as an explicit append option', async () => {
    const setup = makeController();
    await setup.controller.appendTextTurn('WI-1', 'RC-1', {
      requestId: 'request-auto', userMessage: 'Continue this discussion', executionMode: 'AUTOMATIC',
    }, {} as never);
    expect(setup.service.appendTextTurn).toHaveBeenCalledWith('WI-1', 'RC-1', expect.objectContaining({ executionMode: 'AUTOMATIC' }), expect.anything());
  });

  it('passes normalized WorkItem routes for create and current', async () => {
    const setup = makeController();
    setup.service.createOrResume.mockResolvedValue({ ok: true });
    setup.service.current.mockResolvedValue({ ok: true });

    await setup.controller.createOrResume(' WI-1 ', {}, {} as never);
    await setup.controller.current(' WI-1 ', {} as never);

    expect(setup.service.createOrResume).toHaveBeenCalledWith(
      'WI-1',
      expect.anything(),
    );
    expect(setup.service.current).toHaveBeenCalledWith(
      'WI-1',
      expect.anything(),
    );
  });

  it('rejects client-reported actor, tenant and session fields', async () => {
    const setup = makeController();
    await expect(
      setup.controller.createOrResume(
        'WI-1',
        {
          actorId: 'forged',
          tenantId: 'forged',
          sessionKey: 'forged',
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(setup.service.createOrResume).not.toHaveBeenCalled();
  });

  it('keeps text-only append requests compatible', async () => {
    const setup = makeController();
    setup.service.appendTextTurn.mockResolvedValue({ ok: true });
    await setup.controller.appendTextTurn(
      'WI-1',
      'RC-1',
      { requestId: ' request-1 ', userMessage: ' text ' },
      {} as never,
    );
    expect(setup.service.appendTextTurn).toHaveBeenCalledWith(
      'WI-1',
      'RC-1',
      { requestId: 'request-1', userMessage: 'text' },
      expect.anything(),
    );
  });

  it.each(['GOV-008', null])(
    'passes the selected evaluation item %s',
    async (selectedEvaluationItemId) => {
      const setup = makeController();
      await setup.controller.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-focus-1',
          userMessage: 'Explain this point',
          selectedEvaluationItemId,
        },
        {} as never,
      );
      expect(setup.service.appendTextTurn).toHaveBeenCalledWith(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-focus-1',
          userMessage: 'Explain this point',
          selectedEvaluationItemId,
        },
        expect.anything(),
      );
    },
  );

  it('accepts an exact official FileService selection without client authority fields', async () => {
    const setup = makeController();
    setup.service.appendTextTurn.mockResolvedValue({ ok: true });
    await setup.controller.appendTextTurn(
      'WI-1',
      'RC-1',
      {
        requestId: 'request-attachment-1',
        userMessage: 'Use the attached engineering note',
        selectedEvaluationItemId: 'GOV-008',
        attachmentSelection: {
          bucketId: 'default-bucket',
          filePath: 'official-selection/engineering-note.pdf',
        },
      },
      {} as never,
    );
    expect(setup.service.appendTextTurn).toHaveBeenCalledWith(
      'WI-1',
      'RC-1',
      {
        requestId: 'request-attachment-1',
        userMessage: 'Use the attached engineering note',
        selectedEvaluationItemId: 'GOV-008',
        attachmentSelection: {
          bucketId: 'default-bucket',
          filePath: 'official-selection/engineering-note.pdf',
        },
      },
      expect.anything(),
    );
  });

  it('rejects self-reported revision and adoption state on append', async () => {
    const setup = makeController();
    await expect(
      setup.controller.appendTextTurn(
        'WI-1',
        'RC-1',
        {
          requestId: 'request-1',
          userMessage: 'text',
          inputRevision: 999,
          adoptionStatus: 'ADOPTED',
        },
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(setup.service.appendTextTurn).not.toHaveBeenCalled();
  });

  it('rejects empty or oversized text before service I/O', async () => {
    const setup = makeController();
    await expect(
      setup.controller.appendTextTurn(
        'WI-1',
        'RC-1',
        { requestId: 'request-1', userMessage: '   ' },
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      setup.controller.appendTextTurn(
        'WI-1',
        'RC-1',
        { requestId: 'request-1', userMessage: 'x'.repeat(20_001) },
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(setup.service.appendTextTurn).not.toHaveBeenCalled();
  });

  it('allows close only with an empty body', async () => {
    const setup = makeController();
    await expect(
      setup.controller.close(
        'WI-1',
        'RC-1',
        { actorId: 'forged' },
        {} as never,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(setup.service.close).not.toHaveBeenCalled();
  });

  it('passes both exact route bindings to close', async () => {
    const setup = makeController();
    setup.service.close.mockResolvedValue({ ok: true });

    await setup.controller.close(' WI-1 ', ' RC-1 ', {}, {} as never);

    expect(setup.service.close).toHaveBeenCalledWith(
      'WI-1',
      'RC-1',
      expect.anything(),
    );
  });
});

function makeController() {
  const service = {
    createOrResume: jest.fn(),
    current: jest.fn(),
    appendTextTurn: jest.fn(),
    close: jest.fn(),
  };
  return {
    controller: new ReviewConversationController(service as never),
    service,
  };
}
