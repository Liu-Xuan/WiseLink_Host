import {
  prepareTdmsDailyMetadataImport,
  type TdmsDailyMetadataPackage,
} from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';

// Synthetic metadata only; no collector outbox, native document body or real identifier is embedded.
export function syntheticDailyEnvelope() {
  const at = '2026-10-01T00:00:00Z';
  const partial = {
    status: 'PARTIAL',
    gaps: ['PROBE_ONLY'],
    readback: 'NON_ATOMIC',
  } as const;
  const base = {
    snapshotId: '',
    sourceVersion: {
      rawRevision: 'A',
      rawIteration: '9',
      confirmation: 'SOURCE_DECLARED',
    },
    businessVersion: {
      rawRevision: 'R00',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    },
    state: { rawCode: null, rawName: 'Observed' },
    observedAt: at,
    sourceModifiedAt: null,
    authors: [
      { sourcePersonId: null, displayName: 'Synthetic creator', role: null },
    ],
    content: {},
    coverage: partial,
  };
  const sourceRecordId = 'OR:wt.epm.EPMDocument:1';
  const aeo = {
    ...JSON.parse(JSON.stringify(base)),
    sourceRecordId,
    kind: 'AEO',
    number: 'AEO-SYNTHETIC',
    rawFields: {
      number: 'AEO-SYNTHETIC',
      sourceModifiedRaw: 'unverified source date',
      engineering: {
        orderType: 'AEO',
        documentNumber: 'AEO-SYNTHETIC',
        title: 'Synthetic order',
        applicableModel: null,
        customer: null,
        effectiveDateRaw: null,
        issueDateRaw: null,
        executionModeRaw: null,
        processingSheetNumber: null,
      },
    },
    provenance: [
      {
        fieldPath: 'engineering.title',
        selector: '#synthetic-title',
        sourceModifiedAt: null,
        observationRef: sourceRecordId,
      },
    ],
  };
  const statusId = 'OR:com.airchina.tdms.statuslink.TDMSStatusLink:2';
  const row = {
    ...JSON.parse(JSON.stringify(base)),
    businessVersion: null,
    sourceRecordId: statusId,
    kind: 'EXECUTION_STATUS',
    number: 'STATUS-SYNTHETIC',
    rawFields: {
      executionStatus: {
        engineeringDocumentRef: 'VR:wt.epm.EPMDocument:1',
        engineeringDocumentNumber: 'AEO-SYNTHETIC',
        assetRef: 'VR:wt.part.WTPart:3',
        assetNumber: 'SYNTHETIC-ASSET',
        feedbackRef: null,
        feedbackNumber: null,
        executedDateRaw: null,
        stateComments: 'Not independently verified',
        expiredDateRaw: null,
        operatorBase: null,
      },
    },
    provenance: [],
  };
  for (const r of [aeo, row]) {
    const { snapshotId: _snapshot, observedAt: _time, ...identity } = r;
    r.snapshotId = 'TDMSSNAP-' + hash(identity);
  }
  const edge = {
    fromSourceRecordId: statusId,
    toSourceRecordId: 'VR:wt.epm.EPMDocument:1',
    fromSnapshotId: row.snapshotId,
    toSnapshotId: null,
    nativeRelationId: null,
    relationKind: 'Source table observation',
    evidenceLocator: '#synthetic-row',
    observedAt: at,
    confidence: 'observed_unresolved',
  };
  const { observedAt: _time, ...edgeIdentity } = edge;
  const pkg = {
    schemaVersion: 'wiselink.tdms-daily-package.v1',
    packageId: 'TDMSEOPKG-synthetic',
    sourceSystem: 'TDMS',
    observedAt: at,
    coverage: partial,
    query: {
      requestedCriteria: {},
      actualCriteria: null,
      scopeComplete: false,
      scopeMatch: 'UNKNOWN',
    },
    records: [aeo, row],
    edges: [{ edgeId: 'TDMSEDGE-' + hash(edgeIdentity), ...edge }],
    artifactBindings: [],
    readFailures: [],
  } as unknown as TdmsDailyMetadataPackage;
  return { requestId: 'TDMSIMPORT-' + hash(pkg), package: pkg };
}
export function syntheticSavedReceipt(envelope = syntheticDailyEnvelope()) {
  const prepared = prepareTdmsDailyMetadataImport(envelope);
  return {
    schemaVersion: 'wiselink.tdms-source-import-receipt.v1',
    requestId: envelope.requestId,
    payloadDigest: prepared.payloadDigest,
    status: 'IMPORTED',
    importedAt: '2026-10-01T00:01:00Z',
    sourceRefs: prepared.sourceRefs,
    objectCount: 2,
    relationCount: 1,
    artifactCount: 0,
    documentVersionMappings: [],
  };
}
