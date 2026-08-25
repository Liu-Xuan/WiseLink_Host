import { toOauthFailureCode } from '../../client/src/pages/OAuthCallbackPage/oauth-failure-code';

describe('OAuth callback page failure classification', () => {
  it.each([
    ['OAUTH_CALLBACK_REJECTED', 'CALLBACK_REJECTED'],
    ['OAUTH_CALLBACK_INCOMPLETE', 'CALLBACK_INCOMPLETE'],
    ['OAUTH_CALLBACK_FAILED', 'CALLBACK_REQUEST_FAILED'],
    ['OAUTH_START_FAILED', 'START_REQUEST_FAILED'],
    ['OAUTH_AUTHORIZE_URL_INVALID', 'START_RESPONSE_INVALID'],
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
});
