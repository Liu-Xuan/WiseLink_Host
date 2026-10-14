import type { TdmsFileServiceRecordReadResponse } from './tdms-file-service-import.interface';

/** Reads retained native records explicitly bound to this exact Host version. */
export interface TdmsDocumentSourceReadRequest {
  documentVersionId: string;
  after?: string;
  limit?: number;
}

export interface TdmsDocumentSourceReadResponse {
  documentVersionId: string;
  sourceStatus: 'AVAILABLE' | 'NO_BOUND_RECORDS';
  /** Original source state/content and its independent read receipt are retained. */
  records: TdmsFileServiceRecordReadResponse[];
  hasMore: boolean;
  nextAfter: string | null;
}
