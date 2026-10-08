import type { AssessmentTdmsApprovalObservation } from '@shared/assessment-reading.interface';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';

/** Constructed development facts only. This is not a production source/authority receipt. */
export function tdmsNativeEvidenceFixture(): AssessmentTdmsNativeEvidence {
  return {
    kind: 'TDMS_NATIVE_RECORD', evidenceRef: 'TDMS_NATIVE:assessment-observation-1:opinions',
    title: 'Source-declared own Estimated assessment', versionLabel: 'R00', excerpt: 'If installed, verify configuration. Execution remains unknown.',
    nativeSource: {
      recordRef: 'assessment-record-1', sourceRevisionRef: 'assessment-observation-1', recordKind: 'ENGINEER_ASSESSMENT',
      sourceRecordId: 'source-assessment-1', sourceKey: 'TDMS', sourceInstanceId: 'fixture-instance', title: 'Retained assessment',
      fileType: null, sourceVersion: { rawRevision: 'R00', rawIteration: '2', confirmation: 'SOURCE_DECLARED' },
      businessVersion: { rawRevision: 'B', rawIteration: null, confirmation: 'SOURCE_DECLARED' },
      state: { rawCode: 'Estimated', rawName: 'Estimated' }, authors: [{ sourcePersonId: 'person-1', name: 'Fixture contributor', role: null }],
      observedAt: '2026-10-01T10:00:00Z', capturedAt: '2026-10-02T10:00:00Z',
      coverage: { status: 'PARTIAL', gaps: ['Source currentness unconnected'], readback: 'CONSISTENT' },
      relatedDocumentVersionIds: [], fieldSelectors: [{ fieldPath: 'content.opinions[0]', selector: '/assessments/1/opinions' }],
      sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION',
    },
    nativeScope: { sourceRevisionRef: 'assessment-observation-1', fieldSelectors: [{ fieldPath: 'content.opinions[0]', selector: '/assessments/1/opinions' }],
      approval: {
        captureRef: 'fixture-capture-1', evidencePath: 'rawFields.opinionCollection', mode: 'EXACT_VERSION',
        approvalSubject: { sourceRecordId: 'source-assessment-1', sourceVersion: { rawRevision: 'R00', rawIteration: '2', confirmation: 'SOURCE_DECLARED' } },
        before: approvalObservation('2026-10-01T09:59:00Z'), after: approvalObservation('2026-10-01T10:00:00Z'),
      },
      grouping: 'TRANSPARENT_FIELDS', limitations: ['Source declarations, not execution proof'],
      processingSetBinding: { scope: { tenantId: 'fixture-tenant', sourceKey: 'TDMS', sourceInstanceId: 'fixture-instance', scopeId: 'fixture-scope' },
        setRevisionRef: 'set-1', generation: 2, processingFamilyRef: 'family-1', cohortRef: 'cohort-1',
        processingObservationRef: 'processing-1', memberRef: 'member-1', assessmentObservationRef: 'assessment-observation-1' },
    },
    nativeReadReceipt: { receiptRef: 'native-receipt-1', sourceRevisionRef: 'assessment-observation-1', readAt: '2026-10-03T10:00:00Z',
      purpose: 'JOB_AID_NATIVE_RECORD', fieldPaths: ['content.opinions[0]'], taskContextRef: 'task-1', readPerformed: true,
      permissionRevision: 'permission-at-original-read', engineeringAdoption: 'NOT_CREATED', executionVerified: false },
  };
}

function approvalObservation(observedAt: string): AssessmentTdmsApprovalObservation {
  return { sourceRecordId: 'source-assessment-1', recordKind: 'ENGINEER_ASSESSMENT',
    sourceVersion: { rawRevision: 'R00', rawIteration: '2', confirmation: 'SOURCE_DECLARED' },
    state: { rawCode: 'Estimated', rawName: 'Estimated' }, sourceModifiedAt: null, observedAt,
    identitySelector: '#infoPageIdentityObjectIdentifier',
    stateSelector: '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
    versionSelector: '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value',
    objectBinding: 'EXACT_CURRENT_DETAIL' };
}
