const request = jest.fn();
const resolveAppUrl = jest.fn();

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl,
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import {
  getCanonicalHostClientSessionGeneration,
  invalidateCanonicalHostClientSession,
  isCanonicalHostClientSessionAuthenticationRequired,
  readTdmsSourceCatalogue,
  readTdmsSourceRecord,
  readTdmsSourceRelations,
} from '../../../client/src/api/canonical-host';

const sourceRevisionRef = 'source/revision:1';
const recordUrl = '/api/tdms-source/records/source%2Frevision%3A1?matterId=M%2F1';
const relationsUrl = '/api/tdms-source/records/source%2Frevision%3A1/relations?matterId=M%2F1';
const nativeEndpoint = { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef };
const otherEndpoint = { kind: 'DOCUMENT_VERSION', documentVersionId: 'DV-2' };
const receipt = (purpose: 'WIKI_NATIVE_RECORD' | 'WIKI_NATIVE_RELATIONS') => ({
  receiptRef: 'receipt-1',
  sourceRevisionRef,
  readAt: '2026-10-05T10:00:00Z',
  purpose,
  fieldPaths: null,
  taskContextRef: null,
  readPerformed: true,
  permissionRevision: 'permission-1',
  engineeringAdoption: 'NOT_CREATED',
  executionVerified: false,
});
const recordRead = () => ({
  record: { sourceRevisionRef, recordRef: 'record-1', title: 'Native TDMS source' },
  selectedFields: null,
  receipt: receipt('WIKI_NATIVE_RECORD'),
  limitations: [],
});
const relationsRead = () => ({
  sourceRevisionRef,
  relations: [
    { relationRef: 'relation-1', from: nativeEndpoint, to: otherEndpoint },
    { relationRef: 'relation-2', from: otherEndpoint, to: nativeEndpoint },
  ],
  receipt: receipt('WIKI_NATIVE_RELATIONS'),
  limitations: [],
});
const catalogueRead = () => ({
  records: [{ sourceRevisionRef, recordRef: 'record-1', title: 'Native TDMS source' }],
  sourceStatus: 'AVAILABLE',
  hasMore: false,
  nextAfter: null,
  readPerformed: false,
  limitations: [],
});

describe('TDMS canonical Host browser read API', () => {
  beforeEach(() => {
    invalidateCanonicalHostClientSession();
    request.mockReset();
    resolveAppUrl.mockReset();
    resolveAppUrl.mockImplementation((path: string) => path);
  });

  it('performs only a catalogue GET, preserves exact query pins, and rejects an empty context before transport', async () => {
    const data = catalogueRead();
    request.mockResolvedValue({ status: 200, data });
    await expect(readTdmsSourceCatalogue({ matterId: 'M/1' }, 'cursor/1')).resolves.toEqual(data);
    expect(request).toHaveBeenLastCalledWith({
      url: '/api/tdms-source/records?matterId=M%2F1&after=cursor%2F1',
      method: 'GET', signal: undefined,
    });
    await expect(readTdmsSourceCatalogue({ documentVersionId: 'DV/2' })).resolves.toEqual(data);
    expect(request).toHaveBeenLastCalledWith({
      url: '/api/tdms-source/records?documentVersionId=DV%2F2',
      method: 'GET', signal: undefined,
    });
    const calls = request.mock.calls.length;
    await expect(readTdmsSourceCatalogue({})).rejects.toThrow('TDMS_READ_CONTEXT_INVALID');
    expect(request).toHaveBeenCalledTimes(calls);
    expect(request.mock.calls.every(([call]) => call.method === 'GET' &&
      !('data' in call) && !('params' in call))).toBe(true);
    // Browser pins select a reading context; they do not provide actor, tenant, or authorization.
    expect(request.mock.calls.every(([call]) =>
      !/actor|tenant|workItemId|jobAidAttemptRef/u.test(JSON.stringify(call)))).toBe(true);
  });

  it.each([
    {}, null, [],
    { matterId: 'M', documentVersionId: 'DV' },
    { matterId: '' },
    { documentVersionId: '  ' },
    { matterId: ' M' },
    { matterId: 'M\nforged' },
    { documentVersionId: 'DV\u0000forged' },
    { workItemId: 'WI' },
    { jobAidAttemptRef: 'attempt' },
    { tenantId: 'tenant' },
    { actorId: 'actor' },
  ])('rejects conflicting, empty, malformed, or unknown browser context %# before any network call', async (context) => {
    await expect(readTdmsSourceCatalogue(context as never)).rejects.toThrow();
    await expect(readTdmsSourceRecord(sourceRevisionRef, context as never)).rejects.toThrow();
    await expect(readTdmsSourceRelations(sourceRevisionRef, context as never)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('requires a non-reading catalogue with an array and a genuinely empty disabled source', async () => {
    request.mockResolvedValue({ status: 200, data: catalogueRead() });
    await expect(readTdmsSourceCatalogue({ matterId: 'M/1' })).resolves.toHaveProperty('readPerformed', false);
    for (const data of [
      { ...catalogueRead(), readPerformed: true },
      { ...catalogueRead(), records: null },
      { ...catalogueRead(), sourceStatus: 'DISABLED' },
    ]) {
      request.mockResolvedValue({ status: 200, data });
      await expect(readTdmsSourceCatalogue({ matterId: 'M/1' })).rejects.toThrow('TDMS_SOURCE_CATALOGUE_BINDING_MISMATCH');
    }
    request.mockResolvedValue({ status: 200, data: {
      ...catalogueRead(), records: [], sourceStatus: 'DISABLED',
    } });
    await expect(readTdmsSourceCatalogue({ matterId: 'M/1' })).resolves.toMatchObject({
      records: [], sourceStatus: 'DISABLED', readPerformed: false,
    });
  });

  it('accepts only the exact native record and WIKI_NATIVE_RECORD read receipt', async () => {
    const data = recordRead();
    request.mockResolvedValue({ status: 200, data });
    await expect(readTdmsSourceRecord(sourceRevisionRef, { matterId: 'M/1' })).resolves.toEqual(data);
    expect(request).toHaveBeenLastCalledWith({ url: recordUrl, method: 'GET', signal: undefined });
    for (const bad of [
      { ...data, record: { ...data.record, sourceRevisionRef: 'wrong' } },
      { ...data, receipt: { ...data.receipt, sourceRevisionRef: 'wrong' } },
      { ...data, receipt: { ...data.receipt, readPerformed: false } },
      { ...data, receipt: { ...data.receipt, purpose: 'JOB_AID_NATIVE_RECORD' } },
      { ...data, selectedFields: [] },
    ]) {
      request.mockResolvedValue({ status: 200, data: bad });
      await expect(readTdmsSourceRecord(sourceRevisionRef, { matterId: 'M/1' }))
        .rejects.toThrow('TDMS_SOURCE_RECORD_BINDING_MISMATCH');
    }
  });

  it('accepts only an array of relations whose native endpoint connects to the exact ref', async () => {
    const data = relationsRead();
    request.mockResolvedValue({ status: 200, data });
    await expect(readTdmsSourceRelations(sourceRevisionRef, { matterId: 'M/1' })).resolves.toEqual(data);
    expect(request).toHaveBeenLastCalledWith({ url: relationsUrl, method: 'GET', signal: undefined });
    for (const bad of [
      { ...data, sourceRevisionRef: 'wrong' },
      { ...data, receipt: { ...data.receipt, sourceRevisionRef: 'wrong' } },
      { ...data, receipt: { ...data.receipt, readPerformed: false } },
      { ...data, receipt: { ...data.receipt, purpose: 'WIKI_NATIVE_RECORD' } },
      { ...data, relations: null },
      { ...data, relations: [{ from: { ...nativeEndpoint, sourceRevisionRef: 'wrong' }, to: otherEndpoint }] },
      { ...data, relations: [{ from: otherEndpoint, to: otherEndpoint }] },
    ]) {
      request.mockResolvedValue({ status: 200, data: bad });
      await expect(readTdmsSourceRelations(sourceRevisionRef, { matterId: 'M/1' }))
        .rejects.toThrow('TDMS_SOURCE_RELATION_BINDING_MISMATCH');
    }
  });

  it.each([403, 404])('hides a %i direct-object response as canonical not found', async (status) => {
    request.mockResolvedValue({ status, data: { code: 'TDMS_SOURCE_PERMISSION_CHANGED' } });
    await expect(readTdmsSourceRecord(sourceRevisionRef, { matterId: 'M/1' })).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
    });
    request.mockRejectedValue({ response: { status, data: { code: 'TDMS_SOURCE_PERMISSION_CHANGED' } } });
    await expect(readTdmsSourceRelations(sourceRevisionRef, { matterId: 'M/1' })).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('normalizes an expired login and invalidates only the current browser session', async () => {
    const generation = getCanonicalHostClientSessionGeneration();
    request.mockResolvedValue({ status: 401, data: { code: 'SESSION_REQUIRED' } });
    await expect(readTdmsSourceRecord(sourceRevisionRef, { matterId: 'M/1' })).rejects.toThrow('CANONICAL_LIBRARY_LOGIN_REQUIRED');
    expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
    expect(getCanonicalHostClientSessionGeneration()).toBeGreaterThan(generation);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('invalidates the current session for a rejected Axios 401, too', async () => {
    const generation = getCanonicalHostClientSessionGeneration();
    request.mockRejectedValue({ response: { status: 401, data: { code: 'SESSION_REQUIRED' } } });
    await expect(readTdmsSourceCatalogue({ matterId: 'M/1' })).rejects.toBeDefined();
    expect(isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
    expect(getCanonicalHostClientSessionGeneration()).toBeGreaterThan(generation);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['catalogue', 'record', 'relations'] as const)(
    'discards a late %s response after abort or a browser session change', async (operation) => {
      const read = (signal?: AbortSignal) => operation === 'catalogue'
        ? readTdmsSourceCatalogue({ matterId: 'M/1' }, undefined, signal)
        : operation === 'record'
          ? readTdmsSourceRecord(sourceRevisionRef, { matterId: 'M/1' }, signal)
          : readTdmsSourceRelations(sourceRevisionRef, { matterId: 'M/1' }, signal);
      const data = operation === 'catalogue' ? catalogueRead()
        : operation === 'record' ? recordRead() : relationsRead();
      for (const obsolete of ['abort', 'session'] as const) {
        let finish!: (value: unknown) => void;
        request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const controller = new AbortController();
        const pending = read(controller.signal);
        if (obsolete === 'abort') controller.abort();
        else invalidateCanonicalHostClientSession();
        finish({ status: 200, data });
        await expect(pending).rejects.toThrow('TDMS_SOURCE_READ_OBSOLETE');
      }
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.every(([call]) => call.method === 'GET' &&
        !('data' in call))).toBe(true);
    },
  );
});
