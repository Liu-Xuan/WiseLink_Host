import 'reflect-metadata';

const request: jest.Mock = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl: jest.fn(),
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));
jest.mock('../../server/modules/identity/session-resolver.service', () => ({
  SessionResolver: jest.fn(),
}));
jest.mock('../../server/modules/work-item/ordinary-work-item.service', () => ({
  OrdinaryWorkItemService: jest.fn(),
}));

import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request } from 'express';

import { GlobalExceptionFilter } from '../../server/common/filters/exception.filter';
import type { ApiErrorResponse } from '../../server/common/interfaces/api_response.interface';
import { OauthSessionDevelopmentWorkItemController } from '../../server/modules/canonical-host/oauth-session-development-work-item.controller';
import {
  getCanonicalHostClientSessionGeneration,
  getCanonicalHostIdentityContext,
  invalidateCanonicalHostClientSession,
  isCanonicalHostClientSessionAuthenticationRequired,
  listDevelopmentExistingPdfs,
  requireOfficialOauthSession,
  type CanonicalHostIdentityContext,
} from '../../client/src/api/canonical-host';

interface FilteredHttpResponse {
  status: number;
  data: ApiErrorResponse;
}

type DeliveryMode = 'resolved' | 'rejected';
const DELIVERY_MODES: DeliveryMode[] = ['resolved', 'rejected'];

function filteredResponse(exception: unknown): FilteredHttpResponse {
  const sent: Partial<FilteredHttpResponse> = {};
  const response = {
    headersSent: false,
    status(value: number) {
      sent.status = value;
      return response;
    },
    json(value: ApiErrorResponse) {
      sent.data = value;
      return response;
    },
  };
  const host: ArgumentsHost = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);
  if (sent.status === undefined || sent.data === undefined) {
    throw new Error('Expected an HTTP error response from the real filter.');
  }
  return { status: sent.status, data: sent.data };
}

function deliver(response: FilteredHttpResponse, mode: DeliveryMode): void {
  if (mode === 'resolved') request.mockResolvedValueOnce(response);
  else request.mockRejectedValueOnce({ response });
}

async function primeClientSessions(): Promise<CanonicalHostIdentityContext> {
  request.mockResolvedValueOnce({
    status: 200,
    data: { userId: 'test-engineer', tenantId: 'test-tenant' },
  });
  const identity: CanonicalHostIdentityContext =
    await getCanonicalHostIdentityContext();
  request.mockResolvedValueOnce({
    status: 200,
    data: {
      authenticated: true,
      verifiedIdentity: { userId: identity.userId },
      session: { provenance: 'SERVER_OPAQUE_SESSION' },
    },
  });
  await requireOfficialOauthSession();
  return identity;
}

function listExistingPdfs() {
  return listDevelopmentExistingPdfs({
    search: '',
    offset: 0,
    signal: new AbortController().signal,
  });
}

describe('existing PDF controller/filter/client session errors', () => {
  beforeEach(() => {
    request.mockReset();
    invalidateCanonicalHostClientSession();
  });

  it.each(DELIVERY_MODES)(
    'keeps platform identity for the real controller missing-session error (%s)',
    async (mode: DeliveryMode) => {
      const sessions = { resolve: jest.fn().mockResolvedValue(null) };
      const workItems = { listOauthSessionDevelopmentPdfs: jest.fn() };
      const controller: OauthSessionDevelopmentWorkItemController =
        new OauthSessionDevelopmentWorkItemController(
          sessions as never,
          workItems as never,
        );
      const serverRequest: Request = {
        userContext: { userId: 'test-engineer' },
      } as unknown as Request;
      const exception: unknown = await controller
        .listExistingPdfs(undefined, undefined, serverRequest)
        .catch((reason: unknown) => reason);
      expect(exception).toBeInstanceOf(HttpException);
      expect(sessions.resolve).toHaveBeenCalledWith(serverRequest);
      expect(workItems.listOauthSessionDevelopmentPdfs).not.toHaveBeenCalled();

      const response: FilteredHttpResponse = filteredResponse(exception);
      expect(response.status).toBe(401);
      expect(response.data.error).toMatchObject({
        code: 'SESSION_REQUIRED',
        details: JSON.stringify({ code: 'SESSION_REQUIRED', statusCode: 401 }),
      });

      const identity: CanonicalHostIdentityContext = await primeClientSessions();
      const generation: number = getCanonicalHostClientSessionGeneration();
      deliver(response, mode);
      await expect(listExistingPdfs()).rejects.toMatchObject({
        code: 'OFFICIAL_OAUTH_SESSION_REQUIRED',
        statusCode: 401,
      });
      expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(false);
      expect(getCanonicalHostClientSessionGeneration()).toBe(generation);
      await expect(getCanonicalHostIdentityContext()).resolves.toBe(identity);
      expect(request).toHaveBeenCalledTimes(3);
      expect(request.mock.calls[2][0]).toMatchObject({
        url: '/api/canonical-host/work-items/development-runs/existing-pdfs',
        method: 'GET',
      });

      // Only the independent Host OAuth cache needs a fresh verification.
      request.mockResolvedValueOnce({
        status: 200,
        data: {
          authenticated: true,
          verifiedIdentity: { userId: identity.userId },
          session: { provenance: 'SERVER_OPAQUE_SESSION' },
        },
      });
      await requireOfficialOauthSession();
      expect(request).toHaveBeenCalledTimes(4);
      expect(request.mock.calls[3][0].url).toBe('/api/identity/whoami');
    },
  );

  it.each(DELIVERY_MODES)(
    'still invalidates platform identity for an ordinary platform 401 (%s)',
    async (mode: DeliveryMode) => {
      await primeClientSessions();
      const generation: number = getCanonicalHostClientSessionGeneration();
      const response: FilteredHttpResponse = filteredResponse(
        new UnauthorizedException('Platform login required.'),
      );
      expect(response.status).toBe(401);
      expect(response.data.error.code).toBe('UNAUTHORIZED');
      deliver(response, mode);

      await expect(listExistingPdfs()).rejects.toBeDefined();
      expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
      expect(getCanonicalHostClientSessionGeneration()).toBe(generation + 1);
    },
  );

  it.each(DELIVERY_MODES)(
    'keeps a 403 denial even if its payload contains SESSION_REQUIRED (%s)',
    async (mode: DeliveryMode) => {
      const identity: CanonicalHostIdentityContext = await primeClientSessions();
      const generation: number = getCanonicalHostClientSessionGeneration();
      const response: FilteredHttpResponse = filteredResponse(
        new ForbiddenException({ code: 'SESSION_REQUIRED', statusCode: 401 }),
      );
      expect(response.status).toBe(403);
      expect(response.data.error.code).toBe('FORBIDDEN');
      deliver(response, mode);

      await expect(listExistingPdfs()).rejects.toBeDefined();
      expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(false);
      expect(getCanonicalHostClientSessionGeneration()).toBe(generation);
      await expect(getCanonicalHostIdentityContext()).resolves.toBe(identity);
      expect(request).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    new HttpException('SESSION_REQUIRED', 401),
    new HttpException({ code: 'PLATFORM_LOGIN_REQUIRED' }, 401),
    new HttpException({ message: 'SESSION_REQUIRED' }, 401),
  ])('does not preserve unclassified HttpException 401 codes', (exception: HttpException) => {
    const response: FilteredHttpResponse = filteredResponse(exception);
    expect(response.status).toBe(401);
    expect(response.data.error.code).toBe('UNAUTHORIZED');
  });
});
