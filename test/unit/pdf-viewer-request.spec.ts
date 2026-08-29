const getCsrfToken = jest.fn();

jest.mock('@lark-apaas/client-toolkit', () => ({
  getCsrfToken,
}));

import { buildPdfDocumentRequest } from '../../client/src/pages/DocumentParsingPage/pdf-viewer-request';

describe('PDF.js controlled request parameters', () => {
  beforeEach(() => {
    getCsrfToken.mockReset();
  });

  it('adds only the official CSRF header without changing a Hosted URL', () => {
    const url =
      '/app/app_hosted/api/canonical-host/work-items/WI-1001/pdf-preview/v1.opaque';
    const request = buildPdfDocumentRequest(
      url,
      false,
      'controlled-csrf-token',
    );

    expect(request).toEqual({
      url,
      withCredentials: true,
      httpHeaders: { 'X-Suda-Csrf-Token': 'controlled-csrf-token' },
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      isEvalSupported: false,
      stopAtErrors: true,
    });
    expect(request.url).not.toContain('controlled-csrf-token');
    expect(Object.keys(request.httpHeaders ?? {})).toEqual([
      'X-Suda-Csrf-Token',
    ]);
  });

  it('keeps a local app URL and range capability unchanged', () => {
    const url =
      '/api/canonical-host/work-items/WI-1001/pdf-preview/v1.local-opaque';

    expect(
      buildPdfDocumentRequest(url, true, 'local-csrf-token'),
    ).toMatchObject({
      url,
      withCredentials: true,
      httpHeaders: { 'X-Suda-Csrf-Token': 'local-csrf-token' },
      disableRange: false,
      disableStream: false,
      disableAutoFetch: false,
    });
  });

  it('omits the header when the official token is absent or blank', () => {
    getCsrfToken.mockReturnValue(null);

    expect(buildPdfDocumentRequest('/api/pdf', false)).not.toHaveProperty(
      'httpHeaders',
    );
    expect(getCsrfToken).toHaveBeenCalledTimes(1);
    expect(
      buildPdfDocumentRequest('/api/pdf', false, '   '),
    ).not.toHaveProperty('httpHeaders');
  });

  it('reads the token through the official toolkit helper by default', () => {
    getCsrfToken.mockReturnValue('toolkit-csrf-token');

    const request = buildPdfDocumentRequest('/api/pdf', false);

    expect(getCsrfToken).toHaveBeenCalledTimes(1);
    expect(request.httpHeaders).toEqual({
      'X-Suda-Csrf-Token': 'toolkit-csrf-token',
    });
    expect(request.url).toBe('/api/pdf');
  });
});
