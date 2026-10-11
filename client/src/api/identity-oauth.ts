import type {
  OfficialOauthCallbackRequest,
  OfficialOauthStartResponse,
} from '@shared/api.interface';

import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

const FEISHU_AUTHORIZE_ORIGIN = 'https://accounts.feishu.cn';
const FEISHU_AUTHORIZE_PATH = '/open-apis/authen/v1/authorize';

const SERVER_FAILURE_CODES = [
  'IDENTITY_OAUTH_NOT_CONFIGURED',
  'OAUTH_CALLBACK_MISSING_CODE',
  'OAUTH_CALLBACK_MISSING_STATE',
  'OAUTH_STATE_INVALID',
  'OAUTH_TOKEN_EXCHANGE_FAILED',
  'IDENTITY_VERIFICATION_UNAVAILABLE',
] as const;

type RequestFailureCode =
  | (typeof SERVER_FAILURE_CODES)[number]
  | 'START_REQUEST_FAILED'
  | 'CALLBACK_REQUEST_FAILED'
  | 'CALLBACK_OUTCOME_UNKNOWN';

export class OfficialOauthRequestError extends Error {
  readonly code: RequestFailureCode;
  declare readonly status?: number;

  constructor(code: RequestFailureCode, status?: number) {
    super(code);
    this.name = 'OfficialOauthRequestError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export async function startOfficialOauth(): Promise<string> {
  const response = await axiosForBackend<OfficialOauthStartResponse>({
    url: '/api/identity/oauth/start',
    method: 'POST',
    data: {},
  }).catch((error: unknown) => {
    throw transportFailure(error, 'START_REQUEST_FAILED');
  });
  if (response.status !== 200) {
    throw requestFailure(response, 'START_REQUEST_FAILED');
  }
  const authorizeUrl = response.data?.authorizeUrl;
  if (!isOfficialAuthorizeUrl(authorizeUrl)) {
    throw new Error('OAUTH_AUTHORIZE_URL_INVALID');
  }
  return authorizeUrl;
}

export async function exchangeOfficialOauthCallback(
  input: OfficialOauthCallbackRequest,
): Promise<void> {
  const body = new Blob([JSON.stringify(input)], {
    type: 'application/json',
  });
  const response = await axiosForBackend<void>({
    url: '/api/identity/oauth/callback',
    method: 'POST',
    data: body,
    headers: { 'Content-Type': 'application/json' },
  }).catch((error: unknown) => {
    throw transportFailure(error, 'CALLBACK_REQUEST_FAILED');
  });
  if (response.status !== 204) {
    throw requestFailure(response, 'CALLBACK_REQUEST_FAILED');
  }
}

function errorResponse(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'response' in error
    ? error.response
    : undefined;
}

function transportFailure(
  error: unknown,
  fallback: 'START_REQUEST_FAILED' | 'CALLBACK_REQUEST_FAILED',
): OfficialOauthRequestError {
  const response = errorResponse(error);
  if (
    fallback === 'CALLBACK_REQUEST_FAILED' &&
    httpStatus(response) === undefined &&
    typeof error === 'object' &&
    error !== null &&
    (('code' in error &&
      (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED')) ||
      ('name' in error && error.name === 'AbortError'))
  ) {
    return new OfficialOauthRequestError('CALLBACK_OUTCOME_UNKNOWN');
  }
  return requestFailure(response, fallback);
}

function httpStatus(response: unknown): number | undefined {
  if (
    typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    typeof response.status === 'number' &&
    Number.isInteger(response.status) &&
    response.status >= 100 &&
    response.status <= 599
  )
    return response.status;
  return undefined;
}

function requestFailure(
  response: unknown,
  fallback: 'START_REQUEST_FAILED' | 'CALLBACK_REQUEST_FAILED',
): OfficialOauthRequestError {
  let code: RequestFailureCode = fallback;
  const status = httpStatus(response);
  if (typeof response === 'object' && response !== null) {
    if (
      'data' in response &&
      typeof response.data === 'object' &&
      response.data !== null &&
      'code' in response.data
    ) {
      const serverCode = response.data.code;
      code =
        SERVER_FAILURE_CODES.find((known) => known === serverCode) ?? fallback;
    }
  }
  return new OfficialOauthRequestError(code, status);
}

function isOfficialAuthorizeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.origin === FEISHU_AUTHORIZE_ORIGIN &&
      url.pathname === FEISHU_AUTHORIZE_PATH &&
      url.searchParams.get('response_type') === 'code' &&
      url.searchParams.get('code_challenge_method') === 'S256' &&
      Boolean(url.searchParams.get('code_challenge')) &&
      Boolean(url.searchParams.get('state'))
    );
  } catch {
    return false;
  }
}
