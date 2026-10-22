import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';

/** Constructed response only; source validation is exercised by receiver tests. */
export function withFeedbackPage(read: TdmsFileServiceRecordReadResponse): TdmsFileServiceRecordReadResponse {
  read.engineeringExecution!.windows = [];
  read.engineeringExecution!.applicabilityWindows = [{
    tableId: 'relatedStatusLinkTable', tableTitle: 'Current AEO feedback', sourceLocator: '#feedback',
    observedAt: '2026-10-13T00:00:00.000Z', enumerationState: 'VALUE', stopReason: null, reportedRowCount: 3,
    applicabilityBasis: 'CURRENT_AEO_FEEDBACK_PAGE', aircraftNumbers: ['SYNTHETIC-AIRCRAFT'], unknownAircraftRowCount: 1,
    sourceViewEvidence: { kind: 'AEO_OWNER_BOUND_IMPLICIT_NATIVE_TABLE', backendFiltersState: 'UNKNOWN' },
    rows: [0, 1, 2].map(index => ({ occurrenceId: `page-row-${index}`,
      aircraftNumberRaw: index === 2 ? '' : 'SYNTHETIC-AIRCRAFT', aircraftNumberState: index === 2 ? 'BLANK' : 'VALUE',
      cells: [
        { actualLabel: 'AC/ENG/APU', rawValue: index === 2 ? '' : 'SYNTHETIC-AIRCRAFT', state: index === 2 ? 'BLANK' as const : 'VALUE' as const, observedTotalCodepoints: index === 2 ? 0 : 18 },
        { actualLabel: 'Status', rawValue: index === 0 ? 'Completed' : 'Not completed', state: 'VALUE' as const, observedTotalCodepoints: 9 },
        { actualLabel: 'Execute Time', rawValue: 'SYNTHETIC PRIOR EXECUTION', state: 'VALUE' as const, observedTotalCodepoints: 25 },
        { actualLabel: 'Document Number', rawValue: 'PRIOR-AEO-R16', state: 'VALUE' as const, observedTotalCodepoints: 13 },
      ], sourceLinks: [{ targetRef: 'OR:wt.epm.EPMDocument:123', numberRaw: 'PRIOR-AEO-R16',
        rawHref: '/infoPage?oid=OR:wt.epm.EPMDocument:123', locator: `#row-${index} #doc`,
        nativeRole: 'ENGINEERING_DOC_REFERENCE', nativeColumnLabel: 'Document Number', nativeColumnToken: 'docOid' }],
    })),
  }];
  return read;
}
