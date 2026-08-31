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
    Query: noOp,
    Req: noOp,
    UseGuards: noOp,
  };
});

jest.mock(
  '../../server/modules/work-item/production-miaoda-browser-ingress',
  () => ({ miaodaHostedFinalUserActor: jest.fn() }),
);

import { HttpException } from '@nestjs/common';
import type { Request } from 'express';

import { OauthSessionDevelopmentWorkItemController } from '../../server/modules/canonical-host/oauth-session-development-work-item.controller';
import { miaodaHostedFinalUserActor } from '../../server/modules/work-item/production-miaoda-browser-ingress';

const SESSION_ACTOR = { canonicalSubject: { id: 'same-user' } };
const GATEWAY_ACTOR = { canonicalSubject: { id: 'same-user' } };

describe('OauthSessionDevelopmentWorkItemController explicit reparse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(miaodaHostedFinalUserActor)
      .mockReturnValue(GATEWAY_ACTOR as never);
  });

  it('lists existing PDFs through the authenticated Host-owned selection route', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue({ actor: SESSION_ACTOR }),
    };
    const page = {
      schemaVersion: 'wiselink.3_1.oauth_session_existing_pdf_page.v1',
      items: [],
      hasNextPage: false,
      sourceTruncated: false,
    };
    const workItems = {
      listOauthSessionDevelopmentPdfs: jest.fn().mockResolvedValue(page),
    };
    const controller = new OauthSessionDevelopmentWorkItemController(
      sessions as never,
      workItems as never,
    );
    const request = {
      userContext: { userId: 'same-user' },
    } as never as Request;

    await expect(
      controller.listExistingPdfs('777', '24', request),
    ).resolves.toEqual(page);

    expect(workItems.listOauthSessionDevelopmentPdfs).toHaveBeenCalledWith(
      { search: '777', offset: '24' },
      SESSION_ACTOR,
      GATEWAY_ACTOR,
    );
  });

  it('extends the existing retry route and passes only server-derived actors with the same WorkItem id', async () => {
    const sessions = {
      resolve: jest.fn().mockResolvedValue({ actor: SESSION_ACTOR }),
    };
    const workItems = {
      retryOauthSessionDevelopmentRun: jest
        .fn()
        .mockResolvedValue({ actionAttemptId: 'ATT-REPARSE-2' }),
    };
    const controller = new OauthSessionDevelopmentWorkItemController(
      sessions as never,
      workItems as never,
    );
    const request = {
      userContext: { userId: 'same-user' },
    } as never as Request;

    await expect(controller.retry('WI-SAME-1', request)).resolves.toEqual({
      actionAttemptId: 'ATT-REPARSE-2',
    });

    expect(miaodaHostedFinalUserActor).toHaveBeenCalledWith(
      request.userContext,
    );
    expect(workItems.retryOauthSessionDevelopmentRun).toHaveBeenCalledWith(
      'WI-SAME-1',
      SESSION_ACTOR,
      GATEWAY_ACTOR,
    );
  });

  it('rejects before every reparse mutation when the OAuth session is absent', async () => {
    const sessions = { resolve: jest.fn().mockResolvedValue(null) };
    const workItems = { retryOauthSessionDevelopmentRun: jest.fn() };
    const controller = new OauthSessionDevelopmentWorkItemController(
      sessions as never,
      workItems as never,
    );

    await expect(
      controller.retry('WI-SAME-1', {} as Request),
    ).rejects.toBeInstanceOf(HttpException);
    expect(workItems.retryOauthSessionDevelopmentRun).not.toHaveBeenCalled();
    expect(miaodaHostedFinalUserActor).not.toHaveBeenCalled();
  });
});
