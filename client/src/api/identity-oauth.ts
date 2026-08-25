import type {
  OfficialOauthCallbackRequest,
  OfficialOauthStartResponse,
} from '@shared/api.interface';

import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

const FEISHU_AUTHORIZE_ORIGIN = 'https://accounts.feishu.cn';
const FEISHU_AUTHORIZE_PATH = '/open-apis/authen/v1/authorize';

export async function startOfficialOauth(): Promise<string> {
  const response = await axiosForBackend<OfficialOauthStartResponse>({
    url: '/api/identity/oauth/start',
    method: 'POST',
    data: {},
  });
  if (response.status !== 200) throw new Error('OAUTH_START_FAILED');
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
  });
  if (response.status !== 204) throw new Error('OAUTH_CALLBACK_FAILED');
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
