/**
 * Repeat one read only when no HTTP response was received. Authorization,
 * not-found, provider errors and semantic checks are not transport failures.
 * Never use this helper to repeat uploads or other writes.
 */
export async function withOneFileReadTransportRetry<T>(
  read: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    if (!isFileServiceTransportFailure(cause)) throw cause;
    return await read();
  }
}

/** No HTTP response was received; this alone never authorizes another write. */
export function isFileServiceTransportFailure(cause: unknown): boolean {
  return !hasHttpStatus(cause) && hasTransportSignature(cause);
}

function hasHttpStatus(cause: unknown, seen = new Set<unknown>()): boolean {
  if (!cause || (typeof cause !== 'object' && typeof cause !== 'function')) {
    return false;
  }
  if (seen.has(cause)) return false;
  seen.add(cause);
  const value = cause as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
  };
  const statuses = [value.status, value.statusCode, value.response?.status];
  return (
    statuses.some((status) => status !== undefined && status !== null) ||
    hasHttpStatus(value.cause, seen)
  );
}

function hasTransportSignature(
  cause: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (!cause || (typeof cause !== 'object' && typeof cause !== 'function')) {
    return false;
  }
  if (seen.has(cause)) return false;
  seen.add(cause);
  const value = cause as { message?: unknown; code?: unknown; cause?: unknown };
  const message = String(value.message ?? '')
    .trim()
    .toLowerCase();
  const code = String(value.code ?? '')
    .trim()
    .toUpperCase();
  return (
    message === 'fetch failed' ||
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
      'ECONNREFUSED',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
    ].includes(code) ||
    hasTransportSignature(value.cause, seen)
  );
}
