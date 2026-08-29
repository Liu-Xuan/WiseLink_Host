import { getCsrfToken } from '@lark-apaas/client-toolkit';

const CSRF_HEADER_NAME = 'X-Suda-Csrf-Token';

export interface PdfDocumentRequestParameters {
  url: string;
  withCredentials: true;
  httpHeaders?: Record<string, string>;
  disableRange: boolean;
  disableStream: boolean;
  disableAutoFetch: boolean;
  isEvalSupported: false;
  stopAtErrors: true;
}

export function buildPdfDocumentRequest(
  url: string,
  supportsRange: boolean,
  csrfToken: string | null | undefined = readOfficialCsrfToken(),
): PdfDocumentRequestParameters {
  const normalizedToken: string | null =
    typeof csrfToken === 'string' && csrfToken.trim().length > 0
      ? csrfToken
      : null;

  return {
    url,
    withCredentials: true,
    ...(normalizedToken
      ? { httpHeaders: { [CSRF_HEADER_NAME]: normalizedToken } }
      : {}),
    disableRange: !supportsRange,
    disableStream: !supportsRange,
    disableAutoFetch: !supportsRange,
    isEvalSupported: false,
    stopAtErrors: true,
  };
}

function readOfficialCsrfToken(): string | null {
  // The toolkit declaration currently says `string`, while its runtime helper
  // intentionally returns null when neither the cookie nor window token exists.
  return getCsrfToken() as string | null;
}
