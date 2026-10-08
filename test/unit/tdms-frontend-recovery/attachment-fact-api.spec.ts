const request = jest.fn();
const resolveAppUrl = jest.fn((path: string) => path);

jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: request,
}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({
  resolveAppUrl,
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: jest.fn() },
}));

import { readTdmsSourceRecord } from '../../../client/src/api/canonical-host';
import type { TdmsFileServiceRecordReadResponse } from '../../../shared/tdms-file-service-import.interface';
import { record } from './reader-fixtures';

describe('TDMS record browser transport preserves optional independent attachment facts', () => {
  beforeEach(() => {
    request.mockReset();
    resolveAppUrl.mockClear();
  });

  it('returns the untouched optional facts from a valid exact-record GET', async () => {
    const ref = 'source/revision:attachment-facts';
    const data: TdmsFileServiceRecordReadResponse = {
      ...record(ref),
      record: {
        ...record(ref).record,
        observedAt: '2026-10-01T09:00:00.000Z',
        unreadAttachments: [{
          sourceAttachmentId: 'source-attachment-A', sourceAttachmentVersion: 'v1',
          fileName: 'original.eb', mediaType: 'application/octet-stream', byteLength: 123,
          readStatus: 'NOT_READ', gap: 'source observation only', selector: 'attachment.row',
        }],
      },
      attachmentAcquisitions: [{
        memberId: 'member-A-v1', sourceAttachmentId: 'source-attachment-A',
        sourceAttachmentVersion: 'v1', acquisitionId: 'acquisition-A-v1',
        sourceObservedAtDeclared: '2026-10-01T09:00:00.000Z',
        sourceReadStatusAtObservation: 'NOT_READ', sourceObservationRevisionRef: null,
        hostBytesVerifiedAt: '2026-10-05T11:00:00.000Z',
        currentSourcePermissionChecked: true, semanticReadPerformed: false,
        engineeringExecutionVerified: false,
      }],
    };
    request.mockResolvedValue({ status: 200, data });
    const read = await readTdmsSourceRecord(ref, { matterId: 'M/1' });
    expect(read).toEqual(data);
    expect(read.record.unreadAttachments[0].readStatus).toBe('NOT_READ');
    expect(read.attachmentAcquisitions).toEqual(data.attachmentAcquisitions);
    expect(read.attachmentAcquisitions?.[0]).toMatchObject({
      sourceObservedAtDeclared: '2026-10-01T09:00:00.000Z',
      hostBytesVerifiedAt: '2026-10-05T11:00:00.000Z',
      currentSourcePermissionChecked: true, semanticReadPerformed: false,
      engineeringExecutionVerified: false,
    });
    expect(request).toHaveBeenCalledWith({
      url: '/api/tdms-source/records/source%2Frevision%3Aattachment-facts?matterId=M%2F1',
      method: 'GET', signal: undefined,
    });
  });

  it('continues accepting the old response without the optional extension', async () => {
    const ref = 'old-response';
    const old = record(ref);
    request.mockResolvedValue({ status: 200, data: old });
    const read = await readTdmsSourceRecord(ref, { matterId: 'M/1' });
    expect(read).toEqual(old);
    expect(read.attachmentAcquisitions).toBeUndefined();
  });
});
