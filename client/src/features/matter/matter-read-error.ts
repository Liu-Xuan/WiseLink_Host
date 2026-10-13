/** Access denials replace saved read content; ordinary availability errors do not. */
export function isRevokedMatterError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const directStatus = 'statusCode' in error ? error.statusCode : undefined;
  const response = 'response' in error ? error.response : undefined;
  const status = typeof directStatus === 'number' ? directStatus
    : response && typeof response === 'object' && 'status' in response ? response.status : undefined;
  return status === 401 || status === 403 || status === 404;
}
