import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';

/** Browser previews never access an unapproved assessment's body fields.
 * Host/collector admission separately guarantees that draft bytes were never transported. */
export function tdmsSourceReadForPreview(read: TdmsFileServiceRecordReadResponse): TdmsFileServiceRecordReadResponse {
  const record = read.record;
  if (canReadTdmsSourceBody(read)) return read;
  return {
    bodyReadPolicy: { kind: 'METADATA_ONLY', sourceRecordId: record.sourceRecordId,
      sourceRevisionRef: record.sourceRevisionRef },
    record: {
      recordRef: record.recordRef,
      sourceRevisionRef: record.sourceRevisionRef,
      recordKind: record.recordKind,
      sourceRecordId: record.sourceRecordId,
      sourceKey: record.sourceKey,
      sourceInstanceId: record.sourceInstanceId,
      title: record.title,
      fileType: record.fileType,
      sourceVersion: record.sourceVersion,
      businessVersion: record.businessVersion,
      state: record.state,
      authors: record.authors,
      observedAt: record.observedAt,
      capturedAt: record.capturedAt,
      coverage: { status: 'PARTIAL', readback: record.coverage.readback,
        gaps: ['UNAPPROVED_ASSESSMENT_BODY_WITHHELD'] },
      relatedDocumentVersionIds: record.relatedDocumentVersionIds,
      fieldSelectors: [],
      sourceVerification: record.sourceVerification,
      currentness: record.currentness,
      captureRef: record.captureRef,
      sourceModifiedAt: record.sourceModifiedAt,
      selectedHead: record.selectedHead,
      content: {},
      rawFields: {},
      fieldProvenance: [],
      artifacts: [],
      unreadAttachments: [],
    },
    selectedFields: null,
    receipt: {
      receiptRef: read.receipt.receiptRef,
      sourceRevisionRef: read.receipt.sourceRevisionRef,
      readAt: read.receipt.readAt,
      purpose: read.receipt.purpose,
      fieldPaths: [],
      taskContextRef: read.receipt.taskContextRef,
      readPerformed: read.receipt.readPerformed,
      permissionRevision: read.receipt.permissionRevision,
      engineeringAdoption: read.receipt.engineeringAdoption,
      executionVerified: read.receipt.executionVerified,
    },
    limitations: ['UNAPPROVED_ASSESSMENT_BODY_WITHHELD'],
  };
}
