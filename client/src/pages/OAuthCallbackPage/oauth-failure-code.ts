export type OAuthFailureCode =
  | 'CALLBACK_REJECTED'
  | 'CALLBACK_INCOMPLETE'
  | 'CALLBACK_REQUEST_FAILED'
  | 'CALLBACK_OUTCOME_UNKNOWN'
  | 'START_REQUEST_FAILED'
  | 'START_RESPONSE_INVALID'
  | 'IDENTITY_OAUTH_NOT_CONFIGURED'
  | 'OAUTH_CALLBACK_MISSING_CODE'
  | 'OAUTH_CALLBACK_MISSING_STATE'
  | 'OAUTH_STATE_INVALID'
  | 'OAUTH_TOKEN_EXCHANGE_FAILED'
  | 'IDENTITY_VERIFICATION_UNAVAILABLE'
  | 'UNEXPECTED_OAUTH_FAILURE';

export function toOauthFailureCode(error: unknown): OAuthFailureCode {
  if (!(error instanceof Error)) return 'UNEXPECTED_OAUTH_FAILURE';
  switch (error.message) {
    case 'OAUTH_CALLBACK_REJECTED':
      return 'CALLBACK_REJECTED';
    case 'OAUTH_CALLBACK_INCOMPLETE':
      return 'CALLBACK_INCOMPLETE';
    case 'OAUTH_CALLBACK_FAILED':
    case 'CALLBACK_REQUEST_FAILED':
      return 'CALLBACK_REQUEST_FAILED';
    case 'OAUTH_START_FAILED':
    case 'START_REQUEST_FAILED':
      return 'START_REQUEST_FAILED';
    case 'OAUTH_AUTHORIZE_URL_INVALID':
      return 'START_RESPONSE_INVALID';
    case 'IDENTITY_OAUTH_NOT_CONFIGURED':
    case 'CALLBACK_OUTCOME_UNKNOWN':
    case 'OAUTH_CALLBACK_MISSING_CODE':
    case 'OAUTH_CALLBACK_MISSING_STATE':
    case 'OAUTH_STATE_INVALID':
    case 'OAUTH_TOKEN_EXCHANGE_FAILED':
    case 'IDENTITY_VERIFICATION_UNAVAILABLE':
      return error.message;
    default:
      return 'UNEXPECTED_OAUTH_FAILURE';
  }
}

export function oauthFailureMessage(code: OAuthFailureCode | null): string {
  switch (code) {
    case 'IDENTITY_OAUTH_NOT_CONFIGURED':
      return '身份连接服务尚未完成配置，请联系管理员。';
    case 'CALLBACK_INCOMPLETE':
    case 'OAUTH_CALLBACK_MISSING_CODE':
    case 'OAUTH_CALLBACK_MISSING_STATE':
      return '授权回调不完整，请重新连接。';
    case 'OAUTH_STATE_INVALID':
      return '授权已过期或已使用，请重新连接。';
    case 'OAUTH_TOKEN_EXCHANGE_FAILED':
      return '飞书令牌交换失败，请重新连接；若仍失败，请联系管理员。';
    case 'IDENTITY_VERIFICATION_UNAVAILABLE':
      return '飞书身份暂无法验证，请稍后重新连接。';
    case 'START_REQUEST_FAILED':
      return '暂时无法开始飞书授权，请稍后重新连接。';
    case 'CALLBACK_REQUEST_FAILED':
      return '身份验证请求失败，请重新连接。';
    case 'CALLBACK_OUTCOME_UNKNOWN':
      return '身份验证请求已中断，结果尚未确认。请返回原页面核验身份；若仍未连接，再重新授权。';
    default:
      return '授权参数无效、已过期或服务暂不可用，请重新开始。';
  }
}
