const request = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({ axiosForBackend: request }));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (path: string) => path }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));

import {
  invalidateCanonicalHostClientSession, readLcmSourceSnapshotRows, readLcmSourceSnapshots,
  readTdmsDocumentSource,
} from '@client/src/api/canonical-host';
import { tdmsReadFailureMessage } from '@client/src/features/tdms-source/useTdmsReadResource';
import { configurationRecord, snapshot, sourceRead } from './fixtures';

describe('TDMS / LCM browser reads', () => {
  beforeEach(() => { invalidateCanonicalHostClientSession(); request.mockReset(); });

  it('reads the selected version page only and keeps approved professions in parallel', async () => {
    const records = [sourceRead('profession-A', 'DV/OLD'), sourceRead('profession-B', 'DV/OLD')];
    request.mockResolvedValue({ status: 200, data: { documentVersionId: 'DV/OLD', sourceStatus: 'AVAILABLE',
      records, hasMore: true, nextAfter: 'cursor/2' } });
    const result = await readTdmsDocumentSource({ documentVersionId: 'DV/OLD', after: 'cursor/1', limit: 12 });
    expect(result.records.map(read => read.record.sourceRecordId)).toEqual(['source-profession-A', 'source-profession-B']);
    expect(request).toHaveBeenCalledWith({
      url: '/api/tdms-source/document-versions/DV%2FOLD?after=cursor%2F1&limit=12', method: 'GET', signal: undefined,
    });
    const wrong = { ...result, records: [sourceRead('wrong', 'DV/NEW')] };
    request.mockResolvedValue({ status: 200, data: wrong });
    await expect(readTdmsDocumentSource({ documentVersionId: 'DV/OLD' })).rejects.toThrow('TDMS_DOCUMENT_SOURCE_BINDING_MISMATCH');
  });

  it('never reads or serializes a non-Estimated assessment body while returning its metadata', async () => {
    const unapproved = sourceRead('profession-unapproved', 'DV-1', 'Estimating');
    const getter = jest.fn(() => ({ opinions: [{ text: 'SENSITIVE_DRAFT_MARKER' }] }));
    const selectedFieldsGetter = jest.fn(() => [{ value: 'SENSITIVE_DRAFT_MARKER' }]);
    Object.defineProperty(unapproved.record, 'content', { get: getter, enumerable: true });
    Object.defineProperty(unapproved, 'selectedFields', { get: selectedFieldsGetter, enumerable: true });
    request.mockResolvedValue({ status: 200, data: { documentVersionId: 'DV-1', sourceStatus: 'AVAILABLE',
      records: [unapproved], hasMore: false, nextAfter: null } });
    const result = await readTdmsDocumentSource({ documentVersionId: 'DV-1' });
    expect(getter).not.toHaveBeenCalled();
    expect(selectedFieldsGetter).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('SENSITIVE_DRAFT_MARKER');
    expect(result.records[0].record.sourceRecordId).toBe('source-profession-unapproved');
    expect(result.records[0].record.state?.rawCode).toBe('Estimating');
  });

  it('treats missing source configuration as an explicit failure and preserves direct-object denial', async () => {
    request.mockResolvedValue({ status: 503, data: { code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' } });
    await expect(readTdmsDocumentSource({ documentVersionId: 'DV-1' })).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', statusCode: 503,
    });
    expect(tdmsReadFailureMessage({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' })).toContain('尚未配置 TDMS 来源读取授权');
    request.mockResolvedValue({ status: 403, data: {} });
    await expect(readTdmsDocumentSource({ documentVersionId: 'DV-1' })).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404,
    });
  });

  it('passes all LCM filters to Host, pins the exact historical snapshot, and performs GETs only', async () => {
    const filters = { aircraftModel: 'B787-9', tailNumber: 'B-TEST', system: '测试系统', ata: '27',
      softwareName: '测试软件', partNumber: 'PN-TEST', position: 'FIN-TEST', limit: 24 };
    request.mockResolvedValueOnce({ status: 200, data: { snapshots: [snapshot()], hasMore: false, nextAfter: null } });
    await readLcmSourceSnapshots(filters);
    request.mockResolvedValueOnce({ status: 200, data: { snapshot: snapshot('history/1'), records: [configurationRecord()],
      hasMore: false, nextAfter: null } });
    await readLcmSourceSnapshotRows({ ...filters, snapshotId: 'history/1' });
    const urls: URL[] = request.mock.calls.map(([call]) => new URL(call.url, 'https://test.invalid'));
    expect(urls[1].pathname).toBe('/api/lcm-source/snapshots/history%2F1');
    for (const url of urls) {
      expect(url.searchParams.get('system')).toBe('测试系统');
      expect(url.searchParams.get('ata')).toBe('27');
      expect(url.searchParams.get('position')).toBe('FIN-TEST');
    }
    expect(request.mock.calls.every(([call]) => call.method === 'GET' && !('data' in call))).toBe(true);
    expect(request.mock.calls.every(([call]) => !/actor|tenant|model|work-item|attempt|oauth/u.test(call.url))).toBe(true);
    request.mockResolvedValueOnce({ status: 200, data: { snapshot: snapshot('other'), records: [], hasMore: false, nextAfter: null } });
    await expect(readLcmSourceSnapshotRows({ snapshotId: 'history/1' })).rejects.toThrow('LCM_SOURCE_SNAPSHOT_BINDING_MISMATCH');
  });
});
