import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { completeContentIdentityProjection } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { REVIEWED_SB_NATIVE_LAYOUT_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-native-layout';
import { REVIEWED_SB_ANONYMOUS_STRICT_BLANK_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-anonymous-strict-blank';
import { REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-document-structure-native-model';
import { REVIEWED_SB_NATIVE_TREE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-native-tree';
import { REVIEWED_SB_ATTACHMENT_ALIAS_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-attachment-alias-purpose';
import { REVIEWED_SB_FIELDS_ALIAS_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-fields-alias-purpose';
import { REVIEWED_SB_HISTORY_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-history-purpose';
import { REVIEWED_SB_MANAGEMENT_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-management-purpose';
import { REVIEWED_SB_NOTEBOOK_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-notebook-purpose';
import {
  copyComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import { proofOfCurrent } from './tdms-current-contract.fixture';

// Synthetic DTOs only: no collector, DOM, Source product evaluation or real row.
export const sbDetail = REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels[0];
export const sbBlankModel = REVIEWED_SB_ANONYMOUS_STRICT_BLANK_MODEL;
export const sbProof = proofOfCurrent;
export const sbCopy = copyComplete;

export function sealSb(env: ReturnType<typeof syntheticCompleteEnvelope>) {
  const record = env.package.records[0];
  record.content.completeOwnedFields = copyComplete(
    sbProof(env).reads[1].fields,
  );
  record.snapshotId =
    'TDMSSNAP-' + hash(completeContentIdentityProjection(record));
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}

export function structuralRoster(read: any, tabId: string) {
  const fields = read.fields.filter((f: any) => f.tabId === tabId);
  const sections = read.sections.filter((s: any) => s.tabId === tabId);
  const before = {
    fieldIds: fields.map((f: any) => f.fieldId),
    sectionIds: sections.map((s: any) => s.sectionId),
    fieldLocators: fields.map((f: any) => f.value.locator),
    sectionLocators: sections.map((s: any) => s.panelLocator),
    declaredFieldCount: fields.length,
    declaredSectionCount: sections.length,
    loadingPresent: false,
    terminal: 'DOM_TREE_END',
  };
  return { tabId, before, after: copyComplete(before), settledReads: 2 };
}

export function syntheticSbDetails(state = 'Estimated') {
  const env = syntheticCompleteEnvelope('SB', 73001);
  for (const read of sbProof(env).reads) {
    read.owner.stateRaw = state;
    read.owner.sourceModifiedRaw += ' CST';
    read.domDocumentIdentity = {
      url:
        read.sourceContext.sourceInstanceOrigin +
        '/Windchill/app/#ptc1/tcomp/infoPage?oid=' +
        read.owner.sourceRecordId,
      timeOrigin: 1792272000000,
    };
    read.tabs = [
      {
        tabId: sbDetail.tabId,
        label: sbDetail.label,
        panelLocator: sbDetail.panelLocator,
        state: 'VALUE',
        required: true,
        sourceDeclared: true,
        reasonCode: null,
      },
    ];
    read.sections = sbDetail.sections.map((s: any) => ({
      sectionId: sbDetail.tabId + '::' + s.sectionId,
      tabId: sbDetail.tabId,
      label: s.label,
      panelLocator: sbDetail.panelLocator + ' #' + s.sectionId,
      state: 'VALUE',
      sourceDeclared: true,
    }));
    read.fields = sbDetail.sections.flatMap((s: any) =>
      s.labels.map((label: string, index: number) => {
        const locator =
          sbDetail.panelLocator +
          ' #' +
          s.dataStoreId +
          (label === ''
            ? ' > tbody > tr:nth-child(1) > td:nth-child(6)'
            : ' > tbody > tr:nth-child(' + (index + 2) + ') > td:nth-child(3)');
        const raw =
          label === 'Last Modified:'
            ? read.owner.sourceModifiedRaw
            : label === ''
              ? ''
              : 'synthetic metadata';
        return {
          fieldId: locator,
          tabId: sbDetail.tabId,
          sectionId: sbDetail.tabId + '::' + s.sectionId,
          labelOrigin: 'NATIVE_SOURCE_DECLARED',
          nativeControl: { tag: 'TD', readOnly: null, disabled: null },
          value: {
            state: label === '' ? 'BLANK' : 'VALUE',
            actualLabel: label,
            rawValue: raw,
            locator,
            observedTotalCodepoints: [...raw].length,
          },
          links: [],
        };
      }),
    );
    const field = read.fields.find((f: any) => f.value.actualLabel === '');
    const renderer = {
      previousLabel: 'Description:',
      rowChildTags: Array(6).fill('TD'),
      rowChildClasses: [...sbBlankModel.rowChildClasses],
      captionChildOneBased: 5,
      valueChildOneBased: 6,
      captionTag: 'TD',
      captionClass: 'attributePanel-label',
      captionAttributeNames: ['class'],
      rawCaptionText: '\u00a0',
      captionChildNodeTypes: [3],
      captionInnerHTML: '&nbsp;',
      valueTag: 'TD',
      valueClass: 'attributePanel-value',
      valueAttributeNames: ['class'],
      valueChildNodeTypes: [3],
      valueChildElementCount: 0,
      linkCount: 0,
      editorCount: 0,
      cellInnerHTML: ' &nbsp; ',
      rawText: ' \u00a0 ',
      observedTotalCodepoints: 3,
      truncated: false,
    };
    field.rawCaptionText = '\u00a0';
    field.rawTextQualification = {
      semanticPurpose: 'SEMANTIC_PURPOSE_UNKNOWN',
      ownerSourceRecordId: read.owner.sourceRecordId,
      ownStateRaw: state,
      observedAt: read.owner.observedAt,
      reasonCode: ['Approved', '已批准', 'Estimated'].includes(state)
        ? null
        : state === 'Estimating'
          ? 'TDMS_ESTIMATING_STATE_ONLY_REQUIRED'
          : 'TDMS_OPINION_STATE_NOT_ELIGIBLE',
    };
    field.strictBlankEvidence = {
      schemaVersion: sbBlankModel.schemaVersion,
      modelRevision: sbBlankModel.modelRevision,
      semanticPurpose: 'SEMANTIC_PURPOSE_UNKNOWN',
      use: 'CANONICAL',
      scopeId: 'SB',
      nativeTypeId: read.owner.nativeTypeId,
      ownerSourceRecordId: read.owner.sourceRecordId,
      ownerSourceVersion: copyComplete(read.owner.sourceVersion),
      ownerSourceModifiedRaw: read.owner.sourceModifiedRaw,
      ownStateRaw: state,
      sourceContext: copyComplete(read.sourceContext),
      normalBinding: copyComplete(read.domDocumentIdentity),
      tabId: sbDetail.tabId,
      panelLocator: sbDetail.panelLocator,
      fieldId: field.fieldId,
      canonicalFieldId: field.fieldId,
      before: renderer,
      after: copyComplete(renderer),
      settledReads: 2,
    };
    read.rosterEvidence = {
      tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
      tabIds: [sbDetail.tabId],
      structuralRosters: [structuralRoster(read, sbDetail.tabId)],
      unreadControls: [],
      unknownRequiredSurfaces: [],
      layoutEvidencePending: false,
    };
  }
  env.package.records[0].state.rawName = state;
  sbProof(env).requestedCriteria.expectedOwner.sourceModifiedRaw =
    sbProof(env).reads[1].owner.sourceModifiedRaw;
  env.package.records[0].rawFields.sourceModifiedRaw =
    sbProof(env).reads[1].owner.sourceModifiedRaw;
  env.package.records[0].coverage.gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
  ];
  env.package.coverage = copyComplete(env.package.records[0].coverage);
  return sealSb(env);
}

export function withSbStructureEvidence(env = syntheticSbPanels()) {
  const m = REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL;
  for (const read of sbProof(env).reads) {
    const owner = read.owner,
      tab = read.tabs.find((t: any) => t.tabId === m.tabId);
    const url =
      read.sourceContext.sourceInstanceOrigin +
      m.framePath +
      '?oid=' +
      owner.sourceRecordId +
      '&u8=1&AjaxEnabled=thirdLevelNav';
    const attributes = {
      fields: m.attributeLabels.map((label: string) => ({
        label,
        state: label === 'Modified By:' ? 'NOT_READ' : 'VALUE',
        rawValue:
          label === 'Modified By:'
            ? null
            : label === 'Number:'
              ? owner.number
              : label === 'Version:'
                ? 'A.1'
                : label === 'Type:'
                  ? m.nativeHeaderType
                  : label === 'Last Modified:'
                    ? owner.sourceModifiedRaw.replace(' CST', ':00 UTC+8')
                    : 'synthetic metadata',
      })),
    };
    const filter = {
      configuration: sbCopy(m.configuration),
      checkboxes: m.checkboxLabels.map((label: string, i: number) => ({
        label,
        checked: i === 0,
      })),
      focus: [],
    };
    const frame = {
      frame: {
        node: { id: m.frameId },
        title: m.innerTitle,
        readyState: 'complete',
        rawSrc: url,
        innerURL: url,
        innerTimeOrigin: 1792272000001,
      },
      component: { id: m.componentId },
      innerTabs: [],
      attributes: {
        before: attributes,
        after: sbCopy(attributes),
        settledReads: 2,
      },
      attributesOwnerBound: true,
      currentFilter: {
        before: filter,
        after: sbCopy(filter),
        configuration: sbCopy(m.configuration),
        closedReadBack: true,
        optionsChanged: false,
        settledReads: 2,
      },
      tree: {
        node: { id: 'x-auto-73002' },
        rows: [],
        nativeHeaders: [sbCopy(m.treeColumn)],
        counts: [],
        pagers: [],
        scroll: { top: 0, height: 100, viewport: 100 },
      },
      uses: {
        node: { id: 'x-auto-73003' },
        rows: [],
        nativeHeaders: sbCopy(m.usesColumns),
        counts: [],
        pagers: [],
        empty: [],
        paging: null,
        nativePaging: { state: 'NOT_READ' },
        scroll: { top: 0, height: 100, viewport: 100 },
      },
      query: {
        find: { rawValue: m.findPlaceholder },
        searches: [{ rawValue: m.usesSearchPlaceholder }],
        queryCoverage: 'UNPROVEN',
        viewState: 'NOT_READ',
        viewRaw: null,
        nativeQueryUi: {
          state: 'NOT_READ',
          reasonCode: 'SYNTHETIC_QUERY_UNREAD',
          before: null,
          after: null,
          settledReads: 0,
          closedReadBack: true,
          optionsChanged: false,
        },
      },
      loading: [],
    };
    const proof = {
      schemaVersion: m.schemaVersion,
      modelRevision: m.modelRevision,
      scopeId: 'SB',
      nativeTypeId: owner.nativeTypeId,
      ownerSourceRecordId: owner.sourceRecordId,
      ownerSourceVersion: sbCopy(owner.sourceVersion),
      ownerSourceModifiedRaw: owner.sourceModifiedRaw,
      businessSubtype: 'SB',
      normalBinding: sbCopy(read.domDocumentIdentity),
      tabId: m.tabId,
      panelLocator: m.panelLocator,
      purpose: m.purpose,
      before: frame,
      after: sbCopy(frame),
      settledReads: 2,
      ownerContinuity: {
        checkOrder: 'INITIAL_ATTRIBUTES_USES_QUERY_FINAL_ATTRIBUTES',
        initialInnerDocument: { url, timeOrigin: 1792272000001 },
        finalInnerDocument: { url, timeOrigin: 1792272000001 },
        finalAttributes: {
          before: sbCopy(attributes),
          after: sbCopy(attributes),
          settledReads: 2,
        },
      },
    };
    tab.purposeEvidence = proof;
    read.relationTables.push({
      tableId: m.tableId,
      tabId: m.tabId,
      tableTitle: m.tableTitle,
      panelLocator: m.panelLocator,
      gridId: frame.uses.node.id,
      relationshipRole: 'UNKNOWN',
      direction: 'UNKNOWN',
      rawHeaders: m.usesColumns.map((c: any) => c.actualLabel),
      reportedTotal: null,
      countEvidence: {
        rawText: null,
        exact: false,
        locator:
          m.panelLocator +
          ' iframe#' +
          m.frameId +
          ' [id="' +
          frame.uses.node.id +
          '"]',
      },
      scanMode: 'DOM_ROWS',
      rows: [],
      windows: [
        {
          ordinal: 0,
          rowOccurrenceIds: [],
          globalIndices: [],
          reportedTotal: null,
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
          treePending: 1,
          observedAt: read.observedAt,
        },
      ],
      treeExpansions: [],
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
      stopReason: m.stopReason,
      ownerSourceRecordId: owner.sourceRecordId,
      ownerSourceVersion: sbCopy(owner.sourceVersion),
      observedAt: read.observedAt,
      relatedSurfaceEvidence: sbCopy(proof),
    });
  }
  env.package.records[0].coverage.gaps.splice(
    2,
    0,
    'RELATION_ENUMERATION_UNVERIFIED',
  );
  env.package.coverage = sbCopy(env.package.records[0].coverage);
  return sealSb(env);
}

export function syntheticSbStructureOnly() {
  const env = withSbStructureEvidence(),
    m = REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL;
  for (const read of sbProof(env).reads) {
    read.tabs = read.tabs.filter((t: any) => t.tabId === m.tabId);
    read.fields = [];
    read.sections = [];
    read.relationTables = read.relationTables.filter(
      (t: any) => t.tableId === m.tableId,
    );
    delete read.sbNativeLayoutEvidence;
    read.rosterEvidence = {
      tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
      tabIds: [m.tabId],
      structuralRosters: [],
      unreadControls: [],
      unknownRequiredSurfaces: [],
      layoutEvidencePending: false,
    };
  }
  sbProof(env).targetOccurrences = [];
  env.package.records[0].coverage.gaps = [
    'REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED',
    'RELATION_ENUMERATION_UNVERIFIED',
    'OWN_CONTENT_UNREAD',
  ];
  env.package.coverage = sbCopy(env.package.records[0].coverage);
  return sealSb(env);
}

// A native owner tree with one exact self occurrence. Child metadata and source
// versions remain unread/unconfirmed; this fixture cannot prove whole coverage.
export function syntheticSbTree(read: any) {
  const m = REVIEWED_SB_NATIVE_TREE_MODEL,
    o = read.owner;
  const id = 'mytreetable:SB_NATIVE:0',
    rowLocator = '#synthetic-sb-tree-row';
  const href = '/Windchill/tcomp/infoPage?oid=' + o.sourceRecordId;
  const link = {
    rawHref: href,
    targetRef: o.sourceRecordId,
    numberRaw: o.number,
    nativeRole: m.numberRole,
    nativeColumnLabel: 'Number',
    nativeColumnToken: 'number',
    locator: rowLocator + ' a.number',
  };
  const row = {
    occurrenceId: id,
    globalIndex: null,
    nativeRowId: null,
    treePath: [o.sourceRecordId],
    treeDepth: 0,
    nativeRelationId: null,
    rawRole: null,
    rawDirection: null,
    sourceLinks: [link],
    observedVersion: {
      rawRevision: null,
      rawIteration: null,
      confirmation: 'VERSION_UNCONFIRMED',
    },
    cells: m.columns.map((c: any, i: number) => ({
      actualLabel: c.actualLabel,
      state: i === 1 ? 'VALUE' : 'NOT_READ',
      rawValue: i === 1 ? o.number : null,
      observedTotalCodepoints: i === 1 ? [...o.number].length : 0,
    })),
  };
  const shape = {
    occurrenceId: id,
    rowClass: 'x-grid3-row',
    numberCellClass: 'x-grid3-td-number',
    levelClass: null,
    uiWrap: { class: 'ux-maximgb-tg-uiwrap', style: 'width: 16px;' },
    elbows: [{ class: 'ux-maximgb-tg-elbow-end', style: 'left: 1px;' }],
    numberLink: {
      rawHref: href,
      locator: link.locator,
      targetRef: o.sourceRecordId,
    },
    domOrdinal: 0,
    siblingPath: [0],
  };
  const metadata = {
    occurrenceId: id,
    rowLocator,
    columns: m.columns.map((c: any, i: number) => ({
      ...c,
      locator:
        rowLocator +
        ' td.x-grid3-cell[class~="x-grid3-td-' +
        c.nativeColumnToken +
        '"]',
      readState: [1, 6, 8].includes(i) ? 'VALUE' : 'NOT_READ',
      rawText:
        i === 1
          ? o.number
          : i === 6
            ? o.stateRaw
            : i === 8
              ? o.sourceModifiedRaw
              : null,
      nativeRefs:
        i === 1
          ? [
              {
                rawHref: href,
                targetRef: o.sourceRecordId,
                locator: link.locator,
                nativeRefs: [{ parameter: 'oid', rawValue: o.sourceRecordId }],
              },
            ]
          : [],
      images: [],
      sourceVersionBinding: 'UNCONFIRMED',
      originalBinding: 'UNCONFIRMED',
      bytesCollected: false,
    })),
  };
  const query = {
    scope: m.scopeMeaning,
    controls: [
      {
        tag: 'BUTTON',
        rawClassName: 'x-btn-text expandCollapse_collapsed',
        type: 'button',
        name: null,
        disabled: false,
      },
    ],
    explicitMarkers: [],
    pagerControls: [],
    loading: [],
  };
  const scroll = {
    top: 0,
    height: 100,
    viewport: 100,
    atTop: true,
    atBottom: true,
  };
  const after = {
    rowOccurrenceIds: [id],
    query,
    rawCount: '(1 object)',
    reportedTotal: 1,
    scroll,
  };
  return {
    tableId: m.gridId,
    tabId: m.tabId,
    tableTitle: m.tableTitle,
    panelLocator: m.panelLocator,
    gridId: m.gridId,
    relationshipRole: 'CURRENT_CONTENT',
    direction: 'UNKNOWN',
    rawHeaders: m.columns.map((c: any) => c.actualLabel),
    reportedTotal: 1,
    countEvidence: {
      rawText: '(1 object)',
      exact: true,
      locator: '#synthetic-sb-tree-count',
    },
    scanMode: 'TREE',
    rows: [row],
    windows: [
      {
        ordinal: 0,
        rowOccurrenceIds: [id],
        globalIndices: [],
        reportedTotal: 1,
        pageRaw: null,
        scroll,
        nextControl: {
          present: false,
          enabled: false,
          terminalDeclared: false,
        },
        stableReads: 2,
        treePending: 0,
        observedAt: read.observedAt,
      },
    ],
    treeExpansions: [],
    terminal: {
      kind: 'NATIVE_END',
      total: 1,
      captured: 1,
      allGlobalIndices: false,
      allTreeNodesExpanded: true,
      nativeTerminal: true,
      trueZero: false,
      settledReads: 2,
    },
    enumerationState: 'VALUE',
    stopReason: null,
    ownerSourceRecordId: o.sourceRecordId,
    ownerSourceVersion: sbCopy(o.sourceVersion),
    observedAt: read.observedAt,
    nativeTreeEvidence: {
      modelRevision: m.modelRevision,
      scopeMeaning: m.scopeMeaning,
      scopeId: 'SB',
      ownerSourceRecordId: o.sourceRecordId,
      ownerSourceVersion: sbCopy(o.sourceVersion),
      ownerBusinessVersion: sbCopy(o.businessVersion),
      ownStateRaw: o.stateRaw,
      ownModifiedRaw: o.sourceModifiedRaw,
      rawHeaderIdentifier: o.rawHeaderIdentifier,
      columns: sbCopy(m.columns),
      rowShapes: [shape],
      rowMetadata: [metadata],
      before: sbCopy(after),
      after: sbCopy(after),
      settledReads: 2,
      windows: [
        {
          ordinal: 0,
          rows: [sbCopy(row)],
          rowShapes: [sbCopy(shape)],
          rowMetadata: [sbCopy(metadata)],
          query,
          rawCount: '(1 object)',
          reportedTotal: 1,
          windowOrdinals: [0],
        },
      ],
    },
  };
}

export function emptySbTable(read: any, panel: any, grid: any) {
  return {
    tableId: grid.gridId,
    tabId: panel.tabId,
    tableTitle: 'Synthetic zero ' + grid.gridId,
    panelLocator: panel.panelLocator,
    gridId: grid.gridId,
    relationshipRole: 'UNKNOWN',
    direction: 'UNKNOWN',
    rawHeaders: grid.columns.map((c: any) => c.actualLabel),
    reportedTotal: 0,
    countEvidence: {
      rawText: '(0 objects)',
      exact: true,
      locator: panel.panelLocator + ' .synthetic-count',
    },
    scanMode: 'DOM_ROWS',
    rows: [],
    windows: [
      {
        ordinal: 0,
        rowOccurrenceIds: [],
        globalIndices: [],
        reportedTotal: 0,
        pageRaw: null,
        scroll: null,
        nextControl: { present: false, enabled: false, terminalDeclared: true },
        stableReads: 2,
        treePending: 0,
        observedAt: read.observedAt,
      },
    ],
    treeExpansions: [],
    terminal: {
      kind: 'NATIVE_END',
      total: 0,
      captured: 0,
      allGlobalIndices: true,
      allTreeNodesExpanded: true,
      nativeTerminal: true,
      trueZero: true,
      settledReads: 2,
    },
    enumerationState: 'VALUE',
    stopReason: null,
    ownerSourceRecordId: read.owner.sourceRecordId,
    ownerSourceVersion: sbCopy(read.owner.sourceVersion),
    observedAt: read.observedAt,
  };
}

function purpose(
  read: any,
  model: any,
  panel: any,
  name: string,
  bodyState: string,
  frame: any,
) {
  return {
    schemaVersion: model.schemaVersion,
    modelRevision: model.modelRevision,
    ownerSourceRecordId: read.owner.sourceRecordId,
    sourceVersion: sbCopy(read.owner.sourceVersion),
    sourceModifiedRaw: read.owner.sourceModifiedRaw,
    ownStateRaw: read.owner.stateRaw,
    sourceContext: sbCopy(read.sourceContext),
    tabId: panel.tabId,
    panelLocator: panel.panelLocator,
    purpose: name,
    bodyState,
    enumerationState: 'NOT_ENUMERATED',
    before: frame,
    after: sbCopy(frame),
    settledReads: 2,
  };
}
function panelFrame(panel: any) {
  return {
    activeTabId: panel.tabId,
    panelId: panel.panelLocator.slice(1),
    visible: true,
    componentIds: sbCopy(panel.componentIds),
    grids: panel.grids.map((g: any) => ({
      gridId: g.gridId,
      visible: true,
      columns: sbCopy(g.columns),
      renderedRowCount: 0,
    })),
    fieldCount: 0,
    embeddedCount: 0,
    loading: false,
    blockingMarkerCount: 0,
    rawReferences: [],
    unknownSurfaceCount: 0,
  };
}
export function syntheticSbPanels(state = 'Estimated') {
  const env = syntheticSbDetails(state);
  for (const read of sbProof(env).reads) {
    read.tabs = REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels.map((p: any) => ({
      tabId: p.tabId,
      label: p.label,
      panelLocator: p.panelLocator,
      state: 'VALUE',
      required: true,
      sourceDeclared: true,
      reasonCode: null,
    }));
    const byId = (id: string) => read.tabs.find((t: any) => t.tabId === id);
    const structure = byId(REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.tabId);
    structure.state = 'NOT_READ';
    structure.reasonCode = REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.stopReason;
    const excluded: any[] = [
      REVIEWED_SB_HISTORY_MODEL,
      REVIEWED_SB_ATTACHMENT_ALIAS_MODEL,
      REVIEWED_SB_FIELDS_ALIAS_MODEL,
      REVIEWED_SB_MANAGEMENT_MODEL,
    ];
    const excludedIds = new Set(
      excluded.flatMap((m: any) => m.panels.map((p: any) => p.tabId)),
    );
    const business = REVIEWED_SB_NOTEBOOK_MODEL;
    read.relationTables = REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels
      .filter(
        (p: any) =>
          !excludedIds.has(p.tabId) &&
          p.tabId !== REVIEWED_SB_NATIVE_TREE_MODEL.tabId,
      )
      .flatMap((p: any) =>
        p.grids
          .filter(
            (g: any) =>
              p.tabId !== business.panels[0].tabId ||
              g.gridId === business.businessGridId,
          )
          .map((g: any) => emptySbTable(read, p, g)),
      );
    read.relationTables.push(syntheticSbTree(read));
    for (const model of excluded)
      for (const p of model.panels) {
        const tab = byId(p.tabId),
          frame: any = panelFrame(p);
        tab.required = false;
        tab.state = 'NOT_READ';
        tab.reasonCode = model.reasonCode;
        let name = 'MANAGEMENT_REFERENCE_ONLY',
          body = 'NOT_READ';
        if (model === REVIEWED_SB_HISTORY_MODEL) {
          name = 'HISTORY_REFERENCE_ONLY';
          frame.embeddedCount = 1;
          frame.historyMetadata = [];
          frame.embeddedReferences = [
            {
              id: 'timelineIFrame',
              documentUrl:
                'http://tdms.airchina.com/Windchill/app/netmarkets/jsp/history/timelineHistory-iframe.jsp?oid=' +
                read.owner.sourceRecordId,
              readyState: 'complete',
              bodyState: 'NOT_READ',
              rawSrc:
                'http://tdms.airchina.com/Windchill/app/netmarkets/jsp/history/timelineHistory-iframe.jsp?oid=' +
                read.owner.sourceRecordId,
            },
          ];
        }
        if (model === REVIEWED_SB_ATTACHMENT_ALIAS_MODEL) {
          name = 'CANONICAL_ATTACHMENT_ALIAS';
          body = 'BOUND_TO_CANONICAL';
        }
        if (model === REVIEWED_SB_FIELDS_ALIAS_MODEL) {
          name = 'CANONICAL_FIELDS_AND_MANAGEMENT_REFERENCES';
          body = 'BOUND_TO_CANONICAL';
          frame.fieldCount = 44;
          frame.sectionIds = p.sections.map((s: any) => s.sectionId);
          frame.aliasFields = p.sections.flatMap((s: any) =>
            s.labels.map((label: string, ordinal: number) => {
              const canonical = read.fields.find(
                (f: any) =>
                  f.sectionId === sbDetail.tabId + '::' + s.sectionId &&
                  f.value.actualLabel === label,
              );
              const field: any = {
                sectionId: s.sectionId,
                dataStoreId: s.dataStoreId,
                label,
                ordinal,
                canonicalFieldId: canonical.fieldId,
                state: canonical.value.state,
                rawValue: canonical.value.rawValue,
                rawHrefs: canonical.links.map((l: any) => l.rawHref),
              };
              if (canonical.strictBlankEvidence) {
                field.strictBlankEvidence = {
                  ...sbCopy(canonical.strictBlankEvidence),
                  use: 'ALIAS',
                  tabId: p.tabId,
                  panelLocator: p.panelLocator,
                  fieldId: canonical.fieldId.replace(
                    sbDetail.panelLocator,
                    p.panelLocator,
                  ),
                };
              }
              return field;
            }),
          );
        }
        tab.purposeEvidence = purpose(read, model, p, name, body, frame);
        if (model === REVIEWED_SB_ATTACHMENT_ALIAS_MODEL) {
          const canonical = read.relationTables.find(
            (t: any) =>
              t.tabId === model.canonicalTabId &&
              t.gridId === p.grids[0].gridId,
          );
          tab.purposeEvidence.canonicalTableId = canonical.tableId;
          tab.purposeEvidence.aliasTable = {
            ...sbCopy(canonical),
            tabId: p.tabId,
            panelLocator: p.panelLocator,
          };
        }
      }
    const p = business.panels[0],
      frame: any = panelFrame(p);
    frame.embeddedCount = 1;
    frame.embeddedReferences = [
      {
        id: 'timelineIFrame',
        documentUrl:
          'http://tdms.airchina.com/Windchill/app/netmarkets/jsp/history/timelineHistory-iframe.jsp?oid=' +
          read.owner.sourceRecordId,
        readyState: 'complete',
        bodyState: 'NOT_READ',
        rawSrc:
          'http://tdms.airchina.com/Windchill/app/netmarkets/jsp/history/timelineHistory-iframe.jsp?oid=' +
          read.owner.sourceRecordId,
      },
    ];
    byId(p.tabId).purposeEvidence = purpose(
      read,
      business,
      p,
      'MANAGEMENT_REFERENCES_AND_REQUIRED_NOTEBOOK_LINKS',
      'NOT_READ',
      frame,
    );
    read.sbNativeLayoutEvidence = {
      schemaVersion: REVIEWED_SB_NATIVE_LAYOUT_MODEL.schemaVersion,
      modelRevision: REVIEWED_SB_NATIVE_LAYOUT_MODEL.modelRevision,
      ownerSourceRecordId: read.owner.sourceRecordId,
      sourceVersion: sbCopy(read.owner.sourceVersion),
      sourceModifiedRaw: read.owner.sourceModifiedRaw,
      sourceContext: sbCopy(read.sourceContext),
      panels: REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels.map((panel: any) => {
        const before = {
          activeTabId: panel.tabId,
          panelId: panel.panelLocator.slice(1),
          visible: true,
          componentIds: sbCopy(panel.componentIds),
          grids: sbCopy(panel.grids),
          sections: sbCopy(panel.sections),
          embeddedIds: sbCopy(panel.embeddedIds),
          loading: false,
          blockingMarkerCount: 0,
          unknownControlCount: 0,
        };
        return {
          tabId: panel.tabId,
          before,
          after: sbCopy(before),
          settledReads: 2,
        };
      }),
    };
    read.rosterEvidence.tabIds = read.tabs.map((t: any) => t.tabId);
    read.rosterEvidence.nativeTabStripIds = [
      ...read.rosterEvidence.tabIds,
      'infoPageinfoPanelID__new_tab_action',
    ];
    read.rosterEvidence.nonContentControls = [
      {
        actionId: 'infoPageinfoPanelID__new_tab_action',
        tag: 'LI',
        rawClassName: 'x-tab-with-icon',
        rawCaption: '',
        locator: '#infoPageinfoPanelID__new_tab_action',
        rootLocator: '#infoPagemainInfoPagePanel',
        semantic: 'NATIVE_TAB_CREATE_ACTION',
        modelRevision: 'tdms-reviewed-sb-document-own-details@1',
      },
    ];
    read.rosterEvidence.structuralRosters = read.tabs
      .filter((t: any) => t.state === 'VALUE')
      .map((t: any) => structuralRoster(read, t.tabId));
  }
  const coverage = env.package.records[0].coverage;
  coverage.gaps.push('SB_NATIVE_TREE_ROW_CONTENT_UNREAD', 'OWN_CONTENT_UNREAD');
  env.package.coverage = sbCopy(coverage);
  const proof = sbProof(env),
    read = proof.reads[1],
    table = read.relationTables.at(-1),
    row = table.rows[0],
    link = row.sourceLinks[0];
  proof.targetOccurrences = [
    {
      origin: 'RELATION_TABLE',
      tableId: table.tableId,
      occurrenceId: row.occurrenceId,
      linkIndex: 0,
      targetRef: link.targetRef,
      numberRaw: link.numberRaw,
      rawHref: link.rawHref,
      relationshipRole: 'OUT_OF_SCOPE_REFERENCE',
      modelRoleOrigin: 'SOURCE_PRESENTED_SB_NATIVE_NUMBER_OCCURRENCE',
      rawRole: null,
      nativeLinkRole: link.nativeRole,
      nativeColumnLabel: 'Number',
      nativeColumnToken: 'number',
      fieldId: null,
      fieldActualLabel: null,
      tabId: table.tabId,
      sectionId: null,
      direction: 'UNKNOWN',
      rawDirection: null,
      treePath: row.treePath,
      nativeRelationId: null,
      sourceVersion: row.observedVersion,
      ownerSourceVersion: read.owner.sourceVersion,
      locator: link.locator,
    },
  ];
  return sealSb(env);
}
