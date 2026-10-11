import {
  oauthFailureMessage,
  toOauthFailureCode,
} from '../../client/src/pages/OAuthCallbackPage/oauth-failure-code';

describe('OAuth callback page failure classification', () => {
  it.each([
    ['OAUTH_CALLBACK_REJECTED', 'CALLBACK_REJECTED'],
    ['OAUTH_CALLBACK_INCOMPLETE', 'CALLBACK_INCOMPLETE'],
    ['OAUTH_CALLBACK_FAILED', 'CALLBACK_REQUEST_FAILED'],
    ['OAUTH_START_FAILED', 'START_REQUEST_FAILED'],
    ['OAUTH_AUTHORIZE_URL_INVALID', 'START_RESPONSE_INVALID'],
    ['CALLBACK_REQUEST_FAILED', 'CALLBACK_REQUEST_FAILED'],
    ['CALLBACK_OUTCOME_UNKNOWN', 'CALLBACK_OUTCOME_UNKNOWN'],
    ['START_REQUEST_FAILED', 'START_REQUEST_FAILED'],
    ['IDENTITY_OAUTH_NOT_CONFIGURED', 'IDENTITY_OAUTH_NOT_CONFIGURED'],
    ['OAUTH_CALLBACK_MISSING_CODE', 'OAUTH_CALLBACK_MISSING_CODE'],
    ['OAUTH_CALLBACK_MISSING_STATE', 'OAUTH_CALLBACK_MISSING_STATE'],
    ['OAUTH_STATE_INVALID', 'OAUTH_STATE_INVALID'],
    ['OAUTH_TOKEN_EXCHANGE_FAILED', 'OAUTH_TOKEN_EXCHANGE_FAILED'],
    ['IDENTITY_VERIFICATION_UNAVAILABLE', 'IDENTITY_VERIFICATION_UNAVAILABLE'],
  ])('maps %s without exposing runtime error details', (message, expected) => {
    expect(toOauthFailureCode(new Error(message))).toBe(expected);
  });

  it('collapses unknown values into a non-sensitive code', () => {
    expect(toOauthFailureCode(new Error('secret-bearing runtime detail'))).toBe(
      'UNEXPECTED_OAUTH_FAILURE',
    );
    expect(toOauthFailureCode({ response: { data: 'secret' } })).toBe(
      'UNEXPECTED_OAUTH_FAILURE',
    );
  });

  it.each([
    [
      'IDENTITY_OAUTH_NOT_CONFIGURED',
      '身份连接服务尚未完成配置，请联系管理员。',
    ],
    ['OAUTH_STATE_INVALID', '授权已过期或已使用，请重新连接。'],
    ['OAUTH_CALLBACK_MISSING_CODE', '授权回调不完整，请重新连接。'],
    ['OAUTH_CALLBACK_MISSING_STATE', '授权回调不完整，请重新连接。'],
    [
      'OAUTH_TOKEN_EXCHANGE_FAILED',
      '飞书令牌交换失败，请重新连接；若仍失败，请联系管理员。',
    ],
    [
      'IDENTITY_VERIFICATION_UNAVAILABLE',
      '飞书身份暂无法验证，请稍后重新连接。',
    ],
    ['CALLBACK_REQUEST_FAILED', '身份验证请求失败，请重新连接。'],
    [
      'CALLBACK_OUTCOME_UNKNOWN',
      '身份验证请求已中断，结果尚未确认。请返回原页面核验身份；若仍未连接，再重新授权。',
    ],
    ['START_REQUEST_FAILED', '暂时无法开始飞书授权，请稍后重新连接。'],
  ])('provides a fixed user-facing message for %s', (code, message) => {
    const failureCode = toOauthFailureCode(new Error(code));
    expect(oauthFailureMessage(failureCode)).toBe(message);
    expect(oauthFailureMessage(failureCode)).not.toContain('private');
  });
});
