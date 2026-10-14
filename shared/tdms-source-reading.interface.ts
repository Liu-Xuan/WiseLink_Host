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
  /** Each assessment has its own status boundary: only Estimated revisions may
   * contain opinion bodies. Other assessment states expose metadata alone.
   * Parent/peer approval is never substituted for the selected assessment. */
  records: TdmsFileServiceRecordReadResponse[];
  hasMore: boolean;
  nextAfter: string | null;
}
