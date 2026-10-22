/** Status takes precedence over a transport code: an access rejection cannot
 * retain content merely because a client also reports ERR_NETWORK. */
export function isTemporarySummaryReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = 'response' in error ? error.response : undefined;
  const status = 'statusCode' in error && typeof error.statusCode === 'number'
    ? error.statusCode : response && typeof response === 'object' && 'status' in response
      ? response.status : undefined;
  if (typeof status === 'number') return status >= 500 && status < 600;
  const code = 'code' in error ? error.code : undefined;
  return typeof code === 'string' &&
    ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(code);
}
