const mockRequest = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: (...args: unknown[]) => mockRequest(...args) }));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (value: string) => value }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
import {
  getCanonicalHostClientSessionGeneration,
  invalidateCanonicalHostClientSession,
  isCanonicalHostClientSessionAuthenticationRequired,
  readJobAidWorkCorrection,
  saveJobAidWorkCorrection,
} from '@client/src/api/canonical-host';
import { JOBAID_WORK_CORRECTION_SCHEMA, type JobAidWorkCorrectionRequest } from '@shared/jobaid-work-correction.interface';

const command: JobAidWorkCorrectionRequest = { schemaVersion: JOBAID_WORK_CORRECTION_SCHEMA,
  requestId: 'manual-id', baseWorkRef: 'JAWR-base', baseWorkRevision: 4, expectedWorkItemRevision: 9,
  changes: [{ field: 'ISSUE_BODY', issueKey: 'I1', issueRef: 'JAI-1', expectedOldValue: '原文',
    newValue: '核对后的正文', reason: 'AI 整理，经本人核对；未正式采用。', evidenceRefs: ['E1'] }] };
beforeEach(() => { mockRequest.mockReset(); invalidateCanonicalHostClientSession(); });

test('sends the exact typed request through the existing native browser transport', async () => {
  mockRequest.mockResolvedValue({ status: 201, data: { requestId: command.requestId } });
  await expect(saveJobAidWorkCorrection('WI:a/b', command)).resolves.toEqual({ requestId: command.requestId });
  expect(mockRequest).toHaveBeenCalledWith({ url: '/api/canonical-host/work-items/WI%3Aa%2Fb/assessment-work/corrections',
    method: 'POST', timeout: 45_000, data: command });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test('reads an exact request receipt with an encoded no-cache GET', async () => {
  mockRequest.mockResolvedValue({ status: 200, data: { requestId: command.requestId } });
  await readJobAidWorkCorrection('WI:a/b', 'manual:a/b');
  expect(mockRequest).toHaveBeenCalledWith({
    url: '/api/canonical-host/work-items/WI%3Aa%2Fb/assessment-work/corrections/manual%3Aa%2Fb', method: 'GET',
    timeout: 45_000, headers: { 'Cache-Control': 'no-cache' },
  });
});

test.each(['resolved', 'rejected'])('preserves an exact missing receipt in a %s HTTP404', async mode => {
  const response = { status: 404, data: { error: { code: 'JOBAID_CORRECTION_REQUEST_NOT_FOUND' } } };
  if (mode === 'resolved') mockRequest.mockResolvedValue(response);
  else mockRequest.mockRejectedValue(Object.assign(new Error('missing'), { response }));
  await expect(readJobAidWorkCorrection('WI-one', 'manual-one')).rejects.toMatchObject({
    code: 'JOBAID_CORRECTION_REQUEST_NOT_FOUND', statusCode: 404,
  });
});

test.each([403, 404])('keeps a non-receipt HTTP%i denial generic', async status => {
  mockRequest.mockRejectedValue(Object.assign(new Error('denied'), { response: { status, data: { error: { code: 'PRIVATE_DENIAL' } } } }));
  await expect(readJobAidWorkCorrection('WI-one', 'manual-one')).rejects.toMatchObject({
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
  });
});

test.each(['resolved', 'rejected'])('keeps normal authentication handling for %s HTTP401', async mode => {
  const response = { status: 401, data: { error: { code: 'LOGIN_REQUIRED' } } };
  if (mode === 'resolved') mockRequest.mockResolvedValue(response);
  else mockRequest.mockRejectedValue(Object.assign(new Error('unauthorized'), { response }));
  await expect(saveJobAidWorkCorrection('WI-one', command)).rejects.toMatchObject({ statusCode: 401 });
  expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test('preserves explicit CAS conflicts and their status for recovery', async () => {
  mockRequest.mockRejectedValue(Object.assign(new Error('conflict'), { response: { status: 409,
    data: { error: { code: 'JOBAID_CORRECTION_BASE_CONFLICT' } } } }));
  await expect(saveJobAidWorkCorrection('WI-one', command)).rejects.toMatchObject({
    code: 'JOBAID_CORRECTION_BASE_CONFLICT', statusCode: 409,
  });
});

test('does not accept a late receipt across a native session change', async () => {
  let complete: (value: unknown) => void = () => undefined;
  mockRequest.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const started = getCanonicalHostClientSessionGeneration();
  const pending = readJobAidWorkCorrection('WI-one', 'manual-one');
  invalidateCanonicalHostClientSession();
  complete({ status: 200, data: { requestId: 'manual-one' } });
  await expect(pending).rejects.toMatchObject({ code: 'JOBAID_CORRECTION_SESSION_CHANGED' });
  expect(getCanonicalHostClientSessionGeneration()).toBeGreaterThan(started);
});
