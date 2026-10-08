import type {
  TdmsCatalogueResponse, TdmsCoverage, TdmsRecordReadResponse, TdmsRecordSummary,
  TdmsRelationReadResponse, TdmsRelationAssertion, TdmsReadReceipt,
} from '../../../shared/tdms-source.interface';
import type { AssessmentEvidence } from '../../../shared/assessment-reading.interface';

const observedAt = '2026-01-02T03:04:05.000Z';
const coverage: TdmsCoverage = { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' };

export function summary(ref: string): TdmsRecordSummary {
  return {
    recordRef: `record-${ref}`, sourceRevisionRef: ref, recordKind: 'ENGINEER_ASSESSMENT',
    sourceRecordId: `source-${ref}`, sourceKey: 'source-key', sourceInstanceId: 'tdms-one',
    title: `Directory ${ref}`, fileType: { rawCode: 'EA', rawName: '评估' },
    sourceVersion: { rawRevision: 'B', rawIteration: '2', confirmation: 'SOURCE_DECLARED' },
    businessVersion: null, state: { rawCode: 'RELEASED', rawName: '已发布' },
    authors: [], observedAt, capturedAt: observedAt, coverage,
    relatedDocumentVersionIds: [], fieldSelectors: [], sourceVerification: 'DECLARED_ONLY',
    currentness: 'SELECTED_HOST_OBSERVATION',
  };
}

export function catalogue(...refs: string[]): TdmsCatalogueResponse {
  return { records: refs.map(summary), sourceStatus: 'AVAILABLE', hasMore: false,
    nextAfter: null, readPerformed: false, limitations: [] };
}

function receipt(ref: string, purpose: TdmsReadReceipt['purpose']): TdmsReadReceipt {
  return { receiptRef: `receipt-${purpose}-${ref}`, sourceRevisionRef: ref, readAt: observedAt,
    purpose, fieldPaths: null, taskContextRef: null, readPerformed: true,
    permissionRevision: 'permission-1', engineeringAdoption: 'NOT_CREATED', executionVerified: false };
}

export function record(ref: string, text = `Private excerpt ${ref}`): TdmsRecordReadResponse {
  return { record: { ...summary(ref), captureRef: `capture-${ref}`, sourceModifiedAt: null,
    rawFields: {}, content: { opinions: [{ text, author: null, state: null,
      conditions: [], requiredActions: [], sourceSelector: `selector-${ref}` }] },
    fieldProvenance: [], artifacts: [], unreadAttachments: [], selectedHead: true },
  selectedFields: null, receipt: receipt(ref, 'WIKI_NATIVE_RECORD'), limitations: [] };
}

export function relations(ref: string, endpoint = 'endpoint-B'): TdmsRelationReadResponse {
  const assertion: TdmsRelationAssertion = {
    relationRef: `relation-${ref}`, assertionRef: `assertion-${ref}`,
    sourceRelationId: `source-relation-${ref}`, rawKind: 'references',
    controlledKind: 'REFERENCES', from: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: ref },
    to: { kind: 'NATIVE_RECORD_REVISION', sourceRevisionRef: endpoint },
    authority: 'SOURCE_EXPLICIT', selector: 'relation-selector', observedAt,
    coverage, scope: {}, completionEffect: 'UNSPECIFIED', changeClass: 'UNSPECIFIED',
    rawFields: {}, selectedHead: true, captureRef: `capture-${ref}`, sourceVerification: 'DECLARED_ONLY',
  };
  return { sourceRevisionRef: ref, relations: [assertion],
    receipt: receipt(ref, 'WIKI_NATIVE_RELATIONS'), limitations: [] };
}

export function savedEvidence(ref: string, receiptRef = ref): AssessmentEvidence {
  return { evidenceRef: `evidence-${ref}`, title: `Evidence ${ref}`, versionLabel: null,
    excerpt: 'Saved evidence only', kind: 'TDMS_NATIVE_RECORD', nativeSource: summary(ref),
    nativeReadReceipt: { ...receipt(receiptRef, 'JOB_AID_NATIVE_RECORD'),
      purpose: 'JOB_AID_NATIVE_RECORD', fieldPaths: [], taskContextRef: 'work-1' } };
}
