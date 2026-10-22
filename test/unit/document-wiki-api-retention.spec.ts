import { readDocumentWiki } from '@client/src/api/document-wiki';
import { isTemporarySummaryReadError } from '@client/src/features/derived-summary/summary-read-error';
import { savedDocumentReadingFixture } from './fixtures/saved-document-reading';

const mockRequest = jest.fn(), mockRequireAuthentication = jest.fn();
let mockSession = 1;
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: (...args: unknown[]) => mockRequest(...args),
}));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  requireCanonicalHostClientAuthentication: (...args: unknown[]) => mockRequireAuthentication(...args),
}));
const input = { documentVersionId: 'DV1', parseRunId: 'parse-1', semanticRevision: 1, readingRevision: 1 };
const signal = () => new AbortController().signal;
beforeEach(() => { mockSession = 1; mockRequest.mockReset(); mockRequireAuthentication.mockReset(); });

it.each(['ERR_NETWORK', 'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED'])('retains transport identity %s for the read policy', async code => {
  mockRequest.mockRejectedValue(Object.assign(new Error('transport failed'), { code }));
  const error: unknown = await readDocumentWiki(input, signal()).catch(reason => reason);
  expect(error).toMatchObject({ code });
  expect(isTemporarySummaryReadError(error)).toBe(true);
});

it.each([401, 403, 404])('access status %i takes precedence over a transport code', async status => {
  mockRequest.mockRejectedValue({ response: { status }, code: 'ERR_NETWORK' });
  const error: unknown = await readDocumentWiki(input, signal()).catch(reason => reason);
  expect(error).toMatchObject({ statusCode: status });
  expect(isTemporarySummaryReadError(error)).toBe(false);
  expect(mockRequireAuthentication).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
});

it.each(['resolved', 'rejected'])('normalizes a %s 503 response as a temporary read failure', async kind => {
  if (kind === 'resolved') mockRequest.mockResolvedValue({ status: 503, data: {} });
  else mockRequest.mockRejectedValue({ response: { status: 503 } });
  const error: unknown = await readDocumentWiki(input, signal()).catch(reason => reason);
  expect(error).toMatchObject({ statusCode: 503 });
  expect(isTemporarySummaryReadError(error)).toBe(true);
});

it('does not turn invalid inner reading bindings into a temporary failure', async () => {
  const reading = savedDocumentReadingFixture('DV-other');
  const outer = savedDocumentReadingFixture('DV1').sourceBinding;
  mockRequest.mockResolvedValue({ status: 200, data: { status: 'AVAILABLE', sourceBinding: outer, reading } });
  const error: unknown = await readDocumentWiki(input, signal()).catch(reason => reason);
  expect(error).toBeInstanceOf(Error);
  expect(isTemporarySummaryReadError(error)).toBe(false);
});
