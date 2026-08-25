export type OAuthFailureCode =
  | 'CALLBACK_REJECTED'
  | 'CALLBACK_INCOMPLETE'
  | 'CALLBACK_REQUEST_FAILED'
  | 'START_REQUEST_FAILED'
  | 'START_RESPONSE_INVALID'
  | 'UNEXPECTED_OAUTH_FAILURE';

export function toOauthFailureCode(error: unknown): OAuthFailureCode {
  if (!(error instanceof Error)) return 'UNEXPECTED_OAUTH_FAILURE';
  switch (error.message) {
    case 'OAUTH_CALLBACK_REJECTED':
      return 'CALLBACK_REJECTED';
    case 'OAUTH_CALLBACK_INCOMPLETE':
      return 'CALLBACK_INCOMPLETE';
    case 'OAUTH_CALLBACK_FAILED':
      return 'CALLBACK_REQUEST_FAILED';
    case 'OAUTH_START_FAILED':
      return 'START_REQUEST_FAILED';
    case 'OAUTH_AUTHORIZE_URL_INVALID':
      return 'START_RESPONSE_INVALID';
    default:
      return 'UNEXPECTED_OAUTH_FAILURE';
  }
}
