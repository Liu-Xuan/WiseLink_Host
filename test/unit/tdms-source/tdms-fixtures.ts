import { miaodaHostedFinalUserActor } from '../../../server/modules/work-item/production-miaoda-browser-ingress';
import { CANONICAL_MIAODA_APP_ID } from '../../../server/modules/canonical-host/canonical-host.constants';
import type { TdmsSourcePackage } from '../../../shared/tdms-source.interface';
export function fixture(): TdmsSourcePackage {
  return {
    schemaVersion: 'wiselink.tdms-source-package.v1',
    packageId: 'PKG-1',
    observedAt: '2026-10-05T10:00:00Z',
    coverage: { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' },
    query: {
      requestedCriteria: { type: 'AEO' },
      actualCriteria: { type: 'AEO' },
      scopeMatch: 'MATCHED',
    },
    readFailures: [],
    records: [
      {
        itemId: 'a',
        recordKind: 'ENGINEERING_FILE',
        sourceRecordId: 'AEO-1',
        expectedHeadRevisionRef: null,
        sourceVersion: {
          rawRevision: '1',
          rawIteration: null,
          confirmation: 'SOURCE_DECLARED',
        },
        title: 'source',
        fileType: { rawCode: 'AEO', rawName: 'AEO' },
        state: { rawCode: '已发送', rawName: 'Passed' },
        authors: [],
        sourceModifiedAt: null,
        observedAt: '2026-10-05T10:00:00Z',
        coverage: { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' },
        rawFields: { mandatory: false, checkbox: false },
        content: {
          conditions: ['body conflicts with checkbox'],
          futureLcmLinks: [
            {
              externalRecordId: null,
              aircraftRef: null,
              softwareItemRef: null,
              aeoVersionRef: null,
              feedbackRef: null,
              integrationStatus: 'NOT_CONNECTED',
            },
          ],
        },
        fieldProvenance: [],
        artifactMemberIds: [],
        relatedDocumentVersionIds: [],
      },
    ],
    relations: [],
    artifacts: [],
  };
}
export function actor() {
  process.env.SANDBOX_ID = 'test-host';
  return miaodaHostedFinalUserActor({
    userId: '123',
    tenantId: 'tenant-a',
    appId: CANONICAL_MIAODA_APP_ID,
    env: 'preview',
    isSystemAccount: false,
  });
}
