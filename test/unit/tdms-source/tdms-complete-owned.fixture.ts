import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import type { TdmsDailyMetadataEnvelope } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';

// Independently synthetic DTO literals. No collector, source original or authority execution.
export const copyComplete = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const unknownVersion = () => ({
  rawRevision: null,
  rawIteration: null,
  confirmation: 'VERSION_UNCONFIRMED',
});
const declared = () => ({
  rawRevision: 'A',
  rawIteration: '1',
  confirmation: 'SOURCE_DECLARED',
});
const observationTime = '2026-10-13T00:00:00.000Z';
const profiles = {
  SB_PROCESSING_FORM: [
    'PROCESSING_SHEET',
    'wt.change2.WTChangeRequest2',
    'WCTYPE|wt.change2.WTChangeRequest2|com.airchina.SBMainForm',
    'SB处理单',
    false,
  ],
  SB_ASSESSMENT_FORM: [
    'ENGINEER_ASSESSMENT',
    'wt.change2.WTChangeOrder2',
    'WCTYPE|wt.change2.WTChangeOrder2|com.airchina.SBForm',
    'SB评估单',
    false,
  ],
  AD_PROCESSING_FORM: [
    'PROCESSING_SHEET',
    'wt.change2.WTChangeOrder2',
    'WCTYPE|wt.change2.WTChangeOrder2|com.airchina.ADForm',
    'AD分处理单',
    false,
  ],
  ENGINEERING_ASSESSMENT: [
    'ENGINEER_ASSESSMENT',
    'wt.doc.WTDocument',
    'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest',
    '工程文件编写评估单',
    true,
  ],
  EO: [
    'ENGINEERING_FILE',
    'wt.epm.EPMDocument',
    'WCTYPE|wt.epm.EPMDocument|com.airchina.DynamicDocument|com.airchina.EODocument',
    'Publication Source',
    false,
  ],
  AIRCRAFT_STATUS: [
    'EXECUTION_STATUS',
    'com.airchina.tdms.statuslink.TDMSStatusLink',
    null,
    'single aircraft status',
    true,
  ],
  AIRCRAFT_FEEDBACK: [
    'EXECUTION_FEEDBACK',
    'wt.doc.WTDocument',
    'WCTYPE|wt.doc.WTDocument|com.airchina.EORecordLink',
    'EO反馈单',
    true,
  ],
  AD_ITEM: [
    'PROCESSING_ITEM',
    'wt.change2.WTChangeActivity2',
    null,
    'AD item',
    true,
  ],
} as const;
export type CompleteScope = keyof typeof profiles;
export function completeComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(completeComparison);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              'observedAt',
              'settledAt',
              'windows',
              'treeExpansions',
              'itemId',
              'snapshotId',
              'lastSeenAt',
            ].includes(k),
        )
        .map(([k, x]) => [k, completeComparison(x)]),
    );
  return value;
}
export function sealComplete(env: TdmsDailyMetadataEnvelope) {
  for (const r of env.package.records) {
    const value = completeComparison(r) as any;
    const normalize = (v: any, key = ''): any => {
      if (Array.isArray(v)) return v.map((x) => normalize(x, key));
      if (v && typeof v === 'object')
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, normalize(x, k)]),
        );
      return typeof v === 'string' &&
        [
          'fieldId',
          'sectionId',
          'tabId',
          'panelLocator',
          'locator',
          'selector',
          'evidenceLocator',
          'fieldIds',
          'sectionIds',
          'tabIds',
          'fieldLocators',
          'sectionLocators',
        ].includes(key)
        ? v.replace(
            /infoPage_myTab_tab_jcaGen_\d+/gu,
            'infoPage_OWN_ENGINEERING_DETAILS',
          )
        : v;
    };
    const projection = normalize(value),
      proof = projection.rawFields.completeOwnedSource;
    delete proof.documentIdentity;
    delete proof.requestedCriteria.sourceProof;
    delete proof.requestedCriteria.expectedOwner;
    for (const read of proof.reads)
      read.sourceContext = {
        sourceInstanceOrigin: read.sourceContext.sourceInstanceOrigin,
      };
    for (const occurrence of proof.targetOccurrences)
      if (occurrence.origin === 'OWN_FIELD') {
        occurrence.tableId =
          'OWN_FIELD:' + hash(occurrence.fieldId).slice(0, 32);
        occurrence.occurrenceId =
          'OWN_FIELD:' +
          hash([
            occurrence.fieldId,
            occurrence.linkIndex,
            occurrence.targetRef,
          ]);
      }
    r.snapshotId = 'TDMSSNAP-' + hash(projection);
  }
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function syntheticCompleteEnvelope(
  scopeId: CompleteScope = 'SB_PROCESSING_FORM',
  id = 901,
) {
  const [kind, nativeClass, nativeTypeId, header, layoutPending] =
    profiles[scopeId];
  const ref = 'OR:' + nativeClass + ':' + id,
    number = 'SYNTHETIC-' + id;
  const related = ['AD_ITEM', 'AIRCRAFT_STATUS', 'AIRCRAFT_FEEDBACK'].includes(
    scopeId,
  );
  const engineering = scopeId === 'EO';
  const sourceVersion = related || engineering ? declared() : unknownVersion();
  const input = {
    scopeId,
    profileRevision: 'tdms-complete-owned-profiles@1',
    documentCode: number,
    sourceObjectRef: ref,
    expectedOwner: {
      nativeTypeId,
      sourceVersion,
      sourceModifiedRaw: '2026-10-12 08:00',
    },
    sourceProof: related
      ? {
          kind: 'REQUIRED_RELATION_TARGET',
          parentOperationId: 'TDMSOP-11111111-1111-1111-1111-111111111111',
          parentPackageId: 'synthetic-parent',
          parentPackageSha256: '1'.repeat(64),
          parentSnapshotId: 'TDMSSNAP-' + '2'.repeat(64),
          parentSourceRecordId: 'OR:wt.change2.WTChangeOrder2:900',
          parentSourceVersion: declared(),
          tableId: 'synthetic-parent-table',
          occurrenceId: 'synthetic-row',
          targetRef: ref,
        }
      : {
          kind: 'CURRENT_DIRECTORY',
          operationId: 'TDMSOP-11111111-1111-1111-1111-111111111111',
          rowDigest: '1'.repeat(64),
          scopeDigest: '2'.repeat(64),
          ...(engineering
            ? {
                classificationOperationId:
                  'TDMSOP-22222222-2222-2222-2222-222222222222',
              }
            : {}),
        },
    purpose: 'COVERAGE',
    contentMode: 'COMPLETE_OWN_SOURCE@1',
    openIfMissing: false,
  };
  const value = (
    state: string,
    actualLabel: string,
    rawValue: string | null,
    locator: string,
    observedTotalCodepoints = rawValue === null ? 0 : [...rawValue].length,
  ) => ({ state, actualLabel, rawValue, locator, observedTotalCodepoints });
  const owner = {
    sourceRecordId: ref,
    number,
    nativeTypeId,
    nativeTypeEvidence: value(
      nativeTypeId ? 'VALUE' : 'NOT_READ',
      'Native type',
      nativeTypeId,
      '#type',
    ),
    rawHeaderIdentifier: number + ', ' + (engineering ? 'A.1' : header),
    rawHeaderType: header,
    sourceVersion,
    technicalVersionEvidence: value(
      related || engineering ? 'VALUE' : 'ABSENT',
      engineering ? 'Publication Source' : 'Version:',
      related || engineering ? 'A.1' : null,
      engineering ? '#infoPageIdentityObjectIdentifier' : '#version',
    ),
    technicalVersionFieldEvidence: value(
      related ? 'VALUE' : 'ABSENT',
      'Version:',
      related ? 'A.1' : null,
      '#version',
    ),
    businessVersion: {
      rawRevision: '1',
      rawIteration: null,
      confirmation: 'SOURCE_DECLARED',
    },
    businessVersionEvidence: value(
      'VALUE',
      'Business revision',
      '1',
      '#business-version',
    ),
    stateRaw: 'Estimated',
    sourceModifiedRaw: input.expectedOwner.sourceModifiedRaw,
    sourceCreatedRaw: null,
    contextRaw: null,
    scopeEvidence: {
      nativeTypeOrigin: input.sourceProof.kind,
      businessType: null,
      engineeringSubtype: engineering ? 'EO' : null,
      rawTypeField: null,
    },
    observedAt: observationTime,
  };
  const states = [
    'VALUE',
    'BLANK',
    'ABSENT',
    'NOT_APPLICABLE',
    'NOT_LOADED',
    'NOT_READ',
    'TRUNCATED',
    'ACCESS_DENIED',
  ];
  const fields = states.map((state, index) => ({
    fieldId: 'field-' + index,
    tabId: 'tab-own',
    sectionId: 'section-own',
    labelOrigin: 'NATIVE_SOURCE_DECLARED',
    nativeControl: { tag: 'TD', readOnly: null, disabled: null },
    value: value(
      state,
      index === 0 ? '执行日期 / 反馈日期 / 计划日期:' : 'Field ' + index,
      state === 'VALUE'
        ? '  TBD / feedback 2026-10-12 / planned 2026-11-01\n'
        : state === 'BLANK'
          ? ''
          : state === 'TRUNCATED'
            ? '😀'
            : null,
      '#own field-' + index,
      state === 'TRUNCATED' ? 3 : undefined,
    ),
    links: [],
  }));
  const roster = {
    fieldIds: fields.map((f) => f.fieldId),
    sectionIds: ['section-own'],
    fieldLocators: fields.map((f) => f.value.locator),
    sectionLocators: ['#section-own'],
    declaredFieldCount: fields.length,
    declaredSectionCount: 1,
    loadingPresent: false,
    terminal: 'DOM_TREE_END',
  };
  const read = {
    owner,
    sourceContext: {
      sourceInstanceOrigin: 'http://tdms.airchina.com',
      principalDisplayName: 'Synthetic principal',
      principalId: null,
      principalLocator: '#native-account',
      observedAt: observationTime,
    },
    tabs: [
      {
        tabId: 'tab-own',
        label: 'Own source tab',
        panelLocator: '#own',
        state: 'VALUE',
        required: true,
        sourceDeclared: true,
        reasonCode: null,
      },
    ],
    sections: [
      {
        sectionId: 'section-own',
        tabId: 'tab-own',
        label: 'Own section',
        panelLocator: '#section-own',
        state: 'VALUE',
        sourceDeclared: true,
      },
    ],
    fields,
    attachments: [],
    relationTables: [],
    rosterEvidence: {
      tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
      tabIds: ['tab-own'],
      structuralRosters: [
        {
          tabId: 'tab-own',
          before: roster,
          after: copyComplete(roster),
          settledReads: 2,
        },
      ],
      unreadControls: [],
      unknownRequiredSurfaces: [],
      layoutEvidencePending: layoutPending,
    },
    observedAt: observationTime,
  };
  const gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
  ];
  if (nativeTypeId === null) gaps.push('NATIVE_TYPE_UNOBSERVED');
  if (!related && !engineering) gaps.push('TECHNICAL_VERSION_UNCONFIRMED');
  if (layoutPending) gaps.push('OWN_LAYOUT_REPRESENTATIVE_PENDING');
  gaps.push('OWN_CONTENT_UNREAD');
  const coverage = { status: 'PARTIAL', gaps, readback: 'NON_ATOMIC' };
  const proof = {
    schemaVersion: 'wiselink.tdms-owned-complete-source-observation.v1',
    mode: 'COMPLETE_OWN_SOURCE@1',
    scopeId,
    profileRevision: input.profileRevision,
    requestedCriteria: input,
    documentIdentity: 'synthetic-document-identity',
    reads: [copyComplete(read), copyComplete(read)],
    targetOccurrences: [],
  };
  const r = {
    snapshotId: '',
    sourceRecordId: ref,
    kind,
    number,
    sourceVersion,
    businessVersion: owner.businessVersion,
    state: { rawCode: null, rawName: owner.stateRaw },
    observedAt: observationTime,
    sourceModifiedAt: null,
    authors: [],
    rawFields: {
      number,
      storageType: { rawCode: null, rawName: header },
      sourceModifiedRaw: owner.sourceModifiedRaw,
      completeOwnedSource: proof,
    },
    content: { completeOwnedFields: copyComplete(fields) },
    provenance: [
      {
        fieldPath: 'content.completeOwnedFields',
        selector: 'OWN_INFOPAGE_TAB_STRIP',
        sourceModifiedAt: null,
        observationRef: ref,
      },
    ],
    coverage,
  };
  return sealComplete({
    requestId: '',
    package: {
      schemaVersion: 'wiselink.tdms-daily-package.v1',
      packageId: 'synthetic-complete-' + id,
      sourceSystem: 'TDMS',
      observedAt: observationTime,
      coverage: copyComplete(coverage),
      query: {
        requestedCriteria: {
          documentCode: number,
          sourceObjectRef: ref,
          objectType: header,
          nativeClass,
        },
        actualCriteria: null,
        scopeMatch: 'UNKNOWN',
        scopeComplete: false,
      },
      records: [r],
      edges: [],
      artifactBindings: [],
      readFailures: [],
    },
  } as unknown as TdmsDailyMetadataEnvelope);
}

export function withCompleteRelation(env = syntheticCompleteEnvelope()) {
  const r = env.package.records[0];
  const proof = r.rawFields.completeOwnedSource as {
    reads: Array<{ owner: Record<string, unknown>; relationTables: unknown[] }>;
    targetOccurrences: unknown[];
  };
  const target = 'OR:wt.change2.WTChangeActivity2:999',
    locator = '#relations row-0 Number';
  const rowVersion = {
    rawRevision: 'A',
    rawIteration: '1',
    confirmation: 'SOURCE_DECLARED',
  };
  const table = {
    tableId: 'synthetic-table',
    tabId: 'tab-own',
    tableTitle: 'Synthetic relation table',
    panelLocator: '#relations',
    gridId: 'synthetic-grid',
    relationshipRole: 'CURRENT_CONTENT',
    direction: 'SOURCE_TO_TARGET',
    rawHeaders: ['Number'],
    reportedTotal: 1,
    countEvidence: {
      rawText: '(1 object)',
      exact: true,
      locator: '#relations count',
    },
    scanMode: 'DOM_ROWS',
    rows: [
      {
        occurrenceId: 'row-0',
        globalIndex: 0,
        nativeRowId: 'native-row-0',
        treePath: [],
        treeDepth: null,
        nativeRelationId: null,
        rawRole: null,
        rawDirection: null,
        cells: [
          {
            actualLabel: 'Number',
            rawValue: 'Synthetic target',
            state: 'VALUE',
            observedTotalCodepoints: 16,
          },
        ],
        sourceLinks: [
          {
            rawHref: '/infoPage?oid=' + target,
            targetRef: target,
            numberRaw: 'Synthetic target',
            nativeRole: 'RELATED',
            locator,
            nativeColumnLabel: 'Number',
          },
        ],
        observedVersion: rowVersion,
      },
    ],
    windows: [
      {
        ordinal: 0,
        rowOccurrenceIds: ['row-0'],
        globalIndices: [0],
        reportedTotal: 1,
        pageRaw: null,
        scroll: null,
        nextControl: { present: false, enabled: false, terminalDeclared: true },
        stableReads: 2,
        treePending: 0,
        observedAt: r.observedAt,
      },
    ],
    treeExpansions: [],
    terminal: {
      kind: 'NATIVE_END',
      total: 1,
      captured: 1,
      allGlobalIndices: true,
      allTreeNodesExpanded: true,
      nativeTerminal: true,
      trueZero: false,
      settledReads: 2,
    },
    enumerationState: 'VALUE',
    stopReason: null,
    ownerSourceRecordId: r.sourceRecordId,
    ownerSourceVersion: r.sourceVersion,
    observedAt: r.observedAt,
  };
  for (const read of proof.reads) read.relationTables = [copyComplete(table)];
  proof.targetOccurrences = [
    {
      origin: 'RELATION_TABLE',
      tableId: table.tableId,
      occurrenceId: 'row-0',
      linkIndex: 0,
      targetRef: target,
      numberRaw: 'Synthetic target',
      rawHref: '/infoPage?oid=' + target,
      relationshipRole: 'CURRENT_CONTENT',
      modelRoleOrigin: 'REVIEWED_TABLE_MODEL',
      rawRole: null,
      nativeLinkRole: 'RELATED',
      nativeColumnLabel: 'Number',
      nativeColumnToken: null,
      fieldId: null,
      fieldActualLabel: null,
      tabId: 'tab-own',
      sectionId: null,
      direction: 'SOURCE_TO_TARGET',
      rawDirection: null,
      treePath: [],
      nativeRelationId: null,
      sourceVersion: rowVersion,
      ownerSourceVersion: r.sourceVersion,
      locator,
    },
  ];
  sealComplete(env);
  const identity = {
    fromSourceRecordId: r.sourceRecordId,
    toSourceRecordId: target,
    fromSnapshotId: r.snapshotId,
    toSnapshotId: null,
    nativeRelationId: null,
    relationKind: 'synthetic-table',
    evidenceLocator: locator,
    observedAt: r.observedAt,
    confidence: 'observed_unresolved',
  };
  env.package.edges = [
    {
      edgeId: 'TDMSEDGE-' + hash(completeComparison(identity)),
      ...identity,
    } as (typeof env.package.edges)[number],
  ];
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
