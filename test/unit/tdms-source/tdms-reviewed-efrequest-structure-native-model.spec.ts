import {
  packReviewedEfStructureProof,
  REVIEWED_EFREQUEST_STRUCTURE_MODEL,
  reviewedEfStructureSemanticProjection,
  unpackReviewedEfStructureProof,
  validateReviewedEfStructureUsesEvidence,
} from '../../../server/modules/tdms-source/tdms-reviewed-efrequest-structure-native-model';
import {
  completeOwnedStableProjection,
  validateCompleteRelationTable,
} from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { validateReviewedCompleteTabPurposes } from '../../../server/modules/tdms-source/tdms-reviewed-complete-source-types';

const binding = () => ({
  schemaVersion: 'wiselink.tdms-efrequest-structure-current-collection.v5',
  modelRevision: 'tdms-reviewed-efrequest-structure-current-collection@5',
  scopeId: 'ENGINEERING_ASSESSMENT',
  ownerSourceRecordId: 'OR:wt.doc.WTDocument:241001',
  ownerSourceVersion: {
    rawRevision: 'A',
    rawIteration: '1',
    confirmation: 'SOURCE_DECLARED',
  },
  ownerSourceModifiedRaw: '2026-10-13 08:00',
  nativeTypeId: 'WCTYPE|wt.doc.WTDocument|com.airchina.EFRequest',
  tabId: 'infoPageinfoPanelID__infoPage_myTab_docsb_docStructureGWT',
  panelLocator: '#infoPage_myTab_docsb_docStructureGWT',
});

const structureProof = () => ({
  ...binding(),
  purpose: 'REQUIRED_CONFIGURED_DOCUMENT_STRUCTURE_AND_USES',
  bodyEvidenceState: 'NOT_READ',
  before: { same: 'shared frame', tree: [] },
  after: { same: 'shared frame', tree: [] },
  settledReads: 2,
});

const usesOwner = () => ({
  sourceRecordId: binding().ownerSourceRecordId,
  sourceVersion: binding().ownerSourceVersion,
  nativeTypeId: binding().nativeTypeId,
  rawHeaderType: '工程文件编写评估单',
  nativeTypeEvidence: {
    state: 'VALUE',
    rawValue: binding().nativeTypeId,
  },
});

// Incoming generic table claims, deliberately without a dedicated Uses proof.
// The nonzero variant retains the unqualified Description that must be refused.
const unprovedUsesTable = (rawText = '(0 objects)', nonzero = false) => {
  const values: Array<string | null> = [
    null,
    'SYNTHETIC NUMBER',
    'SYNTHETIC NAME',
    null,
    null,
    null,
    'A.1',
    'SYNTHETIC UNQUALIFIED TARGET DESCRIPTION',
    'Estimated',
  ];
  const rawHeaders = [
    '',
    'Number',
    'Name',
    '',
    '',
    '',
    'Version',
    'Description',
    'State',
  ];
  const occurrenceId = 'SYNTHETIC-UNBOUND-ROW';
  const rows = nonzero
    ? [
        {
          occurrenceId,
          globalIndex: 0,
          nativeRowId: 'x-auto-90901',
          treePath: [],
          treeDepth: null,
          nativeRelationId: null,
          rawRole: null,
          rawDirection: null,
          cells: rawHeaders.map((actualLabel: string, index: number) => ({
            actualLabel,
            state: values[index] === null ? 'NOT_READ' : 'VALUE',
            rawValue: values[index],
            observedTotalCodepoints:
              values[index] === null ? 0 : [...values[index]].length,
          })),
          sourceLinks: [],
          observedVersion: {
            rawRevision: null,
            rawIteration: null,
            confirmation: 'VERSION_UNCONFIRMED',
          },
        },
      ]
    : [];
  const total = nonzero ? 1 : 0;
  return {
    tableId: 'docsb.DOCSB.uses',
    tabId: binding().tabId,
    tableTitle: 'Uses',
    panelLocator: binding().panelLocator,
    gridId: 'x-auto-1',
    relationshipRole: 'UNKNOWN',
    direction: 'UNKNOWN',
    rawHeaders,
    reportedTotal: total,
    countEvidence: { rawText, exact: true, locator: '#synthetic-count' },
    scanMode: 'DOM_ROWS',
    rows,
    windows: [
      {
        ordinal: 0,
        rowOccurrenceIds: nonzero ? [occurrenceId] : [],
        globalIndices: nonzero ? [0] : [],
        reportedTotal: total,
        pageRaw: null,
        scroll: {
          top: 0,
          height: 100,
          viewport: 100,
          atTop: true,
          atBottom: true,
        },
        nextControl: {
          present: false,
          enabled: false,
          terminalDeclared: false,
        },
        stableReads: 2,
        treePending: 0,
        observedAt: '2026-10-13T08:00:00.000Z',
      },
    ],
    treeExpansions: [],
    terminal: {
      kind: 'NATIVE_END',
      total,
      captured: total,
      allGlobalIndices: true,
      allTreeNodesExpanded: true,
      nativeTerminal: true,
      trueZero: !nonzero,
      settledReads: 2,
    },
    enumerationState: 'VALUE',
    stopReason: null,
    ownerSourceRecordId: binding().ownerSourceRecordId,
    ownerSourceVersion: binding().ownerSourceVersion,
    observedAt: '2026-10-13T08:00:00.000Z',
  };
};

const unreadUsesTable = () => {
  const table = unprovedUsesTable();
  return {
    ...table,
    reportedTotal: null,
    countEvidence: { ...table.countEvidence, rawText: null, exact: false },
    windows: [
      {
        ...table.windows[0],
        reportedTotal: null,
        scroll: null,
        treePending: 1,
      },
    ],
    terminal: {
      kind: 'UNCONFIRMED',
      total: null,
      captured: 0,
      allGlobalIndices: false,
      allTreeNodesExpanded: false,
      nativeTerminal: false,
      trueZero: false,
      settledReads: 2,
    },
    enumerationState: 'NOT_READ',
    stopReason: REVIEWED_EFREQUEST_STRUCTURE_MODEL.stopReason,
  };
};

const validateUsesTable = (
  table:
    | ReturnType<typeof unprovedUsesTable>
    | ReturnType<typeof unreadUsesTable>,
) =>
  validateCompleteRelationTable(
    table,
    {
      sourceObjectRef: binding().ownerSourceRecordId,
      scopeId: 'ENGINEERING_ASSESSMENT',
    },
    usesOwner(),
  );

describe('reviewed EF structure frame codec', () => {
  it('preserves semantic content and reuses an identical frame losslessly', () => {
    const raw = structureProof(),
      encoded = packReviewedEfStructureProof(raw);

    expect(encoded.frameCodec.frames).toHaveLength(1);
    expect(unpackReviewedEfStructureProof(encoded)).toEqual(raw);
    expect(reviewedEfStructureSemanticProjection(encoded)).toEqual(
      reviewedEfStructureSemanticProjection(raw),
    );
    expect(raw).toEqual(structureProof());
  });

  it('rejects malformed dictionaries, cross-frame references and mixed identity', () => {
    const encoded = packReviewedEfStructureProof(structureProof());
    const duplicateString = JSON.parse(JSON.stringify(encoded));
    duplicateString.frameCodec.strings.push(
      duplicateString.frameCodec.strings[0],
    );
    expect(() => unpackReviewedEfStructureProof(duplicateString)).toThrow(
      'TDMS_COMPLETE_EF_STRUCTURE_CODEC_INVALID',
    );

    const crossFrame = JSON.parse(JSON.stringify(encoded));
    crossFrame.after.frameIndex = 1;
    expect(() => unpackReviewedEfStructureProof(crossFrame)).toThrow(
      'TDMS_COMPLETE_EF_STRUCTURE_CODEC_INVALID',
    );

    const mixedIdentity = JSON.parse(JSON.stringify(encoded));
    mixedIdentity.ownerSourceRecordId = 'OR:wt.doc.WTDocument:241002';
    expect(() => unpackReviewedEfStructureProof(mixedIdentity)).toThrow(
      'TDMS_COMPLETE_EF_STRUCTURE_CODEC_INVALID',
    );
  });

  it('uses decoded semantics for identity while leaving the persisted proof encoded', () => {
    const proof = packReviewedEfStructureProof(structureProof());
    const read = {
      owner: {
        sourceRecordId: binding().ownerSourceRecordId,
        rawHeaderIdentifier: 'SYNTHETIC-EF',
      },
      tabs: [{ purposeEvidence: proof }],
      relationTables: [],
    };

    const projected = completeOwnedStableProjection(read);

    expect(proof.frameCodec).toBeDefined();
    expect(projected.tabs[0].purposeEvidence.frameCodec).toBeUndefined();
    expect(projected.tabs[0].purposeEvidence.before).toEqual({
      same: 'shared frame',
      tree: [],
    });
  });

  it('rechecks aggregate logical expansion limits for reused frames', () => {
    const encoded = packReviewedEfStructureProof(structureProof());
    encoded.after.frameIndex = encoded.before.frameIndex;
    encoded.frameCodec.frameMeasures[0].expandedBytes = 900_000;
    expect(() => unpackReviewedEfStructureProof(encoded)).toThrow(
      'TDMS_COMPLETE_EF_STRUCTURE_CODEC_INVALID',
    );
  });

  it('keeps an unproved Uses surface partial', () => {
    const status = validateReviewedEfStructureUsesEvidence(undefined, {
      scopeId: 'ENGINEERING_ASSESSMENT',
      owner: {
        sourceRecordId: binding().ownerSourceRecordId,
        nativeTypeId: binding().nativeTypeId,
        rawHeaderType: '工程文件编写评估单',
        nativeTypeEvidence: {
          state: 'VALUE',
          rawValue: binding().nativeTypeId,
        },
      },
      table: {
        tableId: 'docsb.DOCSB.uses',
        tabId: binding().tabId,
        panelLocator: binding().panelLocator,
        tableTitle: 'Uses',
        relationshipRole: 'UNKNOWN',
        direction: 'UNKNOWN',
        rawHeaders: [
          '',
          'Number',
          'Name',
          '',
          '',
          '',
          'Version',
          'Description',
          'State',
        ],
      },
    });

    expect(status).toMatchObject({ complete: false });
  });

  it('keeps an unproved required Structure tab required and unread', () => {
    const owner = {
      sourceRecordId: binding().ownerSourceRecordId,
      nativeTypeId: binding().nativeTypeId,
      rawHeaderType: '工程文件编写评估单',
      nativeTypeEvidence: {
        state: 'VALUE',
        rawValue: binding().nativeTypeId,
      },
    };
    const tab = {
      tabId: REVIEWED_EFREQUEST_STRUCTURE_MODEL.tabId,
      label: REVIEWED_EFREQUEST_STRUCTURE_MODEL.label,
      panelLocator: REVIEWED_EFREQUEST_STRUCTURE_MODEL.panelLocator,
      required: true,
      state: 'NOT_READ',
      reasonCode: REVIEWED_EFREQUEST_STRUCTURE_MODEL.stopReason,
      purposeEvidence: undefined,
    };

    expect(
      validateReviewedCompleteTabPurposes({
        scopeId: 'ENGINEERING_ASSESSMENT',
        owner,
        read: { tabs: [tab], fields: [], sections: [], relationTables: [] },
      }),
    ).toBe(false);
    const validateTab = (value: Record<string, unknown>) =>
      validateReviewedCompleteTabPurposes({
        scopeId: 'ENGINEERING_ASSESSMENT',
        owner,
        read: {
          tabs: [value],
          fields: [],
          sections: [],
          relationTables: [],
        },
      });

    expect(() => validateTab({ ...tab, required: false })).toThrow(
      'TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID',
    );
    expect(() => validateTab({ ...tab, state: 'VALUE' })).toThrow(
      'TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID',
    );
    expect(() => validateTab({ ...tab, reasonCode: null })).toThrow(
      'TDMS_REVIEWED_COMPLETE_TAB_PURPOSE_INVALID',
    );
  });

  it.each(['No data to display', '(0 objects)'])(
    'rejects completed Uses count %s without dedicated proof',
    (rawText: string) => {
      expect(() => validateUsesTable(unprovedUsesTable(rawText))).toThrow(
        'TDMS_COMPLETE_RELATION_COUNT_UNVERIFIED',
      );
    },
  );

  it('rejects a generic nonzero Uses row and its unqualified Description without proof', () => {
    const table = unprovedUsesTable('(1 objects)', true);
    expect(table.rows[0].cells[7]).toMatchObject({
      actualLabel: 'Description',
      state: 'VALUE',
      rawValue: 'SYNTHETIC UNQUALIFIED TARGET DESCRIPTION',
    });
    expect(() => validateUsesTable(table)).toThrow(
      'TDMS_COMPLETE_RELATION_COUNT_UNVERIFIED',
    );
  });

  it('retains only an empty, uncounted NOT_READ Uses placeholder without proof', () => {
    const table = unreadUsesTable();
    expect(validateUsesTable(table)).toEqual(table);
  });

  it('rejects a native endpoint claim on an otherwise unread Uses placeholder', () => {
    const table = unreadUsesTable();
    table.terminal.kind = 'NATIVE_END';
    expect(() => validateUsesTable(table)).toThrow(
      'TDMS_COMPLETE_RELATION_ENUM_UNPROVEN',
    );
  });

  it('rejects unbound row values even when Uses is declared unread and uncounted', () => {
    const table = unreadUsesTable();
    table.rows = unprovedUsesTable('(1 objects)', true).rows;
    table.terminal.captured = 1;
    table.windows[0].rowOccurrenceIds = [table.rows[0].occurrenceId];
    table.windows[0].globalIndices = [0];
    expect(() => validateUsesTable(table)).toThrow(
      'TDMS_COMPLETE_RELATION_ENUM_UNPROVEN',
    );
  });
});
