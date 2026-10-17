import { REVIEWED_SB_NOTEBOOK_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-notebook-purpose';
import { REVIEWED_SB_NATIVE_TREE_MODEL } from '../../../server/modules/tdms-source/tdms-reviewed-sb-native-tree';
import { completeOwnedRecord } from '../../../server/modules/tdms-source/tdms-complete-owned-source.validation';
import { hash } from '../../../server/modules/tdms-source/tdms-source.validation';
import {
  sbCopy,
  sbProof,
  sealSb,
  withSbStructureEvidence,
  structuralRoster,
} from './tdms-reviewed-sb-0-2-73.fixture';

// Reuses frozen synthetic-only literal table fixtures, with current @13 Host models.
// Exact renderer DTOs on the existing synthetic PARTIAL capture. No DOM,
// collector, Source product module, original bytes, or real complete sample.
export type NotebookEnvelope = ReturnType<typeof withSbStructureEvidence>;
export type NotebookRead = ReturnType<typeof sbProof>['reads'][number];
export const notebookPanel = REVIEWED_SB_NOTEBOOK_MODEL.panels[0];
export const notebookGrid = REVIEWED_SB_NOTEBOOK_MODEL.businessGridId;
const columns = notebookPanel.grids.find(
  (grid: { gridId: string }) => grid.gridId === notebookGrid,
)!.columns;
const names = ['My General Links', 'My Hot Links'];
const occurrence = (index: number) => notebookGrid + ':NATIVE_LEAF:' + index;
const rowClasses = (index: number) => [
  'x-grid3-row',
  'ux-maximgb-tg-level-0',
  ...(index ? ['x-grid3-row-alt', 'x-grid3-row-last'] : ['x-grid3-row-first']),
];
const newLinkAction = {
  tag: 'A',
  className: 'linkfont',
  idKind: 'P_DIGITS',
  hrefPresent: true,
  hrefProtocol: 'javascript:',
  onclickPresent: true,
  qtip: 'New Link',
  image: {
    src: 'netmarkets/images/link_create.gif',
    qtip: 'New Link',
    height: '16',
    width: '16',
    border: '0',
    align: 'middle',
  },
};
function metadata(index: number) {
  return {
    position: index,
    rowClasses: rowClasses(index),
    rowAttributeNames: ['class', 'style'],
    cellTokens: columns.map(
      (column: { nativeColumnToken: string }) => column.nativeColumnToken,
    ),
    cellRawTexts: ['\u00a0', names[index]!, '\u00a0', '', '\u00a0'],
    name: names[index]!,
    nameQtip: names[index]!,
    nameUnselectable: 'on',
    folderImage: { src: 'wt/clients/images/folder.gif', title: null },
    uiWrap: { className: 'ux-maximgb-tg-uiwrap', width: 16 },
    marker: {
      className: index ? 'ux-maximgb-tg-elbow-end' : 'ux-maximgb-tg-elbow',
      left: 1,
    },
    blankRenderers: [
      'CHECKER_DIV_NBSP',
      'EMPTY_INNER_DIV_NBSP',
      'EMPTY_INNER_DIV_NBSP',
    ],
    newLinkAction: sbCopy(newLinkAction),
    businessReferences: [],
  };
}
const toolbar = [
  {
    tag: 'BUTTON',
    type: 'button',
    className: 'x-btn-text expandCollapse_collapsed',
    text: '',
    image: null,
  },
  {
    tag: 'BUTTON',
    type: 'button',
    className: 'x-btn-text',
    text: 'Actions',
    image: null,
  },
  {
    tag: 'INPUT',
    type: 'text',
    className: 'x-form-text x-form-field invalidDrag x-form-empty-field',
    text: '',
    image: null,
    id: notebookGrid + '.fitTextField',
    name: notebookGrid + '.fitTextField',
    value: 'Find in tree',
  },
  {
    tag: 'BUTTON',
    type: 'button',
    className: 'x-btn-text',
    text: '',
    image: 'netmarkets/images/downArrow.gif',
  },
  {
    tag: 'BUTTON',
    type: 'button',
    className: 'x-btn-text',
    text: '',
    image: 'netmarkets/images/upArrow.gif',
  },
  {
    tag: 'BUTTON',
    type: 'button',
    className: 'x-btn-text helpButton',
    text: '',
    image: null,
  },
].map((control) => ({ ...control, disabled: false, inlineHandlers: [] }));

function nativeNotebookTable(read: NotebookRead) {
  const rows = [metadata(0), metadata(1)];
  const slots = rows.map((row, index: number) => ({
    position: index,
    occurrenceId: occurrence(index),
    rowClasses: row.rowClasses,
    contentTop: index * 40,
    height: 40,
    cellCount: 5,
  }));
  const proofWindows = rows.map((row, index: number) => {
    const frame = {
      counts: ['( 2 objects )', '( 0 objects selected )'],
      columns: sbCopy(columns),
      toolbar: sbCopy(toolbar),
      slots: sbCopy(slots),
      rowMetadata: [sbCopy(row)],
      scroll: {
        top: index * 40,
        height: 80,
        viewport: 40,
        atTop: index === 0,
        atBottom: index === 1,
      },
      loading: false,
      blockingMarkers: 0,
      pagerCount: 0,
    };
    return {
      ordinal: index,
      before: frame,
      after: sbCopy(frame),
      settledReads: 2,
      nodeContinuity: 'SAME_NATIVE_BODY_AND_TWO_ROW_NODES',
    };
  });
  return {
    tableId: notebookGrid,
    tabId: notebookPanel.tabId,
    tableTitle: notebookGrid,
    panelLocator: notebookPanel.panelLocator,
    gridId: notebookGrid,
    relationshipRole: 'CURRENT_CONTENT',
    direction: 'UNKNOWN',
    rawHeaders: columns.map(
      (column: { actualLabel: string }) => column.actualLabel,
    ),
    reportedTotal: 2,
    countEvidence: {
      rawText: '( 2 objects )',
      exact: true,
      locator:
        notebookPanel.panelLocator +
        ' [id="' +
        notebookGrid +
        '"] span.tableCount',
    },
    scanMode: 'TREE',
    rows: names.map((name, index: number) => ({
      occurrenceId: occurrence(index),
      globalIndex: null,
      nativeRowId: null,
      treePath: [occurrence(index)],
      treeDepth: 0,
      nativeRelationId: null,
      rawRole: null,
      rawDirection: null,
      cells: columns.map(
        (column: { actualLabel: string }, ordinal: number) => ({
          actualLabel: column.actualLabel,
          rawValue: ordinal === 1 ? name : '',
          state: ordinal === 1 ? 'VALUE' : 'BLANK',
          observedTotalCodepoints: ordinal === 1 ? [...name].length : 0,
        }),
      ),
      sourceLinks: [],
      observedVersion: {
        rawRevision: null,
        rawIteration: null,
        confirmation: 'VERSION_UNCONFIRMED',
      },
    })),
    windows: proofWindows.map((window) => ({
      ordinal: window.ordinal,
      rowOccurrenceIds: [occurrence(window.ordinal)],
      globalIndices: [],
      reportedTotal: 2,
      pageRaw: null,
      scroll: sbCopy(window.before.scroll),
      nextControl: { present: false, enabled: false, terminalDeclared: false },
      stableReads: 2,
      treePending: 0,
      observedAt: read.observedAt,
    })),
    treeExpansions: [],
    terminal: {
      kind: 'NATIVE_END',
      total: 2,
      captured: 2,
      allGlobalIndices: false,
      allTreeNodesExpanded: true,
      nativeTerminal: true,
      trueZero: false,
      settledReads: 2,
    },
    enumerationState: 'VALUE',
    stopReason: null,
    ownerSourceRecordId: read.owner.sourceRecordId,
    ownerSourceVersion: sbCopy(read.owner.sourceVersion),
    observedAt: read.observedAt,
    relatedSurfaceEvidence: {
      schemaVersion: 'wiselink.tdms-sb-notebook-native-leaf-table.v1',
      modelRevision: 'tdms-reviewed-sb-notebook-native-leaf-table@1',
      purpose: 'CURRENT_NATIVE_NOTEBOOK_FOLDER_LEAF_ROWS',
      ownerSourceRecordId: read.owner.sourceRecordId,
      ownerSourceVersion: sbCopy(read.owner.sourceVersion),
      ownerSourceModifiedRaw: read.owner.sourceModifiedRaw,
      ownerBusinessVersion: sbCopy(read.owner.businessVersion),
      ownStateRaw: read.owner.stateRaw,
      scopeId: 'SB',
      nativeTypeId: read.owner.nativeTypeId,
      sourceContext: sbCopy(read.sourceContext),
      normalBinding: sbCopy(read.domDocumentIdentity),
      tabId: notebookPanel.tabId,
      panelLocator: notebookPanel.panelLocator,
      gridId: notebookGrid,
      rows,
      windows: proofWindows,
    },
  };
}
export type NativeNotebookTable = ReturnType<typeof nativeNotebookTable>;
export function notebookTable(read: NotebookRead): NativeNotebookTable {
  return read.relationTables.find(
    (table: { gridId: string }) => table.gridId === notebookGrid,
  );
}
export function syntheticNativeNotebook(clockDelta = 0): NotebookEnvelope {
  const env = withSbStructureEvidence();
  if (clockDelta) visitClock(env, clockDelta);
  for (const read of sbProof(env).reads) {
    const index = read.relationTables.findIndex(
      (table: { gridId: string }) => table.gridId === notebookGrid,
    );
    read.relationTables[index] = nativeNotebookTable(read);
    const tab = read.tabs.find(
      (entry: { tabId: string }) => entry.tabId === notebookPanel.tabId,
    );
    tab.purposeEvidence.before.grids.find(
      (grid: { gridId: string }) => grid.gridId === notebookGrid,
    ).renderedRowCount = 2;
    tab.purposeEvidence.after = sbCopy(tab.purposeEvidence.before);
  }
  return sealSb(env);
}
export function visitClock(value: unknown, delta: number): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      ['timeOrigin', 'innerTimeOrigin'].includes(key) &&
      typeof child === 'number'
    )
      Reflect.set(value, key, child + delta);
    else visitClock(child, delta);
  }
}
export function sealNotebookRaw(env: NotebookEnvelope): NotebookEnvelope {
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function treeMtime(
  env: NotebookEnvelope,
  change: (raw: string) => string,
): void {
  for (const read of sbProof(env).reads) {
    const table = read.relationTables.find(
      (entry: { gridId: string }) =>
        entry.gridId === REVIEWED_SB_NATIVE_TREE_MODEL.gridId,
    );
    const proof = table.nativeTreeEvidence;
    for (const metadataRows of [
      proof.rowMetadata,
      proof.windows[0].rowMetadata,
    ])
      metadataRows[0].columns[8].rawText = change(read.owner.sourceModifiedRaw);
  }
}

// Materialize the independently reviewed Notebook-only PARTIAL DTO. Other SB
// guards cannot conceal the Notebook URL check in the exact consumer tests.
export function syntheticNotebookOnly() {
  const env = syntheticNativeNotebook();
  for (const read of sbProof(env).reads) {
    read.tabs = read.tabs.filter((t: any) => t.tabId === notebookPanel.tabId);
    read.fields = [];
    read.sections = [];
    read.relationTables = [notebookTable(read)];
    delete read.sbNativeLayoutEvidence;
    read.rosterEvidence = {
      tabRosterSource: 'OWN_INFOPAGE_TAB_STRIP',
      tabIds: [notebookPanel.tabId],
      structuralRosters: [structuralRoster(read, notebookPanel.tabId)],
      unreadControls: [],
      unknownRequiredSurfaces: [],
      layoutEvidencePending: false,
    };
  }
  const proof = sbProof(env);
  const observation = {
    schemaVersion: proof.schemaVersion,
    requestedCriteria: proof.requestedCriteria,
    documentIdentity: proof.documentIdentity,
    nativeReloadProvenance: proof.nativeReloadProvenance,
    reads: proof.reads,
  };
  // The JS materializer adds snapshotId after its object declaration. Verify
  // that actual result and replace all its fields on the typed synthetic DTO.
  const materialized = completeOwnedRecord(
    observation,
    proof.requestedCriteria,
  );
  if (typeof Reflect.get(materialized, 'snapshotId') !== 'string')
    throw Error('SYNTHETIC_NOTEBOOK_MATERIALIZATION_MISSING_SNAPSHOT');
  Object.assign(env.package.records[0], materialized);
  env.package.coverage = sbCopy(env.package.records[0].coverage);
  return sealSb(env);
}

// Synthetic PARTIAL DTOs only; exact current native owner/tree/layout evidence.
export const canonicalCaption = 'SB处理单编号';
export const alternateCaption = 'SB评估单编号';
export const documentCaption = 'SB/SL文档编号';
export const captionTab =
  'infoPageinfoPanelID__infoPage_myTab_object_sbRelatedTab';
export type CaptionEnvelope = ReturnType<typeof withSbStructureEvidence>;
export function captionTree(read: any) {
  return read.relationTables.find((t: any) => t.gridId === 'mytreetable');
}
export function captionLayout(read: any) {
  return read.sbNativeLayoutEvidence.panels.find(
    (p: any) => p.tabId === captionTab,
  );
}
export function setReadCaption(read: any, label: string) {
  const t = captionTree(read),
    e = t.nativeTreeEvidence;
  t.rawHeaders[5] = label;
  e.columns[5].actualLabel = label;
  for (const row of t.rows) row.cells[5].actualLabel = label;
  for (const row of e.rowMetadata) row.columns[5].actualLabel = label;
  for (const phase of e.windows) {
    for (const row of phase.rows) row.cells[5].actualLabel = label;
    for (const row of phase.rowMetadata) row.columns[5].actualLabel = label;
  }
  for (const key of ['before', 'after'])
    captionLayout(read)[key].grids[0].columns[5].actualLabel = label;
}
export function syntheticSbCaption(label = canonicalCaption) {
  const env = withSbStructureEvidence();
  for (const read of sbProof(env).reads) setReadCaption(read, label);
  env.package.packageId =
    'synthetic-caption-83-' +
    (label === canonicalCaption ? 'canonical' : 'alternate');
  return sealSb(env);
}
export function sealCaptionRaw(env: CaptionEnvelope) {
  const fields = sbProof(env).reads?.[1]?.fields;
  if (fields !== undefined)
    env.package.records[0].content.completeOwnedFields = sbCopy(fields);
  env.requestId = 'TDMSIMPORT-' + hash(env.package);
  return env;
}
export function changeBusinessTitle(env: CaptionEnvelope, value: string) {
  for (const read of sbProof(env).reads) {
    const field = read.fields.find(
      (f: any) => f.value.actualLabel === 'SB/SL标题:',
    );
    field.value.rawValue = value;
    field.value.observedTotalCodepoints = [...value].length;
    for (const tab of read.tabs)
      for (const key of ['before', 'after'])
        for (const alias of tab.purposeEvidence?.[key]?.aliasFields || [])
          if (alias.canonicalFieldId === field.fieldId) alias.rawValue = value;
  }
  return sealSb(env);
}

export function changeTechnicalVersion(env: CaptionEnvelope) {
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'rawRevision' && entry === 'A') value[key] = 'B';
      else if (typeof entry === 'string')
        value[key] = entry.replaceAll('A.1', 'B.1');
      else visit(entry);
    }
  };
  visit(env);
  return sealSb(env);
}
export function changeNativeTarget(env: CaptionEnvelope) {
  const prior = env.package.records[0].sourceRecordId;
  const next = prior.replace(/:73001$/u, ':73002');
  if (next === prior) throw Error('SYNTHETIC_TARGET_FIXTURE_CHANGED');
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') value[key] = entry.replaceAll(prior, next);
      else visit(entry);
    }
  };
  visit(env);
  return sealSb(env);
}
