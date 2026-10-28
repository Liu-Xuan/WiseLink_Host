// Independent DTO assembly. Native model data is captured from frozen Source0.2.92 pure model modules, without collector/harness imports.
import { createHash } from 'node:crypto';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import { completeContentIdentityProjection } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import source092 from '../../fixtures/tdms-source/source092-sb-reference-models.json';
const { REVIEWED_SB_NATIVE_LAYOUT_MODEL, REVIEWED_SB_ANONYMOUS_STRICT_BLANK_MODEL,
  REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL, REVIEWED_SB_NATIVE_TREE_MODEL,
  REVIEWED_SB_ATTACHMENT_ALIAS_MODEL, REVIEWED_SB_FIELDS_ALIAS_MODEL,
  REVIEWED_SB_HISTORY_MODEL, REVIEWED_SB_MANAGEMENT_MODEL, REVIEWED_SB_NOTEBOOK_MODEL } = source092.models;
import {
  copyComplete,
  syntheticCompleteEnvelope,
} from './tdms-complete-owned.fixture';
import type { TdmsCompleteOwnedField, TdmsSourceVersion } from '../../../shared/tdms-source.interface';
import type { TdmsDailyMetadataRecord } from '../../../server/modules/tdms-source/tdms-daily-metadata-contract';

type Source092Value = TdmsCompleteOwnedField['value'];
export interface Source092Field extends TdmsCompleteOwnedField {
  strictBlankEvidence?: Record<string, unknown>;
}
interface Source092Owner {
  sourceRecordId: string; number: string; nativeTypeId: string | null;
  nativeTypeEvidence: Source092Value; rawHeaderIdentifier: string; rawHeaderType: string;
  sourceVersion: TdmsSourceVersion; businessVersion: TdmsSourceVersion | null;
  technicalVersionEvidence: Source092Value; technicalVersionFieldEvidence: Source092Value;
  businessVersionEvidence: Source092Value; stateRaw: string; sourceModifiedRaw: string;
  observedAt: string; sourceCreatedRaw: string | null; contextRaw: string | null;
  scopeEvidence: { nativeTypeOrigin: string; businessType: string | null;
    engineeringSubtype: string | null; rawTypeField: string | null };
}
interface Source092Section {
  sectionId: string; tabId: string; label: string; panelLocator: string;
  state: string; sourceDeclared: boolean;
}
interface Source092Column { actualLabel: string; nativeColumnToken?: string }
interface Source092Grid { gridId: string; columns: Source092Column[] }
interface Source092Panel {
  tabId: string; panelLocator: string; componentIds: string[]; grids: Source092Grid[];
  sections?: Array<{ sectionId: string; dataStoreId: string; labels: string[] }>;
}
interface Source092PurposeModel {
  schemaVersion: string; modelRevision: string; reasonCode: string;
  panels: Source092Panel[]; canonicalTabId?: string;
}
interface Source092AliasField {
  sectionId: string; dataStoreId: string; label: string; ordinal: number;
  canonicalFieldId: string; state: Source092Value['state']; rawValue: string | null;
  rawHrefs: string[]; strictBlankEvidence?: Record<string, unknown>;
}
interface Source092PurposeFrame {
  activeTabId: string; panelId: string; visible: boolean; componentIds: string[];
  grids: Array<Source092Grid & { visible: boolean; renderedRowCount: number }>;
  fieldCount: number; embeddedCount: number; loading: boolean; blockingMarkerCount: number;
  rawReferences: unknown[]; unknownSurfaceCount: number; historyMetadata?: unknown[];
  embeddedReferences?: Array<{ id: string; documentUrl: string; readyState: string; bodyState: string; rawSrc: string }>;
  sectionIds?: string[]; aliasFields?: Source092AliasField[];
}
interface Source092Purpose {
  schemaVersion: string; modelRevision: string;
  canonicalTableId?: string; aliasTable?: Source092RelationTable;
  // Native Structure and administrative-purpose panels carry different raw proof schemas.
  [key: string]: unknown;
}
export interface Source092Tab {
  tabId: string; label: string; panelLocator: string; state: string; required: boolean;
  sourceDeclared: boolean; reasonCode: string | null; purposeEvidence?: Source092Purpose;
}
interface Source092RosterFrame {
  fieldIds: string[]; sectionIds: string[]; fieldLocators: string[]; sectionLocators: string[];
  declaredFieldCount: number; declaredSectionCount: number; loadingPresent: boolean; terminal: string;
}
export interface Source092RelationTable {
  tableId: string; tabId: string; panelLocator: string; gridId: string;
  rows: Array<{ occurrenceId: string; treePath: string[]; observedVersion: TdmsSourceVersion;
    sourceLinks: TdmsCompleteOwnedField['links'] }>;
  terminal: { nativeTerminal: boolean; [key: string]: unknown };
  enumerationState: string; nativeTreeEvidence?: Record<string, unknown>;
  relatedSurfaceEvidence?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Source092Read<Table extends Source092RelationTable = Source092RelationTable> {
  owner: Source092Owner;
  sourceContext: { sourceInstanceOrigin: string; principalDisplayName: string | null; principalId: string | null;
    principalLocator: string; observedAt: string };
  tabs: Source092Tab[]; sections: Source092Section[]; fields: Source092Field[];
  attachments: Array<{ ownerSourceRecordId: string; sourceVersion: TdmsSourceVersion;
    sourceAttachmentId: string; role: string; filename: string; rawHref: string | null;
    locator: string; state: string; primaryMetadata: { ownerTechnicalVersion: TdmsSourceVersion;
      ownerBusinessVersion: TdmsSourceVersion | null; [key: string]: unknown } }>;
  relationTables: Table[]; observedAt: string;
  domDocumentIdentity?: { url: string; timeOrigin: number };
  sbNativeLayoutEvidence?: Record<string, unknown>;
  rosterEvidence: { tabRosterSource: string; tabIds: string[];
    structuralRosters: Array<{ tabId: string; before: Source092RosterFrame; after: Source092RosterFrame; settledReads: number }>;
    unreadControls: unknown[]; unknownRequiredSurfaces: string[]; layoutEvidencePending: boolean;
    nativeTabStripIds?: string[]; nonContentControls?: Array<Record<string, unknown>> };
}
interface Source092Proof<Read extends Source092Read = Source092Read> {
  schemaVersion: string; scopeId: string; documentIdentity: string; nativeReloadProvenance: Record<string, unknown>;
  requestedCriteria: { scopeId: string; collectionStage?: string; documentCode: string;
    expectedOwner: { sourceModifiedRaw: string; [key: string]: unknown }; [key: string]: unknown };
  reads: Read[]; targetOccurrences: Array<Record<string, unknown>>;
}

// Only this synthetic fixture boundary supplies the known Complete1 shape; production validates the DTO separately.
export function source092RecordProof<Read extends Source092Read = Source092Read>(record: Pick<TdmsDailyMetadataRecord, 'rawFields'>): Source092Proof<Read> {
  return record.rawFields.completeOwnedSource as Source092Proof<Read>;
}

// Synthetic DTOs only: no collector, DOM, Source product evaluation or real row.
export const sbDetail = REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels[0];
export const sbBlankModel = REVIEWED_SB_ANONYMOUS_STRICT_BLANK_MODEL;
export const sbProof = <Read extends Source092Read = Source092Read>(env: { package: { records: Array<Pick<TdmsDailyMetadataRecord, 'rawFields'>> } }) =>
  source092RecordProof<Read>(env.package.records[0]);
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

export function structuralRoster(read: Pick<Source092Read, 'fields' | 'sections'>, tabId: string) {
  const fields = read.fields.filter((f) => f.tabId === tabId);
  const sections = read.sections.filter((s) => s.tabId === tabId);
  const before = {
    fieldIds: fields.map((f) => f.fieldId),
    sectionIds: sections.map((s) => s.sectionId),
    fieldLocators: fields.map((f) => f.value.locator),
    sectionLocators: sections.map((s) => s.panelLocator),
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
    read.sections = sbDetail.sections.map((s) => ({
      sectionId: sbDetail.tabId + '::' + s.sectionId,
      tabId: sbDetail.tabId,
      label: s.label,
      panelLocator: sbDetail.panelLocator + ' #' + s.sectionId,
      state: 'VALUE',
      sourceDeclared: true,
    }));
    read.fields = sbDetail.sections.flatMap((s) =>
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
    const field = read.fields.find((f) => f.value.actualLabel === '');
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
      tab = read.tabs.find((t) => t.tabId === m.tabId);
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
      rawHeaders: m.usesColumns.map((c) => c.actualLabel),
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
    read.tabs = read.tabs.filter((t) => t.tabId === m.tabId);
    read.fields = [];
    read.sections = [];
    read.relationTables = read.relationTables.filter(
      (t) => t.tableId === m.tableId,
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
export function syntheticSbTree(read: Pick<Source092Read, 'owner' | 'observedAt'>) {
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
      confirmation: 'VERSION_UNCONFIRMED' as const,
    },
    cells: m.columns.map((c, i: number) => ({
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
    columns: m.columns.map((c, i: number) => ({
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
    rawHeaders: m.columns.map((c) => c.actualLabel),
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

export function emptySbTable(read: Pick<Source092Read, 'owner' | 'observedAt'>, panel: Pick<Source092Panel, 'tabId' | 'panelLocator'>, grid: Source092Grid) {
  return {
    tableId: grid.gridId,
    tabId: panel.tabId,
    tableTitle: 'Synthetic zero ' + grid.gridId,
    panelLocator: panel.panelLocator,
    gridId: grid.gridId,
    relationshipRole: 'UNKNOWN',
    direction: 'UNKNOWN',
    rawHeaders: grid.columns.map((c) => c.actualLabel),
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
  read: Pick<Source092Read, 'owner' | 'sourceContext'>,
  model: Pick<Source092PurposeModel, 'schemaVersion' | 'modelRevision'>,
  panel: Pick<Source092Panel, 'tabId' | 'panelLocator'>,
  name: string,
  bodyState: string,
  frame: Source092PurposeFrame,
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
function panelFrame(panel: Source092Panel): Source092PurposeFrame {
  return {
    activeTabId: panel.tabId,
    panelId: panel.panelLocator.slice(1),
    visible: true,
    componentIds: sbCopy(panel.componentIds),
    grids: panel.grids.map((g) => ({
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
    read.tabs = REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels.map((p) => ({
      tabId: p.tabId,
      label: p.label,
      panelLocator: p.panelLocator,
      state: 'VALUE',
      required: true,
      sourceDeclared: true,
      reasonCode: null,
    }));
    const byId = (id: string) => read.tabs.find((t) => t.tabId === id);
    const structure = byId(REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.tabId);
    structure.state = 'NOT_READ';
    structure.reasonCode = REVIEWED_SB_DOCUMENT_STRUCTURE_MODEL.stopReason;
    const excluded: Source092PurposeModel[] = [
      REVIEWED_SB_HISTORY_MODEL,
      REVIEWED_SB_ATTACHMENT_ALIAS_MODEL,
      REVIEWED_SB_FIELDS_ALIAS_MODEL,
      REVIEWED_SB_MANAGEMENT_MODEL,
    ];
    const excludedIds = new Set(
      excluded.flatMap((m) => m.panels.map((p) => p.tabId)),
    );
    const business = REVIEWED_SB_NOTEBOOK_MODEL;
    read.relationTables = REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels
      .filter(
        (p) =>
          !excludedIds.has(p.tabId) &&
          p.tabId !== REVIEWED_SB_NATIVE_TREE_MODEL.tabId,
      )
      .flatMap((p) =>
        p.grids
          .filter(
            (g) =>
              p.tabId !== business.panels[0].tabId ||
              g.gridId === business.businessGridId,
          )
          .map((g) => emptySbTable(read, p, g)),
      );
    read.relationTables.push(syntheticSbTree(read));
    for (const model of excluded)
      for (const p of model.panels) {
        const tab = byId(p.tabId),
          frame = panelFrame(p);
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
          frame.sectionIds = p.sections.map((s) => s.sectionId);
          frame.aliasFields = p.sections.flatMap((s) =>
            s.labels.map((label: string, ordinal: number) => {
              const canonical = read.fields.find(
                (f) =>
                  f.sectionId === sbDetail.tabId + '::' + s.sectionId &&
                  f.value.actualLabel === label,
              );
              const field: Source092AliasField = {
                sectionId: s.sectionId,
                dataStoreId: s.dataStoreId,
                label,
                ordinal,
                canonicalFieldId: canonical.fieldId,
                state: canonical.value.state,
                rawValue: canonical.value.rawValue,
                rawHrefs: canonical.links.map((l) => l.rawHref),
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
            (t) =>
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
      frame = panelFrame(p);
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
      panels: REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels.map((panel) => {
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
    read.rosterEvidence.tabIds = read.tabs.map((t) => t.tabId);
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
      .filter((t) => t.state === 'VALUE')
      .map((t) => structuralRoster(read, t.tabId));
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

export type Source092Scope = 'SB' | 'SL' | 'AD' | 'MT';
export function current092Envelope(scope: Source092Scope, stage: 'OWNER_PRIMARY' | 'FULL' = 'OWNER_PRIMARY') {
  const env = scope === 'AD' ? syntheticCompleteEnvelope('AD', 92901) :
    stage === 'OWNER_PRIMARY' ? syntheticSbDetails('Estimating') : syntheticSbPanels('Estimated');
  const record = env.package.records[0];
  const proof = sbProof(env);
  const profile = source092.profiles[scope];
  proof.scopeId = scope;
  proof.requestedCriteria.scopeId = scope;
  if (stage === 'OWNER_PRIMARY') proof.requestedCriteria.collectionStage = 'OWNER_PRIMARY';
  for (const read of proof.reads) {
    if (scope !== 'AD') read.owner.scopeEvidence.businessType = scope;
    if (scope === 'AD') {
      read.owner.businessVersion = null;
      read.owner.businessVersionEvidence = { ...read.owner.businessVersionEvidence,
        state: 'NOT_READ', actualLabel: 'Business Version:', rawValue: null,
        observedTotalCodepoints: 0, locator: '#infoPage_myTab_object_docInfoDefaultDetails [unreviewed-business-version-model]' };
    }
    const bindScope = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const node = value as { scopeId?: string; strictBlankEvidence?: { scopeId: string } };
      if (node.scopeId === 'SB') node.scopeId = scope;
      if (node.strictBlankEvidence) node.strictBlankEvidence.scopeId = scope;
      for (const child of Object.values(node)) bindScope(child);
    };
    bindScope(read);
    if (stage === 'OWNER_PRIMARY') {
      const detail = profile.detailPanel;
      const panels = scope === 'AD' ? [
        { tabId: 'infoPageinfoPanelID__' + detail.slice(1), label: 'Details', panelLocator: detail },
        { tabId: 'infoPageinfoPanelID__infoPage_myTab_object_adRelatedTab', label: 'AD Relate Tab', panelLocator: '#infoPage_myTab_object_adRelatedTab' },
      ] : REVIEWED_SB_NATIVE_LAYOUT_MODEL.panels;
      read.tabs = panels.map(panel => ({ tabId: panel.tabId, label: panel.label,
        panelLocator: panel.panelLocator, state: panel.panelLocator === detail ? 'VALUE' : 'NOT_READ',
        required: true, sourceDeclared: true, reasonCode: panel.panelLocator === detail ? null : 'TDMS_COMPLETE_OWNER_PRIMARY_STAGE_DEFERRED' }));
      read.fields = read.fields.filter((field) => field.tabId === read.tabs[0].tabId);
      read.sections = read.sections.filter((section) => section.tabId === read.tabs[0].tabId);
      read.relationTables = [];
      read.rosterEvidence.tabIds = read.tabs.map((tab) => tab.tabId);
      read.rosterEvidence.structuralRosters = [structuralRoster(read, read.tabs[0].tabId)];
      read.rosterEvidence.layoutEvidencePending = true;
      read.rosterEvidence.unknownRequiredSurfaces = read.tabs.filter((tab) => tab.state === 'NOT_READ')
        .map((tab) => tab.panelLocator);
      const metadata = { sourceAttachmentId: 'OR:wt.content.ApplicationData:92901', role: 'PRIMARY',
        filename: `synthetic-${scope.toLowerCase()}-092.pdf`, format: 'PDF', sizeRaw: '24 B',
        ownerTechnicalVersion: sbCopy(read.owner.sourceVersion), ownerBusinessVersion: sbCopy(read.owner.businessVersion),
        observedAt: read.observedAt, evidenceLocator: detail + ' #General [primary]', bytesCollected: false,
        metadataRevision: 'tdms-complete-owned-primary-metadata@1', metadataState: 'VALUE', metadataGapCodes: [] };
      read.attachments = [{ ownerSourceRecordId: read.owner.sourceRecordId,
        sourceVersion: sbCopy(read.owner.sourceVersion), sourceAttachmentId: metadata.sourceAttachmentId,
        role: 'PRIMARY', filename: metadata.filename, rawHref: null,
        locator: metadata.evidenceLocator, state: 'VALUE', primaryMetadata: metadata }];
    }
  }
  record.businessVersion = sbCopy(proof.reads[1].owner.businessVersion);
  if (stage === 'OWNER_PRIMARY') record.coverage.gaps = ['REQUIRED_TARGET_OWN_SOURCES_PENDING',
    'COMPLETION_CERTIFICATE_NOT_ISSUED', 'OWN_LAYOUT_REPRESENTATIVE_PENDING', 'OWN_CONTENT_UNREAD'];
  env.package.coverage = sbCopy(record.coverage);
  return sealSb(env);
}


/** Only bytes/metadata identity. Synthetic candidate bytes are not a parsed publication. */
export function current092Original(scope: Source092Scope, actual?: {
  bytes: Buffer; number: string; businessRevision: string;
}) {
  const env = current092Envelope(scope);
  const record = env.package.records[0];
  const proof = sbProof(env);
  if (actual) {
    const oldNumber = record.number;
    const businessVersion = { rawRevision: actual.businessRevision, rawIteration: null,
      confirmation: 'SOURCE_DECLARED' as const };
    record.number = actual.number; record.rawFields.number = actual.number;
    proof.requestedCriteria.documentCode = actual.number;
    for (const read of proof.reads) {
      read.owner.number = actual.number;
      read.owner.rawHeaderIdentifier = read.owner.rawHeaderIdentifier.replace(oldNumber, actual.number);
      read.owner.businessVersion = sbCopy(businessVersion);
      Object.assign(read.owner.businessVersionEvidence, { rawValue: actual.businessRevision,
        observedTotalCodepoints: actual.businessRevision.length });
      read.attachments[0].primaryMetadata.ownerBusinessVersion = sbCopy(businessVersion);
    }
    record.businessVersion = businessVersion;
  }
  sealSb(env);
  const bytes = actual?.bytes ?? Buffer.from('%PDF-1.7\nsynthetic-092-' + scope + '\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const at = env.package.observedAt;
  const attachment = proof.reads[1].attachments[0];
  const binding = { ownerSnapshotId: record.snapshotId,
    sourceAttachmentId: attachment.sourceAttachmentId, role: 'PRIMARY', filename: attachment.filename,
    mediaType: 'application/pdf', blobSha256: sha256, byteLength: bytes.length,
    sourceVersion: sbCopy(record.sourceVersion), observedAt: at, evidenceLocator: attachment.locator };
  const { observedAt: _observedAt, ...bindingIdentity } = binding;
  env.package.artifactBindings = [{ bindingId: 'TDMSBIND-' + hash(bindingIdentity), ...binding }];
  env.package.query.originalAcquisition = { contentMode: 'COMPLETE_OWN_SOURCE@1',
    originalRevision: 'tdms-complete-primary-bytes@1',
    operationId: 'TDMSOP-33333333-3333-3333-3333-333333333333',
    ownOperationId: 'TDMSOP-44444444-4444-4444-4444-444444444444',
    receiptSha256: 'a'.repeat(64), sourceAttachmentId: attachment.sourceAttachmentId,
    bytesSha256: sha256, byteLength: bytes.length, mediaType: 'application/pdf' };
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return { env, bytes };
}
