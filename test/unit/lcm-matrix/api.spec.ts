const http = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: http }));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (path: string) => path }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
import { readLcmNativeMatrix, authorizeLcmNativeMatrix, readLcmNativeMatrixDetails, invalidateCanonicalHostClientSession,
  readLcmPersonalLibrary, importLcmExcel, resolveLcmExcelUpload } from '@client/src/api/canonical-host';
import type { LcmNativeMatrixResponse } from '@shared/lcm-native-matrix.interface';
import { snapshot } from '../tdms-p1-frontend/fixtures';
const id = 'a'.repeat(64);
const query = { snapshotIds: [id] };
const response = (): LcmNativeMatrixResponse => ({
  binding: { readSetRef: 'readset', projectionRevision: 'native-v1', scopeRef: 'scope', permissionRevision: 'p1',
    filterHash: 'native-local-filters', orderRef: 'native-local-aircraft-order' }, snapshots: [snapshot(id)],
  matrices: [{ snapshotId: id, managementDomainRef: 'domain', matrix: {
    schemaVersion: 'wiselink.lcm.native_matrix.v1', kind: 'tail-matrix', aircraftModel: 'A321',
    sheet: 'Sheet1', rawSha256: 'f'.repeat(64), range: { firstRow: 1, lastRow: 1, firstColumn: 1, lastColumn: 2 },
    fixedColumns: [], aircraft: [], rows: [],
  } }],
});
beforeEach(() => { http.mockReset(); invalidateCanonicalHostClientSession(); });

describe('R2 browser transport and exact six-dimensional binding', () => {
  it('sends a bounded complex read in JSON without URL length limits or caller identity', async () => {
    http.mockResolvedValue({ status: 200, data: response() });
    await readLcmNativeMatrix(query);
    expect(http).toHaveBeenCalledWith({ url: '/api/lcm-source/matrix/native', method: 'POST',
      data: query, signal: undefined });
  });
  it.each(['readSetRef', 'projectionRevision', 'scopeRef', 'permissionRevision', 'filterHash', 'orderRef'] as const)
    ('rejects mismatched %s instead of replacing the visible read', async key => {
      const data = response(); http.mockResolvedValue({ status: 200, data: { binding: data.binding } });
      await expect(authorizeLcmNativeMatrix({ ...query, binding: { ...data.binding, [key]: 'wrong' } }))
        .rejects.toThrow('LCM_MATRIX_BINDING_CHANGED');
    });
  it('rejects candidate→formal relabeling or another historical snapshot', async () => {
    const data = response(); data.snapshots[0].snapshotId = 'b'.repeat(64);
    http.mockResolvedValue({ status: 200, data });
    await expect(readLcmNativeMatrix(query)).rejects.toThrow('LCM_MATRIX_RESPONSE_INVALID');
    data.snapshots[0].snapshotId = id;
    Object.assign(data.snapshots[0], { candidateOnly: false });
    await expect(readLcmNativeMatrix(query)).rejects.toThrow('LCM_MATRIX_RESPONSE_INVALID');
  });
  it('rejects a response arriving after session/account generation changes', async () => {
    let finish!: (value: unknown) => void;
    http.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = readLcmNativeMatrix(query);
    invalidateCanonicalHostClientSession();
    finish({ status: 200, data: response() });
    await expect(pending).rejects.toThrow('LCM_SOURCE_READ_OBSOLETE');
  });
  it('rejects an aborted request even when the HTTP implementation delivers a late success', async () => {
    const controller = new AbortController();
    http.mockResolvedValue({ status: 200, data: response() }); controller.abort();
    await expect(readLcmNativeMatrix(query, controller.signal)).rejects.toThrow('LCM_SOURCE_READ_OBSOLETE');
  });
  it('normalizes both resolved and rejected permission errors at the shared request boundary', async () => {
    http.mockResolvedValue({ status: 403, data: {} });
    await expect(readLcmNativeMatrix(query)).rejects.toMatchObject({ statusCode: 404 });
    http.mockRejectedValue({ response: { status: 403, data: {} } });
    await expect(readLcmNativeMatrix(query)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('keeps unconfigured distinct from a valid empty read', async () => {
    http.mockResolvedValue({ status: 503, data: { code: 'LCM_SOURCE_READING_UNCONFIGURED' } });
    await expect(readLcmNativeMatrix(query)).rejects.toMatchObject({ code: 'LCM_SOURCE_READING_UNCONFIGURED', statusCode: 503 });
  });
  it('requires the exact binding again on an on-demand detail read', async () => {
    const input = { query, binding: response().binding, aircraftRef: 'plane' };
    http.mockResolvedValue({ status: 200, data: { binding: { ...input.binding, permissionRevision: 'old' },
      records: [], nextAfter: null, originalUnavailableReason: 'LOCAL_REFERENCE_ONLY' } });
    await expect(readLcmNativeMatrixDetails(input)).rejects.toThrow('LCM_MATRIX_BINDING_CHANGED');
  });
  it('keeps genuine personal empty state distinct from an unavailable store', async () => {
    http.mockResolvedValueOnce({ status: 200, data: { hasSource: false, latestSnapshotIds: [], snapshotCount: 0 } });
    await expect(readLcmPersonalLibrary()).resolves.toEqual({ hasSource: false, latestSnapshotIds: [], snapshotCount: 0 });
    http.mockResolvedValueOnce({ status: 503, data: { error: { code: 'LCM_HOST_DATABASE_UNAVAILABLE' } } });
    await expect(readLcmPersonalLibrary()).rejects.toMatchObject({ statusCode: 503 });
  });
  it('uses the native owner import entry with exact request identity and candidate result', async () => {
    const input = { requestId: 'lcm-unit', aircraftModel: 'UNIT', selection: { bucketId: 'bucket',
      filePath: 'wiselink/lcm/uploads/unit/source.xls', expectedProviderObjectId: 'object' } };
    http.mockResolvedValueOnce({ status: 201, data: { requestId: input.requestId, snapshotId: id, candidateOnly: true,
      sourceRowCount: 226, aircraftColumnCount: 104, stateCellCount: 23504 } });
    await expect(importLcmExcel(input)).resolves.toMatchObject({ snapshotId: id });
    expect(http).toHaveBeenCalledWith({ url: '/api/lcm-source/imports', method: 'POST', data: input });
    http.mockResolvedValueOnce({ status: 201, data: { requestId: 'another', snapshotId: id, candidateOnly: true } });
    await expect(importLcmExcel(input)).rejects.toThrow('LCM_IMPORT_RESPONSE_INVALID');
  });
  it('recovers only the exact upload path and accepts a real absence', async () => {
    const input = { filePath: 'wiselink/lcm/uploads/unit/source.xls' };
    http.mockResolvedValueOnce({ status: 200, data: { selection: null } });
    await expect(resolveLcmExcelUpload(input)).resolves.toEqual({ selection: null });
    http.mockResolvedValueOnce({ status: 200, data: { selection: { bucketId: 'bucket',
      filePath: 'wiselink/lcm/uploads/other.xls', expectedProviderObjectId: 'other' } } });
    await expect(resolveLcmExcelUpload(input)).rejects.toThrow('LCM_UPLOAD_RECOVERY_INVALID');
  });
});
